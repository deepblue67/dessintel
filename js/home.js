import { getRoom, link, deviceStore, $ } from './common.js';
import { isLocalMode } from './transport.js';
import { unlockAudio, play } from './fx.js';

const r = getRoom();
if (r) location.replace(link('play.html', { r }));

const last = deviceStore.get('dessintel-last-host-room');
const saved = last && deviceStore.get('dessintel-host:' + last);
if (saved && saved.phase !== 'lobby') {
  const a = $('#resume');
  a.hidden = false;
  a.href = link('host.html', { r: last });
  a.querySelector('b').textContent = last;
}
$('#create').href = link('host.html');
$('#tv').href = link('tv.html');
if (isLocalMode()) $('#localNote').hidden = false;

const form = $('#joinForm');
form.code.addEventListener('input', () => {
  form.code.value = form.code.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const c = form.code.value;
  if (c.length !== 4) return form.code.focus();
  location.href = link('play.html', { r: c });
});
$('.logo').addEventListener('click', () => {
  unlockAudio();
  play(['round', 'page', 'done', 'pop'][Math.floor(Math.random() * 4)]);
});
