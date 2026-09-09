import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile, readdir, rm, mkdtemp, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function artifact(browser) {
  const keymap = (await readFile('src/keymap.js', 'utf8')).replace(/^export /gm, '');
  const content = await readFile('src/content.js', 'utf8');
  const background = await readFile('src/background.js', 'utf8');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const manifest = {
    manifest_version: 3, name: 'Helixium', version,
    description: 'Keyboard browsing with Helix-style modes, selections, and navigation.',
    permissions: ['tabs', 'clipboardWrite'],
    content_scripts: [{ matches: ['http://*/*', 'https://*/*'], js: ['content.js'], all_frames: true, run_at: 'document_start' }],
    background: browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    ...(browser === 'firefox' && { browser_specific_settings: { gecko: { id: 'helixium@cbzehner.dev', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } } }),
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const buildId = createHash('sha256').update(JSON.stringify([manifestText, keymap, content, background])).digest('hex');
  const wrap = source => `(() => {\nconst buildId = ${JSON.stringify(buildId)};\n${source}\n})();\n`;
  return { buildId, files: {
    'manifest.json': manifestText,
    'content.js': wrap(`${keymap}\n${content}`),
    'background.js': wrap(background),
  } };
}

export async function build(output = 'dist') {
  await mkdir(output, { recursive: true });
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const { files } = await artifact(browser);
    const staged = await mkdtemp(`${output}/.${browser}-`);
    try {
      for (const [name, text] of Object.entries(files)) await writeFile(`${staged}/${name}`, text);
      await rm(`${output}/${browser}`, { recursive: true, force: true });
      await rename(staged, `${output}/${browser}`);
    } finally { await rm(staged, { recursive: true, force: true }); }
  }
}

export async function verifyBuild(browser, output = 'dist') {
  const expected = await artifact(browser);
  const directory = `${output}/${browser}`;
  try {
    if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(Object.keys(expected.files).sort())) throw new Error('File set differs');
    for (const [name, text] of Object.entries(expected.files)) {
      if (await readFile(`${directory}/${name}`, 'utf8') !== text) throw new Error(`${name} differs`);
    }
  } catch (error) {
    throw new Error(`Stale ${browser} build: run npm run build and reload the extension. ${error.message}`);
  }
  return expected;
}

export async function sourceRevision() {
  const git = (...args) => execFileSync('git', args);
  const patch = git('diff', '--binary', '--no-ext-diff', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean);
  const digest = createHash('sha256').update(patch);
  for (const path of untracked) digest.update(JSON.stringify(path)).update(await readFile(path));
  return { commit: git('rev-parse', 'HEAD').toString().trim(), dirty: patch.length > 0 || untracked.length > 0,
    worktreeSha256: digest.digest('hex') };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build();
