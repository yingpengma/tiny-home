import { ACTIVITIES, inRange } from './activities.js';
import { Mover, wrapAngle } from './motion.js';

// 小豆的大脑：需求随时间下降 → 给每件事打分 → 加权随机挑一件 → 按步骤执行。
// 每一步 = 走到交互点 → 分段过渡（转身/坐下/躺下……）→ 做动作 → 起身离开。

export const NEEDS = [
  { key: 'hunger', label: '饱腹', icon: '🍚' },
  { key: 'thirst', label: '水分', icon: '💧' },
  { key: 'bladder', label: '膀胱', icon: '🚽' },
  { key: 'energy', label: '精力', icon: '⚡' },
  { key: 'fun', label: '娱乐', icon: '🎮' },
  { key: 'hygiene', label: '清洁', icon: '🧼' },
];

const DECAY_AWAKE = { hunger: 6, thirst: 6.5, bladder: 7.5, energy: 4.5, fun: 4.5, hygiene: 3.5 };
const DECAY_ASLEEP = { hunger: 1.5, thirst: 2, bladder: 2.5, energy: 0, fun: 0, hygiene: 1 };
const JUMP_MINUTES = 20;
const R2 = Math.PI / 2;

const clamp = (v) => Math.min(100, Math.max(0, v));
const pick = (v) => (Array.isArray(v) ? v[0] + Math.random() * (v[1] - v[0]) : v);
const freshDaily = () => ({ brushedMorning: false, brushedNight: false, coffee: false, tea: false, breakfast: false, exercise: false, skincare: false, bath: false, work: 0 });

export class Agent {
  constructor({ character, house, clock, particles, onLog = () => {} }) {
    this.c = character;
    this.house = house;
    this.state = house.state;
    this.clock = clock;
    this.onLog = onLog;
    this.mover = new Mover(character.root, house.grid, { maxSpeed: 1.3 });
    this.needs = { hunger: 70, thirst: 65, bladder: 70, energy: 80, fun: 60, hygiene: 70 };
    this.plan = null;
    this.phase = 'idle';
    this.atSpot = null;
    this.engaged = null;   // 正在进入/使用/离开的交互点（碰撞检测时排除它的家具）
    this.lastId = null;
    this.wakeAt = null;
    this.queue = [];
    this.daily = freshDaily();
    this.dayKey = this.logicalDay();
    this.status = { emoji: '💭', label: '', walking: false, away: false };
    this.cat = null;
    this.gestureT = 5;
    this.wetUntil = -1;
    this._hp = [0, 0, 0];
    this.zEm = particles.emitter('z', () => this.headPos(0.3), 0.6);
    this.noteEm = particles.emitter('note', () => this.headPos(-0.1), 1.0);
    this.noteEm2 = particles.emitter('note2', () => this.headPos(-0.05), 0.8);
    this._spout = [0, 0, 0];
    this.canEm = particles.emitter('drip', () => {
      const p = this.c.props.can.localToWorld(this.c._v.set(0, 0.03, 0.24));
      this._spout[0] = p.x; this._spout[1] = p.y; this._spout[2] = p.z;
      return this._spout;
    }, 30, { spread: [0.02, 0.01, 0.02] });
  }

  get step() { return this.plan?.steps[this.plan.i]; }
  get asleep() { return this.phase === 'act' && !!this.step?.asleep; }
  get away() { return this.phase === 'away'; }

  headPos(dy) {
    const p = this.c.headC.getWorldPosition(this.c._v);
    this._hp[0] = p.x; this._hp[1] = p.y + dy; this._hp[2] = p.z;
    return this._hp;
  }

  logicalDay() { return Math.floor((this.clock.minutes - 240) / 1440); }

  // ---------- 初始状态 ----------
  start() {
    const h = this.clock.hour;
    if (inRange(h, 22.5, 6.5)) {
      this.needs = { hunger: 70, thirst: 65, bladder: 60, energy: 45, fun: 60, hygiene: 75 };
      this.startAsleep();
    } else {
      for (const k of Object.keys(this.needs)) this.needs[k] = 45 + Math.random() * 45;
      this.daily.brushedMorning = this.daily.breakfast = h > 10;
      this.placeStanding();
    }
  }

