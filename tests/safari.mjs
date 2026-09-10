import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { vncConnection } from './vnc.mjs';
import { verifyBuild, sourceRevision } from '../scripts/build.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { startFixtureServer } from './fixture-server.mjs';

if (process.platform !== 'darwin') throw new Error('Safari tests require the disposable macOS VM');
// First load dist/safari with Safari's Add Temporary Extension UI and grant
// website access. SafariDriver's separate profile cannot install extensions.
const expected = await verifyBuild('safari');
const revision = await sourceRevision();
const server = await startFixtureServer(0, '127.0.0.1', true);
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results', { recursive: true });
const input = spawn('python3', ['tests/vnc.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
const connection = vncConnection(input);
const vnc = (action, parameters) => connection.command(action, parameters);
const special = { '\uE00C': 'esc', '\uE007': 'enter', '\n': 'enter', ' ': 'space', '?': 'shift-?' };
const keys = text => vnc('keys', { keys: [...text].map(key => special[key] ?? (/^[A-Z]$/.test(key) ? `shift-${key}` : key)) });
async function shortcut(key) {
  await vnc('keys', { keys: [key] });
  await new Promise(resolve => setTimeout(resolve, 500));
}
const escape = () => keys('\uE00C');
let page;
const evaluate = script => server.evaluate(page, script);
async function eventually(read, predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const value = await read();
  assert.ok(predicate(value), `Condition did not become true: ${JSON.stringify(value)}`);
}
async function navigate(url) {
  const previous = new Set(server.pages.keys());
  if (page) await evaluate(`setTimeout(() => { location.href = ${JSON.stringify(url)}; }, 300)`);
  else await new Promise((resolve, reject) => execFile('/usr/bin/open', ['-a', 'Safari', url], error => error ? reject(error) : resolve()));
  page = (await eventually(() => [...server.pages], pages => pages.some(([id, state]) =>
    !previous.has(id) && state.top && state.url === url))).find(([id, state]) => !previous.has(id) && state.top && state.url === url)[0];
  await new Promise(resolve => setTimeout(resolve, 1000));
  await click('h1');
}
async function click(selector) {
  const { x, y } = await evaluate(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: (screenX + (outerWidth - innerWidth) / 2 + rect.x + rect.width / 2) * devicePixelRatio,
      y: (screenY + outerHeight - innerHeight + rect.y + Math.min(rect.height / 2, 20)) * devicePixelRatio };
  })()`);
  await vnc('click', { x: Math.round(x), y: Math.round(y) });
}
async function switchTab(sequence) {
  const previous = page;
  await keys(sequence);
  await eventually(() => server.evaluate(previous, 'document.visibilityState'), value => value === 'hidden');
  page = (await eventually(() => [...server.pages], pages => pages.some(([id, state]) =>
    id !== previous && state.top && state.visible && Date.now() - state.seen < 500))).find(([id, state]) =>
    id !== previous && state.top && state.visible && Date.now() - state.seen < 500)[0];
}
const promptReady = () => eventually(() => evaluate("document.activeElement?.matches('[data-helixium]')"), Boolean);
const digest = createHash('sha256');
for (const file of ['manifest.json', 'content.js', 'background.js']) digest.update(await readFile(`dist/safari/${file}`));
const result = { source: revision, buildId: expected.buildId, artifactSha256: digest.digest('hex'), browser: 'Safari', installedExtension: false,
  automation: 'VNC keyboard/mouse; test-fixture DOM observation and setup', checks: [], result: 'failed' };
try {
  // A separate normal window keeps tab tests independent of existing tabs.
  await shortcut('super-n');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await navigate(origin + '/');
  result.userAgent = await evaluate('navigator.userAgent');
  result.version = result.userAgent.match(/Version\/([^ ]+)/)?.[1];
  await keys('f');
  await eventually(() => evaluate("document.querySelectorAll('[data-helixium]').length"), value => value === 1);
  assert.equal(await evaluate("document.querySelector('[data-helixium]').dataset.helixiumBuild"), expected.buildId, 'Reload the current Safari build before testing');
  result.installedExtension = true;
  await escape();
  await keys('j');
  await eventually(() => evaluate('scrollY'), value => value === 60);
  await keys('3j');
  await eventually(() => evaluate('scrollY'), value => value === 240);
  await keys('ge');
  await eventually(() => evaluate('scrollY'), value => value > 2000);
  await keys('gg');
  await eventually(() => evaluate('scrollY'), value => value === 0);
  result.checks.push('scrolling, counts, Helix goto prefixes');
  await evaluate("document.getElementById('input').focus()");
  await keys('jgf');
  assert.equal(await evaluate("document.getElementById('input').value"), 'jgf');
  assert.equal(await evaluate('scrollY'), 0);
  await escape();
  await evaluate("document.getElementById('closed').focus()");
  await keys('jgf');
  assert.equal(await evaluate("document.getElementById('closed').dataset.value"), 'jgf');
  assert.equal(await evaluate('scrollY'), 0);
  await escape(); await keys('ij');
  assert.equal(await evaluate('scrollY'), 0);
  await escape();
  result.checks.push('input, closed-shadow editor and insert-mode passthrough');
  await evaluate("[' ', 'b', 'j'].forEach(key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))");
  assert.equal(await evaluate("document.querySelectorAll('[data-helixium]').length"), 0);
  assert.equal(await evaluate('scrollY'), 0);
  result.checks.push('untrusted events ignored');
  const main = page;
  const frame = [...server.pages].find(([, state]) => !state.top && state.url === origin + '/frame' && Date.now() - state.seen < 1000)[0];
  await keys('fj');
  await eventually(() => server.evaluate(frame, 'document.hasFocus()'), Boolean);
  await keys('j');
  await eventually(() => server.evaluate(frame, 'scrollY'), value => value === 60);
  await keys('ggfa');
  await eventually(() => [...server.pages.values()], pages => pages.some(state => state.url === origin + '/frame?destination'));
  assert.equal(await server.evaluate(main, 'scrollY'), 0);
  await navigate(origin + '/');
  const crossOrigin = origin.replace('127.0.0.1', 'localhost') + '/frame';
  await evaluate(`document.querySelector('#frame').src = ${JSON.stringify(crossOrigin)}`);
  const crossFrame = (await eventually(() => [...server.pages], pages => pages.some(([, state]) => state.url === crossOrigin))).find(([, state]) => state.url === crossOrigin)[0];
  await click('h1');
  await keys('fj');
  await eventually(() => server.evaluate(crossFrame, 'document.hasFocus()'), Boolean);
  await keys('j');
  await eventually(() => server.evaluate(crossFrame, 'scrollY'), value => value === 60);
  assert.equal(await evaluate('scrollY'), 0);
  result.checks.push('same- and cross-origin frame focus, scrolling and hints');
  await navigate(origin + '/');
  await keys('fa');
  page = (await eventually(() => [...server.pages], pages => pages.some(([, state]) => state.top && state.url === origin + '/destination'))).find(([, state]) => state.top && state.url === origin + '/destination')[0];
  result.checks.push('link hints navigate');
  await navigate(origin + '/');
  await keys('fs');
  await eventually(() => evaluate("document.getElementById('button').textContent"), value => value === 'Activated');
  await keys('fdHint typing');
  assert.equal(await evaluate("document.getElementById('input').value"), 'Hint typing');
  await escape();
  await keys('ffEditable hint');
  assert.ok((await evaluate("document.getElementById('editable').textContent")).includes('Editable hint'));
  await escape(); await keys('fg');
  await eventually(() => evaluate("document.getElementById('role').textContent"), value => value === 'Role activated');
  result.checks.push('button, ARIA button, input and contenteditable hints; hidden, disabled and inert exclusion');
  await keys('/'); await promptReady(); await keys('needle\uE007');
  assert.equal(await evaluate('getSelection().toString()'), 'needle');
  const firstMatch = await evaluate('getSelection().anchorOffset');
  await keys('n');
  assert.equal(await evaluate('getSelection().toString()'), 'needle');
  assert.notEqual(await evaluate('getSelection().anchorOffset'), firstMatch);
  await keys('N');
  assert.equal(await evaluate('getSelection().anchorOffset'), firstMatch);
  await escape();
  result.checks.push('search and repeat');
  await evaluate("getSelection().collapse(document.getElementById('words').firstChild, 0)");
  await keys('vw');
  assert.equal((await evaluate('getSelection().toString()')).trim(), 'Alpha');
  await escape(); await click('#nested'); await keys('j');
  await eventually(() => evaluate("document.getElementById('nested').scrollTop"), value => value === 60);
  result.checks.push('selection mode and nested scrolling');
  await navigate(origin + '/');
  const first = page;
  const before = new Set(server.pages.keys());
  await evaluate(`document.body.insertAdjacentHTML('afterbegin', '<a href="mailto:test@example.com">Mail</a><a href="javascript:void(0)">Script</a>')`);
  await keys('Fa');
  const second = (await eventually(() => [...server.pages], pages => pages.some(([id, state]) => !before.has(id) && state.top && state.url.endsWith('/destination')))).find(([id, state]) => !before.has(id) && state.top && state.url.endsWith('/destination'))[0];
  assert.equal(await evaluate('document.visibilityState'), 'visible');
  await server.evaluate(second, "document.title = 'Destination tab'");
  await keys(' b'); await promptReady();
  assert.equal(await evaluate("document.querySelector('[data-helixium]').shadowRoot"), null);
  assert.equal(await evaluate("document.querySelector('[data-helixium]').dataset.helixiumBackgroundBuild"), expected.buildId);
  await switchTab('Destination tab\uE007');
  assert.equal(page, second);
  result.checks.push('background-tab protocol filtering, closed-shadow picker and loaded build fingerprints');
  await switchTab('gp'); assert.equal(page, first);
  await switchTab('gn'); assert.equal(page, second);
  await keys(' c');
  await eventually(() => server.pages.get(first), state => state.visible && Date.now() - state.seen < 500);
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.ok(Date.now() - server.pages.get(second).seen > 1000);
  page = first;
  result.checks.push('tab cycling and closing');
  const priorIds = new Set(server.pages.keys());
  await keys(' f'); await promptReady(); await keys('javascript:alert(1)\uE007');
  await eventually(() => evaluate("document.querySelectorAll('[data-helixium]').length"), value => value === 1);
  assert.ok([...server.pages].every(([id, state]) => !state.top || priorIds.has(id)));
  await escape();
  await evaluate("(() => { const text = document.getElementById('words').firstChild; getSelection().setBaseAndExtent(text, 0, text, 5); })()");
  await keys('y');
  await eventually(() => evaluate("document.querySelectorAll('[data-helixium]').length"), value => value === 1);
  await click('#input'); await shortcut('super-v');
  await eventually(() => evaluate("document.getElementById('input').value"), value => value === 'Alpha');
  result.checks.push('URL scheme validation and clipboard yank');
  await navigate(origin + '/?early');
  await keys('j');
  await eventually(() => evaluate('scrollY'), value => value === 60);
  assert.equal(await evaluate('window.pageKeys'), 0);
  result.checks.push('early page capture handlers');
  await navigate(origin + '/');
  await evaluate(`document.body.replaceChildren(...Array.from({ length: 10 }, (_, index) => {
    const button = document.createElement('button');
    button.textContent = 'Target ' + index;
    button.onclick = () => { document.body.dataset.activated = String(index); };
    return button;
  }))`);
  await keys('fsa');
  await eventually(() => evaluate('document.body.dataset.activated'), value => value === '9');
  result.checks.push('multi-character hints');
  await navigate(origin + '/');
  await keys(' ');
  await eventually(() => evaluate("document.querySelector('[data-helixium-menu=prefix]') !== null"), Boolean);
  assert.equal(await evaluate('scrollY'), 0);
  await vnc('screenshot', { path: 'test-results/safari-prefix.png' });
  await escape();
  await keys('3zj');
  await eventually(() => evaluate('scrollY'), value => value === 180);
  assert.equal(await evaluate("document.querySelector('[data-helixium]') !== null"), false);
  await keys('Zk');
  await eventually(() => evaluate('scrollY'), value => value === 120);
  assert.equal(await evaluate("document.querySelector('[data-helixium-menu=prefix]') !== null"), true);
  await keys('j');
  await eventually(() => evaluate('scrollY'), value => value === 180);
  await escape();
  await keys('gq');
  assert.equal(await evaluate("document.querySelector('[data-helixium]') !== null"), false);
  await keys('g');
  await shortcut('tab');
  await shortcut('down');
  await keys('\n');
  await eventually(() => evaluate('scrollY'), value => value > 2000);
  await keys('gg');
  await eventually(() => evaluate('scrollY'), value => value === 0);
  result.checks.push('prefix menus, counts, keyboard choice and sticky view');
  await keys(' ?');
  await eventually(() => evaluate("document.querySelector('[data-helixium-menu=picker]') !== null"), Boolean);
  await promptReady();
  await keys('scroll');
  await vnc('screenshot', { path: 'test-results/safari-commands.png' });
  await shortcut('down');
  await shortcut('down');
  await keys('\n');
  await eventually(() => evaluate('scrollY'), value => value === 60);
  await keys(' ?');
  await promptReady();
  await keys('no such command\n');
  await promptReady();
  assert.equal(await evaluate('scrollY'), 60);
  await escape();
  await keys(' ?');
  await promptReady();
  await keys('go to top\n');
  await eventually(() => evaluate('scrollY'), value => value === 0);
  result.checks.push('command palette filtering, physical modifiers, navigation and dismissal');
  await vnc('screenshot', { path: 'test-results/safari.png' });
  result.result = 'passed';
} catch (error) {
  result.error = error.stack;
  result.fixturePages = [...server.pages];
  process.exitCode = 1;
  await vnc('screenshot', { path: 'test-results/safari-failure.png' }).catch(() => {});
} finally {
  connection.close();
  server.closeAllConnections(); server.close();
  await writeFile('test-results/safari-input.log', connection.log);
  await writeFile('test-results/safari.json', JSON.stringify(result, null, 2) + '\n');
  console.log(result);
}
