// 日光系统：根据一天中的时刻计算太阳/月亮方向、光色、天空色和室内灯光强度。
import * as THREE from 'three';
import { fixed } from './fixed.js';

export const T_MIN = 5.5;
export const T_MAX = 23.5;
export const SUN_R = 8.5;          // 太阳轨迹半径（米），只用于显示和拖动
export const MOMENTS = [
  { id: 'morning', label: '早晨', t: 7.6 },
  { id: 'midday', label: '正午', t: 12.8 },
  { id: 'evening', label: '傍晚', t: 18.5 },
  { id: 'night', label: '夜晚', t: 22.2 },
];

// 关键帧：按小时插值。sun 为直射光强度，lamp 为室内灯开启程度（0~1），exp 为曝光补偿。
const KEYS = [
  { t: 5.5, sun: 0.0, sunC: '#ff8a50', hemi: 0.10, sky: '#0d1322', hor: '#1b2238', lamp: 1.0, exp: 1.15 },
  { t: 6.4, sun: 0.5, sunC: '#ff9254', hemi: 0.22, sky: '#2b3555', hor: '#c98257', lamp: 0.65, exp: 1.05 },
  { t: 7.6, sun: 2.2, sunC: '#ffc68f', hemi: 0.42, sky: '#577aa8', hor: '#e8c29a', lamp: 0.1, exp: 1.0 },
  { t: 10, sun: 2.9, sunC: '#ffe9cf', hemi: 0.55, sky: '#6d9bd2', hor: '#d5e3ef', lamp: 0.0, exp: 0.95 },
  { t: 12.8, sun: 3.2, sunC: '#fff6e8', hemi: 0.62, sky: '#78a6dc', hor: '#dce9f4', lamp: 0.0, exp: 0.92 },
  { t: 16, sun: 2.7, sunC: '#ffe2bb', hemi: 0.5, sky: '#6a8fc4', hor: '#ecd6b8', lamp: 0.0, exp: 0.95 },
  { t: 18.5, sun: 2.2, sunC: '#ffa45c', hemi: 0.34, sky: '#3f4b78', hor: '#f0a46c', lamp: 0.45, exp: 1.0 },
  { t: 19.6, sun: 0.7, sunC: '#ff7140', hemi: 0.2, sky: '#262c4c', hor: '#a85a40', lamp: 0.85, exp: 1.05 },
  { t: 20.6, sun: 0.0, sunC: '#ff7140', hemi: 0.12, sky: '#121831', hor: '#2c2b45', lamp: 1.0, exp: 1.1 },
  { t: 23.5, sun: 0.0, sunC: '#ff7140', hemi: 0.1, sky: '#0b1020', hor: '#171d33', lamp: 1.0, exp: 1.15 },
];

const _a = new THREE.Color(), _b = new THREE.Color();

/** 在相邻两个关键帧之间做插值，颜色在线性空间混合。 */
export function sample(t) {
  t = THREE.MathUtils.clamp(t, T_MIN, T_MAX);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].t < t) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const f = THREE.MathUtils.smoothstep(t, k0.t, k1.t);
  const lerp = (p) => k0[p] + (k1[p] - k0[p]) * f;
  const col = (p) => _a.set(k0[p]).lerp(_b.set(k1[p]), f).clone();
  return {
    t, sun: lerp('sun'), sunC: col('sunC'), hemi: lerp('hemi'), sky: col('sky'), hor: col('hor'),
    lamp: lerp('lamp'), exp: lerp('exp'),
  };
}

// 日月轨道：一个倾斜的整圆，24 小时转一圈，正午 NOON 时太阳在最高点。
// 圆所在平面由 ORBIT_X（右偏前，傍晚太阳落在开口一侧）和 ORBIT_U（上偏后，正午阳光从后窗进来）张成；
// 圆心抬高 ORBIT_LIFT，让日出日落大约在 5:30 / 20:00，傍晚太阳仍有足够高度照进屋里。
const NOON = 12.8;
const ORBIT_X = new THREE.Vector3(1, 0, 0.35).normalize();
const ORBIT_U = new THREE.Vector3(0, 1, -0.45).normalize();
const ORBIT_LIFT = 0.3;

/**
 * 轨道上的点（以圆心为原点的单位圆，再加上抬高量）。
 * which = 'sun' 取太阳；'moon' 取正对面的月亮。
 */
