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
test('key consumption is explicit for counts, prefixes, invalid keys, and insert mode', () => {
  for (const [keys, consume] of [
    [['q'], false], [['3'], true], [['3', 'q'], false], [['g'], true], [['g', 'q'], true],
    [['Z', 'q'], true], [['i', 'j'], false], [['i', 'Escape'], true],
  ]) assert.equal(press(keys).consume, consume, keys.join(' '));
});
test('all motion variants retain counts and mode semantics', () => {
  for (const [key, command] of Object.entries({ h: 'left', j: 'down', k: 'up', l: 'right', 'Ctrl-d': 'half-down', 'Ctrl-u': 'half-up', 'Ctrl-f': 'page-down', 'Ctrl-b': 'page-up' })) {
    for (const prefix of [[], ['z'], ['Z']]) {
      const result = press(['4', ...prefix, key]);
      assert.equal(result.command, command);
      assert.equal(result.count, 4);
      assert.equal(result.consume, true);
    }
  }
  for (const [key, command] of Object.entries({ g: 'top', e: 'bottom', h: 'start', l: 'end', n: 'next-tab', p: 'previous-tab', f: 'hints' })) {
    assert.equal(press(['g', key]).command, command);
  }
  assert.equal(press(['v', ';']).command, 'collapse');
});
test('invalid hint label inputs are rejected', () => {
  for (const count of [-1, 1.5, Infinity, NaN]) assert.throws(() => hintLabels(count), /Invalid hint count/);
  for (const alphabet of ['', 'a', 'aa']) assert.throws(() => hintLabels(1, alphabet), /distinct characters/);
});
