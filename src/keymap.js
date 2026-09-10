const modes = { g: 'goto', z: 'view', Z: 'sticky-view', ' ': 'space' };
const movement = { h: 'left', j: 'down', k: 'up', l: 'right', 'Ctrl-d': 'half-down', 'Ctrl-u': 'half-up', 'Ctrl-f': 'page-down', 'Ctrl-b': 'page-up' };
const bindings = {
  normal: { ...movement, f: 'hints', F: 'hints-tab', i: 'insert', v: 'select', '/': 'search', '?': 'search-backward', n: 'search-next', N: 'search-previous', y: 'yank', 'Ctrl-o': 'back', 'Ctrl-i': 'forward' },
  goto: { g: 'top', e: 'bottom', h: 'start', l: 'end', n: 'next-tab', p: 'previous-tab', f: 'hints' },
  space: { b: 'tabs', f: 'open', c: 'close-tab', '?': 'commands' },
  view: movement,
  'sticky-view': movement,
  select: { h: 'select-left', j: 'select-down', k: 'select-up', l: 'select-right', w: 'select-word', b: 'select-word-backward', y: 'yank', ';': 'collapse' },
};

const commandLabels = {
  left: 'Scroll left', down: 'Scroll down', up: 'Scroll up', right: 'Scroll right',
  'half-down': 'Scroll half page down', 'half-up': 'Scroll half page up',
  'page-down': 'Scroll page down', 'page-up': 'Scroll page up',
  top: 'Go to top', bottom: 'Go to bottom', start: 'Go to left edge', end: 'Go to right edge',
  hints: 'Follow link or focus control', 'hints-tab': 'Open link in background tab',
  insert: 'Pass keys to page', select: 'Select text', yank: 'Copy selection or page URL',
  search: 'Find text forward', 'search-backward': 'Find text backward',
  'search-next': 'Next search match', 'search-previous': 'Previous search match',
  back: 'Go back in history', forward: 'Go forward in history',
  'next-tab': 'Next tab', 'previous-tab': 'Previous tab', 'close-tab': 'Close tab',
  tabs: 'Find tab', open: 'Open URL', commands: 'Search all commands',
  'select-left': 'Extend selection left', 'select-down': 'Extend selection down',
  'select-up': 'Extend selection up', 'select-right': 'Extend selection right',
  'select-word': 'Extend selection by word', 'select-word-backward': 'Extend selection backward by word',
  collapse: 'Collapse selection',
};
export const prefixLabels = { space: 'Space', goto: 'g', view: 'z', 'sticky-view': 'Z' };
export function menuEntries(mode) {
  return Object.entries(bindings[mode] ?? {}).map(([key, command]) => ({ key, command, label: commandLabels[command] }));
}
export function commandEntries() {
  const seen = new Set(['commands']);
  return Object.entries({ normal: [], goto: ['g'], space: [' '], select: ['v'] })
    .flatMap(([mode, prefix]) => menuEntries(mode).flatMap(({ key, command, label }) => {
      if (seen.has(command)) return [];
      seen.add(command);
      return [{ command, label, keys: [...prefix, key] }];
    }));
}
export function shortcutLabel(keys) { return keys.map(key => key === ' ' ? 'Space' : key).join(' '); }

export const initialState = Object.freeze({ mode: 'normal', count: '' });

export function transition(state, key) {
  if (key === 'Escape') return { state: initialState, command: 'escape', count: 1, consume: true };
  if (state.mode === 'insert') return { state, consume: false };
  if (/^[0-9]$/.test(key) && (key !== '0' || state.count)) {
    return { state: { ...state, count: (state.count + key).slice(0, 4) }, consume: true };
  }
  const count = Math.min(Number(state.count) || 1, 9999);
  if (state.mode === 'normal' && modes[key]) {
    return { state: { ...state, mode: modes[key] }, consume: true };
  }
  const command = bindings[state.mode]?.[key];
  const mode = command === 'insert' ? 'insert' : command === 'select' ? 'select' :
    ['sticky-view', 'select'].includes(state.mode) && !['yank', 'collapse'].includes(command) ? state.mode : 'normal';
  return { state: { mode, count: '' }, command, count, consume: Boolean(command) || state.mode !== 'normal' };
}

export function hintLabels(length, alphabet = 'asdfghjkl') {
  if (!Number.isSafeInteger(length) || length < 0) throw new RangeError('Invalid hint count');
  if (alphabet.length < 2 || new Set(alphabet).size !== alphabet.length) throw new Error('Hint alphabet needs distinct characters');
  const width = Math.max(1, Math.ceil(Math.log(Math.max(length, 1)) / Math.log(alphabet.length)));
  return Array.from({ length }, (_, index) => {
    let label = '';
    for (let digit = 0; digit < width; digit++) {
      label = alphabet[index % alphabet.length] + label;
      index = Math.floor(index / alphabet.length);
    }
    return label;
  });
}
