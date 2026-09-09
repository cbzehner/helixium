import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installFirefoxExtension } from './firefox-install.mjs';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
const fixture = await readFile('tests/fixture.html');
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(fixture);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results', { recursive: true });
const results = [];
async function eventually(read, predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read();
    if (predicate(value)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(predicate(await read()), 'Condition did not become true');
}
async function promptReady(page) {
  await page.waitForFunction(() => document.activeElement?.matches('[data-helixium]'));
}
async function exercise(page) {
  await page.goto(origin);
  await page.evaluate(() => {
    for (const key of [' ', 'b', 'j']) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  assert.equal(await page.locator('[data-helixium]').count(), 0, 'Synthetic page events cannot invoke extension commands');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('j');
  await eventually(() => page.evaluate(() => scrollY), value => value === 60);
  await page.keyboard.type('3j');
  await eventually(() => page.evaluate(() => scrollY), value => value === 240);
  await page.keyboard.type('ge');
  await eventually(() => page.evaluate(() => scrollY), value => value > 2000);
  await page.keyboard.type('gg');
  await eventually(() => page.evaluate(() => scrollY), value => value === 0);
  await page.locator('#input').fill('');
  await page.keyboard.type('jgf');
  assert.equal(await page.locator('#input').inputValue(), 'jgf');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('Escape');
  await page.locator('#closed').click();
  await page.keyboard.type('jgf');
  assert.equal(await page.locator('#closed').getAttribute('data-value'), 'jgf');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.type('i');
  await page.keyboard.type('j');
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.keyboard.press('Escape');
  await page.keyboard.type('f');
  await page.locator('[data-helixium]').waitFor();
  await page.keyboard.type('a');
  await page.waitForURL('**/destination');
  await page.goto(origin);
  await page.keyboard.type('fs');
  await eventually(() => page.locator('#button').textContent(), value => value === 'Activated');
  await page.keyboard.type('fd');
  await page.keyboard.type('Hint typing');
  assert.equal(await page.locator('#input').inputValue(), 'Hint typing');
  await page.keyboard.press('Escape');
  await page.keyboard.type('ff');
  await page.keyboard.type('Editable hint');
  assert.ok((await page.locator('#editable').textContent()).includes('Editable hint'));
  await page.keyboard.press('Escape');
  await page.keyboard.type('fg');
  await eventually(() => page.locator('#role').textContent(), value => value === 'Role activated');
  await page.keyboard.type('/');
  await promptReady(page);
  await page.keyboard.type('needle');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => getSelection().toString()), 'needle');
  const firstMatch = await page.evaluate(() => getSelection().anchorOffset);
  await page.keyboard.type('n');
  assert.equal(await page.evaluate(() => getSelection().toString()), 'needle');
  assert.notEqual(await page.evaluate(() => getSelection().anchorOffset), firstMatch);
  await page.keyboard.type('N');
  assert.equal(await page.evaluate(() => getSelection().anchorOffset), firstMatch);
  await page.keyboard.press('Escape');
  await page.evaluate(() => getSelection().collapse(document.getElementById('words').firstChild, 0));
  await page.keyboard.type('vw');
  assert.equal((await page.evaluate(() => getSelection().toString())).trim(), 'Alpha');
  await page.keyboard.press('Escape');
  await page.locator('#nested').click({ position: { x: 20, y: 20 } });
  await page.keyboard.type('j');
  await eventually(() => page.locator('#nested').evaluate(element => element.scrollTop), value => value === 60);
  await page.screenshot({ path: `test-results/${page.context().browser()?.browserType().name() || 'persistent'}.png` });
}
async function exerciseExtensionActions(page, context) {
  await page.goto(origin);
  await page.bringToFront();
  await page.keyboard.type('F');
  await page.locator('[data-helixium]').waitFor();
  const created = context.waitForEvent('page');
  await page.keyboard.type('a');
  const destination = await created;
  await destination.waitForURL('**/destination');
  await destination.waitForLoadState();
  await destination.evaluate(() => { document.title = 'Destination tab'; });
  await page.bringToFront();
  await page.keyboard.type(' b');
  await promptReady(page);
  assert.equal(await page.locator('[data-helixium]').evaluate(element => element.shadowRoot), null, 'Tab titles stay outside the page DOM');
  await page.keyboard.type('Destination tab');
  await page.keyboard.press('Enter');
  await eventually(() => destination.evaluate(() => document.visibilityState), value => value === 'visible');
  await destination.keyboard.type('gp');
  await eventually(() => page.evaluate(() => document.visibilityState), value => value === 'visible');
  await page.keyboard.type('gn');
  await eventually(() => destination.evaluate(() => document.visibilityState), value => value === 'visible');
  const closed = destination.waitForEvent('close');
  await destination.keyboard.type(' c').catch(error => {
    if (!destination.isClosed()) throw error;
  });
  await closed;
  await page.bringToFront();
  await page.keyboard.type(' f');
  await promptReady(page);
  const before = context.pages().length;
  await page.keyboard.type('javascript:alert(1)');
  await page.keyboard.press('Enter');
  await page.locator('[data-helixium]').waitFor();
  assert.equal(context.pages().length, before);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const text = document.getElementById('words').firstChild;
    getSelection().setBaseAndExtent(text, 0, text, 5);
  });
  await page.keyboard.type('y');
  await page.locator('[data-helixium]').waitFor();
  await page.locator('#input').fill('');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
  await eventually(() => page.locator('#input').inputValue(), value => value === 'Alpha');
}

