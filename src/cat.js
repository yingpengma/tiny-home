import * as THREE from 'three';
import { Mover, wrapAngle } from './motion.js';
import { inRange } from './activities.js';
import { bake, bakeGroup } from './bake.js';

// 橘猫"橘子"：模型 + 自己的需求和行为。会跳上家具、讨饭、陪小豆看电视、迎接回家、追扫地机器人。

const PI = Math.PI;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v) => Math.min(100, Math.max(0, v));
const pick = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);
const u2 = (v) => Math.max(0, Math.min(1, (100 - v) / 100)) ** 2;

const POSES = {
  stand: { y: 0.25, rx: 0, rz: 0, lf: 0, lb: 0, hx: -0.1, hy: 0, tp: -0.5, ty: 0, tc: 0.25, eyes: 1 },
  sit: { y: 0.2, rx: -0.7, rz: 0, lf: 0.7, lb: -1.35, hx: 0.55, hy: 0, tp: 1.6, ty: 0.7, tc: 0.25, eyes: 1 },
  loaf: { y: 0.13, rx: 0, rz: 0, lf: 1.45, lb: -1.45, hx: 0.05, hy: 0, tp: 1.55, ty: 0.95, tc: 0.18, eyes: 0.6 },
  curl: { y: 0.11, rx: 0.05, rz: 0.95, lf: -0.9, lb: -0.7, hx: 0.55, hy: 0.95, tp: 1.5, ty: 1.55, tc: 0.42, eyes: 0 },
  eat: { y: 0.24, rx: 0.25, rz: 0, lf: -0.2, lb: -0.2, hx: 1.0, hy: 0, tp: -0.4, ty: 0, tc: 0.3, eyes: 0.7 },
  scratch: { y: 0.33, rx: -1.15, rz: 0, lf: -1.6, lb: 1.15, hx: 0.85, hy: 0, tp: 0.6, ty: 0, tc: 0.1, eyes: 1 },
  crouch: { y: 0.17, rx: 0.12, rz: 0, lf: -0.5, lb: 0.6, hx: -0.15, hy: 0, tp: -0.2, ty: 0, tc: 0.1, eyes: 1 },
  jump: { y: 0.25, rx: -0.2, rz: 0, lf: -0.9, lb: 0.9, hx: 0, hy: 0, tp: -0.2, ty: 0, tc: 0, eyes: 1 },
};

export class CatModel {
  constructor() {
    const M = (c) => new THREE.MeshLambertMaterial({ color: c });
    const orange = M('#e8a25a'), dark = M('#c47a35'), white = M('#fbf4ea'), pink = M('#f2a0a8'), black = M('#1a1a1a'), green = M('#9bd35a');
    const add = (parent, geo, mat, x = 0, y = 0, z = 0, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.s) m.scale.set(...o.s);
      if (o.r) m.rotation.set(...o.r);
      m.castShadow = !!o.shadow;
      parent.add(m);
      return m;
    };
    const G = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

    this.root = new THREE.Group();
    this.body = G(this.root, 0, 0.25, 0);
    bake([
      add(this.body, new THREE.SphereGeometry(0.13, 16, 12), orange, 0, 0, 0, { s: [1, 0.85, 1.9], shadow: true }),
      ...[-0.12, -0.02, 0.08].map((z) => add(this.body, new THREE.SphereGeometry(0.133, 14, 8, 0, PI * 2, 0, PI * 0.45), dark, 0, 0.003, z, { s: [1, 0.86, 0.22] })),
      add(this.body, new THREE.SphereGeometry(0.085, 12, 8), white, 0, -0.035, 0.17, { s: [1, 1, 1.1] }),
    ], this.body);

