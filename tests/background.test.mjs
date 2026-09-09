import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');

function background() {
  const tabs = [{ id: 1, index: 0, windowId: 10 }, { id: 2, index: 1, windowId: 10 }, { id: 3, index: 0, windowId: 20 }];
  const activated = [];
  let listener;
  const api = { runtime: { onMessage: { addListener(callback) { listener = callback; } } }, tabs: {
    query: async ({ windowId }) => tabs.filter(tab => tab.windowId === windowId),
    get: async id => tabs.find(tab => tab.id === id),
    update: async id => { activated.push(id); },
    create: async () => { throw new Error('Unexpected creation'); },
  } };
  runInNewContext(`const buildId = 'tested-build';\n${source}`, { browser: api, URL });
  return { activated, send: message => new Promise(resolve => listener(message, { tab: tabs[0] }, resolve)) };
}

test('tab counts wrap inside the originating window and replies identify the loaded build', async () => {
  const runtime = background();
  for (const [command, count, expected] of [['next-tab', 3, 2], ['previous-tab', 3, 2], ['next-tab', 2, 1]]) {
    const result = await runtime.send({ command, count });
    assert.equal(result.buildId, 'tested-build');
    assert.equal(runtime.activated.at(-1), expected);
  }
  await runtime.send({ command: 'activate-tab', id: 3 });
  assert.deepEqual(runtime.activated, [2, 2, 1]);
});
test('background rejects unsupported URLs even if a caller bypasses hint filtering', async () => {
  for (const url of ['javascript:alert(1)', 'mailto:test@example.com', 'file:///tmp/test']) {
    const result = await background().send({ command: 'open', url });
    assert.match(result.error, /Only HTTP\(S\)/);
  }
});
