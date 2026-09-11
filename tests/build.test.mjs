import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, verifyBuild } from '../scripts/build.mjs';

test('build replaces stale output and verification rejects changed or extra files', async () => {
  const output = await mkdtemp(join(tmpdir(), 'helixium-build-'));
  try {
    const previous = process.cwd();
    try { process.chdir(output); await build(output); } finally { process.chdir(previous); }
    const original = await verifyBuild('safari', output);
    await writeFile(`${output}/safari/content.js`, 'stale extension');
    await assert.rejects(verifyBuild('safari', output), /Stale safari build/);
    await writeFile(`${output}/chrome/obsolete.js`, 'obsolete');
    await assert.rejects(verifyBuild('chrome', output), /File set differs/);
    await build(output);
    assert.deepEqual((await readdir(`${output}/chrome`)).sort(), ['background.js', 'content.js', 'manifest.json']);
    assert.equal((await verifyBuild('safari', output)).buildId, original.buildId);
    assert.ok(original.files['content.js'].includes(original.buildId));
    assert.ok(original.files['background.js'].includes(original.buildId));
  } finally { await rm(output, { recursive: true, force: true }); }
});
