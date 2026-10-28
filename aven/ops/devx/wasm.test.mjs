import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keyOf, read, stamped } from './wasm.mjs';

const line = (path, hash = 'a'.repeat(40)) => `100644 blob ${hash}\t${path}`;

test('the key is of what the WebAssembly build reads, and nothing else', () => {
 for (const f of ['Cargo.lock', 'aven/db/crates/avendb/src/lib.rs', 'aven/db/crates/avendb-browser/js/store.js', 'aven/db/vendor/iroh/src/lib.rs'])
  expect(read(f)).toBe(true);
 for (const f of ['aven/db/crates/avendb/tests/all/live.rs', 'aven/db/crates/avendb-server/src/main.rs', 'theos/app/src/main.rs', 'aven/db/page/ops.js', 'aven/db/spec/AvenDB/Wire.lean'])
  expect(read(f)).toBe(false);
 const base = [line('Cargo.lock'), line('aven/db/crates/avendb/src/lib.rs')];
 const k = keyOf(base.join('\n'));
 // a test, the server or a page file changes the key of no build
 expect(keyOf([...base, line('aven/db/crates/avendb/tests/all/live.rs')].join('\n'))).toBe(k);
 expect(keyOf([...base, line('aven/db/page/ops.js')].reverse().join('\n'))).toBe(k);
 // a source of the build does
 expect(keyOf([line('Cargo.lock'), line('aven/db/crates/avendb/src/lib.rs', 'b'.repeat(40))].join('\n'))).not.toBe(k);
});

test('a folder counts as a build only while every file it stamped is there as it was', () => {
 const dir = mkdtempSync(join(tmpdir(), 'wasm-test-'));
 try {
  writeFileSync(join(dir, 'a.js'), 'one');
  const sum = 'a1c1ce0e4f5b0f7b4c1b5bd7e9a4a8b6e5f1f2d6d3c0b8e7a4c3b2a1f0e9d8c7';
  writeFileSync(join(dir, '.build.json'), JSON.stringify({ key: 'k', files: { 'a.js': sum } }));
  expect(stamped(dir)).toBe(null);
  const real = new Bun.CryptoHasher('sha256').update('one').digest('hex');
  writeFileSync(join(dir, '.build.json'), JSON.stringify({ key: 'k', files: { 'a.js': real } }));
  expect(stamped(dir)?.key).toBe('k');
  writeFileSync(join(dir, 'b.js'), 'two');
  expect(stamped(dir)).toBe(null);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
