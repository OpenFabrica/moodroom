// 房间结构：底座、地板、墙体（带窗洞）、隔断、木格栅墙、窗框和墙上装饰画。
// 所有可换材质的网格都在 userData.slot 上标记所属表面，供射线拾取和材质替换使用。
import * as THREE from 'three';
import { boxUV } from './uv.js';
import { fixed } from './fixed.js';

// 公寓平面边界（米）。x 向右，z 朝向镜头，y 向上，地板顶面在 y=0。
export const X0 = -5, X1 = 5, Z0 = -3.5, Z1 = 3.5;
export const WALL_H = 2.7;
export const WALL_T = 0.15;
export const PART_T = 0.12;
export const GROUND_Y = -1.8;

// 窗洞定义：所在墙、沿墙方向的区间、高度区间。
const WINDOWS = [
  { wall: 'back', a: -2.1, b: 0.4, y0: 0.12, y1: 2.45 },   // 客厅落地大窗：正午阳光从这里进来
  { wall: 'left', a: 0.3, b: 2.1, y0: 0.75, y1: 2.35 },     // 餐区窗：早晨低角度阳光
];

// 隔断：x 或 z 固定的一段墙，h 为高度。
const PARTITIONS = [
  { axis: 'x', at: 0.9, from: Z0, to: -0.6, h: WALL_H },     // 客厅 / 卧室，整高隔断
  { axis: 'z', at: 0.25, from: 0.84, to: 3.4, h: 1.2 },      // 卧室 / 书房，半高墙，书桌背靠它
  { axis: 'x', at: 0.9, from: 0.31, to: 1.5, h: 1.2 },       // 客厅 / 书房，半高墙
];

// 前墙：剖切成矮墙，留出入户门洞
const FRONT_H = 0.95;
const DOOR = { a: -2.0, b: -0.9 };

// 木格栅墙：左墙靠后角的一段（沿 z 方向）
const SLATS = { a: Z0, b: -2.45, y0: 0, y1: WALL_H - 0.02 };

/** 把一个世界坐标的盒子转成带米制 UV 的几何体，并标记为 slot 网格。 */
function slotBox(group, slot, x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const m = new THREE.Mesh(boxUV(g), null);
  m.userData.slot = slot;
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/** 普通固定材质盒子（墙顶封边、窗框等）。 */
function plainBox(group, mat, x0, x1, y0, y1, z0, z1, shadow = true) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const m = new THREE.Mesh(g, mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = shadow;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

const SKIN = 0.014;

/**
 * 沿一条直线墙按窗洞切成若干盒子。
 * 为什么不用 CSG：墙是轴对齐的，按区间切分成实心段 + 窗上下的过梁/窗台即可，几何简单且 UV 连续。
 * 每段墙 = 深色墙芯 + 室内侧一层薄“饰面”。只有饰面挂材质槽位，
 * 这样外墙外侧和剖切面保持深色，像建筑剖面模型，不会整面被涂成墙漆颜色。
 * inside 列出室内侧方向（+1 / -1）；隔断两侧都是室内，传 [-1, 1]。
 */
function buildWallRun(group, slot, run) {
  const { axis, at, from, to, t, h, holes, inside } = run;
  const span = (lo, hi, a0, a1, y0, y1, mk) => (axis === 'z' ? mk(a0, a1, y0, y1, lo, hi) : mk(lo, hi, y0, y1, a0, a1));
  const box = (a0, a1, y0, y1) => {
    if (a1 - a0 < 1e-3 || y1 - y0 < 1e-3) return;
    let lo = at - t / 2, hi = at + t / 2;
    for (const sgn of inside) {
      const s0 = sgn > 0 ? hi - SKIN : lo, s1 = sgn > 0 ? hi : lo + SKIN;
      span(s0, s1, a0, a1, y0, y1, (x0, x1, yy0, yy1, z0, z1) => slotBox(group, slot, x0, x1, yy0, yy1, z0, z1));
      if (sgn > 0) hi -= SKIN; else lo += SKIN;
    }
    span(lo, hi, a0, a1, y0, y1, (x0, x1, yy0, yy1, z0, z1) => plainBox(group, fixed('shell'), x0, x1, yy0, yy1, z0, z1));
  };
  const cap = (a0, a1) => span(at - t / 2 - 0.006, at + t / 2 + 0.006, a0, a1, h, h + 0.035,
    (x0, x1, y0, y1, z0, z1) => plainBox(group, fixed('cap'), x0, x1, y0, y1, z0, z1, false));
  const sorted = [...holes].sort((p, q) => p.a - q.a);
  let cur = from;
  for (const w of sorted) {
    box(cur, w.a, 0, h);
    box(w.a, w.b, 0, w.y0);
    box(w.a, w.b, w.y1, h);
    cur = w.b;
  }
  box(cur, to, 0, h);
  cap(from, to);
}

/** 窗框和玻璃：四边细框 + 一根竖梃 + 一块透明玻璃。 */
function buildWindow(group, w, axis, at) {
  const f = 0.045, depth = 0.08;
  const mat = fixed('frame');
  const mk = (a0, a1, y0, y1) => axis === 'z'
    ? plainBox(group, mat, a0, a1, y0, y1, at - depth / 2, at + depth / 2)
    : plainBox(group, mat, at - depth / 2, at + depth / 2, y0, y1, a0, a1);
  mk(w.a, w.b, w.y0, w.y0 + f);
  mk(w.a, w.b, w.y1 - f, w.y1);
  mk(w.a, w.a + f, w.y0, w.y1);
  mk(w.b - f, w.b, w.y0, w.y1);
  const mid = (w.a + w.b) / 2;
  mk(mid - f / 2, mid + f / 2, w.y0, w.y1);
  // 窗台：浅色石材感的固定条
  if (axis === 'z') plainBox(group, fixed('ceramic'), w.a - 0.04, w.b + 0.04, w.y0 - 0.03, w.y0, at, at + 0.16);
  else plainBox(group, fixed('ceramic'), at, at + 0.16, w.y0 - 0.03, w.y0, w.a - 0.04, w.b + 0.04);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w.b - w.a, w.y1 - w.y0), fixed('glass'));
  glass.position.set(axis === 'z' ? mid : at, (w.y0 + w.y1) / 2, axis === 'z' ? at : mid);
  if (axis === 'x') glass.rotation.y = Math.PI / 2;
  glass.renderOrder = 2;
  group.add(glass);
}

