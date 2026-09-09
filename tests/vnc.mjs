import { createInterface } from 'node:readline';

export function vncConnection(input, timeoutMs = 20000) {
  let sequence = 0;
  let failure;
  let log = '';
  const pending = new Map();
  const lines = createInterface({ input: input.stdout });
  input.stderr.on('data', data => { log += data; });
  function fail(error) {
    failure = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  lines.on('line', line => {
    try {
      const result = JSON.parse(line);
      const request = pending.get(result.id);
      if (!request) return; // A response to a timed-out request cannot finish another.
      pending.delete(result.id);
      if (result.error) request.reject(new Error(result.error));
      else request.resolve();
    } catch (error) { fail(error); }
  });
  input.on('error', fail);
  input.on('exit', code => fail(new Error(`VNC input exited ${code}: ${log}`)));
  return {
    command(action, parameters = {}) {
      if (failure) return Promise.reject(failure);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`VNC ${action} timed out`));
        }, timeoutMs);
        pending.set(id, {
          resolve() { clearTimeout(timeout); resolve(); },
          reject(error) { clearTimeout(timeout); reject(error); },
        });
        input.stdin.write(JSON.stringify({ id, action, ...parameters }) + '\n', error => {
          if (error) fail(error);
        });
      });
    },
    close() { input.stdin.end(); lines.close(); fail(new Error('VNC connection closed')); },
    get log() { return log; },
  };
}
