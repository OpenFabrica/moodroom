// Moodroom 主程序：渲染管线、相机、家具摆放、材质拖放、日光拖动、界面同步和渲染循环。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { boxUV } from './uv.js';
import { fixed } from './fixed.js';
import { buildRoom, X0, X1, Z0, Z1, GROUND_Y } from './room.js';
import { Studio } from './studio.js';
import { Lighting, MOMENTS, T_MIN, T_MAX, SUN_R, orbitPoint, isDay, fmtTime } from './lighting.js';
import { MATERIALS, MATERIAL_BY_ID, CATEGORIES, swatchURL, applyMaterial, makeMaterial } from './materials.js';
import { FURNITURE, FURNITURE_ORDER } from './furniture.js';
import { SLOTS, SLOT_BY_ID, makePresets, DEFAULT_PIECES, History, encodeState, decodeState } from './state.js';
import { readMood } from './mood.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = THREE.MathUtils.clamp;
const easeOut = (x) => 1 - (1 - x) ** 3;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// ============================================================================
// 渲染器与场景
// ============================================================================
const world = $('#world');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  $('#loading span').textContent = 'This room needs WebGL. Try a browser with hardware acceleration turned on.';
  throw e;
}
const DPR = clamp(Math.min(devicePixelRatio, 2, Math.sqrt(2.6e6 / (innerWidth * innerHeight))), 1, 2);
renderer.setPixelRatio(DPR);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
world.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#141a28', 0.006);
const camera = new THREE.PerspectiveCamera(30, 1, 0.3, 300);

// 环境光照：用程序生成的室内环境贴图给 PBR 材质柔和的反射与漫射，强度随时刻变化
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const lighting = new Lighting(scene, renderer);
const studio = new Studio(scene, GROUND_Y);

// ============================================================================
// 材质：每个表面槽位一个共享材质实例，换材质时原地修改，所有网格自动跟着变
// ============================================================================
const slotMats = {};
for (const s of SLOTS) slotMats[s.id] = new THREE.MeshStandardMaterial();
const M = { slot: (n) => slotMats[n] || slotMats.woodwork, fixed, boxUV: (g) => boxUV(g) };

const room = buildRoom();
room.group.traverse((o) => { if (o.isMesh && o.userData.slot) o.material = slotMats[o.userData.slot]; });
scene.add(room.group);

const piecesGroup = new THREE.Group();
scene.add(piecesGroup);

// ============================================================================
// 状态
// ============================================================================
const PRESETS = makePresets();
const history = new History();
const state = { slots: { ...PRESETS[1].slots }, pieces: [], t: PRESETS[1].t };
let uidSeq = 1;

/** 当前状态的可序列化快照（用于撤销和分享）。 */
function snapshot() {
  return {
    slots: { ...state.slots },
    pieces: state.pieces.map(({ type, x, z, rot }) => ({ type, x, z, rot })),
    t: state.t,
  };
}

/** 把材质应用到槽位，同时保留选中高亮。 */
function setSlotMaterial(slotId, matId) {
  const def = MATERIAL_BY_ID[matId];
  const slot = SLOT_BY_ID[slotId];
  if (!def || !slot) return;
  state.slots[slotId] = matId;
  applyMaterial(slotMats[slotId], def, slot.use);
  shadowsDirty();
}

// ============================================================================
// 家具：创建 / 摆放 / 碰撞 / 吸附
// ============================================================================
const GRID = 0.1;
const SNAP = 0.22;

/** 旋转后在 x/z 上的半宽半深（只允许 90° 倍数，所以就是交换宽深）。 */
function halfSize(type, rot) {
  const f = FURNITURE[type];
  return rot & 1 ? [f.d / 2, f.w / 2] : [f.w / 2, f.d / 2];
}

/** 两个矩形是否重叠（留一点容差，允许刚好贴边）。 */
const overlap = (a, b) => a.x0 < b.x1 - 0.004 && a.x1 > b.x0 + 0.004 && a.z0 < b.z1 - 0.004 && a.z1 > b.z0 + 0.004;

/** 位置是否合法：在房间内、不穿墙/隔断、不与其他实体家具重叠（地毯可以压在家具下）。 */
function isValid(type, x, z, rot, ignore) {
  const [hw, hd] = halfSize(type, rot);
  const r = { x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd };
  if (r.x0 < X0 - 0.004 || r.x1 > X1 + 0.004 || r.z0 < Z0 - 0.004 || r.z1 > Z1 + 0.004) return false;
  for (const o of room.obstacles) if (overlap(r, o)) return false;
  if (FURNITURE[type].flat) return true;
  for (const p of state.pieces) {
    if (p === ignore || FURNITURE[p.type].flat) continue;
    const [pw, pd] = halfSize(p.type, p.rot);
    if (overlap(r, { x0: p.x - pw, x1: p.x + pw, z0: p.z - pd, z1: p.z + pd })) return false;
  }
  return true;
}

/**
 * 吸附：先对齐 10cm 网格，再检查附近墙面，靠近时把家具边缘贴到墙上。
 * 墙面吸附优先于网格，因为家具贴墙摆放是最常见的意图。
 */
function snapPos(type, x, z, rot) {
  const [hw, hd] = halfSize(type, rot);
  x = Math.round(x / GRID) * GRID;
  z = Math.round(z / GRID) * GRID;
  let bx = SNAP, bz = SNAP, sx = x, sz = z;
  for (const f of room.faces) {
    if (f.axis === 'x') {
      if (z + hd <= f.from || z - hd >= f.to) continue;
      const edge = f.dir > 0 ? x - hw : x + hw;
      const d = Math.abs(edge - f.at);
      if (d < bx) { bx = d; sx = f.dir > 0 ? f.at + hw : f.at - hw; }
    } else {
      if (x + hw <= f.from || x - hw >= f.to) continue;
      const edge = f.dir > 0 ? z - hd : z + hd;
      const d = Math.abs(edge - f.at);
      if (d < bz) { bz = d; sz = f.dir > 0 ? f.at + hd : f.at - hd; }
    }
  }
  // 开口侧没有墙，但仍然不能超出地板
  sx = clamp(sx, X0 + hw, X1 - hw);
  sz = clamp(sz, Z0 + hd, Z1 - hd);
  return [sx, sz];
}

/** 构建家具三维对象并标记归属，便于射线拾取时找回对应的 piece。 */
function buildPieceObject(p) {
  const obj = FURNITURE[p.type].build(M);
  obj.userData.uid = p.uid;
  obj.traverse((o) => { if (o.isMesh) o.userData.pieceUid = p.uid; });
  obj.position.set(p.x, 0, p.z);
  obj.rotation.y = p.rot * Math.PI / 2;
  return obj;
}

/** 新增一件家具到状态和场景。 */
function addPiece(spec) {
  const p = { uid: uidSeq++, type: spec.type, x: spec.x, z: spec.z, rot: spec.rot & 3 };
  p.obj = buildPieceObject(p);
  piecesGroup.add(p.obj);
  state.pieces.push(p);
  return p;
}

/** 从状态和场景移除家具，并释放其几何体（材质是共享的，不释放）。 */
function removePiece(p) {
  state.pieces = state.pieces.filter((q) => q !== p);
  piecesGroup.remove(p.obj);
  p.obj.traverse((o) => { if (o.isMesh && !o.userData.sharedGeo) o.geometry.dispose?.(); });
  if (selected === p) selectPiece(null);
}

/** 家具位置或数量变化后：刷新灯具光源池和阴影。 */
function piecesChanged() {
  const lamps = [];
  piecesGroup.updateMatrixWorld(true);
  for (const p of state.pieces) {
    for (const l of p.obj.userData.lamps || []) {
      lamps.push({ pos: p.obj.localToWorld(l.pos.clone()), color: l.color, intensity: l.intensity ?? 1 });
    }
  }
  lighting.setLamps(lamps);
  shadowsDirty();
  previewsDirty();
}

/** 按快照整体恢复（撤销、重做、分享链接、预设共用）。 */
function restore(snap, { animateTime = false } = {}) {
  for (const s of SLOTS) if (snap.slots[s.id]) setSlotMaterial(s.id, snap.slots[s.id]);
  if (snap.pieces) {
    for (const p of [...state.pieces]) removePiece(p);
    for (const p of snap.pieces) if (FURNITURE[p.type]) addPiece(p);
    piecesChanged();
  }
  if (snap.t != null) animateTime ? tweenTime(snap.t) : setTime(snap.t);
  selectPiece(null);
  refreshAll();
}

/** 记录撤销点：在任何会改变状态的操作之前调用。 */
function commit() {
  history.push(snapshot());
  syncHistoryButtons();
}

