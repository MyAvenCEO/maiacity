// @ts-nocheck
import { expect, test } from 'bun:test';
import { createReactiveRead } from './reactive-read.js';
const tick = () => new Promise(r => setTimeout(r, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b}); return {promise,resolve,reject}; };
function fixture() {
 const pending=[],shown=[],failed=[];
 const reader=createReactiveRead({read:(owner,op)=>{const d=deferred();pending.push({...d,owner,op});return d.promise},take:x=>shown.push(x),failed:e=>failed.push(e.message)});
 return {reader,pending,shown,failed};
}
test('revisions coalesce without starving completed authorized answers',async()=>{
 const f=fixture(),d={};
 f.reader.update({op:'get',entry:'one'},d);await tick();
 for(let i=0;i<20;i++)f.reader.update({op:'get',entry:'one'},d);
 expect(f.pending.length).toBe(1);
 f.pending[0].resolve({ok:'first'});await tick();
 expect(f.shown).toEqual([{ok:'first'}]);expect(f.pending.length).toBe(2);
 f.pending[1].resolve({ok:'newest'});await tick();expect(f.shown).toEqual([{ok:'first'},{ok:'newest'}]);f.reader.close();
});
test('A to B to A invalidates earlier success and error without rejecting future results',async()=>{
 for(const error of [false,true]){
  const f=fixture(),d={};f.reader.update({op:'get',entry:'A'},d);await tick();
  f.reader.update({op:'get',entry:'B'},d);f.reader.update({op:'get',entry:'A'},d);
  error?f.pending[0].reject(Error('old')):f.pending[0].resolve({ok:'old'});
  await tick();expect(f.shown).toEqual([]);expect(f.failed).toEqual([]);
  f.pending[2].resolve({ok:'current'});await tick();expect(f.shown).toEqual([{ok:'current'}]);f.reader.close();
 }
});
test('removed query, changed owner/context and closed view reject in-flight data',async()=>{
 for(const kind of ['remove','owner','context','close']){
  const f=fixture(),d={},op={op:'query',type:'todo'};f.reader.update(op,d,'first');await tick();
  if(kind==='remove')f.reader.update(null,d,'first');
  if(kind==='owner')f.reader.update(op,{},'first');
  if(kind==='context')f.reader.update(op,d,'other');
  if(kind==='close')f.reader.close();
  f.pending[0].resolve({ok:'stale'});await tick();expect(f.shown).toEqual([]);f.reader.close();
  for(const p of f.pending.slice(1))p.resolve({ok:'end'});
 }
});
test('current read refusal passes through; current errors are reported',async()=>{
 const f=fixture(),d={};f.reader.update({op:'get',entry:'one'},d);await tick();
 f.pending[0].resolve({refused:'NoCap'});await tick();expect(f.shown).toEqual([{refused:'NoCap'}]);
 f.reader.update({op:'get',entry:'one'},d);await tick();f.pending[1].reject(Error('read failed'));await tick();expect(f.failed).toEqual(['read failed']);f.reader.close();
});

test('new query does not wait behind an unresolved old query',async()=>{
 const f=fixture(),d={};f.reader.update({op:'get',entry:'A'},d);await tick();
 f.reader.update({op:'get',entry:'B'},d);await tick();expect(f.pending.length).toBe(2);
 f.pending[1].resolve({ok:'B'});await tick();expect(f.shown).toEqual([{ok:'B'}]);
 f.pending[0].resolve({ok:'A'});await tick();expect(f.shown).toEqual([{ok:'B'}]);f.reader.close();
});

test('a mutating query is refused before invoking any device operation',async()=>{
 const f=fixture();f.reader.update({op:'insert',entry:'room'},{});await tick();
 expect(f.pending).toEqual([]);expect(f.shown).toEqual([]);
 expect(f.failed).toEqual(['An avenDB observer accepts read operations only.']);f.reader.close();
});