export function orbitPoint(t, which = 'sun', out = new THREE.Vector3()) {
  const phi = (2 * Math.PI * (t - NOON)) / 24;
  const k = which === 'moon' ? -1 : 1;
  return out.copy(ORBIT_X).multiplyScalar(k * Math.sin(phi))
    .addScaledVector(ORBIT_U, k * Math.cos(phi))
    .add(_lift.set(0, ORBIT_LIFT, 0));
}
const _lift = new THREE.Vector3();

/** 是否处于白天：太阳在地平线以上。 */
export const isDay = (t) => orbitPoint(t, 'sun', _probe).y > 0.02;
const _probe = new THREE.Vector3();

/** 主光源方向（单位向量）：白天指向太阳，夜里指向月亮。 */
export function sunDir(t, out = new THREE.Vector3()) {
  return orbitPoint(t, isDay(t) ? 'sun' : 'moon', out).normalize();
}

/** 把小时数格式化为 HH:MM。 */
export function fmtTime(t) {
  const h = Math.floor(t) % 24;
  const m = Math.floor((t - Math.floor(t)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 场景灯光控制器：持有太阳、天光、补光和一个固定大小的点光源池（家具台灯/落地灯）。
 * 点光源池预先分配，避免增删灯具时数量变化导致所有着色器重新编译而卡顿。
 */
export class Lighting {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.scale = { sun: 1, lamp: 1 };

    this.hemi = new THREE.HemisphereLight('#c9d6ea', '#5a4a3a', 0.5);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#ffffff', 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -8.5, right: 8.5, top: 8.5, bottom: -8.5, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.target.position.set(0, 0.5, 0);
    scene.add(this.sun, this.sun.target);

    // 一个弱的冷色补光，避免背光面完全死黑
    this.fill = new THREE.DirectionalLight('#9db6ff', 0.25);
    this.fill.position.set(6, 9, 12);
    scene.add(this.fill);

    this.pool = [];
    for (let i = 0; i < 8; i++) {
      // 衰减指数取 1.3（比物理值 2 平缓）：灯旁的墙不会被照成一块刺眼的白斑，远处仍有余光
      const p = new THREE.PointLight('#ffc98a', 0, 6, 1.3);
      p.position.set(0, -50, 0);
      scene.add(p);
      this.pool.push(p);
    }
    this.lamps = [];
    this.state = null;
  }

  /** 更新灯具位置列表（世界坐标）；超过池容量的灯只发光不照明。 */
  setLamps(list) {
    this.lamps = list;
    this.pool.forEach((p, i) => {
      const l = list[i];
      if (l) { p.position.copy(l.pos); p.userData.base = l.intensity ?? 1; p.color.set(l.color ?? '#ffc98a'); }
      else { p.position.set(0, -50, 0); p.userData.base = 0; }
    });
    if (this.state) this.apply(this.state.t);
  }

  /** 按时刻设置所有灯光、天空背景和曝光；返回采样状态供情绪计算使用。 */
  apply(t) {
    const s = sample(t);
    const dir = sunDir(t);
    const day = isDay(t);
    this.sun.position.copy(dir).multiplyScalar(20).add(this.sun.target.position);
    if (day) {
      // 太阳贴近地平线时强度衰减，避免黄昏时直射过亮
      const horizon = THREE.MathUtils.smoothstep(dir.y, 0.03, 0.22);
      this.sun.intensity = s.sun * horizon * this.scale.sun;
      this.sun.color.copy(s.sunC);
    } else {
      this.sun.intensity = 0.35 * this.scale.sun;     // 月光
      this.sun.color.set('#8fa8e8');
    }
    this.hemi.intensity = s.hemi * 0.9;
    this.hemi.color.copy(s.sky).lerp(_a.set('#ffffff'), 0.6);
    // 环境贴图强度：白天提供柔和天光，夜里压低，让灯光成为主角
    this.scene.environmentIntensity = 0.03 + s.hemi * 0.22;
    this.fill.intensity = 0.1 + s.hemi * 0.3;
    for (const p of this.pool) p.intensity = (p.userData.base || 0) * s.lamp * 2.6 * this.scale.lamp;
    // 灯罩和灯泡自发光压低，避免泛光把它们晕成一团白
    fixed('shade').emissiveIntensity = s.lamp * 0.6;
    fixed('bulb').emissiveIntensity = s.lamp * 1.5;
    fixed('screen').emissiveIntensity = 0.2 + s.lamp * 0.8;
    fixed('trim').emissiveIntensity = 0.6 + s.lamp * 1.4;

    this.renderer.toneMappingExposure = s.exp * (this.exposure ?? 1);
    this.renderer.shadowMap.needsUpdate = true;
    this.state = { ...s, dir: dir.clone(), day, sunI: this.sun.intensity };
    return this.state;
  }
}