try {
  for (const engine of (process.env.HELIXIUM_CHROME === '1' ? [chromium] : [chromium, firefox, webkit])) {
    const profile = await mkdtemp(join(tmpdir(), 'helixium-'));
    let context;
    try {
      const installed = engine !== webkit;
      context = await engine.launchPersistentContext(profile, {
        headless: false,
        ...(engine === firefox && { args: ['--remote-debugging-port=9223'] }),
        ...(engine === chromium && process.env.HELIXIUM_CHROME === '1' && { channel: 'chrome', ignoreDefaultArgs: ['--disable-extensions'] }),
        ...(engine === chromium && { chromiumSandbox: true, args: process.env.HELIXIUM_CHROME === '1' ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${resolve('dist/chrome')}`, `--load-extension=${resolve('dist/chrome')}`] }),
      });
      if (engine === chromium && process.env.HELIXIUM_CHROME === '1') {
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chrome') });
        assert.ok(id);
        await cdp.detach();
      }
      if (engine === firefox) await installFirefoxExtension(9223);
      if (!installed) await context.addInitScript({ path: 'dist/chrome/content.js' });
      const page = await context.newPage();
      await exercise(page);
      if (installed) await exerciseExtensionActions(page, context);
      const artifact = engine === firefox ? 'firefox' : 'chrome';
      const digest = createHash('sha256');
      for (const file of ['manifest.json', 'content.js', 'background.js']) digest.update(await readFile(`dist/${artifact}/${file}`));
      results.push({ artifactSha256: digest.digest('hex'), browser: process.env.HELIXIUM_CHROME === '1' ? 'Chrome' : engine.name(), version: context.browser()?.version(), installedExtension: installed, result: 'passed', checks: ['scrolling and counts', 'Helix goto prefixes', 'input passthrough', 'insert mode', 'synthetic event rejection', 'link and button hints', 'focus input and contenteditable hints', 'ARIA button hints', 'hidden/disabled/inert exclusion', 'search and repeat', 'selection mode', 'nested scrolling', ...(installed ? ['background-tab hints', 'tab picker', 'private picker DOM', 'tab cycling and closing', 'URL scheme validation', 'clipboard yank'] : [])] });
    } catch (error) {
      results.push({ browser: process.env.HELIXIUM_CHROME === '1' ? 'Chrome' : engine.name(), result: 'failed', error: error.stack });
      process.exitCode = 1;
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
    await writeFile('test-results/browsers.json', JSON.stringify(results, null, 2) + '\n');
    console.log(results.at(-1));
  }
} finally { server.closeAllConnections(); server.close(); }
