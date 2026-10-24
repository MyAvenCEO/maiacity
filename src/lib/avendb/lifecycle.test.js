// @ts-nocheck — synthetic event/storage boundaries for Bun.
import { describe, test, expect } from 'bun:test';
import { createLifecycle } from './lifecycle.js';
function fixture(kept = new Map(), fail = false, kind = 'navigate') {
 const page = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
 const storage = () => { if (fail) throw Error('private storage denied'); return {getItem:k=>kept.get(k)??null,setItem:(k,v)=>kept.set(k,v)}; };
 return { page, doc, kept, recorder: createLifecycle({storage,page,doc,navigation:()=>kind}) };
}
describe('bounded non-authoritative lifecycle evidence', () => {
 test('foreground new document preserves previous open/visible evidence without claiming a cause', () => {
  const a=fixture(); a.recorder.note('open');
  const b=fixture(a.kept,false,'reload'); const report=b.recorder.snapshot();
  expect(report.current.documents).toBe(2);
  expect(report.navigation).toBe('reload');
  expect(report.previous).toEqual({documents:1,phase:'open',visibility:'visible',exit:'none',workerFailures:0});
 });
 test('same-document navigation and explicit lock never count as reload', () => {
  const f=fixture(); f.recorder.start(); f.recorder.note('open'); f.recorder.start(); f.recorder.note('locked');
  expect(f.recorder.snapshot().current.documents).toBe(1);
  expect(f.recorder.snapshot().current.phase).toBe('locked');
 });
 test('pagehide and back-forward restore are observed without a new document', () => {
  const f=fixture(); f.recorder.note('open');
  f.doc.visibilityState='hidden'; f.doc.dispatchEvent(new Event('visibilitychange'));
  const event=new Event('pagehide'); event.persisted=true; f.page.dispatchEvent(event);
  expect(f.recorder.snapshot().current.exit).toBe('pagehide-persisted');
  f.doc.visibilityState='visible'; f.page.dispatchEvent(new Event('pageshow'));
  expect(f.recorder.snapshot().current).toMatchObject({documents:1,phase:'open',visibility:'visible',exit:'none'});
 });
 test('denied or malformed storage never prevents startup or records private strings', () => {
  const f=fixture(new Map(),true); expect(()=>f.recorder.note('open')).not.toThrow();
  const brokenNavigation=createLifecycle({storage:()=>({getItem:()=>null,setItem:()=>{}}),page:new EventTarget(),doc:Object.assign(new EventTarget(),{visibilityState:'visible'}),navigation:()=>{throw Error('not available')}});
  expect(()=>brokenNavigation.note('open')).not.toThrow();
  expect(brokenNavigation.snapshot().navigation).toBe('unknown');
  expect(f.recorder.snapshot()).toMatchObject({storageAvailable:false,current:{phase:'open'}});
  const g=fixture(); g.kept.set('avendb:lifecycle:v1',JSON.stringify({documents:90000,phase:'secret',private:'secret'}));
  g.recorder.start(); g.recorder.note('worker-failed'); g.recorder.note('SECRET');
  const serialized=JSON.stringify(g.recorder.snapshot())+JSON.stringify([...g.kept.values()]);
  expect(serialized).not.toContain('secret'); expect(serialized).not.toContain('SECRET');
  expect(g.recorder.snapshot().current.documents).toBe(9999);
  expect(g.recorder.snapshot().current.workerFailures).toBe(1);
 });
});
