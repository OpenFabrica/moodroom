// 材质库：木、石、布、漆四类样品的定义，以及运行时在 <canvas> 上程序化绘制的贴图（无外部资源）。
// 几何体 UV 以“米”为单位（见 uv.js），所以每张贴图代表一块已知真实尺寸的方块，texture.repeat = 1 / 尺寸(米)。
import * as THREE from 'three';

export const CATEGORIES = ['wood', 'stone', 'fabric', 'paint'];

// 每类贴图一块代表的真实尺寸（米）
const TILE = { wood: 1.2, stone: 1.2, fabric: 0.25, paint: 2.0 };
// 每类贴图分辨率（像素）
const RES = { wood: 1024, stone: 1024, fabric: 512, paint: 512 };
// 法线贴图的浮雕深度（米）：高度图 0..1 对应这个真实深度，用于按像素尺寸算出斜率
const RELIEF = { wood: 0.0009, stone: 0.0016, fabric: 0.0012, paint: 0.0004 };

// ---------------------------------------------------------------------------
// 材质目录
// L：感知明度 0..1；warm：色温 -1 冷蓝 .. +1 暖橙；soft：触感柔软/纹理深度 0..1
// 其余字段是绘制参数。
// ---------------------------------------------------------------------------
export const MATERIALS = [
  // —— 木 ——（plank 板宽米；rings 每块板横向年轮数；figure 年轮扭曲；contrast 年轮对比；pore 导管纹；knots 每块贴图节疤数）
  { id: 'honey-oak', cat: 'wood', name: '蜂蜜橡木', L: 0.6, warm: 0.75, soft: 0.32,
    base: '#d9a866', grain: '#a06a32', alt: '#e2b675', altAmt: 0.55, plank: 0.2, rings: 7, figure: 3.0,
    contrast: 0.55, pore: 0.3, toneVar: 0.12, knots: 2, rough: 0.6 },
  { id: 'white-oak', cat: 'wood', name: '白橡木', L: 0.82, warm: 0.3, soft: 0.3,
    base: '#e6d5b6', grain: '#c4a77f', alt: '#ecdec4', altAmt: 0.5, plank: 0.19, rings: 6, figure: 2.4,
    contrast: 0.45, pore: 0.2, toneVar: 0.08, knots: 1, rough: 0.68 },
  { id: 'walnut', cat: 'wood', name: '胡桃木', L: 0.36, warm: 0.6, soft: 0.3,
    base: '#8a5a3a', grain: '#4d2e1b', alt: '#9a6845', altAmt: 0.7, plank: 0.17, rings: 6, figure: 3.6,
    contrast: 0.6, pore: 0.3, toneVar: 0.16, knots: 1, rough: 0.58 },
  { id: 'smoked-oak', cat: 'wood', name: '烟熏橡木', L: 0.26, warm: 0.25, soft: 0.32,
    base: '#5f4835', grain: '#33251a', alt: '#6a5240', altAmt: 0.6, plank: 0.22, rings: 7, figure: 3.0,
    contrast: 0.6, pore: 0.4, toneVar: 0.14, knots: 3, rough: 0.64 },
  { id: 'black-ash', cat: 'wood', name: '黑梣木', L: 0.1, warm: 0.0, soft: 0.28,
    base: '#34302c', grain: '#181614', alt: '#2b2825', altAmt: 0.5, plank: 0.2, rings: 6, figure: 2.6,
    contrast: 0.65, pore: 0.5, toneVar: 0.1, knots: 0, rough: 0.55 },

  // —— 石 ——（pattern 绘制算法；floor/wall 铺贴布局：w/h 砖尺寸米、grout 缝宽米、bond 错缝比例；null 表示整板无缝）
  { id: 'concrete', cat: 'stone', name: '清水混凝土', L: 0.58, warm: -0.25, soft: 0.25,
    pattern: 'concrete', base: '#a7a59f', groutColor: '#7d7b77', tileVar: 0.04, edgeDark: 0.15,
    floor: { w: 1.2, h: 1.2, grout: 0.004, bond: 0 }, wall: null, rough: 0.86 },
  { id: 'terrazzo', cat: 'stone', name: '彩点水磨石', L: 0.84, warm: 0.15, soft: 0.2,
    pattern: 'terrazzo', base: '#e8e3da', groutColor: '#d2ccc2', tileVar: 0.02, edgeDark: 0.08,
    chips: ['#bdb6ac', '#8b8681', '#d9b8a0', '#6e7471', '#c88c6c', '#f6f3ee', '#a9b2ad'],
    floor: { w: 0.6, h: 0.6, grout: 0.002, bond: 0 }, wall: { w: 1.2, h: 0.6, grout: 0.002, bond: 0 }, rough: 0.36 },
  { id: 'travertine', cat: 'stone', name: '罗马洞石', L: 0.74, warm: 0.5, soft: 0.3,
    pattern: 'travertine', base: '#dcc9aa', c2: '#c2a780', groutColor: '#d6c8b2', tileVar: 0.06, edgeDark: 0.1,
    floor: { w: 0.6, h: 0.3, grout: 0.003, bond: 0.5 }, wall: { w: 1.2, h: 0.6, grout: 0.002, bond: 0.5 }, rough: 0.6 },
  { id: 'marble', cat: 'stone', name: '雪白大理石', L: 0.92, warm: -0.15, soft: 0.1,
    pattern: 'marble', base: '#f0eeea', vein: '#7f7d7b', c2: '#b8ada0', groutColor: '#dcdad5', tileVar: 0.015, edgeDark: 0.05,
    floor: { w: 0.6, h: 0.6, grout: 0.0015, bond: 0 }, wall: null, rough: 0.22 },
  { id: 'slate', cat: 'stone', name: '暴雨板岩', L: 0.18, warm: -0.5, soft: 0.38,
    pattern: 'slate', base: '#454b51', c2: '#5c5446', groutColor: '#2c2f32', tileVar: 0.12, edgeDark: 0.2,
    floor: { w: 0.4, h: 0.4, grout: 0.004, bond: 0 }, wall: { w: 0.6, h: 0.2, grout: 0.003, bond: 0.5 }, rough: 0.72 },
  { id: 'terracotta', cat: 'stone', name: '日晒陶砖', L: 0.42, warm: 0.9, soft: 0.36,
    pattern: 'terracotta', base: '#bb6a40', c2: '#a24f32', c3: '#c98454', groutColor: '#cbbfae', tileVar: 0.1, edgeDark: 0.25,
    wobble: 0.002, floor: { w: 0.3, h: 0.3, grout: 0.007, bond: 0 }, wall: { w: 0.2, h: 0.1, grout: 0.004, bond: 0.5 }, rough: 0.8 },

  // —— 布 ——（weave 织法；n 每块贴图(0.25m)的线数/圈数；c2 第二色）
  { id: 'linen', cat: 'fabric', name: '亚麻', L: 0.76, warm: 0.3, soft: 0.6,
    weave: 'plain', n: 84, base: '#d9cdb7', c2: '#c9bba2', rough: 0.92 },
  { id: 'boucle', cat: 'fabric', name: '圈圈绒', L: 0.88, warm: 0.2, soft: 0.95,
    weave: 'boucle', n: 60, base: '#ede7dc', c2: '#cfc4b2', rough: 0.98 },
  { id: 'heather-wool', cat: 'fabric', name: '灰羊毛', L: 0.5, warm: -0.2, soft: 0.75,
    weave: 'twill', n: 96, base: '#9a9b9b', c2: '#6c6e70', rough: 0.95 },
  { id: 'oat-knit', cat: 'fabric', name: '燕麦针织', L: 0.68, warm: 0.45, soft: 0.9,
    weave: 'knit', n: 16, base: '#cdb998', c2: '#b39e7d', rough: 0.96 },
  { id: 'navy-velvet', cat: 'fabric', name: '藏青丝绒', L: 0.14, warm: -0.7, soft: 0.8,
    weave: 'velvet', n: 0, base: '#29365a', c2: '#43537e', rough: 0.72 },
  { id: 'ochre-velvet', cat: 'fabric', name: '赭黄丝绒', L: 0.58, warm: 0.85, soft: 0.8,
    weave: 'velvet', n: 0, base: '#cf9d38', c2: '#e6bd5c', rough: 0.72 },
  { id: 'rust-wool', cat: 'fabric', name: '铁锈羊毛', L: 0.42, warm: 0.9, soft: 0.85,
    weave: 'basket', n: 64, base: '#cc6a3e', c2: '#ad522c', rough: 0.93 },
  { id: 'cognac-leather', cat: 'fabric', name: '干邑皮革', L: 0.33, warm: 0.8, soft: 0.45,
    weave: 'leather', n: 110, base: '#b06a36', c2: '#7a4220', rough: 0.48 },
  { id: 'charcoal-felt', cat: 'fabric', name: '炭灰毛毡', L: 0.17, warm: -0.15, soft: 0.7,
    weave: 'felt', n: 0, base: '#3c3d40', c2: '#6a6b6e', rough: 0.97 },

  // —— 漆 ——（finish：roller 滚涂乳胶漆 / limewash 石灰涂料；mottle 斑驳幅度；wash 石灰刷痕强度）
  { id: 'chalk-white', cat: 'paint', name: '粉笔白', L: 0.93, warm: 0.15, soft: 0.08,
    finish: 'roller', base: '#efece5', mottle: 0.025, rough: 0.9 },
  { id: 'sand-limewash', cat: 'paint', name: '沙色石灰漆', L: 0.84, warm: 0.5, soft: 0.28,
    finish: 'limewash', base: '#e6d9c2', mottle: 0.025, wash: 0.07, rough: 0.95 },
  { id: 'sage', cat: 'paint', name: '鼠尾草绿', L: 0.78, warm: 0.0, soft: 0.1,
    finish: 'roller', base: '#cbd3bf', mottle: 0.03, rough: 0.9 },
  { id: 'clay', cat: 'paint', name: '陶土色', L: 0.66, warm: 0.85, soft: 0.25,
    finish: 'limewash', base: '#e2a988', mottle: 0.045, wash: 0.18, rough: 0.95 },
  { id: 'ink-blue', cat: 'paint', name: '墨蓝', L: 0.22, warm: -0.6, soft: 0.12,
    finish: 'roller', base: '#435072', mottle: 0.05, rough: 0.88 },
  { id: 'forest', cat: 'paint', name: '深林绿', L: 0.26, warm: -0.15, soft: 0.15,
    finish: 'roller', base: '#4b5c48', mottle: 0.05, rough: 0.9 },
  { id: 'graphite', cat: 'paint', name: '石墨灰', L: 0.28, warm: -0.1, soft: 0.12,
    finish: 'roller', base: '#58595b', mottle: 0.04, rough: 0.88 },
];

