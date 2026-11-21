// Tests des fonctions pures du dessin : node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { simplify, packStroke, fitSize, byteSize, backgroundOf, MAX_BYTES, PALETTE } from '../js/draw.js';
import { validDrawing } from '../js/game.js';

test('simplification : une ligne droite se réduit à ses deux bouts', () => {
  const pts = [];
  for (let i = 0; i <= 100; i++) pts.push(i * 5, i * 5);
  assert.deepEqual(simplify(pts, 1), [0, 0, 500, 500]);
});

test('simplification : les angles sont conservés', () => {
  const pts = [0, 0, 50, 0, 100, 0, 100, 50, 100, 100];
  assert.deepEqual(simplify(pts, 1), [0, 0, 100, 0, 100, 100]);
});

test('trait compact : entiers, bornés, sans doublons, et valide', () => {
  const st = packStroke(3, 1, [10.4, 10.6, 10.4, 10.6, -20, 1200, 500.2, 500.7]);
  assert.deepEqual(st, [3, 1, 10, 11, 0, 1000, 500, 501]);
  assert.deepEqual(packStroke(0, 0, [5, 5]), [0, 0, 5, 5], 'un simple point');
  assert.ok(validDrawing([st]));
});

test('un très gros dessin est simplifié pour tenir dans un message', () => {
  const strokes = [];
  for (let s = 0; s < 120; s++) {
    const st = [s % 14, 1];
    for (let i = 0; i < 400; i++) st.push(Math.round(500 + 400 * Math.sin(i / 7 + s)), Math.round(500 + 400 * Math.cos(i / 11 + s * 2)));
    strokes.push(st);
  }
  assert.ok(byteSize(strokes) > MAX_BYTES);
  const fit = fitSize(strokes);
  assert.ok(byteSize(fit) <= MAX_BYTES, `${byteSize(fit)} octets`);
  assert.ok(validDrawing(fit));
  assert.ok(fit.length > 100, 'les traits sont gardés');
});

test('fond : la dernière couleur de fond l’emporte', () => {
  assert.equal(backgroundOf([]), '#ffffff');
  assert.equal(backgroundOf([[8, -1], [0, 1, 1, 1], [5, -1]]), PALETTE[5]);
  assert.equal(backgroundOf([[8, -1], [0, 1, 1, 1], [5, -1]], 2), PALETTE[8]);
});
