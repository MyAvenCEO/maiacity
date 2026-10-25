// @ts-nocheck
import { test, expect } from 'bun:test';
import { guardedPlan } from './guarded-plan.js';

test('planned references use accepted values and each step uses refreshed guards', async () => {
 const calls=[];
 const result=await guardedPlan({checks:['initial'],ops:[{op:'create'},{op:'tag',entry:'$0'}],send:async op=>{
  calls.push(op); return {ok:{value:calls.length===1?{entry:'made'}:{edit:'tagged'},guards:['next'],canContinue:true}};
 }});
 expect(calls[1].checks).toEqual(['next']); expect(calls[1].change.entry).toBe('made'); expect(result.complete).toBe(true);
});
test('accepted edit remains reported when its continuation capture failed', async () => {
 let calls=0;
 const result=await guardedPlan({checks:['initial'],ops:[{op:'tag'},{op:'tag'}],send:async()=>{
  calls++;return {ok:{value:{edit:'accepted'},guards:null,canContinue:false,continuationError:'Unavailable'}};
 }});
 expect(calls).toBe(1);expect(result.done).toEqual([{edit:'accepted'}]);expect(result.complete).toBe(false);
});
test('stale refusal preserves prior accepted work and never retries the old plan', async () => {
 let calls=0;
 const result=await guardedPlan({checks:['initial'],ops:[{op:'tag'},{op:'tag'},{op:'tag'}],send:async()=>++calls===1?
 {ok:{value:{edit:'first'},guards:['refreshed'],canContinue:true}}:{refused:'stale'}});
 expect(calls).toBe(2);expect(result.done).toEqual([{edit:'first'}]);expect(result.reason).toBe('stale');
});
