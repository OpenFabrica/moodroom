// 情绪仪表：根据表面材质（明度/冷暖/柔软度）和光照（日光/金色低角度光/灯光）估算 Cozy、Bright、Moody 三个比例。
// 这是经验规则，不是科学模型：浅色表面 + 日光 → 明亮；暖色 + 柔软 + 低金光 → 温馨；深色 + 灯光 → 沉郁。
import { SLOTS } from './state.js';
import { MATERIAL_BY_ID } from './materials.js';

/**
 * 公式系数。a* 管明亮、b* 管温馨、c* 管沉郁，k 是 softmax 的锐度。
 * 数值由拟合脚本得到：让三个预设在各自时刻的读数接近目标（温馨 69/19/12、明亮 9/86/5、沉郁 19/4/77）。
 */
export const MOOD_COEF = { a1: 1.551, a2: 0, a3: 1.219, a4: 0, b1: 1.266, b2: 0.139, b3: 1.586, b4: 0.576, b5: 0.472, b6: 0.987, c1: 1.23, c2: 0.427, c3: 0.891, c4: 0, c5: 0, c6: 0.23, k: 1.531 };

/** 计算三种情绪的原始分数和百分比，并给出一句解释。 */
export function readMood(slotIds, light) {
  let Lw = 0, Ww = 0, Sw = 0, W = 0;
  const parts = [];
  for (const s of SLOTS) {
    const m = MATERIAL_BY_ID[slotIds[s.id]];
    if (!m) continue;
    Lw += s.weight * m.L;
    Ww += s.weight * m.warm;
    Sw += s.weight * m.soft;
    W += s.weight;
    parts.push({ slot: s, m });
  }
  Lw /= W; Ww /= W; Sw /= W;

  // 光照因子：day 为直射日光强度（归一），golden 为低角度暖光，lamp 为室内灯
  const day = Math.min(1, light.sunI / 3) * (light.day ? 1 : 0);
  const low = light.day ? 1 - Math.min(1, Math.max(0, (light.dir.y - 0.12) / 0.45)) : 0;
  const golden = low * Math.min(1, light.sunI / 1.2);
  const lamp = light.lamp;

  const C = MOOD_COEF;
  const bright = C.a1 * Lw * (C.a2 + (1 - C.a2) * day) + C.a3 * day * (1 - golden) - C.a4 * lamp * (1 - Lw);
  const cozy = C.b1 * Math.max(0, Ww + C.b2) + C.b3 * Sw + C.b4 * golden + C.b5 * lamp * Math.max(0, Ww + C.b6);
  const moody = C.c1 * Math.pow(1 - Lw, C.c2) + C.c3 * lamp * (1 - C.c4 * Lw) + C.c5 * Math.max(0, -Ww) - C.c6 * day;

  // softmax 归一：拉开差距，让主导情绪更明显
  const e = [cozy, bright, moody].map(v => Math.exp(C.k * v));
  const sum = e[0] + e[1] + e[2];
  const pct = e.map(v => v / sum);
  const keys = ['cozy', 'bright', 'moody'];
  const top = keys[pct.indexOf(Math.max(...pct))];

  return { cozy: pct[0], bright: pct[1], moody: pct[2], top, line: explain(top, parts, light, golden) };
}

/** 描述当前时刻的词，用在解释句里。 */
function timeWord(light) {
  if (!light.day) return '灯光';
  const t = light.t;
  if (t < 10.5) return '晨光';
  if (t < 16) return '正午阳光';
  return '傍晚斜阳';
}

const MOOD_ZH = { cozy: '温馨', bright: '明亮', moody: '沉郁' };

/** 生成一句解释：找出对主导情绪贡献最大的两个表面，用它们的材质名组织句子。 */
function explain(top, parts, light, golden) {
  const score = {
    bright: p => p.slot.weight * p.m.L,
    cozy: p => p.slot.weight * (Math.max(0, p.m.warm) + 0.6 * p.m.soft),
    moody: p => p.slot.weight * (1 - p.m.L),
  }[top];
  const [a, b] = [...parts].sort((p, q) => score(q) - score(p));
  const name = p => `<b>${p.m.name}${p.slot.noun}</b>`;
  const tw = timeWord(light);
  let s;
  if (top === 'bright') s = `${name(a)}和${name(b)}把${tw}反射回房间里。`;
  else if (top === 'cozy') s = golden > 0.3
    ? `${name(a)}和${name(b)}吸进了${tw}，整个房间暖了起来。`
    : `${name(a)}和${name(b)}让房间在${tw}下又软又暖。`;
  else s = light.day
    ? `${name(a)}把${tw}挡在了外面。`
    : `${name(a)}吞没了夜色，房间由台灯一点点勾勒出来。`;
  return `${s}整体感觉：<em class="m-${top}">${MOOD_ZH[top]}</em>。`;
}
