import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connectBidi } from './bidi.mjs';

if (process.platform !== 'darwin') throw new Error('Safari tests require the disposable macOS VM');
const fixture = await readFile('tests/fixture.html');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html'); response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results', { recursive: true });
const driver = spawn('/usr/bin/safaridriver', ['--port', '4444', '--bidi', '9224'], { stdio: ['ignore', 'pipe', 'pipe'] });
let driverLog = '';
driver.stdout.on('data', data => { driverLog += data; });
driver.stderr.on('data', data => { driverLog += data; });
let session;
let bidi;
const digest = createHash('sha256');
for (const file of ['manifest.json', 'content.js', 'background.js']) digest.update(await readFile(`dist/safari/${file}`));
const result = { artifactSha256: digest.digest('hex'), browser: 'Safari', installedExtension: false, checks: [], result: 'failed' };
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`http://127.0.0.1:4444${path}`, {
    method, ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
const command = (path, body, method) => request(`/session/${session}${path}`, body, method);
const evaluate = script => command('/execute/sync', { script: `return (${script})`, args: [] });
async function eventually(read, predicate) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (predicate(await read())) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(predicate(await read()), 'Condition did not become true');
}
async function keys(text) {
  const actions = [...text].flatMap(value => [{ type: 'keyDown', value }, { type: 'keyUp', value }]);
  await command('/actions', { actions: [{ type: 'key', id: 'keyboard', actions }] });
}
async function shortcut(modifier, key) {
  await command('/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [
    { type: 'keyDown', value: modifier }, { type: 'keyDown', value: key },
    { type: 'keyUp', value: key }, { type: 'keyUp', value: modifier },
  ] }] });
}
async function click(selector) {
  const element = await command('/element', { using: 'css selector', value: selector });
  await command(`/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
}
const escape = () => keys('\uE00C');
const promptReady = () => eventually(() => evaluate("document.activeElement?.matches('[data-helixium]')"), Boolean);
try {
  for (let attempt = 0; ; attempt++) {
    try { await request('/status'); break; }
    catch (error) { if (attempt >= 50 || driver.exitCode !== null) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const created = await request('/session', { capabilities: { alwaysMatch: { browserName: 'safari', webSocketUrl: true } } });
  session = created.sessionId;
  result.version = created.capabilities.browserVersion;
  if (!created.capabilities.webSocketUrl) throw new Error('SafariDriver did not expose WebDriver BiDi');
  bidi = await connectBidi(created.capabilities.webSocketUrl);
  const installed = await bidi.send('webExtension.install', { extensionData: { type: 'path', path: resolve('dist/safari') } });
  assert.ok(installed.extension, 'Safari did not return an installed extension ID');
  result.installedExtension = true;
  result.extensionId = installed.extension;
  await command('/url', { url: origin });
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
  result.checks.push('input typing and insert mode');
  await evaluate("[' ', 'b', 'j'].forEach(key => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))");
  assert.equal(await evaluate("document.querySelectorAll('[data-helixium]').length"), 0);
  assert.equal(await evaluate('scrollY'), 0);
  result.checks.push('untrusted events ignored');
  await keys('fa');
  await eventually(() => command('/url'), value => value.endsWith('/destination'));
  result.checks.push('link hints navigate');
  await command('/url', { url: origin });
  await keys('fs');
  await eventually(() => evaluate("document.getElementById('button').textContent"), value => value === 'Activated');
  await keys('fdHint typing');
  assert.equal(await evaluate("document.getElementById('input').value"), 'Hint typing');
  await escape();
  await keys('ffEditable hint');
  assert.ok((await evaluate("document.getElementById('editable').textContent")).includes('Editable hint'));
  await escape();
  await keys('fg');
  await eventually(() => evaluate("document.getElementById('role').textContent"), value => value === 'Role activated');
  result.checks.push('button, ARIA button, input and contenteditable hints; hidden, disabled and inert targets excluded');
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
  await escape();
  await click('#nested');
  await keys('j');
  await eventually(() => evaluate("document.getElementById('nested').scrollTop"), value => value === 60);
  result.checks.push('selection mode and nested scrolling');
  await command('/url', { url: origin });
  const first = await command('/window');
  const before = await command('/window/handles');
  await keys('Fa');
  await eventually(() => command('/window/handles'), handles => handles.length === before.length + 1);
  const second = (await command('/window/handles')).find(handle => !before.includes(handle));
  await command('/window', { handle: second });
  await eventually(() => command('/url'), value => value.endsWith('/destination'));
  await evaluate("document.title = 'Destination tab'");
  await command('/window', { handle: first });
  await keys(' b'); await promptReady();
  assert.equal(await evaluate("document.querySelector('[data-helixium]').shadowRoot"), null);
  await keys('Destination tab\uE007');
  await eventually(() => evaluate('document.visibilityState'), value => value === 'hidden');
  await command('/window', { handle: second });
  assert.equal(await evaluate('document.visibilityState'), 'visible');
  result.checks.push('new-tab hints, tab picker, private picker DOM');
  await keys('gp');
  await eventually(() => evaluate('document.visibilityState'), value => value === 'hidden');
  await command('/window', { handle: first });
  await keys('gn');
  await eventually(() => evaluate('document.visibilityState'), value => value === 'hidden');
  await command('/window', { handle: second });
  await keys(' c').catch(async error => {
    if ((await command('/window/handles')).includes(second)) throw error;
  });
  await eventually(() => command('/window/handles'), handles => !handles.includes(second));
  await command('/window', { handle: first });
  result.checks.push('tab cycling and closing');
  const tabCount = (await command('/window/handles')).length;
  await keys(' f'); await promptReady(); await keys('javascript:alert(1)\uE007');
  await eventually(() => evaluate("document.querySelectorAll('[data-helixium]').length"), value => value === 1);
  assert.equal((await command('/window/handles')).length, tabCount);
  await escape();
  await evaluate("(() => { const text = document.getElementById('words').firstChild; getSelection().setBaseAndExtent(text, 0, text, 5); })()");
  await keys('y');
  await eventually(() => evaluate("document.querySelectorAll('[data-helixium]').length"), value => value === 1);
  await click('#input');
  await shortcut('\uE03D', 'v');
  await eventually(() => evaluate("document.getElementById('input').value"), value => value === 'Alpha');
  result.checks.push('URL scheme validation and clipboard yank');
  const png = await command('/screenshot');
  await writeFile('test-results/safari.png', Buffer.from(png, 'base64'));
  result.result = 'passed';
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  bidi?.close();
  if (session) await request(`/session/${session}`, undefined, 'DELETE').catch(() => {});
  driver.kill();
  server.closeAllConnections(); server.close();
  await writeFile('test-results/safari-driver.log', driverLog);
  await writeFile('test-results/safari.json', JSON.stringify(result, null, 2) + '\n');
  console.log(result);
}
