// Furniture catalogue: procedural three.js builders for every piece in the Moodroom tray.
// Conventions: meters, y up, footprint centred on the origin at floor level, front faces +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const _up = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* Generic helpers                                                     */
/* ------------------------------------------------------------------ */

// Create a shadow-casting mesh at (x, y, z) and add it to the parent.
function put(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// Bind mesh-adding shortcuts to a fresh group and the app's material provider M.
function kit(M) {
  const g = new THREE.Group();
  return {
    g,
    // Mesh with an editable slot material (geometry gets metric UVs, slot tagged for raycasts).
    s(slot, geo, x, y, z) {
      const m = put(g, M.boxUV(geo), M.slot(slot), x, y, z);
      m.userData.slot = slot;
      return m;
    },
    // Mesh with one of the app's fixed materials.
    f(name, geo, x, y, z) { return put(g, geo, M.fixed(name), x, y, z); },
    // Mesh with a locally created material.
    m(mat, geo, x, y, z) { return put(g, geo, mat, x, y, z); },
  };
}

// Set a mesh's Euler rotation and return it (keeps builder code on one line).
function rot(m, x = 0, y = 0, z = 0, order = 'XYZ') {
  m.rotation.set(x, y, z, order);
  return m;
}

// Place and orient a Y-aligned mesh so that it spans from point a to point b.
function aim(m, a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(_up, dir.normalize());
  return m;
}

// Plain box geometry.
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// Rounded box; radius is clamped so RoundedBoxGeometry never self-intersects.
const rbox = (w, h, d, r = 0.03, seg = 3) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 0.001));

// Cylinder (or tapered cylinder / cone) geometry.
const cyl = (rTop, rBot, h, seg = 20) => new THREE.CylinderGeometry(rTop, rBot, h, seg);

// Cylinder geometry whose length matches the distance between two points (pair with aim()).
const rodGeo = (a, b, r, seg = 10) => cyl(r, r, a.distanceTo(b), seg);

// Shorthand Vector3.
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Small seeded PRNG (mulberry32) so procedural details are identical on every build.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lazily created local materials (bark, book covers, aluminium) shared by every build.
const _localMats = new Map();
function local(key, color, roughness = 0.8, metalness = 0) {
  if (!_localMats.has(key)) {
    _localMats.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  }
  return _localMats.get(key);
}

/* ------------------------------------------------------------------ */
/* Lathe profiles                                                      */
/* ------------------------------------------------------------------ */

// Append quarter-circle points around centre (cx, cy) from angle a0 to a1.
function arc(pts, cx, cy, r, a0, a1, n = 5) {
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
}

// Solid cylinder with rounded top/bottom edges and a slight belly (pouf, cushions).
function softDrumGeo(r, h, rr, bulge = 0.012, seg = 32) {
  const pts = [new THREE.Vector2(0, 0)];
  arc(pts, r - rr, rr, rr, -PI / 2, 0);
  pts.push(new THREE.Vector2(r + bulge, h / 2));
  arc(pts, r - rr, h - rr, rr, 0, PI / 2);
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, seg);
}

// Thin-walled lamp shade (outer + inner wall) so it reads correctly from any angle.
function shadeGeo(rBot, rTop, h, wall = 0.004, seg = 32) {
  const pts = [
    new THREE.Vector2(rBot - wall, 0),
    new THREE.Vector2(rBot, 0),
    new THREE.Vector2(rTop, h),
    new THREE.Vector2(rTop - wall, h),
    new THREE.Vector2(rBot - wall, 0),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

// Planter pot with a rolled rim and a soil-level floor inside.
function potGeo(rTop, rBot, h, seg = 28) {
  const t = 0.012;
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rBot, 0),
    new THREE.Vector2(rTop, h * 0.86),
    new THREE.Vector2(rTop + t, h * 0.88),
    new THREE.Vector2(rTop + t, h),
    new THREE.Vector2(rTop - t * 0.5, h),
    new THREE.Vector2(rTop - t, h * 0.9),
    new THREE.Vector2(0, h * 0.9),
  ];
  return new THREE.LatheGeometry(pts, seg);
}

// Bud vase: round body, narrow neck, small flared lip, closed just inside the opening.
function vaseGeo(r, h, seg = 24) {
  const pts = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // Body swells to r at ~35% height, pinches into a neck, flares at the lip.
    const body = Math.sin(Math.min(1, t / 0.7) * PI) * 0.85 + 0.15;
    const lip = t > 0.85 ? (t - 0.85) * 1.6 : 0;
    pts.push(new THREE.Vector2(r * (0.35 * (1 - t) + 0.65 * body * (1 - t * 0.55)) + r * lip, h * t));
  }
  const top = pts[pts.length - 1];
  pts.push(new THREE.Vector2(top.x - 0.004, h - 0.02), new THREE.Vector2(0, h - 0.02));
  return new THREE.LatheGeometry(pts, seg);
}

