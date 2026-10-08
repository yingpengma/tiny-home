import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Grid } from './grid.js';
import { SIT_DROP, LIE_LIFT } from './character.js';
import { dirOf } from './motion.js';
import { bakeGroup } from './bake.js';

// 一人独居的开放式大平层（16m × 12m）+ 阳台。镜头从 +x +z 看过来：后墙(z=0)和左墙(x=0)是高墙，前墙和右墙是矮墙。
// 只有卫生间是隔出来的房间。分区：
//   卧室(左上) | 卫生间(中上) | 洗衣角 + 开放厨房(右上)
//   工作区(左中) | 客厅(左下) | 健身角(中下) | 餐厅(右中) | 玄关(右下) | 阳台(前方)

export const HOUSE_W = 16;
export const HOUSE_D = 12;
export const GRID_D = 14.5;
const T = 0.15;
const OUTER_H = 2.6, FRONT_H = 0.45, INNER_LOW = 0.9, INNER_HIGH = 2.6;
const PI = Math.PI;
const R2 = PI / 2;
const WALK_BLOCK_H = 1.25; // 低于这个高度的东西会挡路

export function buildHouse(particles) {
  const group = new THREE.Group();
  const staticGroup = new THREE.Group();
  group.add(staticGroup);
  const grid = new Grid(HOUSE_W, GRID_D, 0.25, 0.36);
  const colliders = [];
  const matCache = new Map();
  const mat = (color) => {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
    return matCache.get(color);
  };

  function register(mesh, tag, parent, opt, b) {
    if (!tag) return;
    if (parent) {
      // 挂在父节点上（零件合并后依然有效），局部坐标里的包围盒
      colliders.push({ tag, obj: parent, local: new THREE.Box3(new THREE.Vector3(b.x0, b.y0, b.z0), new THREE.Vector3(b.x1, b.y1, b.z1)) });
    } else {
      colliders.push({ tag, ...b });
      if (opt.block !== false && b.y0 < WALK_BLOCK_H) grid.addFootprint(b.x0, b.z0, b.x1, b.z1);
    }
  }

  function box(x0, z0, x1, z1, y0, y1, color, opt = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), opt.material ?? mat(color));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? staticGroup).add(mesh);
    register(mesh, opt.tag, opt.parent, opt, { x0, z0, x1, z1, y0, y1 });
    return mesh;
  }

  function cyl(x, z, y0, y1, r, color, opt = {}) {
    const geo = new THREE.CylinderGeometry(opt.rTop ?? r, r, y1 - y0, opt.seg ?? 16, 1, opt.open ?? false);
    const mesh = new THREE.Mesh(geo, opt.material ?? mat(color));
    mesh.position.set(x, (y0 + y1) / 2, z);
    if (opt.rot) mesh.rotation.set(...opt.rot);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? staticGroup).add(mesh);
    const rr = Math.max(r, opt.rTop ?? r);
    register(mesh, opt.tag, opt.parent, opt, { x0: x - rr, z0: z - rr, x1: x + rr, z1: z + rr, y0, y1 });
    return mesh;
  }

  function ball(x, y, z, r, color, opt = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, opt.seg ?? 12, 10), opt.material ?? mat(color));
    mesh.position.set(x, y, z);
    if (opt.scale) mesh.scale.set(...opt.scale);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? staticGroup).add(mesh);
    return mesh;
  }

  // 动态物件用的组（不参与合并）
  function dyn(x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    group.add(g);
    return g;
  }

  // ---------- 地面 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), mat('#9cc98a'));
  ground.rotation.x = -PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  group.add(ground);
  box(-0.3, -0.3, HOUSE_W + 0.3, HOUSE_D + 0.3, -0.3, -0.06, '#cdbfa6', { cast: false });
  box(5.5, HOUSE_D + 0.15, 11.3, 14.4, -0.3, -0.06, '#cdbfa6', { cast: false });

  function texture(kind, base, line) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line;
    g.lineWidth = 3;
    if (kind === 'tile') {
      g.strokeRect(0, 0, 128, 128);
    } else if (kind === 'stone') {
      g.strokeRect(0, 0, 128, 128);
      g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 64); g.moveTo(0, 64); g.lineTo(128, 64); g.stroke();
    } else if (kind === 'belt') {
      g.fillStyle = line;
      for (let i = 0; i < 8; i++) g.fillRect(0, i * 16, 128, 3);
    } else {
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke();
        const x = (i % 2) * 64 + 24;
        g.beginPath(); g.moveTo(x, i * 32); g.lineTo(x, i * 32 + 32); g.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  function floor(x0, z0, x1, z1, y1, kind, base, line, size) {
    const tex = texture(kind, base, line);
    tex.repeat.set((x1 - x0) / size, (z1 - z0) / size);
    return box(x0, z0, x1, z1, -0.06, y1, null, { material: new THREE.MeshLambertMaterial({ map: tex }), cast: false });
  }
  floor(0, 0, HOUSE_W, HOUSE_D, 0, 'plank', '#d6b088', '#bf966c', 1.8);
  floor(5, 0, 9, 4.2, 0.003, 'tile', '#dbedf2', '#b9d1d8', 0.45);
  floor(9, 0, HOUSE_W, 3.7, 0.003, 'tile', '#efe6d4', '#d6c7aa', 0.6);
  floor(14.4, 8.6, HOUSE_W, HOUSE_D, 0.003, 'stone', '#d4cfc6', '#b8b1a5', 0.9);
  floor(5.6, HOUSE_D + 0.15, 11.2, 14.3, 0, 'plank', '#b98c62', '#9c7049', 1.2);
  box(6.6, HOUSE_D, 8.2, HOUSE_D + 0.15, -0.06, 0.012, '#cfc6b4', { cast: false });

  // 屋外和阳台以外不可走
  grid.markRect(0, HOUSE_D + 0.01, 5.6, GRID_D);
  grid.markRect(11.2, HOUSE_D + 0.01, HOUSE_W, GRID_D);
  grid.markRect(5.6, 14.3, 11.2, GRID_D);

  // ---------- 墙 ----------
  // 墙：同一类的墙合成一个网格（墙顶用深色顶点色），高度靠 scale.y 控制
  const sideColor = new THREE.Color('#f4ecdc'), topColor = new THREE.Color('#6f6355');
  const wallGeos = { outer: [], front: [], inner: [] };
  const walls = [];
  function wall(x0, z0, x1, z1, kind) {
    const geo = new THREE.BoxGeometry(x1 - x0, 1, z1 - z0).toNonIndexed();
    geo.translate((x0 + x1) / 2, 0.5, (z0 + z1) / 2);
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = i >= 12 && i < 18 ? topColor : sideColor; // 第 3 个面（+y）是墙顶
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    wallGeos[kind].push(geo);
    colliders.push({ tag: 'wall', x0, z0, x1, z1, y0: 0, y1: kind === 'front' ? FRONT_H : 2.6 });
    grid.addFootprint(x0, z0, x1, z1);
  }
  function finishWalls() {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const [kind, geos] of Object.entries(wallGeos)) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), m);
      mesh.scale.y = kind === 'outer' ? OUTER_H : kind === 'front' ? FRONT_H : INNER_LOW;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      walls.push({ mesh, kind });
    }
  }
  wall(-T, -T, HOUSE_W + T, 0, 'outer');
  wall(-T, 0, 0, HOUSE_D + T, 'outer');
  wall(-T, HOUSE_D, 6.6, HOUSE_D + T, 'front');        // 前墙，6.6..8.2 是阳台门
  wall(8.2, HOUSE_D, HOUSE_W + T, HOUSE_D + T, 'front');
  wall(HOUSE_W, -T, HOUSE_W + T, 9.0, 'front');        // 右墙，9..10 是入户门
  wall(HOUSE_W, 10.0, HOUSE_W + T, HOUSE_D + T, 'front');
  wall(5 - T / 2, 0, 5 + T / 2, 4.2 + T / 2, 'inner'); // 卫生间
  wall(5 + T / 2, 4.2 - T / 2, 5.6, 4.2 + T / 2, 'inner');
  wall(6.6, 4.2 - T / 2, 9 - T / 2, 4.2 + T / 2, 'inner');
  wall(9 - T / 2, 0, 9 + T / 2, 4.2 + T / 2, 'inner');
  finishWalls();

  const glassMat = new THREE.MeshLambertMaterial({ color: '#cdeaf5', transparent: true, opacity: 0.28, depthWrite: false });
  // 阳台落地推拉门（有人/猫靠近时自动滑开）
  const balDoors = [[6.6, -0.8], [7.4, 0.8]].map(([x0, slide]) => {
    const g = dyn(x0, 0, 11.97);
    box(0, -0.02, 0.8, 0.02, 0.01, 2.25, null, { material: glassMat, parent: g, cast: false, tag: 'balDoor' });
    for (const [a, b] of [[0, 0.04], [0.76, 0.8]]) box(a, -0.03, b, 0.03, 0, 2.28, '#e8e8e8', { parent: g, cast: false });
    for (const [a, b] of [[0, 0.05], [2.22, 2.28]]) box(0, -0.03, 0.8, 0.03, a, b, '#e8e8e8', { parent: g, cast: false });
    box(slide < 0 ? 0.68 : 0.08, 0.03, slide < 0 ? 0.72 : 0.12, 0.05, 0.9, 1.2, '#9a9a9a', { parent: g, cast: false });
    return { g, x0, slide };
  });
  let balDoorCur = 0;

  // 阳台栏杆（玻璃 + 木扶手）
  box(5.6, 14.25, 11.2, 14.3, 0, 1.0, null, { material: glassMat, cast: false, tag: 'railing' });
  box(5.6, HOUSE_D + T, 5.65, 14.3, 0, 1.0, null, { material: glassMat, cast: false, tag: 'railing' });
  box(11.15, HOUSE_D + T, 11.2, 14.3, 0, 1.0, null, { material: glassMat, cast: false, tag: 'railing' });
  box(5.57, 14.22, 11.23, 14.33, 1.0, 1.05, '#9c7049');
  box(5.57, HOUSE_D + T, 5.68, 14.33, 1.0, 1.05, '#9c7049');
  box(11.12, HOUSE_D + T, 11.23, 14.33, 1.0, 1.05, '#9c7049');
  for (const x of [5.62, 7.5, 9.35, 11.18]) box(x - 0.03, 14.24, x + 0.03, 14.31, 0, 1.0, '#8a8f94');

  // ---------- 窗户（玻璃颜色跟随天色） ----------
  const skyMat = new THREE.MeshBasicMaterial({ color: '#9fd2ef' });
  function windowBack(x0, x1, y0, y1) {
    box(x0, 0, x1, 0.04, y0, y1, '#ffffff', { cast: false });
    box(x0 + 0.06, 0.04, x1 - 0.06, 0.045, y0 + 0.06, y1 - 0.06, null, { material: skyMat, cast: false });
    const xm = (x0 + x1) / 2;
    box(xm - 0.02, 0.045, xm + 0.02, 0.06, y0, y1, '#ffffff', { cast: false });
    box(x0 - 0.05, 0, x1 + 0.05, 0.12, y0 - 0.04, y0, '#ffffff', { cast: false });
  }
  function windowLeft(z0, z1, y0, y1, mullions = 1) {
    box(0, z0, 0.04, z1, y0, y1, '#ffffff', { cast: false });
    box(0.04, z0 + 0.06, 0.045, z1 - 0.06, y0 + 0.06, y1 - 0.06, null, { material: skyMat, cast: false });
    for (let i = 1; i <= mullions; i++) {
      const z = z0 + ((z1 - z0) * i) / (mullions + 1);
      box(0.045, z - 0.02, 0.06, z + 0.02, y0, y1, '#ffffff', { cast: false });
    }
    const ym = y0 + (y1 - y0) * 0.62;
    box(0.045, z0, 0.06, z1, ym, ym + 0.04, '#ffffff', { cast: false });
  }
  windowLeft(0.9, 2.9, 0.05, 2.45, 2);   // 卧室落地窗
  windowLeft(11.0, 11.95, 0.9, 2.4);     // 客厅
  windowBack(5.35, 5.95, 1.6, 2.2);      // 卫生间
  windowBack(9.4, 10.4, 1.55, 2.25);     // 洗衣角
  windowBack(11.95, 12.6, 1.2, 2.15);    // 厨房水槽上方

  // 开关和插座
  for (const [x, y] of [[0.95, 0.3], [3.85, 1.1], [13.0, 1.05], [14.45, 1.05], [11.85, 1.1], [9.2, 0.3]]) {
    box(x - 0.04, 0, x + 0.04, 0.015, y - 0.04, y + 0.04, '#f8f8f8', { cast: false });
    box(x - 0.015, 0.015, x + 0.015, 0.02, y - 0.01, y + 0.01, '#d0d0d0', { cast: false });
  }
  for (const [z, y] of [[4.75, 1.1], [6.0, 0.3], [10.95, 0.3], [7.05, 1.1]]) {
    box(0, z - 0.04, 0.015, z + 0.04, y - 0.04, y + 0.04, '#f8f8f8', { cast: false });
    box(0.015, z - 0.015, 0.02, z + 0.015, y - 0.01, y + 0.01, '#d0d0d0', { cast: false });
  }

  // ---------- 灯 ----------
  const lamps = [];
  function lamp(x, y, z, { color = '#ffcf8a', intensity = 5, distance = 6 } = {}) {
    const light = new THREE.PointLight(color, 0, distance, 1.6);
    light.position.set(x, y, z);
    group.add(light);
    const material = new THREE.MeshLambertMaterial({ color: '#fff3d6', emissive: new THREE.Color(color), emissiveIntensity: 0 });
    lamps.push({ light, material, intensity, level: 0 });
    return material;
  }
  function tableLamp(x, z, y, newLight = true) {
    cyl(x, z, y, y + 0.2, 0.04, '#c9b79c');
    const m = newLight ? lamp(x, y + 0.45, z) : lamps[lamps.length - 1].material;
    cyl(x, z, y + 0.18, y + 0.4, 0.14, null, { rTop: 0.085, material: m, cast: false });
  }

  // ---------- 绿植（会缺水变蔫） ----------
  const plants = {};
  function plant(id, x, z, s) {
    cyl(x, z, 0, 0.42 * s, 0.17 * s, '#c4704f', { rTop: 0.22 * s, tag: 'plant:' + id });
    const leaves = dyn(x, 0.42 * s, z);
    const leafMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
    const geos = [];
    const cols = ['#4f9a5b', '#5fae68', '#468a51'].map((c) => new THREE.Color(c));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * PI * 2;
      const g = new THREE.SphereGeometry(0.19 * s, 10, 8);
      g.translate(Math.cos(a) * 0.15 * s, (0.2 + (i % 3) * 0.14) * s, Math.sin(a) * 0.15 * s);
      geos.push(colorize(g, cols[i % 3]));
    }
    const top = new THREE.SphereGeometry(0.2 * s, 10, 8);
    top.translate(0, 0.62 * s, 0);
    geos.push(colorize(top, cols[1]));
    const mesh = new THREE.Mesh(mergeGeometries(geos), leafMat);
    mesh.castShadow = true;
    leaves.add(mesh);
    plants[id] = { leaves, leafMat, x, z, s };
  }

  const fxState = {};
  const fx = {};

  // =====================================================================
  // 卧室 x 0..5, z 0..4.5
  // =====================================================================
  box(1.1, 0.12, 3.0, 2.3, 0.1, 0.36, '#8a5a3b', { tag: 'bed' });
  for (const [x, z] of [[1.18, 0.2], [2.92, 0.2], [1.18, 2.22], [2.92, 2.22]]) cyl(x, z, 0, 0.1, 0.04, '#5a3a25');
  box(1.15, 0.25, 2.95, 2.27, 0.36, 0.56, '#f7f2ea', { tag: 'bed' });
  box(1.05, 0.06, 3.05, 0.24, 0, 1.15, '#7a4e32', { tag: 'bed' });
  box(1.05, 0.04, 3.05, 0.26, 1.15, 1.2, '#6a4129');
  const pillow = box(1.35, 0.3, 2.75, 0.72, -0.07, 0.07, '#ffffff', { parent: dyn() });
  // 被子：铺好 / 掀开 / 盖着 三种状态之间插值
  const duvet = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat('#6aa0d8'));
  duvet.castShadow = duvet.receiveShadow = true;
  group.add(duvet);
  const duvetFold = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat('#f7f2ea'));
  group.add(duvetFold);
  const DUVET = { made: [0.95, 0.63], folded: [1.55, 0.72], cover: [0.92, 0.9] };
  const duvetCur = [...DUVET.made];
  fxState.duvet = 'made';
  fx.duvet = (s) => { fxState.duvet = s; };

  box(0.45, 0.15, 1.0, 0.6, 0, 0.52, '#a0714f', { tag: 'nightL' });
  box(0.47, 0.6, 0.98, 0.61, 0.3, 0.32, '#7a5236', { cast: false });
  tableLamp(0.72, 0.37, 0.52);
  box(3.1, 0.15, 3.65, 0.6, 0, 0.52, '#a0714f', { tag: 'nightR' });
  box(3.12, 0.6, 3.63, 0.61, 0.3, 0.32, '#7a5236', { cast: false });
  tableLamp(3.4, 0.33, 0.52, false);
  box(3.15, 0.45, 3.32, 0.55, 0.52, 0.62, '#f2f2f2');                 // 闹钟
  const alarmMat = new THREE.MeshBasicMaterial({ color: '#ff6a4d' });
  box(3.17, 0.551, 3.3, 0.553, 0.54, 0.6, null, { material: alarmMat, cast: false });
  box(3.45, 0.42, 3.55, 0.56, 0.52, 0.53, '#2a2a2a');                 // 手机
  for (const [x0, x1, y0, y1, c] of [[1.4, 1.8, 1.4, 1.75, '#f2c14e'], [1.95, 2.35, 1.4, 1.9, '#7fb3c8'], [2.5, 2.9, 1.4, 1.75, '#e8a0a8']]) {
    box(x0, 0, x1, 0.03, y0, y1, '#ffffff', { cast: false });
    box(x0 + 0.04, 0.03, x1 - 0.04, 0.035, y0 + 0.04, y1 - 0.04, c, { cast: false });
  }
  // 窗帘
  box(0.08, 0.72, 0.12, 3.08, 2.42, 2.46, '#8a6b4a', { cast: false });
  const curtainMat = mat('#e7d3b0');
  const curtainPanels = [dyn(0.1, 0, 0.75), dyn(0.1, 0, 3.05)].map((g, i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.3, 1), curtainMat);
    m.position.set(0, 1.27, i === 0 ? 0.5 : -0.5);
    m.castShadow = true;
    g.add(m);
    return m;
  });
  let curtainCur = 0;

  // 梳妆台 + 镜子 + 凳子
  box(3.85, 0.1, 4.85, 0.55, 0.7, 0.75, '#f0e6d8', { tag: 'dresser' });
  box(3.9, 0.1, 4.8, 0.5, 0.55, 0.7, '#e7dccb', { tag: 'dresser' });
  for (const [x, z] of [[3.9, 0.15], [4.8, 0.15], [3.9, 0.5], [4.8, 0.5]]) box(x - 0.025, z - 0.025, x + 0.025, z + 0.025, 0, 0.55, '#d8c8b0', { tag: 'dresser' });
  box(4.05, 0, 4.65, 0.03, 0.95, 1.75, '#d9c3a0', { cast: false });
  box(4.1, 0.03, 4.6, 0.035, 1.0, 1.7, '#cfe6ee', { cast: false });
  cyl(4.0, 0.3, 0.75, 0.88, 0.03, '#e8a0a8');
  cyl(4.1, 0.25, 0.75, 0.85, 0.025, '#ffffff');
  cyl(4.7, 0.3, 0.75, 0.82, 0.05, '#c9a36b');
  cyl(4.35, 0.95, 0.38, 0.44, 0.19, '#e3b5a4', { tag: 'stool' });
  cyl(4.35, 0.95, 0, 0.38, 0.03, '#b08a6a', { tag: 'stool' });

  // 阅读椅 + 落地灯
  box(3.95, 2.4, 4.8, 3.25, 0.1, 0.44, '#8fae8b', { tag: 'readChair' });
  box(4.6, 2.4, 4.8, 3.25, 0.44, 1.0, '#7d9c79', { tag: 'readChair' });
  box(4.42, 2.57, 4.6, 3.08, 0.5, 0.92, '#a3c19f', { tag: 'readChair' });
  box(3.95, 2.4, 4.8, 2.55, 0.44, 0.64, '#7d9c79', { tag: 'readChair' });
  box(3.95, 3.1, 4.8, 3.25, 0.44, 0.64, '#7d9c79', { tag: 'readChair' });
  box(3.97, 2.57, 4.58, 3.08, 0.44, 0.5, '#a3c19f');
  cyl(4.6, 3.55, 0, 0.04, 0.15, '#3a3a3a', { tag: 'lampB' });
  cyl(4.6, 3.55, 0.04, 1.5, 0.02, '#3a3a3a');
  cyl(4.6, 3.55, 1.45, 1.75, 0.2, null, { rTop: 0.1, material: lamp(4.5, 1.45, 3.4), cast: false });

  // 衣柜（推拉门）
  box(0.15, 3.85, 2.3, 4.45, 0, 2.1, '#c99e72', { tag: 'wardrobe' });
  box(0.17, 3.83, 2.28, 3.85, 0.05, 2.05, '#3a2c22', { cast: false });
  ['#f2a65a', '#4f81bd', '#e8e8e8', '#9bbb59', '#c0504d', '#3d5a80', '#f2c14e', '#8064a2'].forEach((c, i) =>
    box(0.3 + i * 0.24, 3.86, 0.48 + i * 0.24, 3.9, 0.95, 1.85, c, { cast: false }));
  box(0.17, 3.86, 2.28, 3.9, 1.88, 1.9, '#9a9a9a', { cast: false });
  box(0.15, 3.78, 1.2, 3.82, 0.03, 2.07, '#d7b48a');                        // 左扇（固定）
  const wardrobeDoor = dyn(1.2, 0, 3.77);
  box(0, -0.02, 1.1, 0.02, 0.03, 2.07, '#d7b48a', { parent: wardrobeDoor });
  box(0.05, -0.04, 0.09, -0.02, 0.9, 1.3, '#8a6b4a', { parent: wardrobeDoor });
  let wardrobeCur = 0;
  fxState.wardrobe = false;
  fx.wardrobe = (on) => { fxState.wardrobe = on; };

  box(1.0, 2.5, 3.2, 3.45, 0, 0.012, '#e3a6a8', { cast: false });          // 床边地毯
  box(4.82, 1.25, 4.9, 1.85, 0.02, 1.75, '#d9c3a0', { tag: 'bedMirror' });  // 全身镜
  box(4.815, 1.3, 4.82, 1.8, 0.07, 1.7, '#cfe6ee', { cast: false });
  box(4.72, 1.3, 4.9, 1.36, 0, 0.03, '#b89a70', { tag: 'bedMirror' });
  box(4.72, 1.74, 4.9, 1.8, 0, 0.03, '#b89a70', { tag: 'bedMirror' });
  plant('bedroom', 2.55, 4.12, 0.8);

  // =====================================================================
  // 工作区 x 0..3.5, z 4.5..7.3
  // =====================================================================
  box(0.08, 5.0, 0.85, 6.75, 0.72, 0.76, '#d8c3a5', { tag: 'desk' });
  box(0.1, 5.02, 0.83, 5.06, 0, 0.72, '#c8b190', { tag: 'desk' });
  box(0.1, 6.69, 0.83, 6.73, 0, 0.72, '#c8b190', { tag: 'desk' });
  const monitorMat = new THREE.MeshBasicMaterial({ color: '#151515' });
  for (const z of [5.55, 6.2]) {
    cyl(0.3, z, 0.76, 0.95, 0.02, '#333333');
    box(0.26, z - 0.08, 0.36, z + 0.08, 0.76, 0.77, '#333333');
    box(0.28, z - 0.29, 0.33, z + 0.29, 0.92, 1.28, '#2a2a2a');
    box(0.331, z - 0.27, 0.335, z + 0.27, 0.94, 1.26, null, { material: monitorMat, cast: false });
  }
  box(0.48, 5.62, 0.63, 6.13, 0.76, 0.78, '#e8e8e8');
  box(0.52, 6.28, 0.6, 6.36, 0.76, 0.785, '#d0d0d0');
  cyl(0.65, 5.2, 0.76, 0.86, 0.04, '#e07a5f');
  cyl(0.2, 5.15, 0.76, 0.84, 0.045, '#d08a5c');
  cyl(0.2, 5.15, 0.84, 0.95, 0.025, '#4f9a5b');
  cyl(0.25, 6.55, 0.76, 0.78, 0.06, '#3a3a3a');
  cyl(0.25, 6.55, 0.78, 1.05, 0.012, '#3a3a3a');
  cyl(0.33, 6.55, 1.02, 1.12, 0.07, null, { rTop: 0.04, material: lamp(0.45, 1.15, 6.4, { intensity: 3, distance: 4 }), cast: false });
  box(0, 5.15, 0.03, 6.55, 1.3, 1.9, '#c9a36b', { cast: false });          // 软木板
  [['#f2c14e', 5.3, 1.7], ['#e8a0a8', 5.6, 1.5], ['#7fb3c8', 5.95, 1.72], ['#9bbb59', 6.3, 1.45], ['#ffffff', 6.1, 1.55]].forEach(([c, z, y]) =>
    box(0.03, z - 0.09, 0.035, z + 0.09, y - 0.09, y + 0.09, c, { cast: false }));
  // 人体工学椅（可拉出）
  const deskChair = dyn(1.2, 0, 5.85);
  box(-0.25, -0.25, 0.25, 0.25, 0.42, 0.48, '#56606e', { parent: deskChair, tag: 'deskChair' });
  box(0.2, -0.23, 0.27, 0.23, 0.48, 1.1, '#3d4450', { parent: deskChair, tag: 'deskChair' });
  box(-0.15, -0.27, 0.15, -0.23, 0.55, 0.6, '#3d4450', { parent: deskChair });
  box(-0.15, 0.23, 0.15, 0.27, 0.55, 0.6, '#3d4450', { parent: deskChair });
  cyl(0, 0, 0.08, 0.42, 0.03, '#2a2a2a', { parent: deskChair });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    const leg = box(-0.02, -0.13, 0.02, 0.13, 0.04, 0.08, '#2a2a2a', { parent: deskChair });
    leg.position.set(Math.sin(a) * 0.13, 0.06, Math.cos(a) * 0.13);
    leg.rotation.y = a;
  }
  grid.addFootprint(0.95, 5.6, 1.47, 6.1);
  fxState.deskChair = 0;
  // 书架
  box(2.75, 4.55, 3.85, 4.6, 0, 1.9, '#7a5a3e', { tag: 'bookshelf' });
  box(2.75, 4.55, 2.8, 4.95, 0, 1.9, '#8b6748', { tag: 'bookshelf' });
  box(3.8, 4.55, 3.85, 4.95, 0, 1.9, '#8b6748', { tag: 'bookshelf' });
  const shelfYs = [0, 0.46, 0.92, 1.38, 1.86];
  for (const y of shelfYs) box(2.75, 4.55, 3.85, 4.95, y, y + 0.04, '#8b6748', { tag: 'bookshelf' });
  const bookColors = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#4bacc6', '#e07a5f', '#3d5a80'];
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 80);
  {
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    let n = 0;
    for (let s = 0; s < 4; s++) {
      let x = 2.83;
      while (x < 3.7 && n < 80) {
        const w = 0.045 + Math.random() * 0.04, h = 0.26 + Math.random() * 0.14;
        m4.makeScale(w * 0.9, h, 0.28);
        m4.setPosition(x + w / 2, shelfYs[s] + 0.04 + h / 2, 4.77);
        books.setMatrixAt(n, m4);
        books.setColorAt(n, col.set(bookColors[n % bookColors.length]));
        n++;
        x += w;
      }
    }
    books.count = n;
  }
  books.castShadow = true;
  group.add(books);
  box(0.08, 6.85, 0.6, 7.3, 0, 0.6, '#e8e2d6', { tag: 'printer' });     // 打印机柜
  box(0.12, 6.9, 0.56, 7.25, 0.6, 0.78, '#d0d0d0');
  box(0.2, 6.95, 0.5, 7.2, 0.78, 0.79, '#ffffff', { cast: false });
  plant('living', 0.45, 7.62, 1.0);
  box(0, 7.3, 0.03, 7.95, 1.35, 1.95, '#5a4636', { cast: false });       // 挂画
  box(0.03, 7.35, 0.035, 7.9, 1.4, 1.9, '#9ec5d6', { cast: false });
  box(0.035, 7.4, 0.04, 7.85, 1.42, 1.6, '#7fbf6a', { cast: false });

  // =====================================================================
  // 客厅 x 0..6, z 7.3..12
  // =====================================================================
  box(0.08, 8.2, 0.55, 10.8, 0, 0.48, '#6b4f3a', { tag: 'tvConsole' });
  for (const z of [8.85, 9.5, 10.15]) box(0.55, z - 0.005, 0.56, z + 0.005, 0.05, 0.43, '#4f3a2a', { cast: false });
  box(0.2, 8.45, 0.3, 10.55, 0.75, 1.95, '#1a1a1a');
  const tvMat = new THREE.MeshBasicMaterial({ color: '#151515' });
  box(0.301, 8.5, 0.305, 10.5, 0.8, 1.9, null, { material: tvMat, cast: false });
  box(0.15, 9.15, 0.45, 9.55, 0.48, 0.55, '#f0f0f0');                   // 游戏机
  const consoleMat = new THREE.MeshBasicMaterial({ color: '#333333' });
  box(0.451, 9.2, 0.455, 9.5, 0.51, 0.52, null, { material: consoleMat, cast: false });
  for (const z of [8.37, 10.63]) {                                      // 音箱
    box(0.15, z - 0.12, 0.45, z + 0.12, 0.48, 0.82, '#2a2a2a');
    cyl(0.455, z, 0.59, 0.61, 0.06, '#555555', { rot: [0, 0, PI / 2] });
  }
  const clockGroup = dyn(0.03, 2.2, 9.5);
  cyl(0, 0, -0.02, 0.02, 0.22, '#ffffff', { seg: 24, parent: clockGroup, rot: [0, 0, PI / 2] });
  cyl(-0.015, 0, -0.015, 0.015, 0.245, '#5a4636', { seg: 24, parent: clockGroup, rot: [0, 0, PI / 2] });
  function hand(len, width, color) {
    const pivot = dyn(0.06, 2.2, 9.5);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, len, width), mat(color));
    m.position.y = len / 2 - 0.02;
    pivot.add(m);
    return pivot;
  }
  const hourHand = hand(0.12, 0.03, '#333333');
  const minuteHand = hand(0.18, 0.02, '#555555');

  // 唱片机
  box(0.08, 11.15, 0.65, 11.9, 0, 0.62, '#b0835e', { tag: 'record' });
  box(0.15, 11.25, 0.58, 11.8, 0.62, 0.68, '#3a3a3a');
  const platter = dyn(0.36, 0.68, 11.5);
  cyl(0, 0, 0, 0.02, 0.17, '#151515', { parent: platter });
  box(0.1, -0.01, 0.13, 0.01, 0.02, 0.025, '#d0504d', { parent: platter });
  cyl(0, 0, 0.02, 0.025, 0.05, '#d0504d', { parent: platter });
  box(0.5, 11.3, 0.54, 11.72, 0.7, 0.72, '#c0c0c0');
  box(0.1, 10.83, 0.55, 11.12, 0, 0.32, '#8b6748', { tag: 'crate' });
  ['#c0504d', '#4f81bd', '#f2c14e', '#222222', '#9bbb59'].forEach((c, i) => box(0.14 + i * 0.08, 10.86, 0.19 + i * 0.08, 11.09, 0.05, 0.36, c, { cast: false }));
  let recordSpin = 0;

  // L 型沙发
  const sofaC = '#6d8fb0', sofaD = '#5f7f9e', cushion = '#86a6c4';
  box(3.5, 8.0, 4.4, 10.9, 0.1, 0.42, sofaC, { tag: 'sofa' });
  box(4.12, 7.8, 4.4, 11.75, 0.42, 0.95, sofaD, { tag: 'sofa' });
  box(3.5, 7.8, 4.4, 8.0, 0.1, 0.64, sofaD, { tag: 'sofa' });
  box(2.3, 10.9, 4.4, 11.75, 0.1, 0.42, sofaC, { tag: 'sofa' });
  box(2.3, 11.47, 4.12, 11.75, 0.42, 0.95, sofaD, { tag: 'sofa' });
  box(2.1, 10.9, 2.3, 11.75, 0.1, 0.64, sofaD, { tag: 'sofa' });
  for (const [z0, z1] of [[8.02, 8.95], [8.99, 9.92], [9.96, 10.88]]) {
    box(3.52, z0, 4.1, z1, 0.42, 0.5, cushion);
    box(3.92, z0 + 0.03, 4.12, z1 - 0.03, 0.5, 0.88, cushion, { tag: 'sofa' });   // 靠垫
  }
  for (const [x0, x1] of [[2.32, 3.38], [3.42, 4.1]]) box(x0, 10.92, x1, 11.45, 0.42, 0.5, cushion);
  box(3.85, 8.1, 4.1, 8.5, 0.5, 0.82, '#f2d16b');
  box(2.5, 11.2, 2.9, 11.45, 0.5, 0.82, '#e8a0a8');
  box(3.6, 10.95, 4.05, 11.4, 0.5, 0.56, '#e3c49a');                    // 毯子
  for (const [x, z] of [[3.55, 7.85], [4.35, 7.85], [2.15, 11.7], [4.35, 11.7]]) cyl(x, z, 0, 0.1, 0.03, '#3a3a3a');
  box(1.15, 7.95, 3.4, 11.0, 0, 0.012, '#d9c2a0', { cast: false });      // 地毯
  box(1.35, 8.15, 3.2, 10.8, 0.012, 0.016, '#e8d8bc', { cast: false });
  // 茶几
  box(1.6, 8.75, 2.6, 10.15, 0.34, 0.4, '#c9a57a', { tag: 'coffeeTable' });
  box(1.65, 8.8, 2.55, 10.1, 0.1, 0.13, '#b8946a', { tag: 'coffeeTable' });
  for (const [x, z] of [[1.66, 8.81], [2.54, 8.81], [1.66, 10.09], [2.54, 10.09]]) box(x - 0.03, z - 0.03, x + 0.03, z + 0.03, 0, 0.34, '#8b6748', { tag: 'coffeeTable' });
  const remoteOnTable = box(2.1, 9.2, 2.18, 9.36, 0.4, 0.42, '#333333', { parent: dyn() });
  cyl(1.85, 9.7, 0.4, 0.5, 0.045, '#e07a5f');
  box(1.9, 8.9, 2.35, 9.15, 0.4, 0.42, '#7fb3c8');
  cyl(4.7, 7.8, 0, 0.04, 0.15, '#3a3a3a', { tag: 'lampL' });              // 落地灯
  cyl(4.7, 7.8, 0.04, 1.55, 0.02, '#3a3a3a');
  cyl(4.7, 7.8, 1.5, 1.8, 0.2, null, { rTop: 0.1, material: lamp(4.6, 1.5, 7.9, { intensity: 6, distance: 7 }), cast: false });
  // 吉他架
  box(4.6, 9.85, 4.9, 10.15, 0, 0.05, '#3a3a3a', { tag: 'guitarStand' });
  box(4.73, 9.97, 4.77, 10.03, 0.05, 0.55, '#3a3a3a');
  const standGuitar = dyn(4.75, 0, 10.0);
  {
    const m = mat('#c27c3e');
    cyl(0, 0, 0.22, 0.38, 0.16, null, { material: m, parent: standGuitar, rot: [0, 0, PI / 2] });
    cyl(0, 0, 0.42, 0.54, 0.12, null, { material: m, parent: standGuitar, rot: [0, 0, PI / 2] });
    box(-0.015, -0.025, 0.015, 0.025, 0.55, 1.0, '#5a3d2b', { parent: standGuitar });
  }
  plant('big', 5.05, 11.55, 1.25);
  ball(6.6, 0.24, 10.3, 0.45, '#e9b872', { scale: [1, 0.55, 1] });        // 懒人沙发
  colliders.push({ tag: 'beanbag', x0: 6.15, z0: 9.85, x1: 7.05, z1: 10.75, y0: 0, y1: 0.48 });
  grid.addFootprint(6.2, 9.9, 7.0, 10.7);

  // =====================================================================
  // 猫的东西：猫窝、猫爬架、饭碗水碗、猫砂盆
  // =====================================================================
  cyl(5.4, 8.6, 0, 0.12, 0.32, '#c98b6b', { tag: 'catBed' });
  cyl(5.4, 8.6, 0.06, 0.125, 0.25, '#f2e3cf', { cast: false });
  box(9.3, 11.3, 9.9, 11.9, 0, 0.06, '#c9a57a', { tag: 'catTree' });
  cyl(9.6, 11.6, 0.06, 1.4, 0.07, '#d8c6a0', { tag: 'catTree' });
  cyl(9.42, 11.55, 0.42, 0.47, 0.22, '#c9a57a', { tag: 'catTree' });
  cyl(9.72, 11.65, 0.86, 0.91, 0.22, '#c9a57a', { tag: 'catTree' });
  cyl(9.6, 11.6, 1.38, 1.45, 0.26, '#c9a57a', { tag: 'catTree' });
  cyl(9.6, 11.6, 1.45, 1.5, 0.21, '#f2e3cf', { cast: false });
  const treeWand = dyn(9.32, 0.47, 11.55);
  cyl(0.12, 0, 0, 0.35, 0.008, '#c9a36b', { parent: treeWand, rot: [0, 0, 1.2] });
  ball(0.28, 0.05, 0, 0.035, '#e86fa4', { parent: treeWand });
  cyl(11.12, 3.15, 0, 0.07, 0.1, '#e07a5f', { tag: 'bowls', rTop: 0.12 });
  cyl(11.42, 3.15, 0, 0.07, 0.1, '#4f81bd', { tag: 'bowls', rTop: 0.12 });
  const catFoodMesh = ball(11.12, 0.065, 3.15, 0.08, '#a8683c', { parent: dyn() });
  const catWaterMesh = cyl(11.42, 3.15, 0.05, 0.066, 0.095, '#8fd0f0', { parent: dyn(), cast: false });
  // 猫砂盆（空心，猫跳进去）
  box(9.15, 1.95, 9.75, 2.45, 0, 0.04, '#8fb3c8', { tag: 'litter' });
  for (const [x0, z0, x1, z1] of [[9.15, 1.95, 9.75, 1.99], [9.15, 2.41, 9.75, 2.45], [9.15, 1.99, 9.19, 2.41], [9.71, 1.99, 9.75, 2.41]]) box(x0, z0, x1, z1, 0.04, 0.22, '#8fb3c8', { tag: 'litterWall' });
  box(9.19, 1.99, 9.71, 2.41, 0.04, 0.1, '#e8dcc0', { cast: false });
  const litterClumps = dyn();
  for (let i = 0; i < 4; i++) ball(9.3 + i * 0.12, 0.11, 2.1 + (i % 2) * 0.15, 0.03, '#b8a888', { parent: litterClumps });

  // =====================================================================
  // 卫生间 x 5..9, z 0..4.2
  // =====================================================================
  box(5.35, 0.06, 5.95, 0.28, 0.38, 0.85, '#f7f7f7', { tag: 'toilet' });
  cyl(5.65, 0.55, 0, 0.4, 0.17, '#ffffff', { rTop: 0.21, tag: 'toilet' });
  cyl(5.65, 0.55, 0.4, 0.43, 0.22, '#e9e9e9', { tag: 'toilet' });
  box(5.45, 0.28, 5.85, 0.32, 0.43, 0.85, '#e9e9e9');
  box(6.05, 0, 6.17, 0.08, 0.68, 0.72, '#b8b8b8', { cast: false });       // 卷纸
  cyl(6.11, 0.1, 0.6, 0.7, 0.05, '#ffffff');
  // 洗手台 + 镜柜
  box(6.2, 0.06, 7.1, 0.58, 0, 0.82, '#e9dfd0', { tag: 'vanity' });
  box(6.18, 0.04, 7.12, 0.6, 0.82, 0.86, '#ffffff', { tag: 'vanity' });
  box(6.4, 0.18, 6.9, 0.5, 0.855, 0.862, '#cfe3ea', { cast: false });
  cyl(6.65, 0.12, 0.86, 1.0, 0.02, '#b8b8b8');
  box(6.63, 0.12, 6.67, 0.25, 0.97, 1.0, '#b8b8b8');
  box(6.3, 0, 7.0, 0.14, 1.05, 1.75, '#ece8e0', { cast: false });
  box(6.33, 0.14, 6.97, 0.145, 1.08, 1.72, '#cfe6ee', { cast: false });
  box(6.3, 0, 7.0, 0.08, 1.78, 1.83, null, { material: lamp(6.65, 1.7, 0.5), cast: false });
  cyl(6.98, 0.2, 0.86, 0.96, 0.035, '#9ec5d6');
  const cupBrush = cyl(6.98, 0.2, 0.92, 1.05, 0.008, '#ffffff', { parent: dyn() });
  cyl(6.35, 0.2, 0.86, 0.9, 0.04, '#f2c14e');
  const bathTapEm = particles.emitter('drip', [6.65, 0.95, 0.24], 30);
  // 淋浴间（后墙上装花洒）
  box(7.65, 0, 9 - T / 2, 1.4, 0, 0.06, '#e0e0e0', { tag: 'shower' });
  box(7.65, 1.38, 9 - T / 2, 1.42, 0.06, 2.0, null, { material: glassMat, cast: false, tag: 'showerGlass' });
  box(7.63, 0, 7.67, 0.6, 0.06, 2.0, null, { material: glassMat, cast: false, tag: 'showerGlass' });
  cyl(8.3, 0.04, 1.0, 2.05, 0.02, '#b8b8b8');
  box(8.28, 0.04, 8.32, 0.45, 2.03, 2.07, '#b8b8b8');
  cyl(8.3, 0.5, 1.98, 2.03, 0.14, '#c8c8c8');
  const showerWater = particles.emitter('water', [8.3, 1.95, 0.55], 90, { spread: [0.12, 0.02, 0.12] });
  const showerMist = particles.emitter('mist', [8.3, 1.2, 0.65], 4);
  box(7.15, 0, 7.6, 0.06, 1.2, 1.23, '#b8b8b8', { cast: false });       // 毛巾架
  box(7.18, 0.03, 7.57, 0.07, 0.75, 1.22, '#f3c4a8', { cast: false });
  // 浴缸（独立式）
  box(7.1, 2.85, 8.85, 3.75, 0, 0.1, '#ffffff', { tag: 'tub' });
  box(7.1, 2.85, 8.85, 2.93, 0.1, 0.55, '#ffffff', { tag: 'tub' });
  box(7.1, 3.67, 8.85, 3.75, 0.1, 0.55, '#ffffff', { tag: 'tub' });
  box(7.1, 2.93, 7.18, 3.67, 0.1, 0.55, '#ffffff', { tag: 'tub' });
  box(8.77, 2.93, 8.85, 3.67, 0.1, 0.55, '#ffffff', { tag: 'tub' });
  cyl(8.7, 3.3, 0.55, 0.75, 0.02, '#b8b8b8');
  box(8.55, 3.28, 8.72, 3.32, 0.72, 0.75, '#b8b8b8');
  const tubWaterMat = new THREE.MeshLambertMaterial({ color: '#9fd9f5', transparent: true, opacity: 0.6, depthWrite: false });
  const tubWater = box(7.18, 2.93, 8.77, 3.67, -1, 0, null, { material: tubWaterMat, parent: dyn(), cast: false });
  tubWater.position.y = 0.1;
  let tubLevel = 0;
  fxState.tubTarget = 0;
  const tubFillEm = particles.emitter('water', [8.57, 0.7, 3.3], 40, { spread: [0.02, 0.01, 0.02] });
  const tubBubbleEm = particles.emitter('bubble', [7.9, 0.45, 3.3], 5);
  box(7.4, 2.3, 8.4, 2.75, 0, 0.012, '#7fb3c8', { cast: false });       // 地垫
  box(5.3, 1.6, 5.65, 1.9, 0, 0.04, '#e8e8e8', { cast: false });       // 体重秤
  box(5.25, 3.5, 5.7, 3.95, 0, 0.45, '#d9b779', { tag: 'basket' });    // 脏衣篮
  const basketFill = box(5.29, 3.54, 5.66, 3.91, -1, 0, '#c8d6e5', { parent: dyn(), cast: false });

  // =====================================================================
  // 洗衣角 x 9..10.8, z 0..2.5
  // =====================================================================
  function machine(x0, tag) {
    box(x0, 0.08, x0 + 0.7, 0.72, 0, 0.86, '#f4f4f4', { tag });
    box(x0 + 0.05, 0.1, x0 + 0.65, 0.2, 0.86, 0.88, '#d8d8d8', { cast: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), mat('#c8c8c8'));
    ring.position.set(x0 + 0.35, 0.45, 0.73);
    staticGroup.add(ring);
    const drum = dyn(x0 + 0.35, 0.45, 0.722);
    cyl(0, 0, -0.005, 0.005, 0.19, '#9fb4c0', { parent: drum, rot: [PI / 2, 0, 0], cast: false });
    box(-0.02, 0.04, 0.02, 0.16, 0.006, 0.012, '#5f7380', { parent: drum, cast: false });
    return drum;
  }
  const washerDrum = machine(9.15, 'washer');
  machine(9.9, 'dryer');
  box(9.15, 0, 10.6, 0.3, 1.32, 1.36, '#c9a57a', { cast: false });
  ['#4bacc6', '#f2c14e', '#e8e8e8'].forEach((c, i) => cyl(9.35 + i * 0.25, 0.15, 1.36, 1.56, 0.06, c));
  box(10.62, 0.09, 10.88, 0.15, 0.02, 1.32, '#9fb4c0', { tag: 'iron' });  // 熨衣板（收起来立着）
  box(10.6, 0.08, 10.9, 0.16, 0, 0.03, '#7a8b99', { tag: 'iron' });
  box(10.66, 0.15, 10.84, 0.16, 0.3, 1.2, '#c8d6e5', { cast: false });
  box(9.95, 2.08, 10.35, 2.18, 0, 0.12, '#e0e0e0');                      // 扫地机器人底座

  // =====================================================================
  // 厨房 x 10.8..16, z 0..3.7
  // =====================================================================
  box(10.9, 0.08, 11.8, 0.82, 0, 1.95, '#e6edf1', { tag: 'fridge' });
  box(10.95, 0.8, 11.75, 0.821, 0.08, 1.88, '#fff6cf', { cast: false });
  const fridgeDoor = dyn(11.8, 0, 0.82);
  box(-0.9, 0, 0, 0.05, 0.02, 1.93, '#f4f8fa', { parent: fridgeDoor, tag: 'fridgeDoor' });
  box(-0.86, 0.05, -0.82, 0.09, 0.85, 1.45, '#9aa5ab', { parent: fridgeDoor });
  box(-0.9, 0.05, 0, 0.055, 1.28, 1.3, '#c8d0d4', { parent: fridgeDoor, cast: false });
  [['#e8577a', -0.5, 1.6], ['#f2c14e', -0.3, 1.5], ['#7fb3c8', -0.6, 1.1]].forEach(([c, x, y]) =>
    box(x - 0.04, 0.05, x + 0.04, 0.06, y - 0.04, y + 0.04, c, { parent: fridgeDoor, cast: false }));
  let fridgeCur = 0, fridgeVel = 0;
  fxState.fridge = false;
  fx.fridge = (on) => { fxState.fridge = on; };

  const counterC = '#7fa3a0';
  box(11.85, 0.08, 15.95, 0.72, 0, 0.86, counterC, { tag: 'counter' });
  box(11.83, 0.06, 15.97, 0.75, 0.86, 0.92, '#efe9df', { tag: 'counter' });
  for (const x of [12.62, 13.27, 13.5, 14.4, 15.15]) box(x - 0.005, 0.72, x + 0.005, 0.73, 0.06, 0.84, '#6a8b88', { cast: false });
  box(11.95, 0.2, 12.6, 0.62, 0.915, 0.922, '#b8c2c8', { cast: false });  // 水槽
  cyl(12.28, 0.14, 0.92, 1.2, 0.02, '#b8b8b8');
  box(12.26, 0.14, 12.3, 0.38, 1.17, 1.2, '#b8b8b8');
  const kTapEm = particles.emitter('drip', [12.28, 1.12, 0.37], 35);
  const sinkDishes = dyn();
  for (let i = 0; i < 4; i++) cyl(12.15 + (i % 2) * 0.25, 0.45 - (i > 1 ? 0.12 : 0), 0.93 + i * 0.02, 0.95 + i * 0.02, 0.1, i % 2 ? '#f5f0e6' : '#ffffff', { parent: sinkDishes });
  box(12.66, 0.2, 13.0, 0.6, 0.92, 0.94, '#c8c8c8');                     // 碗架
  for (let i = 0; i < 3; i++) box(12.7 + i * 0.1, 0.25, 12.72 + i * 0.1, 0.55, 0.94, 1.1, '#ffffff', { cast: false });
  box(13.05, 0.22, 13.45, 0.58, 0.92, 0.95, '#d9b779');                  // 砧板
  box(13.08, 0.62, 13.22, 0.7, 0.92, 1.06, '#5a3d2b');                   // 刀架
  cyl(13.33, 0.42, 0.95, 0.98, 0.05, '#e74c3c');
  // 洗碗机（台下，门向下翻开）
  const dwDoor = dyn(12.95, 0.06, 0.74);
  box(-0.32, 0, 0.32, 0.02, 0, 0.76, '#d8dde0', { parent: dwDoor, tag: 'dwDoor' });
  box(-0.25, 0.02, 0.25, 0.04, 0.68, 0.71, '#9aa5ab', { parent: dwDoor });
  const dwLight = new THREE.MeshBasicMaterial({ color: '#333333' });
  box(0.22, 0.021, 0.28, 0.025, 0.72, 0.74, null, { material: dwLight, parent: dwDoor, cast: false });
  box(12.65, 0.1, 13.25, 0.7, 0.07, 0.8, '#3a3f44', { cast: false });
  let dwCur = 0;
  fxState.dishwasherOpen = false;
  fx.dishwasherOpen = (on) => { fxState.dishwasherOpen = on; };
  // 炉灶 + 烤箱 + 油烟机
  box(13.55, 0.15, 14.35, 0.68, 0.92, 0.93, '#1f1f1f', { cast: false });
  const burnerMat = new THREE.MeshLambertMaterial({ color: '#3a1a10', emissive: new THREE.Color('#ff5a1f'), emissiveIntensity: 0 });
  burnerMat.userData.keep = true;
  for (const [x, z, r] of [[13.75, 0.3, 0.1], [14.15, 0.3, 0.08], [13.75, 0.55, 0.08], [14.15, 0.55, 0.1]]) cyl(x, z, 0.93, 0.935, r, null, { material: burnerMat, cast: false });
  const pan = dyn(13.75, 0.935, 0.55);
  cyl(0, 0, 0, 0.05, 0.14, '#3a3a3a', { parent: pan });
  box(0.12, -0.015, 0.34, 0.015, 0.03, 0.05, '#2a2a2a', { parent: pan });
  const panFood = ball(0, 0.05, 0, 0.1, '#f2c14e', { parent: pan, scale: [1, 0.3, 1] });
  box(13.58, 0.72, 14.32, 0.73, 0.15, 0.6, '#2a2a2a', { cast: false });
  const ovenMat = new THREE.MeshBasicMaterial({ color: '#2a2a2a' });
  box(13.7, 0.731, 14.2, 0.735, 0.25, 0.5, null, { material: ovenMat, cast: false });
  box(13.55, 0, 14.35, 0.5, 1.65, 1.85, '#c8ced2', { cast: false });
  box(13.8, 0, 14.1, 0.25, 1.85, 2.6, '#c8ced2', { cast: false });
  const stoveSteam = particles.emitter('steam', [13.75, 1.05, 0.55], 6);
  // 咖啡机 / 烧水壶
  box(14.55, 0.15, 14.9, 0.45, 0.92, 1.3, '#2f2f38');
  box(14.6, 0.45, 14.85, 0.47, 0.92, 0.98, '#555555', { cast: false });
  const coffeeMat = new THREE.MeshBasicMaterial({ color: '#333333' });
  box(14.82, 0.451, 14.87, 0.455, 1.2, 1.25, null, { material: coffeeMat, cast: false });
  const coffeeSteam = particles.emitter('steam', [14.72, 1.05, 0.5], 4);
  cyl(15.1, 0.35, 0.92, 1.12, 0.09, '#d8dde0', { rTop: 0.07 });
  box(15.08, 0.42, 15.12, 0.5, 1.05, 1.08, '#2a2a2a');
  // 吊柜、调料架、挂杆、窗台香草
  box(14.45, 0, 15.95, 0.36, 1.45, 2.2, counterC, { cast: false });
  box(15.195, 0.36, 15.205, 0.37, 1.5, 2.15, '#6a8b88', { cast: false });
  box(14.5, 0.06, 15.9, 0.3, 1.42, 1.45, null, { material: lamp(14.6, 1.5, 0.9, { intensity: 6 }), cast: false });
  box(13.05, 0, 13.45, 0.15, 1.35, 1.38, '#c9a57a', { cast: false });
  ['#c0504d', '#f2c14e', '#9bbb59', '#8b5a2b'].forEach((c, i) => cyl(13.1 + i * 0.1, 0.08, 1.38, 1.5, 0.035, c, { cast: false }));
  box(12.65, 0.03, 13.0, 0.05, 1.27, 1.29, '#b8b8b8', { cast: false });
  box(12.68, 0.04, 12.72, 0.06, 1.0, 1.27, '#5a5a5a', { cast: false });
  box(12.66, 0.04, 12.74, 0.06, 0.95, 1.02, '#5a5a5a', { cast: false });
  box(12.92, 0.04, 12.96, 0.06, 1.05, 1.27, '#5a5a5a', { cast: false });
  ['#5fae68', '#4f9a5b', '#6cb26b'].forEach((c, i) => {
    cyl(12.05 + i * 0.22, 0.06, 1.16, 1.25, 0.04, '#d08a5c', { cast: false });
    ball(12.05 + i * 0.22, 1.3, 0.06, 0.06, c);
  });
  // L 型台面 + 微波炉 + 电饭煲
  box(15.3, 0.75, 15.95, 2.4, 0, 0.86, counterC, { tag: 'counterR' });
  box(15.27, 0.75, 15.97, 2.42, 0.86, 0.92, '#efe9df', { tag: 'counterR' });
  box(15.4, 0.9, 15.92, 1.45, 0.92, 1.22, '#d8d8d8');
  box(15.39, 0.97, 15.4, 1.3, 0.97, 1.17, '#2a2a2a', { cast: false });
  cyl(15.62, 1.85, 0.92, 1.1, 0.12, '#f2f2f2');
  cyl(15.62, 1.85, 1.1, 1.13, 0.1, '#d8d8d8');
  // 垃圾桶（分类）
  box(15.42, 2.57, 15.93, 2.88, 0, 0.6, '#5aa469', { tag: 'trash' });
  box(15.42, 2.92, 15.93, 3.23, 0, 0.6, '#4f81bd', { tag: 'trash' });
  box(15.4, 2.55, 15.95, 3.25, 0.6, 0.63, '#3a3a3a');
  // 中岛 + 吧凳
  box(11.9, 2.3, 14.6, 3.15, 0, 0.88, counterC, { tag: 'island' });
  box(11.85, 2.25, 14.65, 3.4, 0.88, 0.93, '#efe9df', { tag: 'island' });
  cyl(12.6, 2.7, 0.93, 1.0, 0.16, '#c99a6b', { rTop: 0.2 });
  ball(12.55, 1.02, 2.68, 0.06, '#e74c3c'); ball(12.66, 1.02, 2.74, 0.06, '#f2c14e'); ball(12.6, 1.05, 2.62, 0.055, '#9bbb59');
  cyl(14.2, 2.7, 0.93, 1.15, 0.05, '#f0f0f0');
  ball(14.2, 1.22, 2.7, 0.08, '#e8a0a8');
  [12.45, 13.25, 14.05].forEach((x, i) => {
    cyl(x, 3.75, 0.58, 0.64, 0.17, '#4a4a4a', { tag: 'stool' + i });
    cyl(x, 3.75, 0, 0.58, 0.025, '#9a9a9a', { tag: 'stool' + i });
    cyl(x, 3.75, 0.25, 0.27, 0.13, '#9a9a9a', { seg: 12 });
    cyl(x, 3.75, 0, 0.02, 0.17, '#9a9a9a');
  });
  const islandMug = cyl(13.25, 2.95, 0.93, 1.02, 0.04, '#ffffff', { parent: dyn() });

  // =====================================================================
  // 餐厅 x 11.5..15.2, z 4.6..7.5
  // =====================================================================
  box(12.0, 5.4, 14.2, 6.5, 0.72, 0.76, '#c99a6b', { tag: 'table' });
  for (const [x, z] of [[12.08, 5.48], [14.12, 5.48], [12.08, 6.42], [14.12, 6.42]]) box(x - 0.04, z - 0.04, x + 0.04, z + 0.04, 0, 0.72, '#a3765a', { tag: 'table' });
  cyl(13.1, 5.95, 0.76, 0.95, 0.06, '#e8e2d6');
  for (const [dx, dz, c] of [[0, 0, '#e8577a'], [0.05, 0.03, '#f2c14e'], [-0.04, 0.04, '#ffffff']]) ball(13.1 + dx, 1.0, 5.95 + dz, 0.045, c);
  box(13.43, 5.95, 13.93, 6.3, 0.76, 0.765, '#e3c49a', { cast: false });
  function staticChair(x, z0, z1, backAtMax) {
    const tag = `chair${x}-${z0}`;
    box(x - 0.225, z0, x + 0.225, z1, 0.44, 0.49, '#a3765a', { tag });
    const bz = backAtMax ? [z1 - 0.07, z1] : [z0, z0 + 0.07];
    box(x - 0.225, bz[0], x + 0.225, bz[1], 0.49, 0.95, '#a3765a', { tag });
    for (const [dx, zz] of [[-0.19, z0 + 0.04], [0.19, z0 + 0.04], [-0.19, z1 - 0.04], [0.19, z1 - 0.04]]) box(x + dx - 0.02, zz - 0.02, x + dx + 0.02, zz + 0.02, 0, 0.44, '#8a6249', { tag });
  }
  staticChair(12.62, 4.85, 5.3, false);
  staticChair(13.68, 4.85, 5.3, false);
  staticChair(12.62, 6.62, 7.08, true);
  const diningChair = dyn(13.68, 0, 6.85);
  box(-0.225, -0.23, 0.225, 0.23, 0.44, 0.49, '#a3765a', { parent: diningChair, tag: 'diningChair' });
  box(-0.225, 0.16, 0.225, 0.23, 0.49, 0.95, '#a3765a', { parent: diningChair, tag: 'diningChair' });
  for (const [dx, dz] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) box(dx - 0.02, dz - 0.02, dx + 0.02, dz + 0.02, 0, 0.44, '#8a6249', { parent: diningChair, tag: 'diningChair' });
  grid.addFootprint(13.45, 6.62, 13.91, 7.63);
  fxState.diningChair = 0;
  const plate = dyn(13.68, 0.765, 6.12);
  cyl(0, 0, 0, 0.02, 0.15, '#ffffff', { parent: plate });
  const plateFood = dyn(0, 0.02, 0);
  plate.add(plateFood);
  ball(-0.04, 0.02, 0, 0.07, '#f2c14e', { parent: plateFood, scale: [1, 0.45, 1] });
  ball(0.05, 0.02, 0.03, 0.05, '#6fbf4b', { parent: plateFood, scale: [1, 0.5, 1] });
  ball(0.03, 0.02, -0.05, 0.045, '#d9534f', { parent: plateFood, scale: [1, 0.5, 1] });
  let foodLeft = 1;
  // 餐边柜
  box(15.35, 4.8, 15.95, 6.9, 0, 0.85, '#8b6748', { tag: 'sideboard' });
  for (const z of [5.5, 6.2]) box(15.34, z - 0.005, 15.35, z + 0.005, 0.05, 0.8, '#6a4f37', { cast: false });
  ['#2e5e3a', '#5a1f2a', '#2e5e3a'].forEach((c, i) => {
    cyl(15.6, 6.2 + i * 0.13, 0.85, 1.12, 0.035, c);
    cyl(15.6, 6.2 + i * 0.13, 1.12, 1.2, 0.012, c);
  });
  for (let i = 0; i < 3; i++) cyl(15.55 + (i % 2) * 0.12, 5.75 + i * 0.1, 0.85, 0.98, 0.03, null, { material: glassMat, cast: false });
  tableLamp(15.65, 5.15, 0.85, false);
  // 餐桌上方的吊灯
  cyl(13.1, 5.95, 2.57, 2.6, 0.08, '#3a3a3a', { cast: false });
  cyl(13.1, 5.95, 1.75, 2.57, 0.008, '#3a3a3a', { cast: false });
  cyl(13.1, 5.95, 1.55, 1.75, 0.28, null, { rTop: 0.06, material: lamp(13.1, 1.45, 5.95, { color: '#ffd9a0', intensity: 6, distance: 6 }), cast: false });

  // =====================================================================
  // 玄关 x 13.5..16, z 7.6..12
  // =====================================================================
  const entryDoor = dyn(HOUSE_W + 0.02, 0, 10.0);
  box(-0.04, -0.98, 0.04, 0, 0, FRONT_H, '#9c7049', { parent: entryDoor, tag: 'entryDoor' });
  box(-0.08, -0.85, -0.04, -0.8, 0.3, 0.35, '#c0c0c0', { parent: entryDoor });
  grid.addFootprint(15.95, 9.0, 16.1, 10.0);   // 门关着和开着时占的地方，猫和寻路都要绕开
  grid.addFootprint(15.0, 9.95, 16.0, 10.05);
  let doorCur = 0;
  fxState.door = false;
  fx.door = (on) => { fxState.door = on; };
  box(15.0, 9.0, 15.9, 10.0, 0.003, 0.012, '#8b6748', { cast: false });   // 门垫
  box(15.5, 10.25, 15.95, 11.85, 0, 0.95, '#efe6d8', { tag: 'shoeCab' });
  for (const z of [10.78, 11.32]) box(15.49, z - 0.005, 15.5, z + 0.005, 0.05, 0.9, '#d8ccb8', { cast: false });
  box(15.6, 10.4, 15.8, 10.55, 0.95, 0.97, '#c9a57a');
  box(15.65, 10.45, 15.72, 10.5, 0.97, 0.98, '#d4af37');
  tableLamp(15.72, 11.6, 0.95);
  box(14.15, 11.5, 15.25, 11.95, 0.38, 0.44, '#c9a57a', { tag: 'bench' });
  for (const x of [14.2, 15.2]) box(x - 0.03, 11.52, x + 0.03, 11.93, 0, 0.38, '#a3765a', { tag: 'bench' });
  const benchShoes = dyn();
  for (const dx of [-0.08, 0.08]) box(14.55 + dx - 0.06, 11.62, 14.55 + dx + 0.06, 11.88, 0, 0.08, '#3f4a59', { parent: benchShoes });
  const benchSlippers = dyn();
  for (const dx of [-0.08, 0.08]) box(14.95 + dx - 0.06, 11.6, 14.95 + dx + 0.06, 11.84, 0, 0.035, '#f0d9b5', { parent: benchSlippers });
  // 衣帽架
  cyl(15.55, 8.25, 0, 0.05, 0.22, '#3a3a3a', { tag: 'coatRack' });
  cyl(15.55, 8.25, 0.05, 1.8, 0.025, '#3a3a3a', { tag: 'coatRack' });
  for (const a of [0, 1.6, 3.2, 4.8]) {
    const hx = 15.55 + Math.sin(a) * 0.1, hz = 8.25 + Math.cos(a) * 0.1;
    box(hx - 0.015, hz - 0.015, hx + 0.015, hz + 0.015, 1.65, 1.7, '#3a3a3a', { cast: false });
  }
  const rackCoat = dyn(15.55, 0, 8.25);
  cyl(0.12, 0, 0.95, 1.62, 0.17, '#b5523b', { parent: rackCoat, rTop: 0.11 });
  cyl(-0.1, 0.08, 1.05, 1.5, 0.1, '#5b6770', { parent: rackCoat, rTop: 0.06 });
  ball(0, 1.83, 0, 0.12, '#e3c49a', { parent: rackCoat, scale: [1, 0.5, 1] });
  colliders.push({ tag: 'coatRack', x0: 15.3, z0: 8.0, x1: 15.8, z1: 8.5, y0: 0.95, y1: 1.65 });
  cyl(15.75, 8.85, 0, 0.45, 0.12, '#5a6b7a', { tag: 'umbrella' });
  cyl(15.72, 8.82, 0.45, 0.85, 0.015, '#c0504d');
  cyl(15.78, 8.88, 0.45, 0.8, 0.015, '#3d5a80');
  // 穿衣镜
  box(13.55, 11.82, 14.1, 11.95, 0.03, 1.75, '#d9c3a0', { tag: 'mirror' });
  box(13.6, 11.815, 14.05, 11.82, 0.08, 1.7, '#cfe6ee', { cast: false });
  box(13.5, 11.75, 14.15, 11.97, 0, 0.03, '#b89a70', { tag: 'mirror' });
  plant('entrance', 14.0, 8.9, 0.85);
  box(15.3, 11.72, 15.46, 11.95, 0, 1.05, '#7a8b99', { tag: 'vacuum' });    // 吸尘器
  box(15.28, 11.6, 15.48, 11.95, 0, 0.07, '#4a5560', { tag: 'vacuum' });

  // =====================================================================
  // 健身角 x 9..12.3, z 9..12
  // =====================================================================
  box(9.2, 9.3, 10.0, 11.3, 0, 0.18, '#2b2b2b', { tag: 'treadmill' });
  const beltTex = texture('belt', '#3a3a3a', '#2a2a2a');
  beltTex.repeat.set(1, 6);
  box(9.3, 9.35, 9.9, 11.1, 0.18, 0.19, null, { material: new THREE.MeshLambertMaterial({ map: beltTex }), cast: false });
  for (const x of [9.23, 9.97]) {
    box(x - 0.03, 11.05, x + 0.03, 11.15, 0.18, 1.2, '#4a4a4a', { tag: 'treadmillFront' });
    box(x - 0.02, 10.4, x + 0.02, 11.1, 0.98, 1.02, '#4a4a4a', { tag: 'treadmillRail' });
  }
  box(9.2, 10.95, 10.0, 11.2, 1.05, 1.3, '#3a3a3a', { tag: 'treadmillFront' });
  const tmScreen = new THREE.MeshBasicMaterial({ color: '#1a1a1a' });
  box(9.4, 10.94, 9.8, 10.95, 1.12, 1.24, null, { material: tmScreen, cast: false });
  box(10.4, 9.4, 11.1, 11.2, 0, 0.012, '#7fbfb0', { cast: false });       // 瑜伽垫
  box(11.4, 11.45, 12.3, 11.88, 0, 0.65, '#3a3a3a', { tag: 'dbRack' });
  const rackDumbbells = dyn();
  for (const [c, y] of [['#c0504d', 0.65], ['#4f81bd', 0.65]]) {
    const x = c === '#c0504d' ? 11.62 : 12.05;
    cyl(x, 11.66, y, y + 0.02, 0.015, '#555555', { parent: rackDumbbells });
    for (const dx of [-0.07, 0.07]) cyl(x + dx, 11.66, y, y + 0.08, 0.04, c, { parent: rackDumbbells });
  }
  ball(12.0, 0.3, 9.7, 0.3, '#e8a0a8');
  colliders.push({ tag: 'gymBall', x0: 11.7, z0: 9.4, x1: 12.3, z1: 10.0, y0: 0, y1: 0.6 });
  grid.addFootprint(11.7, 9.4, 12.3, 10.0);

  // =====================================================================
  // 阳台 x 5.6..11.2, z 12.15..14.3
  // =====================================================================
  for (const x of [8.8, 10.6]) {
    box(x - 0.03, 13.0, x + 0.03, 13.5, 0, 0.04, '#b8b8b8', { tag: 'dryRack' });
    box(x - 0.02, 13.22, x + 0.02, 13.28, 0, 1.45, '#b8b8b8', { tag: 'dryRack' });
  }
  for (const z of [13.08, 13.25, 13.42]) box(8.8, z - 0.01, 10.6, z + 0.01, 1.42, 1.44, '#d0d0d0', { cast: false });
  colliders.push({ tag: 'dryRack', x0: 8.8, z0: 13.0, x1: 10.6, z1: 13.5, y0: 1.38, y1: 1.46 });
  grid.addFootprint(8.8, 13.0, 10.6, 13.5);
  const rackClothes = dyn();
  ['#f2a65a', '#3d5a80', '#ffffff', '#9bbb59', '#e8a0a8', '#4bacc6', '#c8d6e5'].forEach((c, i) => {
    const x = 9.0 + i * 0.22, z = [13.08, 13.25, 13.42][i % 3];
    box(x - 0.09, z - 0.01, x + 0.09, z + 0.01, i % 2 === 0 ? 0.95 : 1.1, 1.42, c, { parent: rackClothes });
  });
  // 躺椅 + 小边桌
  box(6.1, 12.6, 6.7, 13.2, 0.1, 0.42, '#e8e2d6', { tag: 'balChair' });
  box(6.1, 12.6, 6.7, 12.7, 0.42, 0.95, '#d8d0c0', { tag: 'balChair' });
  box(6.12, 12.7, 6.68, 13.15, 0.42, 0.48, '#7fb3c8');
  for (const [x, z] of [[6.14, 12.64], [6.66, 12.64], [6.14, 13.16], [6.66, 13.16]]) box(x - 0.025, z - 0.025, x + 0.025, z + 0.025, 0, 0.1, '#8a8f94', { tag: 'balChair' });
  cyl(7.0, 12.75, 0, 0.5, 0.03, '#8a8f94', { tag: 'balTable' });
  cyl(7.0, 12.75, 0.5, 0.53, 0.2, '#e8e2d6', { tag: 'balTable' });
  const balMug = cyl(7.0, 12.75, 0.53, 0.62, 0.04, '#ffffff', { parent: dyn() });
  plant('bal1', 10.95, 12.45, 0.7);
  plant('bal2', 10.95, 12.88, 0.7);
  plant('balBig', 5.95, 13.72, 0.9);

  // ---------- 屋外 ----------
  function tree(x, z, s) {
    cyl(x, z, -0.3, 0.6 * s, 0.12 * s, '#7a5236');
    cyl(x, z, 0.5 * s, 2.0 * s, 0.9 * s, '#5c9e5f', { rTop: 0.02 });
    cyl(x, z, 1.4 * s, 2.7 * s, 0.65 * s, '#6cb26b', { rTop: 0.02 });
  }
  tree(-3, -2, 1.3); tree(19.5, 2, 1.1); tree(18.8, 13.8, 1.4); tree(-2.8, 13.5, 1.0);
  tree(6, -3.5, 1.2); tree(21.5, 6.5, 0.9); tree(-4.5, 6, 1.1); tree(13.5, -3.2, 1.0); tree(2.5, 15.5, 0.9);
  for (let i = 0; i < 6; i++) cyl(16.7 + i * 0.75, 9.5 + Math.sin(i) * 0.12, -0.3, -0.26, 0.28, '#d8d2c4', { cast: false });

  // =====================================================================
  // 交互点
  // kind: stand / sit(从正前方坐下) / sitBack(从后面坐上去) / chair(先拉椅子) / lie / crouch / tub / shower / treadmill
  // =====================================================================
  const spots = {};
  function spot(id, kind, use, rot, o = {}) {
    const [fx_, fz] = dirOf(rot);
    let approach = o.approach;
    if (!approach) {
      if (kind === 'sit') approach = [use[0] + fx_ * 0.55, use[2] + fz * 0.55];
      else if (kind === 'sitBack') approach = [use[0] - fx_ * 0.6, use[2] - fz * 0.6];
      else approach = [use[0] - fx_ * 0.25, use[2] - fz * 0.25];
    }
    spots[id] = { ...o, id, kind, use, rot, approach, tags: [id, ...(o.tags ?? [])] };
  }
  const seat = (top) => top + SIT_DROP;

  spot('bed', 'lie', [2.05, 0.56 + LIE_LIFT, 1.77], 0, { approach: [3.25, 1.4], edge: [2.78, seat(0.56), 1.4, R2], tags: ['nightR'] });
  spot('wardrobe', 'stand', [1.75, 0, 3.45], 0, { tags: ['wardrobe'] });
  spot('curtain', 'stand', [0.5, 0, 1.9], -R2);
  spot('dresser', 'sitBack', [4.35, seat(0.44), 0.98], PI, { tags: ['stool', 'dresser'] });
  spot('readChair', 'sit', [4.2, seat(0.5), 2.825], -R2);
  spot('desk', 'chair', [1.375, seat(0.48), 5.85], -R2, {
    approach: [1.75, 5.05], chair: { name: 'deskChair', from: [1.2, 5.85], out: [0.5, 0], tuck: 0.35 }, front: [1.28, 5.85], tags: ['deskChair', 'desk'],
  });
  spot('bookshelf', 'stand', [3.3, 0, 5.3], PI);
  spot('record', 'stand', [0.98, 0, 11.5], -R2);
  spot('sofaTV', 'sit', [3.76, seat(0.5), 9.45], -R2, { tags: ['sofa'] });
  spot('sofaGuitar', 'sit', [3.76, seat(0.5), 10.4], -R2, { tags: ['sofa'] });
  spot('guitarStand', 'stand', [5.2, 0, 10.0], -R2);
  spot('toilet', 'sit', [5.65, seat(0.43), 0.62], 0);
  spot('vanity', 'stand', [6.65, 0, 0.93], PI);
  spot('shower', 'shower', [8.3, 0.06, 0.72], 0, { approach: [7.3, 1.0], via: [7.95, 1.0], tags: ['showerGlass'] });
  spot('tub', 'tub', [7.52, 0.1 + 0.06 - 0.55, 3.3], R2, { approach: [7.95, 2.35], inside: [7.95, 0.1, 3.3] });
  spot('tubTap', 'stand', [8.5, 0, 2.38], PI, { tags: ['tub'] });
  spot('basket', 'crouch', [5.48, 0, 3.05], 0);
  spot('washer', 'crouch', [9.58, 0, 1.2], PI);
  spot('litter', 'crouch', [9.45, 0, 2.85], PI, { tags: ['litterWall'] });
  spot('fridge', 'stand', [11.3, 0, 1.12], PI, { approach: [11.25, 2.0], door: 'fridge', tags: ['fridgeDoor'] });
  spot('sink', 'stand', [12.28, 0, 1.03], PI, { tags: ['counter', 'dwDoor'] });
  spot('chop', 'stand', [13.25, 0, 1.03], PI, { tags: ['counter', 'dwDoor'] });
  spot('stove', 'stand', [13.95, 0, 1.03], PI, { tags: ['counter', 'dwDoor'] });
  spot('coffee', 'stand', [14.72, 0, 1.03], PI, { tags: ['counter'] });
  spot('dishwasher', 'crouch', [12.95, 0, 1.62], PI, { approach: [12.95, 1.88], door: 'dishwasherOpen', tags: ['counter', 'dwDoor'] });
  spot('stool', 'sitBack', [13.25, seat(0.64), 3.72], PI, { tags: ['stool1', 'island'] });
  spot('dining', 'chair', [13.68, seat(0.49), 7.08], PI, {
    approach: [14.55, 6.85], chair: { name: 'diningChair', from: [13.68, 6.85], out: [0, 0.55], tuck: 0.45 }, front: [13.68, 6.85], tags: ['diningChair', 'table'],
  });
  spot('catFood', 'stand', [11.55, 0, 2.62], R2, { tags: ['island'] });
  spot('catBowls', 'crouch', [11.27, 0, 3.72], PI, { tags: ['bowls'] });
  spot('trash', 'stand', [15.08, 0, 2.9], R2, { approach: [15.05, 3.55] });
  spot('bench', 'sit', [14.7, seat(0.44), 11.68], PI);
  spot('coatRack', 'stand', [15.05, 0, 8.25], R2);
  spot('mirror', 'stand', [13.82, 0, 11.25], 0);
  spot('door', 'stand', [15.45, 0, 9.5], R2, { approach: [14.7, 9.5], outside: [19.8, 9.5], tags: [] });
  spot('catTree', 'stand', [8.75, 0, 11.55], R2);
  spot('playArea', 'stand', [7.8, 0, 9.0], 0);
  spot('treadmill', 'treadmill', [9.6, 0.19, 9.95], 0, { approach: [9.6, 8.85] });
  spot('yoga', 'stand', [10.75, 0.012, 10.3], 0);
  spot('dumbbells', 'stand', [11.85, 0, 11.05], 0, { tags: ['dbRack'] });
  spot('dryRack', 'stand', [9.7, 0, 13.85], PI, { approach: [9.7, 13.85] });
  spot('balChair', 'sit', [6.4, seat(0.48), 12.95], 0);
  spot('lookout', 'stand', [8.0, 0, 13.92], 0, { approach: [8.0, 13.6], tags: ['railing'] });
  spot('plant:bedroom', 'stand', [3.05, 0, 4.0], -R2);
  spot('plant:living', 'stand', [1.05, 0, 7.62], -R2);
  spot('plant:big', 'stand', [5.65, 0, 11.4], -R2);
  spot('plant:entrance', 'stand', [13.45, 0, 8.9], R2);
  spot('plant:bal1', 'stand', [10.45, 0, 12.52], R2, { approach: [10.3, 12.52], tags: ['plant:bal2'] });
  spot('plant:bal2', 'stand', [10.45, 0, 12.62], R2, { approach: [10.3, 12.62], tags: ['plant:bal1'] });
  spot('plant:balBig', 'stand', [6.55, 0, 13.72], -R2, { approach: [6.8, 13.72] });

  // 猫的点位：jump=需要跳上去，via=中间要跳的平台
  const catSpots = {
    catBed: { pos: [5.4, 0.125, 8.6], approach: [5.4, 9.3], pose: 'curl', tags: ['catBed'] },
    beanbag: { pos: [6.6, 0.47, 10.3], approach: [6.6, 11.05], pose: 'curl', jump: true, tags: ['beanbag'] },
    treeTop: { pos: [9.6, 1.5, 11.6], approach: [8.72, 11.6], pose: 'loaf', jump: true, via: [[9.42, 0.47, 11.55], [9.72, 0.91, 11.65]], tags: ['catTree'] },
    sofaSide: { pos: [3.7, 0.5, 8.78], approach: [3.05, 8.6], rot: -R2, pose: 'loaf', jump: true, tags: ['sofa'] },
    sofaNap: { pos: [3.0, 0.5, 11.15], approach: [3.0, 10.45], pose: 'curl', jump: true, tags: ['sofa'] },
    bedFoot: { pos: [2.05, 0.6, 2.05], approach: [2.05, 2.75], pose: 'curl', jump: true, tags: ['bed'] },
    bedDay: { pos: [1.6, 0.58, 1.3], approach: [3.3, 1.5], pose: 'curl', jump: true, tags: ['bed'] },
    readChair: { pos: [4.15, 0.5, 2.82], approach: [3.6, 2.82], pose: 'curl', jump: true, tags: ['readChair'] },
    food: { pos: [11.12, 0, 3.42], approach: [11.12, 3.8], rot: PI, pose: 'eat', tags: ['bowls'] },
    water: { pos: [11.42, 0, 3.42], approach: [11.42, 3.8], rot: PI, pose: 'eat', tags: ['bowls'] },
    litter: { pos: [9.45, 0.1, 2.2], approach: [9.45, 2.85], rot: 0, pose: 'sit', jump: true, tags: ['litter', 'litterWall'] },
    sunny: { pos: [8.0, 0, 13.4], approach: [8.0, 12.9], pose: 'loaf' },
    window: { pos: [0.55, 0, 2.8], approach: [0.98, 2.8], rot: -R2, pose: 'sit' },
    door: { pos: [14.75, 0, 9.35], approach: [14.45, 9.35], rot: R2, pose: 'sit', tags: [] },
    scratch: { pos: [9.22, 0, 11.6], approach: [8.72, 11.6], rot: R2, pose: 'scratch', tags: ['catTree'] },
  };

  for (const [k, v] of Object.entries(catSpots)) { v.id = k; v.tags ??= []; }

  // =====================================================================
  // 世界状态（跟物件显示联动）
  // =====================================================================
  const state = {
    curtainsClosed: false,
    dishes: 0,
    laundry: { dirty: 0.4, stage: 'idle', timer: 0 },
    plants: Object.fromEntries(Object.keys(plants).map((k) => [k, 0.55 + Math.random() * 0.4])),
    stock: 7,
    trash: 0.3,
    catFood: 0.6,
    catWater: 0.8,
    litter: 1,
    dishwasherTimer: 0,
    washerTimer: 0,
    recordUntil: -1,
    remoteTaken: false,
    guitarTaken: false,
    dumbbellsTaken: false,
    wandTaken: false,
    coatTaken: false,
    toothbrushTaken: false,
    mugAt: null,
    foodPlate: false,
  };

  Object.assign(fx, {
    tv: (on) => { fxState.tv = on; },
    tvGame: (on) => { fxState.tvGame = on; },
    monitor: (on) => { fxState.monitor = on; },
    stove: (on) => { fxState.stove = on; stoveSteam.on = on; },
    coffee: (on) => { fxState.coffee = on; coffeeSteam.on = on; },
    shower: (on) => { showerWater.on = on; showerMist.on = on; },
    bathTap: (on) => { bathTapEm.on = on; },
    kTap: (on) => { kTapEm.on = on; },
    tubFill: (on) => { tubFillEm.on = on; if (on) fxState.tubTarget = 0.33; },
    bath: (on) => { tubBubbleEm.on = on; if (!on) fxState.tubTarget = 0; },
    treadmill: (on) => { fxState.treadmill = on; },
    plate: (on) => { state.foodPlate = on; if (on) foodLeft = 1; },
    eating: (on) => { fxState.eating = on; },
    pillow: (on) => { fxState.pillow = on; },
  });
  for (const k of ['tv', 'tvGame', 'monitor', 'stove', 'coffee', 'treadmill', 'eating', 'pillow']) fxState[k] = false;

  const recordNotes = [particles.emitter('note', [0.35, 0.95, 8.37], 0.6), particles.emitter('note2', [0.35, 0.95, 10.63], 0.5)];
  const tvLight = new THREE.PointLight('#8fb8ff', 0, 6, 1.6);
  tvLight.position.set(1.0, 1.3, 9.5);
  group.add(tvLight);

  // ---------- 每帧 ----------
  let t = 0, tvTimer = 0;
  const tvColor = new THREE.Color();
  const sm = (cur, target, dt, rate = 5) => cur + (target - cur) * Math.min(1, dt * rate);

  function update(dt, gameMin, hour, opts) {
    const { lightsOn, sky, minutes } = opts;
    t += dt;
    skyMat.color.copy(sky);

    if (gameMin > 0) {
      for (const k of Object.keys(state.plants)) state.plants[k] = Math.max(0, state.plants[k] - (gameMin / 1440) * 0.28);
      if (state.washerTimer > 0) {
        state.washerTimer -= gameMin;
        if (state.washerTimer <= 0) state.laundry.stage = 'washed';
      }
      if (state.laundry.stage === 'drying') {
        state.laundry.timer -= gameMin;
        if (state.laundry.timer <= 0) state.laundry.stage = 'dry';
      }
      if (state.dishwasherTimer > 0) state.dishwasherTimer -= gameMin;
      state.laundry.dirty = Math.min(1, state.laundry.dirty + (gameMin / 1440) * 0.35);
    }
    const recordOn = minutes < state.recordUntil;

    for (const l of lamps) {
      l.level = sm(l.level, lightsOn ? 1 : 0, dt, 4);
      l.light.intensity = l.intensity * l.level;
      l.material.emissiveIntensity = 0.9 * l.level;
    }
    alarmMat.color.set(lightsOn || hour < 7 ? '#ff6a4d' : '#7a3a30');

    // 门、椅子、被子、窗帘
    // 冰箱门：弹簧阻尼，开到头会轻轻回弹
    const fTarget = fxState.fridge ? 1.75 : 0;
    fridgeVel += ((fTarget - fridgeCur) * 55 - fridgeVel * 9) * dt;
    fridgeCur = Math.max(0, fridgeCur + fridgeVel * dt);
    if (dt > 0.2) { fridgeCur = fTarget; fridgeVel = 0; }
    fridgeDoor.rotation.y = -fridgeCur;
    // 推拉门：有人或猫靠近就打开
    const near = (opts.movers ?? []).some((p) => Math.abs(p.x - 7.4) < 1.3 && Math.abs(p.z - 12.05) < 1.3);
    balDoorCur = sm(balDoorCur, near ? 1 : 0, dt, 4);
    for (const d of balDoors) d.g.position.x = d.x0 + d.slide * balDoorCur;
    wardrobeCur = sm(wardrobeCur, fxState.wardrobe ? 1 : 0, dt, 4);
    wardrobeDoor.position.x = 1.2 - wardrobeCur * 1.0;
    dwCur = sm(dwCur, fxState.dishwasherOpen ? 1 : 0, dt, 4);
    dwDoor.rotation.x = dwCur * (PI / 2 - 0.05);
    dwLight.color.set(state.dishwasherTimer > 0 ? '#3fd16b' : '#333333');
    doorCur = sm(doorCur, fxState.door ? 1 : 0, dt, 3.5);
    entryDoor.rotation.y = doorCur * (PI / 2);
    for (const [name, obj, sp] of [['deskChair', deskChair, spots.desk], ['diningChair', diningChair, spots.dining]]) {
      const k = fxState[name];
      obj.position.x = sp.chair.from[0] + sp.chair.out[0] * k;
      obj.position.z = sp.chair.from[1] + sp.chair.out[1] * k;
    }
    const d = DUVET[fxState.duvet];
    duvetCur[0] = sm(duvetCur[0], d[0], dt, 3);
    duvetCur[1] = sm(duvetCur[1], d[1], dt, 3);
    const [z0, top] = duvetCur;
    duvet.scale.set(1.92, top - 0.5, 2.31 - z0);
    duvet.position.set(2.05, (top + 0.5) / 2, (z0 + 2.31) / 2);
    duvetFold.scale.set(1.88, 0.03, 0.18);
    duvetFold.position.set(2.05, top + 0.006, z0 + 0.09);
    pillow.scale.y = sm(pillow.scale.y, fxState.pillow ? 0.5 : 1, dt, 4);
    pillow.position.y = 0.56 + 0.07 * pillow.scale.y;
    curtainCur = sm(curtainCur, state.curtainsClosed ? 1 : 0, dt, 2.5);
    const w = 0.28 + curtainCur * 0.9;
    curtainPanels.forEach((m, i) => {
      m.scale.z = w;
      m.position.z = (i === 0 ? 1 : -1) * w / 2;
    });

    // 电器
    burnerMat.emissiveIntensity = fxState.stove ? 0.8 + Math.sin(t * 20) * 0.15 : 0;
    panFood.visible = fxState.stove;
    coffeeMat.color.set(fxState.coffee ? (Math.sin(t * 6) > 0 ? '#ff9a3c' : '#c76a1c') : '#333333');
    ovenMat.color.set(fxState.stove ? '#5a2a10' : '#2a2a2a');
    const tvOn = fxState.tv || fxState.tvGame;
    if (tvOn) {
      tvTimer -= dt;
      if (tvTimer <= 0) {
        tvTimer = fxState.tvGame ? 0.25 + Math.random() * 0.4 : 0.5 + Math.random() * 1.3;
        tvColor.setHSL(fxState.tvGame ? 0.5 + Math.random() * 0.4 : Math.random(), fxState.tvGame ? 0.8 : 0.55, 0.45 + Math.random() * 0.15);
      }
      tvMat.color.copy(tvColor);
      tvLight.color.copy(tvColor);
      tvLight.intensity = 2.5;
    } else {
      tvMat.color.set('#151515');
      tvLight.intensity = 0;
    }
    consoleMat.color.set(fxState.tvGame ? '#4aa3ff' : '#333333');
    monitorMat.color.set(fxState.monitor ? (Math.sin(t * 2) > 0.95 ? '#7aa8e8' : '#5b8fd6') : '#151515');
    tmScreen.color.set(fxState.treadmill ? '#3fd16b' : '#1a1a1a');
    if (fxState.treadmill) beltTex.offset.y = (beltTex.offset.y + dt * 2.2) % 1;
    if (recordOn) recordSpin += dt * 3.5;
    platter.rotation.y = recordSpin;
    recordNotes.forEach((e) => { e.on = recordOn; });
    if (state.washerTimer > 0) washerDrum.rotation.z += dt * 6;

    // 物件状态
    tubLevel = sm(tubLevel, fxState.tubTarget, dt, 0.6);
    tubWater.scale.y = Math.max(0.001, tubLevel);
    tubWater.position.y = 0.1 + tubLevel / 2;
    tubWater.visible = tubLevel > 0.01;
    sinkDishes.children.forEach((m, i) => { m.visible = i < state.dishes; });
    plate.visible = state.foodPlate;
    if (fxState.eating) foodLeft = Math.max(0.15, foodLeft - dt * 0.012);
    plateFood.scale.setScalar(foodLeft);
    rackClothes.visible = state.laundry.stage === 'drying' || state.laundry.stage === 'dry';
    const fill = 0.05 + state.laundry.dirty * 0.38;
    basketFill.scale.y = fill;
    basketFill.position.y = 0.05 + fill / 2;
    catFoodMesh.visible = state.catFood > 0.05;
    catFoodMesh.scale.set(state.catFood, 0.35 * state.catFood, state.catFood);
    catWaterMesh.visible = state.catWater > 0.05;
    litterClumps.children.forEach((m, i) => { m.visible = i < state.litter; });
    standGuitar.visible = !state.guitarTaken;
    rackDumbbells.visible = !state.dumbbellsTaken;
    treeWand.visible = !state.wandTaken;
    rackCoat.visible = !state.coatTaken;
    benchShoes.visible = !state.coatTaken;
    benchSlippers.visible = state.coatTaken;
    remoteOnTable.visible = !state.remoteTaken;
    cupBrush.visible = !state.toothbrushTaken;
    islandMug.visible = state.mugAt === 'island';
    balMug.visible = state.mugAt === 'balcony';
    for (const [id, p] of Object.entries(plants)) {
      const wilt = Math.min(1, Math.max(0, (0.35 - state.plants[id]) / 0.35));
      p.leaves.scale.set(1 + wilt * 0.15, 1 - wilt * 0.4, 1 + wilt * 0.15);
      p.leafMat.color.setRGB(1, 1 - wilt * 0.1, 1 - wilt * 0.6);
    }

    hourHand.rotation.x = -((hour % 12) / 12) * PI * 2;
    minuteHand.rotation.x = -(hour % 1) * PI * 2;
  }

  function setWallsHigh(high) {
    for (const w of walls) if (w.kind === 'inner') w.mesh.scale.y = high ? INNER_HIGH : INNER_LOW;
  }
  function setFx(name, on) { fx[name]?.(on); }
  function setChair(name, k) { fxState[name] = k; }

  // 一起运动的零件合并
  for (const d of balDoors) bakeGroup(d.g, d.g.children.filter((m) => m.material === glassMat));
  for (const g of [deskChair, diningChair, fridgeDoor, entryDoor, wardrobeDoor, standGuitar, rackDumbbells, rackClothes,
    benchShoes, benchSlippers, rackCoat, treeWand, clockGroup, platter, plateFood, dwDoor]) bakeGroup(g);
  bakeGroup(pan, [panFood]);
  for (const g of [sinkDishes, litterClumps, rackClothes, benchSlippers, benchShoes, plateFood]) g.traverse((o) => { o.castShadow = false; });

  mergeStatic(staticGroup, group);

  // 猫的头比身体中心往前伸得多，用余量更大的网格寻路
  const catGrid = grid.withRadius(0.42);
  return { group, grid, catGrid, spots, catSpots, state, colliders, plants, update, setWallsHigh, setFx, setChair };
}

function colorize(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// 合并静态网格：普通纯色材质全部合成一个顶点色网格，其它材质按材质合并，大幅减少 draw call
function mergeStatic(staticGroup, target) {
  staticGroup.updateMatrixWorld(true);
  const buckets = new Map();
  for (const o of [...staticGroup.children]) {
    if (!o.isMesh) continue;
    const m = o.material;
    const plain = m.isMeshLambertMaterial && !m.map && !m.transparent && !m.vertexColors && !m.userData.keep &&
      (!m.emissive || m.emissive.getHex() === 0);
    const key = (plain ? 'vc' : m.uuid) + (o.castShadow ? '|c' : '|n');
    if (!buckets.has(key)) buckets.set(key, { material: plain ? null : m, cast: o.castShadow, geos: [] });
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (plain) colorize(g, m.color);
    buckets.get(key).geos.push(g);
  }
  staticGroup.clear();
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(b.geos), b.material ?? vcMat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = true;
    target.add(mesh);
  }
}
