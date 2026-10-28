// Terrain, navigation and the hand-authored island layout.
// Pure data + math so navigation can be tested without WebGL.

export const WATER = 0.82;
export const MATCH_DURATION = 7 * 60;
export const SCORE_LIMIT = 480;
export const THROW_RANGE = 16;
export const WHISTLE_RADIUS = 10.5;

const TAU = Math.PI * 2;

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hash2(ix, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function noise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash2(x0, z0);
  const n10 = hash2(x0 + 1, z0);
  const n01 = hash2(x0, z0 + 1);
  const n11 = hash2(x0 + 1, z0 + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sz);
}

function fbm(x, z) {
  let a = 0;
  let f = 1;
  let w = 0.5;
  for (let i = 0; i < 4; i++) {
    a += noise(x * f, z * f) * w;
    f *= 2.05;
    w *= 0.5;
  }
  return a;
}

export function islandMask(x, z) {
  const ang = Math.atan2(z, x);
  let rad = 76;
  rad += Math.sin(ang * 2 + 0.45) * 7.2;
  rad += Math.sin(ang * 3 - 0.7) * 4.4;
  rad += Math.sin(ang * 5 + 1.05) * 2.6;
  rad += Math.cos(ang * 7 - 0.35) * 1.5;
  rad += (fbm(x * 0.028 + 2, z * 0.028) - 0.45) * 6.5;
  const r = Math.hypot(x * 0.99, z * 1.035);
  let m = rad - r;
  // Guarantee the camps, the pond lobe and the waterfall shelf exist.
  m = Math.max(m, 4.2 - Math.hypot(x + 50, z - 10) * 0.42);
  m = Math.max(m, 4.2 - Math.hypot(x - 50, z + 10) * 0.42);
  m = Math.max(m, 3.4 - Math.hypot(x - 16, z - 46) * 0.38);
  m = Math.max(m, 3.2 - Math.hypot(x - 18, z + 44) * 0.4);
  m = Math.max(m, 3.0 - Math.hypot(x + 32, z - 30) * 0.36);
  return m;
}

function flattenDisk(h, x, z, cx, cz, radius, ramp, flatH) {
  const d = Math.hypot(x - cx, z - cz);
  if (d >= radius + ramp) return h;
  if (d <= radius) return flatH;
  const t = smoothstep(radius, radius + ramp, d);
  return lerp(flatH, h, t);
}

function applyPlateau(h, x, z) {
  const dx = x;
  const dz = z + 2;
  const rx = 15.5;
  const rz = 13.5;
  const d = Math.hypot(dx / rx, dz / rz);
  const south = clamp(dz / 12, 0, 1);
  const ramp = lerp(0.62, 0.16, south);
  if (d >= 1 + ramp) return h;
  const top = 6.25 + (noise(x * 0.2, z * 0.2) - 0.5) * 0.12;
  if (d <= 1) return top;
  const t = smoothstep(1, 1 + ramp, d);
  return lerp(top, h, t);
}

const RIVER = [
  [18, -46],
  [16, -30],
  [15, -14],
  [14, 0],
  [14, 16],
  [15, 30],
  [16, 46],
];

function polyDist(x, z, pts) {
  let best = 1e9;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const abx = bx - ax;
    const abz = bz - az;
    const l2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - ax) * abx + (z - az) * abz) / l2;
    t = clamp(t, 0, 1);
    const cx = ax + abx * t;
    const cz = az + abz * t;
    const d = Math.hypot(x - cx, z - cz);
    if (d < best) best = d;
  }
  return best;
}

function carveRiver(h, x, z) {
  const d = polyDist(x, z, RIVER);
  const width = 5.4;
  if (d >= width) return h;
  if (h > 4.6) return h;
  const t = smoothstep(width, 1.3, d);
  const bed = 0.28 + d * 0.035;
  return lerp(h, Math.min(h, bed), t);
}

