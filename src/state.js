// 应用状态：表面槽位定义、默认家具布局、三种预设、撤销/重做和分享链接编码。
import { MATERIALS } from './materials.js';

// 可换材质的表面。accepts 决定哪些类别的样品能放上去；weight 是情绪计算时的视觉占比。
export const SLOTS = [
  { id: 'floor', label: '地板', noun: '地板', accepts: ['wood', 'stone'], use: 'floor', weight: 0.28 },
  { id: 'feature', label: '左墙', noun: '左侧墙面', accepts: ['stone', 'paint'], use: 'wall', weight: 0.12 },
  { id: 'walls', label: '墙面', noun: '墙面', accepts: ['stone', 'paint'], use: 'wall', weight: 0.24 },
  { id: 'slats', label: '木格栅', noun: '木格栅', accepts: ['wood', 'paint'], use: 'slats', weight: 0.05 },
  { id: 'upholstery', label: '座椅面料', noun: '沙发座椅', accepts: ['fabric'], use: 'fabric', weight: 0.09 },
  { id: 'accents', label: '靠垫', noun: '靠垫', accepts: ['fabric'], use: 'fabric', weight: 0.03 },
  { id: 'bedding', label: '床品', noun: '床品', accepts: ['fabric'], use: 'fabric', weight: 0.06 },
  { id: 'rugs', label: '地毯', noun: '地毯', accepts: ['fabric'], use: 'rug', weight: 0.06 },
  { id: 'woodwork', label: '木作', noun: '木家具', accepts: ['wood'], use: 'furniture', weight: 0.07 },
];
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map(s => [s.id, s]));

/** 三个情绪预设：每个表面直接指定材质，外加时刻。 */
export function makePresets() {
  return [
    {
      id: 'cozy', label: '温馨', sub: '黄昏金光', t: 18.4,
      slots: {
        floor: 'honey-oak', feature: 'sand-limewash', walls: 'sand-limewash', slats: 'walnut',
        upholstery: 'boucle', accents: 'rust-wool', bedding: 'linen', rugs: 'oat-knit', woodwork: 'walnut',
      },
    },
    {
      id: 'bright', label: '明亮', sub: '正午阳光', t: 12.8,
      slots: {
        floor: 'white-oak', feature: 'concrete', walls: 'chalk-white', slats: 'walnut',
        upholstery: 'linen', accents: 'navy-velvet', bedding: 'navy-velvet', rugs: 'heather-wool', woodwork: 'white-oak',
      },
    },
    {
      id: 'moody', label: '沉郁', sub: '入夜之后', t: 22.2,
      slots: {
        floor: 'smoked-oak', feature: 'ink-blue', walls: 'ink-blue', slats: 'walnut',
        upholstery: 'cognac-leather', accents: 'ochre-velvet', bedding: 'navy-velvet', rugs: 'charcoal-felt', woodwork: 'smoked-oak',
      },
    },
  ];
}

// 默认家具布局：type 对应 FURNITURE 的键，rot 为 90° 的倍数（0..3）。
export const DEFAULT_PIECES = [
  // 客厅：L 形沙发背靠左墙、贵妃位朝后；圆茶几、扶手椅、坐墩围在地毯上
  { type: 'rug', x: -3.0, z: -1.75, rot: 0 },
  { type: 'sofa', x: -4.14, z: -1.7, rot: 1 },
  { type: 'coffee', x: -2.75, z: -1.6, rot: 0 },
  { type: 'armchair', x: -1.55, z: -1.7, rot: 3 },
  { type: 'pouf', x: -3.0, z: -0.3, rot: 0 },
  { type: 'sidelamp', x: -4.6, z: -0.15, rot: 0 },
  { type: 'arclamp', x: -4.72, z: -3.28, rot: 0 },
  { type: 'sideboard', x: -3.0, z: -3.27, rot: 0 },
  { type: 'plant', x: -1.0, z: -3.15, rot: 0 },
  { type: 'plant2', x: 0.45, z: -3.2, rot: 0 },
  { type: 'plant', x: 0.45, z: -0.45, rot: 0 },
  // 餐区：靠左墙窗边，长边沿 x，前后各两把椅子
  { type: 'dining', x: -3.6, z: 1.3, rot: 0 },
  { type: 'chair', x: -4.0, z: 0.6, rot: 0 },
  { type: 'chair', x: -3.2, z: 0.6, rot: 0 },
  { type: 'chair', x: -4.0, z: 2.0, rot: 2 },
  { type: 'chair', x: -3.2, z: 2.0, rot: 2 },
  { type: 'plant2', x: -4.7, z: 3.2, rot: 0 },
  // 入口旁：书架贴着矮墙尽头，面朝客厅
  { type: 'bookshelf', x: 0.65, z: 2.1, rot: 3 },
  { type: 'plant2', x: 0.45, z: 3.15, rot: 0 },
  // 卧室：床头靠后墙，两侧床头柜，床尾凳，衣柜贴着隔断
  { type: 'rug', x: 2.95, z: -1.75, rot: 0 },
  { type: 'bed', x: 2.95, z: -2.425, rot: 0 },
  { type: 'nightstand', x: 1.75, z: -3.29, rot: 0 },
  { type: 'nightstand', x: 4.15, z: -3.29, rot: 0 },
  { type: 'bench', x: 2.95, z: -1.1, rot: 0 },
  { type: 'wardrobe', x: 1.26, z: -1.2, rot: 1 },
  { type: 'plant', x: 4.65, z: -0.6, rot: 0 },
  // 书房：书桌背靠半高墙，椅子在前
  { type: 'desk', x: 2.2, z: 0.66, rot: 0 },
  { type: 'deskchair', x: 2.2, z: 1.4, rot: 2 },
  { type: 'plant', x: 3.75, z: 0.6, rot: 0 },
  { type: 'side', x: 4.65, z: 3.1, rot: 0 },
];

/**
 * 撤销 / 重做栈：存整份状态快照（数据量很小，直接 JSON 深拷贝最简单可靠）。
 */
export class History {
  constructor(limit = 80) { this.past = []; this.future = []; this.limit = limit; }
  /** 记录一次变更前的状态。 */
  push(snap) {
    this.past.push(JSON.stringify(snap));
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }
  /** 撤销：返回要恢复的状态，同时把当前状态压入 future。 */
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(current));
    return JSON.parse(this.past.pop());
  }
  /** 重做：与 undo 对称。 */
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(current));
    return JSON.parse(this.future.pop());
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

/** 把状态编码进 URL hash（base64url JSON），用于分享链接。 */
export function encodeState(s) {
  const compact = {
    s: SLOTS.map(sl => s.slots[sl.id]),
    p: s.pieces.map(p => [p.type, Math.round(p.x * 100), Math.round(p.z * 100), p.rot]),
    t: Math.round(s.t * 100),
  };
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 解析分享链接；格式不对时返回 null，由调用方回退到默认状态。 */
export function decodeState(str) {
  try {
    const b = str.replace(/-/g, '+').replace(/_/g, '/');
    const c = JSON.parse(decodeURIComponent(escape(atob(b))));
    const slots = {};
    SLOTS.forEach((sl, i) => { if (MATERIALS.some(m => m.id === c.s[i])) slots[sl.id] = c.s[i]; });
    const pieces = c.p.map(([type, x, z, rot]) => ({ type, x: x / 100, z: z / 100, rot: rot & 3 }));
    return { slots, pieces, t: c.t / 100 };
  } catch {
    return null;
  }
}
