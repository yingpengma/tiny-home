import * as THREE from 'three';

// 接触阴影：会动的东西脚下一片淡淡的深色圆片。
// 屋子有屋顶，屋里没有太阳投下的硬影子，但离地近的地方本来就更暗一点，有这一片东西就不会显得飘。

let blobTex = null;
function texture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export class ContactShadows {
  constructor(parent) {
    this.parent = parent;
    this.items = [];
    this.geo = new THREE.CircleGeometry(1, 24);
  }

  // target: 跟随的对象；mover: 提供 groundY（跳跃时阴影留在落点高度）；radius 米；opacity 最深处不透明度
  add(target, mover, radius, opacity = 0.3) {
    const mat = new THREE.MeshBasicMaterial({ map: texture(), color: '#000000', transparent: true, opacity, depthWrite: false });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 1;
    this.parent.add(mesh);
    this.items.push({ target, mover, mesh, radius, opacity });
    return mesh;
  }

  update() {
    for (const it of this.items) {
      const p = it.target.position;
      const ground = it.mover?.groundY ?? p.y;
      const lift = Math.max(0, p.y - ground); // 离地越高，影子越淡越大
      it.mesh.visible = it.target.visible;
      it.mesh.position.set(p.x, ground + 0.008, p.z);
      it.mesh.scale.setScalar(it.radius * (1 + lift * 0.6));
      it.mesh.material.opacity = it.opacity * Math.max(0.25, 1 - lift * 1.5);
    }
  }
}
