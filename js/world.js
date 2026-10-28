import * as THREE from "three";
import {
  islandMask,
  terrainHeight,
  noise,
  pathDistance,
  bridgeDistance,
  WATER,
  LEVEL,
  createNav,
  mulberry32,
} from "./geo.js";
import { lambert } from "./art.js";

const GRASS_A = new THREE.Color(0x7eaa5c);
const GRASS_B = new THREE.Color(0x5f8f46);
const GRASS_C = new THREE.Color(0x8fb56a);
const DIRT = new THREE.Color(0xc4a574);
const SAND = new THREE.Color(0xd2c09a);
const STONE = new THREE.Color(0xb7aa96);
const CLIFF = new THREE.Color(0x6e6256);
const MOSS = new THREE.Color(0x6d9a62);
const WOOD = new THREE.Color(0x8a6244);

function shade(color, x, z, n) {
  const c = color.clone();
  c.multiplyScalar(0.9 + n * 0.16);
  c.r += (noise(x * 0.31 + 8, z * 0.27) - 0.5) * 0.04;
  return c;
}

function topColor(x, z, h, slope) {
  const n = noise(x * 0.04, z * 0.04);
  const n2 = noise(x * 0.09 + 5, z * 0.09);
  const base = GRASS_B.clone();
  base.lerp(GRASS_A, n);
  base.lerp(GRASS_C, n2 * 0.45);
  if (Math.hypot(x + 50, z - 10) < 14 || Math.hypot(x - 50, z + 10) < 14) base.lerp(GRASS_C, 0.25);
  if (h > 5.15) base.lerp(STONE, Math.min(1, (h - 5.15) * 0.7)).lerp(MOSS, 0.12);
  if (h < WATER + 0.05) base.lerp(new THREE.Color(0x1c6c70), 0.88);
  else if (h < 1.25) base.lerp(SAND, Math.min(1, (1.25 - h) * 0.85));
  if (slope > 0.42) base.lerp(CLIFF, Math.min(1, (slope - 0.42) * 1.35));
  const pd = pathDistance(x, z);
  if (pd < 4.4) base.lerp(DIRT, (1 - pd / 4.4) * 0.58);
  if (bridgeDistance(x, z) < 0.9) base.lerp(WOOD, 0.7);
  return shade(base, x, z, n2);
}

export function buildWorld(scene) {
  const env = new THREE.Group();
  scene.add(env);
  const solids = [];
  const platforms = LEVEL.stones.map((s) => ({ ...s, active: false, mesh: null }));

  const terrain = buildIsland();
  terrain.receiveShadow = true;
  env.add(terrain);

  const { mesh: water, mat: waterMat } = buildWater();
  env.add(water);

  const decor = new THREE.Group();
  env.add(decor);
  scatterNature(decor, solids);
  buildRuins(decor, solids);
  buildBridge(decor);
  buildWaterfall(decor);
  buildVoidIslets(decor);
  const grass = buildGrass();
  env.add(grass.mesh);
  const flowers = buildFlowers();
  env.add(flowers);

  for (const p of platforms) {
    // mesh attached later by sim so it can toggle; placeholder height is enough for nav
  }

  const nav = createNav();

  return {
    env,
    terrain,
    waterMat,
    grass,
    solids,
    platforms,
    nav,
    fallMat: decor.userData.fallMat,
    rebuildNav() {
      nav.rebuild(solids, platforms);
    },
  };
}

