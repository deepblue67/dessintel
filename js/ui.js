// Rendu partagé : avatars, avancement d'une manche, carnet révélé, trophées.
import { esc, plural } from './common.js';
import * as D from './draw.js';
import { REACTIONS, TROPHIES } from './game.js';

const UNKNOWN = { name: '?', avatar: '❔', color: '#888' };
export const who = (state, id) => state.players[id] || UNKNOWN;

export function avatarBubble(p, size = '') {
  return `<span class="av ${size}" style="--c:${esc(p?.color || '#888')}">${esc(p?.avatar || '❔')}</span>`;
}

/** Remplace le contenu d'un conteneur en animant les éléments qui changent de place (FLIP). */
export function flipRender(container, html) {
  if (container.dataset.html === html) return;
  container.dataset.html = html;
  const before = new Map();
  for (const el of container.querySelectorAll('[data-key]')) before.set(el.dataset.key, el.getBoundingClientRect().top);
  container.innerHTML = html;
  for (const el of container.querySelectorAll('[data-key]')) {
    const old = before.get(el.dataset.key);
    if (old == null) {
      el.animate?.([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'ease-out' });
      continue;
    }
    const dy = old - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  }
}

export const kindLabel = (k) => (k === 'draw' ? '🎨 Dessin' : '✏️ Écriture');

/** Libellé de la manche : « Manche 2/5 · 🎨 Dessin ». */
export function roundLabel(state) {
  return `Manche ${state.round + 1}/${state.rounds} · ${kindLabel(state.round % 2 ? 'draw' : 'text')}`;
}

/** Pastilles d'avancement : qui a fini, qui travaille encore, qui est déconnecté. */
export function progressHtml(state, { online = null, host = false, me = null } = {}) {
  const done = new Set(state.submitted || []);
  return state.order
    .map((id) => {
      const p = who(state, id);
      const off = p.gone || (online && !online.has(id));
      const st = p.gone ? '🚪' : done.has(id) ? '✅' : off ? '📴' : '⏳';
      const skip = host && !done.has(id) && !p.gone ? `<button class="mini" data-act="skip" data-id="${esc(id)}" title="Passer son tour">⏭</button>` : '';
      return `<li data-key="${esc(id)}" class="prow ${done.has(id) ? 'done' : ''} ${off ? 'off' : ''} ${id === me ? 'me' : ''}" style="--c:${esc(p.color)}">${avatarBubble(p)}<span class="nm">${esc(p.name)}</span><span class="st">${st}</span>${skip}</li>`;
    })
    .join('');
}

/** Foule des joueurs inscrits (salon). */
export function crowdHtml(state, { online = null, size = 'lg' } = {}) {
  const ps = Object.values(state.players).filter((p) => !p.gone);
  if (!ps.length) return '<span class="muted">En attente des joueurs…</span>';
  return ps
    .map((p) => `<span class="bounce ${online && !online.has(p.id) ? 'off' : ''}" style="--c:${esc(p.color)}">${avatarBubble(p, size)}<small>${esc(p.name)}</small></span>`)
    .join('');
}

export function reactionsHtml(r) {
  if (!r) return '';
  return REACTIONS.filter((e) => r[e]).map((e) => `<span>${e} ${r[e]}</span>`).join('');
}

// ---------- Carnet révélé ----------

/**
 * Fil d'un carnet : la couverture puis les étapes déjà montrées.
 * getStep(b, s) renvoie le contenu d'une étape ({ kind, by, data, skipped }) ou null s'il n'est pas encore arrivé.
 */
