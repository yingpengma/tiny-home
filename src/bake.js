import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 把同一个父节点下、一起运动的纯色小零件合成一个顶点色网格，减少 draw call。
const vcMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export function isPlain(m) {
  return m && m.isMeshLambertMaterial && !m.map && !m.transparent && !m.vertexColors && !m.userData?.keep &&
    (!m.emissive || m.emissive.getHex() === 0);
}

export function colorize(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// meshes: 同一个 parent 的直接子网格；返回合并后的网格（已加到 parent 上）
export function bake(meshes, parent = meshes[0]?.parent) {
  const list = meshes.filter((m) => m?.isMesh && isPlain(m.material) && m.parent === parent);
  if (list.length < 2) return list[0] ?? null;
  const geos = list.map((m) => {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    return colorize(g, m.material.color);
  });
  const merged = new THREE.Mesh(mergeGeometries(geos), vcMaterial);
  merged.castShadow = list.some((m) => m.castShadow);
  merged.receiveShadow = true;
  for (const m of list) parent.remove(m);
  parent.add(merged);
  return merged;
}

// 合并某个组的所有直接子网格（可传入要排除的）
export function bakeGroup(group, except = []) {
  return bake(group.children.filter((c) => c.isMesh && !except.includes(c)), group);
}