// ============================================================================
// 相机与控制器
// ============================================================================
const HOME = { az: 0.5, pol: 1.0, d: 21, target: new THREE.Vector3(0.4, -0.4, 0.2) };
const controls = { orbit: null };
const keys = new Set();
let cine = null;
let viewTween = null;

/** 根据球坐标（方位角、极角、距离）放置相机。 */
function placeCamera(az, pol, d, target) {
  camera.position.set(
    target.x + d * Math.sin(pol) * Math.sin(az),
    target.y + d * Math.cos(pol),
    target.z + d * Math.sin(pol) * Math.cos(az),
  );
  camera.lookAt(target);
}

/** 当前相机的球坐标。 */
function cameraSpherical() {
  const t = controls.orbit.target;
  const v = camera.position.clone().sub(t);
  const d = v.length();
  return { az: Math.atan2(v.x, v.z), pol: Math.acos(clamp(v.y / d, -1, 1)), d, target: t.clone() };
}

/** 屏幕较窄时拉远镜头，保证整套公寓都在画面里。 */
const homeDistance = () => HOME.d * Math.max(1, 1.75 / camera.aspect);

/** 平滑回到默认视角。 */
function resetView() {
  stopCine();
  viewTween = { from: cameraSpherical(), to: { ...HOME, d: homeDistance(), target: HOME.target.clone() }, t0: performance.now(), dur: 900 };
}

// 电影镜头：几组缓慢移动的机位，循环播放
const SHOTS = [
  { a: { az: -0.3, pol: 0.95, d: 13, tg: [-2.6, 0.5, -1.6] }, b: { az: 0.15, pol: 0.9, d: 12, tg: [-2.2, 0.5, -1.8] } },
  { a: { az: 0.5, pol: 1.12, d: 11, tg: [3.6, 0.6, -1.4] }, b: { az: 0.95, pol: 1.05, d: 10.5, tg: [3.4, 0.6, -1.2] } },
  { a: { az: -0.05, pol: 0.55, d: 20, tg: [0, 0, 0] }, b: { az: 0.6, pol: 0.62, d: 19, tg: [0, 0, 0] } },
  { a: { az: -0.2, pol: 1.0, d: 11, tg: [-3.4, 0.5, 1.8] }, b: { az: 0.3, pol: 0.95, d: 11.5, tg: [-3, 0.5, 1.6] } },
  { a: { az: 0.25, pol: 1.0, d: 10.5, tg: [3.4, 0.6, 2.2] }, b: { az: -0.25, pol: 1.05, d: 11, tg: [3.2, 0.6, 2.0] } },
];

/** 开关电影镜头模式。 */
function toggleCine() {
  if (cine) return stopCine();
  cine = { i: 0, t0: performance.now(), dur: 9000 };
  controls.orbit.enabled = false;
  $('#cine').classList.add('on');
  selectPiece(null);
}

/** 退出电影镜头，把控制器目标同步到当前画面中心。 */
function stopCine() {
  if (!cine) return;
  cine = null;
  controls.orbit.enabled = true;
  $('#cine').classList.remove('on');
}

/** 每帧推进电影镜头。 */
function updateCine(now) {
  const shot = SHOTS[cine.i % SHOTS.length];
  let f = (now - cine.t0) / cine.dur;
  if (f >= 1) { cine.i++; cine.t0 = now; f = 0; }
  const e = easeInOut(f);
  const L = (k) => shot.a[k] + (shot.b[k] - shot.a[k]) * e;
  const tg = new THREE.Vector3().fromArray(shot.a.tg).lerp(new THREE.Vector3().fromArray(shot.b.tg), e);
  controls.orbit.target.copy(tg);
  placeCamera(L('az'), L('pol'), L('d'), tg);
}

/** WASD 平移、QE 旋转：在地面平面内沿相机朝向移动。 */
function updateKeysMove(dt) {
  if (!keys.size || cine) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const mv = new THREE.Vector3();
  const sp = 5 * dt;
  if (keys.has('w')) mv.addScaledVector(fwd, sp);
  if (keys.has('s')) mv.addScaledVector(fwd, -sp);
  if (keys.has('d')) mv.addScaledVector(right, sp);
  if (keys.has('a')) mv.addScaledVector(right, -sp);
  controls.orbit.target.add(mv);
  camera.position.add(mv);
  const rot = (keys.has('q') ? 1 : 0) - (keys.has('e') ? 1 : 0);
  if (rot) {
    const s = cameraSpherical();
    placeCamera(s.az + rot * 1.2 * dt, s.pol, s.d, s.target);
  }
}

// ============================================================================
// 太阳 / 月亮与轨迹
// ============================================================================
const SUN_CENTER = new THREE.Vector3(0, 0, 0);

/**
 * 太阳图标：柔和光晕 + 实心圆盘 + 一圈圆头短光芒，像界面图标一样清晰，方便当作拖动手柄。
 */
function sunIconTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  halo.addColorStop(0, 'rgba(255,220,160,0.55)');
  halo.addColorStop(0.45, 'rgba(255,200,130,0.18)');
  halo.addColorStop(1, 'rgba(255,200,130,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#fffaf0';
  g.beginPath(); g.arc(128, 128, 30, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fffaf0';
  g.lineWidth = 9;
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r0 = 46, r1 = i % 2 ? 60 : 68;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
    g.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 月亮图标：冷色光晕 + 弯月（大圆减去偏移的小圆）。 */
function moonIconTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  halo.addColorStop(0, 'rgba(170,195,255,0.4)');
  halo.addColorStop(1, 'rgba(170,195,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#eef3ff';
  g.beginPath(); g.arc(128, 128, 40, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(150, 112, 36, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunIconTexture(), depthWrite: false, fog: false, toneMapped: false }));
const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonIconTexture(), depthWrite: false, fog: false, toneMapped: false }));
sunSprite.scale.setScalar(0.85);
moonSprite.scale.setScalar(0.75);
// 太阳、月亮和轨迹放在单独的叠加场景里，后期处理之后再画：
// 否则 GTAO 会把精灵当成实体面，在发光圆盘周围压出一块暗方框。
const overlay = new THREE.Scene();
overlay.add(sunSprite, moonSprite);

// 太阳图标的显示轨道：一条闭合平滑曲线，按关键时刻插值。
// 显示与光照分离：光照方向用 lighting.js 的物理轨道；图标位置为构图服务，
// 在默认镜头下让傍晚的太阳停在右侧墙顶旁、入夜后沉到右下角、月亮挂在左上角。
// s 是参考画面（1512×756）里的屏幕坐标，启动时从默认镜头反投影到 3D；w 是直接给定的世界坐标。
const SUN_KEYS = [
  { t: 0.8, w: [2, -6, 8] },        // 午夜：前下方，地平线以下
  { t: 4.5, w: [-8, -3, 4] },       // 黎明前：左前下方
  { t: 6.0, w: [-9, 0.3, 1] },      // 日出：左侧贴地
  { t: 9.93, s: [610, 60], far: true },
  { t: 12.8, w: [0.5, 11, -6] },    // 正午：后上方，画面外
  { t: 15.6, w: [7, 7, -4] },
  { t: 18.45, s: [1325, 420] },     // 傍晚：右侧墙顶旁
  { t: 20.0, s: [1318, 520] },
  { t: 21.93, s: [1295, 578] },     // 入夜：右下角
];
let sunCurve = null;

/** 屏幕点反投影到以公寓为中心的球面上（far 取远侧交点），得到关键点的 3D 位置。 */
function unprojectKey(sx, sy, far) {
  const ndc = new THREE.Vector2(sx / 1512 * 2 - 1, -(sy / 756) * 2 + 1);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(ndc, camera);
  const c = new THREE.Vector3(0, 0.5, 0), r = 9.5;
  const oc = rc.ray.origin.clone().sub(c);
  const b = rc.ray.direction.dot(oc);
  const disc = b * b - (oc.lengthSq() - r * r);
  const d = disc < 0 ? -b : -b + (far ? 1 : -1) * Math.sqrt(disc);
  return rc.ray.at(d, new THREE.Vector3());
}

/** 在默认镜头就位后构建显示轨道曲线和虚线。 */
function buildSunCurve() {
  const pts = SUN_KEYS.map((k) => (k.s ? unprojectKey(k.s[0], k.s[1], k.far) : new THREE.Vector3(...k.w)));
  sunCurve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  sunPath.geometry.dispose();
  sunPath.geometry = buildSunPath().geometry;
  sunPath.computeLineDistances();
}

/** 时刻 → 曲线参数：每两个关键时刻之间线性映射到对应的曲线段。 */
function timeToU(t) {
  const n = SUN_KEYS.length;
  t = ((t % 24) + 24) % 24;
  for (let i = 0; i < n; i++) {
    const t0 = SUN_KEYS[i].t;
    let t1 = SUN_KEYS[(i + 1) % n].t;
    if (t1 <= t0) t1 += 24;
    const tt = t < t0 ? t + 24 : t;
    if (tt >= t0 && tt < t1) return (i + (tt - t0) / (t1 - t0)) / n;
  }
  return 0;
}

