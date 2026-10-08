import * as THREE from 'three';
import { bake, bakeGroup } from './bake.js';

// 小人：两节式四肢（肩-肘-手、髋-膝-脚），程序化动作 = 基础姿势 + 活动动作 + 随机小动作 + 走路。
// 局部坐标：脚底 y=0，面朝 +z。小人的右边是 -x。

export const HIP_Y = 0.55;
export const SIT_DROP = -0.49;  // 坐下时 root.y = 座面高度 + SIT_DROP
export const LIE_LIFT = 0.14;   // 躺下时 root.y = 床面高度 + LIE_LIFT
export const HEAD_Y = 1.22;

const THIGH = 0.24, SHIN = 0.24, ANKLE = 0.07;
const PI = Math.PI;

const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const env = (t, dur, fade = 0.35) => sstep(t / fade) * sstep((dur - t) / fade);
const pulse = (t, period, len) => { const p = t % period; return env(p, len, Math.min(0.3, len / 3)); };

function dotsTexture(base, dot) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = dot;
  for (const [x, y] of [[12, 12], [44, 28], [20, 46], [52, 58], [36, 4]]) {
    g.beginPath(); g.arc(x, y, 4, 0, PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BASE_POSES = {
  stand: {},
  sit: { hipR: -1.57, hipL: -1.57, kneeR: 1.57, kneeL: 1.57, shR: -0.35, shL: -0.35, elR: -0.75, elL: -0.75 },
  lie: { nkX: 0.6, shRz: -0.12, shLz: 0.12 },
  crouch: { hipR: -1.75, hipL: -1.75, kneeR: 2.15, kneeL: 2.15, spX: 0.35, shR: -0.6, shL: -0.6, elR: -0.5, elL: -0.5 },
  tub: { hipR: -1.5, hipL: -1.5, kneeR: 0.15, kneeL: 0.15, spX: -0.45, shR: -0.3, shL: -0.3, shRz: -0.75, shLz: 0.75, elR: -0.4, elL: -0.4 },
};

// 活动动作：在基础姿势上改关节角度。t 为动作时间（秒），c 为角色本身（读状态/设表情）
const ANIMS = {
  idle(J, t) {
    J.spZ += Math.sin(t * 0.8) * 0.02;
    J.nkY += Math.sin(t * 0.37) * 0.3;
    J.nkX += Math.sin(t * 0.53) * 0.05;
  },
  sleep(J, t) { J.bob += Math.sin(t * 1.3) * 0.006; },
  reach(J, t) {
    J.shR = J.shL = -1.2 + Math.sin(t * 2.2) * 0.12;
    J.elR = J.elL = -0.35;
    J.spX += 0.15; J.nkX += 0.25;
  },
  reachHigh(J, t) {
    J.shR = -2.1 + Math.sin(t * 2) * 0.15; J.elR = -0.3;
    J.nkX -= 0.3;
  },
  cook(J, t) {
    J.shR = -1.05; J.elR = -0.65 + Math.sin(t * 7) * 0.28; J.shRy = 0.3;
    J.shL = -0.9; J.elL = -0.9; J.shLy = -0.35;
    J.nkX += 0.35; J.spX += 0.1;
    J.bob += pulse(t, 3.2, 0.5) * 0.015;
  },
  chop(J, t) {
    J.shR = -0.9 + Math.max(0, Math.sin(t * 9)) * 0.35; J.elR = -1.1; J.shRy = 0.15;
    J.shL = -0.8; J.elL = -1.2; J.shLy = -0.4;
    J.nkX += 0.45; J.spX += 0.15;
  },
  washDishes(J, t) {
    J.shR = -0.95 + Math.sin(t * 8) * 0.12; J.shL = -0.95 - Math.sin(t * 8) * 0.12;
    J.elR = J.elL = -0.7; J.shRy = 0.3; J.shLy = -0.3;
    J.nkX += 0.4; J.spX += 0.2;
  },
  handwash(J, t) {
    J.shR = J.shL = -0.9; J.elR = J.elL = -1.0 + Math.sin(t * 12) * 0.1;
    J.shRy = 0.5; J.shLy = -0.5;
    J.nkX += 0.4; J.spX += 0.15;
  },
  faceWash(J, t) {
    const p = pulse(t, 2.4, 1.6);
    J.shR = J.shL = lerp(-0.9, -1.45, p); J.elR = J.elL = lerp(-1.0, -2.25, p);
    J.shRy = 0.45; J.shLy = -0.45;
    J.spX += 0.3 + p * 0.1; J.nkX += 0.2;
  },
  brush(J, t) {
    J.shR = -1.45; J.shRy = 0.55; J.elR = -2.05 + Math.sin(t * 14) * 0.12;
    J.nkX -= 0.05; J.spX += 0.1;
  },
  eat(J, t, c) {
    J.shL = -1.0; J.elL = -1.25; J.shLy = -0.35;
    const bite = (Math.sin(t * 2.6) + 1) / 2;
    J.shR = -0.95 - bite * 0.45; J.elR = -1.2 - bite * 0.75; J.shRy = 0.4;
    J.nkX += 0.2 - bite * 0.15;
    c.exprAnim = 'chew';
  },
  snack(J, t, c) {
    const bite = pulse(t, 2.2, 1.0);
    J.shR = lerp(-0.7, -1.35, bite); J.elR = lerp(-1.0, -2.1, bite); J.shRy = 0.45;
    J.shL = -0.6; J.elL = -1.1; J.shLy = -0.3;
    c.exprAnim = bite > 0.5 ? 'chew' : 'happy';
  },
  drink(J) {
    J.shR = -1.35; J.shRy = 0.45; J.elR = -1.95;
    J.nkX -= 0.3;
  },
  sip(J, t) {
    const up = pulse(t, 6, 1.8);
    J.shR = lerp(-0.75, -1.35, up); J.elR = lerp(-1.45, -1.95, up); J.shRy = lerp(0.3, 0.45, up);
    J.shL = -0.6; J.elL = -1.2; J.shLy = -0.3;
    J.nkX -= up * 0.25;
  },
  type(J, t, c) {
    const think = pulse(t + 3, 11, 2.6);
    J.shR = lerp(-0.85, -1.2, think); J.elR = lerp(-0.9 + Math.sin(t * 15) * 0.05, -2.3, think); J.shRy = lerp(0.25, 0.5, think);
    J.shL = -0.85; J.elL = -0.9 + Math.cos(t * 13) * 0.05; J.shLy = -0.25;
    J.nkX += 0.1 - think * 0.15; J.spX -= think * 0.1;
    c.exprAnim = 'focus';
  },
  read(J, t, c) {
    const turn = pulse(t, 7, 0.8);
    J.shR = J.shL = -1.0; J.elR = J.elL = -1.2;
    J.shRy = lerp(0.35, -0.15, turn); J.shLy = -0.35;
    J.nkX += 0.4;
    c.exprAnim = 'focus';
  },
  tv(J, t, c) {
    J.spX -= 0.15;
    J.spZ += Math.sin(t * 0.07) * 0.08; // 时不时换个坐姿
    J.hipRz -= Math.max(0, Math.sin(t * 0.05)) * 0.25;
    const laugh = pulse(t, 11, 1.4);
    J.bob += laugh * Math.max(0, Math.sin(t * 18)) * 0.02;
    J.nkY += Math.sin(t * 0.2) * 0.06;
    c.exprAnim = laugh > 0.3 ? 'happy' : 'neutral';
    if (c.flags.catOnRight) {
      J.shR = -0.55; J.shRz = -0.55; J.elR = -0.4 + Math.sin(t * 2) * 0.3;
    }
  },
  game(J, t, c) {
    const hype = Math.max(0, Math.sin(t * 0.7)) > 0.85 ? 1 : 0;
    J.shR = J.shL = -0.85; J.elR = J.elL = -1.35 + Math.sin(t * 20) * 0.03;
    J.shRy = 0.55; J.shLy = -0.55;
    J.spX += 0.2 - hype * 0.3; J.nkX += 0.1;
    c.exprAnim = hype ? 'surprised' : 'focus';
  },
  music(J, t, c) {
    J.nkX += 0.1 + Math.sin(t * 5) * 0.1;
    J.spZ += Math.sin(t * 2.5) * 0.05;
    J.spX -= 0.1;
    c.exprAnim = 'happy';
  },
  guitar(J, t, c) {
    J.shL = -0.7; J.shLz = 0.5; J.elL = -1.3; J.shLy = -0.6;
    J.shR = -0.5; J.elR = -1.4 + Math.sin(t * 9) * 0.25; J.shRy = 0.4;
    J.nkX += 0.3; J.nkY += 0.3;
    c.exprAnim = 'happy';
  },
  toilet(J, t) {
    J.shR = -0.9; J.elR = -1.5; J.shRy = 0.35;
    J.nkX += 0.45;
    J.kneeR += Math.sin(t * 3) * 0.15; J.kneeL -= Math.sin(t * 3) * 0.15;
  },
  shower(J, t, c) {
    J.shR = -2.6; J.shL = -2.6;
    J.elR = -1.6 + Math.sin(t * 9) * 0.25; J.elL = -1.6 + Math.cos(t * 9) * 0.25;
    J.shRy = 0.3; J.shLy = -0.3; J.nkX -= 0.2;
    c.exprAnim = 'happy';
  },
  bath(J, t, c) {
    J.nkX -= 0.25; J.nkY += Math.sin(t * 0.3) * 0.2;
    c.exprAnim = 'happy';
  },
  tubFill(J) {
    J.spX += 0.6; J.shR = -1.0; J.elR = -0.2; J.nkX += 0.2;
  },
  run(J, t) {
    const s = Math.sin(t * 9);
    J.hipR = -s * 0.75; J.hipL = s * 0.75;
    J.kneeR = 0.3 + Math.max(0, Math.sin(t * 9 + PI / 2)) * 1.0;
    J.kneeL = 0.3 + Math.max(0, Math.sin(t * 9 - PI / 2)) * 1.0;
    J.shR = s * 0.6; J.shL = -s * 0.6; J.elR = J.elL = -1.4;
    J.spX += 0.15; J.bob += Math.abs(Math.cos(t * 9)) * 0.04;
  },
  yoga(J, t, c) {
    const phase = Math.floor(t / 7) % 4, k = env(t % 7, 7, 1.2);
    if (phase === 0) { J.shR = J.shL = -3.0 * k; J.spX -= 0.15 * k; }
    if (phase === 1) {
      J.hipR = -0.3 * k; J.hipRz = -0.9 * k; J.kneeR = 2.0 * k;
      J.shR = J.shL = -2.9 * k; J.shRy = 0.3 * k; J.shLy = -0.3 * k;
    }
    if (phase === 2) { J.spX += 1.2 * k; J.shR = J.shL = -0.5 * k; J.nkX += 0.3 * k; }
    if (phase === 3) {
      J.hipL = -0.9 * k; J.kneeL = 0.9 * k; J.hipR = 0.5 * k;
      J.shRz = -1.5 * k; J.shLz = 1.5 * k; J.spY = 0.3 * k;
    }
    c.exprAnim = 'focus';
  },
  curl(J, t) {
    J.elR = -0.3 - Math.max(0, Math.sin(t * 3)) * 1.9;
    J.elL = -0.3 - Math.max(0, Math.sin(t * 3 + PI)) * 1.9;
    J.shR = J.shL = -0.15; J.spX += 0.05;
  },
  water(J, t) {
    J.shR = -0.85; J.elR = -0.25; J.handR = 0.5 + Math.sin(t * 1.5) * 0.1;
    J.spX += 0.25; J.nkX += 0.4;
  },
  change(J, t) {
    const k = (Math.sin(t * 2.2) + 1) / 2;
    J.shR = J.shL = lerp(-1.6, -2.8, k); J.elR = J.elL = -0.8;
    J.shRy = 0.6; J.shLy = -0.6; J.spY += Math.sin(t * 2) * 0.3;
    J.nkX += 0.15;
  },
  curtain(J, t) {
    J.shR = J.shL = -0.6; J.shRz = -1.3 + Math.sin(t * 2) * 0.2; J.shLz = 1.3 - Math.sin(t * 2) * 0.2;
    J.elR = J.elL = -0.2; J.spY += Math.sin(t * 2) * 0.1;
  },
  shoes(J) { J.spX += 0.75; J.shR = J.shL = -0.9; J.elR = J.elL = -0.2; J.nkX += 0.3; },
  coat(J, t) {
    const k = (Math.sin(t * 3) + 1) / 2;
    J.shR = J.shL = lerp(0.6, -0.3, k); J.shRz = -0.4; J.shLz = 0.4; J.elR = J.elL = -0.5;
  },
  mirror(J, t, c) {
    J.nkY += Math.sin(t * 1.2) * 0.5;
    const fix = pulse(t, 4, 1.6);
    J.shR = lerp(J.shR, -2.2, fix); J.elR = lerp(J.elR, -1.9, fix); J.shRy = 0.5 * fix;
    c.exprAnim = 'happy';
  },
  skincare(J, t) {
    J.shR = J.shL = -1.4; J.elR = J.elL = -2.2 + Math.sin(t * 10) * 0.05;
    J.shRy = 0.5; J.shLy = -0.5; J.nkX -= 0.1;
  },
  pet(J, t, c) {
    J.shR = -0.95 + Math.sin(t * 2.2) * 0.25; J.elR = -0.3; J.shRz = 0.05;
    J.shL = -0.8; J.elL = -0.8;
    J.nkX += 0.45;
    c.exprAnim = 'happy';
  },
  wand(J, t, c) {
    J.shR = -1.3 + Math.sin(t * 4) * 0.6; J.shRz = -0.3 + Math.cos(t * 3) * 0.4; J.elR = -0.3;
    J.spY += Math.sin(t * 2) * 0.15; J.nkX += 0.3;
    c.exprAnim = 'happy';
  },
  pour(J) { J.shR = -1.0; J.elR = -0.4; J.handR = 0.8; J.shL = -0.9; J.elL = -0.7; J.nkX += 0.4; },
  scoop(J, t) {
    J.shR = -0.8 + Math.sin(t * 3) * 0.3; J.elR = -0.3 - Math.sin(t * 3) * 0.3; J.nkX += 0.6;
  },
  load(J, t) {
    J.shR = J.shL = -1.2 + Math.sin(t * 2.5) * 0.3; J.elR = J.elL = -0.3;
    J.shRy = 0.2; J.shLy = -0.2;
  },
  hang(J, t) {
    J.shR = -2.2 + Math.sin(t * 1.8) * 0.25; J.shL = -2.2 - Math.sin(t * 1.8) * 0.25;
    J.elR = J.elL = -0.5; J.shRy = 0.2; J.shLy = -0.2; J.nkX -= 0.3;
  },
  lookout(J, t, c) {
    J.shR = J.shL = -1.2; J.elR = J.elL = -1.05; J.shRy = 0.15; J.shLy = -0.15;
    J.nkY += Math.sin(t * 0.3) * 0.5; J.nkX -= 0.1;
    c.exprAnim = 'happy';
  },
  phone(J, t) {
    J.shR = -0.9; J.elR = -1.5; J.shRy = 0.35; J.nkX += 0.4;
    J.spX += Math.sin(t * 0.4) * 0.03;
  },
};

// 随机小动作（待机时偶尔做一下）
const GESTURES = {
  stretch: { dur: 2.6, expr: 'happy', fn(J, e) {
    J.shR = lerp(J.shR, -2.95, e); J.shL = lerp(J.shL, -2.95, e);
    J.elR = lerp(J.elR, -0.2, e); J.elL = lerp(J.elL, -0.2, e);
    J.spX -= 0.2 * e; J.nkX -= 0.3 * e;
  } },
  yawn: { dur: 2.4, expr: 'yawn', fn(J, e) {
    J.shR = lerp(J.shR, -1.3, e); J.shRy = lerp(J.shRy, 0.5, e); J.elR = lerp(J.elR, -2.0, e);
    J.nkX -= 0.25 * e;
  } },
  scratch: { dur: 2.2, expr: 'neutral', fn(J, e, t) {
    J.shR = lerp(J.shR, -2.4, e); J.shRz = lerp(J.shRz, -0.5, e); J.elR = lerp(J.elR, -1.8 + Math.sin(t * 14) * 0.15, e);
    J.nkZ += 0.15 * e;
  } },
  rubBelly: { dur: 2.6, expr: 'sad', fn(J, e, t) {
    J.shR = lerp(J.shR, -0.45, e); J.elR = lerp(J.elR, -1.6, e); J.shRy = lerp(J.shRy, 0.55 + Math.sin(t * 5) * 0.15, e);
    J.shL = lerp(J.shL, -0.45, e); J.elL = lerp(J.elL, -1.6, e); J.shLy = lerp(J.shLy, -0.55, e);
    J.spX += 0.12 * e;
  } },
  lookAround: { dur: 3.2, expr: 'neutral', fn(J, e, t) { J.nkY += Math.sin(t * 2) * 0.75 * e; } },
};

const EXPRESSIONS = {
  neutral: { eyes: 1, mouth: 'smallSmile', brow: 0, browY: 0 },
  happy: { eyes: 'arc', mouth: 'smile', brow: 0, browY: 0.012 },
  focus: { eyes: 0.8, mouth: 'flat', brow: 0.25, browY: -0.006 },
  sleepy: { eyes: 0.35, mouth: 'flat', brow: -0.25, browY: -0.01 },
  sad: { eyes: 0.9, mouth: 'frown', brow: -0.35, browY: 0.008 },
  chew: { eyes: 1, mouth: 'chew', brow: 0, browY: 0 },
  sleep: { eyes: 0.08, mouth: 'o', brow: 0, browY: -0.005 },
  yawn: { eyes: 0.08, mouth: 'open', brow: -0.2, browY: 0.01 },
  surprised: { eyes: 1.2, mouth: 'o', brow: 0, browY: 0.02 },
};

const JOINT_KEYS = ['hipR', 'hipL', 'hipRz', 'hipLz', 'kneeR', 'kneeL', 'shR', 'shL', 'shRz', 'shLz', 'shRy', 'shLy',
  'elR', 'elL', 'handR', 'handL', 'spX', 'spY', 'spZ', 'nkX', 'nkY', 'nkZ', 'bob'];
const DEFAULT_J = { shRz: -0.07, shLz: 0.07, elR: -0.12, elL: -0.12 };

export class Character {
  constructor() {
    const M = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
    const mats = this.mats = {
      skin: M('#f6d3b3'), skinDark: M('#eab796'), hair: M('#3b2a20'),
      shirtHome: M('#f2a65a'), pantsHome: M('#3d5a80'),
      shirtPJ: M('#ffffff', { map: dotsTexture('#a9cdea', '#ffffff') }),
      pantsPJ: M('#ffffff', { map: dotsTexture('#8fb8de', '#e8f2fb') }),
      dark: M('#222222'), white: M('#ffffff'), blush: M('#f4a3a3'), mouth: M('#8a3a3a'),
      slipper: M('#f0d9b5'), slipperStrap: M('#d9a066'), shoe: M('#3f4a59'), sole: M('#f2f2f2'),
      coat: M('#b5523b'), towel: M('#fafafa'), collar: M('#e08e44'),
    };

    this.shirtMeshes = [];
    this.pantsMeshes = [];
    this.shadowParts = [];

    const add = (parent, geo, mat, x = 0, y = 0, z = 0, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.s) m.scale.set(...o.s);
      if (o.r) m.rotation.set(...o.r);
      m.castShadow = o.shadow ?? false;
      parent.add(m);
      if (o.shirt) this.shirtMeshes.push(m);
      if (o.pants) this.pantsMeshes.push(m);
      return m;
    };
    const group = (parent, x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      return g;
    };

    this.root = new THREE.Group();
    this.body = group(this.root);
    this.pelvis = group(this.body, 0, HIP_Y, 0);

    // ---------- 腿 ----------
    const thighGeo = new THREE.CapsuleGeometry(0.08, 0.16, 4, 10);
    const shinGeo = new THREE.CapsuleGeometry(0.066, 0.16, 4, 10);
    this.legs = {};
    this.feet = { slippers: [], shoes: [] };
    for (const side of ['R', 'L']) {
      const sx = side === 'R' ? -0.09 : 0.09;
      const hip = group(this.pelvis, sx, 0, 0);
      add(hip, thighGeo, mats.pantsHome, 0, -0.12, 0, { shadow: true, pants: true });
      const knee = group(hip, 0, -THIGH, 0);
      add(knee, shinGeo, mats.pantsHome, 0, -0.12, 0, { shadow: true, pants: true });
      const ankle = group(knee, 0, -SHIN, 0);
      // 拖鞋
      const slipper = group(ankle);
      add(slipper, new THREE.BoxGeometry(0.13, 0.035, 0.24), mats.slipper, 0, -0.052, 0.04, { shadow: true });
      add(slipper, new THREE.BoxGeometry(0.135, 0.045, 0.09), mats.slipperStrap, 0, -0.02, 0.075);
      add(slipper, new THREE.SphereGeometry(0.06, 10, 8), mats.skin, 0, -0.015, 0.02, { s: [1, 0.6, 1.3] });
      bakeGroup(slipper);
      // 运动鞋
      const shoe = group(ankle);
      add(shoe, new THREE.BoxGeometry(0.14, 0.03, 0.26), mats.sole, 0, -0.055, 0.04, { shadow: true });
      add(shoe, new THREE.SphereGeometry(0.075, 12, 8), mats.shoe, 0, -0.025, 0.05, { s: [0.95, 0.6, 1.7] });
      bakeGroup(shoe);
      shoe.visible = false;
      this.feet.slippers.push(slipper);
      this.feet.shoes.push(shoe);
      this.legs[side] = { hip, knee, ankle };
    }
    // 裤腰
    add(this.pelvis, new THREE.CylinderGeometry(0.18, 0.175, 0.17, 16), mats.pantsHome, 0, 0.02, 0, { s: [1, 1, 0.8], shadow: true, pants: true });

    // ---------- 身体 ----------
    this.spine = group(this.pelvis);
    add(this.spine, new THREE.CapsuleGeometry(0.17, 0.2, 6, 16), mats.shirtHome, 0, 0.22, 0, { s: [1, 1, 0.78], shadow: true, shirt: true });
    this.collar = add(this.spine, new THREE.TorusGeometry(0.075, 0.022, 6, 16), mats.collar, 0, 0.43, 0.01, { r: [PI / 2, 0, 0] });
    this.coatParts = [
      add(this.spine, new THREE.CapsuleGeometry(0.185, 0.2, 6, 16), mats.coat, 0, 0.21, 0, { s: [1, 1, 0.84], shadow: true }),
      add(this.spine, new THREE.BoxGeometry(0.015, 0.4, 0.02), mats.dark, 0, 0.2, 0.157),
    ];

    // ---------- 手臂 ----------
    const upperGeo = new THREE.CapsuleGeometry(0.062, 0.1, 4, 10);
    const foreGeo = new THREE.CapsuleGeometry(0.052, 0.1, 4, 10);
    const coatUpperGeo = new THREE.CapsuleGeometry(0.072, 0.1, 4, 10);
    const coatForeGeo = new THREE.CapsuleGeometry(0.064, 0.09, 4, 10);
    this.arms = {};
    for (const side of ['R', 'L']) {
      const sx = side === 'R' ? -0.205 : 0.205;
      const inward = side === 'R' ? 1 : -1;
      const shoulder = group(this.spine, sx, 0.4, 0);
      add(shoulder, upperGeo, mats.shirtHome, 0, -0.1, 0, { shadow: true, shirt: true });
      this.coatParts.push(add(shoulder, coatUpperGeo, mats.coat, 0, -0.1, 0));
      const elbow = group(shoulder, 0, -0.2, 0);
      add(elbow, foreGeo, mats.skin, 0, -0.09, 0, { shadow: true });
      this.coatParts.push(add(elbow, coatForeGeo, mats.coat, 0, -0.07, 0));
      const hand = group(elbow, 0, -0.19, 0);
      bake([
        add(hand, new THREE.SphereGeometry(0.06, 12, 10), mats.skin, 0, -0.035, 0, { s: [0.9, 1.1, 0.75] }),
        add(hand, new THREE.SphereGeometry(0.026, 8, 6), mats.skin, 0.04 * inward, -0.02, 0.03),
      ], hand);
      const slot = group(hand, 0, -0.05, 0);
      this.arms[side] = { shoulder, elbow, hand, slot };
    }

    // ---------- 头 ----------
    this.neck = group(this.spine, 0, 0.44, 0);
    add(this.neck, new THREE.CylinderGeometry(0.065, 0.07, 0.1, 10), mats.skin, 0, 0.03, 0);
    const H = this.headC = group(this.neck, 0, 0.23, 0);
    const headParts = [add(H, new THREE.SphereGeometry(0.25, 24, 18), mats.skin, 0, 0, 0, { shadow: true })];
    for (const s of [-1, 1]) {
      headParts.push(add(H, new THREE.SphereGeometry(0.055, 10, 8), mats.skin, 0.245 * s, -0.01, 0, { s: [0.5, 1, 0.8] }));
      headParts.push(add(H, new THREE.SphereGeometry(0.042, 8, 6), mats.blush, 0.15 * s, -0.055, 0.19, { s: [1, 0.6, 0.4] }));
    }
    headParts.push(add(H, new THREE.SphereGeometry(0.02, 8, 6), mats.skinDark, 0, -0.035, 0.247));
    bake(headParts, H);
    // 眼睛：睁眼（黑眼珠 + 高光）和笑眯眯的弧线眼，两只眼睛各合成一个网格
    this.eyeGroup = group(H, 0, 0, 0.226);
    this.arcGroup = group(H, 0, -0.005, 0.232);
    for (const s of [-1, 1]) {
      add(this.eyeGroup, new THREE.SphereGeometry(0.038, 12, 10), mats.dark, 0.09 * s, 0, 0, { s: [1, 1.15, 0.5] });
      add(this.eyeGroup, new THREE.SphereGeometry(0.012, 6, 6), mats.white, 0.09 * s + 0.012, 0.016, 0.016);
      add(this.arcGroup, new THREE.TorusGeometry(0.03, 0.008, 4, 10, PI), mats.dark, 0.09 * s, 0, 0);
    }
    bakeGroup(this.eyeGroup);
    bakeGroup(this.arcGroup);
    this.arcGroup.visible = false;
    this.brows = [-1, 1].map((s) => add(H, new THREE.BoxGeometry(0.075, 0.016, 0.012), mats.hair, 0.09 * s, 0.075, 0.226));
    this.mouths = {
      smile: add(H, new THREE.TorusGeometry(0.03, 0.008, 4, 10, PI), mats.mouth, 0, -0.085, 0.228, { r: [0, 0, PI] }),
      smallSmile: add(H, new THREE.TorusGeometry(0.02, 0.007, 4, 8, PI), mats.mouth, 0, -0.09, 0.229, { r: [0, 0, PI] }),
      frown: add(H, new THREE.TorusGeometry(0.022, 0.007, 4, 8, PI), mats.mouth, 0, -0.105, 0.226),
      flat: add(H, new THREE.BoxGeometry(0.045, 0.01, 0.01), mats.mouth, 0, -0.095, 0.23),
      open: add(H, new THREE.SphereGeometry(0.034, 10, 8), mats.mouth, 0, -0.098, 0.218, { s: [1, 0.95, 0.4] }),
      o: add(H, new THREE.SphereGeometry(0.02, 8, 6), mats.mouth, 0, -0.095, 0.226, { s: [1, 1, 0.4] }),
    };
    // 头发：后脑勺 + 头顶 + 刘海 + 鬓角 + 呆毛
    this.hair = group(H);
    add(this.hair, new THREE.SphereGeometry(0.262, 22, 14, 0, PI * 2, 0, PI * 0.72), mats.hair, 0, 0.0, -0.04, { r: [-0.35, 0, 0], shadow: true });
    add(this.hair, new THREE.SphereGeometry(0.268, 22, 12, 0, PI * 2, 0, PI * 0.42), mats.hair, 0, 0.02, -0.005, { r: [-0.15, 0, 0] });
    [[-0.14, 0.3], [-0.05, -0.15], [0.05, 0.2], [0.14, -0.3]].forEach(([x, rz]) => {
      add(this.hair, new THREE.SphereGeometry(0.075, 10, 8), mats.hair, x, 0.14, 0.185, { s: [1, 0.6, 0.55], r: [0.4, 0, rz] });
    });
    for (const s of [-1, 1]) add(this.hair, new THREE.SphereGeometry(0.07, 10, 8), mats.hair, 0.215 * s, 0.03, 0.06, { s: [0.45, 1.25, 0.65] });
    add(this.hair, new THREE.TorusGeometry(0.05, 0.012, 6, 10, PI * 1.1), mats.hair, 0.02, 0.29, 0.02, { r: [0, PI / 2, 0.4] });
    bakeGroup(this.hair);
    // 洗完澡的毛巾
    this.towel = group(H);
    add(this.towel, new THREE.SphereGeometry(0.275, 18, 12, 0, PI * 2, 0, PI * 0.5), mats.towel, 0, 0.02, -0.01, { r: [-0.2, 0, 0] });
    add(this.towel, new THREE.TorusGeometry(0.2, 0.06, 8, 18), mats.towel, 0, 0.1, -0.01, { r: [PI / 2 - 0.2, 0, 0] });
    bakeGroup(this.towel);
    this.towel.visible = false;

    this.buildProps();

    // 碰撞检测用的球（相对某个关节的偏移 + 半径）
    const L = this.legs, A = this.arms;
    this.colliders = [
      { obj: this.headC, off: [0, 0.02, 0], r: 0.27, name: 'head' },
      { obj: this.spine, off: [0, 0.32, 0], r: 0.17, name: 'chest' },
      { obj: this.spine, off: [0, 0.12, 0], r: 0.17, name: 'belly' },
      { obj: this.pelvis, off: [0, 0, 0], r: 0.17, name: 'hips' },
      ...['R', 'L'].flatMap((s) => [
        { obj: L[s].knee, off: [0, 0, 0], r: 0.075, name: 'knee' + s },
        { obj: L[s].ankle, off: [0, -0.03, 0.04], r: 0.075, name: 'foot' + s },
        { obj: A[s].elbow, off: [0, 0, 0], r: 0.06, name: 'elbow' + s },
        { obj: A[s].hand, off: [0, -0.035, 0], r: 0.065, name: 'hand' + s },
      ]),
    ];
    this._v = new THREE.Vector3();

    // 状态
    this.pose = 'stand';
    this.anim = 'idle';
    this.animT = 0;
    this.t = 0;
    this.lean = 0;
    this.walkPhase = 0;
    this.blinkT = 2;
    this.expr = 'neutral';
    this.exprBase = 'neutral';
    this.exprAnim = null;
    this.gesture = null;
    this.flags = {};
    this.cur = { ...Object.fromEntries(JOINT_KEYS.map((k) => [k, 0])), ...DEFAULT_J, sit: 0, lie: 0 };
    this.outfit = { top: 'home', coat: false, shoes: false, towel: false };
    this.setOutfit({});
  }

  buildProps() {
    const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    const mk = (geo, mat, x = 0, y = 0, z = 0, r) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (r) m.rotation.set(...r);
      return m;
    };
    const G = (...children) => { const g = new THREE.Group(); children.forEach((c) => g.add(c)); return g; };
    const R = this.arms.R.slot, Lh = this.arms.L.slot;
    const defs = {
      cup: [R, G(mk(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), M('#7ec8e3'), 0, -0.02, 0.03, [PI / 2, 0, 0]))],
      mug: [R, G(
        mk(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 12), M('#ffffff'), 0, -0.02, 0.04, [PI / 2, 0, 0]),
        mk(new THREE.TorusGeometry(0.025, 0.008, 6, 10), M('#ffffff'), 0.045, -0.02, 0.04, [0, PI / 2, 0]),
      )],
      book: [Lh, G(mk(new THREE.BoxGeometry(0.17, 0.03, 0.22), M('#c0504d'), -0.06, -0.02, 0.06))],
      can: [R, G(
        mk(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), M('#5aa469'), 0, -0.08, 0.02),
        mk(new THREE.CylinderGeometry(0.014, 0.02, 0.2, 6), M('#5aa469'), 0, -0.05, 0.14, [1.0, 0, 0]),
      )],
      phone: [R, G(mk(new THREE.BoxGeometry(0.06, 0.008, 0.11), M('#222831', { emissive: new THREE.Color('#3b6fb6'), emissiveIntensity: 0.4 }), 0, -0.02, 0.03))],
      toothbrush: [R, G(
        mk(new THREE.BoxGeometry(0.012, 0.15, 0.012), M('#ffffff'), 0, -0.02, 0.03, [PI / 2, 0, 0]),
        mk(new THREE.BoxGeometry(0.016, 0.03, 0.02), M('#4bacc6'), 0, -0.02, 0.1),
      )],
      knife: [R, G(
        mk(new THREE.BoxGeometry(0.02, 0.025, 0.08), M('#3a3a3a'), 0, -0.02, 0.02),
        mk(new THREE.BoxGeometry(0.008, 0.04, 0.14), M('#d8dde0'), 0, -0.02, 0.12),
      )],
      spatula: [R, G(
        mk(new THREE.BoxGeometry(0.018, 0.018, 0.22), M('#5a3d2b'), 0, -0.02, 0.09),
        mk(new THREE.BoxGeometry(0.07, 0.01, 0.08), M('#333333'), 0, -0.02, 0.22),
      )],
      bowl: [Lh, G(mk(new THREE.SphereGeometry(0.07, 12, 8, 0, PI * 2, PI / 2, PI / 2), M('#f5f0e6', { side: THREE.DoubleSide }), 0, -0.03, 0.04, [PI, 0, 0]),
        mk(new THREE.SphereGeometry(0.055, 10, 6, 0, PI * 2, 0, PI / 2), M('#ffffff'), 0, -0.045, 0.04))],
      chopsticks: [R, G(
        mk(new THREE.BoxGeometry(0.006, 0.006, 0.2), M('#a0714f'), -0.01, -0.02, 0.08),
        mk(new THREE.BoxGeometry(0.006, 0.006, 0.2), M('#a0714f'), 0.01, -0.02, 0.08),
      )],
      snack: [R, G(mk(new THREE.BoxGeometry(0.08, 0.04, 0.11), M('#f2c14e'), 0, -0.03, 0.03))],
      controller: [R, G(mk(new THREE.BoxGeometry(0.15, 0.04, 0.07), M('#2f2f38'), 0.08, -0.03, 0.03))],
      remote: [R, G(mk(new THREE.BoxGeometry(0.04, 0.02, 0.13), M('#333333'), 0, -0.02, 0.04))],
      wand: [R, G(
        mk(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 6), M('#c9a36b'), 0, -0.02, 0.2, [PI / 2, 0, 0]),
        mk(new THREE.SphereGeometry(0.035, 8, 6), M('#e86fa4'), 0, -0.15, 0.42),
      )],
      foodbag: [R, G(mk(new THREE.BoxGeometry(0.12, 0.16, 0.06), M('#e07a5f'), 0, -0.08, 0.02))],
      scoop: [R, G(
        mk(new THREE.BoxGeometry(0.02, 0.02, 0.14), M('#4bacc6'), 0, -0.02, 0.05),
        mk(new THREE.BoxGeometry(0.08, 0.015, 0.09), M('#4bacc6'), 0, -0.03, 0.15),
      )],
      plate: [R, G(mk(new THREE.CylinderGeometry(0.1, 0.08, 0.02, 14), M('#ffffff'), 0, -0.03, 0.04))],
      trashbag: [R, G(mk(new THREE.SphereGeometry(0.13, 10, 8), M('#30343a'), 0, -0.16, 0, null))],
      shopbag: [R, G(
        mk(new THREE.BoxGeometry(0.26, 0.24, 0.13), M('#e8d5b0'), 0, -0.17, 0),
        mk(new THREE.SphereGeometry(0.06, 8, 6), M('#7fbf6a'), 0.05, -0.04, 0),
      )],
      dumbbellR: [R, G(mk(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), M('#555555'), 0, -0.03, 0, [0, 0, PI / 2]),
        mk(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), M('#c0504d'), -0.08, -0.03, 0, [0, 0, PI / 2]),
        mk(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), M('#c0504d'), 0.08, -0.03, 0, [0, 0, PI / 2]))],
      dumbbellL: [Lh, G(mk(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 6), M('#555555'), 0, -0.03, 0, [0, 0, PI / 2]),
        mk(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), M('#c0504d'), -0.08, -0.03, 0, [0, 0, PI / 2]),
        mk(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), M('#c0504d'), 0.08, -0.03, 0, [0, 0, PI / 2]))],
      clothes: [this.spine, G(
        mk(new THREE.BoxGeometry(0.34, 0.12, 0.22), M('#c8d6e5'), 0, 0.12, 0.3),
        mk(new THREE.BoxGeometry(0.3, 0.06, 0.2), M('#f2a65a'), 0, 0.21, 0.3),
      )],
      basket: [this.spine, G(
        mk(new THREE.BoxGeometry(0.42, 0.22, 0.3), M('#d9b779'), 0, 0.08, 0.33),
        mk(new THREE.BoxGeometry(0.36, 0.06, 0.24), M('#c8d6e5'), 0, 0.2, 0.33),
      )],
      guitar: [this.spine, (() => {
        const g = G(
          mk(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16), M('#c27c3e'), 0, 0, 0, [PI / 2, 0, 0]),
          mk(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), M('#c27c3e'), 0, 0.17, 0, [PI / 2, 0, 0]),
          mk(new THREE.CylinderGeometry(0.045, 0.045, 0.085, 12), M('#2a1a10'), 0, 0.07, 0.002, [PI / 2, 0, 0]),
          mk(new THREE.BoxGeometry(0.05, 0.42, 0.03), M('#5a3d2b'), 0, 0.42, 0),
        );
        g.position.set(-0.02, 0.1, 0.24);
        g.rotation.set(0, 0, 1.2);
        return g;
      })()],
    };
    this.props = {};
    for (const [name, [parent, obj]] of Object.entries(defs)) {
      obj.visible = false;
      parent.add(obj);
      this.props[name] = obj;
    }
    this.activeProps = [];
  }

  setProps(list) {
    const names = !list ? [] : Array.isArray(list) ? list : [list];
    const expanded = names.flatMap((n) => (n === 'dumbbells' ? ['dumbbellR', 'dumbbellL'] : n === 'meal' ? ['bowl', 'chopsticks'] : [n]));
    for (const [k, o] of Object.entries(this.props)) o.visible = expanded.includes(k);
    this.activeProps = expanded;
  }

  setOutfit(patch) {
    Object.assign(this.outfit, patch);
    const o = this.outfit;
    const shirt = o.top === 'pajamas' ? this.mats.shirtPJ : this.mats.shirtHome;
    const pants = o.top === 'pajamas' ? this.mats.pantsPJ : this.mats.pantsHome;
    this.shirtMeshes.forEach((m) => { m.material = shirt; });
    this.pantsMeshes.forEach((m) => { m.material = pants; });
    this.collar.material = o.top === 'pajamas' ? this.mats.white : this.mats.collar;
    this.coatParts.forEach((m) => { m.visible = o.coat; });
    this.feet.slippers.forEach((g) => { g.visible = !o.shoes; });
    this.feet.shoes.forEach((g) => { g.visible = o.shoes; });
    this.towel.visible = o.towel;
    this.hair.visible = !o.towel;
  }

  setPose(pose) { this.pose = pose; }
  snap() { this._snap = true; }
  setLean(v) { this.lean = v; }
  setAnim(anim) {
    if (anim !== this.anim) this.animT = 0;
    this.anim = anim;
  }
  setExpressionBase(e) { this.exprBase = e; }
  playGesture(name) {
    if (!this.gesture && GESTURES[name]) this.gesture = { name, t: 0, ...GESTURES[name] };
  }

  bubbleAnchor(target) {
    this.headC.getWorldPosition(target);
    target.y += this.pose === 'lie' ? 0.45 : 0.5;
    return target;
  }

  // 碰撞球的世界坐标
  collisionSpheres(out = []) {
    out.length = 0;
    for (const c of this.colliders) {
      const p = c.obj.localToWorld(this._v.set(...c.off));
      out.push({ x: p.x, y: p.y, z: p.z, r: c.r, name: c.name });
    }
    return out;
  }

  // loco: { speed, dist, turning, look, carrying }
  update(dt, loco = {}) {
    this.t += dt;
    this.animT += dt;
    const walking = (loco.speed ?? 0) > 0.03 || loco.stepping;

    const J = { ...Object.fromEntries(JOINT_KEYS.map((k) => [k, 0])), ...DEFAULT_J, ...BASE_POSES[this.pose] };
    J.spX += this.lean;
    this.exprAnim = null;
    if (!walking) ANIMS[this.anim]?.(J, this.animT, this);

    if (walking) {
      const amp = Math.min(1, Math.max(loco.stepping ? 0.45 : 0, (loco.speed ?? 0) / 1.3));
      this.walkPhase += (loco.dist ?? 0) * 5.2 + (loco.stepping ? dt * 7 : 0);
      const s = Math.sin(this.walkPhase);
      J.hipR = -s * 0.5 * amp; J.hipL = s * 0.5 * amp;
      J.kneeR = 0.1 + Math.max(0, Math.sin(this.walkPhase + 1.6)) * 0.55 * amp;
      J.kneeL = 0.1 + Math.max(0, Math.sin(this.walkPhase - 1.54)) * 0.55 * amp;
      const carry = this.activeProps.some((p) => p === 'basket' || p === 'clothes' || p === 'guitar');
      if (carry) {
        J.shR = J.shL = -0.75; J.elR = J.elL = -1.0; J.shRy = 0.45; J.shLy = -0.45;
      } else {
        J.shR = s * 0.42 * amp; J.shL = -s * 0.42 * amp;
        J.elR = J.elL = -0.3;
        if (this.activeProps.length) { J.shR = -0.25 + s * 0.12; J.elR = -0.7; }
      }
      J.spX += 0.07 * amp;
      J.spY += s * 0.07 * amp;
      J.nkY += (loco.look ?? 0) * 0.8;
    }

    // 待机小动作
    if (this.gesture) {
      const g = this.gesture;
      g.t += dt;
      const e = env(g.t, g.dur, 0.45);
      g.fn(J, e, g.t);
      if (e > 0.3) this.exprAnim = g.expr;
      if (g.t >= g.dur) this.gesture = null;
    }

    // 平滑过渡到目标角度
    // 平滑 + 限速：避免切换动作时四肢"甩"过去
    const snap = this._snap;
    this._snap = false;
    const k = snap ? 1 : 1 - Math.exp(-12 * dt);
    const cur = this.cur;
    const approach = (from, to, kk, maxStep) => {
      const d = (to - from) * kk;
      return from + (snap ? to - from : Math.max(-maxStep, Math.min(maxStep, d)));
    };
    for (const key of JOINT_KEYS) cur[key] = approach(cur[key], J[key], k, key === 'bob' ? 0.6 * dt : 7 * dt);
    const sitTarget = this.pose === 'sit' || this.pose === 'lie' || this.pose === 'tub' ? 1 : 0;
    cur.sit = approach(cur.sit, sitTarget, 1 - Math.exp(-9 * dt), 2.5 * dt);
    cur.lie = approach(cur.lie, this.pose === 'lie' ? 1 : 0, 1 - Math.exp(-5 * dt), 1.1 * dt);

    const { hip: hR, knee: kR } = this.legs.R, { hip: hL, knee: kL } = this.legs.L;
    hR.rotation.set(cur.hipR, 0, cur.hipRz); hL.rotation.set(cur.hipL, 0, cur.hipLz);
    kR.rotation.x = cur.kneeR; kL.rotation.x = cur.kneeL;
    const aR = this.arms.R, aL = this.arms.L;
    aR.shoulder.rotation.set(cur.shR, cur.shRy, cur.shRz); aL.shoulder.rotation.set(cur.shL, cur.shLy, cur.shLz);
    aR.elbow.rotation.x = cur.elR; aL.elbow.rotation.x = cur.elL;
    aR.hand.rotation.x = cur.handR; aL.hand.rotation.x = cur.handL;
    this.spine.rotation.set(cur.spX, cur.spY, cur.spZ);
    this.neck.rotation.set(cur.nkX, cur.nkY, cur.nkZ);

    // 站立时根据腿的弯曲算骨盆高度，让脚始终踩在地上
    const drop = (h, kn) => THIGH * Math.cos(h) + SHIN * Math.cos(h + kn);
    const groundY = ANKLE + Math.max(drop(cur.hipR, cur.kneeR), drop(cur.hipL, cur.kneeL));
    this.pelvis.position.y = lerp(groundY, HIP_Y, cur.sit) + cur.bob;
    this.body.rotation.x = -PI / 2 * cur.lie;

    this.updateFace(dt);
  }

  updateFace(dt) {
    const name = this.exprAnim ?? (this.anim === 'sleep' && this.pose === 'lie' ? 'sleep' : this.exprBase);
    const E = EXPRESSIONS[name] ?? EXPRESSIONS.neutral;
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    const blink = this.blinkT < 0 ? 0.15 : 1;
    const arc = E.eyes === 'arc';
    const open = arc ? 0 : Math.min(E.eyes, blink === 1 ? E.eyes : 0.15);
    this.eyeGroup.visible = !arc;
    this.eyeGroup.scale.y = Math.max(0.06, open);
    this.arcGroup.visible = arc;
    this.brows.forEach((b, i) => {
      const s = i === 0 ? -1 : 1;
      b.rotation.z = E.brow * s;
      b.position.y = 0.075 + E.browY;
    });
    let mouth = E.mouth;
    if (mouth === 'chew') mouth = Math.sin(this.t * 12) > 0 ? 'o' : 'smallSmile';
    for (const [k, m] of Object.entries(this.mouths)) m.visible = k === mouth;
  }
}
