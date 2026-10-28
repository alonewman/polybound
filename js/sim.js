import * as THREE from "three";
import {
  LEVEL,
  MATCH_DURATION,
  SCORE_LIMIT,
  THROW_RANGE,
  WHISTLE_RADIUS,
  WATER,
  isWalkable,
  sampleHeight,
} from "./geo.js";
import { buildWorld } from "./world.js";
import {
  createExplorer,
  createCreature,
  createEnemy,
  createTreasure,
  createCore,
  createBlocker,
  createPedestal,
  createHide,
  createStonePad,
  glowTexture,
} from "./art.js";

const TYPE = {
  tri: { hp: 26, atk: 6, cd: 0.46, speed: 7.15, range: 0.92, carry: 1 },
  sq: { hp: 58, atk: 11, cd: 0.92, speed: 5.15, range: 1.08, carry: 1.75 },
  orb: { hp: 38, atk: 8, cd: 0.6, speed: 6.2, range: 1.0, carry: 1.2 },
};

const FOE = {
  nib: { hp: 34, atk: 7, cd: 1.05, speed: 3.7, range: 1.0, aggro: 6.4, leash: 9 },
  lizard: { hp: 50, atk: 9, cd: 0.82, speed: 5.3, range: 1.05, aggro: 7.4, leash: 12 },
  pebble: { hp: 128, atk: 16, cd: 1.8, speed: 2.2, range: 1.35, aggro: 6, leash: 8, aoe: 1.65 },
  helm: { hp: 84, atk: 11, cd: 1.02, speed: 3.35, range: 1.15, aggro: 7, leash: 10 },
  menhir: { hp: 290, atk: 22, cd: 1.65, speed: 1.65, range: 2.2, aggro: 8.2, leash: 11, aoe: 2.3 },
};

const MATCHUP = {
  tri: { lizard: 1.45, pebble: 0.6, menhir: 0.48, helm: 0.85, nib: 1.15, sq: 0.9, orb: 1.18, tri: 1 },
  sq: { pebble: 1.55, menhir: 1.42, lizard: 0.7, helm: 1.12, nib: 1.2, tri: 1.16, orb: 0.88, sq: 1 },
  orb: { helm: 1.48, lizard: 1.02, pebble: 0.88, menhir: 0.75, nib: 1.1, sq: 1.16, tri: 0.9, orb: 1 },
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function dampAngle(cur, target, dt, speed) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * (1 - Math.exp(-speed * dt));
}