/**
 * 发光体的显示位置：白天是太阳，夜里是月亮（拖动手柄就是它）。
 * 月亮取 12 小时后的太阳位置，正好在轨道对面。曲线还没建好时退回物理轨道。
 */
function orbPos(t, out = new THREE.Vector3(), which = isDay(t) ? 'sun' : 'moon') {
  if (!sunCurve) return orbitPoint(t, which, out).multiplyScalar(SUN_R).add(SUN_CENTER);
  return sunCurve.getPoint(timeToU(which === 'moon' ? t + 12 : t), out);
}

/** 日月轨道虚线：完整一圈（太阳 24 小时走过的位置）。 */
function buildSunPath() {
  const pts = [];
  for (let t = 0; t <= 24.001; t += 0.1) pts.push(orbPos(t, new THREE.Vector3(), 'sun'));
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(g, new THREE.LineDashedMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, dashSize: 0.25, gapSize: 0.22, fog: false }));
  line.computeLineDistances();
  return line;
}
const sunPath = buildSunPath();
overlay.add(sunPath);



/** 设置时刻：更新灯光、太阳位置、天空和界面。 */
function setTime(t) {
  state.t = clamp(t, T_MIN, T_MAX);
  const L = lighting.apply(state.t);
  const day = isDay(state.t);
  // 太阳和月亮始终在轨道两端；夜里太阳沉到地平线下，变暗变冷，只作为方位提示
  orbPos(state.t, sunSprite.position, 'sun');
  orbPos(state.t, moonSprite.position, 'moon');
  sunSprite.visible = true;
  moonSprite.visible = !day;
  sunSprite.material.opacity = day ? 1 : 0.45;
  sunSprite.scale.setScalar(day ? 0.85 : 0.6);
  if (day) sunSprite.material.color.copy(L.sunC).lerp(new THREE.Color('#ffffff'), 0.7);
  else sunSprite.material.color.set('#7f9cff');
  studio.update(L);
  scene.background = skyTexture(L.sky, L.hor);
  // 雾色取冷灰：远处的工作室墙面被压得更沉，衬出暖色的公寓模型
  scene.fog.color.set('#30343d').multiplyScalar(L.day ? 0.6 + 0.4 * Math.min(1, L.sun / 3) : 0.35);
  refreshTimeUI();
  refreshMood();
}

/** 把时刻平滑动画到目标值（预设切换时使用）。 */
let timeTween = null;
function tweenTime(to) {
  timeTween = { from: state.t, to, t0: performance.now(), dur: 1100 };
}

// 天空背景：竖向渐变贴图，复用同一块 canvas 避免频繁分配
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2; skyCanvas.height = 256;
const skyTex = new THREE.CanvasTexture(skyCanvas);
skyTex.colorSpace = THREE.SRGBColorSpace;
/** 根据天顶色与地平线色重绘背景渐变；整体压暗，让房间成为画面主体。 */
function skyTexture(sky, hor) {
  const g = skyCanvas.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  const dark = (c, k) => '#' + c.clone().multiplyScalar(k).getHexString();
  grd.addColorStop(0, dark(sky, 0.16));
  grd.addColorStop(0.55, dark(hor, 0.14));
  grd.addColorStop(1, '#07090e');
  g.fillStyle = grd;
  g.fillRect(0, 0, 2, 256);
  skyTex.needsUpdate = true;
  return skyTex;
}

// ============================================================================
// 后期处理
// ============================================================================
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
const gtao = new GTAOPass(scene, camera, 512, 512);
gtao.blendIntensity = 0.75;
const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.28, 0.55, 0.88);
// 景深：对焦在公寓模型上，远处的工作室自然虚化。焦距每帧按相机到目标点的距离更新
const bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.002, maxblur: 0.012 });
// 原版 BokehShader 只有一个焦平面，离焦越远越糊，整个公寓（约 10×7 米）都会发虚。
// 这里加一个「清楚区」：离焦点 range 米以内完全不模糊，超出部分才开始虚化。
bokeh.uniforms.range = { value: 7 };
bokeh.materialBokeh.fragmentShader = bokeh.materialBokeh.fragmentShader
  .replace('uniform float focus;', 'uniform float focus;\nuniform float range;')
  .replace(
    'float factor = ( focus + viewZ );',
    'float d = focus + viewZ;\n\t\t\tfloat factor = sign( d ) * max( abs( d ) - range, 0.0 );',
  );
const output = new OutputPass();
const smaa = new SMAAPass();
composer.addPass(renderPass);
composer.addPass(gtao);
composer.addPass(bokeh);
composer.addPass(bloom);
composer.addPass(output);
composer.addPass(smaa);

/** 窗口尺寸变化时同步渲染器、后期和相机。 */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let shadowFlag = true;
const shadowsDirty = () => { shadowFlag = true; };

// ============================================================================
// 射线拾取
// ============================================================================
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** 屏幕坐标转射线。 */
function setRay(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

/** 拾取屏幕点下的第一个有效对象：返回 {piece, slot, point, mesh}。 */
function pick(cx, cy) {
  setRay(cx, cy);
  const hits = ray.intersectObjects([room.group, piecesGroup], true);
  for (const h of hits) {
    const o = h.object;
    if (!o.isMesh || o.material === fixed('glass') || !o.visible) continue;
    const piece = o.userData.pieceUid ? state.pieces.find((p) => p.uid === o.userData.pieceUid) : null;
    return { piece, slot: o.userData.slot || null, point: h.point, mesh: o };
  }
  return null;
}

/** 射线与地面（y=0）的交点。 */
function floorPoint(cx, cy) {
  setRay(cx, cy);
  return ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
}

// ============================================================================
// 材质“补丁”预览与铺开动画
// ============================================================================
// 补丁材质用片元着色器按到中心点的世界距离裁剪：半径内显示新材质，半径外丢弃。
const patchU = { uC: { value: new THREE.Vector3() }, uR: { value: 0 } };
let patch = null; // { slot, def, meshes:[], mat, anim }

/** 为某个材质定义创建补丁材质（覆盖在原表面之上，用 polygonOffset 避免 z-fighting）。 */
function makePatchMaterial(def, use) {
  const m = makeMaterial(def, use);
  m.polygonOffset = true;
  m.polygonOffsetFactor = -2;
  m.polygonOffsetUnits = -4;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uC = patchU.uC;
    sh.uniforms.uR = patchU.uR;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPatchW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPatchW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPatchW;\nuniform vec3 uC;\nuniform float uR;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nfloat pDist = distance(vPatchW, uC);\nif (pDist > uR) discard;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb += vec3(0.55, 0.85, 1.0) * smoothstep(uR - 0.035, uR, pDist) * 0.55;');
  };
  m.customProgramCacheKey = () => 'patch';
  return m;
}

/** 收集场景中属于某槽位的所有网格。 */
function slotMeshes(slotId) {
  const out = [];
  scene.traverse((o) => { if (o.isMesh && o.userData.slot === slotId && !o.userData.patch) out.push(o); });
  return out;
}

/** 在指定槽位上显示补丁（悬停预览）。 */
function showPatch(slotId, def, point, radius) {
  if (!patch || patch.slot !== slotId || patch.def !== def) {
    clearPatch();
    const use = SLOT_BY_ID[slotId].use;
    const mat = makePatchMaterial(def, use);
    const meshes = slotMeshes(slotId).map((src) => {
      const m = new THREE.Mesh(src.geometry, mat);
      m.matrixAutoUpdate = false;
      src.updateWorldMatrix(true, false);
      m.matrix.copy(src.matrixWorld);
      m.userData.patch = true;
      m.receiveShadow = true;
      m.renderOrder = 1;
      scene.add(m);
      return m;
    });
    patch = { slot: slotId, def, meshes, mat, anim: null };
  }
  patchU.uC.value.copy(point);
  patchU.uR.value = radius;
}

/** 移除补丁覆盖层。 */
function clearPatch() {
  if (!patch) return;
  for (const m of patch.meshes) scene.remove(m);
  patch.mat.dispose();
  patch = null;
}

/** 把补丁从当前半径铺开到整个表面，结束后真正替换槽位材质。 */
function spreadPatch(slotId, def, point) {
  commit();
  showPatch(slotId, def, point, patch && patch.slot === slotId ? patchU.uR.value : 0.05);
  patch.anim = { from: patchU.uR.value, to: 14, t0: performance.now(), dur: 750, done: () => {
    setSlotMaterial(slotId, def.id);
    clearPatch();
    refreshAll();
    flashSlot(slotId);
  } };
}