function buildIsland() {
  const SEG = 176;
  const HALF = 96;
  const stride = SEG + 1;
  const maskG = new Float32Array(stride * stride);
  const heightG = new Float32Array(stride * stride);
  const inside = new Uint8Array(stride * stride);
  const positions = [];
  const colors = [];
  const indices = [];
  const vTop = new Int32Array(stride * stride).fill(-1);
  const vBot = new Int32Array(stride * stride).fill(-1);

  function xz(i, j) {
    return [-HALF + (i / SEG) * HALF * 2, -HALF + (j / SEG) * HALF * 2];
  }

  for (let j = 0; j <= SEG; j++) {
    for (let i = 0; i <= SEG; i++) {
      const [x, z] = xz(i, j);
      const m = islandMask(x, z);
      const id = j * stride + i;
      maskG[id] = m;
      inside[id] = m > 0.55 ? 1 : 0;
      heightG[id] = m > -0.4 ? terrainHeight(x, z) : -8;
    }
  }

  function drawn(i, j) {
    if (i < 0 || j < 0 || i >= SEG || j >= SEG) return false;
    const s = stride;
    return inside[j * s + i] && inside[j * s + i + 1] && inside[(j + 1) * s + i] && inside[(j + 1) * s + i + 1];
  }

  function slopeAt(i, j) {
    const h = heightG[j * stride + i];
    const e = HALF * 2 / SEG;
    const hx = i < SEG ? heightG[j * stride + i + 1] : h;
    const hz = j < SEG ? heightG[(j + 1) * stride + i] : h;
    return Math.hypot(hx - h, hz - h) / e;
  }

  function vert(x, y, z, col) {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    colors.push(col.r, col.g, col.b);
    return idx;
  }

  function isRim(i, j) {
    const cells = [
      [i - 1, j - 1],
      [i, j - 1],
      [i - 1, j],
      [i, j],
    ];
    let land = 0;
    let seen = 0;
    for (const [ci, cj] of cells) {
      seen++;
      if (ci < 0 || cj < 0 || ci >= SEG || cj >= SEG) continue;
      if (drawn(ci, cj)) land++;
    }
    return land > 0 && land < seen;
  }

  function coastXZ(i, j) {
    const [x, z] = xz(i, j);
    if (!isRim(i, j)) return [x, z];
    const len = Math.hypot(x, z) || 1;
    const n = noise(x * 0.06 + 1.7, z * 0.06) - 0.35;
    const push = n * 5.4;
    return [x + (x / len) * push, z + (z / len) * push];
  }

  function topVert(i, j) {
    const id = j * stride + i;
    if (vTop[id] !== -1) return vTop[id];
    const [x, z] = coastXZ(i, j);
    const h = heightG[id];
    const col = topColor(x, z, h, slopeAt(i, j));
    vTop[id] = vert(x, h, z, col);
    return vTop[id];
  }

  function botVert(i, j) {
    const id = j * stride + i;
    if (vBot[id] !== -1) return vBot[id];
    const [x, z] = xz(i, j);
    const yb = -6.2 + (noise(x * 0.05, z * 0.05) - 0.5) * 0.85;
    const under = new THREE.Color(0x3a332c).multiplyScalar(0.82 + noise(x * 0.07, z * 0.07) * 0.28);
    vBot[id] = vert(x, yb, z, under);
    return vBot[id];
  }

  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      if (!drawn(i, j)) continue;
      const a = topVert(i, j);
      const b = topVert(i + 1, j);
      const c = topVert(i + 1, j + 1);
      const d = topVert(i, j + 1);
      indices.push(a, b, d, b, c, d);
      const a2 = botVert(i, j);
      const b2 = botVert(i + 1, j);
      const c2 = botVert(i + 1, j + 1);
      const d2 = botVert(i, j + 1);
      indices.push(a2, d2, b2, b2, d2, c2);
    }
  }

  const skirtCols = [
    new THREE.Color(0x6f8a58),
    new THREE.Color(0x8d7d6a),
    new THREE.Color(0x5a4e44),
    new THREE.Color(0x2c2622),
  ];
  function skirtEdge(i0, j0, i1, j1) {
    const [cx0, cz0] = coastXZ(i0, j0);
    const [cx1, cz1] = coastXZ(i1, j1);
    const [gx0, gz0] = xz(i0, j0);
    const [gx1, gz1] = xz(i1, j1);
    const h0 = heightG[j0 * stride + i0];
    const h1 = heightG[j1 * stride + i1];
    const bands = 3;
    const row = (t, cx, cz, gx, gz, h) => {
      const len = Math.hypot(gx, gz) || 1;
      const n = noise(gx * 0.09 + t * 4.2, gz * 0.09) - 0.5;
      const bulge = Math.sin(t * Math.PI) * (1.15 + n * 0.85);
      const x = cx + (gx - cx) * t + (gx / len) * bulge;
      const z = cz + (gz - cz) * t + (gz / len) * bulge;
      return { x, y: h + (-6.55 + n * 0.7 - h) * t, z };
    };
    let p0 = { x: cx0, y: h0, z: cz0 };
    let p1 = { x: cx1, y: h1, z: cz1 };
    for (let b = 0; b < bands; b++) {
      const t = (b + 1) / bands;
      const q0 = row(t, cx0, cz0, gx0, gz0, h0);
      const q1 = row(t, cx1, cz1, gx1, gz1, h1);
      const ca = skirtCols[b];
      const cb = skirtCols[b + 1];
      const a = vert(p0.x, p0.y, p0.z, ca);
      const bv = vert(p1.x, p1.y, p1.z, ca);
      const c = vert(q1.x, q1.y, q1.z, cb);
      const d = vert(q0.x, q0.y, q0.z, cb);
      indices.push(a, bv, d, bv, c, d);
      p0 = q0;
      p1 = q1;
    }
  }

  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      if (!drawn(i, j)) continue;
      if (!drawn(i, j - 1)) skirtEdge(i, j, i + 1, j);
      if (!drawn(i, j + 1)) skirtEdge(i + 1, j + 1, i, j + 1);
      if (!drawn(i - 1, j)) skirtEdge(i, j + 1, i, j);
      if (!drawn(i + 1, j)) skirtEdge(i + 1, j, i + 1, j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(indices), 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  // Hanging roots under the rim.
  const rng = mulberry32(11);
  const rootMat = lambert(0x4a3d34);
  for (let n = 0; n < 28; n++) {
    const a = rng() * Math.PI * 2;
    const rad = 48 + rng() * 18;
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad * 0.95;
    if (islandMask(x, z) < 1.2) continue;
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.18 + rng() * 0.2, 1.4 + rng() * 1.6, 4), rootMat);
    root.position.set(x, -6.3 - rng() * 0.4, z);
    root.rotation.x = Math.PI;
    mesh.add(root);
  }
  return mesh;
}