export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// 数学 / 噪声工具
// ---------------------------------------------------------------------------

// mulberry32：确定性伪随机数生成器，保证每次生成的贴图完全一样
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 字符串 → 32 位种子（FNV-1a）
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// 整数格点哈希 → [0,1)；不用排列表，任意周期都能用
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 非负取模
const mod = (a, n) => ((a % n) + n) % n;
// 夹到 [0,1]
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// 平滑阶跃（e0 > e1 时自动反向）
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// 可平铺值噪声：u,v 是贴图单位坐标（1 = 一块贴图），fx/fy 是每块贴图的格点数（必须是整数，才能无缝）
function noise(u, v, fx, fy, s) {
  const x = u * fx, y = v * fy;
  const xf = Math.floor(x), yf = Math.floor(y);
  let tx = x - xf, ty = y - yf;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  // 格点坐标按周期取模，让贴图左右/上下边缘的噪声值完全一致
  const x0 = mod(xf, fx), y0 = mod(yf, fy);
  const x1 = x0 + 1 === fx ? 0 : x0 + 1, y1 = y0 + 1 === fy ? 0 : y0 + 1;
  const a = hash2(x0, y0, s), b = hash2(x1, y0, s);
  const c = hash2(x0, y1, s), d = hash2(x1, y1, s);
  return a + (b - a) * tx + (c - a + (a - b - c + d) * tx) * ty;
}

