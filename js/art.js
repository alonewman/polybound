import * as THREE from "three";

export const outlineMat = new THREE.MeshBasicMaterial({
  color: 0x1a2822,
  side: THREE.BackSide,
});

export function lambert(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}

export function smoothMat(color) {
  return new THREE.MeshLambertMaterial({ color, flatShading: false });
}

function outline(mesh, scale = 1.06) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(scale);
  o.castShadow = false;
  o.receiveShadow = false;
  mesh.add(o);
  return mesh;
}

function eyePair(parent, y, z, s = 0.055) {
  const white = smoothMat(0xfffaf4);
  const pupilMat = smoothMat(0x1c1916);
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(s, 8, 6), white);
    e.position.set(sx * s * 2.15, y, z);
    const p = new THREE.Mesh(new THREE.SphereGeometry(s * 0.48, 6, 5), pupilMat);
    p.position.set(0, 0, s * 0.72);
    e.add(p);
    e.userData.pupil = p;
    parent.add(e);
    eyes.push(e);
  }
  return eyes;
}

export function createExplorer(team) {
  const g = new THREE.Group();
  const player = team === "player";
  const cloth = lambert(player ? 0x2c6d62 : 0x51487f);
  const capeM = lambert(player ? 0xc4623a : 0x8d4d78);
  const skin = lambert(0xf0c29a);
  const leather = lambert(0x6a4630);
  const trim = lambert(player ? 0xe7c27a : 0xf2d7a2);

  const legGeo = new THREE.CapsuleGeometry(0.065, 0.2, 2, 5);
  const legL = new THREE.Mesh(legGeo, leather);
  const legR = new THREE.Mesh(legGeo, leather);
  legL.position.set(-0.09, 0.2, 0);
  legR.position.set(0.09, 0.2, 0);
  legL.castShadow = legR.castShadow = true;

  const torso = outline(new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.26, 3, 6), cloth));
  torso.position.y = 0.56;
  torso.castShadow = true;

  const cape = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.58, 5), capeM);
  cape.position.set(0, 0.58, 0.02);
  cape.rotation.x = 0.35;
  cape.castShadow = true;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skin);
  head.position.set(0, 0.86, 0.03);
  head.castShadow = true;

  const hood = outline(new THREE.Mesh(new THREE.SphereGeometry(0.175, 8, 6), cloth), 1.08);
  hood.position.set(0, 0.94, 0.01);
  hood.scale.set(1.02, 1.18, 1.08);
  hood.castShadow = true;

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), cloth);
  tip.position.set(0, 1.16, 0);

  const armGeo = new THREE.CapsuleGeometry(0.048, 0.16, 2, 4);
  const armL = new THREE.Mesh(armGeo, cloth);
  const armR = new THREE.Mesh(armGeo, cloth);
  armL.position.set(-0.22, 0.6, 0.02);
  armR.position.set(0.22, 0.6, 0.02);
  armL.rotation.z = 0.35;
  armR.rotation.z = -0.35;
  armL.castShadow = armR.castShadow = true;

  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.2), trim);
  scarf.position.set(0.14, 0.74, 0.1);
  scarf.rotation.z = -0.4;

  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.07), leather);
  satchel.position.set(-0.15, 0.55, -0.08);

  const bootGeo = new THREE.BoxGeometry(0.09, 0.06, 0.12);
  const bootL = new THREE.Mesh(bootGeo, leather);
  const bootR = new THREE.Mesh(bootGeo, leather);
  bootL.position.set(-0.09, 0.04, 0.02);
  bootR.position.set(0.09, 0.04, 0.02);

  g.add(bootL, bootR, legL, legR, torso, cape, head, hood, tip, armL, armR, scarf, satchel);
  const eyes = eyePair(g, 0.88, 0.14, 0.035);

  if (!player) {
    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 3), trim);
    flag.position.set(0.18, 1.28, 0);
    flag.rotation.z = -0.7;
    g.add(flag);
    g.userData.flag = flag;
  }

  g.userData.parts = { legL, legR, armL, armR, cape, scarf, torso };
  g.userData.eyes = eyes;
  g.scale.setScalar(1.16);
  g.traverse((o) => {
    if (o.isMesh) o.castShadow = o.material !== outlineMat;
  });
  return g;
}

const TYPE_COLOR = { tri: 0xffc83a, sq: 0xe14b38, orb: 0x3ec6d6 };

