// @ts-nocheck — Bun tests
import { expect, test } from 'bun:test';
import { observedWindow } from './observed-window.js';
import { queryEntries } from './query-window.js';
const id = n => n.toString(16).padStart(64,'0');
const flush = async () => { for(let i=0;i<12;i++)await Promise.resolve(); };
test('explicit selected IDs demand history before an empty local result, with bounded hints', () => {
 expect(queryEntries({entries:[id(1),id(2),id(1),'bad']})).toEqual([id(1),id(2)]);
 expect(queryEntries({entries:Array.from({length:600},(_,i)=>id(i))})).toHaveLength(512);
});
test('observed revisions reuse a lease; abort clears it and suppresses late data', async () => {
 const calls=[], owner={run:async op=>{calls.push(op);return {ok:{accepted:true}};}};
 let resolve;
 const read=observedWindow(async()=>new Promise(r=>resolve=r));
 const scope=new AbortController();
 const first=read(owner,{op:'entry_views',entries:[id(1)]},scope.signal);
 await flush(); expect(calls[0].entries).toEqual([id(1)]);
 resolve({ok:{rows:[]}});await first;
 const second=read(owner,{op:'note',entry:id(1)},scope.signal);
 await flush();expect(new Set(calls.map(c=>c.scope)).size).toBe(1);
 scope.abort();resolve({ok:{entry:id(1)}});
 expect(await second).toBeNull();await flush();expect(calls.at(-1).entries).toEqual([]);
 const replacement=new AbortController();
 const next=read(owner,{op:'note',entry:id(2)},replacement.signal);
 await flush();expect(calls.at(-1).scope).not.toBe(calls[0].scope);
 resolve({ok:null});await next;replacement.abort();
});
test('reactive cold pages render immediately and are replaced, while obsolete continuations cannot publish',async()=>{
 const {createReactiveRead}=await import('./reactive-read.js');
 const shown=[];let queries=0;const owner={run:async()=>({ok:{accepted:true}})};
 const reader=createReactiveRead({
  read:observedWindow(async(_owner,op)=>{
   queries++;
   if(op.tag==='new')return {ok:{rows:[{entry:'new'}],count:1,countExact:true,pageComplete:true}};
   return {ok:{rows:[{entry:'partial'}],count:1,countExact:false,pageComplete:false,readiness:{deferredCandidates:5}}};
  }),take:answer=>shown.push(answer),timing:()=>()=>{}
 });
 reader.update({op:'query',tag:'old'},owner);
 await new Promise(r=>setTimeout(r,1));
 expect(shown[0].ok.rows).toEqual([{entry:'partial'}]);expect(shown[0].ok.pageComplete).toBe(false);
 reader.update({op:'query',tag:'new'},owner);
 await new Promise(r=>setTimeout(r,15));
 expect(shown.map(a=>a.ok.rows)).toEqual([[{entry:'partial'}],[{entry:'new'}]]);
 expect(queries).toBe(2);reader.close();
});
test('provisional pages replace instead of concatenate and the final exact page wins',async()=>{
 const {createReactiveRead}=await import('./reactive-read.js');
 const shown=[];let n=0;const owner={run:async()=>({ok:{accepted:true}})};
 const reader=createReactiveRead({read:observedWindow(async()=>({ok:{rows:[{entry:String(++n)}],count:n,countExact:n===3,pageComplete:n===3,readiness:{deferredCandidates:n<3?3-n:0}}})),take:a=>shown.push(a),timing:()=>()=>{}});
 reader.update({op:'query'},owner);
 await new Promise(r=>setTimeout(r,35));reader.close();
 expect(shown.map(a=>a.ok.rows)).toEqual([[{entry:'1'}],[{entry:'2'}],[{entry:'3'}]]);
 expect(shown.at(-1).ok.countExact).toBe(true);
});
