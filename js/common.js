// Outils partagés par toutes les pages.
import { randomId } from './game.js';

export const params = new URLSearchParams(location.search);
export const isLocal = params.get('local') === '1';

export const AVATARS = ['🦊', '🐸', '🐼', '🐯', '🦁', '🐵', '🐙', '🦄', '🐲', '🐧', '🦉', '🐻', '🐨', '🐷', '🐮', '🐰', '🦖', '🐝', '🦀', '🐳', '👽', '🤖', '👻', '🎃', '🤠', '🥷', '🧙', '🦸', '🍕', '🌵', '🐶', '🐱', '🦋', '🐢'];
export const COLORS = ['#ff4d6d', '#ff9f1c', '#ffd60a', '#70e000', '#2ec4b6', '#00b4d8', '#4361ee', '#9d4edd', '#f15bb5', '#8d6e63'];

export function getRoom() {
  return (params.get('r') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

export function makeRoomCode() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O
  let s = '';
  for (let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
  return s;
}

/** Garde les paramètres de test (local, lat) dans les liens internes. */
export function link(page, extra = {}) {
  const p = new URLSearchParams();
  for (const k of ['local', 'lat']) if (params.get(k)) p.set(k, params.get(k));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const qs = p.toString();
  return page + (qs ? '?' + qs : '');
}

/** URL absolue d'une page de l'appli (pour le QR code). */
export function absUrl(page, extra = {}) {
  return new URL(link(page, extra), location.href).href;
}

export const store = {
  get(k, def = null) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
  del(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  },
};

/** Stockage propre à ce téléphone (par onglet en mode test local, pour simuler plusieurs téléphones). */
export const deviceStore = {
  get(k, def = null) {
    if (!isLocal) return store.get(k, def);
    try {
      const v = sessionStorage.getItem(k);
      return v == null ? def : JSON.parse(v);
    } catch {
      return def;
    }
  },
  set(k, v) {
    if (!isLocal) return store.set(k, v);
    try {
      sessionStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch {
      return false;
    }
  },
  del(k) {
    if (!isLocal) return store.del(k);
    try {
      sessionStorage.removeItem(k);
    } catch {}
  },
};

/** Identifiant stable de ce téléphone. */
export function deviceId() {
  let id = deviceStore.get('dessintel-id');
  if (!id) deviceStore.set('dessintel-id', (id = randomId(12)));
  return id;
}
/** Nouveau joueur sur ce téléphone : on oublie l'identifiant du précédent. */
export function resetDeviceId() {
  deviceStore.del('dessintel-id');
}

/** Brouillons (phrase ou dessin en cours) : on ne perd rien si la page se recharge. */
export const draftStore = {
  get: (k) => deviceStore.get('dessintel-draft:' + k, null),
  set: (k, v) => deviceStore.set('dessintel-draft:' + k, v),
  del: (k) => deviceStore.del('dessintel-draft:' + k),
  /** Efface les brouillons qui ne commencent pas par `prefix` (anciennes parties). */
  purge(prefix) {
    for (const s of [localStorage, sessionStorage]) {
      try {
        for (const k of Object.keys(s)) if (k.startsWith('dessintel-draft:') && !k.startsWith('dessintel-draft:' + prefix)) s.removeItem(k);
      } catch {}
    }
  },
};

export const profileStore = {
  get: () => deviceStore.get('dessintel-profile'),
  set: (p) => deviceStore.set('dessintel-profile', p),
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, ms = 2200) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Empêche l'écran de se mettre en veille pendant la partie. */
export function keepAwake() {
  let lock = null;
  const req = async () => {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
    } catch {}
  };
  req();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') req();
  });
  return () => lock && lock.release();
}

/** Petit indicateur de connexion. */
export function setConn(status, local) {
  const el = $('#conn');
  if (!el) return;
  el.className = 'conn ' + status;
  el.title = local ? 'Mode local (test)' : status === 'online' ? 'Connecté' : 'Connexion…';
  el.textContent = local ? 'LOCAL' : '';
}

/** SVG du QR code (bibliothèque qrcode-generator chargée en global). */
export function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
}

/** Décalage entre l'horloge du maître du jeu et celle de ce téléphone (suffisant pour un minuteur). */
export function createHostClock() {
  let offset = 0;
  let samples = [];
  return {
    /** th : heure du maître du jeu au moment de l'envoi. */
    sample(th) {
      if (!Number.isFinite(th)) return;
      samples.push(th - Date.now());
      if (samples.length > 8) samples.shift();
      // Le message arrive toujours en retard : l'écart le plus grand est le plus juste.
      offset = Math.max(...samples);
    },
    now: () => Date.now() + offset,
  };
}

export const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
