// Procedural audio. Nothing plays until the player starts the match.

export function createAudio() {
  const A = {
    ctx: null,
    master: null,
    muted: false,
    started: false,
    ambience: [],
    birdT: 2.5,
  };

  function ensure() {
    if (A.ctx) return;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.01;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(ctx.destination);
    A.ctx = ctx;
    A.master = master;

    const bed = ctx.createGain();
    bed.gain.value = 0.045;
    bed.connect(master);
    const notes = [174.61, 220.0, 261.63];
    for (const f of notes) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f < 200 ? 0.7 : 0.28;
      o.connect(g);
      g.connect(bed);
      o.start();
      A.ambience.push(o);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 540;
    filter.Q.value = 0.6;
    const nGain = ctx.createGain();
    nGain.gain.value = 0.015;
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.98 + white * 0.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(master);
    noise.start();
    A.ambience.push(noise);
  }

  function tone({ freq = 440, dur = 0.2, type = "sine", gain = 0.08, slide = 0, delay = 0 }) {
    if (!A.ctx || A.muted) return;
    const t0 = A.ctx.currentTime + delay;
    const o = A.ctx.createOscillator();
    const g = A.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(A.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.12, gain = 0.06, freq = 800) {
    if (!A.ctx || A.muted) return;
    const t0 = A.ctx.currentTime;
    const len = Math.floor(A.ctx.sampleRate * dur);
    const buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = A.ctx.createBufferSource();
    src.buffer = buf;
    const filter = A.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = freq;
    const g = A.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(A.master);
    src.start(t0);
  }

  return {
    get muted() {
      return A.muted;
    },
    start() {
      ensure();
      A.started = true;
      if (A.ctx.state === "suspended") A.ctx.resume();
    },
    toggleMute() {
      A.muted = !A.muted;
      if (A.master) A.master.gain.value = A.muted ? 0 : 0.8;
      return A.muted;
    },
    setMuted(v) {
      A.muted = v;
      if (A.master) A.master.gain.value = v ? 0 : 0.8;
    },
    update(dt, paused) {
      if (!A.started || A.muted || paused) return;
      A.birdT -= dt;
      if (A.birdT <= 0) {
        A.birdT = 4.5 + Math.random() * 6;
        const base = 1400 + Math.random() * 800;
        tone({ freq: base, dur: 0.09, type: "sine", gain: 0.02, slide: 400 });
        tone({ freq: base + 180, dur: 0.07, type: "sine", gain: 0.012, slide: -200, delay: 0.1 });
      }
    },
    foot() {
      noiseBurst(0.05, 0.03, 420);
    },
    throw() {
      noiseBurst(0.12, 0.05, 1400);
      tone({ freq: 520, dur: 0.14, type: "triangle", gain: 0.04, slide: -280 });
    },
    land() {
      noiseBurst(0.08, 0.05, 500);
      tone({ freq: 180, dur: 0.09, type: "sine", gain: 0.04 });
    },
    whistle() {
      tone({ freq: 640, dur: 0.22, type: "sine", gain: 0.06, slide: 380 });
      tone({ freq: 960, dur: 0.18, type: "triangle", gain: 0.03, slide: 240, delay: 0.03 });
    },
    discover() {
      tone({ freq: 523, dur: 0.12, type: "triangle", gain: 0.06 });
      tone({ freq: 659, dur: 0.14, type: "triangle", gain: 0.05, delay: 0.08 });
      tone({ freq: 784, dur: 0.18, type: "sine", gain: 0.04, delay: 0.16 });
    },
    hit() {
      noiseBurst(0.07, 0.07, 900);
      tone({ freq: 210, dur: 0.08, type: "square", gain: 0.03, slide: -80 });
    },
    defeat() {
      tone({ freq: 420, dur: 0.2, type: "triangle", gain: 0.05, slide: -260 });
    },
    work() {
      noiseBurst(0.06, 0.04, 600);
    },
    carry() {
      noiseBurst(0.04, 0.02, 300);
    },
    score() {
      tone({ freq: 523, dur: 0.12, type: "sine", gain: 0.06 });
      tone({ freq: 659, dur: 0.14, type: "sine", gain: 0.05, delay: 0.09 });
      tone({ freq: 784, dur: 0.2, type: "triangle", gain: 0.05, delay: 0.16 });
      tone({ freq: 1046, dur: 0.28, type: "sine", gain: 0.04, delay: 0.24 });
    },
    victory() {
      const seq = [523, 659, 784, 1046];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.28, type: "triangle", gain: 0.07, delay: i * 0.12 }));
    },
    ui() {
      tone({ freq: 660, dur: 0.06, type: "sine", gain: 0.03 });
    },
  };
}
