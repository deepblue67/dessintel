// Téléphone d'un joueur : écrire, dessiner, puis découvrir les carnets.
import { createTransport } from './transport.js';
import * as G from './game.js';
import { getRoom, link, esc, $, toast, keepAwake, setConn, deviceId, resetDeviceId, profileStore, draftStore, createHostClock, AVATARS, COLORS } from './common.js';
import { avatarBubble, flipRender, progressHtml, roundLabel, createFeed, voteFormHtml, votedHtml, trophiesHtml, who } from './ui.js';
import { createTaskView } from './task.js';
import { shareBook } from './draw.js';
import * as FX from './fx.js';

const room = getRoom();
if (!room) {
  location.replace(link('index.html'));
  await new Promise(() => {}); // stoppe le module pendant la redirection
}
const me = deviceId();
// Profil mémorisé sur ce téléphone. On ne rejoint tout seul que la MÊME salle
// (rechargement en cours de partie) ; pour une nouvelle salle, on redemande
// « Qui es-tu ? » car le téléphone a pu changer de mains.
const saved = profileStore.get();
let profile = saved && saved.room === room ? saved : null;
let state = null;
let online = false;
let hostOnline = null;
let hostSeenAt = 0;
let lastHello = 0;
let task = null; // dernière tâche reçue du maître du jeu
let pending = null; // copie envoyée, pas encore confirmée : { gameNo, round, data, at }
let lastNeedTask = 0;
let myVote = {};
const steps = new Map(); // contenu des étapes révélées : "partie:carnet:étape" -> étape
const clock = createHostClock();
const startedAt = Date.now();

$('#roomCode').textContent = room;

const tr = createTransport(room, {
  key: 'p-' + me,
  meta: { role: 'player', id: me },
  onStatus: (s) => {
    online = s === 'online';
    setConn(s, tr.local);
    if (online) {
      tr.send('need-state', {});
      sayHello(true);
    }
  },
});

function sayHello(force = false) {
  if (!profile || !online) return;
  if (!force && Date.now() - lastHello < 2500) return;
  lastHello = Date.now();
  tr.send('hello', { ...profile, id: me, role: 'player' });
}

const inGame = () => !!state && state.order.includes(me) && !state.players[me]?.gone;

// ---------- Messages ----------
let pick = []; // joueurs enregistrés proposés par le maître du jeu (« Qui es-tu ? »)
let onlineIds = new Set();
tr.on('state', ({ state: s, th, pick: pk }) => {
  clock.sample(th);
  hostSeenAt = Date.now();
  if (Array.isArray(pk) && JSON.stringify(pk) !== JSON.stringify(pick)) {
    pick = pk;
    renderWho();
  }
  if (state && s.gid === state.gid && s.v <= state.v) return;
  const prev = state;
  state = s;
  onStateChange(prev);
  renderWho();
  render();
});

tr.on('task', (m) => {
  if (m.to !== me) return;
  clock.sample(m.th);
  task = m;
  render();
});

tr.on('step', ({ gameNo, b, s, step }) => {
  steps.set(`${gameNo}:${b}:${s}`, step);
  if (state?.phase === 'reveal' && state.reveal.b === b) feed.update(state);
});

// Prénom refusé par le maître du jeu (déjà pris par un joueur connecté)
tr.on('join-err', ({ to, msg }) => {
  if (to !== me) return;
  toast(msg, 3500);
  FX.play('nope');
  draft = { ...draft, ...(profile || {}), rid: null };
  profile = null;
  renderJoin();
  $('#join').classList.add('open');
  render();
});

tr.on('fx', ({ kind, id, e }) => {
  if (kind === 'page') FX.play('page');
  else if (kind === 'react' && id !== me) FX.floatEmoji(e);
  else if (kind === 'reveal') FX.play('fanfare');
  else if (kind === 'end') {
    FX.play('fanfare');
    FX.confetti({ count: 200 });
  }
});

tr.onPresence((list) => {
  onlineIds = new Set(list.filter((m) => m.role === 'player').map((m) => m.id));
  renderWho();
  const h = list.some((m) => m.role === 'host');
  if (h) hostSeenAt = Date.now();
  hostOnline = h;
  render();
});

function onStateChange(prev) {
  // Pas encore inscrit (ou partie relancée) : on se (ré)annonce.
  if (profile && !state.players[me] && !state.kicked.includes(me)) sayHello();
  if (prev && prev.gameNo !== state.gameNo) {
    steps.clear();
    myVote = {};
  }
  if (state.phase !== 'play') task = null;
  // Copie confirmée (ou manche terminée) : plus besoin de la renvoyer.
  if (pending && (state.phase !== 'play' || state.gameNo !== pending.gameNo || state.round !== pending.round || state.submitted.includes(me))) pending = null;
  if (state.phase === 'vote' && prev?.phase !== 'vote') myVote = {};
}