/** 每帧推进补丁动画。 */
function updatePatch(now) {
  if (!patch || !patch.anim) return;
  const a = patch.anim;
  const f = clamp((now - a.t0) / a.dur, 0, 1);
  patchU.uR.value = a.from + (a.to - a.from) * easeOut(f) ** 1.4;
  if (f >= 1) { patch.anim = null; a.done(); }
}

/** 某槽位的代表点（世界坐标）：房间表面用固定锚点，软装用对应家具的中心。 */
function slotAnchor(slotId) {
  if (room.anchors[slotId]) return room.anchors[slotId].clone();
  const pref = { upholstery: ['sofa', 'armchair', 'chair'], accents: ['sofa', 'bed', 'armchair'], bedding: ['bed'], rugs: ['rug'], woodwork: ['dining', 'sideboard', 'desk', 'wardrobe'] }[slotId] || [];
  for (const type of pref) {
    const p = state.pieces.find((q) => q.type === type);
    if (!p) continue;
    const ms = [];
    p.obj.traverse((o) => { if (o.isMesh && o.userData.slot === slotId) ms.push(o); });
    if (!ms.length) continue;
    const box = new THREE.Box3();
    for (const m of ms) box.expandByObject(m);
    const c = box.getCenter(new THREE.Vector3());
    c.y = box.max.y - (box.max.y - box.min.y) * 0.25;
    return c;
  }
  return null;
}

// ============================================================================
// 选中：表面槽位与家具
// ============================================================================
let selSlot = null;
let selected = null;

/** 选中某个表面槽位：托盘切到对应类别并提示“for the xxx”。 */
function selectSlot(id) {
  selSlot = id;
  if (id) {
    const s = SLOT_BY_ID[id];
    const cur = MATERIAL_BY_ID[state.slots[id]];
    if (!s.accepts.includes(activeTab)) setTab(s.accepts.includes(cur?.cat) ? cur.cat : s.accepts[0]);
  }
  refreshBoard();
  refreshTray();
  refreshCards();
}

/** 选中一件家具：显示弹窗和脚印框。 */
function selectPiece(p) {
  selected = p;
  $('#popup').hidden = !p;
  if (p) $('#pname').textContent = FURNITURE[p.type].name;
  updateFootprint();
}

// 家具脚印框：拖动时显示合法（青）/ 非法（红），选中时显示青色
const footprint = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#86e0ff', transparent: true, opacity: 0.28, depthWrite: false, fog: false }),
);
footprint.position.y = 0.012;
footprint.renderOrder = 3;
footprint.visible = false;
scene.add(footprint);

/** 根据当前拖动/选中状态更新脚印框。 */
function updateFootprint() {
  const p = drag?.piece || selected;
  if (!p) { footprint.visible = false; return; }
  const [hw, hd] = halfSize(p.type, drag?.piece ? drag.rot : p.rot);
  footprint.visible = true;
  footprint.scale.set(hw * 2, 1, hd * 2);
  footprint.position.x = p.obj.position.x;
  footprint.position.z = p.obj.position.z;
  footprint.material.color.set(drag?.piece && !drag.valid ? '#ff6b6b' : '#86e0ff');
}

/** 把家具转 90°；转不开时提示。 */
function turnPiece(p, dir = 1) {
  const rot = (p.rot + dir + 4) & 3;
  let [x, z] = snapPos(p.type, p.x, p.z, rot);
  if (!isValid(p.type, x, z, rot, p)) { [x, z] = [p.x, p.z]; }
  if (!isValid(p.type, x, z, rot, p)) return toast('这里转不开');
  commit();
  Object.assign(p, { x, z, rot });
  p.obj.position.set(x, 0, z);
  p.obj.rotation.y = rot * Math.PI / 2;
  piecesChanged();
  updateFootprint();
}

/** 删除家具（可撤销）。 */
function deletePiece(p) {
  commit();
  removePiece(p);
  piecesChanged();
  refreshAll();
}

// ============================================================================
// 画布交互：拖动家具、点击表面、拖动太阳、滚轮转向
// ============================================================================
let drag = null;      // 正在拖动的家具 { piece, from, off, rot, valid, isNew }
let down = null;      // 按下时的信息，用于区分点击和拖动
let sunDrag = false;

/** 发光体（太阳或月亮）在屏幕上的位置。 */
function orbScreen() {
  const s = (isDay(state.t) ? sunSprite : moonSprite).position.clone().project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: (s.x + 1) / 2 * r.width + r.left, y: (1 - s.y) / 2 * r.height + r.top, z: s.z };
}