  placeStanding() {
    const s = this.randomSpot();
    this.c.root.position.set(s.use[0], 0, s.use[2]);
    this.c.root.rotation.y = s.rot;
    this.c.root.visible = true;
    this.c.setPose('stand');
    this.c.setLean(0);
    this.c.snap();
  }

  startAsleep() {
    const bed = this.house.spots.bed;
    this.c.setOutfit({ top: 'pajamas', coat: false, shoes: false, towel: false });
    this.state.curtainsClosed = true;
    this.daily.brushedNight = true;
    this.c.root.position.set(...bed.use);
    this.c.root.rotation.y = bed.rot;
    this.c.root.visible = true;
    this.c.setPose('lie');
    this.c.setLean(0);
    this.c.snap();
    this.house.setFx('duvet', 'cover');
    this.atSpot = bed;
    this.engaged = bed;
    this.startPlan('sleep', '还在呼呼大睡');
  }

  wetHair(minutes) {
    this.wetUntil = this.clock.minutes + minutes;
    this.c.setOutfit({ towel: true });
  }

  // ---------- 主循环 ----------
  update(simDt, gameMin) {
    if (Math.abs(gameMin) > JUMP_MINUTES) {
      this.handleTimeJump();
      return this.mover.loco;
    }
    const key = this.logicalDay();
    if (key !== this.dayKey) { this.dayKey = key; this.daily = freshDaily(); }
    if (gameMin > 0) this.decay(gameMin);
    if (this.wetUntil > 0 && this.clock.minutes > this.wetUntil) {
      this.wetUntil = -1;
      this.c.setOutfit({ towel: false });
    }

    if (this.phase === 'away') this.updateAway(gameMin);
    else if (!this.plan) this.choose();
    if (this.phase === 'act') this.updateAct(gameMin, simDt);

    const loco = this.mover.update(simDt);
    // 走近要用的家具、或刚离开家具的最后/最初一小段，允许和那件家具贴近
    if (this.phase === 'move' && this.mover.path) {
      const p = this.c.root.position;
      const near = (s) => s && Math.hypot(p.x - s.approach[0], p.z - s.approach[1]) < 0.45;
      const target = this.step?.spot;
      this.engaged = near(target) ? target : near(this.leftSpot) ? this.leftSpot : null;
    }
    this.status.walking = this.mover.speed > 0.05 && !!this.mover.path;
    this.status.away = this.phase === 'away';

    // 表情、小动作、粒子
    const n = this.needs;
    this.c.setExpressionBase(n.energy < 25 ? 'sleepy' : n.hunger < 25 || n.bladder < 20 || n.thirst < 20 ? 'sad' : 'neutral');
    if (this.phase === 'act' && ['idle', 'lookout'].includes(this.step?.anim)) {
      this.gestureT -= simDt;
      if (this.gestureT <= 0) {
        this.gestureT = 5 + Math.random() * 7;
        const opts = ['lookAround', 'stretch', 'scratch'];
        if (n.energy < 40) opts.push('yawn', 'yawn');
        if (n.hunger < 40) opts.push('rubBelly', 'rubBelly');
        this.c.playGesture(opts[Math.floor(Math.random() * opts.length)]);
      }
    }
    this.zEm.on = this.asleep && this.c.root.visible;
    const playing = this.phase === 'act' && !!this.step?.notes;
    this.noteEm.on = this.noteEm2.on = playing;
    this.canEm.on = this.phase === 'act' && this.step?.anim === 'water';
    this.c.flags.catOnRight = !!(this.cat?.onSofaSide && this.atSpot?.id === 'sofaTV');
    return loco;
  }

  decay(gameMin) {
    const table = this.asleep ? DECAY_ASLEEP : DECAY_AWAKE;
    for (const k of Object.keys(table)) this.needs[k] = clamp(this.needs[k] - (table[k] * gameMin) / 60);
  }