function needTask() {
  if (!state || state.phase !== 'play' || !inGame()) return;
  const ok = task && task.gameNo === state.gameNo && task.round === state.round;
  if (ok || Date.now() - lastNeedTask < 1500) return;
  lastNeedTask = Date.now();
  tr.send('need-task', { id: me, gameNo: state.gameNo, round: state.round });
}

// Renvoi de la copie si le maître du jeu ne l'a pas confirmée (réseau capricieux).
setInterval(() => {
  needTask();
  if (pending && Date.now() - pending.at > 2500) {
    pending.at = Date.now();
    tr.send('submit', { id: me, gameNo: pending.gameNo, round: pending.round, data: pending.data });
  }
}, 500);

// ---------- Écran de jeu ----------
const view = createTaskView($('#taskBox'), {
  draft: draftStore,
  onSubmit: (data) => {
    if (!task) return;
    pending = { gameNo: task.gameNo, round: task.round, data, at: Date.now() };
    tr.send('submit', { id: me, gameNo: task.gameNo, round: task.round, data });
  },
});

const feed = createFeed($('#feed'), {
  getStep: (b, s) => steps.get(`${state.gameNo}:${b}:${s}`) || null,
  onMissing: (b) => askSteps(b),
});
let lastAsk = 0;
function askSteps(b) {
  if (Date.now() - lastAsk < 1200) return;
  lastAsk = Date.now();
  tr.send('need-steps', { gameNo: state.gameNo, b });
}

// ---------- Actions ----------
document.addEventListener('click', (e) => {
  FX.unlockAudio();
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || !state) return;
  const act = b.dataset.act;
  if (act === 'next') {
    tr.send('next', { id: me });
    FX.play('page');
  } else if (act === 'react') {
    const r = state.reveal;
    if (!r || r.s === 0) return;
    tr.send('react', { id: me, b: r.b, s: r.s - 1, e: b.dataset.e });
    FX.floatEmoji(b.dataset.e);
    FX.play('pop');
  } else if (act === 'share') shareCurrent();
  else if (act === 'pick') {
    const t = b.dataset.t;
    myVote = { ...myVote, [t]: myVote[t] === b.dataset.id ? undefined : b.dataset.id };
    renderVote(true);
  } else if (act === 'sendVote') {
    tr.send('vote', { id: me, choices: myVote });
    FX.play('done');
    toast('🗳️ Vote envoyé');
  }
});

function shareCurrent() {
  const b = state.reveal?.b;
  if (b == null) return;
  const book = state.books[b];
  const list = book.steps.map((st, s) => steps.get(`${state.gameNo}:${b}:${s}`) || { ...st, skipped: true });
  const p = who(state, book.owner);
  shareBook(list, state.players, `📒 Le carnet de ${p.name}`, `dessintel-carnet-${p.name}.png`).catch(() => toast('Impossible de créer l’image'));
}

// ---------- Rendu ----------
function setStatus(title, sub = '') {
  $('#title').textContent = title;
  $('#sub').textContent = sub;
  $('#status').hidden = !title;
}

