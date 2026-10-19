// 几何体 UV 工具：把 UV 改成以“米”为单位的盒式投影，让同一张材质贴图在大小不同的物体上保持真实尺度。
import * as THREE from 'three';

const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * 盒式投影 UV：按每个顶点法线的主轴，取另外两个轴的坐标（米）作为 UV。
 * 几何体如果是 indexed，先转成 non-indexed，避免共享顶点在不同面上的 UV 冲突。
 * offset 可让同一网格在世界中的位置参与计算（传入 mesh 的世界坐标偏移）。
 */
export function boxUV(geometry, offset = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    if (offset) _p.add(offset);
    _n.fromBufferAttribute(nor, i);
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
    let u, v;
    if (ay >= ax && ay >= az) { u = _p.x; v = _p.z; }        // 顶/底面：x-z
    else if (ax >= az) { u = _p.z; v = _p.y; }                // 左/右面：z-y
    else { u = _p.x; v = _p.y; }                              // 前/后面：x-y
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
