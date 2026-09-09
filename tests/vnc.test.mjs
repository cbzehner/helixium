import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vncConnection } from './vnc.mjs';

test('late VNC replies cannot resolve another command; exited input fails immediately', async () => {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
  const connection = vncConnection(child, 20);
  try {
    await assert.rejects(connection.command('keys'), /timed out/);
    const screenshot = connection.command('screenshot');
    child.stdout.write(JSON.stringify({ id: 1, ok: true }) + '\n');
    await assert.rejects(screenshot, /timed out/);
    const next = connection.command('keys');
    child.stdout.write(JSON.stringify({ id: 3, ok: true }) + '\n');
    await next;
    child.emit('exit', 1);
    await assert.rejects(connection.command('keys'), /exited 1/);
  } finally { connection.close(); }
});