// Shallow open bowl.
function bowlGeo(r, h, seg = 24) {
  // Outer wall flares from a small foot to the rim, then the inner wall drops back to a raised floor.
  const pts = [
    [0, 0], [r * 0.45, 0], [r * 0.8, h * 0.45], [r, h],
    [r - 0.004, h], [r * 0.78, h * 0.55], [r * 0.42, h * 0.18], [0, h * 0.18],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  return new THREE.LatheGeometry(pts, seg);
}

/* ------------------------------------------------------------------ */
/* Shared sub-assemblies                                               */
/* ------------------------------------------------------------------ */

// Small stack of books lying flat; returns the stack height.
function bookStack(k, M, x, y, z, sizes, yaw = 0) {
  const covers = [M.fixed('paper'), local('book-sage', 0x7c8b78), local('book-rust', 0x9a5a43), local('book-navy', 0x3d4757)];
  let top = y;
  sizes.forEach(([w, h, d], i) => {
    const b = put(k.g, box(w, h, d), covers[i % covers.length], x, top + h / 2, z);
    b.rotation.y = yaw + (i % 2 ? 0.12 : -0.06);
    top += h;
  });
  return top - y;
}

// Tapered round leg standing on the floor (or on baseY), using the woodwork slot.
function woodLeg(k, x, z, h, rTop = 0.022, rBot = 0.015, baseY = 0) {
  return k.s('woodwork', cyl(rTop, rBot, h, 14), x, baseY + h / 2, z);
}

// Light bulb sphere; it does not cast shadows so a shadowed lamp light inside it isn't blocked.
function bulb(k, x, y, z, r = 0.03) {
  const b = k.f('bulb', new THREE.SphereGeometry(r, 12, 8), x, y, z);
  b.castShadow = false;
  return b;
}

/* ------------------------------------------------------------------ */
/* Cached fixed-material geometries                                    */
/* ------------------------------------------------------------------ */

let _leafGeo = null;
// Broad fiddle-leaf blade: flattened ellipsoid extending along +z from the origin.
function leafGeo() {
  if (!_leafGeo) {
    _leafGeo = new THREE.SphereGeometry(1, 12, 6);
    _leafGeo.scale(0.075, 0.008, 0.105);
    _leafGeo.translate(0, 0, 0.1);
  }
  return _leafGeo;
}

const _bladeGeos = new Map();
// Long flattened blade (snake-plant style) of a given height, base at the origin.
function bladeGeo(h) {
  const key = h.toFixed(2);
  if (!_bladeGeos.has(key)) {
    const g = cyl(0.002, 0.028, h, 6);
    g.scale(1, 1, 0.22);
    g.translate(0, h / 2, 0);
    _bladeGeos.set(key, g);
  }
  return _bladeGeos.get(key);
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

// L-shaped sectional: main run along the back, chaise on the right (+x), low wooden legs.
function buildSofa(M) {
  const k = kit(M);
  const W = 2.6, D = 1.6, arm = 0.18, legH = 0.08;
  const xi = W / 2 - arm; // inner face of the arms
  const zBack = -D / 2, zMain = 0.15, chaiseX = 0.4;

  // Legs (short wooden pegs) under the corners and the middle of the back.
  [[-1.24, -0.74], [-1.24, 0.09], [1.24, -0.74], [1.24, 0.74], [0.46, 0.74], [0.46, 0.09], [0, -0.74]]
    .forEach(([x, z]) => woodLeg(k, x, z, legH, 0.02, 0.016));

  // Upholstered base platforms (main run + chaise extension).
  k.s('upholstery', rbox(2 * xi, 0.24, zMain - zBack, 0.03), 0, legH + 0.12, (zBack + zMain) / 2);
  k.s('upholstery', rbox(xi - chaiseX, 0.24, D / 2 - zMain + 0.02, 0.03), (xi + chaiseX) / 2, legH + 0.12, (zMain + D / 2) / 2 - 0.01);

  // Back frame and the two arms.
  k.s('upholstery', rbox(2 * xi, 0.6, 0.18, 0.05), 0, legH + 0.3, zBack + 0.09);
  k.s('upholstery', rbox(arm, 0.52, zMain - zBack, 0.06), -xi - arm / 2, legH + 0.26, (zBack + zMain) / 2);
  k.s('upholstery', rbox(arm, 0.52, D, 0.06), xi + arm / 2, legH + 0.26, 0);

  // Seat cushions: two on the main run, one long cushion on the chaise.
  const seatY = legH + 0.24 + 0.07, seatZ0 = zBack + 0.18;
  [-0.74, 0.02].forEach((x) => k.s('upholstery', rbox(0.74, 0.14, zMain - seatZ0, 0.05), x, seatY, (seatZ0 + zMain) / 2));
  k.s('upholstery', rbox(xi - chaiseX - 0.02, 0.14, D / 2 - seatZ0, 0.05), (xi + chaiseX) / 2, seatY, (seatZ0 + D / 2) / 2);

  // Back cushions, slightly reclined against the frame.
  const backY = seatY + 0.07 + 0.195;
  [-0.74, 0, 0.74].forEach((x) => rot(k.s('upholstery', rbox(0.72, 0.39, 0.2, 0.07), x, backY, seatZ0 + 0.1), -0.12));

  // Throw cushions leaning on the back cushions.
  [[-0.98, 0.1], [-0.6, -0.12], [0.86, 0.15]].forEach(([x, yaw]) =>
    rot(k.s('accents', rbox(0.42, 0.42, 0.13, 0.06), x, seatY + 0.27, seatZ0 + 0.3), -0.28, yaw, yaw * 0.5));
  return k.g;
}

// Lounge armchair: open wooden side frames, upholstered seat and back cushions.
function buildArmchair(M) {
  const k = kit(M);
  const sx = 0.36, armY = 0.58;
  for (const s of [-1, 1]) {
    const x = s * sx;
    woodLeg(k, x, 0.33, armY, 0.022, 0.018);                       // front leg
    k.s('woodwork', cyl(0.022, 0.018, 0.84, 14), x, 0.42, -0.36);  // back post
    k.s('woodwork', rbox(0.06, 0.03, 0.8, 0.012), x, armY + 0.015, -0.02); // armrest
    k.s('woodwork', box(0.03, 0.05, 0.66), x, 0.24, -0.02);        // side seat rail
  }
  // Front/back seat rails and the top back rail.
  k.s('woodwork', box(0.7, 0.05, 0.03), 0, 0.24, 0.33);
  k.s('woodwork', box(0.7, 0.05, 0.03), 0, 0.24, -0.36);
  k.s('woodwork', rbox(0.7, 0.07, 0.03, 0.01), 0, 0.78, -0.37);

  // Cushions: seat, reclined back, one accent pillow.
  k.s('upholstery', rbox(0.66, 0.14, 0.68, 0.05), 0, 0.34, 0);
  rot(k.s('upholstery', rbox(0.64, 0.48, 0.14, 0.06), 0, 0.64, -0.27), -0.22);
  rot(k.s('accents', rbox(0.38, 0.32, 0.11, 0.05), 0.06, 0.56, -0.14), -0.3, 0, 0.08);
  return k.g;
}

// Round coffee table with a lower shelf, a vase, a book stack and a brass bowl.
function buildCoffee(M) {
  const k = kit(M);
  const H = 0.4;
  k.s('woodwork', cyl(0.475, 0.475, 0.04, 48), 0, H - 0.02, 0);
  k.s('woodwork', cyl(0.4, 0.4, 0.025, 40), 0, 0.12, 0);
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2;
    woodLeg(k, Math.cos(a) * 0.36, Math.sin(a) * 0.36, H - 0.04, 0.024, 0.02);
  }
  k.f('ceramic', vaseGeo(0.07, 0.2), 0.2, H, -0.12);
  bookStack(k, M, -0.16, H, 0.1, [[0.26, 0.03, 0.2], [0.22, 0.025, 0.17]], 0.3);
  k.f('brass', bowlGeo(0.08, 0.04), 0.05, H, 0.22);
  return k.g;
}

// Soft round pouf with a piped top seam.
function buildPouf(M) {
  const k = kit(M);
  k.s('upholstery', softDrumGeo(0.23, 0.42, 0.06), 0, 0, 0);
  rot(k.s('upholstery', new THREE.TorusGeometry(0.2, 0.008, 6, 40), 0, 0.417, 0), PI / 2);
  return k.g;
}

// Tripod floor lamp: three wooden legs, black stem and a drum shade.
function buildFloorlamp(M) {
  const k = kit(M);
  const apex = v3(0, 1.22, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * PI) / 3 + PI / 2;
    // Foot centre is lifted slightly so the tilted cylinder cap doesn't dip below the floor.
    const foot = v3(Math.cos(a) * 0.2, 0.004, Math.sin(a) * 0.2);
    const top = v3(Math.cos(a) * 0.02, apex.y, Math.sin(a) * 0.02);
    aim(k.s('woodwork', rodGeo(foot, top, 0.014)), foot, top);
  }
  k.f('metal', cyl(0.03, 0.03, 0.05), 0, apex.y, 0);                 // leg collar
  k.f('metal', cyl(0.008, 0.008, 0.18), 0, apex.y + 0.11, 0);        // stem
  k.f('shade', shadeGeo(0.2, 0.19, 0.26), 0, 1.32, 0);
  bulb(k, 0, 1.42, 0, 0.035);
  k.g.userData.lamps = [{ pos: v3(0, 1.42, 0), color: 0xffc98a, intensity: 1 }];
  return k.g;
}