// Walkable corridors. Heights are explicit so routes stay gentle.
export const PATHS = [
  {
    id: "west-ramp",
    w: 4.4,
    pts: [[-48, 8], [-36, 5], [-24, 2], [-14, -1], [-6, -2], [0, -2]],
    hs: [1.58, 1.75, 2.45, 3.85, 5.25, 6.22],
  },
  {
    id: "north-loop",
    w: 3.8,
    pts: [[-48, 8], [-40, -4], [-28, -16], [-16, -28], [-4, -38], [0, -42], [12, -36], [6, -22], [2, -12], [0, -2]],
    hs: [1.58, 1.85, 2.15, 2.4, 2.55, 2.6, 2.75, 3.7, 5.0, 6.22],
  },
  {
    id: "to-ruins",
    w: 4.0,
    pts: [[-48, 8], [-42, 16], [-36, 24], [-32, 30], [-24, 34]],
    hs: [1.58, 1.9, 2.35, 2.8, 2.95],
  },
  {
    id: "ruins-plateau",
    w: 3.6,
    pts: [[-24, 34], [-14, 24], [-7, 14], [-2, 6], [0, -2]],
    hs: [2.95, 3.25, 4.05, 5.15, 6.22],
  },
  {
    id: "east-ramp",
    w: 4.2,
    pts: [[48, -8], [36, -10], [24, -10], [16, -7], [8, -4], [0, -2]],
    hs: [1.62, 1.8, 2.35, 3.7, 5.05, 6.22],
  },
  {
    id: "to-cave",
    w: 3.6,
    pts: [[48, -8], [40, -16], [34, -26], [30, -32]],
    hs: [1.62, 1.9, 2.2, 2.35],
  },
  {
    id: "cave-north",
    w: 3.4,
    pts: [[30, -32], [18, -38], [8, -42], [0, -42]],
    hs: [2.35, 2.45, 2.55, 2.6],
  },
  {
    id: "south-west",
    w: 3.5,
    pts: [[-24, 34], [-12, 40], [0, 38], [8, 34]],
    hs: [2.95, 2.2, 1.7, 1.45],
  },
  {
    id: "south-east",
    w: 3.5,
    pts: [[28, 34], [36, 22], [44, 6], [48, -8]],
    hs: [1.55, 1.6, 1.62, 1.62],
  },
  {
    id: "shortcut-west",
    w: 2.8,
    pts: [[-40, -4], [-32, -2], [-26, 2]],
    hs: [1.85, 2.05, 2.4],
  },
];

const BRIDGES = [
  // East ramp crosses the river. Treated as deck for coloring.
  { ax: 22, az: -12, bx: 14, bz: -6, w: 3.4 },
];

function pathQuery(x, z) {
  let bestH = 0;
  let bestI = 0;
  let bestD = 1e9;
  for (const path of PATHS) {
    const pts = path.pts;
    const hs = path.hs;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const bx = pts[i + 1][0];
      const bz = pts[i + 1][1];
      const abx = bx - ax;
      const abz = bz - az;
      const l2 = abx * abx + abz * abz || 1e-6;
      let t = ((x - ax) * abx + (z - az) * abz) / l2;
      t = clamp(t, 0, 1);
      const cx = ax + abx * t;
      const cz = az + abz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < path.w && d < bestD) {
        // Influence stored separately; keep nearest for height.
      }
      if (d < path.w) {
        const influence = smoothstep(path.w, path.w * 0.25, d);
        if (influence > bestI) {
          bestI = influence;
          bestH = lerp(hs[i], hs[i + 1], t);
          bestD = d;
        }
      }
    }
  }
  return { influence: bestI, h: bestH, d: bestD };
}

export function pathDistance(x, z) {
  let best = 1e9;
  for (const path of PATHS) {
    const d = polyDist(x, z, path.pts);
    if (d < best) best = d;
  }
  return best;
}

export function bridgeDistance(x, z) {
  let best = 1e9;
  for (const b of BRIDGES) {
    const abx = b.bx - b.ax;
    const abz = b.bz - b.az;
    const l2 = abx * abx + abz * abz || 1e-6;
    let t = ((x - b.ax) * abx + (z - b.az) * abz) / l2;
    t = clamp(t, 0, 1);
    const cx = b.ax + abx * t;
    const cz = b.az + abz * t;
    best = Math.min(best, Math.hypot(x - cx, z - cz) - b.w);
  }
  return best;
}

