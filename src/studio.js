// 工作室：包住公寓模型的一间大房间——深色地砖、冷灰墙面、两面墙的落地高窗、一张摆着材料样板的大工作台和几盆大植物。
// 窗外天色随时刻变化；太阳从窗户照进来，在地上投出跟随太阳方向移动的窗形光斑。
import * as THREE from 'three';
import { fixed } from './fixed.js';
import { FURNITURE } from './furniture.js';
import { MATERIALS, makeMaterial } from './materials.js';
import { boxUV } from './uv.js';

// 房间边界（世界坐标，米）。公寓模型在原点附近，台座底面在 GROUND_Y。
const RX0 = -26, RX1 = 26, RZ0 = -20, RZ1 = 26, RH = 12;

/** 深色地砖：每块 2 米，一张贴图放 2×2 块，砖色略有差异，砖缝更亮。 */
function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const tones = ['#2b2f37', '#30343c', '#2d3139', '#292d34'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = tones[i];
    g.fillRect((i % 2) * 256, Math.floor(i / 2) * 256, 256, 256);
  }
  g.fillStyle = '#454a54';
  for (const p of [0, 256]) { g.fillRect(p, 0, 3, 512); g.fillRect(0, p, 512, 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** 软边矩形遮罩：光斑边缘柔和，不出现硬边。 */
function softRectTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.filter = 'blur(10px)';
  g.fillStyle = '#fff';
  g.fillRect(18, 18, 92, 92);
  return new THREE.CanvasTexture(c);
}

/** 窗玻璃的竖向渐变：上亮下略暗，让窗光更有层次。 */
function paneTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(1, '#b8b8b8');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 四个角点组成的四边形网格；光斑每次更新直接改顶点，形状就是窗户沿阳光方向投到地上的平行四边形。 */
function quadMesh(mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 1;
  return m;
}

export class Studio {
  constructor(scene, groundY) {
    this.gy = groundY;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.windows = [];   // { center, axis: 'z'|'x', w, h, pane, patch, sky }

    this.buildShell();
    this.buildWindows();
    this.buildTable();
    this.buildPlants();
  }

  /** 地面和四面墙。 */
  buildShell() {
    const gy = this.gy;
    const ft = floorTexture();
    ft.repeat.set((RX1 - RX0) / 4, (RZ1 - RZ0) / 4);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(RX1 - RX0, RZ1 - RZ0),
      new THREE.MeshStandardMaterial({ map: ft, roughness: 0.38, envMapIntensity: 0.5 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((RX0 + RX1) / 2, gy, (RZ0 + RZ1) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    this.wallMat = new THREE.MeshStandardMaterial({ color: '#5f6774', roughness: 0.92 });
    const wall = (w, x, z, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, RH), this.wallMat);
      m.position.set(x, gy + RH / 2, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      this.group.add(m);
    };
    wall(RX1 - RX0, 0, RZ0, 0);                      // 后墙（朝 +z）
    wall(RX1 - RX0, 0, RZ1, Math.PI);                // 前墙（镜头背后）
    wall(RZ1 - RZ0, RX0, (RZ0 + RZ1) / 2, Math.PI / 2);   // 左墙
    wall(RZ1 - RZ0, RX1, (RZ0 + RZ1) / 2, -Math.PI / 2);  // 右墙
    // 踢脚线：一道深色细条，让墙地交界清楚
    const skirt = new THREE.MeshStandardMaterial({ color: '#2a2c31', roughness: 0.7 });
    for (const [w, x, z, ry] of [[RX1 - RX0, 0, RZ0 + 0.03, 0], [RZ1 - RZ0, RX1 - 0.03, (RZ0 + RZ1) / 2, -Math.PI / 2], [RZ1 - RZ0, RX0 + 0.03, (RZ0 + RZ1) / 2, Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.25), skirt);
      m.position.set(x, gy + 0.125, z);
      m.rotation.y = ry;
      this.group.add(m);
    }
  }

  /** 后墙和右墙的落地高窗：发光玻璃 + 深色窗框；每扇窗配一块地面光斑。 */
  buildWindows() {
    const gy = this.gy;
    const paneMap = paneTexture();
    this.paneMat = new THREE.MeshBasicMaterial({ map: paneMap, fog: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#25272c', roughness: 0.5, metalness: 0.4 });
    this.patchMat = new THREE.MeshBasicMaterial({
      map: softRectTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2,
    });
    const h = 8.6, y0 = gy + 0.5, w = 5.2;
    // 窗下天光：一块冷蓝色的软边光斑，贴着窗口铺在地上
    this.skyMat = new THREE.MeshBasicMaterial({
      map: softRectTexture(), color: '#7d9ccc', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, toneMapped: false,
    });

    const addWindow = (axis, along, at) => {
      const cx = axis === 'z' ? along : at, cz = axis === 'z' ? at : along;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.paneMat);
      pane.position.set(cx + (axis === 'x' ? -0.02 : 0), y0 + h / 2, cz + (axis === 'z' ? 0.02 : 0));
      if (axis === 'x') pane.rotation.y = -Math.PI / 2;
      this.group.add(pane);
      // 窗框：外框四边 + 两根竖梃 + 一根横档
      const bar = (bw, bh, ox, oy) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(axis === 'z' ? bw : 0.12, bh, axis === 'z' ? 0.12 : bw), frameMat);
        m.position.set(cx + (axis === 'z' ? ox : -0.06), y0 + oy, cz + (axis === 'z' ? 0.06 : ox));
        this.group.add(m);
      };
      bar(w + 0.2, 0.18, 0, 0); bar(w + 0.2, 0.18, 0, h);
      bar(0.18, h, -w / 2, h / 2); bar(0.18, h, w / 2, h / 2);
      bar(0.1, h, -w / 6, h / 2); bar(0.1, h, w / 6, h / 2);
      bar(w, 0.1, 0, h * 0.68);
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.4, 7), this.skyMat);
      sky.rotation.x = -Math.PI / 2;
      if (axis === 'x') sky.rotation.z = Math.PI / 2;
      sky.position.set(axis === 'z' ? cx : cx - 3.5, gy + 0.008, axis === 'z' ? cz + 3.5 : cz);
      sky.renderOrder = 1;
      this.group.add(sky);
      const patch = quadMesh(this.patchMat);
      this.group.add(patch);
      this.windows.push({ axis, cx, cz, w, h, y0, patch });
    };
    for (const x of [-18, -10.5, -3, 4.5, 12, 19.5]) addWindow('z', x, RZ0);
    for (const z of [-12, -4.5, 3, 10.5]) addWindow('x', z, RX1);
  }

  /** 右侧的大工作台：台面 + 金属腿，台面上散放几块材料样板、书和杯子。 */
  buildTable() {
    const gy = this.gy;
    const t = new THREE.Group();
    const topMat = new THREE.MeshStandardMaterial({ color: '#3b3a38', roughness: 0.55 });
    const legMat = new THREE.MeshStandardMaterial({ color: '#17181b', roughness: 0.4, metalness: 0.6 });
    const H = 1.95, L = 13, D = 4.4;
    const top = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, D), topMat);
    top.position.y = H;
    top.castShadow = top.receiveShadow = true;
    t.add(top);
    for (const [x, z] of [[-L / 2 + 0.5, -D / 2 + 0.4], [L / 2 - 0.5, -D / 2 + 0.4], [-L / 2 + 0.5, D / 2 - 0.4], [L / 2 - 0.5, D / 2 - 0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, H, 0.16), legMat);
      leg.position.set(x, H / 2, z);
      leg.castShadow = true;
      t.add(leg);
    }
    // 材料样板：从材质库里挑几种，做成薄板随意摆放
    const picks = ['walnut', 'honey-oak', 'linen', 'boucle', 'travertine', 'sage', 'navy-velvet', 'terrazzo', 'rust-wool', 'smoked-oak'];
    const uses = { wood: 'furniture', stone: 'floor', fabric: 'fabric', paint: 'wall' };
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    picks.forEach((id, i) => {
      const def = MATERIALS.find((m) => m.id === id);
      if (!def) return;
      const sw = def.cat === 'fabric' ? 1.1 : 1.3, sd = def.cat === 'fabric' ? 1.1 : 0.85;
      const tile = new THREE.Mesh(boxUV(new THREE.BoxGeometry(sw, 0.05, sd)), makeMaterial(def, uses[def.cat]));
      const col = i % 5, row = Math.floor(i / 5);
      tile.position.set(-L / 2 + 1.6 + col * 2.1 + rnd() * 0.5, H + 0.1 + (i % 3) * 0.01, -0.9 + row * 1.7 + rnd() * 0.4);
      tile.rotation.y = (rnd() - 0.5) * 0.6;
      tile.castShadow = tile.receiveShadow = true;
      t.add(tile);
    });
    const books = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.35, 1.1), fixed('paper'));
    books.position.set(L / 2 - 1.6, H + 0.25, 1.1);
    books.rotation.y = 0.2;
    books.castShadow = true;
    t.add(books);
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.45, 20), fixed('ceramic'));
    mug.position.set(L / 2 - 2.8, H + 0.3, -1.2);
    mug.castShadow = true;
    t.add(mug);

    t.position.set(17, gy, 0);
    t.rotation.y = -0.18;
    this.group.add(t);
  }

  /** 墙角的大盆植物：复用家具里的植物模型，放大后当作工作室里的真实植物。 */
  buildPlants() {
    const M = { slot: () => fixed('black'), fixed, boxUV: (g) => g };
    const put = (type, x, z, s, ry) => {
      const p = FURNITURE[type].build(M);
      p.scale.setScalar(s);
      p.position.set(x, this.gy, z);
      p.rotation.y = ry;
      this.group.add(p);
    };
    put('plant', -22, -16, 3.2, 0.4);
    put('plant2', 22.5, -16.5, 3.4, 1.2);
    put('plant', 23, 15, 3.0, 2.1);
    put('plant2', -22.5, 12, 3.2, 0.7);
  }

  /**
   * 随时刻更新：窗外天色、太阳光斑。
   * 光斑 = 窗洞四个角沿阳光方向投到地面；只有太阳在窗外一侧时才有光斑。
   */
  update(L) {
    const day = L.day ? Math.min(1, L.sunI / 2.4) : 0;
    // 窗光：冷灰紫为底，白天提亮偏冷白，夜里压成深蓝
    const cool = new THREE.Color('#b9bfd0').lerp(L.sky, 0.2);
    const pane = L.day ? cool.multiplyScalar(0.55 + day * 0.55) : new THREE.Color('#1c2744').multiplyScalar(0.9);
    this.paneMat.color.copy(pane);
    this.wallMat.color.set('#5f6774').multiplyScalar(L.day ? 0.85 + day * 0.15 : 0.7);

    const dir = L.dir;
    const strength = L.day ? Math.min(1, L.sunI / 2.2) : 0;
    // 阳光光斑：颜色大幅往冷白靠，强度克制，避免傍晚把冷色的工作室染成一片橙
    this.patchMat.color.copy(L.day ? L.sunC.clone().lerp(new THREE.Color('#e6ebf5'), 0.72) : new THREE.Color('#000000'));
    this.patchMat.opacity = 0.12 * strength;
    // 窗下的冷色天光：白天明显，傍晚减弱，夜里几乎没有
    this.skyMat.opacity = L.day ? 0.08 + 0.22 * Math.min(1, L.hemi / 0.6) : 0.03;
    const gy = this.gy;
    const corner = new THREE.Vector3();
    for (const win of this.windows) {
      const lit = L.day && dir.y > 0.04 && (win.axis === 'z' ? dir.z < -0.05 : dir.x > 0.05);
      win.patch.visible = lit;
      if (!lit) continue;
      const pos = win.patch.geometry.attributes.position;
      const pts = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
      pts.forEach(([u, v], i) => {
        const along = (u * win.w) / 2;
        corner.set(
          win.axis === 'z' ? win.cx + along : win.cx,
          win.y0 + v * win.h,
          win.axis === 'z' ? win.cz : win.cz + along,
        );
        // 沿 -dir 走到地面：s = (y - gy) / dir.y
        const s = (corner.y - gy) / dir.y;
        pos.setXYZ(i, corner.x - dir.x * s, gy + 0.012, corner.z - dir.z * s);
      });
      pos.needsUpdate = true;
      win.patch.geometry.computeBoundingSphere();
    }
  }
}