// Small pedestal side table with a ceramic cup.
function buildSide(M) {
  const k = kit(M);
  k.s('woodwork', cyl(0.225, 0.225, 0.03, 40), 0, 0.485, 0);
  k.s('woodwork', cyl(0.035, 0.045, 0.45, 18), 0, 0.245, 0);
  k.s('woodwork', cyl(0.16, 0.17, 0.025, 36), 0, 0.0125, 0);
  k.f('ceramic', cyl(0.04, 0.035, 0.09, 18), 0.08, 0.545, 0.05);
  return k.g;
}

// Arc floor lamp: heavy round base, a steel arc that leans out over the seating, and a dome shade.
// Only the base counts for collision; the arc deliberately overhangs the sofa in front (+z).
function buildArclamp(M) {
  const k = kit(M);
  k.f('ceramic', cyl(0.17, 0.18, 0.05, 36), 0, 0.025, 0);
  const reach = 1.25, top = 2.05;
  const curve = new THREE.CubicBezierCurve3(v3(0, 0.05, 0), v3(0, top + 0.05, 0), v3(0, top + 0.12, reach * 0.55), v3(0, top - 0.12, reach));
  k.f('metal', new THREE.TubeGeometry(curve, 48, 0.012, 8, false));
  const sx = 0, sy = top - 0.22, sz = reach;
  const dome = new THREE.SphereGeometry(0.19, 32, 12, 0, PI * 2, 0, PI / 2);
  k.f('metal', dome, sx, sy, sz).material = M.fixed('black');
  const inner = new THREE.SphereGeometry(0.185, 32, 12, 0, PI * 2, 0, PI / 2);
  rot(k.f('shade', inner, sx, sy - 0.002, sz), PI);  // 内侧发光面，朝下
  bulb(k, sx, sy - 0.05, sz, 0.035);
  k.g.userData.lamps = [{ pos: v3(sx, sy - 0.12, sz), color: 0xffc98a, intensity: 1.2 }];
  return k.g;
}