/** 木格栅墙：左墙内侧的一排竖向木条 + 底板，材质 slot 为 'slats'。 */
function buildSlats(group) {
  const x = X0 + 0.012;
  slotBox(group, 'slats', x - 0.004, x + 0.006, SLATS.y0, SLATS.y1, SLATS.a, SLATS.b).userData.backer = true;
  const n = Math.round((SLATS.b - SLATS.a) / 0.075);
  const w = 0.042;
  for (let i = 0; i < n; i++) {
    const cz = SLATS.a + (i + 0.5) * ((SLATS.b - SLATS.a) / n);
    slotBox(group, 'slats', x, x + 0.045, SLATS.y0, SLATS.y1, cz - w / 2, cz + w / 2);
  }
}

/** 矮柜上方的两条墙搁板（木作材质）和几件小摆设。 */
function buildShelves(group, cx, w) {
  for (const [y, n] of [[1.4, 0], [1.8, 1]]) {
    slotBox(group, 'woodwork', cx - w / 2, cx + w / 2, y, y + 0.035, Z0, Z0 + 0.22);
    const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.2 - n * 0.06, 16), fixed(n ? 'terracotta' : 'ceramic'));
    vase.position.set(cx - w / 2 + 0.2 + n * 0.5, y + 0.035 + (0.2 - n * 0.06) / 2, Z0 + 0.11);
    vase.castShadow = true;
    const books = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.16), fixed('paper'));
    books.position.set(cx + w / 2 - 0.25 - n * 0.3, y + 0.06, Z0 + 0.11);
    books.castShadow = true;
    group.add(vase, books);
  }
}

/** 入户门垫：固定装饰，只是贴地的一块薄板。 */
function buildDoormat(group, x, z) {
  const mat = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.012, 0.55), fixed('coir'));
  mat.position.set(x, 0.006, z);
  mat.receiveShadow = true;
  group.add(mat);
}

/**
 * 纱帘：一片带正弦褶皱的竖向薄面，挂在窗洞一侧。
 * 不投射阴影，避免把窗口照进来的阳光整片挡掉。
 */
function buildCurtain(group, axis, at, a, width, h) {
  const g = new THREE.PlaneGeometry(width, h, 28, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / width + 0.5) * Math.PI * 9) * 0.035);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, fixed('sheer'));
  m.position.set(axis === 'z' ? a : at, h / 2 + 0.04, axis === 'z' ? at : a);
  if (axis === 'x') m.rotation.y = Math.PI / 2;
  m.receiveShadow = true;
  group.add(m);
}

