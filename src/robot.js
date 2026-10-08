import * as THREE from 'three';
import { Mover } from './motion.js';
import { inRange } from './activities.js';

// 扫地机器人：每天上午、下午各出来扫一圈，扫完自己回充电座。

const DOCK = [10.15, 2.42];

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
    this.mover = new Mover(this.root, house.grid, { maxSpeed: 0.35, accel: 1, decel: 1, turnSpeed: 2.5 });
    this.active = false;
    this.returning = false;
    this.dustEm = particles.emitter('dust', () => { const p = this.root.position; return [p.x, 0.03, p.z]; }, 3);
    this.human = null;
  }

  shouldRun(h) {
    return (inRange(h, 10.5, 11.2) || inRange(h, 15.5, 16.2)) && !this.human?.asleep;
  }

  update(simDt, gameMin) {
    if (Math.abs(gameMin) > 20) {
      this.mover.path = null;
      this.active = this.returning = false;
      this.root.position.set(DOCK[0], 0, DOCK[1]);
      return;
    }
    const h = this.clock.hour;
    const want = this.shouldRun(h);
    if (want && !this.active && !this.returning) {
      this.active = true;
      this.next();
    } else if (!want && this.active && !this.returning) {
      this.returning = true;
      const ok = this.mover.goTo(DOCK, () => { this.active = false; this.returning = false; });
      if (!ok) { this.active = false; this.returning = false; }
    }
    this.mover.update(simDt);
    const moving = this.mover.speed > 0.02;
    this.brushes.forEach((b, i) => { if (this.active) b.rotation.y += simDt * (i ? 14 : -14); });
    this.dustEm.on = this.active && moving;
    this.lightMat.color.set(this.active ? '#4aa3ff' : '#3fd16b');
  }

  next() {
    if (!this.active || this.returning) return;
    for (let i = 0; i < 5; i++) {
      const p = this.house.grid.randomFree((x, z) => z > 4.6 && z < 12 && !(x > 5 && x < 9 && z < 4.3));
      if (this.mover.goTo(p, () => this.next())) return;
    }
  }
}