// Pedestal side table with a ceramic table lamp on top.
function buildSidelamp(M) {
  const k = kit(M);
  k.s('woodwork', cyl(0.225, 0.225, 0.03, 40), 0, 0.485, 0);
  k.s('woodwork', cyl(0.035, 0.045, 0.45, 18), 0, 0.245, 0);
  k.s('woodwork', cyl(0.16, 0.17, 0.025, 36), 0, 0.0125, 0);
  const H = 0.5;
  k.f('ceramic', vaseGeo(0.075, 0.2), 0, H, 0);
  k.f('brass', cyl(0.005, 0.005, 0.07, 8), 0, H + 0.22, 0);
  k.f('shade', shadeGeo(0.14, 0.11, 0.18), 0, H + 0.2, 0);
  bulb(k, 0, H + 0.27, 0, 0.028);
  k.g.userData.lamps = [{ pos: v3(0, H + 0.27, 0), color: 0xffc98a, intensity: 1 }];
  return k.g;
}

// Tall fiddle-leaf fig: terracotta pot, slim trunk, many broad leaves in the crown.
function buildPlant(M) {
  const k = kit(M);
  const r = rng(7);
  const potH = 0.34;
  k.f('terracotta', potGeo(0.17, 0.13, potH), 0, 0, 0);
  k.f('soil', cyl(0.165, 0.165, 0.01, 24), 0, potH * 0.9, 0);

  // Trunk in two slightly offset segments plus one side branch.
  const bark = local('bark', 0x6a5644, 0.9);
  const t0 = v3(0, potH * 0.9, 0), t1 = v3(0.02, 1.0, 0.01), t2 = v3(-0.01, 1.62, 0.02);
  aim(k.m(bark, rodGeo(t0, t1, 0.018, 8)), t0, t1);
  aim(k.m(bark, rodGeo(t1, t2, 0.013, 8)), t1, t2);
  const b0 = v3(0.015, 0.95, 0.01), b1 = v3(0.1, 1.25, -0.06);
  aim(k.m(bark, rodGeo(b0, b1, 0.009, 6)), b0, b1);

  // Leaves spiral up the trunk/branch with golden-angle spacing and varied tilt.
  const leaves = [M.fixed('leaf'), M.fixed('leaf2')];
  const n = 30;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const onBranch = i % 6 === 3;
    const p = onBranch ? b0.clone().lerp(b1, 0.4 + r() * 0.6) : t0.clone().lerp(t2, 0.42 + t * 0.58);
    const s = 0.75 + r() * 0.4;
    const leaf = k.m(leaves[i % 2], leafGeo(), p.x, p.y, p.z);
    leaf.scale.setScalar(s);
    // YXZ order: pitch the blade upward first, then yaw it around the trunk.
    rot(leaf, -(0.25 + r() * 0.65), i * 2.39996, (r() - 0.5) * 0.6, 'YXZ');
  }
  return k.g;
}

// Bushy snake-plant style floor plant: ceramic planter with long upright blades.
function buildPlant2(M) {
  const k = kit(M);
  const r = rng(21);
  const potH = 0.3;
  k.f('ceramic', potGeo(0.18, 0.15, potH), 0, 0, 0);
  k.f('soil', cyl(0.175, 0.175, 0.01, 24), 0, potH * 0.9, 0);
  const mats = [M.fixed('leaf'), M.fixed('leaf2')];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996;
    const rad = 0.02 + r() * 0.07;
    const h = 0.55 + r() * 0.35;
    const blade = k.m(mats[i % 2], bladeGeo(Math.round(h * 20) / 20), Math.cos(a) * rad, potH * 0.88, Math.sin(a) * rad);
    // Lean each blade outward a little (pitch toward its radial direction).
    rot(blade, 0.06 + r() * 0.08, -a + PI / 2, (r() - 0.5) * 0.1, 'YXZ');
  }
  return k.g;
}

// Low media credenza: four slab doors with shadow-gap seams, brass pulls, black steel legs, decor.
function buildSideboard(M) {
  const k = kit(M);
  const W = 1.8, D = 0.45, H = 0.6, legH = 0.14;
  const bodyH = H - legH;
  // Carcass sits slightly behind the door plane.
  k.s('woodwork', box(W, bodyH, D - 0.02), 0, legH + bodyH / 2, -0.01);
  const doorW = (W - 0.03) / 4, doorH = bodyH - 0.04;
  for (let i = 0; i < 4; i++) {
    const x = -W / 2 + 0.015 + doorW * (i + 0.5);
    k.s('woodwork', box(doorW - 0.008, doorH, 0.02), x, legH + bodyH / 2, D / 2 - 0.01);
    // Pull sits on the inner edge of each door pair.
    const px = x + (i % 2 === 0 ? 1 : -1) * (doorW / 2 - 0.05);
    k.f('brass', box(0.012, 0.09, 0.012), px, legH + bodyH * 0.62, D / 2 + 0.006);
  }
  // Steel legs and a slim under-frame.
  [[-0.84, -0.18], [-0.84, 0.18], [0.84, -0.18], [0.84, 0.18]].forEach(([x, z]) =>
    k.f('metal', box(0.025, legH, 0.025), x, legH / 2, z));
  k.f('metal', box(1.7, 0.02, 0.02), 0, legH - 0.01, 0.18);
  k.f('metal', box(1.7, 0.02, 0.02), 0, legH - 0.01, -0.18);

  // Decor on top: tall vase, book stack with a sphere, brass bowl.
  k.f('ceramic', vaseGeo(0.08, 0.25), -0.6, H, -0.06);
  const sh = bookStack(k, M, 0.2, H, -0.02, [[0.3, 0.035, 0.22], [0.26, 0.03, 0.2], [0.22, 0.03, 0.17]], -0.1);
  k.f('ceramic', new THREE.SphereGeometry(0.045, 16, 12), 0.22, H + sh + 0.045, -0.02);
  k.f('brass', bowlGeo(0.09, 0.045), 0.62, H, 0.04);
  return k.g;
}

