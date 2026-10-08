import * as THREE from 'three';

// 轻量粒子：每种粒子一个 Points（一次 draw call），CPU 更新，数量有上限。

function glyphTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const softDot = () => glyphTexture((g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
});
const text = (s, color, font = 'bold 46px sans-serif') => glyphTexture((g) => {
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.strokeText(s, 32, 34);
  g.fillStyle = color;
  g.fillText(s, 32, 34);
});
const ring = () => glyphTexture((g) => {
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fill();
});

// 每种粒子的外观和运动
const TYPES = {
  steam: { tex: softDot, color: '#ffffff', max: 80, life: [1.6, 2.4], size: [0.12, 0.35], vel: [0, 0.35, 0], spread: [0.05, 0.02, 0.05], alpha: 0.45, grow: 1.8, drift: 0.12 },
  mist: { tex: softDot, color: '#e8f4fb', max: 60, life: [2, 3], size: [0.3, 0.6], vel: [0, 0.2, 0], spread: [0.25, 0.05, 0.25], alpha: 0.3, grow: 1.5, drift: 0.15 },
  water: { tex: softDot, color: '#6fc3ee', max: 160, life: [0.35, 0.55], size: [0.035, 0.05], vel: [0, -2.2, 0], spread: [0.1, 0.02, 0.1], alpha: 0.9, gravity: -6 },
  drip: { tex: softDot, color: '#6fc3ee', max: 60, life: [0.25, 0.4], size: [0.03, 0.045], vel: [0, -0.6, 0], spread: [0.04, 0.01, 0.04], alpha: 0.9, gravity: -8 },
  bubble: { tex: ring, color: '#ffffff', max: 50, life: [1.2, 2.2], size: [0.05, 0.11], vel: [0, 0.12, 0], spread: [0.4, 0.02, 0.2], alpha: 0.85, drift: 0.05 },
  note: { tex: () => text('♪', '#7a5cc2'), color: '#ffffff', max: 24, life: [2.2, 3], size: [0.16, 0.22], vel: [0, 0.35, 0], spread: [0.15, 0.02, 0.15], alpha: 1, drift: 0.25, sway: 1 },
  note2: { tex: () => text('♫', '#d0567a'), color: '#ffffff', max: 24, life: [2.2, 3], size: [0.16, 0.22], vel: [0, 0.35, 0], spread: [0.15, 0.02, 0.15], alpha: 1, drift: 0.25, sway: 1 },
  z: { tex: () => text('Z', '#5b7bd5', 'bold 52px sans-serif'), color: '#ffffff', max: 16, life: [2.5, 3.2], size: [0.1, 0.16], vel: [0.06, 0.22, 0], spread: [0.02, 0.01, 0.02], alpha: 1, grow: 1.6, sway: 0.6 },
  heart: { tex: () => text('❤', '#e8577a', 'bold 50px sans-serif'), color: '#ffffff', max: 16, life: [1.4, 2], size: [0.1, 0.15], vel: [0, 0.4, 0], spread: [0.1, 0.02, 0.1], alpha: 1, grow: 1.3, sway: 0.5 },
  dust: { tex: softDot, color: '#d8cdb8', max: 30, life: [0.5, 0.9], size: [0.05, 0.1], vel: [0, 0.15, 0], spread: [0.12, 0.01, 0.12], alpha: 0.5, grow: 1.5 },
};

const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  uniform float uScale;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  uniform vec3 color;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(color * t.rgb, t.a * vAlpha);
    if (gl_FragColor.a < 0.02) discard;
    #include <colorspace_fragment>
  }`;

const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor(scene) {
    this.systems = {};
    this.emitters = new Set();
    this.uniforms = [];
    for (const [name, def] of Object.entries(TYPES)) {
      const n = def.max;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n), 1));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(n), 1));
      const uScale = { value: 800 };
      this.uniforms.push(uScale);
      const mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: def.tex() }, color: { value: new THREE.Color(def.color) }, uScale },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = 5;
      scene.add(points);
      this.systems[name] = {
        def, points, geo,
        parts: Array.from({ length: n }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 0.1, seed: 0 })),
        cursor: 0,
      };
    }
  }

  setViewport(height, pixelRatio, fov) {
    const s = (height * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    for (const u of this.uniforms) u.value = s;
  }

  // 持续发射器：pos 可以是数组或返回数组的函数；rate 为每秒个数
  emitter(type, pos, rate, opts = {}) {
    const e = { type, pos, rate, on: false, acc: 0, ...opts };
    this.emitters.add(e);
    return e;
  }

  burst(type, [x, y, z], count = 1) {
    for (let i = 0; i < count; i++) this.spawn(type, x, y, z);
  }

  spawn(type, x, y, z, opts = {}) {
    const sys = this.systems[type], d = sys.def;
    const p = sys.parts[sys.cursor];
    sys.cursor = (sys.cursor + 1) % sys.parts.length;
    const sp = opts.spread ?? d.spread;
    p.alive = true;
    p.x = x + rand(-sp[0], sp[0]); p.y = y + rand(-sp[1], sp[1]); p.z = z + rand(-sp[2], sp[2]);
    const v = opts.vel ?? d.vel;
    p.vx = v[0] + rand(-1, 1) * (d.drift ?? 0); p.vy = v[1] * rand(0.8, 1.2); p.vz = v[2] + rand(-1, 1) * (d.drift ?? 0);
    p.age = 0;
    p.life = rand(...d.life);
    p.size = rand(...d.size);
    p.seed = Math.random() * 10;
  }

  update(dt) {
    for (const e of this.emitters) {
      if (!e.on || e.rate <= 0) continue;
      e.acc += dt * e.rate;
      const pos = typeof e.pos === 'function' ? e.pos() : e.pos;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(e.type, pos[0], pos[1], pos[2], e);
      }
    }
    for (const sys of Object.values(this.systems)) {
      const d = sys.def;
      const pos = sys.geo.attributes.position.array;
      const size = sys.geo.attributes.aSize.array;
      const alpha = sys.geo.attributes.aAlpha.array;
      let any = false;
      sys.parts.forEach((p, i) => {
        if (p.alive) {
          p.age += dt;
          if (p.age >= p.life) p.alive = false;
        }
        if (!p.alive) { alpha[i] = 0; size[i] = 0; return; }
        any = true;
        if (d.gravity) p.vy += d.gravity * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (d.sway) p.x += Math.sin(p.age * 3 + p.seed) * d.sway * dt * 0.3;
        const u = p.age / p.life;
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        size[i] = p.size * (1 + (d.grow ? (d.grow - 1) * u : 0));
        alpha[i] = d.alpha * Math.min(1, u * 6) * (1 - u * u);
      });
      sys.points.visible = any;
      if (any) {
        sys.geo.attributes.position.needsUpdate = true;
        sys.geo.attributes.aSize.needsUpdate = true;
        sys.geo.attributes.aAlpha.needsUpdate = true;
      }
    }
  }
}
