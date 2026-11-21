// Dessin vectoriel : un dessin est une liste de traits, pas une image.
//   [couleur, taille, x0, y0, x1, y1, …]  coordonnées entières de 0 à 1000 (zone carrée)
//   [couleur, -1]                         fond de la couleur indiquée
//   couleur -1                            gomme (prend la couleur du fond)
// C'est léger (quelques dizaines de Ko, loin de la limite de 256 Ko d'un message
// Supabase), net à toutes les tailles (TV) et ça permet de rejouer le dessin trait par trait.

export const GRID = 1000;
export const PALETTE = ['#1b1b1f', '#ffffff', '#8a8f98', '#e63946', '#ff8c1a', '#ffd60a', '#70c040', '#1b7f4b', '#2ec4e6', '#3a6df0', '#8338ec', '#ff5fa2', '#8d5a3b', '#f4c9a0'];
export const SIZES = [5, 13, 30, 70];
export const MAX_BYTES = 180000;

// ---------- Fonctions pures (testées) ----------

/** Simplification de Ramer-Douglas-Peucker sur un tableau plat [x0, y0, x1, y1, …]. */
export function simplify(pts, tol) {
  const n = pts.length / 2;
  if (n <= 2 || tol <= 0) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[2 * a], ay = pts[2 * a + 1], bx = pts[2 * b], by = pts[2 * b + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[2 * i], py = pts[2 * i + 1];
      let d2;
      if (!len2) d2 = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d2 > best) {
        best = d2;
        idx = i;
      }
    }
    if (best > t2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}

const clampInt = (v) => Math.max(0, Math.min(GRID, Math.round(v)));

/** Trait brut (points flottants) → trait compact (entiers, points simplifiés, doublons retirés). */
export function packStroke(color, size, pts, tol = 1.2) {
  const s = simplify(pts, tol);
  const out = [color, size];
  for (let i = 0; i < s.length; i += 2) {
    const x = clampInt(s[i]), y = clampInt(s[i + 1]);
    const L = out.length;
    if (L > 2 && out[L - 2] === x && out[L - 1] === y) continue;
    out.push(x, y);
  }
  if (out.length === 2) return null;
  return out;
}

export const byteSize = (d) => JSON.stringify(d).length;

/** Garantit qu'un dessin tient dans un message : on simplifie de plus en plus si besoin. */
export function fitSize(strokes, max = MAX_BYTES) {
  let d = strokes;
  let tol = 2;
  while (byteSize(d) > max && tol < 40) {
    d = strokes.map((st) => (st[1] === -1 ? st : [st[0], st[1], ...simplify(st.slice(2), tol)])).filter((st) => st[1] === -1 || st.length >= 4);
    tol *= 1.6;
  }
  return d;
}

/** Couleur de fond en vigueur après les `upto` premiers traits. */
export function backgroundOf(strokes, upto = strokes.length) {
  let bg = '#ffffff';
  for (let i = 0; i < Math.min(upto, strokes.length); i++) if (strokes[i][1] === -1) bg = PALETTE[strokes[i][0]] || bg;
  return bg;
}

export const pointCount = (strokes) => strokes.reduce((n, st) => n + (st[1] === -1 ? 20 : (st.length - 2) / 2), 0);

// ---------- Rendu ----------

