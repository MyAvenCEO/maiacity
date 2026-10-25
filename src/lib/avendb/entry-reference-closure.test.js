// @ts-nocheck
import {test,expect} from 'bun:test';
import {observeReferenceClosure} from './entry-reference-closure.js';
const id=n=>n.toString(16).padStart(64,'0');
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('explicit transitive graph loads in bounded turns and removes revoked or unreachable rows',async()=>{
 const leases=[],states=[];
 const close=observeReferenceClosure((query,take)=>{const lease={query:query(),take,closed:false};leases.push(lease);return()=>lease.closed=true},[id(1)],id(9),row=>row.readable!==false,state=>states.push(state));
 leases[0].take({ok:{rows:[{entry:id(1),record:{items:[{ref:{entry:id(2)}}]}}]}});await tick();
 expect(leases[1].query.entries).toEqual([id(2)]);
 leases[1].take({ok:{rows:[{entry:id(2),record:{files:[{entry:id(3)}]}}]}});await tick();
 leases[2].take({ok:{rows:[{entry:id(3)}]}});await tick();
 expect(states.at(-1).rows.map(r=>r.entry).sort()).toEqual([id(1),id(2),id(3)]);
 leases[1].take({ok:{rows:[{entry:id(2),readable:false}]}});
 expect(states.at(-1).rows.map(r=>r.entry)).toEqual([id(1)]);
 close();expect(leases.every(l=>l.closed)).toBe(true);
 const count=states.length;leases[1].take({ok:{rows:[{entry:id(2)}]}});expect(states).toHaveLength(count);
});
test('each page is capped512 and graph leases are capped8 with explicit truncation',async()=>{
 const leases=[],states=[];
 const close=observeReferenceClosure((query,take)=>{leases.push(query());queueMicrotask(()=>take({ok:{rows:[]}}));return()=>{}},Array.from({length:5000},(_,n)=>id(n)),id(9),()=>true,s=>states.push(s));
 for(let n=0;n<20;n++)await tick();
 expect(leases).toHaveLength(8);expect(leases.every(l=>l.entries.length<=512)).toBe(true);expect(states.at(-1).limited).toBe(true);close();
});

test('a pending earlier root page cannot block another held root page',async()=>{
 const leases=[],states=[];
 const close=observeReferenceClosure((query,take)=>{leases.push({query:query(),take});return()=>{}},Array.from({length:513},(_,n)=>id(n)),id(9),()=>true,s=>states.push(s));
 await tick();expect(leases).toHaveLength(2);
 leases[1].take({ok:{rows:[{entry:id(512)}]}});expect(states.at(-1).rows.map(r=>r.entry)).toEqual([id(512)]);expect(states.at(-1).phase).toBe('loading');close();
});

test('duplicate and missing fanout cannot multiply the held traversal queue',async()=>{
 const states=[],leases=[];
 const close=observeReferenceClosure((q,t)=>{leases.push({q:q(),t});return()=>{}},[id(1),id(2)],id(9),()=>true,s=>states.push(s));
 const fanout=Array.from({length:10000},(_,n)=>({ref:{entry:n%2?id(2):id(999)}}));
 leases[0].t({ok:{rows:[{entry:id(1),record:{items:fanout}},{entry:id(2),record:{items:fanout}}]}});await tick();
 expect(states.at(-1).rows.map(r=>r.entry).sort()).toEqual([id(1),id(2)]);
 expect(leases[1].q.entries).toEqual([id(999)]);close();
});
test('reference depth beyond eight discovery waves is explicit limited state',async()=>{
 const states=[];let calls=0;
 const close=observeReferenceClosure((q,t)=>{const entry=q().entries[0];calls++;queueMicrotask(()=>t({ok:{rows:[{entry,record:{files:[id(parseInt(entry,16)+1)]}}]}}));return()=>{}},[id(1)],id(9),()=>true,s=>states.push(s));
 for(let i=0;i<20;i++)await tick();expect(calls).toBe(8);expect(states.at(-1).limited).toBe(true);close();
});