function buildWater() {
  const SEG = 90;
  const HALF = 70;
  const positions = [];
  const indices = [];
  function xz(i, j) {
    return [-HALF + (i / SEG) * HALF * 2, -HALF + (j / SEG) * HALF * 2];
  }
  const vert = [];
  for (let j = 0; j <= SEG; j++) {
    for (let i = 0; i <= SEG; i++) {
      const [x, z] = xz(i, j);
      const h = terrainHeight(x, z);
      const wet = islandMask(x, z) > 0.6 && h < WATER + 0.35;
      vert.push(wet ? 1 : 0);
      positions.push(x, WATER, z);
    }
  }
  const stride = SEG + 1;
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * stride + i;
      if (!vert[a] || !vert[a + 1] || !vert[a + stride] || !vert[a + stride + 1]) continue;
      indices.push(a, a + 1, a + stride);
      indices.push(a + 1, a + stride + 1, a + stride);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.translate(0, 0.045, 0);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x3ad4c4,
    emissive: 0x0e6e68,
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float ripple = sin(position.x * 1.6 + uTime * 1.35) * cos(position.z * 1.45 - uTime * 1.05);
       transformed.y += ripple * 0.04;`
    );
    shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
    mat.userData.shader = shader;
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  addLilies(mesh);
  return { mesh, mat };
}

function addLilies(parent) {
  const padMat = lambert(0x3c8f46);
  const padGeo = new THREE.CircleGeometry(0.42, 6);
  padGeo.rotateX(-Math.PI / 2);
  const reedMat = lambert(0x6ea85a);
  const reedGeo = new THREE.ConeGeometry(0.05, 0.7, 3);
  const rng = mulberry32(3);
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 1.8 + rng() * 4.8;
    const x = 16 + Math.cos(a) * rad;
    const z = 46.2 + Math.sin(a) * rad * 0.82;
    if (terrainHeight(x, z) > WATER - 0.08) continue;
    if (Math.hypot(x - 16.2, z - 50.4) < 2.7) continue;
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(x, WATER + 0.08, z);
    pad.rotation.y = rng() * 6;
    pad.scale.setScalar(0.7 + rng() * 0.6);
    parent.add(pad);
  }
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 5.2 + rng() * 2.4;
    const x = 16 + Math.cos(a) * rad;
    const z = 46 + Math.sin(a) * rad * 0.9;
    if (terrainHeight(x, z) < WATER - 0.15 || terrainHeight(x, z) > WATER + 0.35) continue;
    const reed = new THREE.Mesh(reedGeo, reedMat);
    reed.position.set(x, terrainHeight(x, z) + 0.32, z);
    reed.rotation.z = (rng() - 0.5) * 0.3;
    parent.add(reed);
  }
}

function scatterNature(decor, solids) {
  const rng = mulberry32(42);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 5);
  const leafGeo = new THREE.IcosahedronGeometry(0.7, 0);
  const coneGeo = new THREE.ConeGeometry(0.75, 1.3, 5);
  const leafMats = [lambert(0x3e7a45), lambert(0x2f6844), lambert(0x6a9a42), lambert(0x4d8a52)];
  const trunkMat = lambert(0x7a5340);
  let trees = 0;
  let tries = 0;
  while (trees < 78 && tries < 2000) {
    tries++;
    const x = (rng() * 2 - 1) * 70;
    const z = (rng() * 2 - 1) * 62;
    if (islandMask(x, z) < 2.4) continue;
    const h = terrainHeight(x, z);
    if (h < WATER + 0.3 || h > 5.7) continue;
    if (pathDistance(x, z) < 3.5) continue;
    if (Math.hypot(x + 50, z - 10) < 9 || Math.hypot(x - 50, z + 10) < 9) continue;
    if (Math.hypot(x, z + 2) < 9) continue;
    let near = false;
    for (const s of solids) {
      if (Math.hypot(s.x - x, s.z - z) < 3.2) near = true;
    }
    if (near) continue;
    const g = new THREE.Group();
    const s = 0.85 + rng() * 0.85;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const th = 0.7 + rng() * 0.55;
    trunk.scale.set(s, th, s);
    trunk.position.y = th * 0.5;
    trunk.castShadow = true;
    g.add(trunk);
    const style = rng();
    const mat = leafMats[(rng() * leafMats.length) | 0];
    if (style < 0.45) {
      for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(leafGeo, mat);
        f.position.set((rng() - 0.5) * 0.2, th + 0.15 + i * 0.38 * s, (rng() - 0.5) * 0.2);
        f.scale.setScalar(s * (1.15 - i * 0.22));
        f.castShadow = true;
        g.add(f);
      }
    } else {
      const f = new THREE.Mesh(coneGeo, mat);
      f.position.y = th + 0.45 * s;
      f.scale.setScalar(s * 1.15);
      f.castShadow = true;
      const f2 = new THREE.Mesh(coneGeo, leafMats[(rng() * leafMats.length) | 0]);
      f2.position.y = th + 0.95 * s;
      f2.scale.setScalar(s * 0.75);
      f2.castShadow = true;
      g.add(f, f2);
    }
    g.position.set(x, h, z);
    g.rotation.y = rng() * Math.PI * 2;
    decor.add(g);
    solids.push({ x, z, r: 0.55 * s, active: true, kind: "tree" });
    trees++;
  }

  const rockGeo = new THREE.DodecahedronGeometry(0.45, 0);
  const rockMat = lambert(0x9a9084);
  const mossMat = lambert(0x6d9454);
  let rocks = 0;
  tries = 0;
  while (rocks < 46 && tries < 1500) {
    tries++;
    const x = (rng() * 2 - 1) * 68;
    const z = (rng() * 2 - 1) * 60;
    if (islandMask(x, z) < 2) continue;
    const h = terrainHeight(x, z);
    if (h < WATER + 0.2) continue;
    if (pathDistance(x, z) < 2.8) continue;
    if (Math.hypot(x, z + 2) < 7) continue;
    const rock = new THREE.Mesh(rockGeo, rng() > 0.7 ? mossMat : rockMat);
    const sc = 0.45 + rng() * 0.9;
    rock.scale.set(sc * (0.8 + rng() * 0.4), sc * 0.7, sc);
    rock.position.set(x, h + sc * 0.25, z);
    rock.rotation.set(rng(), rng() * 3, rng());
    rock.castShadow = true;
    rock.receiveShadow = true;
    decor.add(rock);
    if (sc > 0.7) solids.push({ x, z, r: sc * 0.55, active: true, kind: "rock" });
    rocks++;
  }

  // Mushrooms and tiny flowers as individual clusters near forests.
  const capMat = lambert(0xc46b4a);
  const stemMat = lambert(0xefe6d4);
  for (let i = 0; i < 40; i++) {
    const x = (rng() * 2 - 1) * 60;
    const z = (rng() * 2 - 1) * 54;
    if (islandMask(x, z) < 2.2) continue;
    const h = terrainHeight(x, z);
    if (h < WATER + 0.4 || pathDistance(x, z) < 1.6) continue;
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 5), stemMat);
    stem.position.y = 0.06;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), rng() > 0.5 ? capMat : lambert(0xd8c07a));
    cap.position.y = 0.12;
    cap.scale.y = 0.45;
    g.add(stem, cap);
    g.position.set(x, h, z);
    decor.add(g);
  }
}

function makeTuft() {
  const parts = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.ConeGeometry(0.07, 0.3, 3);
    g.translate(0, 0.15, 0);
    const ang = i * 2.15;
    g.rotateY(ang);
    g.translate(Math.cos(ang) * 0.05, 0, Math.sin(ang) * 0.05);
    parts.push(g);
  }
  let verts = 0;
  for (const p of parts) verts += p.attributes.position.count;
  const pos = new Float32Array(verts * 3);
  const idx = [];
  let base = 0;
  let offset = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, offset);
    const n = p.attributes.position.count;
    offset += n * 3;
    for (let k = 0; k < p.index.count; k++) idx.push(p.index.getX(k) + base);
    base += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildGrass() {
  const rng = mulberry32(7);
  const geo = makeTuft();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false, color: 0xffffff, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float tip = smoothstep(0.05, 0.22, position.y);
       float sway = sin(uTime * 1.5 + instanceMatrix[3].x * 0.65 + instanceMatrix[3].z * 0.45);
       transformed.x += sway * tip * 0.1;
       transformed.z += cos(uTime * 1.2 + instanceMatrix[3].z) * tip * 0.06;`
    );
    mat.userData.shader = shader;
  };
  const count = 3800;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  let n = 0;
  let tries = 0;
  while (n < count && tries < 40000) {
    tries++;
    const roll = rng();
    let x;
    let z;
    if (roll < 0.08) {
      x = -50 + (rng() * 2 - 1) * 18;
      z = 10 + (rng() * 2 - 1) * 16;
    } else if (roll < 0.16) {
      x = 50 + (rng() * 2 - 1) * 18;
      z = -10 + (rng() * 2 - 1) * 16;
    } else {
      x = (rng() * 2 - 1) * 72;
      z = (rng() * 2 - 1) * 64;
    }
    if (islandMask(x, z) < 1.4) continue;
    const h = terrainHeight(x, z);
    if (h < WATER + 0.15) continue;
    dummy.position.set(x, h, z);
    dummy.rotation.y = rng() * Math.PI;
    const s = 0.7 + rng() * 0.8;
    dummy.scale.set(s, 0.75 + rng() * 0.9, s);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    col.set(rng() > 0.5 ? 0x7aaa56 : 0x98c06a);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

function buildFlowers() {
  const rng = mulberry32(99);
  const geo = new THREE.ConeGeometry(0.06, 0.16, 4);
  geo.translate(0, 0.08, 0);
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const count = 420;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const palette = [0xe07a62, 0xf0d48a, 0xf4f0e4, 0x7eb8d4, 0xd46a8a];
  let n = 0;
  let tries = 0;
  while (n < count && tries < 5000) {
    tries++;
    const x = (rng() * 2 - 1) * 68;
    const z = (rng() * 2 - 1) * 60;
    if (islandMask(x, z) < 1.8) continue;
    const h = terrainHeight(x, z);
    if (h < WATER + 0.25 || h > 6) continue;
    if (pathDistance(x, z) < 1.2) continue;
    dummy.position.set(x, h, z);
    dummy.rotation.y = rng() * 6;
    dummy.scale.setScalar(0.8 + rng() * 0.7);
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    col.set(palette[(rng() * palette.length) | 0]);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

function buildRuins(decor, solids) {
  const stone = lambert(0xb3a894);
  const dark = lambert(0x8d8274);
  const moss = lambert(0x6e9458);
  for (const w of LEVEL.walls) {
    const h = terrainHeight(w.x, w.z);
    const tall = 0.8 + ((Math.abs(w.x * 3 + w.z) % 5) / 5) * 1.1;
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(w.r * 1.3, tall, w.r * 1.3), (w.x + w.z) % 2 > 0 ? stone : dark);
    pillar.position.set(w.x, h + tall / 2, w.z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    if (tall > 1.2) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w.r * 1.7, 0.16, w.r * 1.7), stone);
      cap.position.y = tall / 2 + 0.05;
      cap.rotation.y = 0.2;
      pillar.add(cap);
    }
    if (Math.abs(w.x) < 8) {
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), moss);
      tuft.position.set(0.1, tall / 2, 0.15);
      tuft.scale.y = 0.45;
      pillar.add(tuft);
    }
    decor.add(pillar);
    solids.push({ x: w.x, z: w.z, r: w.r, active: true, kind: "wall" });
  }
  // Broken arch in the ruins.
  const baseH = terrainHeight(-32, 30);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.8, 0.4), stone);
    p.position.set(-32 + side * 1.3, baseH + 0.9, 27.2);
    p.castShadow = true;
    decor.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.28, 0.45), dark);
  lintel.position.set(-32, baseH + 1.85, 27.2);
  lintel.rotation.z = -0.08;
  lintel.castShadow = true;
  decor.add(lintel);
  // Toppled column.
  const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6), stone);
  fallen.rotation.z = Math.PI / 2;
  fallen.position.set(-26, terrainHeight(-26, 33) + 0.22, 33);
  fallen.castShadow = true;
  decor.add(fallen);
}