// 分形噪声（fbm）：每个八度频率翻倍、振幅减半，结果在 [0,1]
function fbm(u, v, fx, fy, oct, s) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    sum += amp * noise(u, v, fx, fy, s + o * 101);
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

// Worley 细胞噪声的输出（复用同一个对象，避免逐像素分配）
const W = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
// 可平铺 Worley 噪声：nx×ny 个格子，每格一个特征点；距离以格子为单位
function worley(u, v, nx, ny, s, jitter = 0.9) {
  const x = u * nx, y = v * ny;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 1e9, f2 = 1e9, id = 0, bdx = 0, bdy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      // 哈希用取模后的格子坐标（保证可平铺），位置用未取模坐标（保证距离连续）
      const wx = mod(cx, nx), wy = mod(cy, ny);
      const px = cx + 0.5 + (hash2(wx, wy, s) - 0.5) * jitter;
      const py = cy + 0.5 + (hash2(wx, wy, s + 1) - 0.5) * jitter;
      const dx = x - px, dy = y - py;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f2 = f1; f1 = d; id = wy * nx + wx; bdx = dx; bdy = dy;
      } else if (d < f2) f2 = d;
    }
  }
  W.f1 = Math.sqrt(f1); W.f2 = Math.sqrt(f2); W.id = id; W.dx = bdx; W.dy = bdy;
  return W;
}

// '#rrggbb' → [r,g,b]（0..255 浮点）
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 在输出数组 o 里写入 a、b 两色按 t 的插值再乘以亮度 k
function mixInto(o, a, b, t, k) {
  o[0] = (a[0] + (b[0] - a[0]) * t) * k;
  o[1] = (a[1] + (b[1] - a[1]) * t) * k;
  o[2] = (a[2] + (b[2] - a[2]) * t) * k;
}

// 把输出颜色 o 往颜色 c 方向插值 t
function blendTo(o, c, t) {
  o[0] += (c[0] - o[0]) * t;
  o[1] += (c[1] - o[1]) * t;
  o[2] += (c[2] - o[2]) * t;
}

// 正五边形 16 个旋转角度的法向量表：水磨石碎石用“多边形距离”判断，预先算好避免逐像素 sin/cos
const PENTA = Array.from({ length: 16 }, (_, r) =>
  Array.from({ length: 5 }, (_, k) => {
    const a = (r / 16) * (Math.PI * 2 / 5) + (k * Math.PI * 2) / 5;
    return [Math.cos(a), Math.sin(a)];
  }));

// ---------------------------------------------------------------------------
// 生成器：每个返回一个逐像素函数 (u, v, x, y, out)，out = [r, g, b, height]
// u,v 为贴图单位坐标；mpp 为每像素对应的米数
// ---------------------------------------------------------------------------

