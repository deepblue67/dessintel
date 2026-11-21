// Écran de jeu d'un joueur pendant une manche : écrire une phrase ou dessiner.
// Utilisé par le téléphone des joueurs et par celui du maître du jeu s'il joue aussi.
import { esc, $, toast } from './common.js';
import * as D from './draw.js';
import { MAX_TEXT } from './game.js';
import { randomPhrase } from './phrases.js';
import * as FX from './fx.js';

/**
 * createTaskView(root, { onSubmit(data, { auto }), draft: { get(k), set(k, v), del(k) } })
 * → { show(task, { key, who, totalMs }), sent(bool), tick(remainingMs|null), clear() }
 */
export function createTaskView(root, { onSubmit, draft }) {
  let task = null;
  let key = '';
  let pad = null;
  let isSent = false;
  let autoDone = false;
  let lastSec = null;
  let totalMs = 0;
  let author = null; // auteur de l'étape précédente { name, avatar, color }

  function destroyPad() {
    pad?.destroy();
    pad = null;
  }

  function timerHtml() {
    return `<div class="tbar"><div class="tfill"></div><span class="tleft"></span></div>`;
  }

  function prevHtml() {
    const p = task.prev;
    if (!p) return '';
    const by = author ? `<span class="muted small">de ${esc(author.avatar)} ${esc(author.name)}</span>` : '';
    if (p.kind === 'text') return `<div class="prompt"><div class="plabel">🎨 Dessine : ${by}</div><div class="bubble big">« ${esc(p.data)} »</div></div>`;
    return `<div class="prompt"><div class="plabel">🔍 Qu’est-ce que c’est ? ${by}</div><div class="artbox"><canvas class="art" id="tPrev"></canvas></div></div>`;
  }

  function editTextHtml(value) {
    const first = !task.prev;
    return `${timerHtml()}${
      first ? '<div class="prompt"><div class="plabel">✏️ Écris une phrase à faire dessiner</div><p class="muted small">Quelque chose d’amusant, mais dessinable !</p></div>' : prevHtml()
    }
      <div class="tform">
        <textarea id="tText" maxlength="${MAX_TEXT}" rows="3" placeholder="${first ? 'Ex. Un chat qui fait du ski' : 'Je pense que c’est…'}" enterkeyhint="done">${esc(value || '')}</textarea>
        <div class="trow"><span class="muted small" id="tCount"></span>${first ? '<button type="button" class="btn ghost sm" data-tact="dice">🎲 Me proposer une phrase</button>' : ''}</div>
        <button type="button" class="btn big go" data-tact="send">Valider ✅</button>
      </div>`;
  }

  function editDrawHtml() {
    const colors = D.PALETTE.map((c, i) => `<button type="button" class="sw" data-tact="color" data-i="${i}" style="--c:${c}" aria-label="Couleur"></button>`).join('');
    const sizes = D.SIZES.map((s, i) => `<button type="button" class="sz" data-tact="size" data-i="${i}" aria-label="Épaisseur ${i + 1}"><i style="--s:${Math.max(4, Math.round(s / 2.2))}px"></i></button>`).join('');
    return `${timerHtml()}${prevHtml()}
      <div class="padbox"><canvas id="tPad" class="pad"></canvas></div>
      <div class="tools">
        <div class="swatches">${colors}</div>
        <div class="toolrow">${sizes}
          <button type="button" class="tool" data-tact="eraser" title="Gomme">🧽</button>
          <button type="button" class="tool" data-tact="fill" title="Colorier le fond">🪣</button>
          <button type="button" class="tool" data-tact="undo" title="Annuler le dernier trait">↩️</button>
          <button type="button" class="tool" data-tact="clear" title="Tout effacer">🗑️</button>
        </div>
      </div>
      <button type="button" class="btn big go" data-tact="send">J’ai fini ✅</button>`;
  }

  function sentHtml() {
    const p = autoDone ? '⏰ Temps écoulé !' : task.kind === 'draw' ? 'Ton dessin est parti !' : 'Ta phrase est partie !';
    return `${timerHtml()}<div class="sent"><div class="sent-ico">${autoDone ? '⌛' : '📨'}</div><div class="big-txt">${p}</div>
      <p class="muted">${autoDone ? 'Ton travail a été envoyé tel quel. ' : ''}On attend les autres…</p>
      ${autoDone ? '' : '<button type="button" class="btn ghost" data-tact="edit">✏️ Modifier</button>'}</div>`;
  }

  function syncTools() {
    if (!pad) return;
    root.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', !pad.eraser && Number(b.dataset.i) === pad.color));
    root.querySelectorAll('.sz').forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.i) === pad.size);
      b.style.setProperty('--c', pad.eraser ? '#fff' : D.PALETTE[pad.color]);
    });
    root.querySelector('[data-tact="eraser"]')?.classList.toggle('on', pad.eraser);
  }

  function countText() {
    const t = $('#tText', root);
    if (t) $('#tCount', root).textContent = `${t.value.length}/${MAX_TEXT}`;
  }

  function render() {
    destroyPad();
    if (isSent) {
      root.innerHTML = sentHtml();
    } else if (task.kind === 'text') {
      root.innerHTML = editTextHtml(draft.get(key) ?? (typeof task.mine === 'string' ? task.mine : ''));
      countText();
    } else {
      root.innerHTML = editDrawHtml();
      createPad();
    }
    const pv = $('#tPrev', root);
    if (pv) requestAnimationFrame(() => D.show(pv, task.prev.data));
    root.dataset.kind = task.kind;
    root.classList.toggle('is-sent', isSent);
    lastSec = null;
  }

  function createPad() {
    const initial = draft.get(key) ?? (Array.isArray(task.mine) ? task.mine : []);
    const p = D.createPad($('#tPad', root), {
      initial,
      onChange: (strokes) => draft.set(key, strokes),
    });
    pad = p;
    syncTools();
    return p;
  }

  function currentData() {
    if (task.kind === 'text') return ($('#tText', root)?.value || draft.get(key) || '').trim();
    if (pad) return pad.isEmpty() ? null : pad.getData();
    const d = draft.get(key);
    return Array.isArray(d) && d.some((s) => s[1] !== -1) ? D.fitSize(d) : null;
  }

  function send(auto = false) {
    const data = currentData();
    if (!auto && !data) {
      FX.play('nope');
      toast(task.kind === 'text' ? 'Écris quelque chose d’abord ✏️' : 'Dessine quelque chose d’abord 🎨');
      return;
    }
    isSent = true;
    FX.play('done');
    FX.vibrate(40);
    onSubmit(data, { auto });
    render();
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tact]');
    if (!b || !task) return;
    FX.unlockAudio();
    const a = b.dataset.tact;
    if (a === 'send') send(false);
    else if (a === 'edit') {
      isSent = false;
      render();
    } else if (a === 'dice') {
      const t = $('#tText', root);
      t.value = randomPhrase(t.value);
      draft.set(key, t.value);
      countText();
      FX.play('pop');
    } else if (pad) {
      if (a === 'color') pad.setColor(Number(b.dataset.i));
      else if (a === 'size') pad.setSize(Number(b.dataset.i));
      else if (a === 'eraser') pad.setEraser(!pad.eraser);
      else if (a === 'fill') pad.fill(pad.color);
      else if (a === 'undo') pad.undo();
      else if (a === 'clear') {
        if (!pad.isEmpty() && !confirm('Tout effacer ?')) return;
        pad.clear();
      }
      syncTools();
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.id === 'tText') {
      draft.set(key, e.target.value);
      countText();
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.id === 'tText' && e.key === 'Enter') {
      e.preventDefault();
      send(false);
    }
  });

  return {
    get key() {
      return key;
    },
    get isSent() {
      return isSent;
    },
    /** Affiche une tâche. Ne reconstruit rien si c'est la même. */
    show(t, { key: k, author: a = null, totalMs: tot = 0, sent = null } = {}) {
      if (k === key && task) return;
      task = t;
      key = k;
      author = a;
      totalMs = tot;
      autoDone = false;
      isSent = sent ?? !!t.done;
      render();
      if (!isSent) FX.play('round');
    },
    /** Temps restant (ms) ou null s'il n'y a pas de minuteur. */
    tick(remaining) {
      const bar = root.querySelector('.tbar');
      if (!bar) return;
      bar.hidden = remaining == null;
      if (remaining == null) return;
      const left = Math.max(0, remaining);
      const pct = totalMs ? Math.max(0, Math.min(100, (left / totalMs) * 100)) : 0;
      bar.querySelector('.tfill').style.width = pct + '%';
      const sec = Math.ceil(left / 1000);
      bar.querySelector('.tleft').textContent = sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `${sec} s`;
      bar.classList.toggle('hurry', sec <= 10);
      if (!isSent && sec <= 5 && sec !== lastSec && sec > 0) FX.play('tick');
      lastSec = sec;
      // Temps écoulé : on envoie ce qu'on a (un dessin à moitié fini, c'est encore plus drôle).
      if (left <= 250 && !isSent && !autoDone) {
        autoDone = true;
        send(true);
      }
    },
    clear() {
      destroyPad();
      task = null;
      key = '';
      root.innerHTML = '';
    },
  };
}
