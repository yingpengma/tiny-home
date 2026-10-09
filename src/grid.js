// 寻路网格：地面切成 0.25m 的格子，家具/墙的占地（按身体半径外扩）标记为不可走，A* 找路。
// 拉直路径时不只看格子，而是直接检查线段到每件家具轮廓的距离，保证走路时胳膊不会蹭到东西。

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class Grid {
  constructor(width, depth, cell = 0.25, radius = 0.3) {
    this.cell = cell;
    this.radius = radius;
    this.cols = Math.round(width / cell);
    this.rows = Math.round(depth / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.footprints = []; // [x0, z0, x1, z1]，未外扩
  }

  // 同样的家具，换一个身体半径（在原来的基础上再外扩）
  withRadius(radius) {
    const g = new Grid(this.cols * this.cell, this.rows * this.cell, this.cell, radius);
    g.blocked.set(this.blocked);
    for (const f of this.footprints) g.addFootprint(...f);
    return g;
  }

  idx(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  isFree(c, r) { return this.inside(c, r) && !this.blocked[this.idx(c, r)]; }
  center(c, r) { return [(c + 0.5) * this.cell, (r + 0.5) * this.cell]; }
  toCell(x, z) { return [Math.floor(x / this.cell), Math.floor(z / this.cell)]; }
  freeAt(x, z) { const [c, r] = this.toCell(x, z); return this.isFree(c, r); }

  // 家具占地：格子中心离矩形小于 radius 就不可走
  addFootprint(x0, z0, x1, z1) {
    this.footprints.push([x0, z0, x1, z1]);
    this.markRect(x0 - this.radius, z0 - this.radius, x1 + this.radius, z1 + this.radius, true);
  }

  // 只保留和 from 连通的空格，其它孤立的小空地标成不可走
  keepConnected(from) {
    const seen = new Uint8Array(this.cols * this.rows);
    const [sc, sr] = this.nearestFree(...this.toCell(from[0], from[1]));
    const stack = [[sc, sr]];
    seen[this.idx(sc, sr)] = 1;
    while (stack.length) {
      const [c, r] = stack.pop();
      for (const [dc, dr] of DIRS) {
        const nc = c + dc, nr = r + dr;
        if (!this.isFree(nc, nr) || seen[this.idx(nc, nr)]) continue;
        if (dc && dr && (!this.isFree(c + dc, r) || !this.isFree(c, r + dr))) continue;
        seen[this.idx(nc, nr)] = 1;
        stack.push([nc, nr]);
      }
    }
    for (let i = 0; i < seen.length; i++) if (!seen[i]) this.blocked[i] = 1;
  }

  // 直接标记区域（屋外、阳台以外等），不参与拉直检测
  markRect(x0, z0, x1, z1, value = true) {
    const c0 = Math.max(0, Math.floor(x0 / this.cell)), c1 = Math.min(this.cols - 1, Math.floor(x1 / this.cell));
    const r0 = Math.max(0, Math.floor(z0 / this.cell)), r1 = Math.min(this.rows - 1, Math.floor(z1 / this.cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const [x, z] = this.center(c, r);
        if (x > x0 && x < x1 && z > z0 && z < z1) this.blocked[this.idx(c, r)] = value ? 1 : 0;
      }
    }
  }

  // 点到所有家具轮廓的最小距离
  clearance(x, z, near = this.footprints) {
    let best = Infinity;
    for (const [x0, z0, x1, z1] of near) {
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
    return best;
  }

  // 线段到所有家具轮廓的距离都 >= r
  segClear(a, b, r) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.05));
    for (let s = 0; s <= steps; s++) {
      if (this.clearance(a[0] + (dx * s) / steps, a[1] + (dz * s) / steps) < r) return false;
    }
    return true;
  }

  // 离目标点最近、而且和目标点之间没有家具挡着的空格子
  nearestReachable(x, z) {
    let [c, r] = this.toCell(x, z);
    c = Math.max(0, Math.min(this.cols - 1, c));
    r = Math.max(0, Math.min(this.rows - 1, r));
    if (this.isFree(c, r)) return [c, r];
    const seen = new Uint8Array(this.cols * this.rows);
    const queue = [[c, r]];
    let head = 0, fallback = null;
    seen[this.idx(c, r)] = 1;
    while (head < queue.length) {
      const [qc, qr] = queue[head++];
      for (const [dc, dr] of DIRS) {
        const nc = qc + dc, nr = qr + dr;
        if (!this.inside(nc, nr) || seen[this.idx(nc, nr)]) continue;
        seen[this.idx(nc, nr)] = 1;
        if (this.isFree(nc, nr)) {
          fallback ??= [nc, nr];
          if (this.segClear(this.center(nc, nr), [x, z], 0.1)) return [nc, nr];
        }
        if (head < 4000) queue.push([nc, nr]);
      }
    }
    return fallback ?? [c, r];
  }

  // 把任意点吸附到最近的可达空格中心
  snapFree(x, z) {
    return this.center(...this.nearestReachable(x, z));
  }

  nearestFree(c, r) {
    if (this.isFree(c, r)) return [c, r];
    const seen = new Uint8Array(this.cols * this.rows);
    const queue = [[c, r]];
    let head = 0;
    while (head < queue.length) {
      const [qc, qr] = queue[head++];
      for (const [dc, dr] of DIRS) {
        const nc = qc + dc, nr = qr + dr;
        if (!this.inside(nc, nr) || seen[this.idx(nc, nr)]) continue;
        if (this.isFree(nc, nr)) return [nc, nr];
        seen[this.idx(nc, nr)] = 1;
        queue.push([nc, nr]);
      }
    }
    return [c, r];
  }

  // 返回从 from 到 to 的路径点（不含起点，含精确终点）
  findPath(from, to) {
    const [sc, sr] = this.nearestReachable(from[0], from[1]);
    const [gc, gr] = this.nearestReachable(to[0], to[1]);
    const start = this.idx(sc, sr), goal = this.idx(gc, gr);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const h = (c, r) => {
      const dx = Math.abs(c - gc), dz = Math.abs(r - gr);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    g[start] = 0;
    heap.push(start, h(sc, sr));

    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols, cr = (cur / this.cols) | 0;
      for (const [dc, dr, cost] of DIRS) {
        const nc = cc + dc, nr = cr + dr;
        if (!this.isFree(nc, nr)) continue;
        if (dc && dr && (!this.isFree(cc + dc, cr) || !this.isFree(cc, cr + dr))) continue;
        const ni = this.idx(nc, nr);
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          parent[ni] = cur;
          heap.push(ni, ng + h(nc, nr));
        }
      }
    }

    if (start !== goal && parent[goal] === -1) {
      this.failures = (this.failures ?? 0) + 1;
      (this.failLog ??= []).push([from.map((v) => +v.toFixed(2)), to.map((v) => +v.toFixed(2))]);
      return null; // 走不到：交给调用方处理，绝不直线穿过去
    }

    const cells = [];
    for (let i = goal; i !== -1 && i !== start; i = parent[i]) {
      cells.push(this.center(i % this.cols, (i / this.cols) | 0));
    }
    cells.reverse();
    // 起点/终点到最近格子中心之间的那一小段直接相连
    return this.smooth([from, ...cells, to]).slice(1);
  }

  smooth(points) {
    const out = [points[0]];
    let i = 0;
    while (i < points.length - 1) {
      let j = points.length - 1;
      while (j > i + 1 && !this.clearLine(points[i], points[j])) j--;
      out.push(points[j]);
      i = j;
    }
    return out;
  }

  clearLine(a, b) {
    const r = this.radius;
    const minX = Math.min(a[0], b[0]) - r - 0.05, maxX = Math.max(a[0], b[0]) + r + 0.05;
    const minZ = Math.min(a[1], b[1]) - r - 0.05, maxZ = Math.max(a[1], b[1]) + r + 0.05;
    const near = this.footprints.filter(([x0, z0, x1, z1]) => x1 > minX && x0 < maxX && z1 > minZ && z0 < maxZ);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.05));
    // 起终点本身允许稍微贴近（它们是格子中心或交互点）
    for (let s = 1; s < steps; s++) {
      const x = a[0] + (dx * s) / steps, z = a[1] + (dz * s) / steps;
      if (!this.freeAt(x, z)) return false;
      if (near.length && this.clearance(x, z, near) < r) return false;
    }
    return true;
  }

  randomFree(predicate = () => true) {
    const options = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = this.center(c, r);
        if (this.isFree(c, r) && predicate(p[0], p[1])) options.push(p);
      }
    }
    return options[Math.floor(Math.random() * options.length)];
  }
}

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const a = this.items, q = this.prio;
    a.push(item); q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (q[up] <= q[i]) break;
      [a[up], a[i]] = [a[i], a[up]];
      [q[up], q[i]] = [q[i], q[up]];
      i = up;
    }
  }
  pop() {
    const a = this.items, q = this.prio;
    const top = a[0];
    const lastItem = a.pop(), lastP = q.pop();
    if (a.length) {
      a[0] = lastItem; q[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [q[m], q[i]] = [q[i], q[m]];
        i = m;
      }
    }
    return top;
  }
}