// Flat rounded-rectangle area rug.
function buildRug(M) {
  const k = kit(M);
  const w = 2.4, d = 1.7, r = 0.12, t = 0.015;
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -d / 2);
  s.lineTo(w / 2 - r, -d / 2);
  s.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  s.lineTo(w / 2, d / 2 - r);
  s.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  s.lineTo(-w / 2 + r, d / 2);
  s.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  s.lineTo(-w / 2, -d / 2 + r);
  s.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  geo.rotateX(-PI / 2); // extrusion axis becomes +y, so the rug spans y ∈ [0, t]
  const m = k.s('rugs', geo, 0, 0, 0);
  m.castShadow = false;
  return k.g;
}

// Dining table: thick top, apron rails, tapered round legs.
function buildDining(M) {
  const k = kit(M);
  const W = 1.6, D = 0.9, H = 0.75, top = 0.04;
  k.s('woodwork', rbox(W, top, D, 0.012), 0, H - top / 2, 0);
  const lx = W / 2 - 0.09, lz = D / 2 - 0.09, legH = H - top;
  [[-lx, -lz], [-lx, lz], [lx, -lz], [lx, lz]].forEach(([x, z]) => woodLeg(k, x, z, legH, 0.032, 0.022));
  // Apron rails just under the top.
  const ay = H - top - 0.04;
  k.s('woodwork', box(2 * lx, 0.07, 0.025), 0, ay, lz);
  k.s('woodwork', box(2 * lx, 0.07, 0.025), 0, ay, -lz);
  k.s('woodwork', box(0.025, 0.07, 2 * lz), lx, ay, 0);
  k.s('woodwork', box(0.025, 0.07, 2 * lz), -lx, ay, 0);
  return k.g;
}

// Dining chair: wooden frame with curved-ish backrest and an upholstered seat pad.
function buildChair(M) {
  const k = kit(M);
  const sx = 0.19, seatY = 0.44;
  for (const s of [-1, 1]) {
    woodLeg(k, s * sx, 0.2, seatY - 0.03, 0.017, 0.013);
    rot(k.s('woodwork', cyl(0.017, 0.014, 0.82, 12), s * sx, 0.41, -0.215), -0.05); // back post
    k.s('woodwork', box(0.02, 0.025, 0.38), s * sx, 0.14, -0.005);                 // side stretcher
  }
  // Seat frame rails.
  k.s('woodwork', box(0.4, 0.04, 0.025), 0, seatY - 0.04, 0.2);
  k.s('woodwork', box(0.4, 0.04, 0.025), 0, seatY - 0.04, -0.2);
  // Backrest: two slightly tilted rails.
  rot(k.s('woodwork', rbox(0.4, 0.12, 0.022, 0.008), 0, 0.73, -0.232), -0.08);
  rot(k.s('woodwork', box(0.38, 0.03, 0.018), 0, 0.57, -0.222), -0.05);
  // Upholstered seat pad.
  k.s('upholstery', rbox(0.44, 0.06, 0.44, 0.022), 0, seatY, 0.0);
  return k.g;
}

// Double bed: upholstered headboard (-z), wooden frame, mattress, folded-back duvet, pillows and cushions.
function buildBed(M) {
  const k = kit(M);
  const W = 1.75, D = 2.15, hbT = 0.08;
  const zHead = -D / 2 + hbT; // front face of the headboard
  // Headboard and wooden frame.
  k.s('upholstery', rbox(W, 1.0, hbT, 0.035), 0, 0.55, -D / 2 + hbT / 2);
  [[-0.8, zHead + 0.06], [0.8, zHead + 0.06], [-0.8, D / 2 - 0.06], [0.8, D / 2 - 0.06]].forEach(([x, z]) =>
    k.s('woodwork', box(0.06, 0.1, 0.06), x, 0.05, z));
  const frameD = D / 2 - zHead;
  k.s('woodwork', rbox(W, 0.22, frameD, 0.015), 0, 0.21, zHead + frameD / 2);

  // Mattress (white sheet) and duvet that wraps over the sides from mid-bed to the foot.
  const mz0 = zHead + 0.02, mz1 = D / 2 - 0.04;
  k.f('linen', rbox(1.65, 0.22, mz1 - mz0, 0.05), 0, 0.43, (mz0 + mz1) / 2);
  const dz0 = -0.35, dz1 = D / 2 - 0.02;
  k.s('bedding', rbox(1.72, 0.27, dz1 - dz0, 0.05), 0, 0.465, (dz0 + dz1) / 2);
  // Turned-down fold at the head end of the duvet.
  k.s('bedding', rbox(1.73, 0.05, 0.32, 0.02), 0, 0.615, dz0 + 0.14);

  // Pillows lean on the headboard, accent cushions in front of them.
  [-0.42, 0.42].forEach((x) => rot(k.f('linen', rbox(0.7, 0.14, 0.46, 0.06), x, 0.62, zHead + 0.25), -0.35));
  [-0.3, 0.3].forEach((x, i) =>
    rot(k.s('accents', rbox(0.44, 0.4, 0.12, 0.055), x, 0.76, zHead + 0.5), -0.3, (i ? -1 : 1) * 0.08));
  return k.g;
}

