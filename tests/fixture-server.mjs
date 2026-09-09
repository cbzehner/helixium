import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export async function startFixtureServer(port = 0, host = '127.0.0.1', inspection = false) {
  const page = await readFile(new URL('./fixture.html', import.meta.url));
  const frame = await readFile(new URL('./frame.html', import.meta.url));
  const pages = new Map();
  const pending = new Map();
  let sequence = 0;
  // SafariDriver cannot load extensions. This test-only page bridge supplies
  // DOM observations/setup; every keyboard and mouse action still uses VNC.
  const bridge = inspection ? `<script>
    const fixtureId = crypto.randomUUID();
    let result;
    async function inspectFixture() {
      try {
        const response = await fetch('/__fixture', { method: 'POST', body: JSON.stringify({
          id: fixtureId, url: location.href, top: window === top,
          visible: document.visibilityState === 'visible', result
        }) });
        result = undefined;
        const command = await response.json();
        if (command) {
          try { result = { id: command.id, value: await (0, eval)(command.script) }; }
          catch (error) { result = { id: command.id, error: String(error) }; }
        }
      } finally { setTimeout(inspectFixture, 100); }
    }
    inspectFixture();
  </script>` : '';
  const server = createServer(async (request, response) => {
    if (inspection && request.method === 'POST' && request.url === '/__fixture') {
      let body = '';
      try {
        for await (const chunk of request) body += chunk;
      } catch (error) {
        if (error.code === 'ECONNRESET') return; // Navigation cancels in-flight polls.
        throw error;
      }
      const { id, result, ...state } = JSON.parse(body);
      const entry = pages.get(id) ?? {};
      pages.set(id, { ...entry, ...state, seen: Date.now(), command: null });
      if (result && pending.has(result.id)) {
        const request = pending.get(result.id);
        pending.delete(result.id);
        clearTimeout(request.timeout);
        if (result.error) request.reject(new Error(result.error));
        else request.resolve(result.value);
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(entry.command ?? null));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(Buffer.concat([request.url.startsWith('/frame') ? frame : page, Buffer.from(bridge)]));
  });
  server.pages = pages;
  server.evaluate = (pageId, script) => new Promise((resolve, reject) => {
    const page = pages.get(pageId);
    if (!page) return reject(new Error('Unknown fixture page'));
    if (page.command) return reject(new Error('Fixture already has a queued command'));
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture evaluation timed out: ${script}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    page.command = { id, script };
  });
  await new Promise(resolve => server.listen(port, host, resolve));
  return server;
}
