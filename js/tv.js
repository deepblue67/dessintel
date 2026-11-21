// Écran du salon : affichage seul. Pendant la révélation, il montre en grand
// l'étape précédente et la nouvelle côte à côte : c'est là qu'on rit le plus.
import { createTransport } from './transport.js';
import * as G from './game.js';
import { getRoom, link, absUrl, esc, $, keepAwake, setConn, qrSvg, createHostClock, plural } from './common.js';
import { progressHtml, crowdHtml, roundLabel, createFeed, votedHtml, trophiesHtml, who, flipRender } from './ui.js';
import * as FX from './fx.js';

const room = getRoom();
if (!room) {
  // Pas de code dans l'adresse : on le demande.
  $('#askCode').hidden = false;
  $('#start').remove();
  $('#askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = $('#askForm').code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    if (c.length === 4) location.href = link('tv.html', { r: c });
  });
  await new Promise(() => {});
}

const key = 'tv-' + G.randomId(6);
const joinUrl = absUrl('play.html', { r: room });
const shortUrl = joinUrl.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
const clock = createHostClock();
const steps = new Map();
let state = null;
let online = new Set();
let lastSpot = '';

$('#qrMini').innerHTML = qrSvg(joinUrl);
$('#qrBig').innerHTML = qrSvg(joinUrl);
$('#codeMini').textContent = room;

const tr = createTransport(room, {
  key,
  meta: { role: 'tv' },
  onStatus: (s) => {
    setConn(s, tr.local);
    if (s === 'online') tr.send('hello', { role: 'tv', id: key });
  },
});

tr.on('state', ({ state: s, th }) => {
  clock.sample(th);
  if (state && s.gid === state.gid && s.v <= state.v) return;
  if (state && state.gameNo !== s.gameNo) steps.clear();
  state = s;
  render();
});

tr.on('step', ({ gameNo, b, s, step }) => {
  steps.set(`${gameNo}:${b}:${s}`, step);
  if (state?.phase === 'reveal' && state.reveal.b === b) feed.update(state);
});

tr.on('fx', ({ kind, e }) => {
  if (kind === 'join') FX.play('join');
  else if (kind === 'round') FX.play('round');
  else if (kind === 'page') FX.play('page');
  else if (kind === 'react') {
    FX.floatEmoji(e, { big: true });
    FX.play('pop');
  } else if (kind === 'reveal') FX.play('fanfare');
  else if (kind === 'end') {
    FX.play('fanfare');
    FX.confetti({ count: 300 });
  }
});

tr.onPresence((list) => {
  online = new Set(list.filter((m) => m.role === 'player').map((m) => m.id));
  render();
});

const feed = createFeed($('#feed'), {
  scroll: false,
  getStep: (b, s) => steps.get(`${state.gameNo}:${b}:${s}`) || null,
  onMissing: (b) => {
    if (Date.now() - lastAsk < 1200) return;
    lastAsk = Date.now();
    tr.send('need-steps', { gameNo: state.gameNo, b });
  },
});
let lastAsk = 0;

function phaseText() {
  switch (state.phase) {
    case 'lobby':
      return 'Rejoignez la partie !';
    case 'play':
      return roundLabel(state);
    case 'reveal': {
      const p = who(state, state.books[state.reveal.b].owner);
      return `📖 Le carnet de ${p.avatar} ${p.name}`;
    }
    case 'vote':
      return '🗳️ Votez pour vos favoris !';
    case 'end':
      return '🏆 Les trophées';
  }
  return '';
}

function spotHtml() {
  switch (state.phase) {
    case 'lobby':
      return `<div class="tv-lobby">
        <div class="qrbox">${$('#qrBig').innerHTML}</div>
        <div class="tv-join"><p>Scannez pour jouer !</p><p class="muted">ou allez sur <b>${esc(shortUrl)}</b></p><p>Code <b class="code">${room}</b></p></div></div>
        <div class="crowd">${crowdHtml(state, { online: new Set([...online, ...Object.keys(state.players).filter((id) => id.startsWith('h-'))]) })}</div>`;
    case 'play': {
      const left = state.order.length - state.submitted.length;
      return `<div class="tv-big">${state.round % 2 ? '🎨' : '✏️'}</div>
        ${state.deadline ? '<div class="timer tv" id="timer"></div>' : ''}
        <div class="tv-msg small">${left ? `${plural(left, 'joueur')} ${state.round % 2 ? 'dessine' : 'écrit'}${left > 1 ? 'nt' : ''} encore…` : '✅ Tout le monde a fini !'}</div>
        <ol class="list tv-progress" id="prog"></ol>`;
    }
    case 'vote':
      return `<div class="tv-big">🗳️</div><div class="tv-msg small">Chacun vote sur son téléphone</div><ol class="list tv-progress" id="prog"></ol>`;
    case 'end':
      return `<div class="tv-end">${trophiesHtml(state)}</div>`;
  }
  return '';
}

function render() {
  if (!state) return;
  document.body.dataset.phase = state.phase;
  $('#phase').textContent = phaseText();
  const spotKey = JSON.stringify([
    state.phase,
    state.gameNo,
    state.round,
    state.phase === 'lobby' ? [Object.values(state.players).map((p) => p.id + p.avatar + p.name + p.gone), [...online]] : 0,
    state.phase === 'play' ? [state.submitted.length, !!state.deadline] : 0,
    state.phase === 'end' ? state.v : 0,
  ]);
  const inReveal = state.phase === 'reveal';
  $('#spot').hidden = inReveal;
  $('#feed').hidden = !inReveal;
  if (!inReveal && spotKey !== lastSpot) {
    $('#spot').innerHTML = spotHtml();
    lastSpot = spotKey;
  }
  if (inReveal) {
    lastSpot = '';
    feed.update(state);
  }
  const prog = $('#prog');
  if (prog) flipRender(prog, state.phase === 'vote' ? votedHtml(state) : progressHtml(state, { online: new Set([...online, ...state.order.filter((id) => id.startsWith('h-'))]) }));
}

setInterval(() => {
  const t = $('#timer');
  if (!t || !state?.deadline) return;
  const sec = Math.max(0, Math.ceil((state.deadline - clock.now()) / 1000));
  t.textContent = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec}`;
  t.classList.toggle('hurry', sec <= 10);
}, 200);

// Les navigateurs exigent un clic avant de jouer du son.
$('#start').addEventListener('click', () => {
  FX.unlockAudio();
  FX.play('join');
  $('#start').remove();
  document.documentElement.requestFullscreen?.().catch(() => {});
});

keepAwake();