function strokePath(ctx, st, k, nPts = Infinity) {
  const n = Math.min((st.length - 2) / 2, nPts);
  const X = (i) => st[2 + 2 * i] * k;
  const Y = (i) => st[3 + 2 * i] * k;
  ctx.beginPath();
  if (n === 1) {
    ctx.arc(X(0), Y(0), Math.max(0.5, (SIZES[st[1]] * k) / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(X(0), Y(0));
  if (n === 2) ctx.lineTo(X(1), Y(1));
  else {
    // courbes passant par le milieu des segments : un trait bien lisse
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    ctx.lineTo(X(n - 1), Y(n - 1));
  }
  ctx.stroke();
}

/** Dessine un trait (éventuellement seulement ses nPts premiers points). */
export function drawStroke(ctx, st, k, bg, nPts) {
  if (st[1] === -1) return;
  const col = st[0] === -1 ? bg : PALETTE[st[0]] || '#000';
  ctx.strokeStyle = ctx.fillStyle = col;
  ctx.lineWidth = SIZES[st[1]] * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokePath(ctx, st, k, nPts);
}

/**
 * Rendu complet sur un contexte de taille px × px.
 * upto / partial : n'affiche que les `upto` premiers traits, plus `partial` points du suivant (rejeu).
 */
export function render(ctx, strokes, px, { upto = strokes.length, partial = 0 } = {}) {
  const k = px / GRID;
  const bg = backgroundOf(strokes, upto + (partial ? 1 : 0));
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, px, px);
  for (let i = 0; i < Math.min(upto, strokes.length); i++) drawStroke(ctx, strokes[i], k, bg);
  if (partial && strokes[upto]) drawStroke(ctx, strokes[upto], k, bg, partial);
  ctx.restore();
}

/** Ajuste la résolution d'un canevas à sa taille affichée. Renvoie sa taille en pixels. */
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const css = canvas.getBoundingClientRect().width || canvas.clientWidth || 300;
  const px = Math.max(50, Math.round(css * dpr));
  if (canvas.width !== px) canvas.width = canvas.height = px;
  return px;
}

/** Affiche un dessin fini. */
export function show(canvas, strokes) {
  const px = fitCanvas(canvas);
  render(canvas.getContext('2d'), strokes || [], px);
}

/** Rejoue un dessin trait par trait. Renvoie une fonction pour l'arrêter (et tout afficher). */
export function replay(canvas, strokes, { duration = null, onDone } = {}) {
  const px = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const total = Math.max(1, pointCount(strokes));
  const dur = duration ?? Math.max(1200, Math.min(4500, total * 5));
  const t0 = performance.now();
  let raf = 0;
  let stopped = false;
  const frame = (t) => {
    if (stopped) return;
    const target = Math.min(total, ((t - t0) / dur) * total);
    let acc = 0, upto = 0, partial = 0;
    for (; upto < strokes.length; upto++) {
      const n = strokes[upto][1] === -1 ? 20 : (strokes[upto].length - 2) / 2;
      if (acc + n > target) {
        partial = strokes[upto][1] === -1 ? 0 : Math.max(1, Math.floor(target - acc));
        break;
      }
      acc += n;
    }
    render(ctx, strokes, px, { upto, partial });
    if (target < total) raf = requestAnimationFrame(frame);
    else {
      render(ctx, strokes, px);
      onDone?.();
    }
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    render(ctx, strokes, px);
  };
}

// ---------- Ardoise (saisie au doigt) ----------

/**
 * createPad(canvas, { initial, onChange })
 * → { setColor, setSize, setEraser, fill, undo, clear, getData, isEmpty, color, size, eraser, destroy }
 */
export function createPad(canvas, { initial = [], onChange } = {}) {
  let strokes = Array.isArray(initial) ? initial.map((s) => s.slice()) : [];
  let color = 0, size = 1, eraser = false;
  let cur = null; // { id, pts: [] }
  let px = 0;
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas'); // traits terminés (évite de tout redessiner)
  const bctx = base.getContext('2d');

  function redrawBase() {
    px = fitCanvas(canvas);
    base.width = base.height = px;
    render(bctx, strokes, px);
    blit();
  }
  function blit() {
    ctx.drawImage(base, 0, 0);
  }
  const toGrid = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * GRID, ((e.clientY - r.top) / r.height) * GRID];
  };
  const curColor = () => (eraser ? -1 : color);

  function liveSegment() {
    // Pendant le tracé : on redessine le trait en cours par-dessus les traits terminés.
    blit();
    const st = [curColor(), size, ...cur.pts];
    drawStroke(ctx, st, px / GRID, backgroundOf(strokes));
  }

  function down(e) {
    if (cur) {
      // Deuxième doigt (zoom, paume) : on annule le trait en cours.
      cur = null;
      blit();
      return;
    }
    if (e.button > 0) return;
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    cur = { id: e.pointerId, pts: toGrid(e) };
    liveSegment();
  }
  function move(e) {
    if (!cur || e.pointerId !== cur.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents?.() || [e];
    for (const ev of evs) {
      const [x, y] = toGrid(ev);
      const L = cur.pts.length;
      if (Math.abs(x - cur.pts[L - 2]) + Math.abs(y - cur.pts[L - 1]) < 1.5) continue;
      cur.pts.push(x, y);
    }
    liveSegment();
  }
  function up(e) {
    if (!cur || e.pointerId !== cur.id) return;
    const st = packStroke(curColor(), size, cur.pts);
    cur = null;
    if (st) {
      strokes.push(st);
      drawStroke(bctx, st, px / GRID, backgroundOf(strokes));
      onChange?.(strokes);
    }
    blit();
  }
  function cancel(e) {
    if (cur && e.pointerId === cur.id) {
      cur = null;
      blit();
    }
  }
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', up);
  const ro = new ResizeObserver(() => redrawBase());
  ro.observe(canvas);
  redrawBase();

  return {
    get color() {
      return color;
    },
    get size() {
      return size;
    },
    get eraser() {
      return eraser;
    },
    setColor(c) {
      color = c;
      eraser = false;
    },
    setSize(s) {
      size = s;
    },
    setEraser(on = true) {
      eraser = on;
    },
    fill(c = color) {
      strokes.push([c, -1]);
      redrawBase();
      onChange?.(strokes);
    },
    undo() {
      if (!strokes.length) return;
      strokes.pop();
      redrawBase();
      onChange?.(strokes);
    },
    clear() {
      strokes = [];
      redrawBase();
      onChange?.(strokes);
    },
    isEmpty: () => !strokes.some((s) => s[1] !== -1),
    getData: () => fitSize(strokes),
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('lostpointercapture', up);
    },
  };
}

