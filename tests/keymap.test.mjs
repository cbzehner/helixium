import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, hintLabels } from '../src/keymap.js';
const press = keys => keys.reduce((result, key) => transition(result.state, key), { state: initialState });
test('Helix end-of-file uses ge and counts survive prefixes', () => {
  assert.equal(press(['g', 'e']).command, 'bottom');
  assert.equal(press(['3', 'g', 'n']).count, 3);
  assert.equal(press(['G']).command, undefined);
});
test('view mode is one-shot, sticky view persists until escape', () => {
  assert.equal(press(['z', 'j']).state.mode, 'normal');
  assert.equal(press(['Z', 'j', 'k']).state.mode, 'sticky-view');
  assert.deepEqual(press(['Z', 'Escape']).state, initialState);
});
test('insert passes keys through and escape clears counts and prefixes', () => {
  assert.equal(press(['i', 'j']).command, undefined);
  assert.deepEqual(press(['5', 'g', 'Escape']).state, initialState);
  assert.equal(press(['g', 'q', 'j']).command, 'down');
});
test('selection remains active through motion then exits when yanked', () => {
  assert.equal(press(['v', 'w']).command, 'select-word');
  assert.equal(press(['v', 'w', 'y']).state.mode, 'normal');
});
test('hint codes are unique, equal width, and prefix-free across radix boundaries', () => {
  for (const count of [0, 1, 9, 10, 81, 82, 1000]) {
    const labels = hintLabels(count);
    assert.equal(new Set(labels).size, count);
    assert.ok(new Set(labels.map(label => label.length)).size <= 1);
    assert.ok(labels.every(label => /^[asdfghjkl]+$/.test(label)));
  }
});