    this.head = G(this.body, 0, 0.08, 0.23);
    add(this.head, new THREE.SphereGeometry(0.105, 16, 12), orange, 0, 0, 0, { s: [1.15, 0.95, 1], shadow: true });
    add(this.head, new THREE.SphereGeometry(0.05, 10, 8), white, 0, -0.035, 0.075, { s: [1.3, 0.8, 0.9] });
    add(this.head, new THREE.SphereGeometry(0.015, 6, 6), pink, 0, -0.012, 0.118);
    for (const s of [-1, 1]) {
      add(this.head, new THREE.ConeGeometry(0.045, 0.085, 4), orange, 0.065 * s, 0.085, -0.005, { r: [0, PI / 4, -0.3 * s] });
      add(this.head, new THREE.ConeGeometry(0.028, 0.055, 4), pink, 0.064 * s, 0.08, 0.012, { r: [0, PI / 4, -0.3 * s] });
      for (const dy of [-0.02, -0.035]) add(this.head, new THREE.BoxGeometry(0.1, 0.004, 0.004), white, 0.095 * s, dy, 0.07, { r: [0, 0, s * (dy + 0.02) * 4] });
    }
    bakeGroup(this.head);
    this.eyeGroup = G(this.head, 0, 0.02, 0.088);
    this.closedGroup = G(this.head, 0, 0.015, 0.092);
    for (const s of [-1, 1]) {
      add(this.eyeGroup, new THREE.SphereGeometry(0.024, 10, 8), green, 0.045 * s, 0, 0, { s: [1, 1, 0.5] });
      add(this.eyeGroup, new THREE.SphereGeometry(0.023, 8, 6), black, 0.045 * s, 0, 0.004, { s: [0.3, 1, 0.55] });
      add(this.closedGroup, new THREE.TorusGeometry(0.02, 0.005, 4, 8, PI), black, 0.045 * s, 0, 0, { r: [0, 0, PI] });
    }
    bakeGroup(this.eyeGroup);
    bakeGroup(this.closedGroup);
    this.closedGroup.visible = false;

    this.legs = [];
    for (const [x, z, front] of [[-0.06, 0.14, true], [0.06, 0.14, true], [-0.065, -0.15, false], [0.065, -0.15, false]]) {
      const pivot = G(this.body, x, -0.05, z);
      add(pivot, new THREE.CylinderGeometry(0.03, 0.026, 0.17, 8), orange, 0, -0.085, 0, { shadow: true });
      add(pivot, new THREE.SphereGeometry(0.033, 8, 6), white, 0, -0.18, 0.01, { s: [1, 0.6, 1.3] });
      bakeGroup(pivot);
      this.legs.push({ pivot, front, side: x < 0 ? -1 : 1 });
    }

    this.tailYaw = G(this.body, 0, 0.04, -0.24);
    this.tailPitch = G(this.tailYaw);
    this.tail = [];
    let parent = this.tailPitch;
    for (let i = 0; i < 6; i++) {
      const seg = G(parent, 0, i === 0 ? 0 : 0.075, 0);
      add(seg, new THREE.CylinderGeometry(0.02 + (5 - i) * 0.0015, 0.022 + (5 - i) * 0.0015, 0.08, 8), i === 5 ? dark : orange, 0, 0.0375, 0);
      this.tail.push(seg);
      parent = seg;
    }