  // 后台挂了很久或切换时间模式：放下手里的事，按新时间重新开始
  handleTimeJump() {
    if (this.plan && this.phase === 'act') this.stepFx(this.step, false);
    this.plan = null;
    this.phase = 'idle';
    this.atSpot = null;
    this.engaged = null;
    this.queue = [];
    this.mover.path = null;
    this.mover.segs = null;
    this.mover.speed = 0;
    this.resetWorld();
    this.cat?.endInteraction();
    if (inRange(this.clock.hour, 22.5, 6.5)) this.startAsleep();
    else {
      this.c.setOutfit({ coat: false, shoes: false });
      this.placeStanding();
    }
  }

  resetWorld() {
    const H = this.house, S = this.state;
    for (const f of ['fridge', 'wardrobe', 'dishwasherOpen', 'door', 'tv', 'tvGame', 'monitor', 'stove', 'coffee', 'shower', 'bathTap', 'kTap', 'tubFill', 'bath', 'treadmill', 'eating', 'pillow']) H.setFx(f, false);
    H.setFx('plate', false);
    H.setFx('duvet', 'made');
    H.setChair('deskChair', 0);
    H.setChair('diningChair', 0);
    S.remoteTaken = S.guitarTaken = S.dumbbellsTaken = S.wandTaken = S.toothbrushTaken = S.coatTaken = false;
    this.c.setProps(null);
    this.c.setAnim('idle');
    this.c.root.visible = true;
  }

  // ---------- 决策 ----------
  ctx() {
    return {
      h: this.clock.hour, day: this.clock.day, dow: this.clock.dow, minutes: this.clock.minutes,
      n: this.needs, daily: this.daily, state: this.state, char: this.c, cat: this.cat, agent: this, house: this.house,
      minutesUntilWake: () => this.minutesUntilWake(),
    };
  }

  choose() {
    if (this.queue.length) {
      const id = this.queue.shift();
      if (this.startPlan(id)) return;
    }
    const ctx = this.ctx();
    const options = [];
    for (const [id, a] of Object.entries(ACTIVITIES)) {
      let s = a.score(ctx);
      if (!(s > 0)) continue;
      if (id === this.lastId && !a.repeatable) s *= 0.3;
      options.push({ id, w: s ** 3 * (0.7 + Math.random() * 0.6) });
    }
    let r = Math.random() * options.reduce((sum, o) => sum + o.w, 0);
    const chosen = options.find((o) => (r -= o.w) <= 0) ?? options[options.length - 1];
    if (!this.startPlan(chosen.id)) this.startPlan('idle');
  }

  startPlan(id, logText) {
    const a = ACTIVITIES[id];
    const ctx = this.ctx();
    const steps = a.steps(ctx).map((s) => ({ ...s, spot: typeof s.spot === 'string' ? this.house.spots[s.spot] : s.spot }));
    if (!steps.length) return false;
    this.plan = { id, a, steps, i: 0 };
    this.lastId = id;
    this.onLog(`${steps[0].emoji} ${logText ?? a.log}`);
    this.startStep();
    return true;
  }

  minutesUntilWake() {
    const now = this.clock.minutes;
    if (!(this.wakeAt > now && this.wakeAt - now < 12 * 60)) {
      const dayStart = Math.floor(now / 1440) * 1440;
      const weekend = this.clock.dow === 0 || this.clock.dow === 6 || (this.clock.hour > 12 && (this.clock.dow === 5 || this.clock.dow === 6));
      let w = dayStart + ((weekend ? 7.5 : 6.5) + Math.random() * 1.25) * 60;
      if (w <= now) w += 1440;
      this.wakeAt = w;
    }
    return this.wakeAt - now;
  }

  randomSpot() {
    const p = this.house.grid.randomFree((x, z) => (z > 4.5 && z < 12) || (z > 12.3 && Math.random() < 0.3));
    return { id: 'free', kind: 'stand', use: [p[0], 0, p[1]], approach: [p[0], p[1]], rot: Math.random() * Math.PI * 2, tags: [] };
  }

