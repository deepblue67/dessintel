// Maître du jeu : son téléphone garde la partie (tous les carnets) et fait foi.
// Il peut aussi jouer : il reçoit alors ses tâches comme les autres, sans passer par le réseau.
import { createTransport } from './transport.js';
import * as G from './game.js';
import { getRoom, makeRoomCode, link, absUrl, store, deviceStore, draftStore, esc, $, toast, keepAwake, setConn, qrSvg, plural, AVATARS, COLORS } from './common.js';
import { createRosterStore } from './roster.js';
import { avatarBubble, flipRender, progressHtml, roundLabel, createFeed, voteFormHtml, votedHtml, trophiesHtml, who } from './ui.js';
import { createTaskView } from './task.js';
import { shareBook } from './draw.js';
import * as FX from './fx.js';

// ---------- Salle ----------
let room = getRoom();
if (!room) {
  location.replace(link('host.html', { r: makeRoomCode() }));
  await new Promise(() => {}); // stoppe le module pendant la redirection
}
const SAVE_KEY = 'dessintel-host:' + room;
deviceStore.set('dessintel-last-host-room', room);

const roster = createRosterStore(store); // joueurs enregistrés et groupes (sur ce téléphone)
let state = deviceStore.get(SAVE_KEY) || G.newGame(room, Date.now(), { ...deviceStore.get('dessintel-settings', {}), group: store.get('dessintel-group', '') });
if (state.settings.group && !roster.group(state.settings.group)) state.settings.group = '';
let me = deviceStore.get('dessintel-host-me'); // le maître du jeu joue aussi : { id, name, avatar, color }
let online = new Set();
let soundOn = store.get('dessintel-host-sound', true);
FX.setMuted(!soundOn);
const inst = G.randomId(6);
const joinUrl = absUrl('play.html', { r: room });
const sentSteps = new Set(); // étapes déjà diffusées pendant la révélation
let saveWarned = false;

const tr = createTransport(room, {
  key: 'host-' + inst,
  meta: { role: 'host', inst },
  onStatus: (s) => {
    setConn(s, tr.local);
    if (s === 'online') {
      broadcastState();
      sendTasks();
    }
  },
});

// ---------- État ----------
let bcTimer = null;
function broadcastState() {
  clearTimeout(bcTimer);
  bcTimer = setTimeout(() => tr.send('state', { state: G.publicState(state), th: Date.now(), pick: pickList() }), 30);
}

/** Prénoms proposés dans le « Qui es-tu ? » des téléphones : joueurs enregistrés du groupe qui joue. */
function pickList() {
  return roster.inGroup(state.settings.group).map(({ id, name, avatar, color }) => ({ id, name, avatar, color }));
}
const sameName = (a, b) => String(a).trim().toLocaleLowerCase('fr') === String(b).trim().toLocaleLowerCase('fr');
const isOnline = (id) => id === me?.id || online.has(id);

function save() {
  if (!deviceStore.set(SAVE_KEY, state) && !saveWarned) {
    saveWarned = true;
    toast('⚠️ Mémoire du navigateur pleine : la partie ne pourra pas être reprise si la page se recharge', 5000);
  }
}

function commit(next) {
  if (!next || next === state) return false;
  const prev = state;
  next.v = state.v + 1;
  state = next;
  save();
  afterChange(prev);
  render();
  broadcastState();
  return true;
}

function fx(kind, extra = {}) {
  tr.send('fx', { kind, ...extra });
}

// ---------- Minuteurs ----------
const GRACE_MS = 3500; // les téléphones envoient leur copie à la fin du temps : on leur laisse le temps d'arriver
let advTimer = null;
let deadTimer = null;
function afterChange(prev) {
  const newRound = state.phase === 'play' && (prev.phase !== 'play' || prev.round !== state.round || prev.gameNo !== state.gameNo);
  if (newRound) {
    draftStore.purge(`${room}:${state.gameNo}:`);
    sendTasks();
    FX.play('round');
    fx('round');
  }
  if (state.phase === 'reveal') sendRevealed();
  if (prev.phase !== state.phase) {
    if (state.phase === 'reveal' && prev.phase === 'play') {
      FX.play('fanfare');
      fx('reveal');
    }
    if (state.phase === 'end') {
      FX.play('fanfare');
      FX.confetti({ count: 240 });
      fx('end');
    }
  }
  scheduleTimers();
}

function scheduleTimers() {
  clearTimeout(advTimer);
  clearTimeout(deadTimer);
  if (state.phase !== 'play') return;
  if (G.isRoundComplete(state)) {
    advTimer = setTimeout(() => commit(G.advance(state, Date.now())), 1300);
  } else if (state.deadline) {
    deadTimer = setTimeout(() => commit(G.advance(G.skipMissing(state), Date.now())), Math.max(0, state.deadline + GRACE_MS - Date.now()));
  }
}