/** 拖动太阳时：在当前时刻附近搜索弧线上离鼠标最近的点。 */
function timeFromScreen(cx, cy) {
  const r = canvas.getBoundingClientRect();
  let best = state.t, bd = Infinity;
  const v = new THREE.Vector3();
  const day = isDay(state.t);
  for (let t = state.t - 4; t <= state.t + 4; t += 0.02) {
    if (t < T_MIN || t > T_MAX || isDay(t) !== day) continue;
    orbPos(t, v).project(camera);
    const d = ((v.x + 1) / 2 * r.width + r.left - cx) ** 2 + ((1 - v.y) / 2 * r.height + r.top - cy) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

canvas.addEventListener('pointerleave', () => showTip(null));

canvas.addEventListener('pointerdown', (e) => {
  showTip(null);
  if (cine && e.button === 0) stopCine();
  viewTween = null;
  if (e.button !== 0) return;
  const o = orbScreen();
  if (o.z < 1 && Math.hypot(o.x - e.clientX, o.y - e.clientY) < 26) {
    sunDrag = true;
    controls.orbit.enabled = false;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  const hit = pick(e.clientX, e.clientY);
  down = { x: e.clientX, y: e.clientY, hit };
  if (hit?.piece) {
    controls.orbit.enabled = false;
    const fp = floorPoint(e.clientX, e.clientY) || new THREE.Vector3(hit.piece.x, 0, hit.piece.z);
    drag = { piece: hit.piece, from: { x: hit.piece.x, z: hit.piece.z, rot: hit.piece.rot }, off: new THREE.Vector3(fp.x - hit.piece.x, 0, fp.z - hit.piece.z), rot: hit.piece.rot, valid: true, moved: false, isNew: false };
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (sunDrag) {
    const t = timeFromScreen(e.clientX, e.clientY);
    setTime(t);
    previewsDirty();
    showSunBadge(true);
    return;
  }
  if (drag && !drag.isNew) {
    if (!drag.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) return;
    if (!drag.moved) { drag.moved = true; selectPiece(null); document.body.classList.add('dragging'); }
    moveDrag(e.clientX, e.clientY);
    return;
  }
  hoverCursor(e);
});

canvas.addEventListener('pointerup', (e) => {
  if (sunDrag) {
    sunDrag = false;
    controls.orbit.enabled = !cine;
    showSunBadge(false);
    return;
  }
  if (drag && !drag.isNew) {
    if (drag.moved) endDrag();
    else { drag = null; selectPiece(down.hit.piece); if (down.hit.slot) selectSlot(down.hit.slot); }
    controls.orbit.enabled = !cine;
    document.body.classList.remove('dragging');
    down = null;
    return;
  }
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
    const hit = down.hit;
    selectPiece(null);
    selectSlot(hit?.slot || null);
  }
  down = null;
});

// 拖动家具时滚轮转向；其他时候交给 OrbitControls 缩放
canvas.addEventListener('wheel', (e) => {
  if (!drag?.piece) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  drag.rot = (drag.rot + (e.deltaY > 0 ? 1 : 3)) & 3;
  drag.piece.obj.rotation.y = drag.rot * Math.PI / 2;
  if (drag.last) moveDrag(drag.last.x, drag.last.y);
}, { passive: false, capture: true });

/** 拖动中：地面交点 → 网格/墙面吸附 → 合法性 → 更新物体位置。 */
function moveDrag(cx, cy) {
  drag.last = { x: cx, y: cy };
  const fp = floorPoint(cx, cy);
  if (!fp) return;
  const p = drag.piece;
  const [x, z] = snapPos(p.type, fp.x - drag.off.x, fp.z - drag.off.z, drag.rot);
  drag.valid = isValid(p.type, x, z, drag.rot, p);
  drag.x = x; drag.z = z;
  p.obj.position.set(x, 0.03, z);
  updateFootprint();
  shadowsDirty();
}

/** 结束拖动：合法则提交，否则弹回原位。 */
function endDrag() {
  const p = drag.piece;
  if (drag.valid && drag.x != null) {
    history.push({ ...snapshot(), pieces: snapshot().pieces.map((q, i) => (state.pieces[i] === p ? { ...q, ...drag.from } : q)) });
    syncHistoryButtons();
    Object.assign(p, { x: drag.x, z: drag.z, rot: drag.rot });
  } else {
    toast(drag.x != null ? '这里放不下' : '');
  }
  p.obj.position.set(p.x, 0, p.z);
  p.obj.rotation.y = p.rot * Math.PI / 2;
  drag = null;
  updateFootprint();
  piecesChanged();
}

/** 悬停时切换鼠标指针：家具可抓、太阳可抓、表面可点。 */
let hoverRaf = 0;
function hoverCursor(e) {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    world.classList.remove('grab', 'point');
    const o = orbScreen();
    if (o.z < 1 && Math.hypot(o.x - e.clientX, o.y - e.clientY) < 26) { world.classList.add('grab'); showSunBadge(true); showTip(null); return; }
    if (!sunDrag) showSunBadge(false);
    const hit = pick(e.clientX, e.clientY);
    if (hit?.piece) world.classList.add('grab');
    else if (hit?.slot) world.classList.add('point');
    showTip(hit, e.clientX, e.clientY);
  });
}

/**
 * 悬停提示：家具显示“名字 · 材质”和操作说明；房间表面显示“表面 · 材质”。
 * 材质取鼠标下那块网格的槽位；家具的固定材质部分（灯罩、植物）就取这件家具的第一个可换槽位。
 */
function showTip(hit, x, y) {
  const tip = $('#tip');
  if (!hit || (!hit.piece && !hit.slot) || drag || trayDrag) { tip.hidden = true; return; }
  let slot = hit.slot;
  if (hit.piece && !slot) hit.piece.obj.traverse((o) => { if (!slot && o.userData.slot) slot = o.userData.slot; });
  const mat = slot ? MATERIAL_BY_ID[state.slots[slot]]?.name : null;
  const title = hit.piece ? FURNITURE[hit.piece.type].name : SLOT_BY_ID[slot].label;
  tip.querySelector('b').textContent = mat ? `${title} · ${mat}` : title;
  tip.querySelector('span').textContent = hit.piece ? '拖动可移动 · 点击可转向或移除' : '点击选中，再点下方样品替换';
  tip.hidden = false;
  tip.style.left = `${x + 16}px`;
  tip.style.top = `${y + 18}px`;
}

/** 太阳旁边的时间气泡。 */
function showSunBadge(on) {
  const b = $('#sunbadge');
  b.hidden = !on;
  if (on) {
    const o = orbScreen();
    b.style.left = `${o.x}px`;
    b.style.top = `${o.y - 14}px`;
    b.textContent = fmtTime(state.t);
  }
}

// ============================================================================
// 托盘拖拽：样品 → 表面，家具 → 房间
// ============================================================================
let trayDrag = null; // { kind:'mat'|'furn', def|type, x0, y0, moved, overCanvas, hover }
const ghost = $('#ghost');

/** 从托盘开始拖动（样品或家具）。 */
function startTrayDrag(e, kind, payload, img) {
  e.preventDefault();
  trayDrag = { kind, payload, x0: e.clientX, y0: e.clientY, moved: false, hover: null };
  ghost.style.backgroundImage = `url(${img})`;
  ghost.className = kind === 'furn' ? 'furn' : '';
  addEventListener('pointermove', onTrayMove);
  addEventListener('pointerup', onTrayUp, { once: true });
}

/** 托盘拖动中：判断是否在画布上，分别处理材质补丁预览和家具摆放。 */
function onTrayMove(e) {
  const d = trayDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
  if (!d.moved) { d.moved = true; ghost.hidden = false; document.body.classList.add('dragging'); stopCine(); }
  ghost.style.transform = `translate(${e.clientX - ghost.offsetWidth / 2}px, ${e.clientY - ghost.offsetHeight / 2}px)`;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const onCanvas = el === canvas;
  $$('.slot.drop').forEach((n) => n.classList.remove('drop'));

  if (d.kind === 'mat') {
    d.hover = null;
    const cell = el?.closest?.('.slot');
    if (cell && SLOT_BY_ID[cell.dataset.slot].accepts.includes(d.payload.cat)) cell.classList.add('drop');
    if (onCanvas) {
      const hit = pick(e.clientX, e.clientY);
      if (hit?.slot && SLOT_BY_ID[hit.slot].accepts.includes(d.payload.cat)) {
        const small = ['upholstery', 'accents', 'bedding'].includes(hit.slot);
        showPatch(hit.slot, d.payload, hit.point, small ? 0.3 : 0.55);
        d.hover = { slot: hit.slot, point: hit.point.clone() };
      }
    }
    if (!d.hover && !patch?.anim) clearPatch();
    ghost.classList.toggle('over', !!d.hover);
    return;
  }

  // 家具：在画布上时直接把实物放进场景跟随鼠标
  if (onCanvas) {
    const fp = floorPoint(e.clientX, e.clientY);
    if (!fp) return;
    if (!drag) {
      const p = { uid: uidSeq++, type: d.payload, x: fp.x, z: fp.z, rot: 0 };
      p.obj = buildPieceObject(p);
      piecesGroup.add(p.obj);
      drag = { piece: p, off: new THREE.Vector3(), rot: 0, valid: false, isNew: true };
    }
    drag.piece.obj.visible = true;
    ghost.hidden = true;
    moveDrag(e.clientX, e.clientY);
  } else {
    if (drag?.isNew) { drag.piece.obj.visible = false; drag.valid = false; footprint.visible = false; }
    ghost.hidden = false;
  }
}

/** 托盘拖动结束：落在合法位置则提交，否则取消。 */
function onTrayUp(e) {
  removeEventListener('pointermove', onTrayMove);
  const d = trayDrag;
  trayDrag = null;
  ghost.hidden = true;
  ghost.classList.remove('over');
  document.body.classList.remove('dragging');
  $$('.slot.drop').forEach((n) => n.classList.remove('drop'));
  if (!d) return;

  if (d.kind === 'mat') {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el?.closest?.('.slot');
    if (!d.moved) return clickSample(d.payload);
    if (d.hover) return spreadPatch(d.hover.slot, d.payload, d.hover.point);
    if (cell && SLOT_BY_ID[cell.dataset.slot].accepts.includes(d.payload.cat)) return applyToSlot(cell.dataset.slot, d.payload);
    clearPatch();
    return;
  }

  // 家具
  if (drag?.isNew) {
    const p = drag.piece;
    if (drag.valid && drag.x != null) {
      commit();
      Object.assign(p, { x: drag.x, z: drag.z, rot: drag.rot });
      p.obj.position.set(p.x, 0, p.z);
      state.pieces.push(p);
      drag = null;
      piecesChanged();
      selectPiece(p);
    } else {
      piecesGroup.remove(p.obj);
      drag = null;
      if (p.obj.visible) toast('这里放不下');
    }
    updateFootprint();
  } else if (!d.moved) {
    toast('把它拖进房间里');
  }
}

/** 点击样品：如果已选中表面且类别匹配，就从该表面的锚点铺开。 */
function clickSample(def) {
  if (!selSlot) return toast('把样品拖到表面上，或者先点一个表面');
  if (!SLOT_BY_ID[selSlot].accepts.includes(def.cat)) return toast(`${def.name}不能用在${SLOT_BY_ID[selSlot].noun}上`);
  applyToSlot(selSlot, def);
}

/** 把材质用铺开动画应用到某槽位（从其锚点开始）。 */
function applyToSlot(slotId, def) {
  if (state.slots[slotId] === def.id) return;
  const a = slotAnchor(slotId) || new THREE.Vector3();
  spreadPatch(slotId, def, a);
}

// ============================================================================
// 界面：预设、仪表、材质板、托盘、日光面板、浮动卡片
// ============================================================================
let activeTab = 'wood';
const TAB_ZH = { wood: '木材', stone: '石材', fabric: '布艺', paint: '涂料', furniture: '家具' };
const MOOD_ZH = { cozy: '温馨', bright: '明亮', moody: '沉郁' };
const MOMENT_ICONS = {
  morning: '<svg viewBox="0 0 24 24"><path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 6v3M5.6 10.6l1.5 1.5M18.4 10.6l-1.5 1.5"/></svg>',
  midday: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  evening: '<svg viewBox="0 0 24 24"><path d="M8 3h8l2 7H6z"/><path d="M12 10v9M8 21h8"/></svg>',
  night: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
};

/** 首次构建所有界面元素。 */
function buildUI() {
  // 预设
  $('#presets').innerHTML = PRESETS.map((p) => `
    <button class="preset" data-id="${p.id}">
      <span class="chips">${['floor', 'walls', 'upholstery', 'accents'].map((s) => `<i style="background:url(${swatchURL(MATERIAL_BY_ID[p.slots[s]], 32)}) center/cover"></i>`).join('')}</span>
      <b>${p.label}</b><small>${p.sub}</small>
    </button>`).join('');
  $$('.preset').forEach((b, i) => b.addEventListener('click', () => applyPreset(i)));

  // 情绪仪表
  $('#meter').innerHTML = ['cozy', 'bright', 'moody'].map((k) => `
    <div class="gauge" data-k="${k}" style="--c:var(--${k})"><span class="cap">${MOOD_ZH[k]}</span><b>0%</b><div class="bar"><i style="background:var(--${k})"></i></div></div>`).join('');

  // 材质板
  $('#slots').innerHTML = SLOTS.map((s) => `
    <button class="slot" data-slot="${s.id}"><img alt="" /><span class="cap">${s.label}</span><span></span></button>`).join('');
  $$('.slot').forEach((b) => b.addEventListener('click', () => selectSlot(selSlot === b.dataset.slot ? null : b.dataset.slot)));

  // 托盘标签
  const tabs = [...CATEGORIES, 'furniture'];
  $('#tabs').innerHTML = tabs.map((c) => (c === 'furniture' ? '<span class="sep"></span>' : '') + `<button data-tab="${c}">${TAB_ZH[c]}</button>`).join('');
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#target button').addEventListener('click', () => selectSlot(null));

  // 日光
  $('#moments').innerHTML = MOMENTS.map((m) => `
    <button class="moment" data-id="${m.id}">${MOMENT_ICONS[m.id]}<canvas width="184" height="108"></canvas><span><b>${m.label}</b><small>${fmtTime(m.t)}</small></span></button>`).join('');
  $$('.moment').forEach((b, i) => b.addEventListener('click', () => tweenTime(MOMENTS[i].t)));
  const slider = $('#time');
  slider.addEventListener('input', () => { setTime(+slider.value); previewsDirty(); });

  // 工具栏
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#shot').addEventListener('click', () => { wantShot = true; });
  $('#share').addEventListener('click', share);
  $('#eye').addEventListener('click', toggleNotes);
  $('#cine').addEventListener('click', toggleCine);
  $('#helpbtn').addEventListener('click', () => toggleHelp(true));
  $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.classList.contains('x')) toggleHelp(false); });

  // 家具弹窗
  $('#pturn').addEventListener('click', () => selected && turnPiece(selected));
  $('#premove').addEventListener('click', () => selected && deletePiece(selected));

  // 浮动卡片
  $('#cards').innerHTML = CARD_SLOTS.map((s) => `<div class="card" data-slot="${s}"><img alt="" /><div><b></b><small>${SLOT_BY_ID[s].label}</small></div></div>`).join('');
  $$('.card').forEach((c) => c.addEventListener('click', () => selectSlot(c.dataset.slot)));

  buildRenderPanel();
  setTab('wood');
}