// 木地板 / 木饰面：横向长板，带年轮、导管纹、节疤、每块板色差和拼缝
function woodGen(def, layout, mpp) {
  const T = TILE.wood, seed = seedOf(def.id);
  const rnd = mulberry32(seed);
  const planks = layout === 'planks';
  const rows = Math.max(1, Math.round(T / def.plank));
  const rowH = T / rows;
  const base = rgb(def.base), dark = rgb(def.grain), alt = rgb(def.alt);
  const knotCol = dark.map((c) => c * 0.55);

  // 单块板的随机参数
  const plank = () => ({
    tone: 1 + (rnd() - 0.5) * def.toneVar * (planks ? 1 : 0.5),
    mix: rnd(),
    off: rnd() * 64,
    rings: def.rings * (0.7 + rnd() * 0.6),
    warp: 0.6 + rnd() * 0.8,
    ph: rnd(),
  });
  // 每行 1~2 块板：s0 是第一条端缝位置，a 是第一块板长度（贴图单位）；行内总长恰好 1，保证左右无缝
  const rowInfo = [];
  for (let r = 0; r < rows; r++) {
    const two = rnd() < 0.45;
    rowInfo.push({ s0: rnd(), a: two ? 0.38 + rnd() * 0.24 : 1, p: [plank(), plank()] });
  }
  // 节疤只在实木板上出现（饰面板是挑过的木皮，不带疤）
  const knots = [];
  if (planks) {
    for (let k = 0; k < def.knots; k++) {
      knots.push({ r: Math.floor(rnd() * rows), u: rnd(), a: 0.3 + rnd() * 0.4, rk: 0.005 + rnd() * 0.009 });
    }
  }
  const seamW = planks ? Math.max(0.0006, mpp * 0.6) : 0;

  return (u, v, x, y, o) => {
    const rv = v * rows, rf = Math.floor(rv);
    const r = mod(rf, rows), across = rv - rf;
    const ri = rowInfo[r];
    const rel = mod(u - ri.s0, 1);
    const pi = rel >= ri.a ? 1 : 0;
    const p = ri.p[pi];

    // 年轮：横向坐标 × 年轮数，再加沿板长方向缓慢变化的扭曲 → 形成山纹/直纹
    const w = fbm(u, across * 0.5 + p.off, 2, 1, 4, seed + 1);
    let t = across * p.rings + p.ph + (w - 0.5) * def.figure * p.warp;

    // 节疤：把周围的年轮“推开”，中心加深
    let knot = 0;
    for (let k = 0; k < knots.length; k++) {
      const kn = knots[k];
      if (kn.r !== r) continue;
      if ((mod(kn.u - ri.s0, 1) >= ri.a ? 1 : 0) !== pi) continue;
      let du = u - kn.u;
      du -= Math.round(du);
      const d = Math.hypot((du * T) / (kn.rk * 1.8), ((across - kn.a) * rowH) / kn.rk);
      if (d < 10) {
        t += 2.2 * Math.exp(-d * d * 0.08);
        knot = Math.max(knot, 1 - smoothstep(0.6, 1.1, d));
      }
    }

    // 锯齿形年轮：早材浅、晚材逐渐变深然后突变回浅色，比正弦更像真实木纹
    const tf = Math.floor(t), ring = t - tf;
    // 每一圈年轮的深浅随机，避免整齐划一的“卡通木纹”
    const ringK = 0.55 + 0.65 * hash2(tf, r * 2 + pi, seed + 9);
    const late = ring * ring * ring * ringK;
    // 导管纹：沿板长方向拉长的高频噪声，形成细长的条纹
    const pore = smoothstep(0.5, 0.7, fbm(u, v, 6, 360, 2, seed + 2));
    const fiber = fbm(u, v, 3, 700, 1, seed + 4);
    const mott = fbm(u, v, 4, 6, 3, seed + 3);
    const g = clamp01(late * def.contrast + pore * def.pore + (fiber - 0.5) * 0.12);

    mixInto(o, base, dark, g, p.tone * (0.94 + (mott - 0.5) * 0.22));
    blendTo(o, alt, p.mix * def.altAmt * 0.5);
    if (knot > 0) blendTo(o, knotCol, knot * 0.9);
    let h = 0.62 - g * 0.12 - pore * 0.1 - knot * 0.05;

    // 拼缝：长边 + 端头，缝心最暗最低，两侧有微倒角
    if (planks) {
      const dEdge = Math.min(Math.min(across, 1 - across) * rowH, Math.min(rel, Math.abs(rel - ri.a), 1 - rel) * T);
      if (dEdge < seamW * 3) {
        const f = smoothstep(seamW * 0.5, seamW * 3, dEdge);
        const k = 0.6 + 0.4 * f;
        o[0] *= k; o[1] *= k; o[2] *= k;
        h *= f;
      }
    }
    o[3] = h;
  };
}