// ---------- Tâches ----------
function taskMsg(id) {
  const t = G.taskFor(state, id);
  if (!t) return null;
  return { to: id, gameNo: state.gameNo, deadline: state.deadline, th: Date.now(), ...t };
}
function sendTask(id) {
  if (id === me?.id) return renderMine();
  const m = taskMsg(id);
  if (m) tr.send('task', m);
}
function sendTasks() {
  if (state.phase !== 'play') return;
  for (const id of state.order) if (!G.isGone(state, id)) sendTask(id);
}

function onSubmit(id, gameNo, round, data) {
  if (gameNo !== state.gameNo) return;
  const next = G.submit(state, id, round, data);
  if (next) commit(next);
  else broadcastState();
}

// ---------- Révélation ----------
function sendStep(b, s) {
  const st = G.stepContent(state, b, s);
  if (!st) return;
  sentSteps.add(`${state.gameNo}:${b}:${s}`);
  tr.send('step', { gameNo: state.gameNo, b, s, step: st });
}
function sendRevealed() {
  const b = state.reveal?.b;
  if (b == null) return;
  for (const s of G.revealedSteps(state, b)) if (!sentSteps.has(`${state.gameNo}:${b}:${s}`)) sendStep(b, s);
}
const lastAsk = new Map();

// ---------- Messages ----------
tr.on('need-state', broadcastState);

tr.on('hello', (m) => {
  if (m.role === 'tv') {
    broadcastState();
    return;
  }
  const name = String(m.name || '').trim().slice(0, 16);
  if (!name || !m.id) return;
  // Un prénom = un joueur : refusé si quelqu'un de connecté l'utilise déjà,
  // sinon (ancien téléphone déconnecté) ce téléphone reprend sa place et ses carnets.
  let base = state;
  const clash = Object.values(state.players).find((p) => p.id !== m.id && sameName(p.name, name) && !p.gone);
  if (clash) {
    if (isOnline(clash.id)) return tr.send('join-err', { to: m.id, msg: `${clash.name} est déjà dans la partie 🙂 Choisis un autre prénom.` });
    base = G.movePlayer(state, clash.id, m.id);
  }
  const isNew = !state.players[m.id] && !clash;
  const next = G.upsertPlayer(base, { ...m, name }, Date.now(), { rejoin: !!m.rejoin });
  // Joueur enregistré qui change son animal ou sa couleur sur son téléphone : on le retient.
  const r = m.rid && roster.players.find((x) => x.id === m.rid);
  if (next && r && sameName(r.name, name) && (r.avatar !== m.avatar || r.color !== m.color)) {
    roster.update(r.id, { avatar: m.avatar, color: m.color });
  }
  if (!next) return broadcastState(); // joueur exclu : il verra qu'il n'est plus dans la partie
  const changed = base !== state || JSON.stringify(next.players[m.id]) !== JSON.stringify(state.players[m.id]) || next.kicked.length !== state.kicked.length;
  if (changed) commit(next);
  else broadcastState();
  if (isNew) {
    FX.play('join');
    fx('join', { id: m.id });
  }
  if (state.phase === 'play') sendTask(m.id);
});

tr.on('need-task', ({ id, gameNo }) => {
  if (state.phase === 'play' && (gameNo == null || gameNo === state.gameNo)) sendTask(id);
  else broadcastState();
});

tr.on('submit', ({ id, gameNo, round, data }) => onSubmit(id, gameNo, round, data));

tr.on('need-steps', ({ gameNo, b }) => {
  if (gameNo !== state.gameNo) return broadcastState();
  const k = String(b);
  if (Date.now() - (lastAsk.get(k) || 0) < 700) return;
  lastAsk.set(k, Date.now());
  for (const s of G.revealedSteps(state, b)) sendStep(b, s);
});

tr.on('next', ({ id }) => {
  if (state.phase === 'reveal' && state.books[state.reveal.b]?.owner === id) actions.next();
});

const lastReact = new Map();
tr.on('react', ({ id, b, s, e }) => {
  if (!state.players[id] || Date.now() - (lastReact.get(id) || 0) < 250) return;
  lastReact.set(id, Date.now());
  doReact(id, b, s, e);
});
function doReact(id, b, s, e) {
  if (commit(G.react(state, b, s, e))) {
    FX.floatEmoji(e);
    FX.play('pop');
    fx('react', { id, e });
  }
}

tr.on('vote', ({ id, choices }) => onVote(id, choices));
let voteTimer = null;
function onVote(id, choices) {
  if (!commit(G.vote(state, id, choices))) return;
  clearTimeout(voteTimer);
  if (G.allVoted(state)) voteTimer = setTimeout(() => commit(G.endVote(state)), 1200);
}

