import * as THREE from 'three';

// Q 版小人：所有部件都用简单几何体拼出来，动作全部是程序化的关节旋转。
// 局部坐标：脚底在 y=0，面朝 +z。

const lerp = (a, b, k) => a + (b - a) * k;

export class Character {
  constructor({ shirt = '#f2a65a', pants = '#3d5a80', skin = '#f6d3b3', hair = '#4a3426' } = {}) {
    const m = (color) => new THREE.MeshLambertMaterial({ color });
    const shirtM = m(shirt), pantsM = m(pants), skinM = m(skin), hairM = m(hair);
    const darkM = m('#222222');

    this.root = new THREE.Group();
    this.poseGroup = new THREE.Group();
    this.root.add(this.poseGroup);
    const P = this.poseGroup;

    const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(x, y, z);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    // 腿：髋关节为旋转点
    const legGeo = new THREE.CapsuleGeometry(0.075, 0.2, 4, 10);
    const shoeGeo = new THREE.BoxGeometry(0.13, 0.07, 0.19);
    this.legs = [-0.085, 0.085].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.33, 0);
      P.add(pivot);
      mesh(legGeo, pantsM, pivot, 0, -0.17, 0);
      mesh(shoeGeo, darkM, pivot, 0, -0.3, 0.03);
      return pivot;
    });

    // 身体
    this.body = new THREE.Group();
    P.add(this.body);
    const torso = mesh(new THREE.CapsuleGeometry(0.17, 0.14, 6, 14), shirtM, this.body, 0, 0.47, 0);
    torso.scale.z = 0.8;
    const hips = mesh(new THREE.CylinderGeometry(0.182, 0.17, 0.14, 14), pantsM, this.body, 0, 0.32, 0);
    hips.scale.z = 0.8;

    // 手臂：肩关节为旋转点
    const armGeo = new THREE.CapsuleGeometry(0.058, 0.18, 4, 8);
    const handGeo = new THREE.SphereGeometry(0.06, 10, 8);
    this.arms = [-0.215, 0.215].map((x) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.62, 0);
      this.body.add(pivot);
      mesh(armGeo, shirtM, pivot, 0, -0.13, 0);
      mesh(handGeo, skinM, pivot, 0, -0.29, 0);
      return pivot;
    });

    // 头：脖子为旋转点
    this.head = new THREE.Group();
    this.head.position.set(0, 0.7, 0);
    this.body.add(this.head);
    mesh(new THREE.SphereGeometry(0.25, 20, 16), skinM, this.head, 0, 0.22, 0);
    const hairCap = mesh(
      new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hairM, this.head, 0, 0.23, -0.02,
    );
    hairCap.rotation.x = -0.35;
    const eyeGeo = new THREE.SphereGeometry(0.034, 8, 6);
    this.eyes = [-0.085, 0.085].map((x) => mesh(eyeGeo, darkM, this.head, x, 0.22, 0.225));
    const blushM = m('#f4a3a3');
    for (const x of [-0.15, 0.15]) {
      const b = mesh(new THREE.SphereGeometry(0.04, 8, 6), blushM, this.head, x, 0.15, 0.2);
      b.scale.set(1, 0.6, 0.4);
    }

    // 手持道具，挂在右手上
    const hand = this.arms[1];
    this.props = {
      cup: mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 10), m('#7ec8e3'), hand, 0, -0.33, 0.05),
      book: mesh(new THREE.BoxGeometry(0.2, 0.26, 0.04), m('#c0504d'), hand, -0.1, -0.33, 0.08),
      can: (() => {
        const g = new THREE.Group();
        mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 10), m('#5aa469'), g);
        const spout = mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 6), m('#5aa469'), g, 0, 0.03, 0.1);
        spout.rotation.x = 1.0;
        g.position.set(0, -0.36, 0.04);
        hand.add(g);
        return g;
      })(),
    };
    this.setProp(null);

    this.pose = 'stand';
    this.anim = 'idle';
    this.t = 0;
    this.walkPhase = 0;
    this.blinkT = 2;
  }

  setPose(pose) { this.pose = pose; }
  setAnim(anim) { this.anim = anim; }
  setProp(name) {
    for (const [k, o] of Object.entries(this.props)) o.visible = k === name;
  }

  // 头顶上方一点的世界坐标，用来放气泡
  bubbleAnchor(target) {
    this.head.getWorldPosition(target);
    target.y += this.pose === 'lie' ? 0.45 : 0.62;
    return target;
  }

  update(dt, walking) {
    this.t += dt;
    const t = this.t;
    const k = 1 - Math.exp(-14 * dt);

    // 目标关节角度
    const legBase = this.pose === 'sit' ? -Math.PI / 2 : 0;
    const tgt = {
      leg0: legBase, leg1: legBase, legZ0: 0, legZ1: 0,
      arm0x: 0, arm1x: 0, arm0z: -0.08, arm1z: 0.08,
      headX: 0, headY: 0, bodyY: 0,
      lie: this.pose === 'lie' ? -Math.PI / 2 : 0,
    };

    if (walking) {
      const s = Math.sin(this.walkPhase);
      tgt.leg0 = s * 0.6; tgt.leg1 = -s * 0.6;
      tgt.arm0x = -s * 0.5; tgt.arm1x = s * 0.5;
      tgt.bodyY = Math.abs(Math.cos(this.walkPhase)) * 0.035;
    } else {
      switch (this.anim) {
        case 'idle':
          tgt.headY = Math.sin(t * 0.7) * 0.5;
          tgt.headX = Math.sin(t * 0.37) * 0.08;
          break;
        case 'use':
          tgt.arm0x = tgt.arm1x = -1.1 + Math.sin(t * 3) * 0.08;
          tgt.headX = 0.15;
          break;
        case 'cook':
          tgt.arm0x = -1.0;
          tgt.arm1x = -1.2 + Math.sin(t * 6) * 0.15;
          tgt.arm1z = 0.08 + Math.cos(t * 6) * 0.2;
          tgt.headX = 0.3;
          break;
        case 'wash':
          tgt.arm0x = -1.0 + Math.sin(t * 9) * 0.1;
          tgt.arm1x = -1.0 - Math.sin(t * 9) * 0.1;
          tgt.headX = 0.35;
          break;
        case 'eat': {
          tgt.arm0x = -1.0;
          const bite = (Math.sin(t * 3.2) + 1) / 2;
          tgt.arm1x = -1.0 - bite * 1.4;
          tgt.headX = 0.15 - bite * 0.1;
          break;
        }
        case 'drink':
          tgt.arm1x = -2.3;
          tgt.arm1z = -0.3;
          tgt.headX = -0.25;
          break;
        case 'type':
          tgt.arm0x = -1.25 + Math.sin(t * 14) * 0.05;
          tgt.arm1x = -1.25 + Math.cos(t * 13) * 0.05;
          tgt.headX = 0.08;
          break;
        case 'read':
          tgt.arm0x = tgt.arm1x = -1.15;
          tgt.arm0z = 0.25; tgt.arm1z = -0.25;
          tgt.headX = 0.3 + Math.sin(t * 0.5) * 0.04;
          break;
        case 'tv':
          tgt.headY = Math.sin(t * 0.2) * 0.06;
          tgt.bodyY = Math.max(0, Math.sin(t * 9)) * (Math.sin(t * 0.6) > 0.85 ? 0.03 : 0); // 偶尔笑一下
          break;
        case 'toilet':
          tgt.headY = Math.sin(t * 0.4) * 0.3;
          tgt.headX = 0.2;
          tgt.arm0x = tgt.arm1x = -0.6;
          break;
        case 'shower':
          tgt.arm0x = -2.7 + Math.sin(t * 8) * 0.2;
          tgt.arm1x = -2.7 + Math.cos(t * 8) * 0.2;
          tgt.headX = -0.2;
          tgt.headY = Math.sin(t * 2) * 0.2;
          break;
        case 'exercise': {
          const j = (Math.sin(t * 7) + 1) / 2;
          tgt.arm0z = -0.2 - j * 2.6; tgt.arm1z = 0.2 + j * 2.6;
          tgt.legZ0 = -j * 0.3; tgt.legZ1 = j * 0.3;
          tgt.bodyY = Math.abs(Math.sin(t * 7)) * 0.12;
          break;
        }
        case 'water':
          tgt.arm1x = -1.1;
          tgt.arm1z = 0.4 + Math.sin(t * 2) * 0.1;
          tgt.headX = 0.3;
          break;
        case 'sleep':
          tgt.bodyY = Math.sin(t * 1.2) * 0.008;
          break;
      }
    }

    const [l0, l1] = this.legs, [a0, a1] = this.arms;
    l0.rotation.x = lerp(l0.rotation.x, tgt.leg0, k);
    l1.rotation.x = lerp(l1.rotation.x, tgt.leg1, k);
    l0.rotation.z = lerp(l0.rotation.z, tgt.legZ0, k);
    l1.rotation.z = lerp(l1.rotation.z, tgt.legZ1, k);
    a0.rotation.x = lerp(a0.rotation.x, tgt.arm0x, k);
    a1.rotation.x = lerp(a1.rotation.x, tgt.arm1x, k);
    a0.rotation.z = lerp(a0.rotation.z, tgt.arm0z, k);
    a1.rotation.z = lerp(a1.rotation.z, tgt.arm1z, k);
    this.head.rotation.x = lerp(this.head.rotation.x, tgt.headX, k);
    this.head.rotation.y = lerp(this.head.rotation.y, tgt.headY, k * 0.5);
    this.poseGroup.position.y = lerp(this.poseGroup.position.y, tgt.bodyY, k);
    this.poseGroup.rotation.x = lerp(this.poseGroup.rotation.x, tgt.lie, 1 - Math.exp(-6 * dt));

    // 眨眼；睡觉时闭眼
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    const closed = this.anim === 'sleep' && !walking;
    const eyeY = closed ? 0.15 : this.blinkT < 0 ? 0.2 : 1;
    for (const e of this.eyes) e.scale.y = eyeY;
  }
}
