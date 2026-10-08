import * as THREE from 'three';

// 昼夜变化：按小时在关键帧之间插值天空颜色、太阳和环境光强度。

const SKY = [
  [0, '#0b1026'], [5, '#151b40'], [6, '#e59a6c'], [7.5, '#9fd2ef'], [16.5, '#9fd2ef'],
  [18.3, '#f0965f'], [19.5, '#2b2f63'], [21, '#10153a'], [24, '#0b1026'],
].map(([h, c]) => [h, new THREE.Color(c)]);
const SUN = [[0, 0], [5.6, 0], [6.5, 1.0], [9, 2.4], [15.5, 2.4], [18, 0.9], [19, 0], [24, 0]];
const HEMI = [[0, 0.45], [5.5, 0.5], [7, 1.2], [12, 1.5], [17, 1.2], [19.5, 0.55], [24, 0.45]];

function sample(keys, h) {
  for (let i = 1; i < keys.length; i++) {
    if (h <= keys[i][0]) {
      const [h0, v0] = keys[i - 1], [h1, v1] = keys[i];
      return [v0, v1, (h - h0) / (h1 - h0)];
    }
  }
  return [keys[0][1], keys[0][1], 0];
}
const num = (keys, h) => { const [a, b, t] = sample(keys, h); return a + (b - a) * t; };

export function createLighting(scene, center) {
  const hemi = new THREE.HemisphereLight('#ffffff', '#b5a58a', 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff4e0', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -15;
  sun.shadow.camera.right = sun.shadow.camera.top = 15;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.target.position.copy(center);
  scene.add(sun, sun.target);

  const sky = new THREE.Color();
  const nightSky = new THREE.Color('#7f8fd0'), daySky = new THREE.Color('#ffffff');
  const nightGround = new THREE.Color('#2a2a3a'), dayGround = new THREE.Color('#b5a58a');
  const warm = new THREE.Color('#ffb070'), white = new THREE.Color('#fff4e0');
  scene.background = sky;

  function update(hour) {
    const [c0, c1, t] = sample(SKY, hour);
    sky.lerpColors(c0, c1, t);

    const sunI = num(SUN, hour);
    const a = Math.PI * ((hour - 6) / 12);              // 6 点日出，18 点日落
    const elev = Math.max(0.15, Math.sin(a));
    sun.position.set(center.x - 16 * Math.cos(a), center.y + 20 * elev, center.z + 12);
    sun.intensity = sunI;
    sun.color.lerpColors(warm, white, Math.min(1, Math.sin(Math.max(0, a)) * 2));

    const hemiI = num(HEMI, hour);
    const day = Math.min(1, Math.max(0, (hemiI - 0.45) / 0.8));
    hemi.intensity = hemiI;
    hemi.color.lerpColors(nightSky, daySky, day);
    hemi.groundColor.lerpColors(nightGround, dayGround, day);

    return { sky, dark: sunI < 0.9 };
  }

  return { update };
}
