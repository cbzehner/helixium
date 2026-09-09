export const initialState = Object.freeze({ mode: 'normal', count: '' });

export function transition(state, key) {
  if (key === 'Escape') return { state: initialState, command: 'escape', count: 1 };
  if (state.mode === 'insert') return { state };
  if (/^[0-9]$/.test(key) && (key !== '0' || state.count)) {
    return { state: { ...state, count: (state.count + key).slice(0, 4) } };
  }
  const count = Math.min(Number(state.count) || 1, 9999);
  const modes = { g: 'goto', z: 'view', Z: 'sticky-view', ' ': 'space' };
  if (state.mode === 'normal' && modes[key]) {
    return { state: { ...state, mode: modes[key] } };
  }
  const movement = { h: 'left', j: 'down', k: 'up', l: 'right', 'Ctrl-d': 'half-down', 'Ctrl-u': 'half-up', 'Ctrl-f': 'page-down', 'Ctrl-b': 'page-up' };
  const bindings = {
    normal: { ...movement, f: 'hints', F: 'hints-tab', i: 'insert', v: 'select', '/': 'search', '?': 'search-backward', n: 'search-next', N: 'search-previous', y: 'yank', 'Ctrl-o': 'back', 'Ctrl-i': 'forward' },
    goto: { g: 'top', e: 'bottom', h: 'start', l: 'end', n: 'next-tab', p: 'previous-tab', f: 'hints' },
    space: { '?': 'help', b: 'tabs', f: 'open', c: 'close-tab' },
    view: movement,
    'sticky-view': movement,
    select: { h: 'select-left', j: 'select-down', k: 'select-up', l: 'select-right', w: 'select-word', b: 'select-word-backward', y: 'yank', ';': 'collapse' },
  };
  const command = bindings[state.mode]?.[key];
  const mode = command === 'insert' ? 'insert' : command === 'select' ? 'select' :
    ['sticky-view', 'select'].includes(state.mode) && !['yank', 'collapse'].includes(command) ? state.mode : 'normal';
  return { state: { mode, count: '' }, command, count };
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
