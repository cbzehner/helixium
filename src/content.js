const api = globalThis.browser ?? globalThis.chrome;
let state = initialState;
let overlay;
let prefixButtons;
let hints = [];
let hintPrefix = '';
let hintNewTab = false;
let backgroundBuild;
let searchPattern = '';
let searchDirection = 1;
let lastPointerTarget;

function closeOverlay() {
  overlay?.remove();
  overlay = undefined;
  prefixButtons = undefined;
  hints = [];
  hintPrefix = '';
}
function panel(kind) {
  closeOverlay();
  overlay = document.createElement('div');
  overlay.setAttribute('data-helixium', '');
  if (kind) overlay.dataset.helixiumMenu = kind;
  overlay.dataset.helixiumBuild = buildId;
  if (backgroundBuild) overlay.dataset.helixiumBackgroundBuild = backgroundBuild;
  overlay.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = overlay.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{color-scheme:dark} .panel{pointer-events:auto;position:fixed;bottom:20px;right:20px;max-width:min(600px,90vw);max-height:70vh;overflow:auto;background:#16202b;color:#f3f5f7;border:1px solid #84d7b5;border-radius:6px;padding:14px;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;box-shadow:0 4px 18px #0006} input{box-sizing:border-box;width:100%;padding:8px;background:#fff;color:#111;font:16px sans-serif} button{display:block;width:100%;text-align:left;color:inherit;background:transparent;border:0;padding:6px;cursor:pointer} button:focus{outline:2px solid #84d7b5} .menu{min-width:min(320px,80vw);white-space:normal} .menu button{display:flex;gap:20px;justify-content:space-between;font:inherit} kbd{color:#84d7b5;white-space:nowrap} .picker{display:flex;flex-direction:column;gap:8px}.choices{overflow:auto;min-height:0;overscroll-behavior:contain}.picker input,.picker .footer{flex-shrink:0}.caption{margin:0 0 8px;font-weight:bold} .footer{font-size:12px;opacity:.75;margin:8px 0 0}.hint{position:fixed;background:#ffdd66;color:#111;font:bold 13px monospace;padding:2px 4px;border:1px solid #111;border-radius:3px}';
  shadow.append(style);
  document.documentElement.append(overlay);
  return shadow;
}
function message(text) {
  const root = panel();
  const box = document.createElement('div');
  box.className = 'panel';
  box.setAttribute('role', 'status');
  box.style.pointerEvents = 'none';
  box.textContent = text;
  root.append(box);
}
function navigateChoices(event, input, list) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
  const buttons = [...list.querySelectorAll('button')];
  if (!buttons.length) return;
  event.preventDefault();
  const current = buttons.indexOf(event.target);
  const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) :
    current + (event.key === 'ArrowDown' ? 1 : -1);
  if (next < 0 && input && current === 0) input.focus();
  else buttons[(next + buttons.length) % buttons.length].focus();
}
function prefixMenu() {
  const mode = state.mode;
  const root = panel('prefix');
  const box = document.createElement('div');
  box.className = 'panel menu';
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `${prefixLabels[mode]} commands`);
  const title = document.createElement('p');
  title.className = 'caption';
  title.textContent = `${state.count}${prefixLabels[mode]}${mode === 'sticky-view' ? ' · sticky view' : ''}`;
  box.append(title);
  for (const { key, label } of menuEntries(mode)) {
    const button = document.createElement('button');
    const shortcut = document.createElement('kbd');
    shortcut.textContent = key;
    button.append(label, shortcut);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.onclick = event => { if (event.isTrusted) applyKey(key).catch(error => message(error.message)); };
    box.append(button);
  }
  const footer = document.createElement('p');
  footer.className = 'footer';
  footer.textContent = 'Type a key or click · Tab / ↑ ↓ to browse · Esc to dismiss';
  box.append(footer);
  box.addEventListener('keydown', event => navigateChoices(event, null, box));
  root.append(box);
  prefixButtons = box;
}
async function applyKey(key) {
  const next = transition(state, key);
  state = next.state;
  if (overlay?.dataset.helixiumMenu === 'prefix') closeOverlay();
  if (next.command) await execute(next.command, next.count);
  if (prefixLabels[state.mode]) prefixMenu();
}
async function send(command, details = {}) {
  const result = await api.runtime.sendMessage({ command, ...details });
  if (result?.buildId !== buildId) throw new Error('Extension updated. Reload this page.');
  backgroundBuild = result.buildId;
  if (result?.error) throw new Error(result.error);
  return result?.value;
}
function editable(event) {
  // Closed shadow roots conceal their inner focused control. Pass keys through
  // focused custom elements rather than intercepting text we cannot inspect.
  if (document.activeElement?.localName.includes('-')) return true;
  return event.composedPath().some(element => element instanceof Element &&
    (element.matches('textarea,select,[role="textbox"],[role="combobox"]') || element.isContentEditable ||
      (element instanceof HTMLInputElement && !['button', 'submit', 'reset', 'checkbox', 'radio', 'image', 'file', 'range', 'color', 'hidden'].includes(element.type))));
}
function scrollTarget() {
  for (let element = lastPointerTarget instanceof Element && lastPointerTarget.isConnected ? lastPointerTarget : document.activeElement;
    element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX) &&
      (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)) return element;
  }
  return document.scrollingElement;
}
function linkURL(element) {
  if (!element.matches('a[href]')) return null;
  try { return new URL(element.getAttribute('href'), element.baseURI); } catch { return null; }
}
function showHints(newTab) {
  const interactiveSelector = 'iframe,a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"])';
  const elements = [...document.querySelectorAll(`${interactiveSelector},[tabindex]`)]
    .filter(element => {
      if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[inert]') || (!element.matches(interactiveSelector) && element.tabIndex < 0) || (element.matches('a[href]') && !linkURL(element)) || (newTab && !['http:', 'https:'].includes(linkURL(element)?.protocol))) return false;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth || getComputedStyle(element).visibility !== 'visible') return false;
      const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2)), Math.max(0, Math.min(innerHeight - 1, box.top + box.height / 2)));
      return hit === element || element.contains(hit);
    });
  if (!elements.length) return message('No visible targets');
  const root = panel();
  const labels = hintLabels(elements.length);
  hintNewTab = newTab;
  hints = elements.map((element, index) => {
    const marker = document.createElement('span');
    marker.className = 'hint';
    marker.textContent = labels[index];
    const box = element.getBoundingClientRect();
    marker.style.left = `${Math.max(0, box.left)}px`;
    marker.style.top = `${Math.max(0, box.top)}px`;
    root.append(marker);
    return { element, label: labels[index], marker };
  });
}
async function hintKey(key) {
  if (key === 'Backspace') hintPrefix = hintPrefix.slice(0, -1);
  else if (/^[a-z]$/.test(key)) hintPrefix += key;
  else return;
  const matches = hints.filter(hint => hint.label.startsWith(hintPrefix));
  if (!matches.length) { closeOverlay(); return; }
  for (const hint of hints) hint.marker.hidden = !matches.includes(hint);
  const exact = matches.find(hint => hint.label === hintPrefix);
  if (exact) {
    const { element } = exact;
    const newTab = hintNewTab;
    closeOverlay();
    if (!element.isConnected) return;
    if (newTab) {
      const url = linkURL(element);
      if (url && ['http:', 'https:'].includes(url.protocol)) await send('open', { url: url.href, background: true });
    }
    else if (element instanceof HTMLIFrameElement) {
      element.focus();
      if (document.activeElement !== element) element.contentWindow?.postMessage({ helixiumFocus: buildId }, '*');
    }
    else {
      element.focus();
      if (element instanceof HTMLElement) element.click();
      else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    }
  }
}
function prompt(label, onSubmit, choices) {
  const root = panel(choices ? 'picker' : 'prompt');
  const box = document.createElement('div');
  box.className = 'panel menu picker';
  const input = document.createElement('input');
  input.setAttribute('aria-label', label);
  input.placeholder = label;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', label);
  const list = document.createElement('div');
  list.className = 'choices';
  let matches = [];
  const submit = value => { closeOverlay(); Promise.resolve(onSubmit(value)).catch(error => message(error.message)); };
  function render() {
    list.replaceChildren();
    matches = (choices ?? []).filter(item => `${item.label} ${item.shortcut ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(input.value.toLowerCase()));
    for (const choice of matches) {
      const button = document.createElement('button');
      button.textContent = choice.label;
      if (choice.shortcut) {
        const shortcut = document.createElement('kbd');
        shortcut.textContent = choice.shortcut;
        button.append(shortcut);
      }
      button.addEventListener('mousedown', event => event.preventDefault());
      button.onclick = event => { if (event.isTrusted) submit(choice.value); };
      list.append(button);
    }
    if (choices && !list.childElementCount) list.textContent = 'No matching results';
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (!event.isTrusted) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (choices) { if (matches.length) submit(matches[0].value); }
      else submit(input.value);
    }
  });
  box.addEventListener('keydown', event => {
    if (event.isTrusted) navigateChoices(event, input, list);
  });
  box.append(input, list);
  const footer = document.createElement('p');
  footer.className = 'footer';
  footer.textContent = choices ? '↑ ↓ to browse · Enter to run · Esc to dismiss' : 'Enter to submit · Esc to dismiss';
  box.append(footer);
  root.append(box);
  render();
  input.focus();
}
function findText(backwards) {
  if (!searchPattern) return;
  // The three target browsers expose the same native text-search operation.
  if (!window.find(searchPattern, false, backwards, true, false, false, false)) message(`No match: ${searchPattern}`);
}
async function execute(command, count) {
  const target = scrollTarget();
  const height = target.clientHeight || innerHeight;
  const scroll = { left: [-60, 0], right: [60, 0], down: [0, 60], up: [0, -60], 'half-down': [0, height / 2], 'half-up': [0, -height / 2], 'page-down': [0, height], 'page-up': [0, -height] }[command];
  if (scroll) { target.scrollBy({ left: scroll[0] * count, top: scroll[1] * count, behavior: 'instant' }); return; }
  if (command.startsWith('select-')) {
    const direction = ['select-left', 'select-up', 'select-word-backward'].includes(command) ? 'backward' : 'forward';
    const unit = command.includes('word') ? 'word' : ['select-up', 'select-down'].includes(command) ? 'line' : 'character';
    const selection = getSelection();
    if (!selection.rangeCount) selection.collapse(document.body, 0);
    for (let index = 0; index < count; index++) selection.modify('extend', direction, unit);
    return;
  }
  switch (command) {
    case 'escape': closeOverlay(); {
      let focused = document.activeElement;
      while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
      if (focused instanceof HTMLElement) focused.blur();
      break;
    }
    case 'top': target.scrollTo({ top: 0, behavior: 'instant' }); break;
    case 'bottom': target.scrollTo({ top: target.scrollHeight, behavior: 'instant' }); break;
    case 'start': target.scrollTo({ left: 0, behavior: 'instant' }); break;
    case 'end': target.scrollTo({ left: target.scrollWidth, behavior: 'instant' }); break;
    case 'hints': showHints(false); break;
    case 'hints-tab': showHints(true); break;
    case 'insert': message('INSERT — Escape to resume Helixium'); break;
    case 'select': message('SELECT — h j k l w b extend · y copies · Escape exits'); break;
    case 'collapse': getSelection()?.collapseToEnd(); closeOverlay(); break;
    case 'yank': await navigator.clipboard.writeText(getSelection()?.toString() || location.href); message('Copied'); break;
    case 'back': history.back(); break;
    case 'forward': history.forward(); break;
    case 'commands':
      prompt('Search commands', async keys => {
        state = initialState;
        for (const key of keys) await applyKey(key);
      }, commandEntries().map(({ command, label, keys }) => ({ label, value: keys, shortcut: shortcutLabel(keys), keywords: command })));
      break;
    case 'search': case 'search-backward':
      searchDirection = command === 'search' ? 1 : -1;
      prompt('Find text', text => { searchPattern = text; findText(searchDirection < 0); }); break;
    case 'search-next': case 'search-previous':
      for (let index = 0; index < count; index++) findText((command === 'search-next' ? searchDirection : -searchDirection) < 0);
      break;
    case 'tabs': {
      const tabs = await send('tabs');
      prompt('Filter tabs', id => send('activate-tab', { id }), tabs.map(tab => ({ label: tab.title || tab.url, value: tab.id })));
      break;
    }
    case 'open': prompt('Open HTTP(S) URL', url => send('open', { url: /^[a-z]+:/i.test(url) ? url : `https://${url}` })); break;
    case 'next-tab': case 'previous-tab': await send(command, { count }); break;
    case 'close-tab': await send(command); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}
// Cross-origin frames must request focus from their own content context.
// This message only focuses the child; it cannot invoke browser commands.
window.addEventListener('message', event => {
  if (window !== parent && event.source === parent && event.data?.helixiumFocus === buildId) window.focus();
});
document.addEventListener('pointerdown', event => {
  if (event.composedPath().includes(overlay)) return;
  lastPointerTarget = event.target;
  if (overlay?.dataset.helixiumMenu === 'prefix') { state = initialState; closeOverlay(); }
}, true);
window.addEventListener('scroll', () => { if (hints.length) closeOverlay(); }, true);
window.addEventListener('resize', () => { if (hints.length) closeOverlay(); });
document.addEventListener('keydown', event => {
  if (!event.isTrusted || event.isComposing || ['Process', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key) || event.altKey || event.metaKey) return;
  const inOverlay = event.composedPath().includes(overlay);
  const inPrefix = overlay?.dataset.helixiumMenu === 'prefix';
  if (event.key !== 'Escape' && inOverlay) {
    if (!inPrefix || ['Enter', ' ', 'Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
  } else if (event.key !== 'Escape' && editable(event)) {
    if (inPrefix) closeOverlay();
    state = initialState; return;
  }
  if (inPrefix && !inOverlay && ['Tab', 'ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault(); event.stopImmediatePropagation();
    const buttons = prefixButtons.querySelectorAll('button');
    buttons[event.key === 'ArrowUp' || event.shiftKey ? buttons.length - 1 : 0]?.focus();
    return;
  }
  const key = event.ctrlKey ? `Ctrl-${event.key.toLowerCase()}` : event.key;
  if (key === 'Escape' && !overlay && state.mode === 'normal' && !state.count && !editable(event)) return;
  if (hints.length && key !== 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation();
    hintKey(key).catch(error => message(error.message));
    return;
  }
  const next = transition(state, key);
  if (!next.consume) { state = next.state; return; }
  event.preventDefault();
  event.stopImmediatePropagation();
  applyKey(key).catch(error => message(error.message));
}, true);
