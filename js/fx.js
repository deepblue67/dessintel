// Effets : sons synthétisés (aucun fichier audio), vibrations, confettis.

let ctx = null;
let master = null;
let muted = false;

export function audioReady() {
  return !!ctx && ctx.state === 'running';
}

/** À appeler lors d'un geste utilisateur (les navigateurs bloquent le son sinon). */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
  return audioReady();
}

export function setMuted(m) {
  muted = m;
}

function tone({ type = 'sine', f0, f1 = null, start = 0, dur = 0.3, vol = 0.5, attack = 0.005, vibrato = 0, vibRate = 7, filter = null }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = vibRate;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o.connect(g);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    if (filter.q) f.Q.value = filter.q;
    node = g.connect(f);
    f.connect(master);
  } else g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SOUNDS = {
  klaxon() {
    tone({ type: 'square', f0: 392, dur: 0.45, vol: 0.25, filter: { type: 'lowpass', freq: 1800 } });
    tone({ type: 'square', f0: 494, dur: 0.45, vol: 0.2, filter: { type: 'lowpass', freq: 1800 } });
  },
  cloche() {
    tone({ type: 'sine', f0: 1318, dur: 1.2, vol: 0.5 });
    tone({ type: 'sine', f0: 2637, dur: 0.6, vol: 0.15 });
    tone({ type: 'triangle', f0: 659, dur: 0.9, vol: 0.2 });
  },
  pouet() {
    tone({ type: 'sawtooth', f0: 330, f1: 220, dur: 0.5, vol: 0.3, vibrato: 12, vibRate: 9, filter: { type: 'lowpass', freq: 1400 } });
  },
  laser() {
    tone({ type: 'square', f0: 1800, f1: 120, dur: 0.35, vol: 0.18 });
    tone({ type: 'sine', f0: 2400, f1: 200, dur: 0.3, vol: 0.2 });
  },
  boing() {
    tone({ type: 'sine', f0: 140, f1: 520, dur: 0.45, vol: 0.55, vibrato: 25, vibRate: 14 });
  },
  canard() {
    tone({ type: 'square', f0: 880, f1: 520, dur: 0.14, vol: 0.25, filter: { type: 'bandpass', freq: 1300, q: 3 } });
    tone({ type: 'square', f0: 880, f1: 500, start: 0.18, dur: 0.18, vol: 0.25, filter: { type: 'bandpass', freq: 1300, q: 3 } });
  },
  // Sons d'ambiance
  right() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, start: i * 0.09, dur: 0.35, vol: 0.35 }));
    tone({ type: 'sine', f0: 2093, start: 0.36, dur: 0.6, vol: 0.12 });
  },
  wrong() {
    const notes = [392, 370, 349, 330];
    notes.forEach((f, i) =>
      tone({ type: 'sawtooth', f0: f, start: i * 0.32, dur: i === 3 ? 0.9 : 0.3, vol: 0.22, vibrato: i === 3 ? 8 : 0, vibRate: 6, filter: { type: 'lowpass', freq: 900 } })
    );
  },
  tick() {
    tone({ type: 'sine', f0: 880, dur: 0.08, vol: 0.3 });
  },
  go() {
    tone({ type: 'square', f0: 1320, dur: 0.25, vol: 0.2, filter: { type: 'lowpass', freq: 3000 } });
  },
  blip() {
    tone({ type: 'sine', f0: 660, f1: 990, dur: 0.12, vol: 0.18 });
  },
  nope() {
    tone({ type: 'square', f0: 160, dur: 0.18, vol: 0.15, filter: { type: 'lowpass', freq: 600 } });
  },
  join() {
    tone({ type: 'triangle', f0: 784, dur: 0.12, vol: 0.25 });
    tone({ type: 'triangle', f0: 1175, start: 0.1, dur: 0.2, vol: 0.25 });
  },
  page() {
    tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.16, vol: 0.22 });
    tone({ type: 'sine', f0: 1040, start: 0.08, dur: 0.18, vol: 0.12 });
  },
  pop() {
    tone({ type: 'sine', f0: 600, f1: 1400, dur: 0.09, vol: 0.2 });
  },
  done() {
    tone({ type: 'triangle', f0: 660, dur: 0.1, vol: 0.25 });
    tone({ type: 'triangle', f0: 990, start: 0.09, dur: 0.22, vol: 0.25 });
  },
  round() {
    [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', f0: f, start: i * 0.08, dur: 0.25, vol: 0.25 }));
  },
  fanfare() {
    const seq = [523, 523, 523, 659, 0, 784, 659, 784];
    const durs = [0.12, 0.12, 0.12, 0.35, 0.1, 0.18, 0.15, 0.7];
    let t = 0;
    seq.forEach((f, i) => {
      if (f) tone({ type: 'sawtooth', f0: f, start: t, dur: durs[i], vol: 0.18, filter: { type: 'lowpass', freq: 2500 } });
      t += durs[i] + 0.02;
    });
  },
};

export function play(name) {
  unlockAudio();
  (SOUNDS[name] || SOUNDS.blip)();
}

export function vibrate(pattern) {
  try {
    navigator.vibrate && navigator.vibrate(pattern);
  } catch {}
}

// ---------- Confettis ----------
let canvas = null;
let parts = [];
let raf = null;

export function confetti({ colors = ['#ff4d6d', '#ffd60a', '#2ec4b6', '#4361ee', '#f15bb5', '#70e000'], count = 160 } = {}) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.appendChild(canvas);
  }
  const W = (canvas.width = innerWidth * devicePixelRatio);
  const H = (canvas.height = innerHeight * devicePixelRatio);
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    parts.push({
      x: fromLeft ? 0 : W,
      y: H * 0.75,
      vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 14) * devicePixelRatio,
      vy: -(14 + Math.random() * 18) * devicePixelRatio,
      w: (6 + Math.random() * 8) * devicePixelRatio,
      h: (8 + Math.random() * 10) * devicePixelRatio,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: colors[i % colors.length],
      life: 0,
    });
  }
  if (!raf) loop();
}

function loop() {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  const g = 0.5 * devicePixelRatio;
  parts = parts.filter((p) => p.life < 260 && p.y < canvas.height + 50);
  for (const p of parts) {
    p.life++;
    p.vy += g;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.c;
    c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)));
    c.restore();
  }
  if (parts.length) raf = requestAnimationFrame(loop);
  else {
    c.clearRect(0, 0, canvas.width, canvas.height);
    raf = null;
  }
}

/** Petit flash plein écran de la couleur d'un joueur. */
export function flash(color) {
  const el = document.createElement('div');
  el.className = 'flash';
  el.style.background = color;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

/** Un emoji qui monte depuis le bas de l'écran (réactions pendant la révélation). */
export function floatEmoji(e, { x = null, big = false } = {}) {
  const el = document.createElement('div');
  el.className = 'floaty' + (big ? ' big' : '');
  el.textContent = e;
  el.style.left = (x ?? 8 + Math.random() * 84) + 'vw';
  el.style.setProperty('--dx', (Math.random() * 16 - 8).toFixed(1) + 'vw');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}