    this.cur = { ...POSES.stand };
    this.pose = 'stand';
    this.anim = null;
    this.t = 0;
    this.gait = 0;
    this.happy = false;
    this.blinkT = 3;
    this.colliders = [
      { obj: this.head, off: [0, 0, 0.01], r: 0.1 },
      { obj: this.body, off: [0, 0, 0.13], r: 0.11 },
      { obj: this.body, off: [0, 0, -0.12], r: 0.11 },
    ];
    this._v = new THREE.Vector3();
  }

  collisionSpheres(out = []) {
    out.length = 0;
    for (const c of this.colliders) {
      const p = c.obj.localToWorld(this._v.set(...c.off));
      out.push({ x: p.x, y: p.y, z: p.z, r: c.r });
    }
    return out;
  }

  update(dt, loco = {}, airborne = false) {
    this.t += dt;
    const t = this.t;
    const moving = (loco.speed ?? 0) > 0.03 || loco.stepping;
    const P = { ...POSES[airborne ? 'jump' : moving ? 'stand' : this.pose] };
    let lfA = 0, lfB = 0, lbA = 0, lbB = 0;

    if (moving && !airborne) {
      const amp = Math.min(1.2, Math.max(0.5, (loco.speed ?? 0) / 0.9));
      this.gait += (loco.dist ?? 0) * 13 + (loco.stepping ? dt * 8 : 0);
      const s = Math.sin(this.gait) * 0.55 * amp;
      lfA = s; lfB = -s; lbA = -s; lbB = s;
      P.y += Math.abs(Math.cos(this.gait)) * 0.012;
      P.ty = Math.sin(t * 3) * 0.25;
      P.tp = -0.35;
      if (this.anim === 'rub') { P.rz = 0.25; P.hy = 0.4; }
    } else {
      switch (this.anim) {
        case 'eat': P.hx += Math.sin(t * 6) * 0.08; break;
        case 'groom': {
          lfA = -1.6; P.hy = 0.35; P.hx = 0.4 + Math.sin(t * 5) * 0.12;
          break;
        }
        case 'scratch': lfA = Math.sin(t * 10) * 0.35; lfB = -Math.sin(t * 10) * 0.35; break;
        case 'play': {
          // 屁股扭一扭 → 抬起前爪扑一下
          const ph = t % 1.8;
          const pounce = Math.max(0, Math.sin(Math.min(1, Math.max(0, (ph - 0.9) / 0.6)) * Math.PI));
          P.rz = Math.sin(t * 9) * 0.05 * (1 - pounce);
          lfA = -1.4 * pounce; P.rx = -0.3 * pounce; P.y += 0.03 * pounce;
          P.tp = -0.6; P.ty = Math.sin(t * 4) * 0.35;
          break;
        }
        case 'beg': P.hx = 0.2 + Math.sin(t * 2) * 0.15; P.ty = Math.sin(t * 2.5) * 0.3; break;
        case 'look': P.hy = Math.sin(t * 0.6) * 0.6; P.ty = Math.sin(t * 1.5) * 0.25; break;
        case 'purr': P.hx += 0.15; P.rz += Math.sin(t * 30) * 0.008; break;
        case 'rub': P.rz = Math.sin(t * 3) * 0.22; P.hy = Math.sin(t * 3 + 1) * 0.4; P.tp = -0.6; break;
        case 'stretch': P.rx = 0.45; P.lf = -0.9; P.lb = 0.1; P.tp = -0.9; break;
      }
      if (this.pose === 'loaf' || this.pose === 'curl' || this.pose === 'sit') P.ty += Math.sin(t * 0.8) * 0.12;
      if (this.pose === 'curl') P.y += Math.sin(t * 1.4) * 0.004;
    }

    const k = 1 - Math.exp(-(airborne ? 18 : 9) * dt);
    for (const key of Object.keys(P)) this.cur[key] = lerp(this.cur[key], P[key], k);
    const C = this.cur;
    this.body.position.y = C.y;
    this.body.rotation.set(C.rx, 0, C.rz);
    this.head.rotation.set(C.hx, C.hy, 0);
    this.legs.forEach((l, i) => {
      const base = l.front ? C.lf : C.lb;
      const extra = [lfA, lfB, lbA, lbB][i];
      l.pivot.rotation.x = base + extra;
    });
    this.tailYaw.rotation.y = C.ty;
    this.tailPitch.rotation.x = C.tp;
    this.tail.forEach((s, i) => { s.rotation.x = i === 0 ? 0 : C.tc + Math.sin(t * 2 + i) * 0.05; });

    this.blinkT -= dt;
    if (this.blinkT < -0.15) this.blinkT = 2.5 + Math.random() * 4;
    const closed = this.happy || C.eyes < 0.15;
    const open = this.blinkT < 0 ? 0.1 : Math.max(0.1, C.eyes);
    this.eyeGroup.visible = !closed;
    this.eyeGroup.scale.y = open;
    this.closedGroup.visible = closed;
  }
}

// ---------------- 行为 ----------------
export class Cat {
  constructor({ house, clock, particles, onLog = () => {} }) {
    this.house = house;
    this.state = house.state;
    this.clock = clock;
    this.onLog = onLog;
    this.model = new CatModel();
    this.root = this.model.root;
    this.grid = house.catGrid;
    this.mover = new Mover(this.root, this.grid, { maxSpeed: 0.85, accel: 3.5, decel: 3, turnSpeed: 8 });
    this.mover.fallbackGrid = house.grid;
    this.needs = { hunger: 70, thirst: 75, energy: 70, fun: 60, bladder: 80, affection: 60 };
    this.human = null;
    this.robot = null;
    this.plan = null;
    this.phase = 'idle';
    this.atSpot = null;
    this.engaged = null;
    this.interaction = null;
    this.queue = [];
    this.status = { emoji: '🐾', label: '' };
    this.heartEm = particles.emitter('heart', () => { const p = this.root.position; return [p.x, p.y + 0.45, p.z]; }, 1.2);
    this.zEm = particles.emitter('z', () => { const p = this.root.position; return [p.x, p.y + 0.35, p.z]; }, 0.35);
    this.airborne = false;
    this.lastId = null;
  }

