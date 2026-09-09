import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
const keymap = (await readFile('src/keymap.js', 'utf8')).replaceAll('export ', '');
const content = await readFile('src/content.js', 'utf8');
for (const browser of ['chrome', 'firefox', 'safari']) {
  const directory = `dist/${browser}`;
  await mkdir(directory, { recursive: true });
  const manifest = {
    manifest_version: 3, name: 'Helixium', version: '0.1.0',
    description: 'Keyboard browsing with Helix-style modes, selections, and navigation.',
    permissions: ['tabs', 'clipboardWrite'],
    content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], all_frames: true, run_at: 'document_idle' }],
    background: browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    ...(browser === 'firefox' && { browser_specific_settings: { gecko: { id: 'helixium@cbzehner.dev', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } } }),
  };
  await writeFile(`${directory}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(`${directory}/content.js`, `(() => {\n${keymap}\n${content}\n})();\n`);
  await copyFile('src/background.js', `${directory}/background.js`);
}
