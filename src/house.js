import * as THREE from 'three';
import { Grid } from './grid.js';

// 一室一厅的小屋：卧室(左上) / 卫生间(中上) / 厨房(右上) / 客厅+餐桌(下)。
// 坐标单位为米，x: 0..12，z: 0..9，镜头从 +x +z 方向看过来，所以前墙和右墙做成矮墙。

export const HOUSE_W = 12;
export const HOUSE_D = 9;
const T = 0.15;
const OUTER_H = 2.6;
const FRONT_H = 0.45;
const INNER_LOW = 0.9;
const INNER_HIGH = 2.6;
const R = Math.PI;

export function buildHouse() {
  const group = new THREE.Group();
  const grid = new Grid(HOUSE_W, HOUSE_D, 0.5);

  const matCache = new Map();
  const mat = (color) => {
    if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
    return matCache.get(color);
  };

  function box(x0, z0, x1, z1, y0, y1, color, opt = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), opt.material ?? mat(color));
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? group).add(mesh);
    if (opt.block) grid.blockRect(x0, z0, x1, z1, opt.pad ?? 0.2);
    return mesh;
  }

  function cyl(x, z, y0, y1, r, color, opt = {}) {
    const geo = new THREE.CylinderGeometry(opt.rTop ?? r, r, y1 - y0, opt.seg ?? 16, 1, opt.open ?? false);
    const mesh = new THREE.Mesh(geo, opt.material ?? mat(color));
    mesh.position.set(x, (y0 + y1) / 2, z);
    mesh.castShadow = opt.cast ?? true;
    mesh.receiveShadow = true;
    (opt.parent ?? group).add(mesh);
    return mesh;
  }

  function ball(x, y, z, r, color, opt = {}) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), opt.material ?? mat(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    (opt.parent ?? group).add(mesh);
    return mesh;
  }

  // ---------- 地面与地板 ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), mat('#9cc98a'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  group.add(ground);
  box(-0.3, -0.3, HOUSE_W + 0.3, HOUSE_D + 0.3, -0.3, -0.06, '#cdbfa6', { cast: false });

  function floorTexture(kind, base, line) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = base;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = line;
    g.lineWidth = 3;
    if (kind === 'tile') {
      g.strokeRect(0, 0, 128, 128);
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

  function floor(x0, z0, x1, z1, kind, base, line, size) {
    const tex = floorTexture(kind, base, line);
    tex.repeat.set((x1 - x0) / size, (z1 - z0) / size);
    box(x0, z0, x1, z1, -0.06, 0, null, { material: new THREE.MeshLambertMaterial({ map: tex }), cast: false });
  }
  floor(0, 0, 5, 4, 'plank', '#dcb68e', '#c39c74', 1.6);   // 卧室
  floor(5, 0, 8, 4, 'tile', '#dbedf2', '#b9d1d8', 0.5);    // 卫生间
  floor(8, 0, 12, 4, 'tile', '#f1e7d3', '#d8c9ab', 0.6);   // 厨房
  floor(0, 4, 12, 9, 'plank', '#c99c70', '#ad8156', 2.0);  // 客厅

  // ---------- 墙 ----------
  const wallSide = new THREE.MeshLambertMaterial({ color: '#f4ecdc' });
  const wallTop = new THREE.MeshLambertMaterial({ color: '#6f6355' });
  const walls = [];
  function wall(x0, z0, x1, z1, kind) {
    const geo = new THREE.BoxGeometry(x1 - x0, 1, z1 - z0);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geo, [wallSide, wallSide, wallTop, wallSide, wallSide, wallSide]);
    mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    mesh.scale.y = kind === 'outer' ? OUTER_H : kind === 'front' ? FRONT_H : INNER_LOW;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    walls.push({ mesh, kind });
    grid.blockRect(x0, z0, x1, z1, 0.2);
  }
  wall(-T, -T, HOUSE_W + T, 0, 'outer');          // 后墙
  wall(-T, 0, 0, HOUSE_D + T, 'outer');           // 左墙
  wall(-T, HOUSE_D, 5.6, HOUSE_D + T, 'front');   // 前墙（中间留大门）
  wall(6.6, HOUSE_D, HOUSE_W + T, HOUSE_D + T, 'front');
  wall(HOUSE_W, -T, HOUSE_W + T, HOUSE_D + T, 'front'); // 右墙
  const zi = 4 - T / 2, zo = 4 + T / 2;
  wall(0, zi, 3.5, zo, 'inner');                  // 卧室/客厅，门在 3.5..4.5
  wall(4.5, zi, 5.5, zo, 'inner');                // 卫生间门在 5.5..6.5
  wall(6.5, zi, 8, zo, 'inner');
  wall(5 - T / 2, 0, 5 + T / 2, zi, 'inner');     // 卧室/卫生间
  wall(8 - T / 2, 0, 8 + T / 2, zi, 'inner');     // 卫生间/厨房（厨房朝客厅开放）

  // ---------- 窗户（窗玻璃颜色跟着天色变） ----------
  const skyMat = new THREE.MeshBasicMaterial({ color: '#9fd2ef' });
  function windowBack(x0, x1, y0, y1) {
    box(x0, 0, x1, 0.04, y0, y1, '#ffffff', { cast: false });
    box(x0 + 0.07, 0.04, x1 - 0.07, 0.05, y0 + 0.07, y1 - 0.07, null, { material: skyMat, cast: false });
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    box(xm - 0.025, 0.05, xm + 0.025, 0.07, y0, y1, '#ffffff', { cast: false });
    box(x0, 0.05, x1, 0.07, ym - 0.025, ym + 0.025, '#ffffff', { cast: false });
    box(x0 - 0.06, 0, x1 + 0.06, 0.13, y0 - 0.05, y0, '#ffffff');
  }
  function windowLeft(z0, z1, y0, y1) {
    box(0, z0, 0.04, z1, y0, y1, '#ffffff', { cast: false });
    box(0.04, z0 + 0.07, 0.05, z1 - 0.07, y0 + 0.07, y1 - 0.07, null, { material: skyMat, cast: false });
    const zm = (z0 + z1) / 2, ym = (y0 + y1) / 2;
    box(0.05, zm - 0.025, 0.07, zm + 0.025, y0, y1, '#ffffff', { cast: false });
    box(0.05, z0, 0.07, z1, ym - 0.025, ym + 0.025, '#ffffff', { cast: false });
    box(0, z0 - 0.06, 0.13, z1 + 0.06, y0 - 0.05, y0, '#ffffff');
  }
  windowBack(0.9, 1.7, 1.35, 2.15);   // 卧室床头
  windowBack(5.35, 6.05, 1.6, 2.2);   // 卫生间
  windowBack(9.95, 10.9, 1.3, 2.15);  // 厨房
  windowLeft(2.65, 3.55, 1.1, 2.0);   // 卧室侧窗
  windowLeft(7.95, 8.85, 1.1, 2.0);   // 客厅侧窗

  // ---------- 灯 ----------
  const lamps = [];
  function lamp(x, y, z, color = '#ffcf8a', intensity = 5, distance = 6) {
    const light = new THREE.PointLight(color, 0, distance, 1.6);
    light.position.set(x, y, z);
    group.add(light);
    const material = new THREE.MeshLambertMaterial({ color: '#fff3d6', emissive: new THREE.Color(color), emissiveIntensity: 0 });
    const entry = { light, material, intensity, level: 0 };
    lamps.push(entry);
    return material;
  }

  const fx = {};

  // ================= 卧室 =================
  box(0.3, 0.15, 2.3, 2.45, 0, 0.38, '#8a5a3b', { block: true });   // 床架
  box(0.35, 0.3, 2.25, 2.42, 0.38, 0.55, '#f7f2ea');                // 床垫
  box(0.3, 0.15, 2.3, 0.3, 0, 1.0, '#7a4e32');                      // 床头板
  box(0.75, 0.4, 1.85, 0.8, 0.55, 0.68, '#ffffff');                 // 枕头
  const blanketFlat = box(0.33, 1.05, 2.27, 2.44, 0.5, 0.62, '#6aa0d8');
  const blanketUp = box(0.33, 0.9, 2.27, 2.44, 0.5, 0.93, '#6aa0d8');
  blanketUp.visible = false;
  fx.bed = (on) => { blanketFlat.visible = !on; blanketUp.visible = on; };

  box(2.4, 0.2, 2.9, 0.7, 0, 0.5, '#a0714f', { block: true });      // 床头柜
  cyl(2.65, 0.45, 0.5, 0.74, 0.04, '#c9b79c');
  cyl(2.65, 0.45, 0.72, 0.95, 0.15, null, { rTop: 0.09, material: lamp(2.65, 1.1, 0.6) });

  box(3.4, 0.15, 4.8, 0.75, 0, 2.0, '#b5835a', { block: true });    // 衣柜
  box(4.09, 0.75, 4.11, 0.77, 0.1, 1.9, '#8a6142');
  box(3.95, 0.75, 4.0, 0.79, 0.9, 1.1, '#e0c080');
  box(4.2, 0.75, 4.25, 0.79, 0.9, 1.1, '#e0c080');

  // 书桌 + 电脑 + 椅子
  box(4.25, 1.6, 4.9, 2.9, 0.72, 0.77, '#d2b48c', { block: true });
  for (const [x, z] of [[4.3, 1.65], [4.85, 1.65], [4.3, 2.85], [4.85, 2.85]]) cyl(x, z, 0, 0.72, 0.03, '#8b6748');
  box(4.62, 2.2, 4.68, 2.3, 0.77, 0.95, '#2a2a2a');
  box(4.65, 1.95, 4.72, 2.55, 0.95, 1.35, '#2a2a2a');
  const monitorMat = new THREE.MeshBasicMaterial({ color: '#151515' });
  box(4.635, 2.0, 4.65, 2.5, 1.0, 1.3, null, { material: monitorMat, cast: false });
  box(4.33, 2.05, 4.5, 2.45, 0.77, 0.79, '#dddddd');
  box(3.65, 2.0, 4.15, 2.5, 0.4, 0.47, '#4f6d7a', { block: true });
  box(3.6, 2.0, 3.67, 2.5, 0.47, 0.95, '#4f6d7a');
  cyl(3.9, 2.25, 0, 0.4, 0.04, '#333333');
  let monitorOn = false;
  fx.monitor = (on) => { monitorOn = on; };

  box(0.6, 2.6, 2.0, 3.6, 0, 0.012, '#e8a0a8', { cast: false });    // 地毯

  // ================= 卫生间 =================
  grid.blockRect(5.4, 0.15, 6.0, 0.9, 0.2);
  box(5.42, 0.15, 5.98, 0.36, 0.3, 0.85, '#f5f5f5');               // 水箱
  cyl(5.7, 0.62, 0, 0.4, 0.17, '#ffffff', { rTop: 0.21 });          // 马桶
  cyl(5.7, 0.62, 0.4, 0.43, 0.22, '#e9e9e9');
  box(5.5, 0.36, 5.9, 0.4, 0.43, 0.85, '#e9e9e9');

  grid.blockRect(6.55, 0.15, 7.25, 0.65, 0.2);
  cyl(6.9, 0.4, 0, 0.7, 0.08, '#f0f0f0');                           // 洗手台
  box(6.55, 0.15, 7.25, 0.65, 0.7, 0.85, '#ffffff');
  box(6.65, 0.25, 7.15, 0.58, 0.85, 0.86, '#cfe3ea', { cast: false });
  cyl(6.9, 0.22, 0.85, 0.98, 0.025, '#b8b8b8');
  box(6.88, 0.22, 6.92, 0.36, 0.95, 0.98, '#b8b8b8');
  const waterMat = new THREE.MeshLambertMaterial({ color: '#9fd9f5', transparent: true, opacity: 0.6 });
  const bathTap = cyl(6.9, 0.35, 0.86, 0.95, 0.012, null, { material: waterMat, cast: false });
  bathTap.visible = false;
  fx.tap = (on) => { bathTap.visible = on; };
  box(6.55, 0, 7.25, 0.02, 1.1, 1.9, '#a8a8a8', { cast: false });   // 镜子
  box(6.6, 0.02, 7.2, 0.03, 1.15, 1.85, '#d6edf5', { cast: false });
  box(6.6, 0, 7.2, 0.07, 1.9, 1.96, null, { material: lamp(6.9, 1.75, 0.6), cast: false });

  box(6.6, 2.4, 8 - T / 2, 4 - T / 2, 0, 0.08, '#e0e0e0', { block: true }); // 淋浴间
  const glassMat = new THREE.MeshLambertMaterial({ color: '#cdeaf5', transparent: true, opacity: 0.3, depthWrite: false });
  box(6.6, 2.38, 8 - T / 2, 2.42, 0.08, 2.0, null, { material: glassMat, cast: false });
  cyl(7.85, 3.15, 0.08, 2.12, 0.02, '#b8b8b8');
  box(7.25, 3.13, 7.85, 3.17, 2.08, 2.12, '#b8b8b8');
  cyl(7.25, 3.15, 2.0, 2.06, 0.12, '#c8c8c8');
  const showerMat = new THREE.MeshLambertMaterial({ color: '#a6dcf5', transparent: true, opacity: 0.35, depthWrite: false });
  const showerWater = cyl(7.25, 3.15, 0.08, 2.0, 0.24, null, { material: showerMat, open: true, cast: false, rTop: 0.12 });
  showerWater.visible = false;
  fx.shower = (on) => { showerWater.visible = on; };
  box(5.85, 2.85, 6.5, 3.65, 0, 0.015, '#7fb3c8', { cast: false });  // 地垫

  // ================= 厨房 =================
  box(8.25, 0.15, 9.05, 0.85, 0, 1.85, '#e6edf1', { block: true });  // 冰箱
  box(8.3, 0.84, 9.0, 0.851, 0.1, 1.75, '#fff6cf', { cast: false });
  const fridgeDoor = new THREE.Group();
  fridgeDoor.position.set(9.05, 0, 0.85);
  group.add(fridgeDoor);
  box(-0.8, 0, 0, 0.05, 0.03, 1.82, '#f4f8fa', { parent: fridgeDoor });
  box(-0.76, 0.05, -0.72, 0.09, 0.85, 1.4, '#9aa5ab', { parent: fridgeDoor });
  box(-0.8, 0.05, 0, 0.055, 1.24, 1.26, '#c8d0d4', { parent: fridgeDoor, cast: false });
  let fridgeOpen = false;
  fx.fridge = (on) => { fridgeOpen = on; };

  box(9.1, 0.15, 11.85, 0.8, 0, 0.86, '#9cc0a8', { block: true });   // 橱柜
  box(9.08, 0.13, 11.87, 0.82, 0.86, 0.92, '#efe9df');
  for (const x of [9.8, 10.5, 11.2]) box(x - 0.01, 0.8, x + 0.01, 0.81, 0.06, 0.8, '#7f9f8a', { cast: false });
  cyl(10.1, 0.45, 0.92, 0.935, 0.12, '#333333');                     // 炉灶
  cyl(10.5, 0.45, 0.92, 0.935, 0.1, '#333333');
  const burnerMat = new THREE.MeshLambertMaterial({ color: '#552211', emissive: new THREE.Color('#ff5a1f'), emissiveIntensity: 0 });
  cyl(10.1, 0.45, 0.935, 0.94, 0.08, null, { material: burnerMat, cast: false });
  cyl(10.1, 0.45, 0.94, 1.08, 0.13, '#8d969b');                      // 锅
  box(10.2, 0.43, 10.42, 0.47, 1.04, 1.07, '#5a5a5a');
  let stoveOn = false;
  fx.stove = (on) => { stoveOn = on; };
  box(10.95, 0.25, 11.65, 0.7, 0.92, 0.93, '#c8d0d4', { cast: false }); // 水槽
  cyl(11.3, 0.2, 0.92, 1.15, 0.02, '#b8b8b8');
  box(11.28, 0.2, 11.32, 0.42, 1.12, 1.15, '#b8b8b8');
  const kitchenTap = cyl(11.3, 0.4, 0.93, 1.12, 0.012, null, { material: waterMat, cast: false });
  kitchenTap.visible = false;
  fx.ktap = (on) => { kitchenTap.visible = on; };
  box(9.1, 0, 9.85, 0.38, 1.45, 2.2, '#9cc0a8');                     // 吊柜
  box(11.0, 0, 11.85, 0.38, 1.45, 2.2, '#9cc0a8');
  box(9.15, 0.3, 9.8, 0.36, 1.42, 1.45, null, { material: lamp(10.4, 1.7, 0.9), cast: false });
  ball(9.4, 0.98, 0.45, 0.06, '#e74c3c');                            // 台面上的水果
  ball(9.52, 0.98, 0.5, 0.06, '#f1c40f');

  // ================= 客厅：餐桌 =================
  box(9.3, 5.3, 11.1, 6.3, 0.72, 0.78, '#c99a6b', { block: true });
  for (const [x, z] of [[9.4, 5.4], [11.0, 5.4], [9.4, 6.2], [11.0, 6.2]]) cyl(x, z, 0, 0.72, 0.04, '#a3765a');
  function chair(z0, z1, backZ0, backZ1) {
    box(9.95, z0, 10.45, z1, 0.42, 0.48, '#a3765a', { block: true });
    box(9.95, backZ0, 10.45, backZ1, 0.48, 0.95, '#a3765a');
    for (const [x, z] of [[10.0, z0 + 0.05], [10.4, z0 + 0.05], [10.0, z1 - 0.05], [10.4, z1 - 0.05]]) cyl(x, z, 0, 0.42, 0.025, '#8a6249');
  }
  chair(6.45, 6.95, 6.88, 6.95);
  chair(4.65, 5.15, 4.65, 4.72);
  const plate = new THREE.Group();
  group.add(plate);
  cyl(10.2, 5.95, 0.78, 0.8, 0.15, '#ffffff', { parent: plate });
  ball(10.2, 0.83, 5.95, 0.08, '#e8a33d', { parent: plate });
  ball(10.27, 0.82, 5.9, 0.05, '#6fbf4b', { parent: plate });
  plate.visible = false;
  fx.plate = (on) => { plate.visible = on; };
  cyl(10.75, 5.55, 0.78, 0.98, 0.03, '#c9b79c');                      // 餐桌台灯
  cyl(10.75, 5.55, 0.95, 1.15, 0.14, null, { rTop: 0.08, material: lamp(10.4, 1.4, 5.8, '#ffd9a0', 6, 6) });

  // ================= 客厅：电视区 =================
  box(0.15, 5.7, 0.6, 7.7, 0, 0.5, '#6b4f3a', { block: true });     // 电视柜
  box(0.25, 6.55, 0.45, 6.85, 0.5, 0.62, '#1d1d1d');
  box(0.28, 5.95, 0.38, 7.45, 0.62, 1.45, '#1d1d1d');
  const tvMat = new THREE.MeshBasicMaterial({ color: '#151515' });
  box(0.38, 6.0, 0.39, 7.4, 0.66, 1.41, null, { material: tvMat, cast: false });
  const tvLight = new THREE.PointLight('#8fb8ff', 0, 5, 1.6);
  tvLight.position.set(0.9, 1.0, 6.7);
  group.add(tvLight);
  let tvOn = false;
  fx.tv = (on) => { tvOn = on; };

  // 电视上方的挂钟，指针跟着游戏时间走
  const clockFace = cyl(0, 0, 0, 0.04, 0.22, '#ffffff', { seg: 24 });
  clockFace.rotation.z = Math.PI / 2;
  clockFace.position.set(0.03, 2.05, 6.7);
  const clockRim = cyl(0, 0, 0, 0.03, 0.245, '#5a4636', { seg: 24 });
  clockRim.rotation.z = Math.PI / 2;
  clockRim.position.set(0.012, 2.05, 6.7);
  function hand(len, width, color) {
    const pivot = new THREE.Group();
    pivot.position.set(0.06, 2.05, 6.7);
    group.add(pivot);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, len, width), mat(color));
    m.position.y = len / 2 - 0.02;
    pivot.add(m);
    return pivot;
  }
  const hourHand = hand(0.12, 0.03, '#333333');
  const minuteHand = hand(0.18, 0.02, '#555555');

  box(1.7, 6.2, 2.5, 7.2, 0.34, 0.4, '#b0835e', { block: true });   // 茶几
  for (const [x, z] of [[1.78, 6.28], [2.42, 6.28], [1.78, 7.12], [2.42, 7.12]]) cyl(x, z, 0, 0.34, 0.025, '#8b6748');
  cyl(2.0, 6.5, 0.4, 0.5, 0.045, '#e07a5f');
  box(2.15, 6.85, 2.35, 6.92, 0.4, 0.42, '#333333');
  box(1.2, 5.5, 3.0, 7.9, 0, 0.012, '#9ec5d6', { cast: false });     // 地毯

  box(3.0, 5.6, 3.9, 8.0, 0.1, 0.42, '#d9785b', { block: true });   // 沙发
  box(3.62, 5.6, 3.9, 8.0, 0.42, 0.95, '#cc6b4f');
  box(3.0, 5.6, 3.9, 5.8, 0.42, 0.65, '#cc6b4f');
  box(3.0, 7.8, 3.9, 8.0, 0.42, 0.65, '#cc6b4f');
  box(3.02, 5.82, 3.6, 6.78, 0.42, 0.5, '#e3876a');
  box(3.02, 6.82, 3.6, 7.78, 0.42, 0.5, '#e3876a');
  box(3.45, 7.35, 3.6, 7.75, 0.5, 0.8, '#f2d16b');
  for (const [x, z] of [[3.05, 5.65], [3.85, 5.65], [3.05, 7.95], [3.85, 7.95]]) cyl(x, z, 0, 0.1, 0.03, '#5a4636');

  box(3.1, 8.15, 3.6, 8.65, 0, 0.5, '#b0835e', { block: true });    // 边几 + 台灯
  cyl(3.35, 8.4, 0.5, 0.74, 0.04, '#c9b79c');
  cyl(3.35, 8.4, 0.72, 0.95, 0.15, null, { rTop: 0.09, material: lamp(3.35, 1.1, 8.3) });

  // ================= 客厅：阅读角 =================
  box(0.4, 4.1, 1.6, 4.15, 0, 1.8, '#7a5a3e', { block: true });     // 书架
  box(0.4, 4.1, 0.45, 4.5, 0, 1.8, '#8b6748', { block: true });
  box(1.55, 4.1, 1.6, 4.5, 0, 1.8, '#8b6748', { block: true });
  const shelfYs = [0, 0.45, 0.9, 1.35, 1.76];
  for (const y of shelfYs) box(0.4, 4.1, 1.6, 4.5, y, y + 0.04, '#8b6748', { block: true });
  const bookColors = ['#c0504d', '#4f81bd', '#9bbb59', '#f2c14e', '#8064a2', '#4bacc6', '#e07a5f'];
  const books = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), 60);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  let n = 0;
  for (let s = 0; s < 4; s++) {
    let x = 0.48;
    while (x < 1.45 && n < 60) {
      const w = 0.05 + Math.random() * 0.04, h = 0.25 + Math.random() * 0.13;
      m4.makeScale(w * 0.92, h, 0.3);
      m4.setPosition(x + w / 2, shelfYs[s] + 0.04 + h / 2, 4.32);
      books.setMatrixAt(n, m4);
      books.setColorAt(n, col.set(bookColors[n % bookColors.length]));
      n++;
      x += w;
    }
  }
  books.count = n;
  books.castShadow = true;
  group.add(books);

  box(1.0, 8.1, 1.8, 8.85, 0.1, 0.45, '#7aa37a', { block: true });  // 单人沙发
  box(1.0, 8.65, 1.8, 8.85, 0.45, 1.0, '#6a936a');
  box(1.0, 8.1, 1.12, 8.85, 0.45, 0.65, '#6a936a');
  box(1.68, 8.1, 1.8, 8.85, 0.45, 0.65, '#6a936a');

  grid.blockRect(2.05, 8.5, 2.35, 8.8, 0.15);                       // 落地灯
  cyl(2.2, 8.65, 0, 0.04, 0.15, '#3a3a3a');
  cyl(2.2, 8.65, 0.04, 1.5, 0.02, '#3a3a3a');
  cyl(2.2, 8.65, 1.45, 1.75, 0.2, null, { rTop: 0.1, material: lamp(2.2, 1.45, 8.5) });

  // ================= 绿植 / 瑜伽垫 / 门垫 =================
  function plant(x, z, s) {
    grid.blockRect(x - 0.22 * s, z - 0.22 * s, x + 0.22 * s, z + 0.22 * s, 0.2);
    cyl(x, z, 0, 0.45 * s, 0.17 * s, '#c4704f', { rTop: 0.22 * s });
    const leaves = ['#4f9a5b', '#5fae68', '#468a51'];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ball(x + Math.cos(a) * 0.14 * s, (0.7 + (i % 3) * 0.15) * s, z + Math.sin(a) * 0.14 * s, 0.2 * s, leaves[i % 3]);
    }
    ball(x, 1.1 * s, z, 0.2 * s, '#5fae68');
  }
  plant(11.55, 8.45, 1);
  plant(2.5, 4.4, 0.8);
  box(5.6, 6.4, 6.5, 8.1, 0, 0.015, '#e58fb0', { cast: false });    // 瑜伽垫
  box(5.7, 8.4, 6.5, 8.9, 0, 0.012, '#b0845a', { cast: false });    // 门垫

  // ================= 屋外 =================
  function tree(x, z, s) {
    cyl(x, z, -0.3, 0.6 * s, 0.12 * s, '#7a5236');
    cyl(x, z, 0.5 * s, 2.0 * s, 0.9 * s, '#5c9e5f', { rTop: 0.02 });
    cyl(x, z, 1.4 * s, 2.7 * s, 0.65 * s, '#6cb26b', { rTop: 0.02 });
  }
  tree(-3, -2, 1.3); tree(15.5, 1.5, 1.1); tree(15, 11, 1.4); tree(-2.8, 11.5, 1.0);
  tree(4.5, -3.2, 1.2); tree(17, 6, 0.9); tree(-4.5, 5, 1.1);
  for (let i = 0; i < 5; i++) cyl(6.1 + Math.sin(i) * 0.15, 9.8 + i * 0.75, -0.3, -0.26, 0.28, '#d8d2c4', { cast: false });

  // ---------- 交互点：approach 是走过去站的位置（必须可走），use 是坐/躺/站的最终位置 ----------
  const spots = {
    bed:         { name: '床',     approach: [2.75, 1.75], use: [1.3, 0.72, 1.46], rot: 0, pose: 'lie' },
    desk:        { name: '书桌',   approach: [3.25, 2.25], use: [3.82, 0.22, 2.25], rot: R / 2, pose: 'sit' },
    toilet:      { name: '马桶',   approach: [5.75, 1.3], use: [5.7, 0.18, 0.66], rot: 0, pose: 'sit' },
    bathSink:    { name: '洗手台', approach: [6.9, 1.3], use: [6.9, 0, 0.95], rot: R, pose: 'stand' },
    shower:      { name: '淋浴',   approach: [6.25, 3.25], use: [7.2, 0.08, 3.15], rot: -R / 2, pose: 'stand' },
    fridge:      { name: '冰箱',   approach: [8.75, 1.4], use: [8.6, 0, 1.15], rot: R, pose: 'stand' },
    stove:       { name: '灶台',   approach: [10.3, 1.4], use: [10.3, 0, 1.15], rot: R, pose: 'stand' },
    kitchenSink: { name: '水槽',   approach: [11.3, 1.4], use: [11.3, 0, 1.15], rot: R, pose: 'stand' },
    dining:      { name: '餐桌',   approach: [10.2, 7.4], use: [10.2, 0.23, 6.68], rot: R, pose: 'sit' },
    sofa:        { name: '沙发',   approach: [2.75, 6.8], use: [3.45, 0.25, 6.8], rot: -R / 2, pose: 'sit' },
    bookshelf:   { name: '书架',   approach: [1.0, 4.9], use: [1.0, 0, 4.75], rot: R, pose: 'stand' },
    armchair:    { name: '单人沙发', approach: [1.4, 7.75], use: [1.4, 0.2, 8.5], rot: R, pose: 'sit' },
    plant1:      { name: '绿植',   approach: [10.75, 8.25], use: [10.9, 0, 8.45], rot: R / 2, pose: 'stand' },
    plant2:      { name: '绿植',   approach: [2.5, 5.25], use: [2.5, 0, 4.95], rot: R, pose: 'stand' },
    mat:         { name: '瑜伽垫', approach: [6.05, 7.25], use: [6.05, 0.015, 7.25], rot: 0, pose: 'stand' },
  };
  for (const [id, s] of Object.entries(spots)) {
    s.id = id;
    if (!grid.freeAt(...s.approach)) console.warn(`[house] spot "${id}" approach point is blocked`);
  }

  // ---------- 每帧更新 ----------
  let t = 0, tvTimer = 0, fridgeAngle = 0;
  const tvColor = new THREE.Color();

  function update(dt, hour, { lightsOn, sky }) {
    t += dt;
    skyMat.color.copy(sky);

    for (const l of lamps) {
      l.level += ((lightsOn ? 1 : 0) - l.level) * Math.min(1, dt * 4);
      l.light.intensity = l.intensity * l.level;
      l.material.emissiveIntensity = 0.9 * l.level;
    }

    fridgeAngle += ((fridgeOpen ? 1.7 : 0) - fridgeAngle) * Math.min(1, dt * 6);
    fridgeDoor.rotation.y = fridgeAngle;

    burnerMat.emissiveIntensity = stoveOn ? 0.8 + Math.sin(t * 20) * 0.15 : 0;
    showerMat.opacity = 0.3 + Math.sin(t * 30) * 0.08;

    if (tvOn) {
      tvTimer -= dt;
      if (tvTimer <= 0) {
        tvTimer = 0.4 + Math.random() * 1.2;
        tvColor.setHSL(Math.random(), 0.55, 0.45 + Math.random() * 0.15);
      }
      tvMat.color.copy(tvColor);
      tvLight.color.copy(tvColor);
      tvLight.intensity = 2.5;
    } else {
      tvMat.color.set('#151515');
      tvLight.intensity = 0;
    }
    monitorMat.color.set(monitorOn ? (Math.sin(t * 2) > 0.95 ? '#7aa8e8' : '#5b8fd6') : '#151515');

    hourHand.rotation.x = -((hour % 12) / 12) * Math.PI * 2;
    minuteHand.rotation.x = -((hour % 1)) * Math.PI * 2;
  }

  function setWallsHigh(high) {
    for (const w of walls) if (w.kind === 'inner') w.mesh.scale.y = high ? INNER_HIGH : INNER_LOW;
  }

  function setFx(name, on) { fx[name]?.(on); }

  return { group, grid, spots, update, setWallsHigh, setFx };
}
