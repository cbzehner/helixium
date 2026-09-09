import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const fixture = await readFile(new URL('../tests/fixture.html', import.meta.url));
createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(fixture);
}).listen(8787, '0.0.0.0', () => console.log('Fixture: http://localhost:8787'));