tr.onPresence((list) => {
  online = new Set(list.filter((m) => m.role === 'player').map((m) => m.id));
  const otherHost = list.some((m) => m.role === 'host' && m.inst !== inst);
  $('#dupHost').hidden = !otherHost;
  render();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') broadcastState();
});
setInterval(broadcastState, 5000);

// ---------- Actions ----------
/** Joueurs connectés qui prendront part à la partie. */
const readyIds = () => Object.values(state.players).filter((p) => !p.gone && isOnline(p.id)).map((p) => p.id);

const actions = {
  start() {
    const ids = readyIds();
    if (ids.length < G.MIN_PLAYERS) return toast(`Il faut au moins ${G.MIN_PLAYERS} joueurs connectés 🙂`);
    sentSteps.clear();
    commit(G.startGame(state, ids, Date.now()));
  },
  endRound() {
    const miss = state.order.length - (G.publicState(state).submitted.length);
    if (miss && !confirm(`Terminer la manche maintenant ? ${plural(miss, 'joueur')} passer${miss > 1 ? 'ont' : 'a'} son tour.`)) return;
    commit(G.advance(G.skipMissing(state), Date.now()));
  },
  next() {
    if (state.phase !== 'reveal') return;
    if (commit(G.revealNext(state))) {
      FX.play('page');
      fx('page');
    }
  },
  prev() {
    commit(G.revealPrev(state));
  },
  vote() {
    commit(G.startVote(state));
  },
  endVote() {
    if (!G.allVoted(state) && !confirm('Tout le monde n’a pas voté. Afficher les trophées quand même ?')) return;
    commit(G.endVote(state));
  },
  results() {
    if (state.results) commit({ ...state, phase: 'end' });
  },
  lobby() {
    if (state.phase !== 'lobby' && state.phase !== 'end' && !confirm('Arrêter la partie en cours et revenir au salon ?')) return;
    closeModal();
    commit(G.backToLobby(state));
  },
  share() {
    const b = state.reveal?.b ?? 0;
    const book = state.books[b];
    if (!book) return;
    const p = who(state, book.owner);
    shareBook(book.steps, state.players, `📒 Le carnet de ${p.name}`, `dessintel-carnet-${p.name}.png`).catch(() => toast('Impossible de créer l’image'));
  },
  newroom() {
    if (!confirm('Créer une nouvelle salle ? Les joueurs devront rescanner le QR code.')) return;
    location.href = link('host.html', { r: makeRoomCode() });
  },
  qr() {
    openModal('#qrModal');
  },
  settings() {
    syncSettingsForm();
    openModal('#setModal');
  },
  roster() {
    renderRoster();
    openModal('#rosterModal');
  },
  playme() {
    renderMe();
    openModal('#meModal');
  },
  close() {
    closeModal();
  },
};

document.addEventListener('click', (e) => {
  FX.unlockAudio();
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const id = b.dataset.id;
  if (act.startsWith('r') && rosterActs[act]) return rosterActs[act](b);
  if (act.startsWith('me') && meActs[act]) return meActs[act](b);
  switch (act) {
    case 'group':
      store.set('dessintel-group', b.dataset.g);
      return commit(G.setSettings(state, { group: b.dataset.g }));
    case 'skip': {
      const p = state.players[id];
      if (p && confirm(`Passer le tour de ${p.name} pour cette manche ?`)) commit(G.skipMissing(state, [id]));
      return;
    }
    case 'kick': {
      const p = state.players[id];
      if (!p) return;
      const msg = state.phase === 'lobby' ? `Retirer ${p.name} du salon ?` : `Exclure ${p.name} de la partie ? Ses prochains tours seront passés.`;
      if (confirm(msg)) commit(G.kick(state, id));
      return;
    }
    case 'goto':
      return commit(G.revealGoto(state, Number(b.dataset.b)));
    case 'react':
      if (me && state.reveal) doReact(me.id, state.reveal.b, Math.max(0, state.reveal.s - 1), b.dataset.e);
      return;
    case 'pick':
      return pickVote(b.dataset.t, id);
  }
  actions[act]?.();
});

// Clavier (si le maître du jeu anime depuis un PC) : flèches ou Entrée pour tourner les pages.
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || state.phase !== 'reveal') return;
  if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    actions.next();
  } else if (e.key === 'ArrowLeft') actions.prev();
});

// ---------- Le maître du jeu joue aussi ----------
const myTask = createTaskView($('#mine'), {
  draft: draftStore,
  onSubmit: (data) => me && onSubmit(me.id, state.gameNo, state.round, data),
});