function buildBridge(decor) {
  const wood = lambert(0x8d6244);
  const dark = lambert(0x6a4632);
  const y = terrainHeight(18, -9) ;
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = 22 + (14 - 22) * t;
    const z = -12 + (-6 - -12) * t;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 1.15), i % 2 ? wood : dark);
    plank.position.set(x, terrainHeight(x, z) + 0.12, z);
    plank.rotation.y = Math.atan2(-6 - -12, 14 - 22);
    plank.castShadow = true;
    plank.receiveShadow = true;
    g.add(plank);
  }
  for (const side of [-0.55, 0.55]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.08, 0.08), dark);
    rail.position.set(18, y + 0.45, -9 + side);
    rail.rotation.y = Math.atan2(-6 - -12, 14 - 22);
    g.add(rail);
  }
  decor.add(g);
}

function buildWaterfall(decor) {
  const rockMat = lambert(0x7d7468);
  const h = terrainHeight(18, -46);
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), rockMat);
    r.position.set(16 + i * 0.7, h + 0.4 + i * 0.15, -47.5 + i * 0.2);
    r.scale.set(1.2, 0.7, 1);
    r.castShadow = true;
    decor.add(r);
  }
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xd7f4f2) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main(){
        float streak = smoothstep(0.35, 1.0, fract(vUv.y * 3.0 - uTime * 0.7));
        float alpha = (0.25 + streak * 0.35) * smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), mat);
  sheet.position.set(18.2, h + 0.7, -46.2);
  decor.add(sheet);
  decor.userData.fallMat = mat;
}

function buildVoidIslets(decor) {
  const mat = lambert(0x5c564e);
  const moss = lambert(0x4e6a40);
  const spots = [
    [78, 8, 18],
    [-84, -6, -30],
    [20, 6, 86],
    [-30, 10, -82],
    [90, -2, 40],
  ];
  for (const [x, y, z] of spots) {
    const g = new THREE.Group();
    const a = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), mat);
    a.scale.y = 0.45;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), moss);
    b.position.set(0.8, 0.7, 0.4);
    g.add(a, b);
    g.position.set(x, y, z);
    decor.add(g);
  }
}

export function createSky() {
  const geo = new THREE.SphereGeometry(220, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: `
      varying vec3 vP;
      void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      varying vec3 vP;
      void main(){
        float h = normalize(vP).y;
        vec3 zenith = vec3(0.45, 0.68, 0.84);
        vec3 horizon = vec3(0.98, 0.86, 0.7);
        vec3 nadir = vec3(0.05, 0.07, 0.1);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.5, h));
        col = mix(nadir, col, smoothstep(-0.35, 0.08, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}
