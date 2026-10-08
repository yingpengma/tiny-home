// 室内寻路网格：把地面切成 0.5m 的格子，墙和家具占的格子标记为不可走，用 A* 找路。

const SQRT2 = Math.SQRT2;
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

export class Grid {
  constructor(width, depth, cell = 0.5) {
    this.cell = cell;
    this.cols = Math.round(width / cell);
    this.rows = Math.round(depth / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  idx(c, r) { return r * this.cols + c; }
  inside(c, r) { return c >= 0 && r >= 0 && c < this.cols && r < this.rows; }
  isFree(c, r) { return this.inside(c, r) && !this.blocked[this.idx(c, r)]; }
  center(c, r) { return [(c + 0.5) * this.cell, (r + 0.5) * this.cell]; }
  toCell(x, z) { return [Math.floor(x / this.cell), Math.floor(z / this.cell)]; }
  freeAt(x, z) { const [c, r] = this.toCell(x, z); return this.isFree(c, r); }

  // 格子中心落在 (矩形 + pad) 里就算被占用，pad 约等于小人的半径
  blockRect(x0, z0, x1, z1, pad = 0.2) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const [x, z] = this.center(c, r);
        if (x > x0 - pad && x < x1 + pad && z > z0 - pad && z < z1 + pad) {
          this.blocked[this.idx(c, r)] = 1;
        }
      }
    }
  }

  nearestFree(c, r) {
    if (this.isFree(c, r)) return [c, r];
    const seen = new Uint8Array(this.cols * this.rows);
    const queue = [[c, r]];
    while (queue.length) {
      const [qc, qr] = queue.shift();
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
    const [sc, sr] = this.nearestFree(...this.toCell(from[0], from[1]));
    const [gc, gr] = this.nearestFree(...this.toCell(to[0], to[1]));
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
        // 斜着走不能切墙角
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

    if (start !== goal && parent[goal] === -1) return [to.slice()];

    const cells = [];
    for (let i = goal; i !== -1 && i !== start; i = parent[i]) {
      cells.push(this.center(i % this.cols, (i / this.cols) | 0));
    }
    cells.reverse();
    return this.smooth([from, ...cells, to]).slice(1);
  }

  // 拉直路径：能直接看到的点就跳过中间点
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
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const steps = Math.ceil(Math.hypot(dx, dz) / 0.1);
    const m = 0.12;
    for (let s = 1; s < steps; s++) {
      const x = a[0] + (dx * s) / steps, z = a[1] + (dz * s) / steps;
      if (!this.freeAt(x, z) || !this.freeAt(x + m, z) || !this.freeAt(x - m, z) ||
          !this.freeAt(x, z + m) || !this.freeAt(x, z - m)) return false;
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
