// Tests des règles : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../js/game.js';

const DOT = [[0, 1, 500, 500]]; // dessin minimal : un point noir
const seq = (vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

function lobby(n, settings = {}) {
  let s = G.newGame('ABCD', 0, settings);
  for (let i = 0; i < n; i++) s = G.upsertPlayer(s, { id: 'p' + i, name: 'J' + i }, i);
  return s;
}
function started(n, settings) {
  const s = lobby(n, settings);
  return G.startGame(s, Object.keys(s.players), 1000, seq([0.99]));
}
/** Tout le monde rend une copie valable pour la manche en cours. */
function playRound(s, now = 0) {
  for (const p of s.order) {
    const t = G.taskFor(s, p);
    s = G.submit(s, p, s.round, t.kind === 'text' ? `phrase ${p} ${s.round}` : DOT);
  }
  return G.advance(s, now);
}

test('il faut au moins 3 joueurs', () => {
  const s = lobby(2);
  assert.equal(G.startGame(s, Object.keys(s.players), 0), s);
  assert.equal(started(3).phase, 'play');
});

test('rotation : chacun traite chaque carnet une seule fois, jamais le sien après le départ', () => {
  for (const n of [3, 4, 5, 8]) {
    const s = started(n);
    const seen = s.books.map(() => new Set());
    for (let r = 0; r < s.rounds; r++) {
      const holders = new Set();
      for (let b = 0; b < n; b++) {
        const h = G.holderOf(s, b, r);
        holders.add(h);
        assert.ok(!seen[b].has(h), 'jamais deux fois le même carnet');
        seen[b].add(h);
        assert.equal(G.bookFor(s, h, r), b);
        if (r === 0) assert.equal(h, s.books[b].owner, 'on commence par son propre carnet');
        else assert.notEqual(h, s.books[b].owner);
      }
      assert.equal(holders.size, n, 'un carnet par joueur à chaque manche');
    }
  }
});

test('alternance phrase / dessin et contenu reçu', () => {
  let s = started(4);
  const p = s.order[1];
  assert.equal(G.taskFor(s, p).kind, 'text');
  assert.equal(G.taskFor(s, p).prev, null);
  s = playRound(s);
  const t = G.taskFor(s, p);
  assert.equal(t.kind, 'draw');
  assert.equal(t.prev.kind, 'text');
  assert.match(t.prev.data, /^phrase /);
  assert.notEqual(t.owner, p);
  s = playRound(s);
  assert.equal(G.taskFor(s, p).kind, 'text');
  assert.deepEqual(G.taskFor(s, p).prev.data, DOT);
});

test('copie remplaçable tant que la manche dure, refusée pour une autre manche', () => {
  let s = started(3);
  const p = s.order[0];
  s = G.submit(s, p, 0, 'un chat');
  s = G.submit(s, p, 0, 'un chien');
  assert.equal(s.books[G.bookFor(s, p)].steps.length, 1);
  assert.equal(s.books[G.bookFor(s, p)].steps[0].data, 'un chien');
  assert.equal(G.submit(s, p, 1, 'x'), null);
  assert.deepEqual(G.submittedIds(s), [p]);
  assert.equal(G.isRoundComplete(s), false);
  assert.equal(G.advance(s, 0), s, 'pas de manche suivante tant que tout le monde n’a pas fini');
});

test('contenu invalide ou vide = tour passé', () => {
  let s = started(3);
  const [a, b, c] = s.order;
  s = G.submit(s, a, 0, '   ');
  s = G.submit(s, b, 0, 'x'.repeat(500));
  s = G.submit(s, c, 0, 'ok');
  assert.equal(s.books[0].steps[0].skipped, true);
  assert.equal(s.books[1].steps[0].data.length, G.MAX_TEXT);
  s = G.advance(s, 0);
  assert.equal(G.submit(s, a, 1, [[0, 1, 2000, 5]]).books[G.bookFor(s, a)].steps[1].skipped, true, 'coordonnée hors limites');
  assert.equal(G.submit(s, a, 1, [[3, -1]]).books[G.bookFor(s, a)].steps[1].skipped, true, 'un fond seul ne compte pas');
  assert.equal(G.validDrawing([[3, -1], [-1, 2, 1, 1, 2, 2]]), true, 'fond + gomme');
});

test('tour passé : le suivant reçoit la dernière étape réelle et on alterne par rapport à elle', () => {
  let s = started(4);
  s = playRound(s); // manche 0 : phrases
  const [a] = s.order;
  const bA = G.bookFor(s, a);
  // a ne dessine pas : on passe son tour
  for (const p of s.order.slice(1)) s = G.submit(s, p, 1, DOT);
  s = G.skipMissing(s);
  assert.equal(s.books[bA].steps[1].skipped, true);
  s = G.advance(s, 0);
  const next = G.holderOf(s, bA);
  const t = G.taskFor(s, next);
  assert.equal(t.prev.kind, 'text', 'on remonte à la phrase');
  assert.equal(t.kind, 'draw', 'donc on dessine');
});

test('minuteur : temps de dessin ou d’écriture, ou aucun', () => {
  let s = started(3, { writeSec: 30, drawSec: 60 });
  assert.equal(s.deadline, 1000 + 30000);
  s = playRound(s, 5000);
  assert.equal(s.deadline, 5000 + 60000);
  assert.equal(started(3, { writeSec: 0 }).deadline, null);
});

test('étapes limitées, puis révélation page par page', () => {
  let s = started(5, { maxSteps: 3 });
  assert.equal(s.rounds, 3);
  for (let r = 0; r < 3; r++) s = playRound(s);
  assert.equal(s.phase, 'reveal');
  assert.deepEqual(s.reveal, { b: 0, s: 0 });
  assert.equal(s.books[0].steps.length, 3);
  assert.equal(G.stepContent(s, 0, 0), null, 'rien de visible sur la couverture');
  s = G.revealNext(s);
  assert.match(G.stepContent(s, 0, 0).data, /phrase/);
  assert.equal(G.stepContent(s, 0, 1), null);
  s = G.revealNext(G.revealNext(s));
  assert.deepEqual(s.reveal, { b: 0, s: 3 });
  s = G.revealNext(s);
  assert.deepEqual(s.reveal, { b: 1, s: 0 });
  assert.deepEqual(G.revealedSteps(s, 0), [0, 1, 2]);
  s = G.revealPrev(s);
  assert.deepEqual(s.reveal, { b: 0, s: 3 });
  for (let i = 0; i < 40; i++) s = G.revealNext(s);
  assert.ok(G.isRevealEnd(s));
});

test('la révélation saute les tours passés', () => {
  let s = started(3);
  const [a, b, c] = s.order;
  s = G.submit(G.submit(s, b, 0, 'x'), c, 0, 'y');
  s = G.advance(G.skipMissing(s), 0); // le carnet de a commence par un tour passé
  s = playRound(s);
  s = playRound(s);
  assert.equal(s.phase, 'reveal');
  const bA = s.books.findIndex((bk) => bk.owner === a);
  s = G.revealGoto(s, bA);
  s = G.revealNext(s);
  assert.equal(s.reveal.s, 2, 'on montre directement l’étape 2');
});

test('le public de l’état ne contient ni phrases ni dessins', () => {
  let s = playRound(started(3));
  const pub = G.publicState(s);
  assert.ok(!JSON.stringify(pub).includes('phrase'));
  assert.equal(pub.books[0].steps[0].kind, 'text');
  assert.equal(pub.submitted.length, 0);
});

test('exclusion en cours de partie : ses tours sont passés automatiquement', () => {
  let s = started(4);
  const gone = s.order[2];
  s = G.kick(s, gone);
  assert.ok(s.players[gone].gone);
  assert.ok(s.order.includes(gone));
  for (const p of s.order) if (p !== gone) s = G.submit(s, p, 0, 'texte');
  s = G.advance(s, 0);
  assert.equal(s.round, 1);
  assert.equal(s.books[G.bookFor(s, gone)].steps[1].skipped, true, 'passé d’office à la manche suivante');
  // Dans le salon, l'exclu disparaît
  const l = G.kick(lobby(3), 'p1');
  assert.equal(l.players.p1, undefined);
  assert.equal(G.upsertPlayer(l, { id: 'p1', name: 'J1' }, 0), null);
  assert.ok(G.upsertPlayer(l, { id: 'p1', name: 'J1' }, 0, { rejoin: true }).players.p1);
});

test('changement de téléphone : le joueur garde son carnet et ses étapes', () => {
  let s = playRound(started(3));
  const old = s.order[0];
  s = G.movePlayer(s, old, 'neuf');
  assert.equal(s.order[0], 'neuf');
  assert.ok(s.books.some((b) => b.owner === 'neuf'));
  assert.ok(s.books.some((b) => b.steps.some((st) => st.by === 'neuf')));
  assert.equal(G.taskFor(s, 'neuf').kind, 'draw');
});

test('réactions, votes et trophées', () => {
  let s = started(3);
  for (let r = 0; r < 3; r++) s = playRound(s);
  const [a, b, c] = s.order;
  assert.equal(G.react(s, 0, 0, '😂'), s, 'pas de réaction sur une étape pas encore montrée');
  s = G.revealNext(s);
  s = G.react(G.react(s, 0, 0, '😂'), 0, 0, '❤️');
  assert.equal(G.react(s, 0, 0, '💩'), s, 'emoji non prévu refusé');
  s = G.startVote(s);
  assert.equal(G.vote(s, 'intrus', {}), null);
  s = G.vote(s, a, { artist: b, funny: a, detective: c }); // voter pour soi est ignoré
  assert.deepEqual(s.votes[a], { artist: b, detective: c });
  s = G.vote(s, b, { artist: c, funny: a });
  assert.equal(G.allVoted(s), false);
  s = G.vote(s, c, { artist: b, funny: b });
  assert.ok(G.allVoted(s));
  s = G.endVote(s);
  assert.equal(s.phase, 'end');
  const res = Object.fromEntries(s.results.map((r) => [r.id, r]));
  assert.deepEqual(res.artist.winners, [b]);
  assert.deepEqual(res.funny.winners.sort(), [a, b].sort(), 'ex æquo');
  assert.deepEqual(res.crowd.winners, [s.books[0].steps[0].by]);
  // Après les trophées, on peut revoir un carnet en entier
  const back = G.revealGoto(s, 2);
  assert.equal(back.reveal.s, back.books[2].steps.length);
  // Nouvelle partie
  const l = G.backToLobby(s);
  assert.equal(l.phase, 'lobby');
  assert.equal(Object.keys(l.players).length, 3);
  assert.equal(G.startGame(l, Object.keys(l.players), 0).gameNo, 2);
});
