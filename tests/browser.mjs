import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installFirefoxExtension } from './firefox-install.mjs';
import { readFile, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { build, artifact, sourceRevision } from '../scripts/build.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium, firefox, webkit } from 'playwright-core';
await build();
const revision = await sourceRevision();
const server = await startFixtureServer();
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir('test-results', { recursive: true });
const results = [];
async function eventually(read, predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read();
    if (predicate(value)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const value = await read();
  assert.ok(predicate(value), `Condition did not become true: ${JSON.stringify(value)}`);
}
async function promptReady(page) {
  await page.waitForFunction(() => document.activeElement?.matches('[data-helixium]'));
}
async function exercise(page, buildId) {
  await page.goto(origin);
  await page.keyboard.press('f');
  await page.locator('[data-helixium]').waitFor();
  assert.equal(await page.locator('[data-helixium]').getAttribute('data-helixium-build'), buildId);
  await page.keyboard.press('Escape');
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
  const frame = page.frame({ url: `${origin}/frame` });
  await page.keyboard.type('fj');
  await eventually(() => frame.evaluate(() => document.hasFocus()), Boolean);
  await page.keyboard.type('j');
  await eventually(() => frame.evaluate(() => scrollY), value => value === 60);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await frame.locator('body').press('g');
  await frame.locator('body').press('g');
  await eventually(() => frame.evaluate(() => scrollY), value => value === 0);
  // Let the scroll event finish before opening hints (scrolling dismisses them).
  await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await frame.locator('body').press('f');
  await frame.locator('body').press('a');
  await frame.waitForURL('**/frame?destination');
  await page.goto(origin);
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
  await page.goto(origin + '/?early');
  await page.keyboard.press('j');
  await eventually(() => page.evaluate(() => scrollY), value => value === 60);
  assert.equal(await page.evaluate(() => window.pageKeys), 0);
  await page.goto(origin);
  const crossOrigin = origin.replace('127.0.0.1', 'localhost') + '/frame';
  await page.locator('#frame').evaluate((frame, url) => { frame.src = url; }, crossOrigin);
  await eventually(() => page.frames().some(frame => frame.url() === crossOrigin), Boolean);
  const crossFrame = page.frame({ url: crossOrigin });
  await crossFrame.waitForLoadState();
  await page.keyboard.type('fj');
  await eventually(() => crossFrame.evaluate(() => document.hasFocus()), Boolean);
  await page.keyboard.press('j');
  await eventually(() => crossFrame.evaluate(() => scrollY), value => value === 60);
  assert.equal(await page.evaluate(() => scrollY), 0);
  await page.goto(origin);
  await page.evaluate(() => {
    document.body.replaceChildren(...Array.from({ length: 10 }, (_, index) => {
      const button = document.createElement('button');
      button.textContent = `Target ${index}`;
      button.onclick = () => { document.body.dataset.activated = String(index); };
      return button;
    }));
  });
  await page.keyboard.type('fsa');
  await eventually(() => page.locator('body').getAttribute('data-activated'), value => value === '9');
}
async function exerciseDiscovery(page) {
  await page.goto(origin);
  await page.keyboard.press('Space');
  await page.locator('[data-helixium-menu="prefix"]').waitFor();
  assert.equal(await page.evaluate(() => scrollY), 0, 'Space opens a menu without scrolling');
  await page.screenshot({ path: `test-results/${page.context().browser().browserType().name()}-prefix.png` });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-helixium]').count(), 0);
  await page.keyboard.type('3zj');
  await eventually(() => page.evaluate(() => scrollY), value => value === 180);
  assert.equal(await page.locator('[data-helixium]').count(), 0, 'One-shot view menu closes');
  await page.keyboard.type('Zk');
  await eventually(() => page.evaluate(() => scrollY), value => value === 120);
  await page.locator('[data-helixium-menu="prefix"]').waitFor();
  await page.keyboard.type('j');
  await eventually(() => page.evaluate(() => scrollY), value => value === 180);
  await page.keyboard.press('Escape');
  await page.keyboard.type('gq');
  assert.equal(await page.locator('[data-helixium]').count(), 0, 'Invalid prefix clears its menu');
  await page.keyboard.type('g');
  await page.keyboard.press('ArrowUp');
  await promptReady(page);
  await page.keyboard.press('Escape');
  await page.keyboard.type('g');
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await eventually(() => page.evaluate(() => scrollY), value => value > 2000);
  await page.keyboard.type('gg');
  await eventually(() => page.evaluate(() => scrollY), value => value === 0);
  await page.keyboard.press('Space');
  await page.keyboard.press('Shift+?');
  await page.locator('[data-helixium-menu=picker]').waitFor();
  await promptReady(page);
  await page.keyboard.type('scroll');
  await page.screenshot({ path: `test-results/${page.context().browser().browserType().name()}-commands.png` });
  await page.keyboard.press('ArrowDown'); // Scroll left
  await page.keyboard.press('ArrowDown'); // Scroll down
  await page.keyboard.press('Enter');
  await eventually(() => page.evaluate(() => scrollY), value => value === 60);
  await page.keyboard.type(' ?');
  await promptReady(page);
  await page.keyboard.type('no such command');
  await page.keyboard.press('Enter');
  await promptReady(page);
  assert.equal(await page.evaluate(() => scrollY), 60, 'No match does not execute a command');
  await page.keyboard.press('Escape');
  await page.keyboard.type(' ?');
  await promptReady(page);
  await page.keyboard.type('go to top');
  await page.keyboard.press('Enter');
  await eventually(() => page.evaluate(() => scrollY), value => value === 0);
  if (page.context().browser().browserType().name() === 'chromium') {
    // Browser accessibility can inspect closed-shadow controls without changing the extension.
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const [sequence, label, expectedScroll] of [['g', 'Go to bottom', value => value > 2000], [' ?', 'Go to top', value => value === 0]]) {
        await page.keyboard.type(sequence);
        if (sequence === ' ?') { await promptReady(page); await page.keyboard.type(label); }
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        const button = nodes.find(node => node.role?.value === 'button' && node.name?.value.startsWith(label));
        assert.ok(button, `${label} is accessible`);
        const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: button.backendDOMNodeId });
        await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
        await eventually(() => page.evaluate(() => scrollY), expectedScroll);
      }
    } finally { await cdp.detach(); }
  }
  await page.keyboard.type('g');
  await page.locator('#input').click();
  await page.keyboard.type('hello world');
  assert.equal(await page.locator('#input').inputValue(), 'hello world');
  assert.equal(await page.locator('[data-helixium]').count(), 0, 'Clicking into a field dismisses prefix mode');
}
async function exercisePageCoexistence(page) {
  await page.goto(origin);
  await page.evaluate(() => {
    window.escapeKeys = 0;
    window.ctrlKeys = 0;
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') window.escapeKeys++;
      if (event.ctrlKey && event.key === 'c') { window.ctrlKeys++; event.preventDefault(); }
    });
  });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.escapeKeys), 1);
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.escapeKeys), 1, 'An open menu still owns Escape');
  for (const prefix of ['v', 'Z', 'g']) {
    await page.keyboard.type(prefix);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Escape');
  }
  assert.equal(await page.evaluate(() => window.ctrlKeys), 3);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<dialog id="dialog"><button>Close</button></dialog>');
    document.getElementById('dialog').showModal();
  });
  await page.keyboard.press('Escape');
  await eventually(() => page.locator('#dialog').evaluate(element => element.open), value => !value);
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'corner';
    button.textContent = 'Corner action';
    button.style.cssText = 'position:fixed;bottom:20px;right:20px;width:350px;height:40px';
    button.onclick = () => { document.body.dataset.corner = 'clicked'; };
    document.body.append(button);
  });
  await page.keyboard.type('i');
  await page.locator('#corner').click({ position: { x: 300, y: 20 } });
  assert.equal(await page.locator('body').getAttribute('data-corner'), 'clicked');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.body.innerHTML = '<input type="checkbox" id="check"><div style="height:3000px">Long page</div>';
  });
  await page.keyboard.type('fa');
  assert.equal(await page.locator('#check').isChecked(), true);
  await page.keyboard.press('j');
  await eventually(() => page.evaluate(() => scrollY), value => value === 60);
  await page.goto(origin);
  await page.evaluate(() => {
    document.body.innerHTML = '<a href="http://[invalid">Invalid</a><svg width="200" height="80"><a href="/destination"><rect width="200" height="80" fill="green"/></a></svg>';
  });
  await page.keyboard.type('fa');
  await page.waitForURL('**/destination');
  await page.goto(origin);
  await page.locator('h1').click();
  await page.evaluate(() => {
    document.documentElement.style.cssText = 'height:100%;overflow:hidden';
    document.body.style.cssText = 'height:100%;overflow:auto;margin:0';
    document.body.innerHTML = '<div style="height:3000px">Body scroll container</div>';
  });
  await page.keyboard.press('j');
  await eventually(() => page.evaluate(() => document.body.scrollTop), value => value === 60);
}
async function exerciseExtensionActions(page, context, buildId) {
  await page.goto(origin);
  await page.bringToFront();
  await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<a href="http://[invalid">Invalid</a><a href="mailto:test@example.com">Mail</a><a href="javascript:void(0)">Script</a>'));
  await page.evaluate(() => {
    const link = document.getElementById('link');
    link.outerHTML = '<svg width="140" height="30"><a href="/destination"><rect width="140" height="30" fill="green"/></a></svg>';
  });
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
  assert.equal(await page.locator('[data-helixium]').evaluate(element => element.shadowRoot), null, 'The tab picker uses a closed shadow root');
  assert.equal(await page.locator('[data-helixium]').getAttribute('data-helixium-background-build'), buildId);
  await page.keyboard.type('Destination tab');
  await page.keyboard.press('Enter');
  await eventually(() => destination.evaluate(() => document.visibilityState), value => value === 'visible');
  await destination.keyboard.type(`${context.pages().length + 1}gp`);
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
  await page.keyboard.type(' f');
  await promptReady(page);
  const opening = context.waitForEvent('page');
  await page.keyboard.type(origin + '/destination?opened');
  await page.keyboard.press('Enter');
  const opened = await opening;
  await opened.waitForURL('**/destination?opened');
  await eventually(() => opened.evaluate(() => document.visibilityState), value => value === 'visible');
  await opened.close();
  await page.bringToFront();
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
        ...(engine === firefox && { args: ['--remote-debugging-port=0'] }),
        ...(engine === chromium && process.env.HELIXIUM_CHROME === '1' && { channel: 'chrome', ignoreDefaultArgs: ['--disable-extensions'] }),
        ...(engine === chromium && { chromiumSandbox: true, args: process.env.HELIXIUM_CHROME === '1' ? ['--enable-unsafe-extension-debugging'] : [`--disable-extensions-except=${resolve('dist/chrome')}`, `--load-extension=${resolve('dist/chrome')}`] }),
      });
      if (engine === chromium && process.env.HELIXIUM_CHROME === '1') {
        const cdp = await context.browser().newBrowserCDPSession();
        const { id } = await cdp.send('Extensions.loadUnpacked', { path: resolve('dist/chrome') });
        assert.ok(id);
        await cdp.detach();
      }
      if (engine === firefox) {
        const { ws_port: port } = JSON.parse(await readFile(join(profile, 'WebDriverBiDiServer.json'), 'utf8'));
        await installFirefoxExtension(port);
      }
      if (!installed) await context.addInitScript({ path: 'dist/chrome/content.js' });
      const page = await context.newPage();
      const browserArtifact = engine === firefox ? 'firefox' : 'chrome';
      const expected = await artifact(browserArtifact);
      await exercise(page, expected.buildId);
      await exerciseDiscovery(page);
      await exercisePageCoexistence(page);
      if (installed) await exerciseExtensionActions(page, context, expected.buildId);
      const digest = createHash('sha256');
      for (const file of (installed ? ['manifest.json', 'content.js', 'background.js'] : ['content.js'])) digest.update(await readFile(`dist/${browserArtifact}/${file}`));
      results.push({ source: revision, buildId: expected.buildId, artifactType: installed ? 'extension' : 'contentScriptOnly', artifactSha256: digest.digest('hex'), browser: process.env.HELIXIUM_CHROME === '1' ? 'Chrome' : engine.name(), version: context.browser()?.version(), installedExtension: installed, result: 'passed', checks: ['scrolling and counts', 'Helix goto prefixes', 'input passthrough', 'insert mode', 'synthetic event rejection', 'link, button and multi-character hints', 'focus input and contenteditable hints', 'ARIA button hints', 'hidden/disabled/inert exclusion', 'search and repeat', 'selection mode', 'nested scrolling', 'same- and cross-origin frame focus and scrolling', 'early page capture handlers', 'prefix menus, counts and sticky view', 'command palette filtering, physical modifiers, navigation and dismissal', 'idle Escape and native dialog dismissal', 'unbound Ctrl shortcuts', 'status click passthrough', 'checkbox hint navigation', 'SVG hints and malformed links', 'body scroll container', ...(engine === chromium ? ['accessible menu and palette mouse actions'] : []), ...(installed ? ['background-tab hints exclude unsupported protocols', 'tab picker', 'closed-shadow picker and loaded build fingerprints', 'counted tab wrapping and closing', 'URL scheme validation and successful URL opening', 'clipboard yank'] : [])] });
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