  get pos() { return this.root.position; }
  get resting() { return this.phase === 'act' && ['sleep', 'nap', 'wander', 'groom', 'window', 'sunny', 'follow', 'waitDoor', 'sofa'].includes(this.plan?.id) && !this.human?.asleep; }
  get pettable() {
    return !this.interaction && this.resting && this.pos.y < 0.65 && this.pos.z < 11.8 && this.plan?.spot?.id !== 'litter' && !this.human?.away;
  }
  get playful() { return !this.interaction && this.needs.energy > 30 && this.needs.fun < 75 && this.phase !== 'move' && !['eat', 'litter', 'beg'].includes(this.plan?.id); }
  get begging() { return this.phase === 'act' && this.plan?.id === 'beg'; }
  get onSofaSide() { return this.phase === 'act' && this.plan?.spot?.id === 'sofaSide'; }

  start() {
    const spots = this.house.catSpots;
    const s = spots[['catBed', 'sofaNap', 'treeTop', 'beanbag'][Math.floor(Math.random() * 4)]];
    this.place(s);
    this.startPlan('sleep', s);
  }

  place(s) {
    this.pos.set(...s.pos);
    this.root.rotation.y = s.rot ?? Math.random() * PI * 2;
    this.atSpot = s;
    this.engaged = s;
    this.model.pose = s.pose ?? 'loaf';
  }

  handleTimeJump() {
    this.engaged = null;
    this.mover.path = null;
    this.mover.segs = null;
    this.interaction = null;
    this.plan = null;
    this.phase = 'idle';
    this.airborne = false;
    this.start();
  }

  // ---------- 与小豆互动 ----------
  beginInteraction(type, human, playSpot) {
    if (type === 'pet') {
      if (!this.pettable) return false;
      this.interaction = { type, human };
      this.model.anim = 'purr';
      this.model.happy = true;
      this.heartEm.on = true;
      this.setStatus('❤️', '被撸得呼噜呼噜');
      return true;
    }
    if (type === 'play') {
      if (this.phase === 'act' && this.plan?.id === 'litter') return false;
      if (this.mover.segs || this.airborne) return false; // 正在跳，等落地再说
      this.interaction = { type, human, arrived: false };
      const [x, , z] = playSpot.use;
      const target = { id: 'play', pos: [x, 0, z + 0.8], approach: [x, z + 0.8], rot: PI, pose: 'crouch', tags: [] }; // 到位后转身面向小豆
      this.abortPlan();
      this.plan = { id: 'play', kind: 'play', spot: target, anim: 'play', minutes: 999, rate: { fun: 60, energy: -8 } };
      this.goToPlanSpot();
      this.setStatus('✨', '扑逗猫棒');
      return true;
    }
    return false;
  }

  interactingWith(human) { return this.interaction?.human === human; }

  endInteraction() {
    if (!this.interaction) return;
    const type = this.interaction.type;
    this.interaction = null;
    this.model.happy = false;
    this.heartEm.on = false;
    this.needs.affection = clamp(this.needs.affection + 35);
    if (type === 'play') { this.plan = null; this.phase = 'idle'; }
    else if (this.plan) this.model.anim = this.plan.anim ?? null;
  }

  notifyHome() {
    if (this.plan?.id !== 'sleep' || Math.random() < 0.3) this.queue.push('greet');
  }

  setStatus(emoji, label) { this.status.emoji = emoji; this.status.label = label; }

