import {expect,test} from 'bun:test';
import {createReactiveObservation} from './reactive-observation.js';
const id=n=>n.toString(16).padStart(64,'0');
const row=n=>({entry:id(n),record:{secret:'never-send'},readOnly:false,observedRevision:{kind:'main-heads',heads:[id(n+100)],frontierComplete:true}});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('opt-in is owner-bound, expires and sends only complete main consumer provenance',async()=>{
 let now=0;const sent=[],owner={};const o=createReactiveObservation({now:()=>now});
 expect(o.query(owner,{op:'query'})).toEqual({op:'query'});
 o.arm(owner,async op=>sent.push(op));
 expect(o.query(owner,{op:'query'}).observeRevision).toBe(true);
 expect(o.query({}, {op:'query'}).observeRevision).toBeUndefined();
 o.emitted(owner,{ok:{rows:[row(1),{...row(2),readOnly:true}]}});await tick();
 expect(sent.length).toBe(1);expect(sent[0].rows.length).toBe(1);expect(JSON.stringify(sent)).not.toContain('secret');
 now=120001;o.emitted(owner,{ok:{rows:[row(3)]}});expect(sent.length).toBe(1);
});
test('one in-flight report plus at most64 coalesced pending rows',async()=>{
 const pending=[],owner={};const o=createReactiveObservation();
 o.arm(owner,op=>new Promise(resolve=>pending.push({op,resolve})));
 o.emitted(owner,{ok:{rows:[row(1)]}});
 for(let i=2;i<200;i++)o.emitted(owner,{ok:{rows:[row(i)]}});
 expect(pending.length).toBe(1);pending[0].resolve();await tick();
 expect(pending.length).toBe(2);expect(pending[1].op.rows.length).toBe(64);
 o.stop();pending[1].resolve();await tick();expect(pending.length).toBe(2);
});
