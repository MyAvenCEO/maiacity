import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { commands, crates, shards } from './rust-tests.mjs';

test('every crate with tests is some nextest shard\'s, once, and the core\'s properties run under libtest', () => {
 const built = Object.values(shards).filter(s => !s.libtest).flatMap(s => s.crates);
 expect(built.sort()).toEqual([...crates].sort());
 expect(shards['core-properties'].libtest).toEqual(['--test', 'all', '--', '--test-threads=2', 'properties::']);
 // and nextest's default filter leaves exactly those out of every nextest shard
 expect(readFileSync(new URL('../../../.config/nextest.toml', import.meta.url), 'utf8'))
  .toContain(`default-filter = 'not (binary_id(avendb::all) & test(/^properties::/))'`);
});

test('a shard builds only its own crates, with their fixtures, then runs their doc tests', () => {
 const [run, doc] = commands('device-browser');
 expect(run.slice(0, 6)).toEqual(['cargo', 'nextest', 'run', '--locked', '--profile', 'ci']);
 expect(run.join(' ')).toContain('-p avendb-device -p avendb-browser --features avendb-device/test-fixtures,avendb-browser/test-fixtures');
 expect(run.join(' ')).not.toContain('avendb-net');
 expect(doc.slice(0, 4)).toEqual(['cargo', 'test', '--locked', '--doc']);
 const [props, ...rest] = commands('core-properties');
 expect(rest).toEqual([]);
 expect(props.join(' ')).toBe('cargo test --locked -p avendb --features avendb/test-fixtures --test all -- --test-threads=2 properties::');
 expect(() => commands('nope')).toThrow('a shard is one of');
});
