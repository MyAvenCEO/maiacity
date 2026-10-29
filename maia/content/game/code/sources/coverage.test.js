// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { coverageOf, readState, waitsHere } from './coverage.js';

test('coverage is read from the answer alone', () => {
 expect(coverageOf(null).state).toBe('unavailable');
 expect(coverageOf({refused:'locked'}).state).toBe('unavailable');
 expect(coverageOf({ok:{rows:[{entry:'a'}],count:1,coverage:{state:'complete'}}})).toEqual({state:'complete',have:1,known:1,waiting:[],logs:0});
 const partial = coverageOf({ok:{rows:[],count:2,coverage:{state:'partial',have:2,known:5,waiting:[{entry:'e',on:'semantics'},{bad:1}],logs:3}}});
 expect(partial).toEqual({state:'partial',have:2,known:5,waiting:[{entry:'e',on:'semantics'}],logs:3});
 expect(coverageOf({ok:{rows:[],count:0,coverage:{state:'denied',why:'no standing'}}})).toMatchObject({state:'denied',why:'no standing'});
 // A device from before sync v2 names no coverage: complete, for one release.
 expect(coverageOf({ok:{rows:[],count:0}}).state).toBe('complete');
});
test('local waits differ from logs still on their way', () => {
 expect(waitsHere(coverageOf({ok:{count:1,coverage:{state:'partial',have:1,known:2,waiting:[],logs:0}}}))).toBe(true);
 expect(waitsHere(coverageOf({ok:{count:1,coverage:{state:'partial',have:1,known:1,waiting:[],logs:7}}}))).toBe(false);
 expect(waitsHere(coverageOf({ok:{count:0,coverage:{state:'complete'}}}))).toBe(false);
});
test('a view state follows coverage', () => {
 expect(readState(coverageOf({ok:{coverage:{state:'complete'}}}))).toBe('local');
 expect(readState(coverageOf({ok:{coverage:{state:'partial',logs:1}}}))).toBe('pending');
 expect(readState(coverageOf({ok:{coverage:{state:'denied'}}}))).toBe('unavailable');
 expect(readState(coverageOf(null))).toBe('unavailable');
});

// Freshness.lean's vectors, the same file the Rust engine replays (aven/db/crates/avendb/tests/all/freshness_vectors.rs).
test('freshness and the sheets are what the model says', async () => {
 const { freshnessOf, opensOn, showsFinal } = await import('./coverage.js');
 const cases = await Bun.file(new URL('../../../../../aven/db/spec/vectors/freshness.json', import.meta.url)).json();
 expect(cases.length).toBe(20);
 for (const c of cases) {
  const f = freshnessOf({ ok: [], fresh: c.fresh });
  expect([c.name, f.state]).toEqual([c.name, c.fresh.state]);
  expect([c.name, opensOn(f, false)]).toEqual([c.name, c.pops]);
  expect([c.name, opensOn(f, true)]).toEqual([c.name, c.asked]);
  expect([c.name, showsFinal(f)]).toEqual([c.name, c.fresh.state !== 'behind']);
 }
 // The 27 Oct iPhone: three peers, 2,778 logs behind: never final, no sheet by itself; asked, it opens.
 const iphone = freshnessOf({ ok: [{ number: 29, stage: 'proposed' }], fresh: { state: 'behind', logs: 2778, waits: 0, unheard: 0 } });
 expect([showsFinal(iphone), opensOn(iphone), opensOn(iphone, true)]).toEqual([false, false, true]);
 // A device from before freshness: current, for one release.
 expect(freshnessOf({ ok: [] }).state).toBe('current');
});
