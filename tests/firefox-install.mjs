import { resolve } from 'node:path';
import { connectBidi } from './bidi.mjs';

export async function installFirefoxExtension(port) {
  const bidi = await connectBidi(`ws://127.0.0.1:${port}/session`);
  try {
    const session = await bidi.send('session.new', { capabilities: {} });
    const installed = await bidi.send('webExtension.install', { extensionData: { type: 'path', path: resolve('dist/firefox') } });
    if (installed.extension !== 'helixium@cbzehner.dev') throw new Error('Wrong Firefox extension installed');
    return { session: session.capabilities, extension: installed.extension };
  } finally { bidi.close(); }
}
