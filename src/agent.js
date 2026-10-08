import { ACTIVITIES, inRange } from './activities.js';

// 需求驱动的小人大脑：需求随时间下降 → 给每件事打分 → 加权随机挑一件 → 按步骤执行。

export const NEEDS = [
  { key: 'hunger', label: '饱腹', icon: '🍚' },
  { key: 'thirst', label: '水分', icon: '💧' },
  { key: 'bladder', label: '膀胱', icon: '🚽' },
  { key: 'energy', label: '精力', icon: '⚡' },
  { key: 'fun', label: '娱乐', icon: '🎮' },
  { key: 'hygiene', label: '清洁', icon: '🧼' },
];

// 每游戏小时下降多少
const DECAY_AWAKE = { hunger: 6, thirst: 8, bladder: 9, energy: 5.5, fun: 7, hygiene: 3.5 };
const DECAY_ASLEEP = { hunger: 1.5, thirst: 2, bladder: 3, energy: 0, fun: 0, hygiene: 1 };

const WALK_SPEED = 1.4;      // 米/秒（按真实时间）
const TRANSITION_TIME = 0.6; // 坐下/起身用时（秒）
const JUMP_MINUTES = 20;     // 一帧内时间跳变超过这个值就当作"跳时间"处理

const clamp = (v) => Math.min(100, Math.max(0, v));
const pick = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);
const smooth = (t) => t * t * (3 - 2 * t);
const angleLerp = (a, b, t) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Agent {
  constructor({ character, house, clock, onLog = () => {} }) {
    this.c = character;
    this.house = house;
    this.clock = clock;
    this.onLog = onLog;
    this.needs = { hunger: 70, thirst: 65, bladder: 70, energy: 80, fun: 60, hygiene: 70 };
    this.plan = null;
    this.phase = 'none';
    this.atSpot = null;
    this.lastId = null;
    this.lastPlantDay = -1;
    this.wakeAt = null;
    this.status = { emoji: '💭', label: '', walking: false };
  }

  get pos() { return this.c.root.position; }
  get asleep() { return this.phase === 'act' && !!this.step?.asleep; }
  get step() { return this.plan?.steps[this.plan.i]; }

  // ---------- 初始状态 ----------
  start() {
    const h = this.clock.hour;
    if (inRange(h, 22.5, 6.5)) {
      this.needs = { hunger: 70, thirst: 65, bladder: 60, energy: 50, fun: 60, hygiene: 60 };
      this.startAsleep();
    } else {
      // 白天打开页面：需求随机一点，从客厅某处开始
      for (const k of Object.keys(this.needs)) this.needs[k] = 45 + Math.random() * 45;
      const [x, z] = this.house.grid.randomFree((x, z) => z > 4.8);
      this.pos.set(x, 0, z);
      this.c.root.rotation.y = Math.random() * Math.PI * 2;
    }
  }

  startAsleep() {
    const bed = this.house.spots.bed;
    this.pos.set(...bed.use);
    this.c.root.rotation.y = bed.rot;
    this.c.setPose('lie');
    this.c.poseGroup.rotation.x = -Math.PI / 2;
    this.atSpot = bed;
    this.startPlan('sleep', '还在呼呼大睡');
  }

  // ---------- 主循环 ----------
  update(simDt, gameMin) {
    if (Math.abs(gameMin) > JUMP_MINUTES) {
      this.handleTimeJump();
      return;
    }
    if (gameMin > 0) this.decay(gameMin);
    if (!this.plan) this.choose();

    switch (this.phase) {
      case 'exit':
      case 'enter':
        this.updateTransition(simDt);
        break;
      case 'walk':
        this.updateWalk(simDt);
        break;
      case 'act':
        this.updateAct(gameMin);
        break;
    }
    this.status.walking = this.phase === 'walk';
  }

  decay(gameMin) {
    const table = this.asleep ? DECAY_ASLEEP : DECAY_AWAKE;
    for (const k of Object.keys(table)) this.needs[k] = clamp(this.needs[k] - (table[k] * gameMin) / 60);
  }

  // 后台挂了很久或切换了时间模式：放弃手上的事，按新时间重新开始
  handleTimeJump() {
    const spot = this.phase === 'enter' ? this.step.spot : this.atSpot;
    if (this.plan) this.finishStep(false);
    this.atSpot = null;
    if (inRange(this.clock.hour, 22.5, 6.5)) {
      this.startAsleep();
    } else if (spot) {
      const [x, z] = spot.approach;
      this.pos.set(x, 0, z);
      this.c.setPose('stand');
    }
  }

  // ---------- 决策 ----------
  ctx() {
    return {
      h: this.clock.hour,
      day: this.clock.day,
      n: this.needs,
      agent: this,
      minutesUntilWake: () => this.minutesUntilWake(),
      randomSpot: () => this.randomSpot(),
    };
  }

  choose() {
    const ctx = this.ctx();
    const options = [];
    for (const [id, a] of Object.entries(ACTIVITIES)) {
      let s = a.score(ctx);
      if (!(s > 0)) continue;
      if (id === this.lastId && !a.repeatable) s *= 0.3;
      options.push({ id, w: s * s * (0.7 + Math.random() * 0.6) });
    }
    let r = Math.random() * options.reduce((sum, o) => sum + o.w, 0);
    const chosen = options.find((o) => (r -= o.w) <= 0) ?? options[options.length - 1];
    this.startPlan(chosen.id);
  }

  startPlan(id, logText) {
    const a = ACTIVITIES[id];
    const steps = a.steps(this.ctx()).map((s) => ({
      ...s,
      spot: typeof s.spot === 'string' ? this.house.spots[s.spot] : s.spot,
    }));
    this.plan = { id, a, steps, i: 0 };
    this.lastId = id;
    this.onLog(`${steps[0].emoji} ${logText ?? a.log}`);
    this.startStep();
  }

  minutesUntilWake() {
    const now = this.clock.minutes;
    if (!(this.wakeAt > now && this.wakeAt - now < 12 * 60)) {
      const dayStart = Math.floor(now / 1440) * 1440;
      let w = dayStart + (6.5 + Math.random() * 1.25) * 60;
      if (w <= now) w += 1440;
      this.wakeAt = w;
    }
    return this.wakeAt - now;
  }

  randomSpot() {
    const [x, z] = this.house.grid.randomFree((x, z) => z > 4.6 || Math.random() < 0.3);
    return { name: '空地', approach: [x, z], use: [x, 0, z], rot: Math.random() * Math.PI * 2, pose: 'stand' };
  }

  // ---------- 执行步骤 ----------
  startStep() {
    const step = this.step;
    this.c.setProp(step.prop ?? null);
    this.status.emoji = step.emoji;
    this.status.label = step.label;
    if (this.atSpot === step.spot) this.beginAct();
    else if (this.atSpot) this.beginTransition('exit');
    else this.beginWalk();
  }

  beginTransition(kind) {
    const from = { x: this.pos.x, y: this.pos.y, z: this.pos.z, rot: this.c.root.rotation.y };
    let to;
    if (kind === 'exit') {
      const [x, z] = this.atSpot.approach;
      to = { x, y: 0, z, rot: from.rot };
      this.c.setPose('stand');
      this.c.setAnim('idle');
    } else {
      const s = this.step.spot;
      to = { x: s.use[0], y: s.use[1], z: s.use[2], rot: s.rot };
      this.c.setPose(s.pose);
      this.c.setAnim(this.step.anim);
    }
    this.transition = { kind, from, to, t: 0 };
    this.phase = kind;
  }

  updateTransition(simDt) {
    const tr = this.transition;
    tr.t = Math.min(1, tr.t + simDt / TRANSITION_TIME);
    const k = smooth(tr.t);
    this.pos.set(
      tr.from.x + (tr.to.x - tr.from.x) * k,
      tr.from.y + (tr.to.y - tr.from.y) * k,
      tr.from.z + (tr.to.z - tr.from.z) * k,
    );
    this.c.root.rotation.y = angleLerp(tr.from.rot, tr.to.rot, k);
    if (tr.t < 1) return;
    if (tr.kind === 'exit') {
      this.atSpot = null;
      this.beginWalk();
    } else {
      this.atSpot = this.step.spot;
      this.beginAct();
    }
  }

  beginWalk() {
    this.path = this.house.grid.findPath([this.pos.x, this.pos.z], this.step.spot.approach);
    this.phase = 'walk';
    this.c.setAnim('idle');
  }

  updateWalk(simDt) {
    let dist = WALK_SPEED * simDt;
    let heading = null;
    while (dist > 0 && this.path.length) {
      const [tx, tz] = this.path[0];
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) heading = Math.atan2(dx, dz);
      if (d <= dist) {
        this.pos.x = tx;
        this.pos.z = tz;
        this.path.shift();
        dist -= d;
      } else {
        this.pos.x += (dx / d) * dist;
        this.pos.z += (dz / d) * dist;
        dist = 0;
      }
    }
    this.pos.y = 0;
    this.c.walkPhase += WALK_SPEED * simDt * 5.5;
    if (heading !== null) {
      this.c.root.rotation.y = angleLerp(this.c.root.rotation.y, heading, 1 - Math.exp(-14 * simDt));
    }
    if (!this.path.length) this.beginTransition('enter');
  }

  beginAct() {
    const step = this.step;
    this.phase = 'act';
    this.c.setAnim(step.anim);
    this.c.setPose(step.spot.pose);
    step.duration = pick(step.minutes);
    step.elapsed = 0;
    step.rates = {};
    for (const [k, v] of Object.entries(step.gain ?? {})) step.rates[k] = (step.rates[k] ?? 0) + v / step.duration;
    for (const [k, v] of Object.entries(step.rate ?? {})) step.rates[k] = (step.rates[k] ?? 0) + v / 60;
    if (step.fx) this.house.setFx(step.fx, true);
  }

  updateAct(gameMin) {
    const step = this.step;
    const dt = Math.min(gameMin, step.duration - step.elapsed);
    step.elapsed += gameMin;
    for (const [k, r] of Object.entries(step.rates)) this.needs[k] = clamp(this.needs[k] + r * dt);

    const n = this.needs;
    if (step.asleep && (n.bladder < 8 || n.thirst < 6)) {
      this.onLog(this.clock.hour < 12 && this.clock.hour > 5 ? '😣 被憋醒了' : '😣 半夜被憋醒了…');
      this.finishStep(false);
      return;
    }
    if (this.plan.a.interruptible && (
      n.bladder < 12 || n.hunger < 12 || n.thirst < 12 ||
      (inRange(this.clock.hour, 23, 5) && n.energy < 30))) {
      this.finishStep(false);
      return;
    }
    if (step.elapsed >= step.duration) this.finishStep(true);
  }

  // completed=false 表示被打断：剩下的步骤也不做了
  finishStep(completed) {
    const step = this.step;
    if (step.fx) this.house.setFx(step.fx, false);
    const plan = this.plan;
    plan.i++;
    if (completed && plan.i < plan.steps.length) {
      this.startStep();
      return;
    }
    this.c.setProp(null);
    if (completed) {
      plan.a.onDone?.(this, this.clock.day);
      if (step.asleep && plan.id === 'sleep') this.onLog('☀️ 起床啦，新的一天');
      if (step.asleep && plan.id === 'nap') this.onLog('🥱 午睡醒了');
    }
    this.plan = null;
    this.phase = 'none';
    this.c.setAnim('idle');
  }
}
