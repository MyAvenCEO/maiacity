import { expect, test } from 'bun:test';
import { collapse, vsMain } from './avendb-bench.mjs';

test('repeated runs become one line of medians, with the spread of what varied', () => {
 const runs = [0.42, 0.25, 0.31].map(s => ({ kind: 'live', link: 'phone_bulk', link_share: s, edits: 400 }));
 const { lines, spread } = collapse([...runs, { kind: 'live', link: 'calm', link_share: 0.9, edits: 600 }]);
 expect(lines).toHaveLength(2);
 expect(lines[0].link_share).toBe(0.31);
 expect(spread).toEqual([{ run: 'live phone_bulk', field: 'link_share', runs: 3, min: 0.25, median: 0.31, max: 0.42 }]);
});

test('a gate is held against main in its own direction, within the tolerance', () => {
 const pr = [
  { gate: true, name: 'share', value: 0.3, limit: '≥ 0.8', ok: false },
  { gate: true, name: 'p95 ms', value: 120, limit: '< 500', ok: true },
  { gate: true, name: 'missed', value: 0, limit: '≤ 0', ok: true },
  { gate: false, name: 'target', value: 1, limit: '≥ 2', ok: false },
 ];
 const main = [
  { gate: true, name: 'share', value: 0.32, limit: '≥ 0.8' },
  { gate: true, name: 'p95 ms', value: 100, limit: '< 500' },
  { gate: true, name: 'missed', value: 0, limit: '≤ 0' },
 ];
 const out = vsMain(pr, main, 0.15);
 expect(out.map(r => [r.name, r.ok])).toEqual([["share, against main's 0.32", true], ["p95 ms, against main's 100", false]]);
 expect(out[1].limit).toBe('20 % worse, ≤ 15 % allowed');
});
