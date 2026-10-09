import * as THREE from 'three';
import { Mover } from './motion.js';
import { inRange } from './activities.js';

// 扫地机器人，照真实扫地机器人的习惯：
// 每天上午定时出发，一个房间一个房间按顺序扫（每个房间先沿墙边和家具边走一圈，再一趟挨一趟来回走直线），\n// 全屋扫完（两个小时左右）才回座充电。
// 有电量：扫到一半没电了、或者小豆去睡觉了，就先回座，之后从没扫完的房间接着扫。
// 移动按游戏时间算（真实机器人的速度），所以两种时间模式下用时一样；加速模式下看起来像延时摄影。

const DOCK = [10.15, 2.42];
// 按房间分区；一个格子归第一个包含它的区。[名字, x0, z0, x1, z1]
const ROOMS = [
  ['卧室', 0, 0, 5, 4.5],
  ['卫生间', 5, 0, 9, 4.2],
  ['洗衣角', 9, 0, 10.6, 4.4],
  ['厨房', 10.6, 0, 16, 4.4],
  ['工作区', 0, 4.5, 5, 7.2],
  ['客厅', 0, 7.2, 6.2, 12],
  ['健身角', 6.2, 8.5, 12.5, 12],
  ['过道', 5, 4.2, 12.5, 8.5],
  ['餐厅', 12.5, 4.4, 16, 8],
  ['玄关', 12.5, 8, 16, 12],
];
const START_HOUR = 10;          // 每天几点出发
const WORK_HOURS = [10, 21];    // 这段时间内、小豆醒着才会出来
const SPEED = 0.135;              // 米/秒（游戏时间）
const BATTERY_MIN = 180;        // 满电能扫多少游戏分钟
const CHARGE_MIN = 180;         // 从空到满充多少游戏分钟
const SUBSTEP = 0.1;            // 每次推进的游戏秒数上限（加速模式下一帧要走很多步）

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// 从充电座能走到的所有格子
function reachable(grid, from) {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const [sc, sr] = grid.nearestReachable(from[0], from[1]);
  const stack = [[sc, sr]];
  seen[grid.idx(sc, sr)] = 1;
  while (stack.length) {
    const [c, r] = stack.pop();
    for (const [dc, dr] of DIRS) {
      const nc = c + dc, nr = r + dr;
      if (!grid.isFree(nc, nr) || seen[grid.idx(nc, nr)]) continue;
      if (dc && dr && (!grid.isFree(c + dc, r) || !grid.isFree(c, r + dr))) continue;
      seen[grid.idx(nc, nr)] = 1;
      stack.push([nc, nr]);
    }
  }
  return seen;
}

const roomOf = (x, z) => ROOMS.findIndex(([, x0, z0, x1, z1]) => x >= x0 && x < x1 && z >= z0 && z < z1);

// 沿边：把房间里贴着墙和家具的格子连成一条条线，依次走一遍（只保留拐点）
function edgeRoute(grid, cells, start) {
  const touchesWall = (i) => {
    const c = i % grid.cols, r = (i / grid.cols) | 0;
    return DIRS.some(([dc, dr]) => !grid.isFree(c + dc, r + dr));
  };
  const edge = new Set(cells.filter(touchesWall));
  const pts = [];
  let at = start;
  while (edge.size) {
    let cur = null, bd = Infinity;
    for (const i of edge) {
      const [x, z] = grid.center(i % grid.cols, (i / grid.cols) | 0);
      const d = Math.hypot(x - at[0], z - at[1]);
      if (d < bd) { bd = d; cur = i; }
    }
    edge.delete(cur);
    const chain = [cur];
    let dir = null;
    for (;;) {
      const c = cur % grid.cols, r = (cur / grid.cols) | 0;
      let next = null;
      for (const d of dir ? [dir, ...DIRS] : DIRS) {
        const nc = c + d[0], nr = r + d[1];
        if (grid.inside(nc, nr) && edge.has(grid.idx(nc, nr))) { next = grid.idx(nc, nr); dir = d; break; }
      }
      if (next == null) break;
      edge.delete(next);
      chain.push(next);
      cur = next;
    }
    const xy = chain.map((i) => grid.center(i % grid.cols, (i / grid.cols) | 0));
    xy.forEach((p, k) => {
      const a = xy[k - 1], b = xy[k + 1];
      const turn = !a || !b || Math.abs((p[0] - a[0]) - (b[0] - p[0])) > 1e-6 || Math.abs((p[1] - a[1]) - (b[1] - p[1])) > 1e-6;
      if (turn) pts.push(p);
    });
    at = xy[xy.length - 1];
  }
  return pts;
}