// 石材各花色：返回 (u, v, th, o) → 写入颜色与高度；th 是当前这块砖的随机数
const STONE = {
  // 清水混凝土：大尺度斑驳 + 细砂 + 气孔
  concrete(def, seed) {
    const base = rgb(def.base);
    return (u, v, th, o) => {
      const m = fbm(u, v, 4, 4, 5, seed);
      const f = fbm(u, v, 48, 48, 2, seed + 3);
      const c = worley(u, v, 150, 150, seed + 5);
      const pore = hash2(c.id, 7, seed) < 0.3 ? 1 - smoothstep(0.08, 0.2, c.f1) : 0;
      const l = 0.95 + (m - 0.5) * 0.4 + (f - 0.5) * 0.14 - pore * 0.3;
      mixInto(o, base, base, 0, l);
      o[3] = 0.6 + (f - 0.5) * 0.3 - pore * 0.5;
    };
  },

  // 水磨石：浅色基底里嵌两层多边形碎石（大颗稀疏、小颗密集）
  terrazzo(def, seed) {
    const base = rgb(def.base);
    const chips = def.chips.map(rgb);
    const layers = [{ n: 16, rMin: 0.18, rMax: 0.36, p: 0.8 }, { n: 48, rMin: 0.14, rMax: 0.32, p: 0.75 }];
    return (u, v, th, o) => {
      const m = fbm(u, v, 8, 8, 3, seed);
      mixInto(o, base, base, 0, 0.97 + (m - 0.5) * 0.1);
      let h = 0.6;
      let hit = false;
      for (let L = 0; L < layers.length && !hit; L++) {
        const ly = layers[L], n = ly.n, s = seed + 10 + L * 17;
        const x = u * n, y = v * n;
        const xi = Math.floor(x), yi = Math.floor(y);
        // 碎石可能跨出自己的格子，所以要检查 3×3 邻格
        for (let j = -1; j <= 1 && !hit; j++) {
          for (let i = -1; i <= 1 && !hit; i++) {
            const cx = xi + i, cy = yi + j;
            const wx = mod(cx, n), wy = mod(cy, n);
            if (hash2(wx, wy, s + 2) > ly.p) continue;
            const dx = x - (cx + 0.5 + (hash2(wx, wy, s) - 0.5) * 0.7);
            const dy = y - (cy + 0.5 + (hash2(wx, wy, s + 1) - 0.5) * 0.7);
            const r = ly.rMin + (ly.rMax - ly.rMin) * hash2(wx, wy, s + 3);
            if (dx * dx + dy * dy > r * r * 2.2) continue;
            // 多边形距离：到五个方向的最大投影；再乘各向异性系数，让碎石更不规则
            const dirs = PENTA[Math.floor(hash2(wx, wy, s + 4) * 16)];
            const an = 0.7 + hash2(wx, wy, s + 5) * 0.6;
            let dp = 0;
            for (let k = 0; k < 5; k++) {
              const pr = dx * dirs[k][0] * an + dy * dirs[k][1] / an;
              if (pr > dp) dp = pr;
            }
            if (dp < r) {
              const ci = chips[Math.floor(hash2(wx, wy, s + 6) * chips.length)];
              const shade = 0.92 + (hash2(wx, wy, s + 7) - 0.5) * 0.12 + (m - 0.5) * 0.2;
              mixInto(o, ci, ci, 0, shade);
              h = 0.58;
              hit = true;
            }
          }
        }
      }
      // 细小深色砂点
      const c = worley(u, v, 260, 260, seed + 40);
      if (!hit && hash2(c.id, 3, seed) < 0.35 && c.f1 < 0.16) {
        const k = 0.8;
        o[0] *= k; o[1] *= k; o[2] *= k;
      }
      o[3] = h;
    };
  },

  // 洞石：水平层理 + 拉长的孔洞
  travertine(def, seed) {
    const base = rgb(def.base), c2 = rgb(def.c2);
    return (u, v, th, o) => {
      const w = fbm(u, v, 3, 3, 3, seed);
      const band = fbm(u + (w - 0.5) * 0.2, v + (w - 0.5) * 0.06, 2, 24, 4, seed + 1);
      const fine = fbm(u, v, 64, 64, 2, seed + 2);
      mixInto(o, base, c2, smoothstep(0.35, 0.75, band), 0.97 + (fine - 0.5) * 0.1);
      // 孔洞：横向长、纵向短的细胞噪声
      const c = worley(u, v, 40, 160, seed + 3);
      const pr = hash2(c.id, 1, seed);
      const pit = pr < 0.16 ? 1 - smoothstep(0.1 + pr * 0.8, 0.25 + pr * 0.8, c.f1) : 0;
      if (pit > 0) blendTo(o, c2.map((x) => x * 0.72), pit * 0.7);
      o[3] = 0.6 + (band - 0.5) * 0.15 - pit * 0.55;
    };
  },

  // 白大理石：沿对角方向的正弦条带被湍流扭曲，取过零点附近做纹路（主纹 + 断续细纹 + 云雾灰）
  marble(def, seed) {
    const base = rgb(def.base), vein = rgb(def.vein), c2 = rgb(def.c2);
    return (u, v, th, o) => {
      const w1 = fbm(u, v, 2, 2, 4, seed), w2 = fbm(u, v, 8, 8, 4, seed + 1);
      // (u+v) 的系数是整数，所以 sin 在贴图边界处仍然连续
      const t = (u + v) * 3 + (w1 - 0.5) * 1.5 + (w2 - 0.5) * 0.45;
      const s1 = Math.abs(Math.sin(Math.PI * t));
      // 纹路粗细随位置变化：有的地方是清晰细线，有的地方晕开成灰带
      const wid = 0.015 + 0.05 * fbm(u, v, 4, 4, 2, seed + 5);
      const v1 = 1 - smoothstep(0.0, wid, s1);
      const halo = 1 - smoothstep(0.0, 0.3, s1);
      const t2 = (u - v) * 3 + (fbm(u, v, 3, 3, 4, seed + 2) - 0.5) * 3;
      const s2 = Math.abs(Math.sin(Math.PI * t2));
      const mask = smoothstep(0.45, 0.62, fbm(u, v, 3, 3, 3, seed + 3));
      const v2 = (1 - smoothstep(0.0, 0.025, s2)) * mask;
      const cloud = fbm(u, v, 3, 3, 5, seed + 4);
      mixInto(o, base, c2, smoothstep(0.5, 0.8, cloud) * 0.3, 0.99 + (cloud - 0.5) * 0.07);
      blendTo(o, vein, Math.min(1, halo * 0.16 + v1 * 0.55 * (0.5 + w2) + v2 * 0.35));
      o[3] = 0.5;
    };
  },

  // 板岩：拉长的层状噪声 + 台阶化，模拟劈裂面；局部带锈黄/橄榄色
  slate(def, seed) {
    const base = rgb(def.base), c2 = rgb(def.c2);
    return (u, v, th, o) => {
      const f = fbm(u, v, 4, 14, 5, seed);
      const q = Math.floor(f * 7) / 7;
      const layered = f * 0.4 + q * 0.6;
      const fine = fbm(u, v, 96, 96, 2, seed + 5);
      const tint = smoothstep(0.55, 0.8, fbm(u, v, 3, 3, 3, seed + 9)) * (0.25 + th * 0.35);
      mixInto(o, base, c2, tint, 0.68 + layered * 0.62 + (fine - 0.5) * 0.16);
      o[3] = layered * 0.8 + fine * 0.2;
    };
  },

  // 陶土砖：每块砖颜色差异明显（橙 → 红 → 浅褐），表面有斑驳和砂点
  terracotta(def, seed) {
    const base = rgb(def.base), c2 = rgb(def.c2), c3 = rgb(def.c3);
    return (u, v, th, o) => {
      const m = fbm(u, v, 10, 10, 4, seed);
      // th 决定这块砖偏红还是偏浅
      if (th < 0.5) mixInto(o, base, c2, (0.5 - th) * 1.6, 1);
      else mixInto(o, base, c3, (th - 0.5) * 1.6, 1);
      const k = 0.92 + (m - 0.5) * 0.35;
      o[0] *= k; o[1] *= k; o[2] *= k;
      const c = worley(u, v, 220, 220, seed + 2);
      const sp = hash2(c.id, 5, seed);
      if (c.f1 < 0.15 && sp < 0.25) {
        const s = sp < 0.12 ? 0.75 : 1.12;
        o[0] *= s; o[1] *= s; o[2] *= s;
      }
      o[3] = 0.6 + (m - 0.5) * 0.25;
    };
  },
};

