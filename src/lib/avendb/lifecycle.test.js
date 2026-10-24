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

describe('persistent restart event history', () => {
 const store = (map) => () => ({getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value)});
 function durable(journal, session = new Map(), clock = () => 0, worker) {
  const page = new EventTarget(), doc = Object.assign(new EventTarget(), {visibilityState:'visible'});
  return {page, doc, recorder: createLifecycle({storage:store(session), journalStorage:store(journal), page, doc, now:clock, serviceWorker:worker})};
 }
 test('retains unlock-to-open and explicit app reload evidence after session storage is lost', () => {
  const kept = new Map(); let ms = 100;
  const first = durable(kept, new Map(), () => ms);
  first.recorder.note('unlocking'); ms = 1100; first.recorder.note('passkey-finished');
  ms = 2100; first.recorder.note('open'); ms = 3100; first.recorder.note('app-reload-request');
  const next = durable(kept); const report = next.recorder.snapshot();
  expect(report.previous).toBeNull();
  expect(report.events.find(e => e.event === 'app-reload-request')).toEqual({document:1, ms:3000, event:'app-reload-request', phase:'open', visibility:'visible'});
  expect(report.events.at(-1).document).toBe(2);
  expect(report.events.filter(e => e.event === 'document-start')).toHaveLength(2);
 });
 test('enumerates locks, history, persisted page transitions and worker failures independently', () => {
  const f = durable(new Map()); f.recorder.note('open');
  f.recorder.note('session-lock-request'); f.recorder.note('locked');
  f.page.dispatchEvent(new Event('popstate'));
  f.page.dispatchEvent(Object.assign(new Event('pageshow'), {persisted:true}));
  f.recorder.note('worker-failed');
  f.page.dispatchEvent(Object.assign(new Event('error'), {message:'private contents', filename:'https://secret/route'}));
  const report = f.recorder.snapshot();
  expect(report.current.documents).toBe(1);
  expect(report.events.map(e => e.event)).toEqual(expect.arrayContaining(['session-lock-request','locked','history-pop','pageshow-persisted','worker-failed','page-error']));
  expect(JSON.stringify(report)).not.toContain('private'); expect(JSON.stringify(report)).not.toContain('secret');
 });
 test('bounds persisted events and strips untrusted extra properties on restoration', () => {
  const kept = new Map(); kept.set('avendb:lifecycle-events:v1', JSON.stringify({version:1, events:[{document:1, ms:0, event:'open', phase:'open', visibility:'visible', credential:'SECRET'}, {document:1, ms:0, event:'SECRET'}]}));
  const f = durable(kept); f.recorder.start();
  for (let i = 0; i < 200; i++) f.recorder.note('route-navigation');
  f.recorder.note('SECRET');
  expect(f.recorder.snapshot().events).toHaveLength(64);
  expect(JSON.stringify([...kept.values()])).not.toContain('SECRET');
  expect(kept.get('avendb:lifecycle-events:v1').length).toBeLessThan(16384);
 });
 test('observes service worker controller and lifecycle without script URLs', async () => {
  const active = Object.assign(new EventTarget(), {state:'activated', scriptURL:'https://private'});
  const registration = Object.assign(new EventTarget(), {active, waiting:null, installing:null});
  const sw = Object.assign(new EventTarget(), {controller:active, getRegistrations:async () => [registration]});
  const f = durable(new Map(), new Map(), () => 0, sw); f.recorder.start();
  await new Promise(r => setTimeout(r, 0));
  sw.dispatchEvent(new Event('controllerchange')); active.state = 'redundant'; active.dispatchEvent(new Event('statechange'));
  expect(f.recorder.snapshot().events.map(e => e.event)).toEqual(expect.arrayContaining(['sw-controlled','sw-activated','sw-controller-change','sw-redundant']));
  expect(JSON.stringify(f.recorder.snapshot())).not.toContain('private');
 });
 test('denied durable storage and throwing service worker discovery do not interrupt startup', async () => {
  const sw = Object.assign(new EventTarget(), {controller:null, getRegistrations:() => {throw Error('denied')}});
  const f = createLifecycle({storage:store(new Map()), journalStorage:() => {throw Error('denied')}, page:new EventTarget(), doc:Object.assign(new EventTarget(),{visibilityState:'visible'}), serviceWorker:sw});
  expect(() => f.note('open')).not.toThrow(); await new Promise(r => setTimeout(r,0));
  expect(f.snapshot()).toMatchObject({journalAvailable:false,current:{phase:'open'}});
 });
});