/** 程序生成的抽象装饰画纹理（几何色块），每幅画用不同种子。 */
function artTexture(seed) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#efe9df'; g.fillRect(0, 0, 256, 320);
  const pal = ['#c9784f', '#2f3a4f', '#d9b27c', '#8d9a84', '#3c2f2a', '#e8cdb5'];
  for (let i = 0; i < 4; i++) {
    g.fillStyle = pal[Math.floor(r() * pal.length)];
    g.beginPath();
    if (r() > 0.5) g.arc(40 + r() * 176, 50 + r() * 220, 30 + r() * 60, 0, Math.PI * (1 + r()));
    else g.rect(30 + r() * 150, 40 + r() * 200, 40 + r() * 90, 40 + r() * 110);
    g.fill();
  }
  g.strokeStyle = '#2b2622'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(30 + r() * 60, 280); g.bezierCurveTo(100, 120 + r() * 80, 160, 260, 226, 60 + r() * 60); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 一幅带黑框的装饰画；axis/at 指定挂在哪面墙的内侧，a 是沿墙位置。 */
function buildArt(group, axis, at, a, y, w, h, seed, inward) {
  const art = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.03), fixed('frame'));
  frame.castShadow = true;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: artTexture(seed), roughness: 0.85 }));
  pic.position.z = 0.016;
  art.add(frame, pic);
  if (axis === 'z') { art.position.set(a, y, at + inward * 0.03); if (inward < 0) art.rotation.y = Math.PI; }
  else { art.position.set(at + inward * 0.03, y, a); art.rotation.y = inward > 0 ? Math.PI / 2 : -Math.PI / 2; }
  group.add(art);
}

/**
 * 构建整套房间，返回：
 * - group：加入场景的根节点
 * - obstacles：家具碰撞用的墙体矩形 {x0,x1,z0,z1}
 * - faces：家具贴墙吸附用的墙面 {axis:'x'|'z', at, from, to, dir}
 * - anchors：表面浮动卡片的锚点（世界坐标）
 */
