import { startFixtureServer } from '../tests/fixture-server.mjs';
await startFixtureServer(8787, '0.0.0.0');
console.log('Fixture: http://localhost:8787');
