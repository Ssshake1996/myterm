import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileManifest, verifyBundle, bundlePath, parseInstallArgs, findDshEntry } from '../../../scripts/windows-bundle/install.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'remote-ops-bundle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'browser-runtime'), { recursive: true });
  for (const path of ['dsh-remote-ops-v0.5.3.tgz', 'install.ps1', 'install.mjs', 'browser-runtime/runtime.json', 'browser-runtime/.marker']) await writeFile(join(root, path), 'fixture');
  const manifest = { schema: 1, version: '0.5.3', platform: 'win32', arch: 'x64', package: 'dsh-remote-ops-v0.5.3.tgz', files: await fileManifest(root) };
  await writeFile(join(root, 'bundle.json'), JSON.stringify(manifest)); return { root, manifest };
}

test('Windows bundle verifies the full payload including dotfiles', async t => {
  const f = await fixture(t); assert.equal((await verifyBundle(f.root)).version, '0.5.3'); assert.ok(f.manifest.files.some(v => v.path.endsWith('/.marker')));
});
test('modified, missing and unexpected payload files reject the bundle before installation', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'install.ps1'), 'tampered'); await assert.rejects(verifyBundle(f.root), /checksum mismatch/);
  await writeFile(join(f.root, 'install.ps1'), 'fixture'); await writeFile(join(f.root, 'extra'), 'unexpected'); await assert.rejects(verifyBundle(f.root), /unexpected files/);
  await rm(join(f.root, 'extra')); await rm(join(f.root, 'browser-runtime', '.marker')); await assert.rejects(verifyBundle(f.root), /missing or unexpected/);
});
test('bundle manifest rejects paths outside the bundle and duplicate entries', async t => {
  const f = await fixture(t);
  for (const path of ['../escape', '/escape', 'C:/escape', 'folder\\escape', './install.ps1']) assert.throws(() => bundlePath(f.root, path), /Invalid/);
  f.manifest.files.push(f.manifest.files[0]); await writeFile(join(f.root, 'bundle.json'), JSON.stringify(f.manifest)); await assert.rejects(verifyBundle(f.root), /checksum entry/);
});
test('installer accepts explicit home/profile without invoking a shell and rejects invalid options', () => {
  const args = parseInstallArgs(['--profile', 'custom_web', '--home', 'a directory with spaces', '--verify-only']); assert.equal(args.profile, 'custom_web'); assert.equal(args.verifyOnly, true); assert.match(args.home, /a directory with spaces$/);
  for (const argv of [['--profile', '../web'], ['--home'], ['--offline']]) assert.throws(() => parseInstallArgs(argv));
  assert.throws(() => findDshEntry(undefined, ''), /DSH was not found/);
});