export function createCreature(type, team) {
  const g = new THREE.Group();
  const bodyMat = lambert(TYPE_COLOR[type], { emissive: 0x000000 });
  let body;
  if (type === "tri") {
    body = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 3), bodyMat);
    body.position.y = 0.28;
    body.scale.z = 0.78;
  } else if (type === "sq") {
    body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.42), bodyMat);
    body.position.y = 0.24;
  } else {
    body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), bodyMat);
    body.position.y = 0.26;
  }
  body.castShadow = true;
  outline(body, type === "orb" ? 1.07 : 1.08);
  g.add(body);

  const bellyColor = team === "rival" ? 0xb7a4ef : 0xfff3d4;
  const belly = new THREE.Mesh(
    type === "sq" ? new THREE.BoxGeometry(0.2, 0.16, 0.06) : new THREE.SphereGeometry(0.1, 6, 5),
    lambert(bellyColor)
  );
  belly.position.set(0, type === "sq" ? 0.22 : 0.24, type === "orb" ? 0.18 : 0.16);
  if (type === "orb") belly.scale.set(1.1, 0.8, 0.45);
  g.add(belly);

  const eyes = eyePair(g, type === "sq" ? 0.32 : 0.36, type === "orb" ? 0.2 : 0.22, type === "sq" ? 0.055 : 0.05);

  const footGeo = new THREE.SphereGeometry(0.06, 5, 4);
  const footMat = lambert(0x5c4636);
  const footL = new THREE.Mesh(footGeo, footMat);
  const footR = new THREE.Mesh(footGeo, footMat);
  footL.position.set(-0.09, 0.04, 0.04);
  footR.position.set(0.09, 0.04, 0.04);
  footL.scale.y = footR.scale.y = 0.6;
  g.add(footL, footR);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.2, type === "tri" ? 3 : type === "sq" ? 4 : 10),
    new THREE.MeshBasicMaterial({ color: TYPE_COLOR[type], side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.03;
  marker.visible = false;
  g.add(marker);

  const spirit = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.12, 0),
    new THREE.MeshBasicMaterial({ color: TYPE_COLOR[type], transparent: true, opacity: 0.85 })
  );
  spirit.position.y = 0.4;
  spirit.visible = false;
  g.add(spirit);

  g.userData.parts = { body, bodyMat, belly, footL, footR, marker, spirit };
  g.userData.eyes = eyes;
  g.userData.type = type;
  return g;
}