export function terrainHeight(x, z) {
  const m = islandMask(x, z);
  if (m < -6) return -8;

  let h = 2.05;
  h += (fbm(x * 0.045, z * 0.045) - 0.5) * 0.7;
  h += (noise(x * 0.12 + 3, z * 0.12) - 0.5) * 0.28;

  h = applyPlateau(h, x, z);
  h = flattenDisk(h, x, z, -50, 10, 8.2, 5.5, 1.58);
  h = flattenDisk(h, x, z, 50, -10, 8.2, 5.5, 1.64);
  h = flattenDisk(h, x, z, -32, 30, 7.2, 4.6, 2.9);
  h = flattenDisk(h, x, z, 0, -42, 7, 4.2, 2.58);
  h = flattenDisk(h, x, z, 34, -30, 6, 4, 2.32);
  h = flattenDisk(h, x, z, 16, 46, 7.4, 4.2, 0.26);
  h = carveRiver(h, x, z);
  // Sandy islet in the pond, reached by stepping stones or a swimming orb.
  h = flattenDisk(h, x, z, 16.2, 50.4, 2.35, 0.85, 1.16);

  const pq = pathQuery(x, z);
  if (pq.influence > 0) h = lerp(h, pq.h, pq.influence);

  return h;
}

export function sampleHeight(x, z, platforms) {
  let h = terrainHeight(x, z);
  if (platforms) {
    for (const p of platforms) {
      if (!p.active) continue;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d <= p.r) h = Math.max(h, p.h);
    }
  }
  return h;
}

export function slopeAt(x, z) {
  const e = 0.8;
  const h0 = terrainHeight(x, z);
  const hx = terrainHeight(x + e, z) - h0;
  const hz = terrainHeight(x, z + e) - h0;
  return Math.hypot(hx, hz) / e;
}

export function isSwimWater(x, z, platforms) {
  if (islandMask(x, z) < 0.8) return false;
  const h = sampleHeight(x, z, platforms);
  return h < WATER - 0.02;
}

export function isWalkable(x, z, mode, solids, platforms) {
  if (islandMask(x, z) < 1.15) return false;
  const h = sampleHeight(x, z, platforms);
  if (h < -1.2) return false;
  let onPlat = false;
  if (platforms) {
    for (const p of platforms) {
      if (!p.active) continue;
      if (Math.hypot(x - p.x, z - p.z) <= p.r) onPlat = true;
    }
  }
  if (!onPlat && h < WATER) {
    if (mode !== "swim") return false;
  }
  if (!onPlat && slopeAt(x, z) > 1.08) return false;
  if (solids) {
    for (const s of solids) {
      if (!s.active) continue;
      const rr = s.r + 0.3;
      if (Math.hypot(x - s.x, z - s.z) < rr) return false;
    }
  }
  return true;
}