/** 切换托盘标签。 */
function setTab(tab) {
  activeTab = tab;
  refreshTray();
}

/** 根据当前标签重绘托盘内容，并标出与所选表面不兼容的类别。 */
function refreshTray() {
  $$('#tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === activeTab);
    b.classList.toggle('dim', !!selSlot && b.dataset.tab !== 'furniture' && !SLOT_BY_ID[selSlot].accepts.includes(b.dataset.tab));
  });
  const tgt = $('#target');
  tgt.hidden = !selSlot;
  if (selSlot) tgt.querySelector('span').textContent = `用于${SLOT_BY_ID[selSlot].noun}`;

  const items = $('#items');
  if (activeTab === 'furniture') {
    items.innerHTML = FURNITURE_ORDER.map((k) => `<div class="item furn" data-type="${k}"><img alt="" src="${furnThumbs[k] || ''}" /><span>${FURNITURE[k].name}</span></div>`).join('');
    $$('.item.furn').forEach((n) => n.addEventListener('pointerdown', (e) => startTrayDrag(e, 'furn', n.dataset.type, furnThumbs[n.dataset.type])));
    return;
  }
  const cur = selSlot ? state.slots[selSlot] : null;
  const used = new Set(Object.values(state.slots));
  items.innerHTML = MATERIALS.filter((m) => m.cat === activeTab).map((m) => {
    const isCur = selSlot ? cur === m.id : used.has(m.id);
    return `<div class="item${isCur ? ' cur' : ''}" data-id="${m.id}" title="${m.name}"><img alt="" src="${swatchURL(m, 120)}" /><span>${m.name}</span></div>`;
  }).join('');
  $$('.item[data-id]').forEach((n) => {
    const def = MATERIAL_BY_ID[n.dataset.id];
    n.addEventListener('pointerdown', (e) => startTrayDrag(e, 'mat', def, swatchURL(def, 120)));
  });
}

/** 刷新左侧材质板。 */
function refreshBoard() {
  $$('.slot').forEach((b) => {
    const m = MATERIAL_BY_ID[state.slots[b.dataset.slot]];
    const img = b.querySelector('img');
    const src = swatchURL(m, 104);
    if (img.getAttribute('src') !== src) img.src = src;
    b.querySelector('span:last-child').textContent = m.name;
    b.classList.toggle('on', selSlot === b.dataset.slot);
  });
}

/** 材质替换后让对应格子弹一下，给出反馈。 */
function flashSlot(id) {
  const b = $(`.slot[data-slot="${id}"]`);
  if (!b) return;
  b.classList.remove('flash');
  void b.offsetWidth;
  b.classList.add('flash');
}

/** 刷新情绪仪表、解释句和预设高亮。 */
function refreshMood() {
  if (!lighting.state) return;
  const md = readMood(state.slots, lighting.state);
  $$('.gauge').forEach((g) => {
    const v = md[g.dataset.k];
    g.querySelector('b').textContent = `${Math.round(v * 100)}%`;
    g.querySelector('.bar i').style.width = `${v * 100}%`;
    g.classList.toggle('top', md.top === g.dataset.k);
  });
  $('#line').innerHTML = md.line;
  $$('.preset').forEach((b, i) => {
    const p = PRESETS[i];
    const on = Math.abs(state.t - p.t) < 0.6 && SLOTS.every((s) => state.slots[s.id] === p.slots[s.id]);
    b.classList.toggle('on', on);
  });
}

/** 刷新时钟、滑块和“当前时段”高亮。 */
function refreshTimeUI() {
  $('#clock').textContent = fmtTime(state.t);
  const slider = $('#time');
  if (document.activeElement !== slider) slider.value = state.t;
  let best = -1, bd = 1.3;
  MOMENTS.forEach((m, i) => { const d = Math.abs(m.t - state.t); if (d < bd) { bd = d; best = i; } });
  $$('.moment').forEach((b, i) => b.classList.toggle('on', i === best));
}

/** 全量刷新（撤销、预设等大范围变化后调用）。 */
function refreshAll() {
  refreshBoard();
  refreshTray();
  refreshMood();
  refreshCards();
  previewsDirty();
}

/** 应用预设：材质瞬间替换，时刻平滑过渡。 */
function applyPreset(i) {
  const p = PRESETS[i];
  commit();
  for (const s of SLOTS) setSlotMaterial(s.id, p.slots[s.id]);
  tweenTime(p.t);
  refreshAll();
  SLOTS.forEach((s) => flashSlot(s.id));
}

// 浮动卡片：显示几个关键表面当前的材质，用引线连到房间里的位置
const CARD_SLOTS = ['upholstery', 'slats', 'walls', 'floor', 'bedding'];

/** 刷新卡片内容（图片和名字）。 */
function refreshCards() {
  $$('.card').forEach((c) => {
    const m = MATERIAL_BY_ID[state.slots[c.dataset.slot]];
    const img = c.querySelector('img');
    const src = swatchURL(m, 156);
    if (img.getAttribute('src') !== src) img.src = src;
    c.querySelector('b').textContent = m.name;
    c.classList.toggle('on', selSlot === c.dataset.slot);
  });
}

/**
 * 每帧布局卡片：卡片排在顶部一行，横坐标跟随锚点投影，并做最小间距排斥避免重叠；
 * 再用 SVG 引线连到锚点。
 */
