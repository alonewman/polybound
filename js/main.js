import * as THREE from "three";
import { createAudio } from "./audio.js";
import { createSky } from "./world.js";
import { createGame } from "./sim.js";

const boot = document.getElementById("boot-error");

function fail(err) {
  console.error(err);
  boot.style.display = "block";
  boot.textContent = String(err?.stack || err);
}

try {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc5d8ea, 70, 200);
  scene.background = new THREE.Color(0x8eb4cc);
  scene.add(createSky());

  scene.add(new THREE.HemisphereLight(0xcfe3f2, 0x6d583c, 0.78));
  scene.add(new THREE.AmbientLight(0xfff4e4, 0.22));
  const sun = new THREE.DirectionalLight(0xffe2b5, 1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 140;
  const extent = 34;
  sun.shadow.camera.left = -extent;
  sun.shadow.camera.right = extent;
  sun.shadow.camera.top = extent;
  sun.shadow.camera.bottom = -extent;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.12, 460);
  const audio = createAudio();
  const game = createGame(scene, audio);

  let yaw = -2.2;
  let yawTarget = yaw;
  let dist = 13.2;
  let distTarget = 13.2;
  let menuSpin = 0.6;
  let blend = 1.4;
  let playingCam = false;
  const camPos = new THREE.Vector3(70, 48, 70);
  const look = new THREE.Vector3(0, 2, 0);
  const desired = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  let manual = false;

  const keys = new Set();
  const mouse = { x: 0, y: 0, left: false, right: false, leftEdge: false, rightEdge: false };
  let selectEdge = null;
  const ndc = new THREE.Vector2();
  const proj = new THREE.Vector3();

  const el = {
    time: document.getElementById("time"),
    sp: document.getElementById("score-player"),
    sr: document.getElementById("score-rival"),
    hint: document.getElementById("hint"),
    menu: document.getElementById("menu"),
    pause: document.getElementById("pause"),
    end: document.getElementById("end"),
    help: document.getElementById("help"),
    ntri: document.getElementById("n-tri"),
    nsq: document.getElementById("n-sq"),
    norb: document.getElementById("n-orb"),
    nall: document.getElementById("n-all"),
    mute: document.getElementById("btn-mute"),
    floaters: document.getElementById("floaters"),
    endTitle: document.getElementById("end-title"),
    endStats: document.getElementById("end-stats"),
  };

  function setDiff(diff) {
    game.setDiff(diff);
    document.getElementById("diff-normal").classList.toggle("active", diff === "normal");
    document.getElementById("diff-easy").classList.toggle("active", diff === "easy");
  }

  document.getElementById("diff-normal").onclick = () => setDiff("normal");
  document.getElementById("diff-easy").onclick = () => setDiff("easy");
  document.getElementById("btn-start").onclick = () => begin();
  document.getElementById("btn-resume").onclick = () => {
    game.setPaused(false);
    el.pause.classList.remove("show");
  };
  document.getElementById("btn-restart").onclick = () => {
    el.pause.classList.remove("show");
    begin();
  };
  document.getElementById("btn-again").onclick = () => {
    el.end.classList.remove("show");
    begin();
  };
  document.getElementById("btn-pause").onclick = () => togglePause();
  document.getElementById("btn-help").onclick = () => el.help.classList.add("show");
  document.getElementById("btn-help-close").onclick = () => el.help.classList.remove("show");
  document.getElementById("btn-mute").onclick = () => {
    const muted = audio.toggleMute();
    el.mute.textContent = muted ? "Muted" : "Sound";
  };
  document.getElementById("btn-rot-l").onclick = () => {
    yawTarget -= Math.PI / 2;
  };
  document.getElementById("btn-rot-r").onclick = () => {
    yawTarget += Math.PI / 2;
  };
  document.querySelectorAll(".pick").forEach((btn) => {
    btn.onclick = () => {
      selectEdge = btn.dataset.sel;
    };
  });

  function begin() {
    el.menu.classList.remove("show");
    el.end.classList.remove("show");
    el.pause.classList.remove("show");
    playingCam = true;
    blend = 1.15;
    manual = false;
    game.start(game.getDiff());
  }

  function togglePause() {
    if (game.phase() !== "play") return;
    const hud = game.getHud();
    const next = !hud.paused;
    game.setPaused(next);
    el.pause.classList.toggle("show", next);
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    const map = { Digit1: "tri", Digit2: "sq", Digit3: "orb", KeyF: "all" };
    if (map[e.code]) selectEdge = map[e.code];
    if (e.code === "KeyQ") yawTarget -= Math.PI / 2;
    if (e.code === "KeyE") yawTarget += Math.PI / 2;
    if (e.code === "Escape") togglePause();
    if (e.code === "KeyH") el.help.classList.toggle("show");
    if (e.code === "KeyM") document.getElementById("btn-mute").click();
    if (e.code === "KeyR" && e.shiftKey) begin();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  window.addEventListener("blur", () => keys.clear());

  window.addEventListener("mousemove", (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, .card")) return;
    if (e.button === 0) {
      mouse.left = true;
      mouse.leftEdge = true;
    }
    if (e.button === 2) {
      mouse.right = true;
      mouse.rightEdge = true;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener(
    "wheel",
    (e) => {
      distTarget = THREE.MathUtils.clamp(distTarget + Math.sign(e.deltaY) * 1.3, 9.5, 36);
    },
    { passive: true }
  );
  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function fmt(t) {
    const s = Math.max(0, Math.ceil(t));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  }

  function paint(hud) {
    el.time.textContent = fmt(hud.remain);
    el.time.classList.toggle("warn", hud.remain <= 60 && hud.phase === "play");
    el.sp.textContent = hud.scores.player;
    el.sr.textContent = hud.scores.rival;
    el.hint.textContent = hud.hint;
    el.ntri.textContent = hud.player.triReady;
    el.nsq.textContent = hud.player.sqReady;
    el.norb.textContent = hud.player.orbReady;
    el.nall.textContent = hud.player.triReady + hud.player.sqReady + hud.player.orbReady;
    document.querySelectorAll(".pick").forEach((btn) => btn.classList.toggle("active", btn.dataset.sel === hud.selection));
    if (hud.phase === "end" && !el.end.classList.contains("show")) {
      const name = hud.winner === "player" ? "Lark" : hud.winner === "rival" ? "Vesper" : null;
      el.endTitle.textContent = name ? `${name} claims the island` : "The island keeps its secret";
      const row = (label, a, b) => `<div>${label}<strong>${a}</strong></div><div>${label}<strong>${b}</strong></div>`;
      el.endStats.innerHTML = `
        <div>Lark<strong>${hud.scores.player}</strong></div>
        <div>Vesper<strong>${hud.scores.rival}</strong></div>
        ${row("Delivered", hud.stats.player.delivered, hud.stats.rival.delivered)}
        ${row("Recruited", hud.stats.player.recruited, hud.stats.rival.recruited)}
        ${row("Foes", hud.stats.player.foes, hud.stats.rival.foes)}
        ${row("Lost", hud.stats.player.losses, hud.stats.rival.losses)}
      `;
      el.end.classList.add("show");
    }
    el.floaters.innerHTML = "";
    for (const f of hud.floaters) {
      proj.set(f.x, f.y, f.z).project(camera);
      if (proj.z > 1) continue;
      const d = document.createElement("div");
      d.className = "floater";
      d.textContent = f.text;
      d.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
      d.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
      d.style.opacity = String(Math.max(0, Math.min(1, f.life)));
      el.floaters.appendChild(d);
    }
  }

  function updateCamera(dt, hud) {
    if (manual) return;
    if (!playingCam) {
      menuSpin += dt * 0.07;
      desired.set(Math.sin(menuSpin) * 86, 24, Math.cos(menuSpin) * 74);
      desiredLook.set(0, 1.2, 0);
      camPos.lerp(desired, 1 - Math.exp(-1.4 * dt));
      look.lerp(desiredLook, 1 - Math.exp(-1.4 * dt));
    } else {
      yaw += (yawTarget - yaw) * (1 - Math.exp(-4 * dt));
      dist += (distTarget - dist) * (1 - Math.exp(-5 * dt));
      blend = Math.min(7.2, blend + dt * 2.4);
      const focus = game.focus();
      const ox = Math.sin(yaw) * dist;
      const oz = Math.cos(yaw) * dist;
      desired.set(focus.x + ox, focus.y + dist * 0.62, focus.z + oz);
      desiredLook.set(focus.x, focus.y, focus.z);
      const k = 1 - Math.exp(-blend * dt);
      camPos.lerp(desired, k);
      look.lerp(desiredLook, k);
      if (hud.shake > 0) {
        camPos.x += Math.sin(performance.now() * 0.05) * hud.shake;
        camPos.y += Math.cos(performance.now() * 0.04) * hud.shake * 0.4;
      }
    }
    camera.position.copy(camPos);
    camera.lookAt(look);
    sun.position.set(look.x + 28, look.y + 46, look.z + 14);
    sun.target.position.copy(look);
    sun.target.updateMatrixWorld();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (document.hidden) {
      requestAnimationFrame(frame);
      return;
    }
    ndc.set((mouse.x / window.innerWidth) * 2 - 1, -(mouse.y / window.innerHeight) * 2 + 1);
    const input = {
      forward: keys.has("KeyW") || keys.has("ArrowUp"),
      back: keys.has("KeyS") || keys.has("ArrowDown"),
      leftKey: keys.has("KeyA") || keys.has("ArrowLeft"),
      rightKey: keys.has("KeyD") || keys.has("ArrowRight"),
      run: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      yaw,
      pointerNdc: ndc,
      mouseLeft: mouse.left,
      mouseRight: mouse.right,
      leftEdge: mouse.leftEdge,
      rightEdge: mouse.rightEdge,
      select: selectEdge,
    };
    game.update(dt, input, camera);
    mouse.leftEdge = false;
    mouse.rightEdge = false;
    selectEdge = null;
    const hud = game.getHud();
    updateCamera(dt, hud);
    paint(hud);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__POLY = {
    game,
    scene,
    camera,
    renderer,
    setView(x, y, z, lx, ly, lz) {
      manual = true;
      camera.position.set(x, y, z);
      camera.lookAt(lx, ly, lz);
      sun.position.set(lx + 28, ly + 46, lz + 14);
      sun.target.position.set(lx, ly, lz);
      sun.target.updateMatrixWorld();
    },
    auto() {
      manual = false;
    },
  };

  const params = new URLSearchParams(location.search);
  if (params.has("cam")) {
    const nums = params.get("cam").split(",").map(Number);
    if (nums.length === 6 && nums.every((n) => Number.isFinite(n))) {
      el.menu.classList.remove("show");
      manual = true;
      camera.position.set(nums[0], nums[1], nums[2]);
      camera.lookAt(nums[3], nums[4], nums[5]);
      look.set(nums[3], nums[4], nums[5]);
      sun.position.set(nums[3] + 28, nums[4] + 46, nums[5] + 14);
      sun.target.position.copy(look);
      sun.target.updateMatrixWorld();
      game.start("easy");
    }
  }
  if (params.has("play")) {
    el.menu.classList.remove("show");
    playingCam = true;
    blend = params.has("wide") ? 6 : 8;
    if (params.has("wide")) {
      dist = 34;
      distTarget = 34;
    }
    const y = Number(params.get("yaw"));
    if (!Number.isNaN(y) && params.has("yaw")) {
      yaw = y;
      yawTarget = y;
    }
    game.start(params.get("diff") === "easy" ? "easy" : "normal");
  }
  if (params.has("autotest")) {
    const result = game.selfTest();
    console.log("POLYBOUND self-test", result);
    const node = document.createElement("pre");
    node.id = "selftest";
    node.style.cssText = "position:fixed;left:8px;top:8px;z-index:9;background:#112;color:#d6ffe8;padding:8px;max-width:70vw;white-space:pre-wrap";
    node.textContent = JSON.stringify(result, null, 2);
    document.body.appendChild(node);
    window.__TEST__ = result;
    document.getElementById("menu").classList.remove("show");
  }
} catch (err) {
  fail(err);
}

window.addEventListener("error", (e) => fail(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => fail(e.reason));
