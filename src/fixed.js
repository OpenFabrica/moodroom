// 固定材质库：不随用户拖放改变的材质（金属、陶瓷、植物、灯罩等），全场共享同一实例。
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });

const FIXED = {
  metal: std('#1d1e21', { roughness: 0.45, metalness: 0.6 }),
  brass: std('#b08a4e', { roughness: 0.35, metalness: 0.85 }),
  ceramic: std('#e9e4da', { roughness: 0.45 }),
  terracotta: std('#a8603e', { roughness: 0.85 }),
  leaf: std('#3f6b3a', { roughness: 0.6, side: THREE.DoubleSide }),
  leaf2: std('#2a4c2c', { roughness: 0.65, side: THREE.DoubleSide }),
  soil: std('#2b211a', { roughness: 1 }),
  glass: new THREE.MeshPhysicalMaterial({
    color: '#cfe3ee', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false,
  }),
  // 灯罩：夜晚由 lighting 模块调高 emissiveIntensity，让灯罩自己发光
  shade: std('#efe3cf', { roughness: 0.9, emissive: '#ffbb73', emissiveIntensity: 0, side: THREE.DoubleSide }),
  bulb: std('#fff4dd', { emissive: '#ffd59a', emissiveIntensity: 0 }),
  screen: std('#11161f', { roughness: 0.25, emissive: '#7aa7d6', emissiveIntensity: 0.25 }),
  paper: std('#e8e1d2', { roughness: 0.9 }),
  linen: std('#f1ede6', { roughness: 0.95 }),
  black: std('#141416', { roughness: 0.6 }),
  coir: std('#8a6a45', { roughness: 1 }),
  // 纱帘：半透明、双面，让窗外光透进来
  sheer: std('#f3eee6', { roughness: 1, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false }),
  // 墙芯：外墙外侧和剖切面的深色
  shell: std('#5e5a55', { roughness: 0.88 }),
  // 以下是房间结构用的
  cap: std('#a8a39b', { roughness: 0.85 }),
  plinth: std('#1a1c21', { roughness: 0.55, metalness: 0, envMapIntensity: 0.6 }),
  trim: std('#2a2116', { emissive: '#e0a35c', emissiveIntensity: 1.6 }),
  frame: std('#202227', { roughness: 0.4, metalness: 0.5 }),
};

/** 按名字取固定材质；未知名字回退到 ceramic，避免家具构建时因拼写报错。 */
export function fixed(name) {
  return FIXED[name] || FIXED.ceramic;
}

export { FIXED };