  // 撸猫的位置：猫旁边一个空位，面朝猫。猫在地上就蹲下，猫在沙发/床上就站着弯腰
  petSpot() {
    const cat = this.cat;
    if (!cat?.pettable) return null;
    const p = cat.root.position;
    const grid = this.house.grid;
    const high = p.y > 0.2;
    const tags = high ? [...(cat.atSpot?.tags ?? [])] : [];
    const angles = [0.6, -0.6, 1.4, -1.4, 0, 2.2, -2.2, Math.PI].map((a) => a + Math.PI / 4);
    for (const d of high ? [0.6, 0.7, 0.8] : [0.62, 0.72, 0.82]) {
      for (const a of angles) {
        const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d;
        // 蹲下时膝盖和脚会往前伸，需要更大的空间
        if (grid.freeAt(x, z) && grid.clearance(x, z) > (high ? 0.34 : 0.45)) {
          const rot = Math.atan2(p.x - x, p.z - z);
          return { id: 'pet', kind: high ? 'stand' : 'crouch', use: [x, 0, z], approach: [x - Math.sin(rot) * 0.2, z - Math.cos(rot) * 0.2], rot, tags };
        }
      }
    }
    return null;
  }

  // ---------- 执行步骤 ----------
  startStep() {
    const step = this.step;
    if (typeof step.spot === 'function') step.spot = step.spot();
    if (!step.spot) { this.endPlan(false); return; }
    this.c.setProps(step.props ?? null);
    this.status.emoji = step.emoji;
    this.status.label = step.label;
    if (step.cat === 'play') this.cat?.beginInteraction('play', this, this.house.spots.playArea);
    const spot = step.spot;
    if (this.atSpot && this.atSpot === spot) { this.beginAct(); return; }
    this.phase = 'move';
    const go = () => {
      if (step.away) { this.goOut(step); return; }
      const ok = this.mover.goTo(spot.approach, () => {
        this.engaged = spot;
        this.mover.play(this.enterSeq(spot), () => {
          this.atSpot = spot;
          this.beginAct();
        });
      });
      if (!ok) this.endPlan(false);
    };
    if (this.atSpot) {
      const from = this.atSpot;
      this.engaged = from;
      this.mover.play(this.exitSeq(from), () => { this.atSpot = null; this.leftSpot = from; go(); });
    } else go();
  }