// 石材通用：按铺贴布局切砖、加砖缝/倒角/每块砖色差，砖内花纹交给 STONE[pattern]
function stoneGen(def, layout, mpp) {
  const T = TILE.stone, seed = seedOf(def.id);
  const pat = STONE[def.pattern](def, seed);
  const lay = layout === 'floor' ? def.floor : layout === 'wall' ? def.wall : null;
  const grout = rgb(def.groutColor);
  if (!lay) {
    return (u, v, x, y, o) => pat(u, v, 0.5, o);
  }
  const cols = Math.max(1, Math.round(T / lay.w)), rows = Math.max(1, Math.round(T / lay.h));
  const gHalf = Math.max(lay.grout / 2, mpp * 0.6);
  const bevel = 0.0025;
  return (u, v, x, y, o) => {
    const rv = v * rows, rf = Math.floor(rv);
    const r = mod(rf, rows), ly = rv - rf;
    // 错缝：每行水平偏移 r*bond 块砖
    const cu = u * cols + r * lay.bond, cf = Math.floor(cu);
    const c = mod(cf, cols), lx = cu - cf;
    let e = Math.min(Math.min(lx, 1 - lx) * lay.w, Math.min(ly, 1 - ly) * lay.h);
    // 手工砖边缘不直：用噪声扰动到边距离
    if (def.wobble) e += (noise(u, v, 40, 40, seed + 77) - 0.5) * def.wobble;
    const th = hash2(c, r, seed);
    // 每块砖用不同偏移采样花纹，避免相邻砖花纹连在一起
    pat(u + hash2(c, r, seed + 1) * 0.73, v + hash2(c, r, seed + 2) * 0.73, th, o);
    const tone = 1 + (hash2(c, r, seed + 3) - 0.5) * def.tileVar * 2;
    o[0] *= tone; o[1] *= tone; o[2] *= tone;
    if (e < gHalf) {
      const g = 0.92 + (noise(u, v, 300, 300, seed + 9) - 0.5) * 0.16;
      mixInto(o, grout, grout, 0, g);
      o[3] = 0.05;
    } else if (e < gHalf + bevel) {
      const f = smoothstep(gHalf, gHalf + bevel, e);
      const k = 1 - def.edgeDark * (1 - f);
      o[0] *= k; o[1] *= k; o[2] *= k;
      o[3] *= 0.3 + 0.7 * f;
    }
  };
}