// ---------- Export d'un carnet en image ----------

function wrapText(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Image PNG d'un carnet complet (pour l'envoyer sur WhatsApp, etc.).
 * steps : [{ kind, by, data, skipped }], players : { id: { name, avatar, color } }
 */
export function bookImage(steps, players, title) {
  const W = 1080, PAD = 48, IMG = W - 2 * PAD;
  const font = (px, w = 600) => `${w} ${px}px Fredoka, ui-rounded, system-ui, sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  const blocks = [];
  for (const st of steps) {
    const p = players[st.by] || { name: '?', avatar: '❔', color: '#888' };
    if (st.skipped) blocks.push({ st, p, h: 70 });
    else if (st.kind === 'text') {
      meas.font = font(46, 600);
      const lines = wrapText(meas, `« ${st.data} »`, IMG - 60);
      blocks.push({ st, p, lines, h: 70 + lines.length * 58 + 40 });
    } else blocks.push({ st, p, h: 70 + IMG + 20 });
  }
  const H = 150 + blocks.reduce((a, b) => a + b.h + 24, 0) + 70;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#1f1147';
  x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffd60a';
  x.font = font(60, 700);
  x.textAlign = 'center';
  x.fillText(title, W / 2, 95);
  let y = 150;
  for (const b of blocks) {
    x.textAlign = 'left';
    x.fillStyle = b.p.color;
    x.font = font(36, 600);
    const verb = b.st.skipped ? 'a passé son tour 🙈' : b.st.kind === 'text' ? 'a écrit :' : 'a dessiné :';
    x.fillText(`${b.p.avatar} ${b.p.name}`, PAD, y + 40);
    const nameW = x.measureText(`${b.p.avatar} ${b.p.name} `).width;
    x.fillStyle = 'rgba(255,255,255,.65)';
    x.font = font(32, 400);
    x.fillText(verb, PAD + nameW, y + 40);
    if (b.st.skipped) {
      // rien de plus
    } else if (b.st.kind === 'text') {
      x.fillStyle = '#ffffff';
      roundRect(x, PAD, y + 62, IMG, b.h - 70, 28);
      x.fill();
      x.fillStyle = '#1f1147';
      x.font = font(46, 600);
      b.lines.forEach((l, i) => x.fillText(l, PAD + 30, y + 62 + 64 + i * 58));
    } else {
      const off = document.createElement('canvas');
      off.width = off.height = IMG;
      render(off.getContext('2d'), b.st.data, IMG);
      x.save();
      roundRect(x, PAD, y + 62, IMG, IMG, 28);
      x.clip();
      x.drawImage(off, PAD, y + 62);
      x.restore();
    }
    y += b.h + 24;
  }
  x.textAlign = 'center';
  x.fillStyle = 'rgba(255,255,255,.5)';
  x.font = font(30, 500);
  x.fillText('DessinTel · dessintel.cdesmottes.fr', W / 2, H - 35);
  return c;
}

function roundRect(x, X, Y, w, h, r) {
  x.beginPath();
  x.moveTo(X + r, Y);
  x.arcTo(X + w, Y, X + w, Y + h, r);
  x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r);
  x.arcTo(X, Y, X + w, Y, r);
  x.closePath();
}

/** Partage (mobile) ou téléchargement de l'image d'un carnet. */
export async function shareBook(steps, players, title, filename) {
  const c = bookImage(steps, players, title);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  const file = new File([blob], filename, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
