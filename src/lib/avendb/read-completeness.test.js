import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readCompleteness} from './read-completeness.js';
import {watchActiveReads} from './active-reads.js';
import {createReadWindow} from './query-window.js';
/** @param {unknown} actual */
const expect = (actual) => ({
 /** @param {unknown} expected */ toEqual: (expected) => assert.deepEqual(actual, expected),
 /** @param {unknown} expected */ toBe: (expected) => assert.equal(actual, expected),
 toBeNull: () => assert.equal(actual, null)
});
test('successful empty results never establish discovery or file completeness',()=>{
 const state=readCompleteness({ok:{rows:[],count:0,complete:true}});
 expect(state).toEqual({deferredCandidates:0,countExact:null,pageComplete:null,pendingJudgments:0,unresolvedCandidates:0,response:'local',discovery:'unverified',history:'unverified',fileInventory:'unverified',fileBytes:'unverified',authoritativeEmpty:false});
 expect(readCompleteness({refused:'NoEntry'}).response).toBe('unavailable');
});
test('checkpoint history and partial file inventory remain separate from byte availability',()=>{
 expect(readCompleteness({ok:{rows:[{checkpoint:{partial:true},filesComplete:false,record:{private:'content'}}]}})).toEqual({deferredCandidates:0,countExact:null,pageComplete:null,pendingJudgments:0,unresolvedCandidates:0,response:'local',discovery:'unverified',history:'checkpoint-partial',fileInventory:'partial',fileBytes:'unverified',authoritativeEmpty:false});
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

test('pending or unresolved local responses never report the mounted view as loaded',async()=>{
 let snapshot={total:0,pending:0,local:0};
 const stop=watchActiveReads(value=>snapshot=value);
 const device={run:async()=>({ok:{accepted:true}})};
 let readiness={pendingJudgments:2,unresolvedCandidates:1};
 const view=createReadWindow({device:()=>device,read:async()=>({ok:{rows:[],count:0,readiness}})});
 try {
  await view.read({op:'query'});
  assert.equal(view.completeness.response,'local');
  assert.equal(view.completeness.pendingJudgments,2);
  assert.equal(snapshot.pending,1);assert.equal(snapshot.local,0);
  readiness={deferredCandidates:0,countExact:null,pageComplete:null,pendingJudgments:0,unresolvedCandidates:1};
  await view.read({op:'query'});
  assert.equal(snapshot.pending,0);assert.equal(snapshot.local,0);
  // Node-wide pending work alone does not block an answered local view.
  readiness={pendingJudgments:2,unresolvedCandidates:0};
  await view.read({op:'query'});
  assert.equal(snapshot.local,1);
 } finally {view.close();stop();}
});
test('bounded local continuation stays pending and close cancels its next turn',async()=>{
 let calls=0;
 const device={run:async()=>({ok:{accepted:true}})};
 const view=createReadWindow({device:()=>device,read:async()=>{calls++;return {ok:{rows:[],count:0,countExact:false,pageComplete:false,readiness:{deferredCandidates:4}}};}});
 const pending=view.read({op:'query'});
 await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(view.completeness.deferredCandidates,4);assert.equal(view.completeness.pageComplete,false);
 view.close();assert.equal(await pending,null);assert.equal(calls,1);
});
test('owner replacement between yielded slices prevents another old-device call',async()=>{
 let owner={};let calls=0;
 const view=createReadWindow({device:()=>owner,read:async()=>{calls++;return {ok:{rows:[],readiness:{deferredCandidates:2}}};}});
 const pending=view.read({op:'query'});await new Promise(r=>setTimeout(r,1));owner={};
 assert.equal(await pending,null);assert.equal(calls,1);view.close();
});