  // 进入交互点的分段过渡
  enterSeq(s) {
    const c = this.c, H = this.house;
    const [ux, uy, uz] = s.use;
    const P = (pose, lean = 0) => () => { c.setPose(pose); c.setLean(lean); };
    const p = c.root.position;
    let px = p.x, pz = p.z;
    const seq = [];
    const moveTo = (x, z, y) => {
      const d = Math.hypot(x - px, z - pz);
      if (d > 0.03) {
        seq.push({ to: { rot: Math.atan2(x - px, z - pz) } });
        seq.push({ to: { x, z, y }, walk: true });
      }
      px = x; pz = z;
    };
    const turn = (rot) => seq.push({ to: { rot } });

    switch (s.kind) {
      case 'stand':
      case 'crouch': {
        // 交互点就在正前方：转身后往前一步；否则先走过去再转身
        const ahead = Math.hypot(ux - px, uz - pz) < 0.03 || Math.abs(wrapAngle(Math.atan2(ux - px, uz - pz) - s.rot)) < 0.35;
        if (ahead) {
          turn(s.rot);
          if (s.door) seq.push({ dur: 0.55, start: () => H.setFx(s.door, true) });
          seq.push({ to: { x: ux, y: uy, z: uz }, walk: true });
        } else {
          if (s.door) seq.push({ dur: 0.55, start: () => H.setFx(s.door, true) });
          moveTo(ux, uz, uy);
          turn(s.rot);
        }
        if (s.kind === 'crouch') seq.push({ dur: 0.45, start: P('crouch') });
        break;
      }
      case 'sit':
        turn(s.rot);
        seq.push({ dur: 0.7, to: { x: ux, y: uy, z: uz }, start: P('sit', 0.35) });
        seq.push({ dur: 0.25, start: P('sit', 0) });
        break;
      case 'sitBack':
        turn(s.rot);
        seq.push({ dur: 0.75, to: { x: ux, y: uy, z: uz }, start: P('sit', 0.2) });
        seq.push({ dur: 0.2, start: P('sit', 0) });
        break;
      case 'chair': {
        const ch = s.chair;
        const c1 = [ch.from[0] + ch.out[0], ch.from[1] + ch.out[1]];
        const fin = [ch.from[0] + ch.out[0] * (1 - ch.tuck), ch.from[1] + ch.out[1] * (1 - ch.tuck)];
        seq.push({ dur: 0.5, start: () => H.setChair(ch.name, 1) });
        moveTo(s.front[0], s.front[1], 0);
        turn(s.rot);
        seq.push({ dur: 0.75, to: { x: c1[0], y: uy, z: c1[1] }, start: P('sit', 0.35) });
        seq.push({ dur: 0.6, to: { x: fin[0], y: uy, z: fin[1] }, start: () => { H.setChair(ch.name, 1 - ch.tuck); c.setLean(0); } });
        break;
      }
      case 'lie': {
        const [ex, ey, ez, er] = s.edge;
        turn(er);
        seq.push({ dur: 0.7, to: { x: ex, y: ey, z: ez }, start: () => { P('sit', 0.3)(); H.setFx('duvet', 'folded'); } });
        seq.push({ dur: 0.25, start: P('sit', 0) });
        seq.push({ dur: 1.4, to: { x: ux, y: uy, z: uz, rot: s.rot }, start: () => { P('lie')(); H.setFx('pillow', true); } });
        seq.push({ dur: 0.5, start: () => H.setFx('duvet', 'cover') });
        break;
      }
      case 'tub': {
        const [ix, iy, iz] = s.inside;
        turn(0);
        seq.push({ dur: 0.85, to: { x: ix, y: iy, z: iz }, arc: 0.55, walk: true });
        turn(s.rot);
        seq.push({ dur: 0.9, to: { x: ux, y: uy, z: uz }, start: P('tub') });
        break;
      }
      case 'shower':
        moveTo(s.via[0], s.via[1], 0);
        moveTo(ux, uz, uy);
        turn(s.rot);
        break;
      case 'treadmill':
        turn(s.rot);
        seq.push({ dur: 0.6, to: { x: ux, y: uy, z: uz }, arc: 0.1, walk: true });
        break;
    }
    return seq;
  }