function layoutCards() {
  const W = innerWidth;
  const left = 350, right = W - 280;
  const items = [];
  for (const id of CARD_SLOTS) {
    const a = slotAnchor(id);
    if (!a) { items.push({ id, hidden: true }); continue; }
    const p = a.project(camera);
    if (p.z > 1) { items.push({ id, hidden: true }); continue; }
    items.push({ id, ax: (p.x + 1) / 2 * W, ay: (1 - p.y) / 2 * innerHeight });
  }
  const vis = items.filter((i) => !i.hidden).sort((a, b) => a.ax - b.ax);
  const gap = 96;
  vis.forEach((it) => { it.cx = clamp(it.ax, left, right); });
  for (let k = 0; k < 4; k++) {
    for (let i = 1; i < vis.length; i++) if (vis[i].cx - vis[i - 1].cx < gap) vis[i].cx = vis[i - 1].cx + gap;
    const over = vis.length ? vis[vis.length - 1].cx - right : 0;
    if (over > 0) vis.forEach((it) => { it.cx -= over; });
    for (let i = vis.length - 2; i >= 0; i--) if (vis[i + 1].cx - vis[i].cx < gap) vis[i].cx = vis[i + 1].cx - gap;
  }
  const top = 86;
  let svg = '';
  for (const it of items) {
    const el = $(`.card[data-slot="${it.id}"]`);
    el.style.visibility = it.hidden ? 'hidden' : 'visible';
    if (it.hidden) continue;
    el.style.transform = `translate(${it.cx - 41}px, ${top}px)`;
    const by = top + 104;
    if (it.ay > by + 10) {
      svg += `<line x1="${it.cx}" y1="${by}" x2="${it.ax}" y2="${it.ay}"/><circle class="halo" cx="${it.ax}" cy="${it.ay}" r="7"/><circle cx="${it.ax}" cy="${it.ay}" r="3"/>`;
    }
  }
  $('#leaders').innerHTML = svg;
}

/** 弹窗跟随所选家具。 */
function layoutPopup() {
  if (!selected) return;
  const v = selected.obj.position.clone();
  v.y = FURNITURE[selected.type].h + 0.25;
  v.project(camera);
  const pop = $('#popup');
  pop.style.left = `${(v.x + 1) / 2 * innerWidth}px`;
  pop.style.top = `${(1 - v.y) / 2 * innerHeight - 8}px`;
}

/** 显示/隐藏卡片和太阳轨迹。 */
function toggleNotes() {
  const off = document.body.classList.toggle('notes-off');
  $('#eye').classList.toggle('on', off);
  sunPath.visible = !off;
}

/** 打开/关闭帮助。 */
function toggleHelp(on) {
  $('#help').hidden = !on;
}

/** 轻提示。 */
let toastTimer = 0;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}

/** 撤销 / 重做。 */
function undo() {
  const s = history.undo(snapshot());
  if (s) restore(s, { animateTime: true });
  syncHistoryButtons();
}
function redo() {
  const s = history.redo(snapshot());
  if (s) restore(s, { animateTime: true });
  syncHistoryButtons();
}
function syncHistoryButtons() {
  $('#undo').disabled = !history.canUndo;
  $('#redo').disabled = !history.canRedo;
}

/** 复制分享链接：状态编码进 hash。 */
async function share() {
  const url = `${location.origin}${location.pathname}#r=${encodeState(snapshot())}`;
  window.history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('链接已复制'); } catch { toast('链接已放在地址栏里'); }
}

// ============================================================================
// 四个时段预览图 + 家具缩略图（借用主渲染器的默认帧缓冲渲染，再拷贝到小 canvas）
// ============================================================================
const previewCam = new THREE.PerspectiveCamera(28, 184 / 108, 0.3, 200);
let previewAt = 0;
let previewPending = true;
/** 标记预览需要重绘（防抖：静止 600ms 后才渲染，避免拖动时卡顿）。 */
function previewsDirty() { previewPending = true; previewAt = performance.now() + 600; }

/** 渲染四个时段的缩略图；渲染期间隐藏所有辅助元素。 */
function renderPreviews() {
  previewPending = false;
  const W = 184, H = 108;
  const az = 0.5, pol = 0.98, d = 23;
  previewCam.position.set(d * Math.sin(pol) * Math.sin(az), d * Math.cos(pol), d * Math.sin(pol) * Math.cos(az)).add(HOME.target);
  previewCam.lookAt(HOME.target);
  const vis = [sunSprite.visible, moonSprite.visible, sunPath.visible, footprint.visible];
  sunSprite.visible = moonSprite.visible = sunPath.visible = footprint.visible = false;
  if (patch) patch.meshes.forEach((m) => { m.visible = false; });
  const bg = scene.background;
  const prevPR = renderer.getPixelRatio();
  renderer.setPixelRatio(1);
  renderer.setScissorTest(true);
  $$('.moment canvas').forEach((cv, i) => {
    const L = lighting.apply(MOMENTS[i].t);
    scene.background = skyTexture(L.sky, L.hor);
    renderer.shadowMap.needsUpdate = true;
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, W, H);
    renderer.render(scene, previewCam);
    const ctx = cv.getContext('2d');
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, cv.width, cv.height);
  });
  renderer.setScissorTest(false);
  renderer.setPixelRatio(prevPR);
  resize();
  [sunSprite.visible, moonSprite.visible, sunPath.visible, footprint.visible] = vis;
  if (patch) patch.meshes.forEach((m) => { m.visible = true; });
  scene.background = bg;
  setTime(state.t);
  shadowsDirty();
}

const furnThumbs = {};
/** 启动时为每种家具渲染一张透明背景缩略图，用作托盘图标。 */
function renderFurnitureThumbs() {
  const W = 160, H = 128;
  const ts = new THREE.Scene();
  ts.add(new THREE.HemisphereLight('#ffffff', '#555566', 1.6));
  const dl = new THREE.DirectionalLight('#fff3e0', 2.2);
  dl.position.set(-3, 6, 5);
  ts.add(dl);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  const prevPR = renderer.getPixelRatio();
  const prevTM = renderer.toneMapping;
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.setScissorTest(true);
  for (const k of FURNITURE_ORDER) {
    const obj = FURNITURE[k].build(M);
    obj.rotation.y = -0.6;
    ts.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.92;
    cam.position.set(c.x, c.y + dist * 0.5, c.z + dist * 0.86);
    cam.lookAt(c);
    renderer.setViewport(0, 0, W, H);
    renderer.setScissor(0, 0, W, H);
    renderer.clear();
    renderer.render(ts, cam);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(canvas, 0, canvas.height - H, W, H, 0, 0, W, H);
    furnThumbs[k] = out.toDataURL('image/png');
    ts.remove(obj);
  }
  renderer.setScissorTest(false);
  renderer.setPixelRatio(prevPR);
  renderer.toneMapping = prevTM;
  resize();
}

// ============================================================================
// 渲染设置面板（⌘'）
// ============================================================================
const RSET = [
  { id: 'exposure', label: '曝光', min: 0.5, max: 1.8, step: 0.01, def: 1, set: (v) => { lighting.exposure = v; setTime(state.t); } },
  { id: 'bloom', label: '泛光', min: 0, max: 1.5, step: 0.01, def: 0.28, set: (v) => { bloom.strength = v; } },
  { id: 'ao', label: '环境光遮蔽', type: 'switch', def: 1, set: (v) => { gtao.enabled = !!v; } },
  { id: 'aoAmt', label: '遮蔽强度', min: 0, max: 1, step: 0.01, def: 0.75, set: (v) => { gtao.blendIntensity = v; } },
  { id: 'dof', label: '景深', type: 'switch', def: 1, set: (v) => { bokeh.enabled = !!v; } },
  { id: 'dofAmt', label: '虚化程度', min: 0, max: 0.004, step: 0.0001, def: 0.002, set: (v) => { bokeh.uniforms.aperture.value = v; } },
  { id: 'dofRange', label: '清楚范围', min: 0, max: 15, step: 0.1, def: 7, set: (v) => { bokeh.uniforms.range.value = v; } },
  { id: 'sun', label: '阳光', min: 0, max: 2, step: 0.01, def: 1, set: (v) => { lighting.scale.sun = v; setTime(state.t); } },
  { id: 'lamps', label: '灯光', min: 0, max: 2.5, step: 0.01, def: 1, set: (v) => { lighting.scale.lamp = v; setTime(state.t); } },
  { id: 'fov', label: '视野角度', min: 18, max: 60, step: 0.5, def: 30, set: (v) => { camera.fov = v; camera.updateProjectionMatrix(); } },
];
const rvals = {};
let rrow = 0;