// Nightstand with a drawer and a small ceramic table lamp.
function buildNightstand(M) {
  const k = kit(M);
  const W = 0.5, D = 0.42, H = 0.55, legH = 0.12;
  const bodyH = H - legH;
  [[-0.21, -0.17], [-0.21, 0.17], [0.21, -0.17], [0.21, 0.17]].forEach(([x, z]) => woodLeg(k, x, z, legH, 0.016, 0.012));
  k.s('woodwork', rbox(W, bodyH, D - 0.02, 0.01), 0, legH + bodyH / 2, -0.01);
  // Drawer front with a seam gap above an open cubby.
  k.s('woodwork', box(W - 0.04, 0.14, 0.02), 0, H - 0.1, D / 2 - 0.01);
  k.f('black', box(W - 0.04, 0.2, 0.004), 0, legH + 0.13, D / 2 - 0.018);
  k.f('brass', new THREE.SphereGeometry(0.014, 12, 8), 0, H - 0.1, D / 2 + 0.008);

  // Table lamp.
  const lx = 0.1, lz = -0.04;
  k.f('ceramic', vaseGeo(0.07, 0.15), lx, H, lz);
  k.f('brass', cyl(0.005, 0.005, 0.06, 8), lx, H + 0.16, lz);
  k.f('shade', shadeGeo(0.11, 0.085, 0.15), lx, H + 0.14, lz);
  bulb(k, lx, H + 0.2, lz, 0.025);
  k.g.userData.lamps = [{ pos: v3(lx, H + 0.2, lz), color: 0xffc98a, intensity: 1 }];
  return k.g;
}

// Two-door wardrobe on a recessed plinth with long brass bar handles.
function buildWardrobe(M) {
  const k = kit(M);
  const W = 1.2, D = 0.6, H = 2.1, plinth = 0.06;
  const bodyH = H - plinth;
  k.s('woodwork', box(W - 0.04, plinth, D - 0.08), 0, plinth / 2, -0.02);
  k.s('woodwork', box(W, bodyH, D - 0.04), 0, plinth + bodyH / 2, -0.02);
  // Doors with a centre shadow gap.
  const doorW = W / 2 - 0.006, doorZ = D / 2 - 0.04 + 0.01;
  [-1, 1].forEach((s) => {
    k.s('woodwork', box(doorW, bodyH - 0.01, 0.02), s * (doorW / 2 + 0.003), plinth + bodyH / 2, doorZ);
    const hx = s * 0.04, hy = plinth + bodyH * 0.5;
    k.f('brass', cyl(0.008, 0.008, 0.36, 10), hx, hy, doorZ + 0.03);
    k.f('brass', box(0.01, 0.01, 0.02), hx, hy + 0.15, doorZ + 0.018);
    k.f('brass', box(0.01, 0.01, 0.02), hx, hy - 0.15, doorZ + 0.018);
  });
  return k.g;
}

// Desk: wooden top on black steel frames, open laptop, notebook, mug and a small desk lamp.
function buildDesk(M) {
  const k = kit(M);
  const W = 1.4, D = 0.7, H = 0.75, top = 0.03;
  k.s('woodwork', rbox(W, top, D, 0.008), 0, H - top / 2, 0);
  // Rectangular steel side frames.
  const legH = H - top, fx = W / 2 - 0.06, fz = D / 2 - 0.04;
  for (const s of [-1, 1]) {
    const x = s * fx;
    k.f('metal', box(0.03, legH, 0.03), x, legH / 2, fz);
    k.f('metal', box(0.03, legH, 0.03), x, legH / 2, -fz);
    k.f('metal', box(0.03, 0.03, 2 * fz), x, 0.015, 0);
    k.f('metal', box(0.03, 0.03, 2 * fz), x, legH - 0.015, 0);
  }
  k.f('metal', box(2 * fx, 0.03, 0.02), 0, legH - 0.04, -fz);

  // Laptop: base slab with keyboard area, lid tilted back about the hinge.
  const alu = local('aluminium', 0xb9bbbe, 0.35, 0.8);
  const lzc = 0.02;
  k.m(alu, box(0.32, 0.014, 0.22), 0, H + 0.007, lzc);
  k.f('black', box(0.28, 0.002, 0.1), 0, H + 0.015, lzc - 0.02);
  const lid = new THREE.Group();
  lid.position.set(0, H + 0.014, lzc - 0.11);
  lid.rotation.x = -0.25;
  put(lid, box(0.32, 0.21, 0.008), alu, 0, 0.105, -0.004);
  put(lid, box(0.3, 0.19, 0.002), M.fixed('screen'), 0, 0.105, 0.001);
  k.g.add(lid);

  // Notebook, mug.
  bookStack(k, M, -0.38, H, 0.08, [[0.21, 0.015, 0.15]], 0.2);
  k.f('ceramic', cyl(0.04, 0.036, 0.095, 18), -0.32, H + 0.0475, -0.16);

  // Desk lamp: weighted base, upright, horizontal arm and a downward cone shade.
  const lx = 0.5, lz0 = -0.24, lz1 = -0.1, armY = H + 0.27;
  k.f('metal', cyl(0.07, 0.075, 0.02, 24), lx, H + 0.01, lz0);
  k.f('metal', cyl(0.007, 0.007, armY - H, 8), lx, (H + armY) / 2, lz0);
  rot(k.f('metal', cyl(0.007, 0.007, lz1 - lz0, 8), lx, armY, (lz0 + lz1) / 2), PI / 2);
  const shadeY = armY - 0.13;
  k.f('shade', shadeGeo(0.075, 0.03, 0.11), lx, shadeY, lz1);
  bulb(k, lx, shadeY + 0.04, lz1, 0.022);
  k.g.userData.lamps = [{ pos: v3(lx, shadeY + 0.04, lz1), color: 0xffc98a, intensity: 1 }];
  return k.g;
}