class MinHeap {
  constructor() {
    this.a = [];
  }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const tmp = a[p];
      a[p] = a[i];
      a[i] = tmp;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        const tmp = a[s];
        a[s] = a[i];
        a[i] = tmp;
        i = s;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

export function createNav(cols = 86, rows = 86) {
  const cell = 2.05;
  const origin = -88;
  const walk = new Uint8Array(cols * rows);
  const parent = new Int32Array(cols * rows);
  const gScore = new Float32Array(cols * rows);
  const stamp = new Uint32Array(cols * rows);
  let epoch = 1;

  function inb(c, r) {
    return c >= 0 && r >= 0 && c < cols && r < rows;
  }
  function cellOf(x, z) {
    const c = clamp(Math.floor((x - origin) / cell), 0, cols - 1);
    const r = clamp(Math.floor((z - origin) / cell), 0, rows - 1);
    return { c, r, i: r * cols + c };
  }
  function worldOf(i) {
    const c = i % cols;
    const r = (i / cols) | 0;
    return { x: origin + (c + 0.5) * cell, z: origin + (r + 0.5) * cell };
  }

  function rebuild(solids, platforms) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = origin + (c + 0.5) * cell;
        const z = origin + (r + 0.5) * cell;
        const i = r * cols + c;
        const land = isWalkable(x, z, "land", solids, platforms);
        const swim = !land && isWalkable(x, z, "swim", solids, platforms);
        walk[i] = land ? 1 : swim ? 2 : 0;
      }
    }
  }

  function nearestCell(x, z, swim, maxR = 7) {
    const start = cellOf(x, z);
    const allow = (i) => walk[i] === 1 || (swim && walk[i] === 2);
    if (allow(start.i)) return start.i;
    for (let rad = 1; rad <= maxR; rad++) {
      for (let dz = -rad; dz <= rad; dz++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
          const c = start.c + dx;
          const r = start.r + dz;
          if (!inb(c, r)) continue;
          const i = r * cols + c;
          if (allow(i)) return i;
        }
      }
    }
    return -1;
  }

  function lineOk(x0, z0, x1, z1, swim) {
    const dist = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(dist / (cell * 0.65)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = lerp(x0, x1, t);
      const z = lerp(z0, z1, t);
      const i = cellOf(x, z).i;
      if (walk[i] === 0) return false;
      if (walk[i] === 2 && !swim) return false;
    }
    return true;
  }

  function findPath(x0, z0, x1, z1, swim = false) {
    const s = nearestCell(x0, z0, swim, 5);
    const g = nearestCell(x1, z1, swim, 8);
    if (s < 0 || g < 0) return null;
    if (s === g) {
      const w = worldOf(g);
      return [w];
    }
    epoch++;
    if (epoch > 0xfffffff0) {
      stamp.fill(0);
      epoch = 1;
    }
    const heap = new MinHeap();
    gScore[s] = 0;
    stamp[s] = epoch;
    parent[s] = -1;
    const gw = worldOf(g);
    const sw = worldOf(s);
    heap.push({ i: s, g: 0, f: Math.hypot(gw.x - sw.x, gw.z - sw.z) });
    const dirs = [
      [1, 0, 1],
      [-1, 0, 1],
      [0, 1, 1],
      [0, -1, 1],
      [1, 1, 1.414],
      [1, -1, 1.414],
      [-1, 1, 1.414],
      [-1, -1, 1.414],
    ];
    let guard = 0;
    let found = false;
    while (heap.size && guard < 6000) {
      guard++;
      const cur = heap.pop();
      if (!cur) break;
      if (stamp[cur.i] !== epoch) continue;
      if (cur.g > gScore[cur.i] + 1e-3) continue;
      if (cur.i === g) {
        found = true;
        break;
      }
      const c = cur.i % cols;
      const r = (cur.i / cols) | 0;
      for (const [dx, dz, cost] of dirs) {
        const nc = c + dx;
        const nr = r + dz;
        if (!inb(nc, nr)) continue;
        const ni = nr * cols + nc;
        const w = walk[ni];
        if (w === 0) continue;
        if (w === 2 && !swim) continue;
        if (dx !== 0 && dz !== 0) {
          const a = r * cols + (c + dx);
          const b = (r + dz) * cols + c;
          const wa = walk[a];
          const wb = walk[b];
          if (wa === 0 || wb === 0) continue;
          if (!swim && (wa === 2 || wb === 2)) continue;
        }
        const ng = cur.g + cost * cell;
        if (stamp[ni] === epoch && ng >= gScore[ni]) continue;
        stamp[ni] = epoch;
        gScore[ni] = ng;
        parent[ni] = cur.i;
        const ww = worldOf(ni);
        heap.push({ i: ni, g: ng, f: ng + Math.hypot(gw.x - ww.x, gw.z - ww.z) });
      }
    }
    if (!found) return null;
    const raw = [];
    for (let i = g; i !== -1; i = parent[i]) raw.push(worldOf(i));
    raw.reverse();
    if (raw.length <= 2) return raw;
    const smooth = [raw[0]];
    let i = 0;
    while (i < raw.length - 1) {
      let j = raw.length - 1;
      for (; j > i + 1; j--) {
        if (lineOk(raw[i].x, raw[i].z, raw[j].x, raw[j].z, swim)) break;
      }
      smooth.push(raw[j]);
      i = j;
    }
    return smooth;
  }

  function nearestWalkable(x, z, swim, maxR = 8) {
    if (isWalkable(x, z, swim ? "swim" : "land", navSolids, navPlats)) return { x, z };
    const i = nearestCell(x, z, swim, Math.ceil(maxR / cell));
    if (i < 0) return null;
    return worldOf(i);
  }

  let navSolids = null;
  let navPlats = null;
  return {
    cell,
    rebuild(solids, platforms) {
      navSolids = solids;
      navPlats = platforms;
      rebuild(solids, platforms);
    },
    findPath,
    nearestWalkable(x, z, swim = false, maxR = 8) {
      return nearestWalkable(x, z, swim, maxR);
    },
    walkableAtCell(x, z) {
      return walk[cellOf(x, z).i];
    },
  };
}