export function createEnemy(kind) {
  const g = new THREE.Group();
  const parts = {};
  if (kind === "nib") {
    const body = outline(new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 6), lambert(0x6e9348)));
    body.scale.set(1, 1.15, 0.9);
    body.position.y = 0.32;
    body.castShadow = true;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), lambert(0x7ea356));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.34, 0.28);
    const earGeo = new THREE.ConeGeometry(0.07, 0.18, 4);
    const earL = new THREE.Mesh(earGeo, lambert(0x6e9348));
    const earR = new THREE.Mesh(earGeo, lambert(0x6e9348));
    earL.position.set(-0.18, 0.5, 0);
    earR.position.set(0.18, 0.5, 0);
    earL.rotation.z = 0.5;
    earR.rotation.z = -0.5;
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 4), lambert(0x6b4a30));
    stick.position.set(0.22, 0.32, 0.08);
    stick.rotation.z = -0.8;
    g.add(body, nose, earL, earR, stick);
    parts.body = body;
    parts.eyes = eyePair(g, 0.4, 0.22, 0.045);
  } else if (kind === "lizard") {
    const body = outline(new THREE.Mesh(new THREE.SphereGeometry(0.28, 7, 5), lambert(0x2f8f68)));
    body.scale.set(1.7, 0.55, 0.72);
    body.position.y = 0.22;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), lambert(0x37a074));
    head.position.set(0, 0.28, 0.38);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.46, 5), lambert(0x277a58));
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, 0.2, -0.48);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.12, 5, 4), lambert(0xd9c7a4));
    belly.scale.set(1.4, 0.4, 0.8);
    belly.position.set(0, 0.12, 0.05);
    g.add(body, head, tail, belly);
    parts.body = body;
    parts.tail = tail;
    parts.eyes = eyePair(head, 0.04, 0.12, 0.035);
  } else if (kind === "pebble") {
    const mats = [lambert(0x9a8d78), lambert(0x8b7f6c), lambert(0xaea28e)];
    const scales = [0.42, 0.34, 0.24];
    let y = 0.18;
    const rocks = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(scales[i], 0), mats[i]);
      r.position.y = y;
      r.rotation.set(i, i * 1.3, 0.4);
      r.castShadow = true;
      if (i === 0) outline(r, 1.04);
      g.add(r);
      rocks.push(r);
      y += scales[i] + 0.12;
    }
    const moss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 5, 4), lambert(0x6d9452));
    moss.position.set(0.12, 0.42, 0.08);
    moss.scale.y = 0.5;
    g.add(moss);
    parts.rocks = rocks;
    parts.body = rocks[1];
    parts.eyes = eyePair(g, 0.72, 0.18, 0.04);
    parts.eyes.forEach((e) => (e.scale.y = 0.15));
  } else if (kind === "helm") {
    const body = outline(new THREE.Mesh(new THREE.SphereGeometry(0.26, 7, 6), lambert(0x8a5a3a)));
    body.scale.set(1.05, 0.85, 1.2);
    body.position.y = 0.28;
    body.castShadow = true;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 5), lambert(0xb08a55));
    shell.scale.set(1, 0.55, 1.05);
    shell.position.y = 0.42;
    shell.castShadow = true;
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.34, 0.06), lambert(0xd7c39a));
    shield.position.set(0.22, 0.32, 0.16);
    g.add(body, shell, shield);
    parts.body = body;
    parts.shield = shield;
    parts.eyes = eyePair(g, 0.34, 0.24, 0.035);
  } else {
    const stone = lambert(0x8e877c, { emissive: 0x000000 });
    const body = outline(new THREE.Mesh(new THREE.BoxGeometry(0.78, 2.15, 0.5), stone), 1.04);
    body.position.y = 1.15;
    body.castShadow = true;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.62), lambert(0x7d776c));
    cap.position.y = 2.28;
    cap.castShadow = true;
    const armGeo = new THREE.BoxGeometry(0.22, 0.85, 0.22);
    const armL = new THREE.Mesh(armGeo, lambert(0x847d72));
    const armR = new THREE.Mesh(armGeo, lambert(0x847d72));
    armL.position.set(-0.58, 1.25, 0);
    armR.position.set(0.58, 1.25, 0);
    armL.castShadow = armR.castShadow = true;
    const moss = new THREE.Mesh(new THREE.SphereGeometry(0.16, 5, 4), lambert(0x6a8f4e));
    moss.position.set(-0.2, 1.7, 0.22);
    moss.scale.set(1.4, 0.5, 0.6);
    g.add(body, cap, armL, armR, moss);
    parts.body = body;
    parts.bodyMat = stone;
    parts.armL = armL;
    parts.armR = armR;
    parts.eyes = eyePair(g, 1.55, 0.28, 0.06);
  }
  g.userData.parts = parts;
  g.userData.eyes = parts.eyes || [];
  return g;
}

export function createTreasure(kind) {
  const g = new THREE.Group();
  let mesh;
  let glow = 0xf0c14a;
  if (kind === "fruit") {
    mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), lambert(0xf0c14a, { emissive: 0x5a3d10 }));
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 4), lambert(0x6a9a48));
    leaf.position.y = 0.2;
    g.add(leaf);
  } else if (kind === "shard") {
    mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), lambert(0xf4e2a8, { emissive: 0x4a3a18 }));
    glow = 0xf4e2a8;
  } else if (kind === "cup") {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.08, 0.16, 6), lambert(0xe6c878, { emissive: 0x3a3010 }));
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), lambert(0xf0d48a, { emissive: 0x3a3010 }));
    bowl.scale.y = 0.55;
    bowl.position.y = 0.12;
    g.add(bowl);
    glow = 0xf0d48a;
  } else if (kind === "crystal") {
    mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), lambert(0x8ee7ea, { emissive: 0x14585c }));
    mesh.scale.y = 1.45;
    glow = 0x7adbd8;
  } else if (kind === "idol") {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.12), lambert(0xd4883a, { emissive: 0x4a2a08 }));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.12), lambert(0xe09a48, { emissive: 0x4a2a08 }));
    head.position.y = 0.22;
    g.add(head);
    glow = 0xe09a48;
  } else {
    mesh = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 5, 10), lambert(0xf2d36a, { emissive: 0x5a4010 }));
    mesh.rotation.x = Math.PI / 2;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), lambert(0x7fd0e8, { emissive: 0x145058 }));
    gem.position.y = 0.12;
    g.add(gem);
    glow = 0xf2d36a;
  }
  mesh.castShadow = true;
  mesh.position.y = 0.22;
  g.add(mesh);
  g.userData.spin = mesh;
  g.userData.glow = glow;
  return g;
}

