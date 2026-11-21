// Règles de DessinTel. Module pur (aucun accès au DOM ni au réseau) : seul le
// maître du jeu applique ces fonctions, puis il diffuse l'état à tout le monde.
// Chaque fonction reçoit un état et renvoie un NOUVEL état (l'original n'est pas modifié).
//
// Principe : il y a un carnet par joueur. À la manche r, le carnet b est entre
// les mains du joueur order[(b + r) % N]. Chaque joueur traite donc un carnet
// par manche, ne reçoit jamais le sien et ne touche jamais deux fois au même.

export const DEFAULT_SETTINGS = {
  group: '', // groupe de joueurs enregistrés proposé sur les téléphones ('' = tout le monde)
  writeSec: 40, // temps pour écrire (0 = sans minuteur)
  drawSec: 75, // temps pour dessiner (0 = sans minuteur)
  maxSteps: 0, // nombre d'étapes par carnet (0 = tour complet : une par joueur)
};

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 16;
export const MAX_TEXT = 120;
export const REACTIONS = ['😂', '❤️', '😮', '👏'];

export const TROPHIES = [
  { id: 'artist', icon: '🎨', title: 'Picasso de la soirée', q: 'Le plus beau dessin' },
  { id: 'funny', icon: '😂', title: 'Roi du quiproquo', q: 'Le plus drôle' },
  { id: 'detective', icon: '🕵️', title: 'Fin limier', q: 'Le meilleur pour deviner' },
];

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

export function randomId(len = 10) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function resetGame(s) {
  s.phase = 'lobby';
  s.order = [];
  s.books = [];
  s.round = 0;
  s.rounds = 0;
  s.deadline = null;
  s.reveal = null;
  s.react = {};
  s.votes = {};
  s.results = null;
  return s;
}

export function newGame(room, now, settings = {}) {
  return resetGame({
    gid: randomId(8),
    v: 0,
    room,
    createdAt: now,
    gameNo: 0, // numéro de la partie dans cette salle (sert de clé aux caches des téléphones)
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: {},
    kicked: [],
  });
}

// ---------- Joueurs ----------

export function upsertPlayer(state, profile, now, { rejoin = false } = {}) {
  const { id } = profile;
  if (!id) return null;
  if (state.kicked.includes(id) && !rejoin) return null;
  const s = clone(state);
  s.kicked = s.kicked.filter((k) => k !== id);
  const fields = {
    name: String(profile.name || 'Joueur').trim().slice(0, 16) || 'Joueur',
    avatar: String(profile.avatar || '🙂').slice(0, 8),
    color: String(profile.color || '#ff4d6d').slice(0, 16),
  };
  if (s.players[id]) Object.assign(s.players[id], fields, { gone: false });
  else s.players[id] = { id, ...fields, joinedAt: now, gone: false };
  return s;
}

/** Un joueur reprend sa place depuis un autre téléphone (même prénom, ancien téléphone déconnecté). */
export function movePlayer(state, oldId, newId) {
  if (!state.players[oldId] || oldId === newId) return state;
  const s = clone(state);
  if (s.players[newId]) {
    // ce téléphone jouait sous un autre prénom : on garde ce joueur à part
    const keep = randomId(12);
    s.players[keep] = { ...s.players[newId], id: keep };
    renameIds(s, newId, keep);
  }
  s.players[newId] = { ...s.players[oldId], id: newId };
  delete s.players[oldId];
  renameIds(s, oldId, newId);
  return s;
}

function renameIds(s, from, to) {
  const r = (id) => (id === from ? to : id);
  s.order = s.order.map(r);
  for (const b of s.books) {
    b.owner = r(b.owner);
    for (const st of b.steps) st.by = r(st.by);
  }
  if (s.votes[from]) {
    s.votes[to] = s.votes[from];
    delete s.votes[from];
  }
  for (const v of Object.values(s.votes)) for (const k of Object.keys(v)) v[k] = r(v[k]);
  s.kicked = s.kicked.filter((id) => id !== from);
}

/**
 * Exclure un joueur. Dans le salon, il disparaît. En cours de partie, il reste
 * dans la rotation (les carnets en ont besoin) mais ses tours sont passés.
 */
export function kick(state, id) {
  if (!state.players[id]) return state;
  let s = clone(state);
  if (!s.kicked.includes(id)) s.kicked.push(id);
  if (s.order.includes(id)) {
    s.players[id].gone = true;
    if (s.phase === 'play') s = skipMissing(s, [id]);
    delete s.votes[id];
  } else delete s.players[id];
  return s;
}