  exitSeq(s) {
    const c = this.c, H = this.house;
    const [ax, az] = s.approach;
    const P = (pose, lean = 0) => () => { c.setPose(pose); c.setLean(lean); };
    const p = c.root.position;
    let px = p.x, pz = p.z;
    // 先把手上的动作收回来，再起身/转身
    const seq = [{ dur: 0.3, start: () => c.setAnim('idle') }];
    const moveTo = (x, z, y = 0) => {
      const d = Math.hypot(x - px, z - pz);
      if (d > 0.03) {
        seq.push({ to: { rot: Math.atan2(x - px, z - pz) } });
        seq.push({ to: { x, z, y }, walk: true });
      }
      px = x; pz = z;
    };

    switch (s.kind) {
      case 'stand':
      case 'crouch': {
        if (s.kind === 'crouch') seq.push({ dur: 0.4, start: P('stand') });
        const behind = Math.abs(wrapAngle(Math.atan2(px - ax, pz - az) - c.root.rotation.y)) < 0.35;
        if (behind) seq.push({ to: { x: ax, y: 0, z: az }, walk: true });
        else moveTo(ax, az);
        if (s.door) seq.push({ dur: 0.3, start: () => H.setFx(s.door, false) });
        break;
      }
      case 'sit':
        seq.push({ dur: 0.25, start: P('sit', 0.35) });
        seq.push({ dur: 0.6, to: { x: ax, y: 0, z: az }, start: P('stand', 0.3) });
        seq.push({ dur: 0.15, start: P('stand', 0) });
        break;
      case 'sitBack':
        seq.push({ dur: 0.25, start: P('sit', 0.3) });
        seq.push({ dur: 0.65, to: { x: ax, y: 0, z: az }, start: P('stand', 0.2) });
        seq.push({ dur: 0.15, start: P('stand', 0) });
        break;
      case 'chair': {
        const ch = s.chair;
        const c1 = [ch.from[0] + ch.out[0], ch.from[1] + ch.out[1]];
        seq.push({ dur: 0.55, to: { x: c1[0], z: c1[1] }, start: () => { H.setChair(ch.name, 1); c.setLean(0.3); } });
        seq.push({ dur: 0.6, to: { x: s.front[0], y: 0, z: s.front[1] }, start: P('stand', 0.25) });
        seq.push({ dur: 0.15, start: P('stand', 0) });
        px = s.front[0]; pz = s.front[1];
        moveTo(ax, az);
        seq.push({ dur: 0.45, start: () => H.setChair(ch.name, 0) });
        break;
      }
      case 'lie': {
        const [ex, ey, ez, er] = s.edge;
        seq.push({ dur: 0.5, start: () => H.setFx('duvet', 'folded') });
        seq.push({ dur: 1.2, to: { x: ex, y: ey, z: ez, rot: er }, start: () => { P('sit')(); H.setFx('pillow', false); } });
        seq.push({ dur: 0.6, to: { x: ax, y: 0, z: az }, start: P('stand', 0.3) });
        seq.push({ dur: 0.2, start: () => { P('stand', 0)(); H.setFx('duvet', 'made'); } });
        break;
      }
      case 'tub': {
        const [ix, iy, iz] = s.inside;
        seq.push({ dur: 0.8, to: { x: ix, y: iy, z: iz }, start: P('stand') });
        seq.push({ to: { rot: Math.PI } });
        seq.push({ dur: 0.85, to: { x: ax, y: 0, z: az }, arc: 0.55, walk: true });
        break;
      }
      case 'shower':
        moveTo(s.via[0], s.via[1]);
        moveTo(ax, az);
        break;
      case 'treadmill':
        seq.push({ to: { rot: Math.PI } });
        seq.push({ dur: 0.6, to: { x: ax, y: 0, z: az }, arc: 0.1, walk: true });
        break;
    }
    return seq;
  }

  // 出门：走到门口 → 开门 → 走到屋外消失 → 过一阵子带着东西回来
  goOut(step) {
    const s = step.spot, H = this.house, c = this.c;
    const ok = this.mover.goTo(s.approach, () => { this.engaged = s; this.mover.play([
      { to: { rot: R2 } },
      { dur: 0.8, start: () => H.setFx('door', true) },
      { to: { x: s.use[0], z: s.use[2] }, walk: true },
      { to: { x: s.outside[0], y: -0.25, z: s.outside[1] }, walk: true, ease: 'linear', start: () => this.onLog(`🚪 ${step.label}`) },
    ], () => {
      c.root.visible = false;
      H.setFx('door', false);
      this.phase = 'away';
      this.engaged = null;
      step.duration = pick(step.minutes);
      step.elapsed = 0;
      this.status.label = step.label;
    }); });
    if (!ok) this.endPlan(false);
  }

  updateAway(gameMin) {
    const step = this.step;
    step.elapsed += gameMin;
    if (step.elapsed < step.duration) return;
    const s = step.spot, H = this.house, c = this.c;
    this.phase = 'move';
    c.root.visible = true;
    this.engaged = s;
    c.setProps(step.returnProps ?? null);
    this.status.label = '回家';
    this.cat?.notifyHome();
    this.mover.play([
      { to: { rot: -R2 } },
      { dur: 0.4, start: () => H.setFx('door', true) },
      { to: { x: s.use[0], y: 0, z: s.use[2] }, walk: true, ease: 'linear' },
      { to: { x: s.approach[0], z: s.approach[1] }, walk: true },
      { dur: 0.4, start: () => H.setFx('door', false) },
    ], () => {
      this.onLog('🏠 回到家了');
      this.engaged = null;
      this.finishStep(true);
    });
  }

