import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { commands, crates, program, shards } from './rust-tests.mjs';

test('every crate the archive holds is some shard\'s, and the core\'s properties run under libtest', () => {
 const filters = Object.values(shards).map(s => s.filter ?? '');
 for (const c of crates) expect(filters.some(f => f.includes(`package(${c})`))).toBe(true);
 expect(Object.values(shards).filter(s => s.filter?.includes('package(avendb)'))).toHaveLength(1);
 expect(shards['core-properties']).toMatchObject({ binary: 'avendb::all', args: ['--test-threads=2', 'properties::'] });
 // and nextest's default filter leaves exactly those out of every other shard
 expect(readFileSync(new URL('../../../.config/nextest.toml', import.meta.url), 'utf8'))
  .toContain(`default-filter = 'not (binary_id(avendb::all) & test(/^properties::/))'`);
});

test('a shard runs from the archive and builds nothing', () => {
 const [[cargo, sub, ...args]] = commands('run', { shard: 'net', file: '/t/a.tar.zst' });
 expect([cargo, sub]).toEqual(['cargo', 'nextest']);
 expect(args.slice(0, 6)).toEqual(['run', '--profile', 'ci', '--archive-file', '/t/a.tar.zst', '--workspace-remap']);
 expect(args.join(' ')).toContain('-E package(avendb-net)');
 const [[, , list]] = commands('run', { shard: 'core-properties', file: '/t/a.tar.zst', extracted: '/t/x' });
 expect(list).toBe('list');
 // a binaries-only list has no suites, so no folder to run the program in
 expect(commands('run', { shard: 'core-properties', file: '/t/a.tar.zst', extracted: '/t/x' })[0]).not.toContain('binaries-only');
 expect(() => commands('run', { shard: 'nope' })).toThrow('a step is archive, doc or run');
 expect(commands('archive', { file: '/t/a.tar.zst' })[0].slice(0, 4)).toEqual(['cargo', 'nextest', 'archive', '--locked']);
});

test('the libtest shard finds its program in a nextest list', () => {
 const list = JSON.stringify({ 'rust-suites': { 'avendb::all': { 'binary-id': 'avendb::all', 'binary-path': '/x/target/debug/deps/all-1f', cwd: '/x/crates/avendb' } } });
 expect(program(list, 'avendb::all')).toEqual({ path: '/x/target/debug/deps/all-1f', cwd: '/x/crates/avendb' });
 expect(() => program(list, 'avendb::memory')).toThrow('the archive holds no avendb::memory');
 expect(() => program(JSON.stringify({ 'rust-binaries': { 'avendb::all': {} } }), 'avendb::all')).toThrow('the archive holds no avendb::all');
});
