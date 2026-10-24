import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readCompleteness} from './read-completeness.js';
import {createReadWindow} from './query-window.js';
/** @param {unknown} actual */
const expect = (actual) => ({
 /** @param {unknown} expected */ toEqual: (expected) => assert.deepEqual(actual, expected),
 /** @param {unknown} expected */ toBe: (expected) => assert.equal(actual, expected),
 toBeNull: () => assert.equal(actual, null)
});
test('successful empty results never establish discovery or file completeness',()=>{
 const state=readCompleteness({ok:{rows:[],count:0,complete:true}});
 expect(state).toEqual({response:'local',discovery:'unverified',history:'unverified',fileInventory:'unverified',fileBytes:'unverified',authoritativeEmpty:false});
 expect(readCompleteness({refused:'NoEntry'}).response).toBe('unavailable');
});
test('checkpoint history and partial file inventory remain separate from byte availability',()=>{
 expect(readCompleteness({ok:{rows:[{checkpoint:{partial:true},filesComplete:false,record:{private:'content'}}]}})).toEqual({response:'local',discovery:'unverified',history:'checkpoint-partial',fileInventory:'partial',fileBytes:'unverified',authoritativeEmpty:false});
 expect(readCompleteness({ok:{filesComplete:true,files:[{}]}}).fileBytes).toBe('unverified');
});
test('generic windows expose independent completeness and clear stale scope evidence',async()=>{
 /** @type {(value: unknown) => void} */
 let resolve = () => { throw new Error("Deferred read has not started"); };
 const device={run:async()=>({ok:{accepted:true}})};
 const view=createReadWindow({device:()=>device,read:async(_d,op)=>op.wait?new Promise(r=>resolve=r):({ok:{rows:[{checkpoint:{partial:true}}]}})});
 await view.read({op:'query'});expect(view.completeness.history).toBe('checkpoint-partial');
 const copy=view.completeness;copy.discovery='complete';expect(view.completeness.discovery).toBe('unverified');
 const delayed=view.read({op:'query',wait:true});expect(view.completeness.response).toBe('unavailable');
 view.clear();resolve({ok:{rows:[{checkpoint:{partial:true}}]}});expect(await delayed).toBeNull();expect(view.completeness.history).toBe('unverified');view.close();
});

test('empty or paged-out checkpoint results retain query-level partial evidence',()=>{
 const state=readCompleteness({ok:{rows:[],count:0,readiness:{checkpointPartial:true,unresolvedCandidates:1,authoritativeEmpty:false}}});
 expect(state.history).toBe('checkpoint-partial');expect(state.authoritativeEmpty).toBe(false);
 expect(state.discovery).toBe('unverified');
});