// 来回扫：每行格子走一趟，方向一趟一反，每趟只记连续空地的两端
function zigzagRoute(grid, cells) {
  const byRow = new Map();
  for (const i of cells) {
    const r = (i / grid.cols) | 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(i % grid.cols);
  }
  const pts = [];
  let flip = false;
  for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
    const cols = byRow.get(r).sort((a, b) => a - b);
    const runs = [];
    for (const c of cols) {
      const last = runs[runs.length - 1];
      if (last && last[1] === c - 1) last[1] = c;
      else runs.push([c, c]);
    }
    if (flip) { runs.reverse(); runs.forEach((x) => x.reverse()); }
    for (const [a, b] of runs) {
      pts.push(grid.center(a, r));
      if (b !== a) pts.push(grid.center(b, r));
    }
    flip = !flip;
  }
  return pts;
}

// 每个房间：先沿边走一圈，再来回扫
function roomRoutes(grid, reach) {
  const cells = ROOMS.map(() => []);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const i = grid.idx(c, r);
      if (!reach[i]) continue;
      const k = roomOf(...grid.center(c, r));
      if (k >= 0) cells[k].push(i);
    }
  }
  return cells.map((list, k) => {
    if (!list.length) return null;
    let sx = 0, sz = 0;
    for (const i of list) { const [x, z] = grid.center(i % grid.cols, (i / grid.cols) | 0); sx += x; sz += z; }
    const center = [sx / list.length, sz / list.length];
    return {
      name: ROOMS[k][0], center, area: list.length * grid.cell * grid.cell,
      route: [...edgeRoute(grid, list, center), ...zigzagRoute(grid, list)],
    };
  }).filter(Boolean);
}

// 从充电座出发，每次去最近的下一个房间
function roomOrder(rooms) {
  const left = rooms.slice(), out = [];
  let at = DOCK;
  while (left.length) {
    left.sort((a, b) => Math.hypot(a.center[0] - at[0], a.center[1] - at[1]) - Math.hypot(b.center[0] - at[0], b.center[1] - at[1]));
    const next = left.shift();
    out.push(next);
    at = next.center;
  }
  return out;
}

