// @ts-nocheck
import {test,expect} from 'bun:test';
import {completeQuery} from './query-continuation.js';
const partial=n=>({ok:{rows:[],count:0,countExact:false,pageComplete:false,readiness:{deferredCandidates:n}}});
test('local continuation yields, backs off stalls and replaces provisional pages with exact answer',async()=>{
 const replies=[partial(8),partial(4),partial(4),{ok:{rows:[{entry:'final'}],count:1,countExact:true,pageComplete:true}}];
 const delays=[],seen=[];
 const got=await completeQuery(async()=>replies.shift(),{pause:async ms=>{delays.push(ms);},progress:a=>seen.push(a)});
 expect(delays).toEqual([8,8,16]);expect(seen.length).toBe(4);expect(got.ok.rows).toEqual([{entry:'final'}]);
});
test('cancelling during yield does not issue another query',async()=>{
 const controller=new AbortController();let calls=0;
 const pending=completeQuery(async()=>{calls++;return partial(2);},{signal:controller.signal});
 setTimeout(()=>controller.abort(),1);
 await expect(pending).rejects.toThrow();expect(calls).toBe(1);
});
test('remote unavailable work is not locally polled',async()=>{
 const answer={ok:{rows:[],readiness:{unresolvedCandidates:2}}};let calls=0;
 expect(await completeQuery(async()=>{calls++;return answer;})).toBe(answer);expect(calls).toBe(1);
});