// Swivel office chair: five-star black base with casters, gas column, upholstered seat and back.
function buildDeskchair(M) {
  const k = kit(M);
  for (let i = 0; i < 5; i++) {
    const a = (i * 2 * PI) / 5;
    const arm = k.f('black', box(0.04, 0.03, 0.26), Math.sin(a) * 0.13, 0.07, Math.cos(a) * 0.13);
    rot(arm, 0, a);
    k.f('black', new THREE.SphereGeometry(0.026, 12, 8), Math.sin(a) * 0.265, 0.026, Math.cos(a) * 0.265);
  }
  k.f('black', cyl(0.045, 0.05, 0.05, 20), 0, 0.08, 0);       // hub
  k.f('metal', cyl(0.02, 0.02, 0.3, 14), 0, 0.25, 0);         // gas column
  k.f('black', box(0.22, 0.03, 0.22), 0, 0.41, 0);            // seat plate
  k.s('upholstery', rbox(0.5, 0.08, 0.48, 0.035), 0, 0.46, 0.02);
  // Back support spine and the reclined back cushion.
  rot(k.f('black', box(0.06, 0.32, 0.02), 0, 0.58, -0.24), -0.08);
  rot(k.s('upholstery', rbox(0.46, 0.46, 0.06, 0.03), 0, 0.76, -0.25), -0.1);
  return k.g;
}

// Open-back bookcase / room divider: mid height, no back panel so books read from both sides, plant on top.
function buildBookshelf(M) {
  const k = kit(M);
  const W = 0.9, D = 0.36, H = 1.36, t = 0.028;
  const ix = W / 2 - t; // inner side face
  const r = rng(42);
  k.s('woodwork', box(t, H, D), -W / 2 + t / 2, H / 2, 0);
  k.s('woodwork', box(t, H, D), W / 2 - t / 2, H / 2, 0);
  k.s('woodwork', box(2 * ix, 0.06, t), 0, 0.03, D / 2 - t / 2); // kick plate
  const shelfYs = [0.06, 0.5, 0.93, H - t];
  shelfYs.forEach((y) => k.s('woodwork', box(2 * ix, t, D), 0, y - t / 2, 0));
  // Top board overhangs slightly, like a solid lid.
  k.s('woodwork', box(W + 0.02, t, D + 0.02), 0, H - t / 2, 0);

  // Books are accumulated per material and merged into one mesh per material.
  const mats = [
    M.fixed('paper'), local('book-sage', 0x7c8b78), local('book-rust', 0x9a5a43), local('book-navy', 0x3d4757),
    local('book-sand', 0xc8b597), local('book-ochre', 0xb48a4e), local('book-brown', 0x5a4535),
  ];
  const bins = mats.map(() => []);
  const zBack = -0.11; // books sit roughly centred in depth so both faces show spines
  const addBook = (geo, x, y, z) => { geo.translate(x, y, z); bins[Math.floor(r() * mats.length)].push(geo); };

  for (let s = 0; s < shelfYs.length - 1; s++) {
    const y0 = shelfYs[s];
    // Alternate which side keeps open space for decor.
    const decorLeft = s % 2 === 1;
    let x = decorLeft ? -ix + 0.26 : -ix + 0.005;
    const xEnd = decorLeft ? ix - 0.005 : ix - 0.26;
    let lastH = 0.25;
    while (true) {
      const bw = 0.022 + r() * 0.022, bh = 0.22 + r() * 0.12, bd = 0.17 + r() * 0.06;
      if (x + bw > xEnd) break;
      addBook(box(bw, bh, bd), x + bw / 2, y0 + bh / 2, zBack + bd / 2);
      x += bw + 0.002;
      lastH = bh;
    }
    // One book leaning against the end of the run (on shelves with room to the right).
    if (!decorLeft && s !== 2) {
      const a = 0.28, bw = 0.03, bh = Math.min(0.24, lastH);
      const g = box(bw, bh, 0.19);
      g.rotateZ(-a);
      addBook(g, x + (bh / 2) * Math.sin(a) + (bw / 2) * Math.cos(a), y0 + (bh / 2) * Math.cos(a) + (bw / 2) * Math.sin(a), zBack + 0.095);
    }
    // Decor in the open bay.
    const dx = decorLeft ? -ix + 0.13 : ix - 0.11;
    if (s === 0) bookStack(k, M, dx - 0.02, y0, 0.0, [[0.2, 0.03, 0.16], [0.18, 0.03, 0.14]]);
    else if (s === 1) k.f('ceramic', vaseGeo(0.06, 0.2), dx, y0, -0.02);
    else if (s === 2) k.f('brass', bowlGeo(0.07, 0.035), dx, y0, 0);
    else if (s === 3) {
      k.f('terracotta', potGeo(0.055, 0.045, 0.09), dx, y0, -0.02);
      k.f('leaf', new THREE.SphereGeometry(0.07, 12, 8), dx, y0 + 0.14, -0.02);
    } else k.f('ceramic', new THREE.SphereGeometry(0.05, 16, 12), dx, y0 + 0.05, 0);
  }
  bins.forEach((geos, i) => { if (geos.length) k.m(mats[i], mergeGeometries(geos)); });

  // Small potted plant on top: ceramic pot and a loose cluster of leaves.
  k.f('ceramic', potGeo(0.075, 0.06, 0.13), -0.2, H, 0);
  const lr = rng(7);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * PI * 2 + lr() * 0.4, tilt = -0.35 - lr() * 0.5;
    const leaf = k.f(i % 2 ? 'leaf' : 'leaf2', leafGeo(), -0.2, H + 0.13, 0);
    leaf.scale.setScalar(1.4 + lr() * 0.5);
    leaf.rotation.set(tilt, a, 0, 'YXZ');
  }
  return k.g;
}

