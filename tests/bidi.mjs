export async function connectBidi(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('BiDi connection timed out')); }, 10000);
    socket.onopen = () => { clearTimeout(timeout); resolve(); };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error(`Cannot connect to ${url}`)); };
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.type === 'error') request.reject(new Error(`${message.error}: ${message.message}`));
    else request.resolve(message.result);
  };
  socket.onclose = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error('BiDi connection closed'));
    }
    pending.clear();
  };
  return {
    send(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); },
  };
}