export class Robot {
  constructor({ house, clock, particles }) {
    this.house = house;
    this.clock = clock;
    const M = (c, o = {}) => new THREE.MeshLambertMaterial({ color: c, ...o });
    this.root = new THREE.Group();
    const add = (geo, mat, y, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = !!o.shadow;
      this.root.add(m);
      return m;
    };
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 24), M('#f2f2f2'), 0.045, { shadow: true });
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.012, 24), M('#3a3a3a'), 0.085);
    add(new THREE.TorusGeometry(0.17, 0.012, 6, 24), M('#9a9a9a'), 0.03).rotation.x = Math.PI / 2;
    this.lightMat = new THREE.MeshBasicMaterial({ color: '#3fd16b' });
    const led = add(new THREE.SphereGeometry(0.015, 8, 6), this.lightMat, 0.095);
    led.position.z = 0.09;
    this.brushes = [-1, 1].map((s) => {
      const g = new THREE.Group();
      g.position.set(0.12 * s, 0.012, 0.11);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.004, 0.012), M('#555555'));
      g.add(b);
      this.root.add(g);
      return g;
    });
    this.root.position.set(DOCK[0], 0, DOCK[1]);
    this.root.rotation.y = Math.PI;
    this.mover = new Mover(this.root, house.grid, { maxSpeed: SPEED, accel: 0.6, decel: 0.8, turnSpeed: 2.5 });
    this.dustEm = particles.emitter('dust', () => { const p = this.root.position; return [p.x, 0.03, p.z]; }, 3);
    this.human = null;

    this.rooms = roomOrder(roomRoutes(house.grid, reachable(house.grid, DOCK)));
    this.state = 'docked';      // docked 在座上 / cleaning 在扫 / returning 回座
    this.battery = 1;
    this.doneDay = 0;           // 哪天已经扫完全屋
    this.pending = [];          // 今天还没扫的房间
    this.room = null;
    this.wp = 0;
  }

  // 猫只关心它在不在外面跑
  get active() { return this.state !== 'docked'; }
  get charging() { return this.state === 'docked' && this.battery < 1; }

  canWork() {
    return inRange(this.clock.hour, ...WORK_HOURS) && !this.human?.asleep;
  }

  update(simDt, gameMin) {
    if (Math.abs(gameMin) > 20) {
      // 时间跳了一大段：直接回到座上，没扫完的房间之后接着扫
      if (this.state === 'cleaning' && this.room) this.pending.unshift(this.room);
      this.mover.path = this.mover.segs = null;
      this.state = 'docked';
      this.room = null;
      this.battery = 1;
      this.root.position.set(DOCK[0], 0, DOCK[1]);
      this.root.rotation.y = Math.PI;
      return;
    }
    const t = Math.max(0, gameMin) * 60; // 游戏秒
    const today = this.clock.day;

    if (this.state === 'docked') {
      this.battery = Math.min(1, this.battery + gameMin / CHARGE_MIN);
      if (this.doneDay !== today && this.clock.hour >= START_HOUR && this.canWork() && this.battery >= 0.8) {
        if (this.runDay !== today) { this.runDay = today; this.pending = this.rooms.slice(); }
        this.nextRoom();
      }
    } else {
      this.battery = Math.max(0, this.battery - gameMin / BATTERY_MIN);
      if (this.state === 'cleaning' && (!this.canWork() || this.battery < 0.15)) {
        this.pending.unshift(this.room); // 这个房间没扫完，回来以后重扫
        this.goHome();
      }
    }

    for (let left = t; left > 1e-6; left -= SUBSTEP) this.mover.update(Math.min(SUBSTEP, left));
    const moving = this.mover.speed > 0.02;
    const out = this.state !== 'docked';
    this.brushes.forEach((b, i) => { if (out) b.rotation.y += Math.min(t, 1) * (i ? 14 : -14); });
    this.dustEm.on = this.state === 'cleaning' && moving;
    this.lightMat.color.set(out ? '#4aa3ff' : this.charging ? '#ffae42' : '#3fd16b');
  }

  nextRoom() {
    this.room = this.pending.shift() ?? null;
    if (!this.room) {
      // 全屋扫完
      this.doneDay = this.clock.day;
      if (this.state !== 'docked') this.goHome();
      return;
    }
    this.state = 'cleaning';
    this.wp = 0;
    this.nextWaypoint();
  }

  nextWaypoint() {
    if (this.state !== 'cleaning') return;
    const route = this.room.route;
    while (this.wp < route.length) {
      const p = route[this.wp++];
      if (this.mover.goTo(p, () => this.nextWaypoint())) return;
    }
    this.nextRoom(); // 这个房间扫完，直接去下一个
  }

  goHome() {
    this.state = 'returning';
    this.room = null;
    const dock = () => {
      this.mover.play([{ to: { x: DOCK[0], z: DOCK[1], rot: Math.PI } }], () => { this.state = 'docked'; });
    };
    if (!this.mover.goTo(DOCK, dock)) dock();
  }
}