/** 构建渲染设置行：滑块或开关，支持双击重置、滚轮调节。 */
function buildRenderPanel() {
  const box = $('#rrows');
  box.innerHTML = RSET.map((r, i) => `<div class="rrow" data-i="${i}"><span>${r.label}</span>${r.type === 'switch'
    ? '<button class="sw"></button><output></output>'
    : `<input type="range" min="${r.min}" max="${r.max}" step="${r.step}" /><output></output>`}</div>`).join('');
  RSET.forEach((r, i) => {
    const row = box.children[i];
    const input = row.querySelector('input');
    const sw = row.querySelector('.sw');
    row.addEventListener('pointerdown', () => { rrow = i; markRow(); });
    row.addEventListener('dblclick', () => setR(i, r.def));
    if (input) {
      input.addEventListener('input', () => setR(i, +input.value));
      input.addEventListener('wheel', (e) => { e.preventDefault(); nudgeR(i, e.deltaY < 0 ? 1 : -1, e.shiftKey); }, { passive: false });
    }
    if (sw) sw.addEventListener('click', () => setR(i, rvals[r.id] ? 0 : 1));
    setR(i, r.def);
  });
  $('#render .x').addEventListener('click', () => toggleRender(false));
  markRow();
}
/** 设置某行的值并立即生效。 */
function setR(i, v) {
  const r = RSET[i];
  if (r.type !== 'switch') v = clamp(Math.round(v / r.step) * r.step, r.min, r.max);
  rvals[r.id] = v;
  r.set(v);
  const row = $('#rrows').children[i];
  const input = row.querySelector('input');
  if (input) input.value = v;
  row.querySelector('.sw')?.classList.toggle('on', !!v);
  row.querySelector('output').textContent = r.type === 'switch' ? (v ? '开' : '关') : (+v).toFixed(r.step < 0.01 ? 4 : 2);
}
/** 键盘/滚轮微调：Shift 粗调。 */
function nudgeR(i, dir, coarse) {
  const r = RSET[i];
  if (r.type === 'switch') return setR(i, rvals[r.id] ? 0 : 1);
  setR(i, rvals[r.id] + dir * r.step * (coarse ? 10 : 1));
}
function markRow() { $$('.rrow').forEach((n, i) => n.classList.toggle('on', i === rrow)); }
function toggleRender(on = $('#render').hidden) { $('#render').hidden = !on; }

/** 渲染设置面板打开时的快捷键；返回 true 表示已处理。 */
function renderPanelKeys(e) {
  if ($('#render').hidden) return false;
  if (e.key === 'ArrowUp') { rrow = (rrow + RSET.length - 1) % RSET.length; markRow(); }
  else if (e.key === 'ArrowDown') { rrow = (rrow + 1) % RSET.length; markRow(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') nudgeR(rrow, e.key === 'ArrowRight' ? 1 : -1, e.shiftKey);
  else if (e.shiftKey && (e.key === ')' || e.code === 'Digit0')) RSET.forEach((r, i) => setR(i, r.def));
  else if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey) {
    navigator.clipboard?.writeText(JSON.stringify(rvals, null, 2));
    toast('渲染设置已复制');
  } else return false;
  e.preventDefault();
  return true;
}

// ============================================================================
// 键盘
// ============================================================================
addEventListener('keydown', (e) => {
  const tag = e.target?.tagName;
  if (tag === 'INPUT' && e.target.type !== 'range') return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;

  if (mod && (e.key === "'" || e.code === 'Quote')) { e.preventDefault(); return toggleRender(); }
  if (renderPanelKeys(e)) return;
  if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && k === 'y') { e.preventDefault(); return redo(); }
  if (mod) return;
  if (e.key === 'Escape') { toggleHelp(false); toggleRender(false); selectPiece(null); selectSlot(null); stopCine(); return; }
  if (tag === 'INPUT' && (e.key.startsWith('Arrow'))) return;

  if (['1', '2', '3'].includes(e.key)) return applyPreset(+e.key - 1);
  if (e.key === '[' || e.key === ']') { setTime(state.t + (e.key === ']' ? 0.25 : -0.25)); previewsDirty(); return; }
  if ((e.key === ',' || e.key === '.') && selected) return turnPiece(selected, e.key === '.' ? 1 : -1);
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); return deletePiece(selected); }
  if (e.shiftKey && k === 'n') return toggleNotes();
  if (k === 'c') return toggleCine();
  if (k === 'r') return resetView();
  if (e.key === '/' || e.key === '?') { document.body.classList.toggle('ui-hidden'); return; }
  if ('wasdqe'.includes(k) && k.length === 1) { keys.add(k); viewTween = null; stopCine(); }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

// ============================================================================
// 截图
// ============================================================================
let wantShot = false;
/** 在渲染完成的同一帧读取画布并下载 PNG。 */
function takeShot() {
  wantShot = false;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `moodroom-${fmtTime(state.t).replace(':', '')}.png`;
  a.click();
  toast('图片已保存');
}

// ============================================================================
// 启动与主循环
// ============================================================================
/** 初始化：控制器、默认/分享状态、界面、缩略图，然后开始循环。 */
async function init() {
  controls.orbit = new OrbitControls(camera, canvas);
  Object.assign(controls.orbit, {
    enableDamping: true, dampingFactor: 0.08, minDistance: 4, maxDistance: 45, maxPolarAngle: 1.42,
    zoomSpeed: 0.9, rotateSpeed: 0.7, screenSpacePanning: false,
  });
  controls.orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  resize();
  controls.orbit.target.copy(HOME.target);
  placeCamera(HOME.az, HOME.pol, homeDistance(), HOME.target);
  camera.updateMatrixWorld();
  buildSunCurve();

  try { await document.fonts.ready; } catch { /* 字体加载失败不影响功能 */ }

  const shared = location.hash.startsWith('#r=') ? decodeState(location.hash.slice(3)) : null;
  for (const s of SLOTS) setSlotMaterial(s.id, (shared?.slots[s.id]) || state.slots[s.id]);
  for (const p of shared?.pieces || DEFAULT_PIECES) {
    if (!FURNITURE[p.type]) continue;
    const added = addPiece(p);
    if (!isValid(added.type, added.x, added.z, added.rot, added)) { console.warn('[moodroom] overlapping default piece', p); badPieces.push(p); }
  }
  piecesChanged();

  renderFurnitureThumbs();
  buildUI();
  setTime(shared?.t ?? state.t);
  refreshAll();
  syncHistoryButtons();

  addEventListener('resize', () => { resize(); previewsDirty(); });
  requestAnimationFrame(loop);
}

const badPieces = [];
let last = performance.now();
let firstFrame = true;
let badgeWasTween = false;
/** 主循环：动画推进 → 相机 → 预览 → 后期渲染 → 叠加界面布局。 */
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (timeTween) {
    const f = clamp((now - timeTween.t0) / timeTween.dur, 0, 1);
    setTime(timeTween.from + (timeTween.to - timeTween.from) * easeInOut(f));
    if (f >= 1) { timeTween = null; previewsDirty(); }
  }
  updatePatch(now);
  if (viewTween) {
    const f = clamp((now - viewTween.t0) / viewTween.dur, 0, 1);
    const e = easeInOut(f);
    const a = viewTween.from, b = viewTween.to;
    let daz = b.az - a.az;
    daz = Math.atan2(Math.sin(daz), Math.cos(daz));
    const tg = a.target.clone().lerp(b.target, e);
    controls.orbit.target.copy(tg);
    placeCamera(a.az + daz * e, a.pol + (b.pol - a.pol) * e, a.d + (b.d - a.d) * e, tg);
    if (f >= 1) viewTween = null;
  }
  if (cine) updateCine(now);
  else {
    updateKeysMove(dt);
    if (!viewTween) controls.orbit.update();
  }

  // 选中表面时让材质轻轻呼吸发光，提示它在房间里的位置
  for (const s of SLOTS) {
    const m = slotMats[s.id];
    const on = selSlot === s.id;
    m.emissive.set(on ? '#3aa8d8' : '#000000');
    m.emissiveIntensity = on ? 0.12 + 0.1 * Math.sin(now / 260) : 0;
  }

  if (previewPending && now > previewAt && !drag && !sunDrag && !patch?.anim && !timeTween) renderPreviews();

  if (shadowFlag) { renderer.shadowMap.needsUpdate = true; shadowFlag = false; }
  bokeh.uniforms.focus.value = camera.position.distanceTo(controls.orbit.target);
  composer.render(dt);
  renderer.autoClear = false;
  // 屏幕深度缓冲里可能残留预览图渲染的深度，先清掉，否则叠加层会被错误遮挡
  renderer.clearDepth();
  renderer.render(overlay, camera);
  renderer.autoClear = true;
  if (wantShot) takeShot();

  if (!document.body.classList.contains('notes-off')) layoutCards();
  layoutPopup();
  // 拖动太阳或时刻动画进行中时，在发光体旁显示时间
  if (sunDrag || timeTween) showSunBadge(true);
  else if (badgeWasTween) showSunBadge(false);
  badgeWasTween = !!timeTween;

  if (firstFrame) { firstFrame = false; $('#loading').classList.add('gone'); }
}

// 开发模式下暴露内部对象，方便自动化测试和调试
if (import.meta.env.DEV) window.__moodroom = { badPieces: () => badPieces, scene, overlay, camera, renderer, state, sunSprite, moonSprite, sunPath, orbScreen, setTime };

init();