export function createFeed(container, { getStep, onMissing, scroll = true } = {}) {
  let key = '';
  let shown = 0;
  let stopReplay = null;

  function stepEl(state, b, s, animate) {
    const st = getStep(b, s);
    const meta = state.books[b].steps[s];
    const p = who(state, meta.by);
    const el = document.createElement('div');
    el.className = 'fstep';
    el.dataset.s = s;
    el.style.setProperty('--c', p.color);
    if (meta.skipped) {
      el.classList.add('skip');
      el.innerHTML = `${avatarBubble(p)} <span><b>${esc(p.name)}</b> a passé son tour 🙈</span>`;
      return el;
    }
    const head = `<div class="fwho">${avatarBubble(p)} <b>${esc(p.name)}</b> <span class="muted">${meta.kind === 'text' ? (s === 0 ? 'a commencé par :' : 'a cru voir :') : 'a dessiné :'}</span></div>`;
    if (!st) {
      el.classList.add('missing');
      el.innerHTML = `${head}<div class="bubble muted">…</div>`;
      onMissing?.(b);
      return el;
    }
    if (st.kind === 'text') {
      el.classList.add('text');
      el.innerHTML = `${head}<div class="bubble">« ${esc(st.data)} »</div><div class="reacts"></div>`;
    } else {
      el.classList.add('draw');
      el.innerHTML = `${head}<div class="artbox"><canvas class="art"></canvas></div><div class="reacts"></div>`;
      const cv = el.querySelector('canvas');
      cv._data = st.data;
      requestAnimationFrame(() => {
        if (animate) {
          stopReplay?.();
          stopReplay = D.replay(cv, st.data, {
            onDone: () => {
              stopReplay = null;
            },
          });
        } else D.show(cv, st.data);
      });
    }
    if (animate) el.animate?.([{ opacity: 0, transform: 'translateY(30px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
    return el;
  }

  function cover(state, b) {
    const p = who(state, state.books[b].owner);
    const el = document.createElement('div');
    el.className = 'fcover';
    el.style.setProperty('--c', p.color);
    el.innerHTML = `<div class="cico">📒</div><div class="muted">Carnet ${b + 1}/${state.books.length}</div><div class="cname">${avatarBubble(p, 'lg')} ${esc(p.name)}</div>`;
    return el;
  }

  function update(state, upto) {
    const r = state.reveal;
    if (!r) return;
    const b = r.b;
    const n = upto ?? r.s;
    const k = state.gameNo + ':' + b;
    if (k !== key) {
      stopReplay?.();
      stopReplay = null;
      key = k;
      shown = 0;
      container.innerHTML = '';
      container.appendChild(cover(state, b));
    }
    // Retour en arrière : on retire les étapes en trop.
    while (shown > n) {
      container.querySelector(`.fstep[data-s="${shown - 1}"]`)?.remove();
      shown--;
    }
    // Étapes arrivées entre-temps (contenu manquant au premier affichage).
    for (const el of container.querySelectorAll('.fstep.missing')) {
      const s = Number(el.dataset.s);
      if (getStep(b, s)) el.replaceWith(stepEl(state, b, s, s === n - 1));
    }
    const added = shown < n;
    while (shown < n) {
      container.appendChild(stepEl(state, b, shown, shown === n - 1));
      shown++;
    }
    container.classList.toggle('at-cover', n === 0);
    // Compteurs de réactions
    for (const el of container.querySelectorAll('.fstep')) {
      const rx = el.querySelector('.reacts');
      if (rx) rx.innerHTML = reactionsHtml(state.react?.[`${b}:${el.dataset.s}`]);
    }
    if (added && scroll) requestAnimationFrame(() => container.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }

  function redraw() {
    for (const cv of container.querySelectorAll('canvas.art')) if (cv._data && !stopReplay) D.show(cv, cv._data);
  }
  addEventListener('resize', redraw);

  return {
    update,
    reset() {
      key = '';
      container.innerHTML = '';
    },
  };
}

// ---------- Trophées ----------

export function voteFormHtml(state, me, mine = {}) {
  const cands = state.order.filter((id) => id !== me && !state.players[id]?.gone);
  return TROPHIES.map(
    (t) => `<div class="vote-q"><div class="vq">${t.icon} <b>${esc(t.q)}</b></div><div class="vopts">${cands
      .map((id) => {
        const p = who(state, id);
        return `<button type="button" class="who-chip ${mine[t.id] === id ? 'on' : ''}" data-act="pick" data-t="${t.id}" data-id="${esc(id)}" style="--c:${esc(p.color)}">${avatarBubble(p)}${esc(p.name)}</button>`;
      })
      .join('')}</div></div>`
  ).join('');
}

export function votedHtml(state) {
  return state.order
    .filter((id) => !state.players[id]?.gone)
    .map((id) => {
      const p = who(state, id);
      const ok = !!state.votes[id];
      return `<li data-key="${esc(id)}" class="prow ${ok ? 'done' : ''}" style="--c:${esc(p.color)}">${avatarBubble(p)}<span class="nm">${esc(p.name)}</span><span class="st">${ok ? '🗳️' : '🤔'}</span></li>`;
    })
    .join('');
}

export function trophiesHtml(state) {
  const res = state.results || [];
  const items = res
    .map((t, i) => {
      const ws = t.winners.map((id) => who(state, id));
      const names = ws.length ? ws.map((p) => `<span class="tw" style="--c:${esc(p.color)}">${avatarBubble(p, 'lg')}<b>${esc(p.name)}</b></span>`).join('') : '<span class="muted">Personne</span>';
      const sub = t.id === 'crowd' ? esc(t.q) : t.votes ? `${esc(t.q)} · ${plural(t.votes, 'vote')}` : esc(t.q);
      return `<li class="trophy" style="animation-delay:${i * 0.35}s"><div class="ticon">${t.icon}</div><div class="tbody"><div class="ttitle">${esc(t.title)}</div><div class="muted small">${sub}</div><div class="twin">${names}</div></div></li>`;
    })
    .join('');
  return `<h2 class="ptitle">🏆 Les trophées</h2><ul class="trophies">${items}</ul>`;
}