export function createGame(scene, audio) {
  const world = buildWorld(scene);
  const root = new THREE.Group();
  scene.add(root);

  const glowTex = glowTexture();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const aim = { x: LEVEL.player.start[0] + 2, z: LEVEL.player.start[1], ok: false };

  const G = {
    phase: "menu",
    paused: false,
    diff: "normal",
    elapsed: 0,
    remain: MATCH_DURATION,
    scores: { player: 0, rival: 0 },
    stats: null,
    selection: null,
    flags: {},
    winner: null,
    endReason: "",
    toast: "",
    toastT: 0,
    didThrow: false,
    didWhistle: false,
    shake: 0,
    clock: 0,
    throwCd: 0,
    whistleCd: 0,
    ai: { t: 0.4, mode: "discover", goal: null, throwAt: null, throwCd: 0.2, scout: 0 },
    floaters: [],
    rings: [],
    dusts: [],
  };

  function freshStats() {
    const blank = () => ({ recruited: 0, delivered: 0, foes: 0, losses: 0, thrown: 0 });
    return { player: blank(), rival: blank() };
  }
  G.stats = freshStats();

  const explorers = {
    player: makeExplorer("player"),
    rival: makeExplorer("rival"),
  };
  const creatures = LEVEL.creatures.map((def) => makeCreature(def));
  const enemies = LEVEL.enemies.map((def) => makeEnemy(def));
  const treasures = LEVEL.treasures.map((def) => makeTreasure(def));
  const blockers = LEVEL.blockers.map((def) => makeBlocker(def));
  const mechs = LEVEL.mechanisms.map((def) => makeMech(def));
  const enemyById = Object.fromEntries(enemies.map((e) => [e.id, e]));
  const treasureById = Object.fromEntries(treasures.map((t) => [t.id, t]));
  const cores = {
    player: makeCore("player", LEVEL.player.core),
    rival: makeCore("rival", LEVEL.rival.core),
  };

  const arcGeo = new THREE.BufferGeometry();
  const arcArr = new Float32Array(16 * 3);
  arcGeo.setAttribute("position", new THREE.BufferAttribute(arcArr, 3));
  const arcLine = new THREE.Line(
    arcGeo,
    new THREE.LineBasicMaterial({ color: 0xfff6d2, transparent: true, opacity: 0.0 })
  );
  root.add(arcLine);
  const aimRing = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.46, 22),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  aimRing.rotation.x = -Math.PI / 2;
  root.add(aimRing);

  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.55, 28),
      new THREE.MeshBasicMaterial({ color: 0xf3efe2, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    root.add(ring);
    G.rings.push({ mesh: ring, life: 0, x: 0, z: 0 });
  }
  const dustGeo = new THREE.SphereGeometry(0.06, 4, 3);
  for (let i = 0; i < 28; i++) {
    const mesh = new THREE.Mesh(
      dustGeo,
      new THREE.MeshBasicMaterial({ color: 0xe6d3b0, transparent: true, opacity: 0 })
    );
    mesh.visible = false;
    root.add(mesh);
    G.dusts.push({ mesh, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }

  for (const s of LEVEL.stones) {
    const plat = world.platforms.find((p) => p.x === s.x && p.z === s.z);
    const mesh = createStonePad();
    mesh.visible = false;
    root.add(mesh);
    if (plat) plat.mesh = mesh;
  }

  world.rebuildNav();
  placeAll();

  function makeExplorer(team) {
    const src = team === "player" ? LEVEL.player : LEVEL.rival;
    const mesh = createExplorer(team);
    root.add(mesh);
    return {
      id: team,
      team,
      name: src.name,
      x: src.start[0],
      z: src.start[1],
      y: 0,
      vx: 0,
      vz: 0,
      facing: team === "player" ? 0.4 : Math.PI,
      wishX: 0,
      wishZ: 0,
      running: false,
      mesh,
      bob: 0,
      step: 0.2,
      radius: 0.42,
      path: null,
      pathAge: 0,
      pathI: 0,
      stuck: 0,
    };
  }

  function makeCreature(def) {
    const mesh = createCreature(def.type, null);
    mesh.visible = false;
    root.add(mesh);
    const hideMesh = createHide(def.hide);
    root.add(hideMesh);
    const spec = TYPE[def.type];
    return {
      id: def.id,
      def,
      type: def.type,
      team: null,
      x: def.x,
      z: def.z,
      y: 0,
      facing: 0,
      state: "hidden",
      hp: spec.hp,
      hpMax: spec.hp,
      speed: spec.speed,
      atk: spec.atk,
      cd: spec.cd,
      range: spec.range,
      carry: spec.carry,
      alive: false,
      mesh,
      hideMesh,
      target: null,
      carryId: null,
      rallyX: def.x,
      rallyZ: def.z,
      air: null,
      stun: 0,
      flash: 0,
      react: 0,
      lunge: 0,
      attackT: 0.3,
      kx: 0,
      kz: 0,
      respawn: 0,
      path: null,
      pathAge: 1,
      pathI: 0,
      pathKey: "",
      stuck: 0,
      bob: Math.random() * 6,
      emerge: 0,
      blink: Math.random() * 3,
    };
  }

  function makeEnemy(def) {
    const mesh = createEnemy(def.kind);
    root.add(mesh);
    const spec = FOE[def.kind];
    return {
      id: def.id,
      def,
      kind: def.kind,
      x: def.x,
      z: def.z,
      y: 0,
      facing: 0,
      hp: spec.hp,
      hpMax: spec.hp,
      alive: true,
      mesh,
      target: null,
      homeX: def.home[0],
      homeZ: def.home[1],
      patrol: def.patrol || null,
      patrolI: 0,
      pause: 0,
      sleep: !!def.sleep,
      awake: !def.sleep,
      attackT: 1,
      kx: 0,
      kz: 0,
      flash: 0,
      dying: 0,
      bob: Math.random() * 4,
      lunge: 0,
      path: null,
      pathAge: 1,
      pathI: 0,
      stuck: 0,
      ...spec,
    };
  }

  function makeTreasure(def) {
    const mesh = createTreasure(def.kind);
    root.add(mesh);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: mesh.userData.glow,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      })
    );
    sprite.scale.set(1.5, 1.5, 1.5);
    sprite.position.y = 0.35;
    mesh.add(sprite);
    return {
      def,
      ...def,
      x: def.x,
      z: def.z,
      y: 0,
      mesh,
      sprite,
      state: "ground",
      team: null,
      spin: Math.random() * 6,
      path: null,
      pathI: 0,
      pathAge: 1,
      bob: Math.random(),
    };
  }

  function makeBlocker(def) {
    const mesh = createBlocker(def.kind);
    root.add(mesh);
    const solid = { x: def.x, z: def.z, r: def.r, active: true, id: def.id, kind: def.kind };
    world.solids.push(solid);
    return { ...def, hp: def.hp, hpMax: def.hp, mesh, solid, alive: true, shake: 0 };
  }

  function makeMech(def) {
    const mesh = createPedestal();
    root.add(mesh);
    return { ...def, mesh, progress: 0, done: false };
  }

  function makeCore(team, pos) {
    const mesh = createCore(team);
    root.add(mesh);
    return { team, x: pos[0], z: pos[1], mesh, pulse: 0 };
  }

  function placeAll() {
    for (const ex of Object.values(explorers)) {
      ex.y = sampleHeight(ex.x, ex.z, world.platforms);
      ex.mesh.position.set(ex.x, ex.y, ex.z);
    }
    for (const c of creatures) resetCreature(c);
    for (const e of enemies) resetEnemy(e);
    for (const t of treasures) resetTreasure(t);
    for (const b of blockers) {
      b.hp = b.hpMax;
      b.alive = true;
      b.solid.active = true;
      b.mesh.visible = true;
      b.mesh.position.set(b.x, sampleHeight(b.x, b.z, world.platforms), b.z);
    }
    for (const m of mechs) {
      m.progress = 0;
      m.done = false;
      m.mesh.position.set(m.x, sampleHeight(m.x, m.z, world.platforms), m.z);
      m.mesh.userData.parts.orb.material.emissive.setHex(0x0c3c44);
    }
    for (const p of world.platforms) {
      p.active = false;
      if (p.mesh) {
        p.mesh.visible = false;
        p.mesh.position.set(p.x, p.h, p.z);
      }
    }
    for (const core of Object.values(cores)) {
      core.mesh.position.set(core.x, sampleHeight(core.x, core.z, world.platforms), core.z);
    }
  }

  function resetCreature(c) {
    c.team = null;
    c.x = c.def.x;
    c.z = c.def.z;
    c.y = sampleHeight(c.x, c.z, world.platforms);
    c.state = "hidden";
    c.hp = c.hpMax;
    c.alive = false;
    c.target = null;
    c.carryId = null;
    c.air = null;
    c.stun = 0;
    c.flash = 0;
    c.respawn = 0;
    c.emerge = 0;
    c.path = null;
    c.kx = 0;
    c.kz = 0;
    c.mesh.visible = false;
    c.mesh.scale.setScalar(1);
    c.hideMesh.visible = true;
    c.hideMesh.position.set(c.x, c.y, c.z);
    const belly = c.mesh.userData.parts.belly;
    belly.material.color.setHex(0xfff3d4);
    c.mesh.userData.parts.marker.visible = false;
    c.mesh.userData.parts.spirit.visible = false;
    c.mesh.userData.parts.body.visible = true;
  }

  function resetEnemy(e) {
    e.x = e.def.x;
    e.z = e.def.z;
    e.y = sampleHeight(e.x, e.z, world.platforms);
    e.hp = e.hpMax;
    e.alive = true;
    e.dying = 0;
    e.target = null;
    e.sleep = !!e.def.sleep;
    e.awake = !e.def.sleep;
    e.attackT = 0.8;
    e.mesh.visible = true;
    e.mesh.scale.setScalar(1);
    e.mesh.position.set(e.x, e.y, e.z);
    if (e.kind === "pebble" && e.mesh.userData.eyes) {
      e.mesh.userData.eyes.forEach((eye) => (eye.scale.y = 0.15));
    }
  }

  function resetTreasure(t) {
    t.x = t.def.x;
    t.z = t.def.z;
    t.state = "ground";
    t.team = null;
    t.path = null;
    t.mesh.visible = true;
    t.sprite.visible = true;
    t.y = sampleHeight(t.x, t.z, world.platforms);
    t.mesh.position.set(t.x, t.y, t.z);
  }

  function reset() {
    G.elapsed = 0;
    G.remain = MATCH_DURATION;
    G.scores.player = 0;
    G.scores.rival = 0;
    G.stats = freshStats();
    G.flags = {};
    G.winner = null;
    G.endReason = "";
    G.selection = null;
    G.toast = "";
    G.toastT = 0;
    G.didThrow = false;
    G.didWhistle = false;
    G.shake = 0;
    G.paused = false;
    G.phase = "play";
    G.ai = { t: 0.2, mode: "discover", goal: null, throwAt: null, throwCd: 0.3, scout: 0 };
    G.floaters.length = 0;
    const p = explorers.player;
    const r = explorers.rival;
    p.x = LEVEL.player.start[0];
    p.z = LEVEL.player.start[1];
    p.vx = p.vz = p.wishX = p.wishZ = 0;
    p.facing = 0.5;
    r.x = LEVEL.rival.start[0];
    r.z = LEVEL.rival.start[1];
    r.vx = r.vz = r.wishX = r.wishZ = 0;
    r.facing = Math.PI;
    placeAll();
    world.rebuildNav();
  }

  function free(x, z, swim) {
    return isWalkable(x, z, swim ? "swim" : "land", world.solids, world.platforms);
  }

  function groundY(x, z, swim) {
    const h = sampleHeight(x, z, world.platforms);
    if (swim && h < WATER) return WATER - 0.04;
    return h;
  }

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function stepXY(a, vx, vz, dt, swim) {
    const nx = a.x + vx * dt;
    const nz = a.z + vz * dt;
    if (free(nx, nz, swim)) {
      a.x = nx;
      a.z = nz;
      return;
    }
    if (free(nx, a.z, swim)) {
      a.x = nx;
      return;
    }
    if (free(a.x, nz, swim)) a.z = nz;
  }

  function moveToward(a, tx, tz, speed, dt, swim) {
    const dx0 = tx - a.x;
    const dz0 = tz - a.z;
    const dist0 = Math.hypot(dx0, dz0);
    if (dist0 < 0.22) return;
    let gx = tx;
    let gz = tz;
    if (dist0 > 4) {
      const key = `${tx.toFixed(0)}:${tz.toFixed(0)}:${swim ? 1 : 0}`;
      a.pathAge += dt;
      if (!a.path || a.pathKey !== key || a.pathAge > 0.75) {
        a.path = world.nav.findPath(a.x, a.z, tx, tz, !!swim);
        a.pathKey = key;
        a.pathAge = 0;
        a.pathI = 0;
      }
      if (a.path && a.path.length) {
        while (a.pathI < a.path.length - 1 && Math.hypot(a.path[a.pathI].x - a.x, a.path[a.pathI].z - a.z) < 0.95) {
          a.pathI++;
        }
        gx = a.path[a.pathI].x;
        gz = a.path[a.pathI].z;
      }
    }
    let vx = gx - a.x;
    let vz = gz - a.z;
    const m = Math.hypot(vx, vz) || 1;
    vx = (vx / m) * speed + (a.kx || 0);
    vz = (vz / m) * speed + (a.kz || 0);
    if (a.type) {
      for (const o of creatures) {
        if (o === a || !o.alive || o.state === "airborne" || o.state === "hidden") continue;
        const ox = a.x - o.x;
        const oz = a.z - o.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > 0.0004 && d2 < 0.38) {
          const d = Math.sqrt(d2);
          vx += (ox / d) * 1.15;
          vz += (oz / d) * 1.15;
        }
      }
    }
    const bx = a.x;
    const bz = a.z;
    stepXY(a, vx, vz, dt, swim);
    const moved = Math.hypot(a.x - bx, a.z - bz);
    a.stuck = moved < 0.015 && dist0 > 0.5 ? (a.stuck || 0) + dt : 0;
    if (a.stuck > 1.25) {
      const n = world.nav.nearestWalkable(a.x + (gx - a.x) * 0.2, a.z + (gz - a.z) * 0.2, !!swim, 4);
      if (n) {
        a.x = n.x;
        a.z = n.z;
      }
      a.path = null;
      a.stuck = 0;
    }
    a.kx = (a.kx || 0) * Math.exp(-7 * dt);
    a.kz = (a.kz || 0) * Math.exp(-7 * dt);
    a.y = groundY(a.x, a.z, swim && a.type === "orb");
    if (speed > 0.2) a.facing = dampAngle(a.facing || 0, Math.atan2(vx, vz), dt, 9);
  }

  function integrateExplorer(ex, dt) {
    const max = ex.running ? 8.6 : 5.2;
    if (ex.wishX || ex.wishZ) {
      ex.vx += ex.wishX * 38 * dt;
      ex.vz += ex.wishZ * 38 * dt;
      const sp = Math.hypot(ex.vx, ex.vz);
      if (sp > max) {
        ex.vx = (ex.vx / sp) * max;
        ex.vz = (ex.vz / sp) * max;
      }
    } else {
      const damp = Math.exp(-16 * dt);
      ex.vx *= damp;
      ex.vz *= damp;
    }
    stepXY(ex, ex.vx, ex.vz, dt, false);
    ex.y = groundY(ex.x, ex.z, false);
    const sp = Math.hypot(ex.vx, ex.vz);
    if (sp > 0.45) ex.facing = dampAngle(ex.facing, Math.atan2(ex.vx, ex.vz), dt, 12);
    ex.bob += sp * dt;
    if (sp > 1.4 && G.phase === "play") {
      ex.step -= dt;
      if (ex.step <= 0) {
        ex.step = ex.running ? 0.26 : 0.4;
        if (ex.team === "player") audio.foot();
        puff(ex.x, ex.y + 0.05, ex.z, 2, 0xcbb892);
      }
    }
  }

  function driveExplorer(ex, tx, tz, dt) {
    const d = Math.hypot(tx - ex.x, tz - ex.z);
    if (d < 1.05) {
      ex.wishX = 0;
      ex.wishZ = 0;
      ex.running = false;
      return;
    }
    let gx = tx;
    let gz = tz;
    const aheadX = ex.x + ((tx - ex.x) / d) * 1.4;
    const aheadZ = ex.z + ((tz - ex.z) / d) * 1.4;
    if (d > 5 || !free(aheadX, aheadZ, false)) {
      ex.pathAge += dt;
      if (!ex.path || ex.pathAge > 0.45) {
        ex.path = world.nav.findPath(ex.x, ex.z, tx, tz, false);
        ex.pathAge = 0;
        ex.pathI = 0;
      }
      if (ex.path && ex.path.length) {
        while (ex.pathI < ex.path.length - 1 && Math.hypot(ex.path[ex.pathI].x - ex.x, ex.path[ex.pathI].z - ex.z) < 1.05) {
          ex.pathI++;
        }
        gx = ex.path[ex.pathI].x;
        gz = ex.path[ex.pathI].z;
      }
    }
    const dx = gx - ex.x;
    const dz = gz - ex.z;
    const m = Math.hypot(dx, dz) || 1;
    ex.wishX = dx / m;
    ex.wishZ = dz / m;
    ex.running = d > 2.4;
  }

  function locked(req) {
    return !!req && !G.flags[req];
  }

  function ready(c) {
    return c.alive && (c.state === "follow" || c.state === "idle" || c.state === "return");
  }

  function matchup(type, kind) {
    return MATCHUP[type]?.[kind] ?? 1;
  }

  function nearestFoeCreature(c, rad) {
    let best = null;
    let bd = rad;
    for (const o of creatures) {
      if (!o.alive || !o.team || o.team === c.team) continue;
      if (o.state === "airborne" || o.state === "defeated" || o.state === "hidden") continue;
      const d = dist(c, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  function nearestEnemy(x, z, rad) {
    let best = null;
    let bd = rad;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  function guardOf(t) {
    if (!t.guard) return null;
    const e = enemyById[t.guard];
    return e && e.alive ? e : null;
  }

  function chooseTask(c) {
    const foe = nearestFoeCreature(c, 2.7);
    if (foe) return startFight(c, foe);
    const enemy = nearestEnemy(c.x, c.z, 3.15);
    if (enemy) return startFight(c, enemy);
    let bestT = null;
    let bd = 3.35;
    for (const t of treasures) {
      if (t.state === "delivered" || locked(t.requires)) continue;
      const d = dist(c, t);
      if (d < bd) {
        bd = d;
        bestT = t;
      }
    }
    if (bestT) {
      const enemyCarrier = creatures.find((o) => o.alive && o.carryId === bestT.id && o.team && o.team !== c.team);
      if (enemyCarrier) return startFight(c, enemyCarrier);
      const g = guardOf(bestT);
      if (g && dist(g, bestT) < 9 && dist(c, g) < 4.8) return startFight(c, g);
      c.state = "carry";
      c.carryId = bestT.id;
      c.target = null;
      return;
    }
    if (c.type === "orb") {
      for (const m of mechs) {
        if (m.done) continue;
        if (dist(c, m) < 2.5) {
          c.state = "channel";
          c.target = m;
          return;
        }
      }
    }
    for (const b of blockers) {
      if (!b.alive) continue;
      if (dist(c, b) < 2.55) {
        const prefer = b.kind === "bramble" ? "tri" : "sq";
        if (c.type === prefer || dist(c, b) < 2.1) {
          c.state = "work";
          c.target = b;
          return;
        }
      }
    }
    c.state = "follow";
    c.target = null;
    c.carryId = null;
  }

  function startFight(c, target) {
    c.state = "fight";
    c.target = target;
    c.carryId = null;
  }

  function launch(c, x, z, from) {
    const swim = c.type === "orb";
    let dx = x - from.x;
    let dz = z - from.z;
    let d = Math.hypot(dx, dz) || 1;
    if (d > THROW_RANGE) {
      x = from.x + (dx / d) * THROW_RANGE;
      z = from.z + (dz / d) * THROW_RANGE;
      d = THROW_RANGE;
    }
    const spot = world.nav.nearestWalkable(x, z, swim, 6) || { x: from.x, z: from.z };
    c.state = "airborne";
    c.carryId = null;
    c.target = null;
    c.air = {
      x0: c.x,
      z0: c.z,
      y0: c.y + 0.55,
      x1: spot.x,
      z1: spot.z,
      y1: groundY(spot.x, spot.z, swim),
      t: 0,
      dur: clamp(0.4 + d * 0.042, 0.38, 1.05),
      h: Math.max(1.35, d * 0.22),
    };
    audio.throw();
    if (from.team === "player") G.stats.player.thrown++;
    else G.stats.rival.thrown++;
  }

  function throwReady(team, type, x, z) {
    const from = explorers[team];
    const list = creatures.filter((c) => c.team === team && ready(c) && (type === "all" || c.type === type));
    if (!list.length) return false;
    list.sort((a, b) => dist(a, from) - dist(b, from));
    launch(list[0], x, z, from);
    return true;
  }

  function doWhistle(team, x, z) {
    audio.whistle();
    const slot = G.rings.find((r) => r.life <= 0) || G.rings[0];
    slot.life = 0.7;
    slot.x = x;
    slot.z = z;
    slot.mesh.visible = true;
    puff(x, groundY(x, z, false) + 0.1, z, 6, 0xf4efe4);
    let n = 0;
    for (const c of creatures) {
      if (c.team !== team || !c.alive) continue;
      if (c.state === "carry" || c.state === "work" || c.state === "channel" || c.state === "airborne" || c.state === "defeated") continue;
      if (Math.hypot(c.x - x, c.z - z) > WHISTLE_RADIUS) continue;
      c.state = "return";
      c.rallyX = x;
      c.rallyZ = z;
      c.target = null;
      c.stun = 0;
      c.react = 0.32;
      n++;
    }
    return n;
  }

  function puff(x, y, z, count, color) {
    let left = count;
    for (const d of G.dusts) {
      if (left <= 0) break;
      if (d.life > 0) continue;
      d.life = 0.35 + Math.random() * 0.25;
      d.x = x;
      d.y = y;
      d.z = z;
      d.vx = (Math.random() - 0.5) * 1.4;
      d.vy = 0.6 + Math.random() * 1.2;
      d.vz = (Math.random() - 0.5) * 1.4;
      d.mesh.visible = true;
      d.mesh.material.color.setHex(color);
      d.mesh.material.opacity = 0.8;
      left--;
    }
  }

  function hurt(target, amount, from) {
    target.hp -= amount;
    target.flash = 0.12;
    const dir = Math.atan2(target.x - (from?.x ?? target.x), target.z - (from?.z ?? target.z));
    const force = from?.type === "sq" ? 2.1 : from?.kind === "menhir" || from?.kind === "pebble" ? 2.6 : 0.85;
    target.kx = Math.sin(dir) * force;
    target.kz = Math.cos(dir) * force;
    if (from?.type === "sq" || from?.kind === "menhir" || from?.kind === "pebble") target.stun = Math.max(target.stun || 0, 0.26);
    audio.hit();
    if (target.hp <= 0) {
      if (target.kind) killEnemy(target, from);
      else killCreature(target);
    }
  }

  function killCreature(c) {
    if (c.state === "defeated") return;
    c.state = "defeated";
    c.alive = false;
    c.carryId = null;
    c.target = null;
    c.respawn = 7.5;
    c.hp = 0;
    if (c.team) G.stats[c.team].losses++;
    audio.defeat();
    puff(c.x, c.y + 0.3, c.z, 5, TYPE_COLOR(c.type));
  }

  function TYPE_COLOR(type) {
    return type === "tri" ? 0xffc83a : type === "sq" ? 0xe14b38 : 0x3ec6d6;
  }

  function killEnemy(e, from) {
    e.alive = false;
    e.dying = 0.7;
    e.target = null;
    const team = from?.team;
    if (team) G.stats[team].foes++;
    puff(e.x, e.y + 0.4, e.z, 8, 0xcbb892);
    if (e.kind === "menhir" || e.kind === "pebble") G.shake = Math.max(G.shake, 0.18);
  }

  function attack(attacker, target) {
    if (!target || (target.alive === false && !target.kind)) return;
    if (target.kind && !target.alive) return;
    if (target.state === "defeated" || target.state === "hidden") return;
    const kind = target.kind || target.type;
    let dmg = attacker.atk * (attacker.type ? matchup(attacker.type, kind) : 1);
    if (attacker.type) {
      let allies = 0;
      for (const o of creatures) {
        if (o !== attacker && o.alive && o.team === attacker.team && o.state === "fight" && dist(o, attacker) < 2.4) allies++;
      }
      if (allies >= 2) dmg *= 1.12;
    }
    hurt(target, dmg, attacker);
    attacker.lunge = 0.16;
    attacker.attackT = attacker.cd;
  }

  function breakBlocker(b) {
    b.alive = false;
    b.solid.active = false;
    b.mesh.visible = false;
    G.flags[b.id] = true;
    world.rebuildNav();
    puff(b.x, b.y + 0.4, b.z, 8, b.kind === "bramble" ? 0x6a8a48 : 0xb7aa96);
    audio.work();
  }

  function completeMech(m) {
    if (m.done) return;
    m.done = true;
    G.flags[m.id] = true;
    m.mesh.userData.parts.orb.material.emissive.setHex(0xd7fff8);
    if (m.opens === "stones") {
      for (const p of world.platforms) {
        p.active = true;
        if (p.mesh) {
          p.mesh.visible = true;
          p.mesh.position.set(p.x, p.h, p.z);
        }
      }
      world.rebuildNav();
    }
    audio.score();
    puff(m.x, m.y + 0.6, m.z, 7, 0x9be7ea);
  }

  function recruit(c, team) {
    c.team = team;
    c.alive = true;
    c.hp = c.hpMax;
    c.state = "emerging";
    c.emerge = 0.42;
    c.mesh.visible = true;
    c.hideMesh.visible = false;
    const belly = c.mesh.userData.parts.belly;
    belly.material.color.setHex(team === "rival" ? 0xb7a4ef : 0xfff3d4);
    G.stats[team].recruited++;
    audio.discover();
    puff(c.x, c.y + 0.2, c.z, 6, TYPE_COLOR(c.type));
    if (team === "player") {
      const name = c.type === "tri" ? "triangle" : c.type === "sq" ? "square" : "sphere";
      G.toast = `A ${name} joins Lark`;
      G.toastT = 2.1;
      if (!G.selection) G.selection = c.type;
    }
  }

  function updateDiscovery() {
    for (const c of creatures) {
      if (c.state !== "hidden") continue;
      if (locked(c.requires)) continue;
      for (const team of ["player", "rival"]) {
        const ex = explorers[team];
        if (dist(ex, c) < 1.62) {
          recruit(c, team);
          break;
        }
      }
    }
  }

  function updateCreature(c, dt) {
    c.bob += dt;
    c.blink -= dt;
    if (c.blink < 0) c.blink = 2.4 + Math.random() * 3;
    c.flash = Math.max(0, c.flash - dt);
    c.react = Math.max(0, c.react - dt);
    c.lunge = Math.max(0, c.lunge - dt);
    c.stun = Math.max(0, c.stun - dt);
    if (c.state === "hidden") return;
    if (c.state === "emerging") {
      c.emerge -= dt;
      c.y = groundY(c.x, c.z, false);
      if (c.emerge <= 0) c.state = "follow";
      return;
    }
    if (c.state === "defeated") {
      c.respawn -= dt;
      const core = cores[c.team] || cores.player;
      const dx = core.x - c.x;
      const dz = core.z - c.z;
      const m = Math.hypot(dx, dz) || 1;
      c.x += (dx / m) * 8 * dt;
      c.z += (dz / m) * 8 * dt;
      c.y = groundY(c.x, c.z, false) + 0.8;
      if (c.respawn <= 0 && m < 1.4) {
        c.alive = true;
        c.hp = c.hpMax;
        c.state = "follow";
        c.x = core.x + (Math.random() - 0.5) * 1.4;
        c.z = core.z + (Math.random() - 0.5) * 1.4;
        c.y = groundY(c.x, c.z, false);
      }
      return;
    }
    if (!c.alive) return;
    const swim = c.type === "orb";
    if (c.state === "airborne" && c.air) {
      c.air.t += dt;
      const u = clamp(c.air.t / c.air.dur, 0, 1);
      c.x = c.air.x0 + (c.air.x1 - c.air.x0) * u;
      c.z = c.air.z0 + (c.air.z1 - c.air.z0) * u;
      const baseY = c.air.y0 + (c.air.y1 - c.air.y0) * u;
      c.y = baseY + Math.sin(u * Math.PI) * c.air.h;
      if (u >= 1) {
        c.x = c.air.x1;
        c.z = c.air.z1;
        c.y = c.air.y1;
        c.air = null;
        c.state = "follow";
        audio.land();
        puff(c.x, c.y + 0.05, c.z, 5, 0xe6d2b0);
        chooseTask(c);
      }
      return;
    }
    if (c.stun > 0.05 && c.state !== "return") {
      stepXY(c, c.kx, c.kz, dt, swim);
      c.y = groundY(c.x, c.z, swim);
      return;
    }
    if (c.state === "return") {
      const d = Math.hypot(c.rallyX - c.x, c.rallyZ - c.z);
      if (d < 1.15) c.state = "follow";
      else moveToward(c, c.rallyX, c.rallyZ, c.speed * 1.15, dt, swim);
      return;
    }
    if (c.state === "fight") {
      const target = c.target;
      const valid =
        target &&
        (target.kind ? target.alive : target.alive && target.state !== "defeated" && target.state !== "hidden");
      if (!valid || dist(c, target) > 16) {
        c.state = "follow";
        c.target = null;
        return;
      }
      if (dist(c, target) > c.range) moveToward(c, target.x, target.z, c.speed, dt, swim);
      else {
        c.attackT -= dt;
        c.facing = dampAngle(c.facing, Math.atan2(target.x - c.x, target.z - c.z), dt, 10);
        if (c.attackT <= 0) attack(c, target);
      }
      return;
    }
    if (c.state === "work") {
      const b = c.target;
      if (!b || !b.alive) {
        c.state = "follow";
        c.target = null;
        return;
      }
      const foe = nearestFoeCreature(c, 1.7) || nearestEnemy(c.x, c.z, 1.6);
      if (foe) return startFight(c, foe);
      if (dist(c, b) > 1.25) moveToward(c, b.x, b.z, c.speed, dt, swim);
      else {
        c.attackT -= dt;
        if (c.attackT <= 0) {
          const prefer = b.kind === "bramble" ? "tri" : "sq";
          const power = c.type === prefer ? (prefer === "tri" ? 13 : 15) : 3.2;
          b.hp -= power;
          b.shake = 0.2;
          c.attackT = c.type === prefer ? 0.42 : 0.55;
          c.lunge = 0.12;
          audio.work();
          if (b.hp <= 0) breakBlocker(b);
        }
      }
      return;
    }
    if (c.state === "channel") {
      const m = c.target;
      if (!m || m.done) {
        c.state = "follow";
        c.target = null;
        return;
      }
      if (dist(c, m) > 1.35) moveToward(c, m.x, m.z, c.speed, dt, true);
      else {
        m.progress += dt;
        c.facing += dt * 3;
        if (m.progress >= 1.55) {
          completeMech(m);
          c.state = "follow";
          c.target = null;
        }
      }
      return;
    }
    if (c.state === "carry") {
      const t = treasureById[c.carryId];
      if (!t || t.state === "delivered") {
        c.state = "follow";
        c.carryId = null;
        return;
      }
      const foe = nearestFoeCreature(c, 1.75);
      const enemy = nearestEnemy(c.x, c.z, 1.7);
      if (foe) return startFight(c, foe);
      if (enemy && dist(enemy, t) < 6) return startFight(c, enemy);
      return;
    }
    const owner = explorers[c.team] || explorers.player;
    const slot = creatures.indexOf(c) % 6;
    const ang = owner.facing + Math.PI + (slot - 2.5) * 0.45;
    const rad = 1.15 + (slot % 3) * 0.28;
    const tx = owner.x + Math.sin(ang) * rad;
    const tz = owner.z + Math.cos(ang) * rad;
    const d = Math.hypot(tx - c.x, tz - c.z);
    const sp = d > 6 ? c.speed * 1.35 : c.speed;
    if (d > 0.45) moveToward(c, tx, tz, sp, dt, swim);
    else c.y = groundY(c.x, c.z, swim);
  }

  function updateEnemy(e, dt) {
    e.bob += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.lunge = Math.max(0, e.lunge - dt);
    if (!e.alive) {
      e.dying -= dt;
      e.mesh.position.y -= dt * 0.8;
      e.mesh.scale.setScalar(Math.max(0.01, e.dying));
      if (e.dying <= 0) e.mesh.visible = false;
      return;
    }
    if (e.sleep && !e.awake) {
      for (const ex of Object.values(explorers)) {
        if (dist(e, ex) < e.aggro) e.awake = true;
      }
      for (const c of creatures) {
        if (c.alive && dist(e, c) < e.aggro) e.awake = true;
      }
      if (!e.awake) return;
      if (e.kind === "pebble" && e.mesh.userData.eyes) e.mesh.userData.eyes.forEach((eye) => (eye.scale.y = 1));
    }
    let target = e.target;
    if (target && (!target.alive || target.state === "defeated" || target.state === "hidden" || dist(e, target) > e.leash + 2)) {
      target = null;
    }
    if (!target) {
      let bd = e.aggro;
      for (const c of creatures) {
        if (!c.alive || c.state === "hidden" || c.state === "airborne") continue;
        const d = dist(e, c);
        if (d < bd) {
          bd = d;
          target = c;
        }
      }
    }
    e.target = target;
    if (target) {
      const homeD = Math.hypot(e.x - e.homeX, e.z - e.homeZ);
      if (homeD > e.leash && dist(e, target) > e.range) {
        e.target = null;
        moveToward(e, e.homeX, e.homeZ, e.speed, dt, false);
        return;
      }
      if (dist(e, target) > e.range) moveToward(e, target.x, target.z, e.speed, dt, false);
      else {
        e.attackT -= dt;
        e.facing = dampAngle(e.facing, Math.atan2(target.x - e.x, target.z - e.z), dt, 8);
        if (e.attackT <= 0) {
          if (e.aoe) {
            for (const c of creatures) {
              if (c.alive && dist(e, c) <= e.aoe) hurt(c, e.atk, e);
            }
            e.lunge = 0.2;
            if (e.kind === "menhir") G.shake = Math.max(G.shake, 0.16);
            puff(e.x, e.y + 0.1, e.z, 6, 0xd9d0c4);
          } else attack(e, target);
          e.attackT = e.cd;
        }
      }
      return;
    }
    if (e.patrol && e.patrol.length) {
      e.pause -= dt;
      const p = e.patrol[e.patrolI % e.patrol.length];
      if (Math.hypot(e.x - p[0], e.z - p[1]) < 0.8) {
        e.patrolI++;
        e.pause = 0.7;
      } else if (e.pause <= 0) moveToward(e, p[0], p[1], e.speed * 0.65, dt, false);
      return;
    }
    if (Math.hypot(e.x - e.homeX, e.z - e.homeZ) > 1.2) moveToward(e, e.homeX, e.homeZ, e.speed * 0.8, dt, false);
    else if (e.def.sleep && !target) {
      e.awake = false;
      e.sleep = true;
      if (e.kind === "pebble" && e.mesh.userData.eyes) e.mesh.userData.eyes.forEach((eye) => (eye.scale.y = 0.15));
    }
  }

  function contribution(list) {
    let s = 0;
    for (const c of list) s += c.carry;
    return s;
  }

  function updateTreasure(t, dt) {
    t.bob += dt;
    if (t.state === "delivered") return;
    const carriers = [];
    for (const c of creatures) {
      if (c.alive && c.state === "carry" && c.carryId === t.id) carriers.push(c);
    }
    const team = carriers[0]?.team || null;
    const opposed = creatures.some(
      (c) => c.alive && c.team && team && c.team !== team && c.state === "fight" && dist(c, t) < 2.35
    );
    const power = contribution(carriers);
    const canMove = team && power >= t.weight && !opposed && !locked(t.requires) && guardClear(t);
    if (canMove) {
      t.state = "carried";
      t.team = team;
      const core = cores[team];
      const swim = carriers.every((c) => c.type === "orb");
      const surplus = power - t.weight;
      let speed = 2.05 + surplus * 0.38;
      if (t.weight >= 3 && carriers.some((c) => c.type === "sq")) speed *= 1.22;
      if (carriers.some((c) => c.type === "tri")) speed *= 1.05;
      speed = clamp(speed, 1.35, 4.1);
      moveToward(t, core.x, core.z, speed, dt, swim);
      if (!t.step) t.step = 0.4;
      t.step -= dt;
      if (t.step <= 0) {
        t.step = 0.45;
        audio.carry();
      }
      if (Math.hypot(t.x - core.x, t.z - core.z) < 1.7) deliver(t, team);
    } else {
      if (t.state === "carried") t.state = "ground";
      t.y = groundY(t.x, t.z, false);
    }
    if (t.state === "delivered") return;
    carriers.forEach((c, i) => {
      const a = (i / Math.max(1, carriers.length)) * Math.PI * 2 + t.bob * 0.4;
      const rad = 0.62;
      let x = t.x + Math.cos(a) * rad;
      let z = t.z + Math.sin(a) * rad;
      if (!free(x, z, c.type === "orb")) {
        x = t.x;
        z = t.z;
      }
      c.x += (x - c.x) * Math.min(1, dt * 6);
      c.z += (z - c.z) * Math.min(1, dt * 6);
      c.y = groundY(c.x, c.z, c.type === "orb");
      c.facing = dampAngle(c.facing, Math.atan2(t.x - c.x, t.z - c.z) + Math.PI, dt, 8);
    });
  }

  function guardClear(t) {
    const g = guardOf(t);
    if (!g) return true;
    return dist(g, t) > 7.5;
  }

  function deliver(t, team) {
    t.state = "delivered";
    t.mesh.visible = false;
    G.scores[team] += t.value;
    G.stats[team].delivered++;
    cores[team].pulse = 1;
    audio.score();
    puff(cores[team].x, cores[team].mesh.position.y + 1.1, cores[team].z, 10, team === "player" ? 0xf0c14a : 0x9eb6ff);
    G.floaters.push({
      x: cores[team].x,
      y: cores[team].mesh.position.y + 1.6,
      z: cores[team].z,
      text: `+${t.value}`,
      life: 1.35,
      team,
    });
    if (team === "rival") {
      G.toast = `Vesper banked +${t.value}`;
      G.toastT = 2.3;
    } else {
      G.toast = `Heartstone +${t.value}`;
      G.toastT = 2.0;
    }
    for (const c of creatures) {
      if (c.carryId === t.id) {
        c.carryId = null;
        if (c.state === "carry") c.state = "follow";
      }
    }
    if (G.scores[team] >= SCORE_LIMIT && !G.winner) finish("score");
  }

  function finish(reason) {
    if (G.phase === "end") return;
    G.phase = "end";
    G.endReason = reason;
    if (G.scores.player > G.scores.rival) G.winner = "player";
    else if (G.scores.rival > G.scores.player) G.winner = "rival";
    else G.winner = "draw";
    audio.victory();
  }

  function preferType(mode, target) {
    if (mode === "work" && target?.kind === "bramble") return "tri";
    if (mode === "work" && target?.kind === "boulder") return "sq";
    if (mode === "fight" && target?.kind === "lizard") return "tri";
    if (mode === "fight" && target?.kind === "helm") return "orb";
    if (mode === "fight" && (target?.kind === "pebble" || target?.kind === "menhir")) return "sq";
    if (mode === "haul" && target?.weight >= 3) return "sq";
    return "all";
  }

  function hasReady(type) {
    return creatures.some((c) => c.team === "rival" && ready(c) && (type === "all" || c.type === type));
  }

  function thinkAI() {
    const easy = G.diff === "easy";
    const me = explorers.rival;
    const owned = creatures.filter((c) => c.team === "rival" && c.state !== "hidden").length;
    const idle = creatures.filter((c) => c.team === "rival" && ready(c));
    let hidden = null;
    let hd = 1e9;
    for (const c of creatures) {
      if (c.state !== "hidden" || locked(c.requires)) continue;
      const d = dist(me, c);
      if (d < hd) {
        hd = d;
        hidden = c;
      }
    }
    if (hidden && (owned < 6 || hd < 16)) {
      G.ai.mode = "discover";
      G.ai.goal = hidden;
      G.ai.throwAt = null;
      return;
    }
    const fight = creatures.find((c) => c.team === "rival" && c.alive && c.state === "fight");
    if (fight && idle.length && dist(me, fight) < 24) {
      G.ai.mode = "fight";
      G.ai.goal = fight.target || fight;
      G.ai.throwAt = fight.target || fight;
      return;
    }
    let best = null;
    let bestS = 0;
    for (const t of treasures) {
      if (t.state === "delivered") continue;
      const d = dist(me, t);
      if (locked(t.requires)) {
        const b = blockers.find((x) => x.id === t.requires && x.alive);
        const mech = mechs.find((x) => x.id === t.requires && !x.done);
        if (!b && !mech) continue;
        const have = b ? hasReady(b.kind === "bramble" ? "tri" : "sq") : hasReady("orb");
        if (!have) continue;
        const s = (t.value / (16 + d * 0.5)) * (easy ? 0.5 : 0.85);
        if (s > bestS) {
          bestS = s;
          best = { t, via: b || mech, mode: b ? "work" : "channel" };
        }
        continue;
      }
      const g = guardOf(t);
      const threat = g ? (g.kind === "menhir" ? 10 : g.kind === "pebble" ? 5 : 2.2) : 0;
      let s = t.value / (9 + d * 0.42 + threat * 5);
      if (G.elapsed < (easy ? 130 : 80) && t.x < 8) s *= 0.35;
      if (!easy && G.elapsed > 100 && t.kind === "diadem") s *= 2.1;
      if (easy && t.kind === "diadem" && G.elapsed < 200) s *= 0.25;
      const havePower = contribution(idle) + contribution(creatures.filter((c) => c.team === "rival" && c.carryId === t.id));
      if (havePower < t.weight * 0.75) s *= 0.4;
      if (t.team === "player" && t.state === "carried") {
        if (!easy && idle.length >= 2) s *= 1.35;
        else s *= 0.2;
      }
      if (s > bestS) {
        bestS = s;
        best = { t, via: g && dist(g, t) < 10 ? g : t, mode: g && dist(g, t) < 10 ? "fight" : "haul" };
      }
    }
    if (best) {
      G.ai.mode = best.mode;
      G.ai.goal = best.via;
      G.ai.throwAt = best.via;
      if (best.mode === "haul") {
        const power = contribution(creatures.filter((c) => c.alive && c.carryId === best.t.id && c.team === "rival"));
        if (power >= best.t.weight + 0.4) G.ai.throwAt = null;
      }
      return;
    }
    if (hidden) {
      G.ai.mode = "discover";
      G.ai.goal = hidden;
      G.ai.throwAt = null;
      return;
    }
    const scouts = [
      [42, -16],
      [28, -30],
      [12, -38],
      [4, 30],
      [0, -2],
      [20, -8],
      [36, 6],
    ];
    G.ai.scout = (G.ai.scout + 1) % scouts.length;
    const s = scouts[G.ai.scout];
    G.ai.mode = "scout";
    G.ai.goal = { x: s[0], z: s[1] };
    G.ai.throwAt = null;
  }

  function updateAI(dt) {
    const easy = G.diff === "easy";
    const me = explorers.rival;
    G.ai.t -= dt;
    if (G.ai.t <= 0) {
      G.ai.t = easy ? 0.68 : 0.34;
      thinkAI();
    }
    const goal = G.ai.goal;
    if (goal) driveExplorer(me, goal.x, goal.z, dt);
    else {
      me.wishX = 0;
      me.wishZ = 0;
    }
    const at = G.ai.throwAt;
    if (!at || G.ai.mode === "discover" || G.ai.mode === "channel") return;
    const d = dist(me, at);
    if (d > THROW_RANGE - 0.4) return;
    G.ai.throwCd -= dt;
    if (G.ai.throwCd > 0) return;
    let type = preferType(G.ai.mode, at);
    if (!hasReady(type)) type = "all";
    if (!hasReady(type)) return;
    if (throwReady("rival", type, at.x, at.z)) G.ai.throwCd = easy ? 0.52 : 0.25;
  }

  function rayAim(camera) {
    if (!camera) return;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(world.terrain, false);
    if (!hits.length) {
      aim.ok = false;
      return;
    }
    aim.x = hits[0].point.x;
    aim.z = hits[0].point.z;
    aim.ok = true;
  }

  function playerAimSpot() {
    const from = explorers.player;
    let x = aim.x;
    let z = aim.z;
    const dx = x - from.x;
    const dz = z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > THROW_RANGE) {
      x = from.x + (dx / d) * THROW_RANGE;
      z = from.z + (dz / d) * THROW_RANGE;
    }
    const swim = G.selection === "orb";
    return world.nav.nearestWalkable(x, z, swim, 6);
  }

  function update(dt, input, camera) {
    dt = Math.min(dt, 0.05);
    G.clock += dt;
    const waterShader = world.waterMat?.userData?.shader;
    if (waterShader) waterShader.uniforms.uTime.value = G.clock;
    if (world.fallMat?.uniforms) world.fallMat.uniforms.uTime.value = G.clock;
    const sh = world.grass.mat.userData.shader;
    if (sh) sh.uniforms.uTime.value = G.clock;
    audio.update(dt, G.paused || G.phase !== "play");
    G.shake = Math.max(0, G.shake - dt * 0.6);
    G.toastT = Math.max(0, G.toastT - dt);

    if (input?.pointerNdc) {
      pointer.copy(input.pointerNdc);
      rayAim(camera);
    }

    if (G.phase === "menu") {
      syncVisuals(dt);
      return;
    }
    if (G.paused || G.phase === "end") {
      syncVisuals(dt);
      return;
    }

    G.elapsed += dt;
    G.remain -= dt;
    if (G.remain <= 0) {
      G.remain = 0;
      finish("time");
    }

    const player = explorers.player;
    if (input) {
      const yaw = input.yaw || 0;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      let ix = 0;
      let iz = 0;
      if (input.forward) iz += 1;
      if (input.back) iz -= 1;
      if (input.rightKey) ix += 1;
      if (input.leftKey) ix -= 1;
      const len = Math.hypot(ix, iz) || 1;
      if (ix || iz) {
        player.wishX = (fx * iz + rx * ix) / len;
        player.wishZ = (fz * iz + rz * ix) / len;
        player.running = !!input.run;
      } else {
        player.wishX = 0;
        player.wishZ = 0;
        player.running = false;
      }
      if (input.select) G.selection = input.select;
      if (input.mouseLeft && aim.ok && G.selection) {
        G.throwCd -= dt;
        if (input.leftEdge || G.throwCd <= 0) {
          const spot = playerAimSpot();
          if (spot) {
            const ok = throwReady("player", G.selection, spot.x, spot.z);
            if (ok) {
              G.didThrow = true;
              G.throwCd = 0.12;
            } else if (input.leftEdge) {
              G.toast = "None of those creatures are free to throw";
              G.toastT = 1.3;
              G.throwCd = 0.3;
            }
          }
        }
      } else if (!input.mouseLeft) G.throwCd = 0;
      if (input.mouseLeft && !G.selection && input.leftEdge) {
        G.toast = "Press 1, 2, 3 or F to choose creatures";
        G.toastT = 1.6;
      }
      if (input.mouseRight && aim.ok) {
        G.whistleCd -= dt;
        if (input.rightEdge || G.whistleCd <= 0) {
          doWhistle("player", aim.x, aim.z);
          G.didWhistle = true;
          G.whistleCd = 0.46;
        }
      } else if (!input.mouseRight) G.whistleCd = 0;
    }

    updateAI(dt);
    integrateExplorer(explorers.player, dt);
    integrateExplorer(explorers.rival, dt);
    updateDiscovery();
    for (const c of creatures) updateCreature(c, dt);
    for (const e of enemies) updateEnemy(e, dt);
    for (const t of treasures) updateTreasure(t, dt);
    for (const b of blockers) b.shake = Math.max(0, b.shake - dt);
    for (const core of Object.values(cores)) core.pulse = Math.max(0, core.pulse - dt);
    for (const f of G.floaters) f.life -= dt;
    for (let i = G.floaters.length - 1; i >= 0; i--) if (G.floaters[i].life <= 0) G.floaters.splice(i, 1);
    syncVisuals(dt);
  }

  function syncVisuals(dt) {
    const t = G.clock;
    for (const ex of Object.values(explorers)) {
      const sp = Math.hypot(ex.vx, ex.vz);
      const parts = ex.mesh.userData.parts;
      const swing = Math.sin(ex.bob * (ex.running ? 14 : 10)) * Math.min(1, sp / 3);
      parts.legL.rotation.x = swing * 0.9;
      parts.legR.rotation.x = -swing * 0.9;
      parts.armL.rotation.x = -swing * 0.6;
      parts.armR.rotation.x = swing * 0.6;
      parts.cape.rotation.x = 0.28 + Math.sin(t * 2 + (ex.team === "player" ? 0 : 1)) * 0.05 + Math.min(0.25, sp * 0.03);
      parts.scarf.rotation.z = -0.4 + Math.sin(t * 3) * 0.1;
      ex.mesh.position.set(ex.x, ex.y + Math.abs(Math.sin(ex.bob * 10)) * 0.03 * Math.min(1, sp), ex.z);
      ex.mesh.rotation.y = ex.facing;
      const eyes = ex.mesh.userData.eyes || [];
      const blink = Math.sin(t * 0.7 + ex.x) > 0.97;
      eyes.forEach((e) => (e.scale.y = blink ? 0.15 : 1));
    }
    for (const c of creatures) {
      const parts = c.mesh.userData.parts;
      if (c.state === "hidden") {
        const ex = explorers.player;
        const d = dist(ex, c);
        const show = d < 5.2 && !locked(c.requires) && Math.sin(t * 3 + c.bob) > 0.55;
        const rustle = d < 5.2 ? 0.18 : 0.05;
        c.hideMesh.rotation.y = Math.sin(t * 2.2 + c.bob) * rustle;
        c.hideMesh.position.y = c.y + Math.sin(t * 4 + c.bob) * (d < 4 ? 0.03 : 0);
        if (c.hideMesh.userData.peek) c.hideMesh.userData.peek.forEach((p) => (p.visible = show));
        if (c.hideMesh.userData.parts?.rock) {
          c.hideMesh.userData.parts.rock.rotation.z = Math.sin(t * 2 + c.bob) * (d < 4.5 ? 0.08 : 0.02);
        }
        continue;
      }
      const selected =
        c.team === "player" &&
        ready(c) &&
        G.selection &&
        (G.selection === "all" || G.selection === c.type);
      parts.marker.visible = selected;
      const defeated = c.state === "defeated";
      parts.body.visible = !defeated;
      parts.belly.visible = !defeated;
      parts.footL.visible = !defeated;
      parts.footR.visible = !defeated;
      parts.spirit.visible = defeated;
      if (defeated) {
        parts.spirit.position.y = 0.35 + Math.sin(t * 6) * 0.06;
        parts.spirit.rotation.y += dt * 3;
      }
      (c.mesh.userData.eyes || []).forEach((e) => {
        e.visible = !defeated;
        e.scale.y = c.blink < 0.12 ? 0.15 : 1;
      });
      let bob = 0;
      if (c.state === "follow" || c.state === "return" || c.state === "idle") {
        const sp = c.type === "tri" ? 11 : c.type === "sq" ? 8 : 9;
        bob = Math.abs(Math.sin(c.bob * sp)) * (c.type === "sq" ? 0.05 : 0.09);
        if (c.type === "tri") c.mesh.rotation.z = Math.sin(c.bob * sp) * 0.12;
        else c.mesh.rotation.z = Math.sin(c.bob * 4) * 0.04;
        if (c.type === "orb") {
          const s = 1 + Math.sin(c.bob * sp) * 0.06;
          parts.body.scale.set(1.05 / s, s, 1);
        }
      }
      if (c.state === "emerging") {
        const u = 1 - c.emerge / 0.42;
        c.mesh.scale.setScalar(0.2 + u * 0.8);
        bob = Math.sin(u * Math.PI) * 0.35;
      } else if (c.state !== "airborne") c.mesh.scale.setScalar(1);
      if (c.react > 0) bob += Math.sin((0.32 - c.react) * 20) * 0.12;
      if (c.lunge > 0) c.mesh.position.z = 0;
      const y = c.state === "airborne" ? c.y : c.y + bob;
      c.mesh.position.set(c.x, y, c.z);
      if (c.state !== "airborne") c.mesh.rotation.y = c.facing;
      if (c.flash > 0) parts.bodyMat.emissive.setHex(0xfff1d2);
      else parts.bodyMat.emissive.setHex(0x000000);
      if (c.lunge > 0) {
        c.mesh.position.x += Math.sin(c.facing) * 0.18;
        c.mesh.position.z += Math.cos(c.facing) * 0.18;
      }
    }
    for (const e of enemies) {
      if (!e.mesh.visible && !e.alive) continue;
      let bob = 0;
      if (e.alive && e.awake && e.kind === "lizard") bob = Math.sin(e.bob * 8) * 0.04;
      if (e.alive && e.kind === "nib") bob = Math.abs(Math.sin(e.bob * 6)) * 0.04;
      if (e.alive && !e.awake && e.kind === "pebble") bob = Math.sin(e.bob * 2) * 0.02;
      e.mesh.position.set(e.x, (e.alive ? e.y : e.mesh.position.y) + bob, e.z);
      if (e.alive) e.mesh.rotation.y = e.facing;
      if (e.kind === "menhir" && e.mesh.userData.parts.armL) {
        const swing = e.target ? Math.sin(e.bob * 3) * 0.4 : Math.sin(e.bob * 1.2) * 0.08;
        e.mesh.userData.parts.armL.rotation.z = 0.15 + swing;
        e.mesh.userData.parts.armR.rotation.z = -0.15 - swing;
      }
      if (e.kind === "lizard" && e.mesh.userData.parts.tail) {
        e.mesh.userData.parts.tail.rotation.z = Math.sin(e.bob * 6) * 0.3;
      }
    }
    for (const tr of treasures) {
      if (!tr.mesh.visible) continue;
      tr.mesh.position.set(tr.x, tr.y + Math.sin(tr.bob * 2) * 0.06, tr.z);
      if (tr.mesh.userData.spin) tr.mesh.userData.spin.rotation.y += dt * (tr.state === "carried" ? 1.2 : 0.8);
      const dim = locked(tr.requires) ? 0.25 : 0.55;
      tr.sprite.material.opacity = dim + Math.sin(tr.bob * 3) * 0.08;
    }
    for (const b of blockers) {
      if (!b.mesh.visible) continue;
      b.mesh.position.set(b.x, groundY(b.x, b.z, false), b.z);
      b.mesh.rotation.z = Math.sin(G.clock * 18) * b.shake * 0.4;
    }
    for (const m of mechs) {
      const orb = m.mesh.userData.parts.orb;
      orb.position.y = 0.55 + Math.sin(G.clock * 2 + m.x) * 0.05;
      if (!m.done && m.progress > 0) orb.material.emissive.setHex(0x7fe7ea);
    }
    for (const core of Object.values(cores)) {
      const gem = core.mesh.userData.parts.gem;
      gem.rotation.y += dt * 0.8;
      gem.position.y = 1.15 + Math.sin(G.clock * 2) * 0.08 + core.pulse * 0.2;
      const s = 1 + core.pulse * 0.35 + Math.sin(G.clock * 3) * 0.04;
      gem.scale.setScalar(s);
      core.mesh.userData.parts.ring.rotation.z += dt * 0.3;
    }
    const spot = G.phase === "play" && aim.ok ? playerAimSpot() : null;
    const showAim = !!(spot && G.selection && creatures.some((c) => c.team === "player" && ready(c) && (G.selection === "all" || c.type === G.selection)));
    aimRing.material.opacity = showAim ? 0.75 + Math.sin(G.clock * 6) * 0.15 : 0;
    arcLine.material.opacity = showAim ? 0.55 : 0;
    if (showAim) {
      const col = G.selection === "tri" ? 0xffc83a : G.selection === "sq" ? 0xe14b38 : G.selection === "orb" ? 0x3ec6d6 : 0xfff3d0;
      aimRing.material.color.setHex(col);
      arcLine.material.color.setHex(col);
      const y = groundY(spot.x, spot.z, G.selection === "orb");
      aimRing.position.set(spot.x, y + 0.08, spot.z);
      const from = explorers.player;
      const y0 = from.y + 0.8;
      const y1 = y;
      const arcH = Math.max(1.2, Math.hypot(spot.x - from.x, spot.z - from.z) * 0.22);
      for (let i = 0; i < 16; i++) {
        const u = i / 15;
        arcArr[i * 3] = from.x + (spot.x - from.x) * u;
        arcArr[i * 3 + 1] = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * arcH;
        arcArr[i * 3 + 2] = from.z + (spot.z - from.z) * u;
      }
      arcGeo.attributes.position.needsUpdate = true;
      arcGeo.computeBoundingSphere();
    }
    for (const r of G.rings) {
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      r.life -= dt;
      const u = 1 - r.life / 0.7;
      r.mesh.visible = true;
      r.mesh.position.set(r.x, groundY(r.x, r.z, false) + 0.1, r.z);
      const s = 0.4 + u * WHISTLE_RADIUS;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - u) * 0.7;
    }
    for (const d of G.dusts) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      d.vy -= dt * 2;
      d.mesh.position.set(d.x, d.y, d.z);
      d.mesh.material.opacity = Math.max(0, d.life * 2);
      if (d.life <= 0) d.mesh.visible = false;
    }
  }

  function counts(team) {
    const out = { tri: 0, sq: 0, orb: 0, triReady: 0, sqReady: 0, orbReady: 0, total: 0 };
    for (const c of creatures) {
      if (c.team !== team || c.state === "hidden") continue;
      out.total++;
      if (c.state === "defeated") continue;
      out[c.type]++;
      if (ready(c)) out[c.type + "Ready"]++;
    }
    return out;
  }

  function hint() {
    if (G.toastT > 0) return G.toast;
    const owned = creatures.filter((c) => c.team === "player" && c.state !== "hidden").length;
    if (owned === 0) return "Walk toward rustling bushes, logs and rocks. You start with no creatures.";
    if (!G.didThrow) return "Press 1, 2 or 3 — left click throws the chosen creature toward the cursor.";
    if (!G.didWhistle) return "Right-click whistles at the cursor. Carriers keep their task.";
    if (G.scores.player === 0) return "Thrown creatures pick up sunfruits and carry them to your heartstone.";
    if (G.elapsed < 70) return "Yellows are quick, reds smash and haul, blues open ancient crossings.";
    return "";
  }

  function getHud() {
    return {
      phase: G.phase,
      paused: G.paused,
      diff: G.diff,
      remain: G.remain,
      scores: { ...G.scores },
      selection: G.selection,
      player: counts("player"),
      rival: counts("rival"),
      hint: G.phase === "play" ? hint() : "",
      winner: G.winner,
      endReason: G.endReason,
      stats: G.stats,
      names: { player: "Lark", rival: "Vesper" },
      floaters: G.floaters.map((f) => ({ ...f })),
      muted: audio.muted,
      shake: G.shake,
    };
  }

  function selfTest() {
    const errors = [];
    reset();
    const hidden = creatures.filter((c) => c.state === "hidden").length;
    if (hidden !== LEVEL.creatures.length) errors.push("hidden " + hidden);
    explorers.player.x = -46;
    explorers.player.z = 12.2;
    update(0.05, blankInput(), null);
    const c1 = creatures.find((c) => c.id === "c1");
    if (!c1 || c1.state === "hidden") errors.push("discover failed " + c1?.state);
    c1.state = "follow";
    c1.alive = true;
    c1.team = "player";
    G.selection = "tri";
    launch(c1, explorers.player.x + 5, explorers.player.z + 1, explorers.player);
    if (c1.state !== "airborne") errors.push("not airborne");
    for (let i = 0; i < 30; i++) update(0.05, blankInput(), null);
    if (c1.state === "airborne") errors.push("stuck airborne " + c1.state);
    const fruit = treasures.find((t) => t.id === "t2");
    fruit.x = LEVEL.player.core[0] + 0.3;
    fruit.z = LEVEL.player.core[1] + 0.2;
    fruit.y = groundY(fruit.x, fruit.z, false);
    c1.state = "carry";
    c1.alive = true;
    c1.carryId = fruit.id;
    fruit.state = "ground";
    update(0.05, blankInput(), null);
    if (G.scores.player < 12) errors.push("score " + G.scores.player);
    const meshCount = root.children.length;
    reset();
    if (G.scores.player !== 0) errors.push("reset score");
    if (creatures.filter((c) => c.state === "hidden").length !== LEVEL.creatures.length) errors.push("reset creatures");
    if (root.children.length !== meshCount) errors.push("mesh leak " + root.children.length + " vs " + meshCount);
    const rx = explorers.rival.x;
    for (let i = 0; i < 40; i++) update(0.1, blankInput(), null);
    const recruited = creatures.filter((c) => c.team === "rival").length;
    const moved = Math.hypot(explorers.rival.x - rx, explorers.rival.z - LEVEL.rival.start[1]);
    if (recruited === 0 && moved < 1) errors.push("ai stalled");
    const path = world.nav.findPath(LEVEL.player.start[0], LEVEL.player.start[1], 0, -2, false);
    if (!path) errors.push("no path to plateau");
    reset();
    return { ok: errors.length === 0, errors, recruited, moved: +moved.toFixed(1) };
  }

  function blankInput() {
    return {
      forward: false,
      back: false,
      leftKey: false,
      rightKey: false,
      run: false,
      yaw: 0.8,
      pointerNdc: null,
      mouseLeft: false,
      mouseRight: false,
      leftEdge: false,
      rightEdge: false,
      select: null,
    };
  }

  return {
    update,
    reset,
    start(diff) {
      if (diff) G.diff = diff;
      reset();
      audio.start();
    },
    setPaused(v) {
      G.paused = v;
    },
    togglePause() {
      if (G.phase !== "play") return;
      G.paused = !G.paused;
    },
    setDiff(d) {
      G.diff = d;
    },
    getDiff: () => G.diff,
    focus() {
      const p = explorers.player;
      return { x: p.x, y: p.y + 0.75, z: p.z };
    },
    getHud,
    selfTest,
    phase: () => G.phase,
  };
}
