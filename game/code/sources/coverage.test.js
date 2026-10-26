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
