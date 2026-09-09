const api = globalThis.browser ?? globalThis.chrome;
let state = initialState;
let overlay;
let hints = [];
let hintPrefix = '';
let hintNewTab = false;
let backgroundBuild;
let searchPattern = '';
let searchDirection = 1;
let lastPointerTarget;

const help = `Helixium
h j k l — scroll · count before motion repeats
Ctrl-d/u — half page · Ctrl-f/b — page
g g/e — top/end · g h/l — left/right edge
g n/p — next/previous tab · Ctrl-o/i — history
f/F — link hints/current or new background tab
i — pass keys to page · Escape — normal mode
v then h/j/k/l/w/b — extend text selection · y — copy
/ or ? — text search forward/backward · n/N — repeat
Space b — tab picker · Space f — open URL
Space c — close tab · Space ? — this help
z — one view motion · Z — sticky view mode`;

function closeOverlay() {
  overlay?.remove();
  overlay = undefined;
  hints = [];
  hintPrefix = '';
}
function panel() {
  closeOverlay();
  overlay = document.createElement('div');
  overlay.setAttribute('data-helixium', '');
  overlay.dataset.helixiumBuild = buildId;
  if (backgroundBuild) overlay.dataset.helixiumBackgroundBuild = backgroundBuild;
  overlay.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const shadow = overlay.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{color-scheme:dark} .panel{pointer-events:auto;position:fixed;bottom:20px;right:20px;max-width:min(600px,90vw);max-height:70vh;overflow:auto;background:#16202b;color:#f3f5f7;border:1px solid #84d7b5;border-radius:6px;padding:14px;font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;box-shadow:0 4px 18px #0006} input{box-sizing:border-box;width:100%;padding:8px;background:#fff;color:#111;font:16px sans-serif} button{display:block;width:100%;text-align:left;color:inherit;background:transparent;border:0;padding:6px;cursor:pointer} button:focus{outline:2px solid #84d7b5}.hint{position:fixed;background:#ffdd66;color:#111;font:bold 13px monospace;padding:2px 4px;border:1px solid #111;border-radius:3px}';
  shadow.append(style);
  document.documentElement.append(overlay);
  return shadow;
}
function message(text) {
  const root = panel();
  const box = document.createElement('div');
  box.className = 'panel';
  box.setAttribute('role', 'status');
  box.textContent = text;
  root.append(box);
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
    (element.matches('input,textarea,select,[role="textbox"],[role="combobox"]') || element.isContentEditable));
}
function scrollTarget() {
  for (let element = lastPointerTarget instanceof Element ? lastPointerTarget : document.activeElement;
    element && element !== document.body; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX) &&
      (element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth)) return element;
  }
  return document.scrollingElement;
}
function showHints(newTab) {
  const interactiveSelector = 'iframe,a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"])';
  const elements = [...document.querySelectorAll(`${interactiveSelector},[tabindex]`)]
    .filter(element => {
      if (element.matches(':disabled,[aria-disabled="true"]') || element.closest('[inert]') || (!element.matches(interactiveSelector) && element.tabIndex < 0) || (newTab && (!element.matches('a[href]') || !['http:', 'https:'].includes(new URL(element.href).protocol)))) return false;
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
    if (newTab) await send('open', { url: element.href, background: true });
    else if (element instanceof HTMLIFrameElement) {
      element.focus();
      if (document.activeElement !== element) element.contentWindow?.postMessage({ helixiumFocus: buildId }, '*');
    }
    else { element.focus(); element.click(); }
  }
}
function prompt(label, onSubmit, choices = []) {
  const root = panel();
  const box = document.createElement('div');
  box.className = 'panel';
  const input = document.createElement('input');
  input.setAttribute('aria-label', label);
  input.placeholder = label;
  const list = document.createElement('div');
  function render() {
    list.replaceChildren();
    for (const choice of choices.filter(item => item.label.toLowerCase().includes(input.value.toLowerCase()))) {
      const button = document.createElement('button');
      button.textContent = choice.label;
      button.onclick = () => { closeOverlay(); Promise.resolve(onSubmit(choice.value)).catch(error => message(error.message)); };
      list.append(button);
    }
  }
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (choices.length) list.querySelector('button')?.click();
      else { const value = input.value; closeOverlay(); Promise.resolve(onSubmit(value)).catch(error => message(error.message)); }
    } else if (event.key === 'ArrowDown') { event.preventDefault(); list.querySelector('button')?.focus(); }
  });
  box.append(input, list);
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
    case 'help': message(help); break;
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
    case 'next-tab': case 'previous-tab': case 'close-tab': await send(command, { count }); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}
// Cross-origin frames must request focus from their own content context.
// This message only focuses the child; it cannot invoke browser commands.
window.addEventListener('message', event => {
  if (window !== parent && event.source === parent && event.data?.helixiumFocus === buildId) window.focus();
});
document.addEventListener('pointerdown', event => { lastPointerTarget = event.target; }, true);
window.addEventListener('scroll', () => { if (hints.length) closeOverlay(); }, true);
window.addEventListener('resize', () => { if (hints.length) closeOverlay(); });
document.addEventListener('keydown', event => {
  if (!event.isTrusted || event.isComposing || event.key === 'Process' || event.altKey || event.metaKey) return;
  if (event.key !== 'Escape' && (editable(event) || event.composedPath().includes(overlay))) { state = initialState; return; }
  const key = event.ctrlKey ? `Ctrl-${event.key.toLowerCase()}` : event.key;
  if (hints.length && key !== 'Escape') {
    event.preventDefault(); event.stopImmediatePropagation();
    hintKey(key).catch(error => message(error.message));
    return;
  }
  const next = transition(state, key);
  state = next.state;
  if (!next.consume) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (next.command) execute(next.command, next.count).catch(error => message(error.message));
}, true);