function renderMine() {
  const box = $('#mine');
  const t = me && state.phase === 'play' ? G.taskFor(state, me.id) : null;
  box.hidden = !t;
  if (!t) {
    if (myTask.key) myTask.clear();
    return;
  }
  const key = `${room}:${state.gameNo}:${state.round}`;
  const sec = t.kind === 'draw' ? state.settings.drawSec : state.settings.writeSec;
  myTask.show(t, { key, author: t.prev ? who(state, t.prev.by) : null, totalMs: sec * 1000 });
}

let myVote = {};
function pickVote(t, id) {
  if (!me) return;
  myVote = { ...myVote, [t]: myVote[t] === id ? undefined : id };
  lastStageKey = '';
  render();
}

let meDraft = null;
const meActs = {
  mePick: (b) => {
    const p = roster.players.find((x) => x.id === b.dataset.id);
    if (p) meDraft = { ...meDraft, name: p.name, avatar: p.avatar, color: p.color };
    renderMe();
  },
  meAv: (b) => {
    meDraft.avatar = b.dataset.av;
    renderMe();
  },
  meCol: (b) => {
    meDraft.color = b.dataset.c;
    renderMe();
  },
  meOk: () => {
    const name = $('#meName').value.trim().slice(0, 16);
    if (!name) return toast('Ton prénom d’abord 😉');
    const clash = Object.values(state.players).find((p) => p.id !== me?.id && sameName(p.name, name) && !p.gone);
    if (clash) return toast(`${clash.name} est déjà dans la partie`);
    me = { id: me?.id || 'h-' + G.randomId(10), name, avatar: meDraft.avatar, color: meDraft.color };
    deviceStore.set('dessintel-host-me', me);
    commit(G.upsertPlayer(state, me, Date.now(), { rejoin: true }));
    closeModal();
    FX.play('join');
  },
  meOff: () => {
    if (!me) return closeModal();
    if (state.order.includes(me.id) && state.phase !== 'lobby' && !confirm('Tu ne joues plus ? Tes prochains tours seront passés.')) return;
    const id = me.id;
    me = null;
    deviceStore.del('dessintel-host-me');
    const s = state.order.includes(id) ? G.kick(state, id) : { ...state, players: Object.fromEntries(Object.entries(state.players).filter(([k]) => k !== id)) };
    commit({ ...s, kicked: s.kicked.filter((k) => k !== id) });
    closeModal();
  },
};
function renderMe() {
  meDraft ||= me ? { ...me } : { name: '', avatar: AVATARS[Math.floor(Math.random() * AVATARS.length)], color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  const typed = $('#meName')?.value;
  if (typed != null) meDraft.name = typed;
  const list = roster.inGroup(state.settings.group).filter((p) => !Object.values(state.players).some((x) => x.id !== me?.id && sameName(x.name, p.name) && !x.gone));
  $('#meBody').innerHTML = `<div class="join-head"><span class="av xl" style="--c:${esc(meDraft.color)}">${esc(meDraft.avatar)}</span><div><h2>🙋 Je joue aussi</h2><p class="muted small">Ce téléphone reste le maître du jeu, et tu reçois tes phrases et dessins à faire comme les autres.</p></div></div>
    ${list.length ? `<div class="lbl">Choisis ton prénom</div><div class="grid-who">${list.map((p) => `<button type="button" class="who-chip ${sameName(p.name, meDraft.name) ? 'on' : ''}" data-act="mePick" data-id="${esc(p.id)}" style="--c:${esc(p.color)}">${avatarBubble(p)}${esc(p.name)}</button>`).join('')}</div>` : ''}
    <label class="lbl">${list.length ? 'Ou écris ton prénom' : 'Prénom'}<input id="meName" maxlength="16" value="${esc(meDraft.name)}" placeholder="Ex. Christophe"></label>
    <div class="lbl">Avatar</div><div class="grid-picks">${AVATARS.map((a) => `<button type="button" class="pick ${a === meDraft.avatar ? 'on' : ''}" data-act="meAv" data-av="${a}">${a}</button>`).join('')}</div>
    <div class="lbl">Couleur</div><div class="grid-swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === meDraft.color ? 'on' : ''}" data-act="meCol" data-c="${c}" style="--c:${c}"></button>`).join('')}</div>
    <button class="btn big go" data-act="meOk">${me ? 'Enregistrer' : 'Je joue ! 🎨'}</button>
    <div class="row">${me ? '<button class="btn ghost" data-act="meOff">🙅 Je ne joue plus</button>' : ''}<button class="btn ghost" data-act="close">Fermer</button></div>`;
}

// ---------- Joueurs enregistrés & groupes ----------
let rFilter = '';
let rGroupsOpen = false;
const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
function rosterChanged() {
  renderRoster();
  lastStageKey = '';
  render();
  broadcastState();
}
function tryRoster(fn) {
  try {
    fn();
    rosterChanged();
  } catch (err) {
    toast(err.message);
  }
}
const rosterActs = {
  rFilter: (b) => {
    rFilter = b.dataset.g;
    renderRoster();
  },
  rGroups: () => {
    rGroupsOpen = !rGroupsOpen;
    renderRoster();
  },
  rAvatar: (b) => tryRoster(() => roster.update(b.dataset.id, { avatar: cycle(AVATARS, roster.players.find((p) => p.id === b.dataset.id)?.avatar) })),
  rColor: (b) => tryRoster(() => roster.update(b.dataset.id, { color: cycle(COLORS, roster.players.find((p) => p.id === b.dataset.id)?.color) })),
  rToggle: (b) => tryRoster(() => roster.toggleGroup(b.dataset.id, b.dataset.g)),
  rDel: (b) => {
    const p = roster.players.find((x) => x.id === b.dataset.id);
    if (p && confirm(`Supprimer ${p.name} de la liste des joueurs enregistrés ?`)) tryRoster(() => roster.remove(p.id));
  },
  rAdd: () => {
    const el = $('#rNew');
    const used = roster.players;
    tryRoster(() => {
      roster.add(el.value, {
        groupId: rFilter || state.settings.group,
        avatar: AVATARS.find((a) => !used.some((p) => p.avatar === a)),
        color: COLORS.find((c) => !used.some((p) => p.color === c)) || COLORS[used.length % COLORS.length],
      });
    });
    setTimeout(() => $('#rNew')?.focus(), 0);
  },
  rgIcon: (b) => tryRoster(() => roster.cycleGroupIcon(b.dataset.g)),
  rgAdd: () => tryRoster(() => roster.addGroup($('#gNew').value)),
  rgDel: (b) => {
    const g = roster.group(b.dataset.g);
    if (!g || !confirm(`Supprimer le groupe ${g.icon} ${g.name} ? Les joueurs ne sont pas supprimés : ils quittent seulement ce groupe.`)) return;
    tryRoster(() => {
      roster.removeGroup(g.id);
      if (rFilter === g.id) rFilter = '';
      if (state.settings.group === g.id) commit(G.setSettings(state, { group: '' }));
    });
  },
  rImport: () =>
    tryRoster(() => {
      const n = roster.importUndercover($('#impTxt').value);
      $('#impTxt').value = '';
      toast(n ? `✅ ${plural(n, 'joueur')} importé${n > 1 ? 's' : ''} d’Undercover` : '✅ Groupes mis à jour (aucun nouveau joueur)');
    }),
};

function renderRoster() {
  const body = $('#rosterBody');
  if (!body) return;
  const list = roster.inGroup(rFilter);
  const count = (gid) => roster.inGroup(gid).length;
  const chips = [['', '👥 Tous']]
    .concat(roster.groups.map((g) => [g.id, `${g.icon} ${esc(g.name)}`]))
    .map(([id, l]) => `<button class="chip ${rFilter === id ? 'on' : ''}" data-act="rFilter" data-g="${esc(id)}">${l} <small>${count(id)}</small></button>`)
    .join('');
  const groupsEditor = rGroupsOpen
    ? `<div class="gedit">${roster.groups
        .map(
          (g) => `<div class="grow-row"><button class="mini big-ico" data-act="rgIcon" data-g="${esc(g.id)}" aria-label="Changer l’icône">${g.icon}</button>
          <input class="gname" data-gid="${esc(g.id)}" value="${esc(g.name)}" maxlength="20" aria-label="Nom du groupe">
          <span class="muted small">${count(g.id)}</span><button class="mini kick" data-act="rgDel" data-g="${esc(g.id)}" aria-label="Supprimer le groupe">✕</button></div>`
        )
        .join('')}
        <div class="row add-row"><input id="gNew" placeholder="Nouveau groupe (ex. Foot, Voisins)" maxlength="20" enterkeyhint="done"><button class="btn go" data-act="rgAdd">＋</button></div></div>`
    : '';
  const rows = list
    .map(
      (p) => `<div class="rrow" style="--c:${esc(p.color)}">
      <button class="av" style="--c:${esc(p.color)}" data-act="rAvatar" data-id="${esc(p.id)}" aria-label="Changer l’animal">${esc(p.avatar)}</button>
      <input class="rname" data-rid="${esc(p.id)}" value="${esc(p.name)}" maxlength="16" aria-label="Prénom">
      <button class="dot" style="background:${esc(p.color)}" data-act="rColor" data-id="${esc(p.id)}" aria-label="Changer la couleur"></button>
      <button class="mini kick" data-act="rDel" data-id="${esc(p.id)}" aria-label="Supprimer">✕</button>
      <div class="gchips">${roster.groups.map((g) => `<button class="gchip ${p.groups.includes(g.id) ? 'on' : ''}" data-act="rToggle" data-id="${esc(p.id)}" data-g="${esc(g.id)}">${g.icon} ${esc(g.name)}</button>`).join('')}</div></div>`
    )
    .join('');
  body.innerHTML = `<h2>👥 Joueurs enregistrés</h2>
    <p class="muted small">Ils apparaissent dans le « Qui es-tu ? » des téléphones. Touche l’animal ou la pastille pour les changer, et les groupes pour y ranger un joueur.</p>
    <div class="chips">${chips}<button class="chip add" data-act="rGroups">⚙️ Groupes</button></div>
    ${groupsEditor}
    <div class="rlist">${rows || `<p class="muted center">${rFilter ? 'Personne dans ce groupe.' : 'Aucun joueur enregistré pour l’instant.'}</p>`}</div>
    <div class="row add-row"><input id="rNew" placeholder="Prénom du nouveau joueur" maxlength="16" enterkeyhint="done"><button class="btn go" data-act="rAdd">＋</button></div>
    <details class="imp"><summary>📥 Importer depuis Undercover</summary>
      <p class="muted small">Dans Undercover : « Exporter mes données », puis copie le code (il commence par UCF2:) ou télécharge le fichier. Les joueurs et les groupes sont ajoutés, rien n’est effacé.</p>
      <textarea id="impTxt" rows="3" placeholder="Colle le code ici (UCF2:…)"></textarea>
      <div class="row"><button class="btn" data-act="rImport">Importer le code</button><label class="btn ghost">📂 Fichier .json<input type="file" id="impFile" accept=".json,.txt,application/json,text/plain" hidden></label></div>
    </details>
    <button class="btn" data-act="close">Fermer</button>`;
}
$('#rosterBody').addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList.contains('rname')) {
    try {
      roster.update(t.dataset.rid, { name: t.value });
    } catch (err) {
      toast(err.message);
    }
    rosterChanged();
  } else if (t.classList.contains('gname')) {
    roster.renameGroup(t.dataset.gid, t.value);
    rosterChanged();
  } else if (t.id === 'impFile' && t.files[0]) {
    t.files[0].text().then((txt) => {
      $('#impTxt').value = txt;
      rosterActs.rImport();
    });
  }
});
$('#rosterBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'rNew') rosterActs.rAdd();
  else if (e.target.id === 'gNew') rosterActs.rgAdd();
  else if (e.target.matches('.rname, .gname')) e.target.blur();
});

function groupPickerHtml() {
  const cur = state.settings.group;
  const opts = [['', '👥 Tous', roster.players.length]].concat(roster.groups.map((g) => [g.id, `${g.icon} ${esc(g.name)}`, roster.inGroup(g.id).length]));
  return `<div class="gpick"><span class="muted small">Groupe qui joue</span><div class="chips">${opts
    .map(([id, l, n]) => `<button class="chip ${cur === id ? 'on' : ''}" data-act="group" data-g="${esc(id)}">${l} <small>${n}</small></button>`)
    .join('')}<button class="chip add" data-act="roster">✏️ Joueurs</button></div></div>`;
}

// ---------- Modales & réglages ----------
function openModal(sel) {
  $(sel).classList.add('open');
}
function closeModal() {
  document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
  meDraft = null;
}
document.querySelectorAll('.modal').forEach((m) =>
  m.addEventListener('click', (e) => {
    if (e.target === m) closeModal();
  })
);

function syncSettingsForm() {
  const f = $('#setForm');
  const S = state.settings;
  const setSel = (sel, v) => {
    if (![...sel.options].some((o) => o.value === String(v))) sel.add(new Option(`${v}`, String(v)));
    sel.value = String(v);
  };
  setSel(f.writeSec, S.writeSec);
  setSel(f.drawSec, S.drawSec);
  setSel(f.maxSteps, S.maxSteps);
  const locked = !(state.phase === 'lobby' || state.phase === 'end');
  for (const n of ['writeSec', 'drawSec', 'maxSteps']) f[n].disabled = locked;
  $('#setLocked').hidden = !locked;
  f.sound.checked = soundOn;
  $('#tvLink').href = link('tv.html', { r: room });
  $('#tvUrl').textContent = absUrl('tv.html', { r: room });
}
$('#setForm').addEventListener('change', (e) => {
  const f = e.currentTarget;
  if (e.target.name === 'sound') {
    soundOn = f.sound.checked;
    store.set('dessintel-host-sound', soundOn);
    FX.setMuted(!soundOn);
    return;
  }
  const patch = { writeSec: f.writeSec.value, drawSec: f.drawSec.value, maxSteps: f.maxSteps.value };
  commit(G.setSettings(state, patch));
  deviceStore.set('dessintel-settings', { writeSec: state.settings.writeSec, drawSec: state.settings.drawSec, maxSteps: state.settings.maxSteps });
});

// ---------- Rendu ----------
const fmtSec = (s) => (s ? (s >= 60 ? `${Math.floor(s / 60)} min${s % 60 ? ' ' + (s % 60) : ''}` : `${s} s`) : 'sans limite');

function stageHtml() {
  const S = state.settings;
  switch (state.phase) {
    case 'lobby': {
      const n = readyIds().length;
      const ok = n >= G.MIN_PLAYERS;
      const steps = S.maxSteps >= 2 ? Math.min(n, S.maxSteps) : n;
      return `<div class="lobby">
        <div class="qrbox small" data-act="qr">${qrSvg(joinUrl)}</div>
        <div><p class="big-txt">Code <b class="code">${room}</b></p>
        <p class="muted">${n ? `${plural(n, 'joueur')} prêt${n > 1 ? 's' : ''} 🎉` : 'Les joueurs scannent le QR code pour s’inscrire.'}</p></div></div>
        ${groupPickerHtml()}
        <button class="btn ghost" data-act="playme">${me ? `${avatarBubble(me)} Tu joues en tant que <b>${esc(me.name)}</b>` : '🙋 Je joue aussi'}</button>
        <p class="muted small">✏️ ${fmtSec(S.writeSec)} · 🎨 ${fmtSec(S.drawSec)} · 📒 ${n >= G.MIN_PLAYERS ? plural(steps, 'étape') + ' par carnet' : S.maxSteps ? `${S.maxSteps} étapes max` : 'tour complet'} <button class="linkish" data-act="settings">modifier</button></p>
        ${ok ? '' : `<p class="muted">⏳ Il faut au moins ${G.MIN_PLAYERS} joueurs connectés.</p>`}
        <button class="btn big go" data-act="start" ${ok ? '' : 'disabled'}>▶ Lancer la partie</button>`;
    }
    case 'play': {
      const pub = G.publicState(state);
      const left = state.order.length - pub.submitted.length;
      return `<p class="phase">${roundLabel(state)}</p>
        ${state.deadline ? '<div class="timer" id="timer"></div>' : ''}
        <p class="big-txt">${left ? `${plural(left, 'joueur')} en train ${state.round % 2 ? 'de dessiner' : 'd’écrire'}…` : '✅ Tout le monde a fini !'}</p>
        <button class="btn ghost" data-act="endRound">⏩ Terminer la manche</button>`;
    }
    case 'reveal': {
      const chips = state.books
        .map((b, i) => {
          const p = who(state, b.owner);
          const seen = state.results || i <= state.reveal.b;
          return `<button class="chip ${i === state.reveal.b ? 'on' : ''}" data-act="goto" data-b="${i}" ${seen ? '' : 'disabled'}>${esc(p.avatar)} ${esc(p.name)}</button>`;
        })
        .join('');
      return `<p class="phase">📖 La grande révélation</p>
        <p class="muted small">Tourne les pages avec « Suivant ». Le propriétaire du carnet peut aussi le faire depuis son téléphone.</p>
        <div class="chips">${chips}</div>`;
    }
    case 'vote': {
      const n = G.voters(state).length;
      const done = Object.keys(state.votes).length;
      const mine = me && G.voters(state).includes(me.id);
      return `<p class="phase">🗳️ Les trophées</p><p class="big-txt">${done}/${n} vote${n > 1 ? 's' : ''}</p>
        ${mine ? `<div class="vote-form">${voteFormHtml(state, me.id, myVote)}</div><button class="btn big go" data-act="sendVote">${state.votes[me.id] ? '✅ Vote enregistré · modifier' : 'Voter 🗳️'}</button>` : ''}
        <button class="btn ${mine ? 'ghost' : 'big go'}" data-act="endVote">🏆 Afficher les trophées</button>`;
    }
    case 'end':
      return `${trophiesHtml(state)}
        <div class="row"><button class="btn ghost" data-act="goto" data-b="0">📒 Revoir les carnets</button><button class="btn big go" data-act="lobby">🔁 Nouvelle partie</button></div>`;
  }
  return '';
}
actions.sendVote = () => {
  if (!me) return;
  onVote(me.id, myVote);
  toast('🗳️ Vote enregistré');
};

function dockHtml() {
  if (state.phase !== 'reveal') return '';
  const end = G.isRevealEnd(state);
  const r = state.reveal;
  const book = state.books[r.b];
  const bookEnd = r.s >= book.steps.length;
  const reacts = me && r.s > 0 ? `<div class="reactbar">${G.REACTIONS.map((e) => `<button data-act="react" data-e="${e}">${e}</button>`).join('')}</div>` : '';
  const main = end
    ? state.results
      ? '<button class="btn go" data-act="results">🏆 Revoir les trophées</button>'
      : '<button class="btn go" data-act="vote">🏆 Passer aux trophées</button>'
    : `<button class="btn go" data-act="next">${bookEnd ? 'Carnet suivant 📒' : r.s === 0 ? 'Ouvrir le carnet 📖' : 'Suivant ▶'}</button>`;
  return `${reacts}<div class="dock-row"><button class="btn ghost" data-act="prev" ${r.b === 0 && r.s === 0 ? 'disabled' : ''}>◀</button>${main}${bookEnd ? '<button class="btn ghost" data-act="share" title="Enregistrer le carnet en image">📸</button>' : ''}</div>`;
}

const feed = createFeed($('#feed'), {
  getStep: (b, s) => G.stepContent(state, b, s),
});

let lastStageKey = '';
function render() {
  const stageKey = JSON.stringify([
    state.phase,
    state.gameNo,
    state.round,
    state.phase === 'lobby' ? [readyIds().length, state.settings, me, roster.players.length, roster.groups] : 0,
    state.phase === 'play' ? [state.deadline, G.publicState(state).submitted.length] : 0,
    state.phase === 'reveal' ? [state.reveal.b, !!state.results] : 0,
    state.phase === 'vote' ? [state.votes, myVote, me?.id] : 0,
    state.phase === 'end' ? state.v : 0,
  ]);
  if (stageKey !== lastStageKey) {
    $('#stage').innerHTML = stageHtml();
    $('#stage').dataset.phase = state.phase;
    lastStageKey = stageKey;
  }
  document.body.dataset.phase = state.phase;
  $('#roomCode').textContent = room;
  $('#roomCode2').textContent = room;
  $('#online').textContent = `${online.size + (me ? 1 : 0)} connecté${online.size + (me ? 1 : 0) > 1 ? 's' : ''}`;

  // Colonne d'informations
  const side = $('#side');
  let title = '';
  let html = '';
  if (state.phase === 'lobby') {
    title = '👥 Dans le salon';
    html = Object.values(state.players)
      .filter((p) => !p.gone)
      .map((p) => `<li data-key="${esc(p.id)}" class="prow ${isOnline(p.id) ? '' : 'off'}" style="--c:${esc(p.color)}">${avatarBubble(p)}<span class="nm">${esc(p.name)}${p.id === me?.id ? ' <em>(toi)</em>' : ''}${isOnline(p.id) ? '' : ' <small>· déconnecté</small>'}</span>${p.id === me?.id ? '' : `<button class="mini kick" data-act="kick" data-id="${esc(p.id)}" title="Retirer">✕</button>`}</li>`)
      .join('');
    if (!html) html = '<div class="empty">Personne pour l’instant. Montrez le QR code !</div>';
  } else if (state.phase === 'play') {
    title = '📒 Avancement';
    html = progressHtml(G.publicState(state), { online: new Set([...online, me?.id]), host: true, me: me?.id });
  } else if (state.phase === 'vote') {
    title = '🗳️ Qui a voté ?';
    html = votedHtml(state);
  }
  $('#sideCard').hidden = !html;
  $('#sideTitle').textContent = title;
  flipRender(side, html);

  renderMine();

  const inReveal = state.phase === 'reveal';
  $('#feedCard').hidden = !inReveal;
  if (inReveal) feed.update(state);
  const dock = $('#dock');
  dock.hidden = !inReveal;
  const dh = dockHtml();
  if (dock.dataset.html !== dh) {
    dock.innerHTML = dh;
    dock.dataset.html = dh;
  }
}

// Minuteur (et le mien si je joue)
setInterval(() => {
  const left = state.phase === 'play' && state.deadline ? state.deadline - Date.now() : null;
  const t = $('#timer');
  if (t && left != null) {
    const sec = Math.max(0, Math.ceil(left / 1000));
    t.textContent = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
    t.classList.toggle('hurry', sec <= 10);
  }
  if (me && state.phase === 'play') myTask.tick(left);
}, 200);

// Au rechargement : on rattrape un minuteur éventuellement dépassé.
$('#qrBig').innerHTML = qrSvg(joinUrl);
$('#joinUrl').textContent = joinUrl.replace(/^https?:\/\//, '');
if (me && !state.players[me.id] && state.phase === 'lobby') state = G.upsertPlayer(state, me, Date.now(), { rejoin: true });
scheduleTimers();
render();
keepAwake();