// 织物：平纹/斜纹/方平纹/圈圈纱/针织/丝绒/皮革/毛毡
function fabricGen(def, layout, mpp) {
  const seed = seedOf(def.id);
  const base = rgb(def.base), c2 = rgb(def.c2);
  const N = def.n;

  // 经纬交织类：top(i,j) 决定格子 (i,j) 是经线在上还是纬线在上
  const woven = (top, slubAmt, fuzzAmt, profPow) => (u, v, x, y, o) => {
    const fx = u * N, fy = v * N;
    const i = Math.floor(fx), j = Math.floor(fy);
    const lx = fx - i, ly = fy - j;
    const warpTop = top(mod(i, N), mod(j, N));
    // 竹节：每根线沿自身方向粗细/明暗不均（亚麻的典型特征）
    const sA = noise((i + 0.5) / N, v, N, 10, seed + 1);
    const sB = noise(u, (j + 0.5) / N, 10, N, seed + 2);
    const wA = 0.78 + (sA - 0.5) * slubAmt, wB = 0.78 + (sB - 0.5) * slubAmt;
    const pA = 1 - ((lx - 0.5) / (0.5 * wA)) ** 2, pB = 1 - ((ly - 0.5) / (0.5 * wB)) ** 2;
    const hA0 = pA > 0 ? pA ** profPow : 0, hB0 = pB > 0 ? pB ** profPow : 0;
    // 在上面的线在格子中间隆起，到格子两端往下压
    const hA = hA0 * (warpTop ? 0.7 + 0.3 * Math.sin(Math.PI * ly) : 0.45);
    const hB = hB0 * (warpTop ? 0.45 : 0.7 + 0.3 * Math.sin(Math.PI * lx));
    const fuzz = fbm(u, v, N * 2, N * 2, 2, seed + 3);
    let h;
    if (hA >= hB) {
      h = hA;
      mixInto(o, base, c2, clamp01(0.5 - sA + (fuzz - 0.5) * fuzzAmt), 1);
    } else {
      h = hB;
      mixInto(o, base, c2, clamp01(0.35 + (sB - 0.5) * 0.8 + (fuzz - 0.5) * fuzzAmt), 1);
    }
    // 缝隙里烘焙一点环境光遮蔽，让织纹在没有强光时也看得出来
    const k = 0.62 + 0.38 * h + (fuzz - 0.5) * 0.1;
    o[0] *= k; o[1] *= k; o[2] *= k;
    o[3] = h * 0.85 + fuzz * 0.15;
  };

  switch (def.weave) {
    case 'plain':
      return woven((i, j) => ((i + j) & 1) === 0, 0.55, 0.6, 0.5);
    case 'twill':
      return woven((i, j) => mod(i + j, 4) < 2, 0.2, 1.4, 0.6);
    case 'basket':
      return woven((i, j) => (((i >> 1) + (j >> 1)) & 1) === 0, 0.25, 0.8, 0.35);

    case 'boucle': {
      return (u, v, x, y, o) => {
        // 两层错开的小圈：甜甜圈形状的高度 + 圈心略低
        let h = 0, tint = 0;
        for (let L = 0; L < 3; L++) {
          const c = worley(u, v, N + L * 26, N + L * 26, seed + L * 9, 1);
          const ringH = 1 - smoothstep(0.0, 0.11, Math.abs(c.f1 - 0.28));
          const dome = 1 - smoothstep(0.1, 0.55, c.f1);
          const b = Math.max(ringH, dome * 0.55) * (1 - L * 0.12);
          if (b > h) { h = b; tint = hash2(c.id, L, seed); }
        }
        const fuzz = fbm(u, v, 160, 160, 2, seed + 5);
        mixInto(o, base, c2, tint < 0.1 ? 0.7 : tint * 0.3, 0.74 + 0.26 * h + (fuzz - 0.5) * 0.1);
        o[3] = h * 0.85 + fuzz * 0.15;
      };
    }

    case 'knit': {
      // 粗针织平针：每个针目是两条斜向的椭圆“腿”组成的 V 字
      const C = N, R = Math.round(N * 1.35);
      const cw = 1 / C, rh = 1 / R;
      const ax = 0.36 * cw, ay = rh;
      const len = Math.hypot(ax, ay);
      const A = 0.62 * len, B = 0.24 * cw;
      return (u, v, x, y, o) => {
        const fx = u * C, fy = v * R;
        const ci = Math.floor(fx), ri = Math.floor(fy);
        const lx = (fx - ci) * cw, lyc = (fy - ri) * rh;
        let h = 0;
        // 腿会伸进上下相邻行，所以要检查 k = -1, 0, 1
        for (let k = -1; k <= 1; k++) {
          const cy = (0.5 + k) * rh;
          for (let side = -1; side <= 1; side += 2) {
            const cx = (0.5 + side * 0.2) * cw;
            const dx = (-side * ax) / len, dy = ay / len;
            const ex = lx - cx, ey = lyc - cy;
            const al = ex * dx + ey * dy, pe = -ex * dy + ey * dx;
            const e = (al / A) ** 2 + (pe / B) ** 2;
            if (e < 1) {
              // 纱线捻向形成的斜纹
              const tw = 0.86 + 0.14 * Math.cos((al / A) * Math.PI * 3.5 + (pe / B) * 2.2 * side);
              const b = Math.sqrt(1 - e) * tw;
              if (b > h) h = b;
            }
          }
        }
        const heather = fbm(u, v, 128, 128, 2, seed + 4);
        mixInto(o, base, c2, smoothstep(0.4, 0.7, heather), 0.5 + 0.5 * h);
        o[3] = h;
      };
    }

    case 'velvet': {
      // 丝绒：大块“压痕”明暗 + 极细绒毛噪声；c2 是受光一侧的亮色
      return (u, v, x, y, o) => {
        const crush = fbm(u, v, 3, 3, 4, seed);
        const crush2 = fbm(u, v, 7, 5, 3, seed + 1);
        const pile = fbm(u, v, 200, 200, 2, seed + 2);
        const t = smoothstep(0.38, 0.75, crush * 0.7 + crush2 * 0.3);
        mixInto(o, base, c2, t * 0.55, 0.9 + (pile - 0.5) * 0.12);
        o[3] = 0.5 + (pile - 0.5) * 0.3;
      };
    }

    case 'leather': {
      // 荔枝纹皮革：细胞噪声 F2-F1 做褶皱网格，加深浅不一的油蜡斑
      return (u, v, x, y, o) => {
        const c = worley(u, v, N, N, seed, 1);
        const crease = smoothstep(0.02, 0.16, c.f2 - c.f1);
        const pebble = 1 - c.f1 * 0.5;
        const mott = fbm(u, v, 4, 4, 5, seed + 1);
        const fine = fbm(u, v, 160, 160, 2, seed + 2);
        mixInto(o, c2, base, clamp01(0.62 + (mott - 0.5) * 1.1), 0.7 + 0.3 * crease + (pebble - 0.75) * 0.3 + (fine - 0.5) * 0.08);
        o[3] = crease * 0.7 + pebble * 0.3;
      };
    }

    case 'felt':
    default: {
      // 毛毡：致密纤维噪声 + 稀疏浅色纤维点
      return (u, v, x, y, o) => {
        const f = fbm(u, v, 40, 40, 4, seed);
        const g = fbm(u, v, 180, 180, 2, seed + 1);
        const sp = hash2(x, y, seed + 2);
        mixInto(o, base, c2, sp < 0.03 ? 0.5 : 0, 0.88 + (f - 0.5) * 0.3 + (g - 0.5) * 0.14);
        o[3] = f * 0.6 + g * 0.4;
      };
    }
  }
}

// 墙漆：低频斑驳 + 滚筒颗粒；石灰涂料再叠加两组交叉的对角刷痕和云雾
function paintGen(def, layout, mpp) {
  const seed = seedOf(def.id);
  const base = rgb(def.base);
  const white = [255, 255, 255];
  const wash = def.finish === 'limewash' ? def.wash : 0;
  return (u, v, x, y, o) => {
    const m = fbm(u, v, 3, 3, 4, seed);
    const st = fbm(u, v, 96, 96, 2, seed + 1);
    const px = hash2(x, y, seed + 2);
    let l = 1 + (m - 0.5) * def.mottle * 2 + (st - 0.5) * 0.025 + (px - 0.5) * 0.012;
    let lw = 0;
    if (wash) {
      // 刷痕沿对角方向 (u+v)、(u-v) 采样：整数频率下仍然可平铺
      const s1 = fbm(u + v, u - v, 6, 14, 3, seed + 3);
      const s2 = fbm(u - v, u + v, 6, 14, 3, seed + 4);
      const wq = fbm(u, v, 3, 3, 4, seed + 6);
      const cloud = fbm(u + (wq - 0.5) * 0.6, v + (wq - 0.5) * 0.6, 4, 4, 5, seed + 5);
      lw = (cloud - 0.5) * 1.5 + (s1 - 0.5) * 0.35 + (s2 - 0.5) * 0.25;
      l += lw * wash;
    }
    mixInto(o, base, base, 0, l);
    // 石灰涂料亮处发白（粉化），比单纯提亮更像真实质感
    if (lw > 0) blendTo(o, white, lw * wash * 0.6);
    o[3] = 0.5 + (st - 0.5) * 0.6 + (px - 0.5) * 0.2 + lw * 0.3;
  };
}