  // ---------- 主循环 ----------
  update(simDt, gameMin) {
    if (Math.abs(gameMin) > 20) { this.handleTimeJump(); return; }
    const sleeping = this.phase === 'act' && this.plan?.id === 'sleep';
    if (gameMin > 0) {
      const r = gameMin / 60;
      const n = this.needs;
      n.hunger = clamp(n.hunger - 5 * r);
      n.thirst = clamp(n.thirst - 6 * r);
      n.bladder = clamp(n.bladder - 5 * r);
      n.fun = clamp(n.fun - (sleeping ? 1 : 8) * r);
      n.affection = clamp(n.affection - 5 * r);
      n.energy = clamp(n.energy + (sleeping ? 22 : -7) * r);
    }

    if (this.interaction?.type === 'pet') {
      this.needs.fun = clamp(this.needs.fun + 30 * gameMin / 60);
    } else if (this.phase === 'act') {
      this.updateAct(gameMin);
    } else if (this.phase === 'idle') {
      this.choose();
    }

    // 跟着机器人跑时，定时更新目标
    if (this.plan?.id === 'robot' && this.phase === 'act' && this.robot?.active) {
      this.followT = (this.followT ?? 0) - simDt;
      if (this.followT <= 0) {
        this.followT = 1.5;
        const p = this.robot.root.position;
        if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) > 1.1) {
          this.phase = 'move';
          const target = this.grid.snapFree(p.x - 0.4, p.z + 0.5);
          if (!this.mover.goTo(target, () => { this.phase = 'act'; this.model.pose = 'crouch'; })) this.phase = 'act';
        }
      }
    }

    const loco = this.mover.update(simDt);
    // 走近目标点位、或刚离开点位的一小段，允许贴着那件家具
    if (this.phase === 'move' && this.mover.path) {
      const p = this.pos;
      const near = (s) => s && Math.hypot(p.x - s.pos[0], p.z - s.pos[2]) < 0.55;
      this.engaged = near(this.plan?.spot) ? this.plan.spot : near(this.leftSpot) ? this.leftSpot : null;
    }
    this.model.update(simDt, loco, this.airborne);
    this.zEm.on = sleeping && this.model.pose === 'curl';
  }

  ctx() {
    const h = this.clock.hour;
    const human = this.human;
    return { h, n: this.needs, state: this.state, human, robot: this.robot };
  }

  choose() {
    if (this.queue.length) {
      const id = this.queue.shift();
      if (id === 'greet' && this.human && !this.human.away) {
        // 跑到门口迎接
        const d = this.house.catSpots.door;
        this.startPlan('greet', { id: 'greet', pos: d.pos, approach: d.approach, rot: d.rot, pose: 'stand', tags: [] });
        return;
      }
    }
    const { h, n, state, human, robot } = this.ctx();
    const night = inRange(h, 22, 6.5);
    const humanAsleep = human?.asleep;
    const humanSofa = human?.phase === 'act' && ['sofaTV', 'sofaGuitar'].includes(human.atSpot?.id);
    const opts = {
      sleep: (100 - n.energy) / 25 + (night ? 1.5 : 0.3),
      eat: state.catFood > 0.1 && n.hunger < 65 ? 3 * u2(n.hunger) + 0.8 : 0,
      beg: state.catFood <= 0.1 && n.hunger < 55 ? 3 : 0,
      drink: state.catWater > 0.1 && n.thirst < 60 ? 2 * u2(n.thirst) + 0.5 : 0,
      litter: n.bladder < 35 ? 6 * u2(n.bladder) + 1 : 0,
      groom: 0.6,
      wander: 0.5,
      window: inRange(h, 7, 19) ? 0.5 : 0,
      scratch: 0.35,
      treeTop: 0.45,
      sunny: inRange(h, 10, 16) ? 0.5 : 0,
      follow: human && !human.away && !humanAsleep && n.affection < 70 ? 0.9 : 0,
      sofa: humanSofa && n.affection < 85 ? 2.5 : 0,
      zoomies: n.energy > 70 && (inRange(h, 5, 7) || inRange(h, 20, 23)) ? 0.6 : 0,
      waitDoor: human?.away && human.step?.elapsed > 15 ? 2.5 : 0,
      robot: robot?.active && n.energy > 30 ? 1.6 : 0,
      bedNight: humanAsleep && night ? 3 : 0,
    };
    const list = Object.entries(opts).filter(([, s]) => s > 0).map(([id, s]) => ({ id, w: (id === this.lastId ? 0.3 : 1) * s * s * (0.7 + Math.random() * 0.6) }));
    let r = Math.random() * list.reduce((a, o) => a + o.w, 0);
    const chosen = list.find((o) => (r -= o.w) <= 0) ?? list[list.length - 1];
    this.startPlan(chosen.id);
  }

  spotFor(id) {
    const S = this.house.catSpots, h = this.clock.hour;
    const rnd = (arr) => S[arr[Math.floor(Math.random() * arr.length)]];
    switch (id) {
      case 'sleep': return rnd(inRange(h, 9, 17) ? ['catBed', 'sofaNap', 'beanbag', 'treeTop', 'bedDay', 'readChair', 'sunny'] : ['catBed', 'sofaNap', 'beanbag', 'treeTop', 'readChair']);
      case 'bedNight': return S.bedFoot;
      case 'eat': case 'beg': return S.food;
      case 'drink': return S.water;
      case 'litter': return S.litter;
      case 'window': return S.window;
      case 'scratch': return S.scratch;
      case 'treeTop': return S.treeTop;
      case 'sunny': return S.sunny;
      case 'sofa': return S.sofaSide;
      case 'waitDoor': return S.door;
      case 'robot': {
        const p = this.robot.root.position;
        const [x, z] = this.grid.snapFree(p.x - 0.4, p.z + 0.5);
        return { id: 'robot', pos: [x, 0, z], approach: [x, z], pose: 'crouch', tags: [] };
      }
      case 'follow': {
        const hp = this.human.c.root.position;
        const grid = this.grid;
        for (const [dx, dz] of [[0.8, 0.6], [-0.8, 0.6], [0.8, -0.6], [-0.8, -0.6], [0, 1], [1, 0]]) {
          const x = hp.x + dx, z = hp.z + dz;
          const rot = Math.atan2(hp.x - x, hp.z - z);
          // 坐下后头朝着小豆，头前面也要有空间
          if (grid.freeAt(x, z) && grid.clearance(x, z) > 0.45 && grid.clearance(x + Math.sin(rot) * 0.32, z + Math.cos(rot) * 0.32) > 0.14) {
            return { id: 'follow', pos: [x, 0, z], approach: [x, z], rot, pose: 'sit', tags: [] };
          }
        }
        return null;
      }
      default: {
        const p = this.grid.randomFree((x, z) => z > 4.6 && z < 14);
        return { id: 'free', pos: [p[0], 0, p[1]], approach: [p[0], p[1]], pose: 'sit', tags: [] };
      }
    }
  }

  startPlan(id, spot) {
    const defs = {
      sleep: { anim: null, minutes: [40, 140], label: '睡觉', emoji: '💤', poseOverride: 'curl' },
      bedNight: { anim: null, minutes: [120, 300], label: '在床尾陪睡', emoji: '💤', poseOverride: 'curl', id: 'sleep' },
      eat: { anim: 'eat', minutes: [2, 5], label: '吃猫粮', emoji: '🐟' },
      beg: { anim: 'beg', minutes: [10, 25], label: '守着空碗喵喵叫', emoji: '🍽️', poseOverride: 'sit' },
      drink: { anim: 'eat', minutes: [1, 2], label: '喝水', emoji: '💧' },
      litter: { anim: null, minutes: [1.5, 2.5], label: '上厕所', emoji: '💨' },
      groom: { anim: 'groom', minutes: [3, 6], label: '舔毛', emoji: '👅', here: true, poseOverride: 'sit' },
      wander: { anim: 'look', minutes: [2, 5], label: '巡视领地', emoji: '🐾' },
      window: { anim: 'look', minutes: [10, 25], label: '看窗外的鸟', emoji: '🐦' },
      scratch: { anim: 'scratch', minutes: [1, 2], label: '磨爪子', emoji: '🐾' },
      treeTop: { anim: null, minutes: [10, 30], label: '趴在猫爬架上', emoji: '😺', id: 'sleep' },
      sunny: { anim: null, minutes: [20, 40], label: '在阳台晒太阳', emoji: '☀️' },
      follow: { anim: 'look', minutes: [4, 10], label: '跟着小豆', emoji: '🐾' },
      sofa: { anim: null, minutes: [20, 60], label: '挨着小豆趴着', emoji: '🛋️', log: '跳上沙发挨着小豆' },
      zoomies: { anim: null, minutes: 0.5, label: '突然开始跑酷', emoji: '💨', log: '突然在屋里狂奔' },
      waitDoor: { anim: null, minutes: [10, 60], label: '在门口等小豆', emoji: '🚪', log: '蹲在门口等你回家' },
      robot: { anim: null, minutes: [3, 8], label: '盯着扫地机器人', emoji: '👀' },
      greet: { anim: 'rub', minutes: [1, 2], label: '蹭腿撒娇', emoji: '❤️', log: '跑过来蹭腿' },
    };
    const d = defs[id];
    if (d.here) {
      // 原地做：在家具上就留在原来的点位，在地上就是当前位置
      if (this.atSpot) spot = this.atSpot;
      else {
        // 不在任何点位上：当前位置贴着家具的话，挪到最近的空地再做
        const [x, z] = this.grid.freeAt(this.pos.x, this.pos.z) ? [this.pos.x, this.pos.z] : this.grid.snapFree(this.pos.x, this.pos.z);
        spot = { id: 'here', pos: [x, 0, z], approach: [x, z], pose: 'sit', tags: [] };
      }
    }
    spot = spot ?? this.spotFor(id);
    if (!spot) { this.plan = null; this.phase = 'idle'; this.startPlan('groom'); return; }
    this.plan = { ...d, id: d.id ?? id, kind: id, spot };
    this.lastId = id;
    if (d.log) this.onLog(`🐱 橘子${d.log}`);
    this.setStatus(d.emoji, d.label);
    if (id === 'zoomies') { this.runZoomies(); return; }
    this.goToPlanSpot();
  }

  runZoomies() {
    const grid = this.grid;
    const pts = Array.from({ length: 3 }, () => grid.randomFree((x, z) => z > 4.6 && z < 12));
    this.phase = 'move';
    this.mover.maxSpeed = 1.5;
    this.leaveSpot(() => {
      const next = (i) => {
        if (i >= pts.length) { this.mover.maxSpeed = 0.85; this.plan = null; this.phase = 'idle'; return; }
        if (!this.mover.goTo(pts[i], () => next(i + 1))) next(i + 1);
      };
      next(0);
    });
  }

  leaveSpot(done) {
    const s = this.atSpot;
    this.atSpot = null;
    this.leftSpot = s;
    if (!s || s.id === 'here') { this.engaged = null; done(); return; }
    this.engaged = s;
    const p = this.pos;
    const [ax, az] = s.approach;
    const segs = [];
    if (p.y > 0.05) {
      const heading = Math.atan2(ax - p.x, az - p.z);
      segs.push({ to: { rot: heading }, start: () => { this.model.pose = 'stand'; } });
      const via = s.via ? [...s.via].reverse() : [];
      let from = [p.x, p.y, p.z];
      for (const v of via) { segs.push(this.jumpSeg(from, v, 0.15)); from = v; }
      segs.push(this.jumpSeg(from, [ax, 0, az], 0.15));
      segs.push({ dur: 0.15, start: () => { this.airborne = false; } });
    } else {
      segs.push({ dur: 0.25, start: () => { this.model.pose = 'stand'; } });
    }
    this.mover.play(segs, () => { this.engaged = null; done(); });
  }

  // 跳跃：匀速飞行 + 抛物线，时长随距离变长
  jumpSeg(from, to, arc) {
    const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    return { dur: 0.35 + d * 0.35, to: { x: to[0], y: to[1], z: to[2] }, arc, ease: 'linear', start: () => { this.airborne = true; } };
  }

  goToPlanSpot() {
    const s = this.plan.spot;
    if (this.atSpot && this.atSpot === s) { this.beginAct(); return; }
    // 先确认走得到，走不到就待在原地（别先起身再发现去不了）
    const from = this.atSpot && this.pos.y > 0.05 ? this.atSpot.approach : [this.pos.x, this.pos.z];
    if (!this.grid.findPath(from, s.approach) && !this.house.grid.findPath(from, s.approach)) {
      // 去不了：原地舔会儿毛，过一会儿再想别的
      this.plan = null;
      this.phase = 'idle';
      if (s.id !== 'here') this.startPlan('groom');
      return;
    }
    this.phase = 'move';
    this.model.anim = null;
    const arrive = () => {
      this.engaged = s;
      const [x, y, z] = s.pos;
      const segs = [];
      const p = this.pos;
      if (s.jump) {
        const tx = s.via ? s.via[0][0] : x, tz = s.via ? s.via[0][2] : z;
        segs.push({ to: { rot: Math.atan2(tx - p.x, tz - p.z) } });
        segs.push({ dur: 0.3, start: () => { this.model.pose = 'crouch'; } });
        let from = [p.x, p.y, p.z];
        for (const v of s.via ?? []) { segs.push(this.jumpSeg(from, v, 0.2)); from = v; }
        segs.push(this.jumpSeg(from, [x, y, z], 0.2));
        segs.push({ dur: 0.2, start: () => { this.airborne = false; } });
      } else if (Math.hypot(x - p.x, z - p.z) > 0.03) {
        segs.push({ to: { rot: Math.atan2(x - p.x, z - p.z) } });
        segs.push({ to: { x, y, z }, walk: true });
      }
      if (s.rot != null) segs.push({ to: { rot: s.rot } });
      this.mover.play(segs, () => {
        this.atSpot = s;
        this.beginAct();
      });
    };
    this.leaveSpot(() => { if (!this.mover.goTo(s.approach, arrive)) { this.plan = null; this.phase = 'idle'; } });
  }

  beginAct() {
    const p = this.plan;
    this.phase = 'act';
    p.duration = pick(p.minutes);
    p.elapsed = 0;
    this.model.pose = p.poseOverride ?? p.spot.pose ?? 'sit';
    if (p.spot.id === 'treeTop' || p.spot.id === 'sofaSide') this.model.pose = 'loaf';
    this.model.anim = p.anim;
    if (p.kind === 'sunny') this.model.pose = 'loaf';
    this.heartEm.on = p.kind === 'greet';
    if (p.id === 'play' && this.interaction) this.interaction.arrived = true;
  }

  updateAct(gameMin) {
    const p = this.plan;
    p.elapsed += gameMin;
    const n = this.needs;
    if (p.rate) for (const [k, v] of Object.entries(p.rate)) n[k] = clamp(n[k] + (v * gameMin) / 60);
    if (p.kind === 'beg' && this.state.catFood > 0.1) { this.finish(); this.startPlan('eat'); return; }
    if (p.kind === 'sofa' && !(this.human?.phase === 'act' && ['sofaTV', 'sofaGuitar'].includes(this.human.atSpot?.id))) { this.finish(); return; }
    if (p.kind === 'bedNight' && !this.human?.asleep) { this.finish(); return; }
    if (p.kind === 'waitDoor' && !this.human?.away) { this.finish(); return; }
    if (p.kind === 'robot' && !this.robot?.active) { this.finish(); return; }
    if (p.id === 'play') return;
    if (p.elapsed >= p.duration) this.finish(true);
  }

  finish(completed) {
    const p = this.plan;
    if (completed) {
      const n = this.needs, S = this.state;
      if (p.kind === 'eat') { S.catFood = Math.max(0, S.catFood - 0.25); n.hunger = clamp(n.hunger + 55); }
      if (p.kind === 'drink') { S.catWater = Math.max(0, S.catWater - 0.15); n.thirst = clamp(n.thirst + 60); }
      if (p.kind === 'litter') { S.litter = Math.min(4, S.litter + 1); n.bladder = 100; }
      if (p.kind === 'scratch' || p.kind === 'window') n.fun = clamp(n.fun + 25);
      if (p.kind === 'sofa' || p.kind === 'follow' || p.kind === 'greet') n.affection = clamp(n.affection + 30);
    }
    this.plan = null;
    this.phase = 'idle';
    this.model.anim = null;
    if (!this.interaction) this.heartEm.on = false;
  }

  abortPlan() {
    if (this.pos.y > 0.05 && !this.atSpot) this.pos.y = 0;
    this.engaged = this.atSpot;
    this.mover.path = null;
    this.mover.segs = null;
    this.airborne = false;
    this.plan = null;
    this.phase = 'idle';
  }
}