export function setSettings(state, patch) {
  const s = clone(state);
  const S = s.settings;
  if ('group' in patch) S.group = String(patch.group || '');
  if (s.phase === 'lobby' || s.phase === 'end') {
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
    if ('writeSec' in patch) S.writeSec = num(patch.writeSec, 0, 600);
    if ('drawSec' in patch) S.drawSec = num(patch.drawSec, 0, 600);
    if ('maxSteps' in patch) S.maxSteps = num(patch.maxSteps, 0, MAX_PLAYERS);
  }
  return s;
}

// ---------- Déroulement ----------

export const N = (state) => state.order.length;
export const isGone = (state, id) => !state.players[id] || !!state.players[id].gone;

/** Joueur qui tient le carnet b à la manche r. */
export function holderOf(state, b, r = state.round) {
  return state.order[(b + r) % N(state)];
}

/** Carnet entre les mains du joueur pid à la manche r (-1 s'il ne joue pas). */
export function bookFor(state, pid, r = state.round) {
  const i = state.order.indexOf(pid);
  if (i < 0) return -1;
  const n = N(state);
  return (((i - r) % n) + n) % n;
}

/** Dernière étape non passée d'un carnet (avant l'étape `upto`). */
export function lastStep(book, upto = book.steps.length) {
  for (let i = Math.min(upto, book.steps.length) - 1; i >= 0; i--) if (!book.steps[i].skipped) return book.steps[i];
  return null;
}

/** Ce qu'on attend : une phrase au départ, puis on alterne dessin / phrase par rapport à l'étape précédente. */
export function kindAfter(prev) {
  return !prev ? 'text' : prev.kind === 'text' ? 'draw' : 'text';
}

/**
 * Tâche du joueur pid pour la manche en cours, ou null s'il ne joue pas.
 * { b, round, kind, prev, owner, done }
 */
export function taskFor(state, pid) {
  if (state.phase !== 'play') return null;
  const b = bookFor(state, pid);
  if (b < 0) return null;
  const book = state.books[b];
  const prev = lastStep(book, state.round);
  const mine = book.steps[state.round];
  return {
    b,
    round: state.round,
    kind: mine ? mine.kind : kindAfter(prev),
    prev: prev ? { kind: prev.kind, by: prev.by, data: prev.data } : null,
    owner: book.owner,
    done: !!mine,
    mine: mine && !mine.skipped ? mine.data : null,
  };
}