  stepFx(step, on) {
    const list = !step.fx ? [] : Array.isArray(step.fx) ? step.fx : [step.fx];
    for (const f of list) this.house.setFx(f, on);
  }

  beginAct() {
    const step = this.step;
    this.phase = 'act';
    this.c.setAnim(step.anim);
    const m = typeof step.minutes === 'function' ? step.minutes() : step.minutes;
    step.duration = Math.max(0.2, pick(m));
    step.elapsed = 0;
    step.midDone = false;
    step.rates = {};
    for (const [k, v] of Object.entries(step.gain ?? {})) step.rates[k] = (step.rates[k] ?? 0) + v / step.duration;
    for (const [k, v] of Object.entries(step.rate ?? {})) step.rates[k] = (step.rates[k] ?? 0) + v / 60;
    this.stepFx(step, true);
    step.onStart?.(step);
    if (step.cat === 'pet') {
      if (!this.cat?.beginInteraction('pet', this)) { this.finishStep(false); return; }
    }
    if (step.cat === 'play' && this.cat && !this.cat.interactingWith(this)) {
      this.cat.beginInteraction('play', this, this.house.spots.playArea);
    }
    this.gestureT = 3 + Math.random() * 4;
  }

  updateAct(gameMin) {
    const step = this.step;
    const dt = Math.max(0, Math.min(gameMin, step.duration - step.elapsed));
    step.elapsed += gameMin;
    for (const [k, r] of Object.entries(step.rates)) this.needs[k] = clamp(this.needs[k] + r * dt);
    if (!step.midDone && step.elapsed >= step.duration / 2) {
      step.midDone = true;
      step.onMid?.(step);
    }

    const n = this.needs;
    if (step.asleep && (n.bladder < 12 || n.thirst < 8)) {
      this.onLog(inRange(this.clock.hour, 5, 12) ? '😣 被憋醒了' : '😣 半夜醒了…');
      this.finishStep(false);
      return;
    }
    if (this.plan.a.interruptible && (n.bladder < 12 || n.hunger < 12 || n.thirst < 12 ||
      (this.plan.id === 'work' && (n.fun < 12 || n.energy < 15)) || (inRange(this.clock.hour, 23, 5) && n.energy < 30))) {
      this.finishStep(false);
      return;
    }
    if (step.cat && this.cat && !this.cat.interactingWith(this)) {
      if (step.cat === 'play' && step.elapsed < 2) this.cat.beginInteraction('play', this, this.house.spots.playArea);
      else { this.finishStep(true); return; }
    }
    if (step.elapsed >= step.duration) this.finishStep(true);
  }

  // completed=false 表示被打断：剩下的步骤也不做了
  finishStep(completed) {
    const step = this.step;
    this.stepFx(step, false);
    if (completed && !step.midDone) step.onMid?.(step);
    step.onEnd?.(step);
    if (step.cat) this.cat?.endInteraction();
    this.plan.i++;
    if (completed && this.plan.i < this.plan.steps.length) {
      this.startStep();
      return;
    }
    this.endPlan(completed, step);
  }

  endPlan(completed, step) {
    const plan = this.plan;
    const S = this.state;
    S.remoteTaken = S.guitarTaken = S.dumbbellsTaken = S.wandTaken = S.toothbrushTaken = false;
    this.c.setProps(null);
    this.c.setAnim('idle');
    this.plan = null;
    this.phase = 'idle';
    if (completed && step?.asleep) {
      if (plan.id === 'sleep') {
        this.onLog('☀️ 起床啦，新的一天');
        this.queue.push('wakeUp');
      } else this.onLog('🥱 午睡醒了');
    }
    plan?.a.onDone?.(this);
  }
}