// End-of-bed bench: upholstered cushion on a slim wooden frame.
function buildBench(M) {
  const k = kit(M);
  const W = 1.3, D = 0.42, H = 0.45;
  k.s('upholstery', rbox(W, 0.1, D, 0.04), 0, H - 0.05, 0);
  k.s('woodwork', box(W - 0.06, 0.04, D - 0.06), 0, H - 0.12, 0);
  const lx = W / 2 - 0.08, lz = D / 2 - 0.06;
  [[-lx, -lz], [-lx, lz], [lx, -lz], [lx, lz]].forEach(([x, z]) => woodLeg(k, x, z, H - 0.14, 0.022, 0.016));
  k.s('woodwork', box(2 * lx, 0.025, 0.025), 0, 0.1, 0);
  k.s('woodwork', box(0.025, 0.025, 2 * lz), -lx, 0.1, 0);
  k.s('woodwork', box(0.025, 0.025, 2 * lz), lx, 0.1, 0);
  return k.g;
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export const FURNITURE = {
  sofa: { name: '沙发', w: 2.6, d: 1.6, h: 0.85, build: buildSofa },
  armchair: { name: '扶手椅', w: 0.78, d: 0.82, h: 0.86, build: buildArmchair },
  coffee: { name: '茶几', w: 0.95, d: 0.95, h: 0.4, build: buildCoffee },
  pouf: { name: '坐墩', w: 0.5, d: 0.5, h: 0.42, build: buildPouf },
  floorlamp: { name: '落地灯', w: 0.45, d: 0.45, h: 1.6, lamp: true, build: buildFloorlamp },
  arclamp: { name: '弧形落地灯', w: 0.4, d: 0.4, h: 2.1, lamp: true, build: buildArclamp },
  sidelamp: { name: '边几台灯', w: 0.45, d: 0.45, h: 0.9, lamp: true, build: buildSidelamp },
  side: { name: '边几', w: 0.45, d: 0.45, h: 0.5, build: buildSide },
  plant: { name: '琴叶榕', w: 0.5, d: 0.5, h: 1.8, build: buildPlant },
  plant2: { name: '虎尾兰', w: 0.5, d: 0.5, h: 1.2, build: buildPlant2 },
  sideboard: { name: '矮柜', w: 1.8, d: 0.45, h: 0.6, build: buildSideboard },
  rug: { name: '地毯', w: 2.4, d: 1.7, h: 0.015, flat: true, build: buildRug },
  dining: { name: '餐桌', w: 1.6, d: 0.9, h: 0.75, build: buildDining },
  chair: { name: '餐椅', w: 0.46, d: 0.5, h: 0.82, build: buildChair },
  bed: { name: '床', w: 1.75, d: 2.15, h: 1.05, build: buildBed },
  nightstand: { name: '床头柜', w: 0.5, d: 0.42, h: 0.55, lamp: true, build: buildNightstand },
  wardrobe: { name: '衣柜', w: 1.2, d: 0.6, h: 2.1, build: buildWardrobe },
  desk: { name: '书桌', w: 1.4, d: 0.7, h: 0.75, lamp: true, build: buildDesk },
  deskchair: { name: '办公椅', w: 0.6, d: 0.6, h: 1.0, build: buildDeskchair },
  bookshelf: { name: '书架', w: 0.9, d: 0.36, h: 1.36, build: buildBookshelf },
  bench: { name: '床尾凳', w: 1.3, d: 0.42, h: 0.45, build: buildBench },
};

export const FURNITURE_ORDER = [
  'sofa', 'armchair', 'coffee', 'side', 'sidelamp', 'pouf', 'rug', 'floorlamp', 'arclamp', 'plant', 'plant2', 'sideboard',
  'dining', 'chair', 'bed', 'nightstand', 'bench', 'wardrobe', 'desk', 'deskchair', 'bookshelf',
];