export function createCore(team) {
  const g = new THREE.Group();
  const player = team === "player";
  const stone = lambert(0xb7aa96);
  const dark = lambert(0x8c8172);
  const dais = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.28, 0.35, 8), stone);
  dais.position.y = 0.18;
  dais.castShadow = true;
  dais.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 5, 10), dark);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.55;
  const gemMat = lambert(player ? 0xf0c14a : 0x8ea2ff, { emissive: player ? 0x8a5a12 : 0x243e88 });
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), gemMat);
  gem.position.y = 1.15;
  gem.castShadow = true;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.7, 0.16), i % 2 ? stone : dark);
    p.position.set(Math.cos(a) * 0.78, 0.7, Math.sin(a) * 0.78);
    p.castShadow = true;
    g.add(p);
  }
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.45, 3.2, 6, 1, true),
    new THREE.MeshBasicMaterial({
      color: player ? 0xf0c14a : 0x9eb6ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  beam.position.y = 2.4;
  g.add(dais, ring, gem, beam);
  g.userData.parts = { gem, ring, gemMat, beam };
  return g;
}

export function createBlocker(kind) {
  const g = new THREE.Group();
  if (kind === "bramble") {
    const mat = lambert(0x4e6a32);
    const twig = lambert(0x6a4a32);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7 + (i % 3) * 0.12, 4), i % 2 ? mat : lambert(0x3f5c30));
      cone.position.set(Math.cos(a) * 0.45, 0.35, Math.sin(a) * 0.45);
      cone.rotation.z = Math.cos(a) * 0.4;
      cone.rotation.x = Math.sin(a) * 0.3;
      cone.castShadow = true;
      g.add(cone);
    }
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4), twig);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.3;
    g.add(log);
  } else {
    const rock = outline(new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), lambert(0x8d8478)), 1.03);
    rock.position.y = 0.55;
    rock.scale.set(1.1, 0.85, 1);
    rock.castShadow = true;
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.7), lambert(0x3e3832));
    crack.position.set(0.1, 0.55, 0.2);
    crack.rotation.z = 0.4;
    g.add(rock, crack);
    g.userData.parts = { rock };
  }
  return g;
}

export function createPedestal() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.35, 6), lambert(0xb3a894));
  base.position.y = 0.18;
  base.castShadow = true;
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    lambert(0x7fd4e4, { emissive: 0x0c3c44 })
  );
  orb.position.y = 0.55;
  g.add(base, orb);
  g.userData.parts = { orb };
  return g;
}

export function createHide(kind) {
  const g = new THREE.Group();
  if (kind === "bush" || kind === "reeds") {
    const mat = lambert(kind === "reeds" ? 0x7ea85a : 0x3f7a3c);
    const n = kind === "reeds" ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(kind === "reeds" ? 0.08 : 0.22, kind === "reeds" ? 0.55 : 0.48, 4), mat);
      leaf.position.set(Math.cos(a) * 0.18, 0.22, Math.sin(a) * 0.18);
      leaf.rotation.z = (i - 1) * 0.15;
      g.add(leaf);
    }
  } else if (kind === "log") {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 1.05, 6), lambert(0x7a5340));
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.22;
    log.castShadow = true;
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.12, 6), lambert(0x241812));
    hole.position.set(0.53, 0.22, 0);
    hole.rotation.y = Math.PI / 2;
    g.add(log, hole);
  } else if (kind === "rock") {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), lambert(0x9a9084));
    rock.position.y = 0.28;
    rock.castShadow = true;
    rock.scale.set(1.1, 0.8, 0.95);
    g.add(rock);
    g.userData.parts = { rock };
  } else if (kind === "roots") {
    const mat = lambert(0x6b4e38);
    for (let i = 0; i < 3; i++) {
      const root = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 4), mat);
      root.position.set((i - 1) * 0.18, 0.15, 0);
      root.rotation.z = (i - 1) * 0.7;
      root.rotation.y = i;
      g.add(root);
    }
  } else {
    const rim = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.32, 8), lambert(0x6d5a48));
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.04;
    const pit = new THREE.Mesh(new THREE.CircleGeometry(0.16, 8), lambert(0x1a1410));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = 0.05;
    g.add(rim, pit);
  }
  const peek = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), smoothMat(0xfff6ea));
  const peek2 = peek.clone();
  peek.position.set(-0.05, 0.12, 0.12);
  peek2.position.set(0.05, 0.12, 0.12);
  peek.visible = peek2.visible = false;
  g.add(peek, peek2);
  g.userData.peek = [peek, peek2];
  return g;
}

export function createStonePad() {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.82, 0.22, 6), lambert(0xb7ad9e));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function glowTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,0.95)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.28)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