function roundDeadline(s, now) {
  const kinds = s.order.map((p, i) => kindAfter(lastStep(s.books[bookFor(s, p)], s.round)));
  const sec = kinds.includes('draw') ? s.settings.drawSec : s.settings.writeSec;
  return sec > 0 ? now + sec * 1000 : null;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Démarre une partie avec ces joueurs (dans un ordre tiré au hasard). */
export function startGame(state, ids, now, rng = Math.random) {
  const list = [...new Set(ids)].filter((id) => state.players[id] && !state.players[id].gone).slice(0, MAX_PLAYERS);
  if (list.length < MIN_PLAYERS) return state;
  const s = resetGame(clone(state));
  s.gameNo = (state.gameNo || 0) + 1;
  s.order = shuffle(list, rng);
  const n = s.order.length;
  s.rounds = s.settings.maxSteps >= 2 ? Math.min(n, s.settings.maxSteps) : n;
  s.books = s.order.map((owner) => ({ owner, steps: [] }));
  s.phase = 'play';
  s.round = 0;
  s.deadline = roundDeadline(s, now);
  return s;
}

/** Contrôle du contenu envoyé par un téléphone. */
export function cleanData(kind, data) {
  if (kind === 'text') {
    const t = String(data ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    return t || null;
  }
  return validDrawing(data) && data.some((st) => st[1] !== -1) ? data : null;
}

/** Dessin : liste de traits [couleur, taille, x0, y0, x1, y1, …] (coordonnées 0..1000) ; [couleur, -1] = fond. */
export function validDrawing(d) {
  if (!Array.isArray(d) || d.length > 3000) return false;
  let pts = 0;
  for (const st of d) {
    if (!Array.isArray(st) || st.length < 2) return false;
    const [c, w] = st;
    if (!Number.isInteger(c) || c < -1 || c > 31 || !Number.isInteger(w) || w < -1 || w > 3) return false;
    if (w === -1) {
      if (st.length !== 2 || c < 0) return false;
      continue;
    }
    if (st.length < 4 || st.length % 2) return false;
    for (let i = 2; i < st.length; i++) if (!Number.isInteger(st[i]) || st[i] < 0 || st[i] > 1000) return false;
    pts += (st.length - 2) / 2;
  }
  return pts <= 60000;
}

/** Un joueur rend sa copie (il peut la remplacer tant que la manche n'est pas finie). */
export function submit(state, pid, round, data) {
  if (state.phase !== 'play' || round !== state.round) return null;
  const b = bookFor(state, pid);
  if (b < 0 || isGone(state, pid)) return null;
  const s = clone(state);
  const book = s.books[b];
  const kind = book.steps[s.round]?.kind || kindAfter(lastStep(book, s.round));
  const clean = cleanData(kind, data);
  const step = clean ? { kind, by: pid, data: clean } : { kind, by: pid, skipped: true };
  if (book.steps.length === s.round) book.steps.push(step);
  else if (book.steps.length === s.round + 1) book.steps[s.round] = step;
  else return null;
  return s;
}

/** Joueurs qui ont rendu leur copie pour la manche en cours. */
export function submittedIds(state) {
  if (state.phase !== 'play') return [];
  return state.order.filter((p) => state.books[bookFor(state, p)].steps.length > state.round);
}

export function isRoundComplete(state) {
  return state.phase === 'play' && state.books.every((b) => b.steps.length > state.round);
}

/** Passe le tour des joueurs indiqués (ou de tous ceux qui n'ont pas rendu leur copie). */
export function skipMissing(state, ids = null) {
  if (state.phase !== 'play') return state;
  const s = clone(state);
  for (const p of ids || s.order) {
    const book = s.books[bookFor(s, p)];
    if (!book || book.steps.length !== s.round) continue;
    book.steps.push({ kind: kindAfter(lastStep(book, s.round)), by: p, skipped: true });
  }
  return s;
}

/** Manche suivante (ou révélation après la dernière). Ne fait rien si la manche n'est pas finie. */
export function advance(state, now) {
  if (!isRoundComplete(state)) return state;
  let s = clone(state);
  if (s.round + 1 >= s.rounds) {
    s.phase = 'reveal';
    s.deadline = null;
    s.reveal = { b: 0, s: 0 };
    return s;
  }
  s.round += 1;
  s.deadline = roundDeadline(s, now);
  // Les joueurs exclus passent leur tour d'office.
  const gone = s.order.filter((p) => isGone(s, p));
  if (gone.length) s = skipMissing(s, gone);
  return s;
}

// ---------- Révélation ----------

/** Page suivante : la couverture (s = 0), puis une étape de plus à chaque fois. */
export function revealNext(state) {
  if (state.phase !== 'reveal') return state;
  const s = clone(state);
  const r = s.reveal;
  const len = s.books[r.b].steps.length;
  if (r.s < len) {
    r.s += 1;
    while (r.s < len && s.books[r.b].steps[r.s - 1].skipped) r.s += 1; // on ne s'arrête pas sur un tour passé
  } else if (r.b < s.books.length - 1) {
    r.b += 1;
    r.s = 0;
  } else return state;
  return s;
}

export function revealPrev(state) {
  if (state.phase !== 'reveal') return state;
  const s = clone(state);
  const r = s.reveal;
  if (r.s > 0) {
    r.s -= 1;
    while (r.s > 0 && s.books[r.b].steps[r.s - 1].skipped) r.s -= 1;
  } else if (r.b > 0) {
    r.b -= 1;
    r.s = s.books[r.b].steps.length;
  } else return state;
  return s;
}

/** Aller directement à un carnet (en entier si on l'a déjà vu). */
export function revealGoto(state, b) {
  if (!state.books[b] || !['reveal', 'vote', 'end'].includes(state.phase)) return state;
  const s = clone(state);
  const seen = s.results || b < (state.reveal?.b ?? 0);
  s.phase = 'reveal';
  s.reveal = { b, s: seen ? s.books[b].steps.length : 0 };
  return s;
}

export const isRevealEnd = (state) =>
  state.phase === 'reveal' && state.reveal.b === state.books.length - 1 && state.reveal.s >= state.books[state.reveal.b].steps.length;

/** Étapes déjà montrées du carnet b (indices). */
export function revealedSteps(state, b) {
  if (!state.books[b]) return [];
  const all = state.results || state.phase === 'vote' || state.phase === 'end';
  const r = state.reveal;
  const upto = all || (r && b < r.b) ? state.books[b].steps.length : r && b === r.b ? r.s : 0;
  return [...Array(upto).keys()];
}

export function react(state, b, si, emoji) {
  if (!REACTIONS.includes(emoji) || !state.books[b]?.steps[si] || !revealedSteps(state, b).includes(si)) return state;
  const s = clone(state);
  const k = `${b}:${si}`;
  const r = (s.react[k] ||= {});
  r[emoji] = (r[emoji] || 0) + 1;
  return s;
}

// ---------- Trophées ----------

export function startVote(state) {
  if (!['reveal', 'end'].includes(state.phase)) return state;
  const s = clone(state);
  s.phase = 'vote';
  s.votes = {};
  s.results = null;
  return s;
}

/** Joueurs qui votent (et pour qui on peut voter). */
export const voters = (state) => state.order.filter((p) => !isGone(state, p));

export function vote(state, voter, choices) {
  if (state.phase !== 'vote' || !voters(state).includes(voter)) return null;
  const s = clone(state);
  const v = {};
  for (const t of TROPHIES) {
    const target = choices?.[t.id];
    if (target && target !== voter && state.order.includes(target)) v[t.id] = target;
  }
  s.votes[voter] = v;
  return s;
}

export const allVoted = (state) => voters(state).every((p) => state.votes[p]);

/** Dépouillement : gagnants de chaque trophée (ex æquo possibles) + coup de cœur du public. */
export function tally(state) {
  const out = [];
  for (const t of TROPHIES) {
    const count = {};
    for (const v of Object.values(state.votes)) if (v[t.id]) count[v[t.id]] = (count[v[t.id]] || 0) + 1;
    const max = Math.max(0, ...Object.values(count));
    const winners = max ? Object.keys(count).filter((id) => count[id] === max) : [];
    out.push({ id: t.id, icon: t.icon, title: t.title, q: t.q, winners, votes: max });
  }
  // Coup de cœur : l'étape qui a reçu le plus de réactions pendant la révélation.
  let best = null;
  for (const [k, r] of Object.entries(state.react || {})) {
    const n = Object.values(r).reduce((a, b) => a + b, 0);
    const [b, si] = k.split(':').map(Number);
    const st = state.books[b]?.steps[si];
    if (st && !st.skipped && (!best || n > best.n)) best = { b, s: si, n, by: st.by, kind: st.kind };
  }
  if (best) out.push({ id: 'crowd', icon: '💖', title: 'Coup de cœur du public', q: `${best.n} réaction${best.n > 1 ? 's' : ''}`, winners: [best.by], step: { b: best.b, s: best.s }, votes: best.n });
  return out;
}

export function endVote(state) {
  if (state.phase !== 'vote') return state;
  const s = clone(state);
  s.results = tally(s);
  s.phase = 'end';
  return s;
}

/** Retour au salon : mêmes joueurs, nouvelle partie. */
export function backToLobby(state) {
  const s = resetGame(clone(state));
  for (const id of Object.keys(s.players)) if (s.players[id].gone) delete s.players[id];
  return s;
}

// ---------- Ce que voient les téléphones ----------

/**
 * État diffusé à tout le monde : sans le contenu des carnets (phrases et dessins
 * restent sur le téléphone du maître du jeu, qui envoie à chacun ce qu'il doit voir).
 */
export function publicState(state) {
  const { books, ...rest } = state;
  return {
    ...rest,
    books: books.map((b) => ({ owner: b.owner, steps: b.steps.map((st) => ({ kind: st.kind, by: st.by, ...(st.skipped ? { skipped: true } : {}) })) })),
    submitted: submittedIds(state),
    votes: Object.fromEntries(Object.keys(state.votes).map((k) => [k, true])), // qui a voté, pas pour qui
  };
}

/** Contenu d'une étape déjà révélée (ou null). */
export function stepContent(state, b, si) {
  if (!revealedSteps(state, b).includes(si)) return null;
  const st = state.books[b].steps[si];
  return { kind: st.kind, by: st.by, ...(st.skipped ? { skipped: true } : { data: st.data }) };
}