function renderVote(force = false) {
  const box = $('#voteBox');
  const voter = state.phase === 'vote' && G.voters(state).includes(me);
  box.hidden = !voter;
  if (!voter) return;
  const key = JSON.stringify([state.v, myVote, !!state.votes[me]]);
  if (!force && box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="vote-form">${voteFormHtml(state, me, myVote)}</div>
    <button class="btn big go" data-act="sendVote">${state.votes[me] ? '✅ Vote reçu · renvoyer' : 'Voter 🗳️'}</button>`;
}

function dockHtml() {
  if (state.phase !== 'reveal') return '';
  const r = state.reveal;
  const book = state.books[r.b];
  const mine = book.owner === me;
  const bookEnd = r.s >= book.steps.length;
  const end = G.isRevealEnd(state);
  const reacts = r.s > 0 ? `<div class="reactbar">${G.REACTIONS.map((e) => `<button data-act="react" data-e="${e}">${e}</button>`).join('')}</div>` : '';
  const next = mine && !(end && bookEnd) ? `<button class="btn go" data-act="next">${bookEnd ? 'Carnet suivant 📒' : r.s === 0 ? 'Ouvrir mon carnet 📖' : 'Suivant ▶'}</button>` : '';
  const share = bookEnd ? '<button class="btn ghost" data-act="share">📸 Enregistrer</button>' : '';
  return `${reacts}${next || share ? `<div class="dock-row">${next}${share}</div>` : ''}`;
}

function render() {
  const joinOpen = !profile || $('#join').classList.contains('open');
  document.body.classList.toggle('joining', joinOpen);
  if (!state) {
    setStatus('Connexion…', Date.now() - startedAt > 4000 ? `En attente du maître du jeu (salle ${room})` : 'Recherche de la partie');
    return;
  }
  document.body.dataset.phase = state.phase;
  const kicked = state.kicked.includes(me) && !state.players[me];
  $('#kicked').hidden = !kicked;
  const p = state.players[me];
  if (p) {
    $('#meAv').textContent = p.avatar;
    $('#meAv').style.setProperty('--c', p.color);
    $('#meName').textContent = p.name;
  }
  $('#hostOff').hidden = hostOnline !== false || Date.now() - hostSeenAt < 4000;
  const pill = $('#roundPill');
  pill.hidden = state.phase !== 'play';
  if (state.phase === 'play') pill.textContent = `${state.round + 1}/${state.rounds}`;

  let sideTitle = '';
  let sideHtml = '';
  let showTask = false;

  switch (state.phase) {
    case 'lobby':
      setStatus(p ? 'Tu es dans le salon ! 🎉' : 'Inscription…', p ? 'Le maître du jeu va lancer la partie.' : 'Connexion au maître du jeu');
      sideTitle = '👥 Dans le salon';
      sideHtml = Object.values(state.players)
        .filter((x) => !x.gone)
        .map((x) => `<li data-key="${esc(x.id)}" class="prow" style="--c:${esc(x.color)}">${avatarBubble(x)}<span class="nm">${esc(x.name)}${x.id === me ? ' <em>(toi)</em>' : ''}</span></li>`)
        .join('');
      break;
    case 'play': {
      if (!inGame()) {
        setStatus('Partie en cours 🎨', 'Tu joueras à la prochaine partie. Regarde les autres s’activer !');
        sideTitle = roundLabel(state);
        sideHtml = progressHtml(state);
        break;
      }
      const ok = task && task.gameNo === state.gameNo && task.round === state.round;
      if (!ok) {
        setStatus('📒 On te passe un carnet…', '');
        break;
      }
      showTask = true;
      setStatus('');
      const sec = task.kind === 'draw' ? state.settings.drawSec : state.settings.writeSec;
      view.show(task, { key: `${room}:${task.gameNo}:${task.round}`, author: task.prev ? who(state, task.prev.by) : null, totalMs: sec * 1000 });
      if (view.isSent) {
        sideTitle = roundLabel(state);
        sideHtml = progressHtml(state, { me });
      }
      break;
    }
    case 'reveal':
      setStatus('');
      if (state.books[state.reveal.b].owner === me && state.reveal.s === 0) toastOnce('📖 C’est ton carnet ! À toi de tourner les pages');
      break;
    case 'vote':
      if (G.voters(state).includes(me)) setStatus('🏆 Les trophées', 'Vote pour tes favoris (pas pour toi !)');
      else setStatus('🏆 Les trophées', 'Les joueurs votent…');
      sideTitle = '🗳️ Qui a voté ?';
      sideHtml = votedHtml(state);
      break;
    case 'end':
      setStatus('');
      break;
  }

  $('#taskBox').hidden = !showTask;
  if (!showTask && view.key) view.clear();

  const inReveal = state.phase === 'reveal';
  $('#feedBox').hidden = !inReveal;
  if (inReveal) feed.update(state);
  const dock = $('#dock');
  dock.hidden = !inReveal;
  const dh = inReveal ? dockHtml() : '';
  if (dock.dataset.html !== dh) {
    dock.innerHTML = dh;
    dock.dataset.html = dh;
  }

  renderVote();
  const endBox = $('#endBox');
  endBox.hidden = state.phase !== 'end';
  if (state.phase === 'end' && endBox.dataset.v !== String(state.v)) {
    endBox.dataset.v = state.v;
    endBox.innerHTML = `${trophiesHtml(state)}<p class="muted center">Le maître du jeu peut relancer une partie 🔁</p>`;
  }

  $('#sideCard').hidden = !sideHtml;
  $('#sideTitle').textContent = sideTitle;
  if (sideHtml) flipRender($('#side'), sideHtml);
}

let toasted = '';
function toastOnce(msg) {
  const k = state.gameNo + ':' + state.reveal.b;
  if (toasted === k) return;
  toasted = k;
  toast(msg, 3500);
  FX.vibrate([60, 60, 60]);
}

// Minuteur
setInterval(() => {
  if (!state) return render();
  if (state.phase === 'play' && view.key) view.tick(state.deadline ? state.deadline - clock.now() : null);
  if (view.isSent && state.phase === 'play' && $('#sideCard').hidden) render();
}, 200);

// ---------- Inscription ----------
const form = $('#joinForm');
let draft = {
  name: saved?.name || '',
  avatar: saved?.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)],
  color: saved?.color || COLORS[Math.floor(Math.random() * COLORS.length)],
  rid: saved?.rid || null, // joueur enregistré choisi dans « Qui es-tu ? »
};
const sameName = (a, b) => String(a).trim().toLocaleLowerCase('fr') === String(b).trim().toLocaleLowerCase('fr');
/** Prénom déjà utilisé par un autre joueur connecté ? */
function takenBy(name) {
  if (!state) return null;
  return Object.values(state.players).find((p) => p.id !== me && !p.gone && (onlineIds.has(p.id) || p.id.startsWith('h-')) && sameName(p.name, name)) || null;
}

/** « Qui es-tu ? » : joueurs enregistrés du groupe qui joue, sauf ceux déjà connectés. */
function renderWho() {
  const box = $('#who');
  if (!box) return;
  const list = pick.filter((p) => !takenBy(p.name));
  box.hidden = !list.length;
  $('#whoList').innerHTML = list
    .map((p) => `<button type="button" class="who-chip ${draft.rid === p.id ? 'on' : ''}" data-rid="${esc(p.id)}" style="--c:${esc(p.color)}"><span class="av" style="--c:${esc(p.color)}">${esc(p.avatar)}</span>${esc(p.name)}</button>`)
    .join('');
  $('#nameLbl').firstChild.textContent = list.length ? 'Ou écris ton prénom' : 'Prénom';
}

function renderJoin() {
  form.name.value = draft.name;
  $('#joinTitle').textContent = profile ? 'Qui joue sur ce téléphone ?' : 'Qui es-tu ?';
  $('#joinHint').hidden = !profile;
  $('#joinHint').textContent = profile ? `Tu passes le téléphone ? Choisis un autre prénom : ${profile.name} garde sa place.` : '';
  renderWho();
  $('#avatars').innerHTML = AVATARS.map((a) => `<button type="button" class="pick ${a === draft.avatar ? 'on' : ''}" data-av="${a}">${a}</button>`).join('');
  $('#colors').innerHTML = COLORS.map((c) => `<button type="button" class="swatch ${c === draft.color ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join('');
  $('#preview').style.setProperty('--c', draft.color);
  $('#preview').textContent = draft.avatar;
}
form.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  FX.unlockAudio();
  if (b.dataset.rid) {
    const p = pick.find((x) => x.id === b.dataset.rid);
    if (p) draft = { ...draft, name: p.name, avatar: p.avatar, color: p.color, rid: p.id };
    renderJoin();
    return;
  }
  if (b.dataset.av) draft.avatar = b.dataset.av;
  if (b.dataset.color) draft.color = b.dataset.color;
  draft.name = form.name.value;
  renderJoin();
});
form.name.addEventListener('input', () => {
  draft.name = form.name.value;
  const p = draft.rid && pick.find((x) => x.id === draft.rid);
  if (draft.rid && (!p || !sameName(p.name, draft.name))) {
    draft.rid = null;
    renderWho();
  }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  FX.unlockAudio();
  const name = form.name.value.trim();
  if (!name) {
    form.name.focus();
    toast('Ton prénom d’abord 😉');
    return;
  }
  const other = takenBy(name);
  if (other) {
    toast(`${other.name} est déjà dans la partie 🙂 Choisis un autre prénom.`, 3500);
    return;
  }
  const rp = draft.rid && pick.find((x) => x.id === draft.rid);
  const next = { ...draft, name: name.slice(0, 16), rid: rp && sameName(rp.name, name) ? rp.id : null, room };
  if (profile && !sameName(profile.name, next.name)) {
    // Le téléphone passe à quelqu'un d'autre : nouvelle identité (l'ancien joueur
    // garde sa place dans la partie), puis on recharge pour repartir proprement.
    profileStore.set(next);
    resetDeviceId();
    location.reload();
    return;
  }
  profile = next;
  profileStore.set(profile);
  $('#join').classList.remove('open');
  FX.play('join');
  sayHello(true);
  render();
});
$('#editProfile').addEventListener('click', () => {
  if (profile) draft = { ...profile };
  renderJoin();
  $('#join').classList.add('open');
  render();
});
$('#rejoin').addEventListener('click', () => {
  tr.send('hello', { ...profile, id: me, role: 'player', rejoin: true });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    tr.send('need-state', {});
    lastNeedTask = 0;
  }
});

renderJoin();
if (!profile) $('#join').classList.add('open');
render();
keepAwake();