export const LEVEL = {
  player: { id: "player", name: "Lark", start: [-48, 8], core: [-54, 14] },
  rival: { id: "rival", name: "Vesper", start: [48, -8], core: [54, -14] },
  creatures: [
    { id: "c1", type: "tri", x: -46, z: 13, hide: "bush" },
    { id: "c2", type: "tri", x: -55, z: 6, hide: "log" },
    { id: "c3", type: "tri", x: -44, z: 4, hide: "roots" },
    { id: "c4", type: "sq", x: -52, z: 17, hide: "rock" },
    { id: "c5", type: "orb", x: -42, z: 18, hide: "reeds" },
    { id: "c6", type: "tri", x: 46, z: -14, hide: "bush" },
    { id: "c7", type: "tri", x: 55, z: -5, hide: "log" },
    { id: "c8", type: "tri", x: 44, z: -3, hide: "roots" },
    { id: "c9", type: "sq", x: 52, z: -16, hide: "rock" },
    { id: "c10", type: "orb", x: 43, z: -1, hide: "reeds" },
    { id: "c11", type: "tri", x: -20, z: -26, hide: "bush" },
    { id: "c12", type: "tri", x: 6, z: -40, hide: "bush" },
    { id: "c13", type: "tri", x: -36, z: 26, hide: "bush" },
    { id: "c14", type: "tri", x: -1.4, z: 1.6, hide: "roots" },
    { id: "c15", type: "sq", x: -28, z: 33, hide: "rock" },
    { id: "c16", type: "sq", x: 37.4, z: -33.6, hide: "hole", requires: "boulder-cave" },
    { id: "c17", type: "sq", x: -22, z: 4, hide: "rock" },
    { id: "c18", type: "orb", x: 6, z: 34, hide: "reeds" },
    { id: "c19", type: "orb", x: 12.2, z: -36.4, hide: "hole" },
    { id: "c20", type: "orb", x: 17.3, z: 49.7, hide: "reeds", requires: "mech-pond" },
    { id: "c21", type: "tri", x: -34, z: -1, hide: "bush", requires: "bramble-west" },
    { id: "c22", type: "sq", x: -19.4, z: 17.8, hide: "hole", requires: "boulder-west" },
  ],
  treasures: [
    { id: "t1", kind: "fruit", x: -44, z: 15, value: 12, weight: 1 },
    { id: "t2", kind: "fruit", x: -56, z: 12, value: 12, weight: 1 },
    { id: "t3", kind: "fruit", x: 46, z: -12, value: 12, weight: 1 },
    { id: "t4", kind: "fruit", x: 56, z: -11, value: 12, weight: 1 },
    { id: "t5", kind: "fruit", x: -40, z: 6, value: 16, weight: 1, guard: "nib-w" },
    { id: "t6", kind: "fruit", x: 42, z: -8, value: 16, weight: 1, guard: "nib-e" },
    { id: "t7", kind: "fruit", x: -18, z: -24, value: 14, weight: 1, guard: "nib-n" },
    { id: "t8", kind: "fruit", x: 26, z: -14, value: 18, weight: 1, guard: "nib-m" },
    { id: "t9", kind: "shard", x: 2, z: -39, value: 30, weight: 2, guard: "liz-n" },
    { id: "t10", kind: "shard", x: -16, z: -27, value: 30, weight: 2, guard: "liz-w" },
    { id: "t11", kind: "cup", x: -33, z: 32, value: 40, weight: 2.3, guard: "helm-r" },
    { id: "t12", kind: "idol", x: -22, z: 37, value: 64, weight: 3.4, guard: "helm-i" },
    { id: "t13", kind: "shard", x: -38, z: 22, value: 32, weight: 2 },
    { id: "t14", kind: "crystal", x: 15.2, z: 50.9, value: 56, weight: 2.6, requires: "mech-pond" },
    { id: "t15", kind: "crystal", x: 12.4, z: -39.2, value: 58, weight: 2.6, requires: "mech-fall", guard: "pebble-fall" },
    { id: "t16", kind: "idol", x: 40.2, z: -35.2, value: 66, weight: 3.5, requires: "boulder-cave", guard: "pebble-cave" },
    { id: "t17", kind: "crystal", x: 3, z: 5, value: 44, weight: 2.2, guard: "pebble-plat" },
    { id: "t18", kind: "diadem", x: 0, z: -2, value: 120, weight: 4.8, guard: "menhir" },
    { id: "t19", kind: "fruit", x: -33, z: 0, value: 20, weight: 1, requires: "bramble-west" },
    { id: "t20", kind: "fruit", x: 40.5, z: 4.2, value: 22, weight: 1, requires: "bramble-east" },
  ],
  enemies: [
    { id: "nib-w", kind: "nib", x: -40, z: 7, home: [-40, 7] },
    { id: "nib-e", kind: "nib", x: 42, z: -7, home: [42, -7] },
    { id: "nib-n", kind: "nib", x: -17, z: -23, home: [-17, -23] },
    { id: "nib-m", kind: "nib", x: 25, z: -13, home: [25, -13] },
    { id: "nib-r", kind: "nib", x: -37, z: 28, home: [-37, 28], patrol: [[-37, 28], [-34, 24], [-40, 23]] },
    { id: "liz-n", kind: "lizard", x: 3, z: -37, home: [3, -37], patrol: [[3, -37], [8, -34], [-2, -40], [4, -33]] },
    { id: "liz-w", kind: "lizard", x: -15, z: -26, home: [-15, -26], patrol: [[-15, -26], [-10, -22], [-20, -30]] },
    { id: "liz-p", kind: "lizard", x: 10, z: -30, home: [10, -30], patrol: [[10, -30], [14, -24], [6, -28]] },
    { id: "liz-r", kind: "lizard", x: -8, z: -14, home: [-8, -14], patrol: [[-8, -14], [-4, -10], [-12, -18]] },
    { id: "pebble-plat", kind: "pebble", x: 4, z: 3, home: [4, 3], sleep: true },
    { id: "pebble-cave", kind: "pebble", x: 38, z: -33, home: [38, -33], sleep: true },
    { id: "pebble-west", kind: "pebble", x: -28, z: 3, home: [-28, 3], sleep: true },
    { id: "pebble-fall", kind: "pebble", x: 22, z: -40, home: [22, -40], sleep: true },
    { id: "helm-r", kind: "helm", x: -32, z: 31, home: [-32, 31] },
    { id: "helm-i", kind: "helm", x: -21, z: 36, home: [-21, 36] },
    { id: "helm-s", kind: "helm", x: 10, z: 32, home: [10, 32] },
    { id: "menhir", kind: "menhir", x: 1.2, z: -0.4, home: [1.2, -0.4] },
  ],
  blockers: [
    { id: "bramble-west", kind: "bramble", x: -36.5, z: -2.2, r: 1.7, hp: 28 },
    { id: "bramble-east", kind: "bramble", x: 38, z: 2, r: 1.65, hp: 28 },
    { id: "boulder-west", kind: "boulder", x: -20.5, z: 18.5, r: 1.85, hp: 42 },
    { id: "boulder-cave", kind: "boulder", x: 35.6, z: -33.4, r: 1.75, hp: 46 },
  ],
  mechanisms: [
    { id: "mech-pond", x: 4, z: 33, opens: "stones" },
    { id: "mech-fall", x: 16, z: -40, opens: "cage" },
  ],
  stones: [
    { gate: "stones", x: 10.5, z: 38.6, r: 1.55, h: 1.05 },
    { gate: "stones", x: 11.55, z: 40.15, r: 1.55, h: 1.05 },
    { gate: "stones", x: 12.6, z: 41.7, r: 1.55, h: 1.05 },
    { gate: "stones", x: 13.65, z: 43.25, r: 1.55, h: 1.05 },
    { gate: "stones", x: 14.5, z: 44.85, r: 1.55, h: 1.05 },
    { gate: "stones", x: 15.05, z: 46.45, r: 1.55, h: 1.06 },
  ],
  // Hand-placed permanent solids (ruin walls, large rocks). Kept off path centers.
  walls: [
    { x: -40, z: 30, r: 1.15 },
    { x: -38, z: 34, r: 1.05 },
    { x: -28, z: 38, r: 1.15 },
    { x: -22, z: 31, r: 0.95 },
    { x: -30, z: 24.5, r: 1.05 },
    { x: -6, z: 2.5, r: 0.85 },
    { x: 6, z: -6, r: 0.8 },
    { x: -4, z: -6.5, r: 0.75 },
    { x: 5.5, z: -5, r: 0.7 },
    { x: 35.1, z: -36.2, r: 1.45 },
    { x: 34.6, z: -30.6, r: 1.45 },
    { x: 41.6, z: -36.6, r: 1.2 },
    { x: 42.0, z: -33.2, r: 1.15 },
  ],
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { RIVER, TAU };