const GENERATORS = { wood: woodGen, stone: stoneGen, fabric: fabricGen, paint: paintGen };

// ---------------------------------------------------------------------------
// 渲染到 canvas
// ---------------------------------------------------------------------------

// 新建 canvas
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// 逐像素跑生成器，画出颜色 canvas；需要时同时画法线 canvas
// view.o / view.span：渲染贴图中 [o, o+span] 这一段（色板缩略图只取局部放大看）
function render(def, layout, size, view, withNormal) {
  const T = TILE[def.cat];
  const mpp = (T * view.span) / size;
  const gen = GENERATORS[def.cat](def, layout, mpp);
  const color = makeCanvas(size);
  const ctx = color.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = img.data;
  const hgt = withNormal ? new Float32Array(size * size) : null;
  const out = [0, 0, 0, 0];
  const step = view.span / size;
  for (let y = 0; y < size; y++) {
    const v = view.o + (y + 0.5) * step;
    for (let x = 0; x < size; x++) {
      gen(view.o + (x + 0.5) * step, v, x, y, out);
      const i = (y * size + x) * 4;
      px[i] = out[0]; px[i + 1] = out[1]; px[i + 2] = out[2]; px[i + 3] = 255;
      if (hgt) hgt[y * size + x] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  const normal = hgt ? normalCanvas(hgt, size, (def.relief ?? RELIEF[def.cat]) / (2 * mpp)) : null;
  return { color, normal };
}

// 从高度图算切线空间法线贴图（OpenGL 约定，绿色 = +v）；邻点取样绕回，保证平铺无缝
function normalCanvas(h, size, k) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size, yd = ((y + 1) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      // canvas 的 y 向下，而贴图 flipY 后 v 向上，所以 ny 用“下减上”
      const nx = (h[yr + xl] - h[yr + xr]) * k;
      const ny = (h[yd + x] - h[yu + x]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (yr + x) * 4;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// 缓存与对外接口
// ---------------------------------------------------------------------------

const canvasCache = new Map(); // `${id}|${layout}` → { color, normal }
const texCache = new Map(); // `${id}|${layout}|${tile}` → { map, normalMap }
const swatchCache = new Map(); // `${id}|${px}` → dataURL

// 用途 → 绘制布局：木在地面/墙面是实木长板，家具/格栅用无缝饰面；石材地面/墙面铺贴不同，其它用整板
function layoutFor(def, use) {
  switch (def.cat) {
    case 'wood': return use === 'floor' || use === 'wall' ? 'planks' : 'veneer';
    case 'stone': return use === 'floor' ? 'floor' : use === 'wall' ? 'wall' : 'slab';
    case 'fabric': return 'weave';
    default: return 'paint';
  }
}

// 用途 → 贴图代表的真实尺寸（米）；地毯用放大一倍的织纹
function tileFor(def, use) {
  return def.cat === 'fabric' && use === 'rug' ? 0.5 : TILE[def.cat];
}

// 把 canvas 包成可平铺的 three 贴图
function makeTexture(canvas, tile, isColor) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tile, 1 / tile);
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

// 取（必要时首次生成）某材质在某用途下的贴图；同一 canvas 在不同 tile 尺寸间共享
function getTextures(def, use) {
  const layout = layoutFor(def, use);
  const tile = tileFor(def, use);
  const tkey = `${def.id}|${layout}|${tile}`;
  let tex = texCache.get(tkey);
  if (tex) return tex;
  const ckey = `${def.id}|${layout}`;
  let cv = canvasCache.get(ckey);
  if (!cv) {
    cv = render(def, layout, RES[def.cat], { o: 0, span: 1 }, true);
    canvasCache.set(ckey, cv);
  }
  tex = { map: makeTexture(cv.color, tile, true), normalMap: makeTexture(cv.normal, tile, false) };
  texCache.set(tkey, tex);
  return tex;
}

// 色板缩略图：按类别取默认用途，只截取贴图一部分放大，让纹理在小图里也看得清
const SWATCH_VIEW = {
  wood: { layout: 'planks', o: 0.07, span: 0.42 },
  stone: { layout: 'floor', o: 0.1, span: 0.5 },
  fabric: { layout: 'weave', o: 0, span: 0.36 },
  paint: { layout: 'paint', o: 0, span: 0.5 },
};

// 返回某材质的方形色板图片（dataURL），带缓存；按 2 倍分辨率绘制以适配高分屏
export function swatchURL(def, px = 128) {
  const key = `${def.id}|${px}`;
  let url = swatchCache.get(key);
  if (url) return url;
  const sv = SWATCH_VIEW[def.cat];
  const { color } = render(def, sv.layout, px * 2, sv, false);
  url = color.toDataURL('image/jpeg', 0.9);
  swatchCache.set(key, url);
  return url;
}

// 原地修改已有的 MeshStandardMaterial，使其呈现 def 的外观；可反复调用，贴图有缓存
export function applyMaterial(mat, def, use) {
  const tex = getTextures(def, use);
  // 贴图“有/无”变化会改变着色器宏，必须重新编译；只换贴图对象则不需要
  const presenceChanged = !mat.map || !mat.normalMap || !!mat.bumpMap;
  mat.map = tex.map;
  mat.normalMap = tex.normalMap;
  mat.bumpMap = null;
  const ns = def.normalScale ?? 1;
  mat.normalScale.set(ns, ns);
  mat.roughness = def.rough ?? 0.8;
  mat.metalness = 0;
  mat.color.set(def.tint ?? 0xffffff);
  mat.userData.materialId = def.id;
  if (presenceChanged) mat.needsUpdate = true;
  return mat;
}

// 新建一个应用了 def 外观的 MeshStandardMaterial
export function makeMaterial(def, use) {
  return applyMaterial(new THREE.MeshStandardMaterial(), def, use);
}
