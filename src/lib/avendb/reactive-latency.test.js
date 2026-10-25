// @ts-nocheck — Bun runtime fixture, matching adjacent reactive-read tests.
import { expect, test } from 'bun:test';
import { beginReactiveTiming } from './reactive-latency.js';
import { createReactiveRead } from './reactive-read.js';
const tick = () => new Promise(r => setTimeout(r, 0));

test('clock spans empty and refused replies; readonly useful result is not completeness', () => {
 let now = 100; const samples = [];
 const emitted = beginReactiveTiming({op:'query', secret:'private'}, {now:()=>now,journal:{record:(...s)=>samples.push(s)}});
 emitted({ok:{rows:[]}}); now=200; emitted({refused:'denied'}); now=450;
 emitted({ok:{rows:[{entry:'private',record:{secret:'private'},readOnly:true}]}});
 now=900; emitted({ok:{rows:[{}]}});
 expect(samples).toEqual([['query.first-result-emission',0],['query.first-nonempty-emission',350],['query.first-nonempty-emission.readonly',350]]);
 expect(JSON.stringify(samples)).not.toContain('private');
});

test('reactive timing occurs after successful consumer publication, never stale or closed answers', async () => {
 const order=[], pending=[];
 const reader=createReactiveRead({read:()=>new Promise(resolve=>pending.push(resolve)),take:()=>order.push('consumer'),timing:()=>()=>order.push('timing')});
 const owner={}; reader.update({op:'query',where:'old'},owner);
 reader.update({op:'query',where:'new'},owner);
 pending[0]({ok:{rows:[{}]}}); await tick(); expect(order).toEqual([]);
 pending[1]({ok:{rows:[{}]}}); await tick(); expect(order).toEqual(['consumer','timing']);
 reader.update({op:'query',where:'last'},owner); reader.close(); pending[2]({ok:{rows:[{}]}});await tick();
 expect(order).toEqual(['consumer','timing']);
});

test('failed consumer does not report a successfully emitted result',async()=>{
 let measured=false;
 const reader=createReactiveRead({read:async()=>({ok:{rows:[{}]}}),take:()=>{throw Error('consumer');},timing:()=>()=>{measured=true;}});
 reader.update({op:'query'},{}); await tick(); reader.close(); expect(measured).toBe(false);
});

test('non-query operations do not pretend to measure query readiness',()=>{
 const samples=[];
 beginReactiveTiming({op:'network'},{journal:{record:(...s)=>samples.push(s)}})({ok:{rows:[{}]}});
 expect(samples).toEqual([]);
});

 test('scoped inventories distinguish initial empty from later useful state and retain no identities',()=>{
 let now=10; const samples=[];
 const emit=beginReactiveTiming({op:'entry_views',vault:'private'}, {now:()=>now,journal:{record:(...s)=>samples.push(s)}});
 emit({refused:'private'}); emit({ok:null}); now=30; emit({ok:{rows:[]}});
 now=80; emit({ok:{rows:[{entry:'private',readOnly:true}]}}); now=100; emit({ok:{rows:[{}]}});
 expect(samples).toEqual([['entry_views.first-result-emission',20],['entry_views.first-nonempty-emission',70],['entry_views.first-nonempty-emission.readonly',70]]);
 expect(JSON.stringify(samples)).not.toContain('private');
 });
