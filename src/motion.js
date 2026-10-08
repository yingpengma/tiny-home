// 移动：沿寻路路径走（起步加速、到点减速、转弯先转头），以及分段过渡（转身、坐下、起身、跨进浴缸……）。

export const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
export const wrapAngle = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;
export const dirOf = (rot) => [Math.sin(rot), Math.cos(rot)];

export class Mover {
  constructor(obj, grid, { maxSpeed = 1.3, accel = 3, decel = 2.6, turnSpeed = 7 } = {}) {
    this.obj = obj;
    this.grid = grid;
    this.maxSpeed = maxSpeed;
    this.accel = accel;
    this.decel = decel;
    this.turnSpeed = turnSpeed;
    this.speed = 0;
    this.path = null;
    this.segs = null;
    this.loco = { speed: 0, dist: 0, look: 0, stepping: false };
  }

  get busy() { return !!(this.path || this.segs); }

  // 返回 false 表示走不到（自己的网格走不通时，再用备用网格试一次）
  goTo([x, z], onArrive) {
    const from = [this.obj.position.x, this.obj.position.z];
    const path = this.grid.findPath(from, [x, z]) ?? this.fallbackGrid?.findPath(from, [x, z]);
    if (!path) { this.path = null; return false; }
    this.path = path;
    this.onArrive = onArrive;
    return true;
  }

  // 路径剩余长度
  remaining() {
    let d = 0, px = this.obj.position.x, pz = this.obj.position.z;
    for (const [x, z] of this.path) { d += Math.hypot(x - px, z - pz); px = x; pz = z; }
    return d;
  }

  // segs: [{ dur, to:{x,y,z,rot}, walk, arc, start() }]
  play(segs, onDone) {
    this.path = null;
    this.segs = segs.filter(Boolean);
    this.segI = -1;
    this.onSegsDone = onDone;
    this.nextSeg();
  }

  nextSeg() {
    this.segI++;
    const seg = this.segs[this.segI];
    if (!seg) {
      const done = this.onSegsDone;
      this.segs = null;
      done?.();
      return;
    }
    const p = this.obj.position;
    seg.from = { x: p.x, y: p.y, z: p.z, rot: this.obj.rotation.y };
    const to = seg.to ?? {};
    seg.target = {
      x: to.x ?? p.x, y: to.y ?? p.y, z: to.z ?? p.z,
      rot: to.rot ?? this.obj.rotation.y,
    };
    if (seg.dur == null) {
      const dist = Math.hypot(seg.target.x - p.x, seg.target.z - p.z);
      const turn = Math.abs(wrapAngle(seg.target.rot - seg.from.rot));
      seg.dur = Math.max(0.15, dist / 0.9, turn / 4.5);
    }
    seg.t = 0;
    seg.start?.();
  }

  update(dt) {
    const loco = this.loco;
    loco.dist = 0; loco.look = 0; loco.stepping = false;
    const p = this.obj.position;

    if (this.segs) {
      const seg = this.segs[this.segI];
      seg.t = Math.min(seg.dur, seg.t + dt);
      const k = seg.ease === 'linear' ? seg.t / seg.dur : smooth(seg.t / seg.dur);
      const f = seg.from, g = seg.target;
      const nx = f.x + (g.x - f.x) * k, nz = f.z + (g.z - f.z) * k;
      const moved = Math.hypot(nx - p.x, nz - p.z);
      let ny = f.y + (g.y - f.y) * k;
      if (seg.arc) ny += Math.sin(Math.PI * k) * seg.arc;
      p.set(nx, ny, nz);
      this.obj.rotation.y = angleLerp(f.rot, g.rot, k);
      if (seg.walk) {
        loco.dist = moved;
        loco.stepping = true;
        loco.speed = dt > 0 ? moved / dt : 0;
      } else {
        loco.speed = 0;
        // 原地转身时脚下踏步
        if (Math.abs(wrapAngle(g.rot - f.rot)) > 0.4 && !seg.noStep && k < 1) loco.stepping = true;
      }
      this.speed = 0;
      if (seg.t >= seg.dur) this.nextSeg();
      return loco;
    }

    if (this.path) {
      if (!this.path.length) {
        this.path = null;
        this.speed = 0;
        loco.speed = 0;
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
        return loco;
      }
      const [tx, tz] = this.path[0];
      const dx = tx - p.x, dz = tz - p.z;
      const heading = Math.atan2(dx, dz);
      const err = Math.abs(wrapAngle(heading - this.obj.rotation.y));
      const rem = this.remaining();
      // 角度差大时先放慢转身；快到终点时按减速度刹车
      const cap = Math.min(this.maxSpeed * (err > 1.2 ? 0.15 : 1 - err * 0.45), Math.sqrt(2 * this.decel * rem) + 0.05);
      this.speed = this.speed < cap ? Math.min(cap, this.speed + this.accel * dt) : cap;
      let step = this.speed * dt;
      let moved = 0;
      while (step > 1e-6 && this.path.length) {
        const [wx, wz] = this.path[0];
        const ddx = wx - p.x, ddz = wz - p.z;
        const d = Math.hypot(ddx, ddz);
        if (d <= step) {
          p.x = wx; p.z = wz; step -= d; moved += d;
          this.path.shift();
        } else {
          p.x += (ddx / d) * step; p.z += (ddz / d) * step; moved += step;
          step = 0;
        }
      }
      p.y = 0;
      const turn = wrapAngle(heading - this.obj.rotation.y);
      const maxTurn = this.turnSpeed * dt;
      this.obj.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, turn));
      // 头先看向下一个拐点
      const next = this.path[1] ?? this.path[0];
      if (next) loco.look = Math.max(-0.7, Math.min(0.7, wrapAngle(Math.atan2(next[0] - p.x, next[1] - p.z) - this.obj.rotation.y)));
      loco.speed = this.speed;
      loco.dist = moved;
      loco.stepping = err > 0.5 && this.speed < 0.3;
      return loco;
    }

    loco.speed = 0;
    return loco;
  }
}