export function buildRoom() {
  const group = new THREE.Group();

  // 底座与地面：深色台座 + 一圈发光描边，衬托出“切开的公寓模型”效果
  const m = 0.32, GY = GROUND_Y;
  plainBox(group, fixed('plinth'), X0 - m, X1 + m, GY, -0.14, Z0 - m, Z1 + m, false);
  plainBox(group, fixed('trim'), X0 - m - 0.006, X1 + m + 0.006, -0.17, -0.155, Z0 - m - 0.006, Z1 + m + 0.006, false);
  // 台座底边的暖色灯带：贴着地面，衬出台座轮廓
  plainBox(group, fixed('trim'), X0 - m - 0.012, X1 + m + 0.012, GY, GY + 0.03, Z0 - m - 0.012, Z1 + m + 0.012, false);
  plainBox(group, fixed('cap'), X0 - m, X1 + m, -0.14, -0.02, Z0 - m, Z1 + m);
  // 地面上的一圈发光细线，围着台座，和台座上沿的灯带呼应
  const o = 1.6, lw = 0.035, ly = GY + 0.004;
  plainBox(group, fixed('trim'), X0 - o, X1 + o, ly, ly + 0.006, Z0 - o - lw, Z0 - o, false);
  plainBox(group, fixed('trim'), X0 - o, X1 + o, ly, ly + 0.006, Z1 + o, Z1 + o + lw, false);
  plainBox(group, fixed('trim'), X0 - o - lw, X0 - o, ly, ly + 0.006, Z0 - o, Z1 + o, false);
  plainBox(group, fixed('trim'), X1 + o, X1 + o + lw, ly, ly + 0.006, Z0 - o, Z1 + o, false);

  // 地板：整块平面盒子，slot = floor
  slotBox(group, 'floor', X0, X1, -0.06, 0, Z0, Z1).userData.floor = true;

  const back = WINDOWS.filter(w => w.wall === 'back');
  const left = WINDOWS.filter(w => w.wall === 'left');
  // 后墙 / 左墙（特色墙）/ 右墙
  buildWallRun(group, 'walls', { axis: 'z', at: Z0 - WALL_T / 2, from: X0 - WALL_T, to: X1 + WALL_T, t: WALL_T, h: WALL_H, holes: back, inside: [1] });
  buildWallRun(group, 'feature', { axis: 'x', at: X0 - WALL_T / 2, from: Z0, to: Z1, t: WALL_T, h: WALL_H, holes: left, inside: [1] });
  buildWallRun(group, 'walls', { axis: 'x', at: X1 + WALL_T / 2, from: Z0, to: Z1, t: WALL_T, h: WALL_H, holes: [], inside: [-1] });
  for (const w of back) buildWindow(group, w, 'z', Z0 - WALL_T / 2);
  for (const w of left) buildWindow(group, w, 'x', X0 - WALL_T / 2);

  // 隔断
  for (const p of PARTITIONS) {
    buildWallRun(group, 'walls', { axis: p.axis, at: p.at, from: p.from, to: p.to, t: PART_T, h: p.h, holes: [], inside: [-1, 1] });
  }

  // 前墙：剖切成矮墙，门洞两侧分两段建，避免墙顶封边横跨门洞
  const fz = Z1 + WALL_T / 2;
  buildWallRun(group, 'walls', { axis: 'z', at: fz, from: X0 - WALL_T, to: DOOR.a, t: WALL_T, h: FRONT_H, holes: [], inside: [-1] });
  buildWallRun(group, 'walls', { axis: 'z', at: fz, from: DOOR.b, to: X1 + WALL_T, t: WALL_T, h: FRONT_H, holes: [], inside: [-1] });
  buildDoormat(group, (DOOR.a + DOOR.b) / 2, Z1 - 0.4);

  buildSlats(group);
  buildShelves(group, -3.0, 1.3);

  // 纱帘：后墙大窗两侧、左墙餐区窗两侧
  buildCurtain(group, 'z', Z0 + 0.1, -2.33, 0.42, 2.55);
  buildCurtain(group, 'z', Z0 + 0.1, 0.62, 0.38, 2.55);
  buildCurtain(group, 'x', X0 + 0.1, 0.08, 0.42, 2.55);
  buildCurtain(group, 'x', X0 + 0.1, 2.32, 0.42, 2.55);

  // 墙上装饰画：沙发上方两幅（左墙），床头上方一幅（后墙）
  buildArt(group, 'x', X0, -1.95, 1.6, 0.6, 0.78, 73, 1);
  buildArt(group, 'x', X0, -1.0, 1.5, 0.45, 0.58, 5, 1);
  buildArt(group, 'z', Z0, 2.95, 1.75, 0.95, 0.7, 37, 1);

  // 碰撞矩形：外墙 + 隔断；加一点余量避免家具与墙面闪烁重叠
  const obstacles = [];
  for (const p of PARTITIONS) {
    const h = PART_T / 2;
    if (p.axis === 'x') obstacles.push({ x0: p.at - h, x1: p.at + h, z0: p.from, z1: p.to });
    else obstacles.push({ x0: p.from, x1: p.to, z0: p.at - h, z1: p.at + h });
  }
  // 木格栅占据左墙内侧 6cm
  obstacles.push({ x0: X0, x1: X0 + 0.06, z0: SLATS.a, z1: SLATS.b });

  // 贴墙吸附面：dir 表示可放置家具的一侧（+1 在面的正方向）
  const faces = [
    { axis: 'z', at: Z0, from: X0, to: X1, dir: 1 },
    { axis: 'z', at: Z1, from: X0, to: X1, dir: -1 },
    { axis: 'x', at: X0, from: Z0, to: Z1, dir: 1 },
    { axis: 'x', at: X1, from: Z0, to: Z1, dir: -1 },
    { axis: 'x', at: X0 + 0.06, from: SLATS.a, to: SLATS.b, dir: 1 },
  ];
  for (const p of PARTITIONS) {
    const h = PART_T / 2;
    faces.push({ axis: p.axis, at: p.at - h, from: p.from, to: p.to, dir: -1 });
    faces.push({ axis: p.axis, at: p.at + h, from: p.from, to: p.to, dir: 1 });
  }

  const anchors = {
    floor: new THREE.Vector3(-1.6, 0, 0.6),
    feature: new THREE.Vector3(X0, 2.1, 1.2 + 1.3),
    walls: new THREE.Vector3(0.9 - PART_T / 2, 2.0, -2.2),
    slats: new THREE.Vector3(X0 + 0.06, 2.0, (SLATS.a + SLATS.b) / 2),
  };

  return { group, obstacles, faces, anchors };
}
