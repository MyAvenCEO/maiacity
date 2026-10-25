// @ts-nocheck — Bun fixtures intentionally inject browser and engine boundaries.
import {test,expect} from 'bun:test';
import {createDiagnosticRunner,peerDiagnostics,diagnosticSnapshot} from './diagnostics-report.js';
import {runNetworkDiagnostics} from './network-diagnostics.js';
import {createLatencyJournal} from './latency-journal.js';
import {failureClass} from './local-timings.js';
test('locked collection never calls the engine and has honest missing observations',async()=>{
 const ops=[];const r=createDiagnosticRunner({ask:async o=>ops.push(o),currentOwner:()=>null,isOpen:()=>false,snapshot:()=>({}),network:async()=>({status:'offline'}),armReactive:()=>{throw Error('not allowed')}});
 await r.run();await r.capture();expect(ops).toEqual([]);expect(r.snapshot().run.engine.reason).toBe('locked');
});
test('run and subsequent copy capture use only safe fixed operations and redact peer data',async()=>{
 const owner={},ops=[];let armed=0;
 const r=createDiagnosticRunner({ask:async o=>{ops.push(o.op);return {ok:{enabled:true,peers:[{device:'secret',paths:[{selected:true,rtt_ms:12,address:'secret'}]}]}}},currentOwner:()=>owner,isOpen:()=>true,snapshot:()=>({}),network:async()=>({status:'offline'}),armReactive:()=>armed++});
 await r.run();await r.capture();expect(ops).toEqual(['measure_peer_policy','measure_peer_visibility','world_summary','network','perf','network','perf']);expect(armed).toBe(1);expect(JSON.stringify(r.snapshot())).not.toContain('secret');
});
test('session change during a probe prevents subsequent access to the old owner',async()=>{
 let owner={};const ops=[];
 const r=createDiagnosticRunner({ask:async o=>{ops.push(o.op);owner={};return{ok:{enabled:true}}},currentOwner:()=>owner,isOpen:()=>true,snapshot:()=>({}),network:async()=>({}),armReactive:()=>{throw Error('stale')}});
 await r.run();expect(ops).toEqual(['measure_peer_policy']);
});
test('network transfer bounds and strict range checking never claim payload speed',async()=>{
 const options=[];const report=await runNetworkDiagnostics({origin:'https://maia.city',fetcher:async(url,opt)=>{options.push(opt); if(url.pathname==='/release.json')return Response.json({kind:'maia.city release v1',commit:'a'.repeat(40),files:{['_app/immutable/assets/avendb_browser_bg-abc.wasm']:'b'.repeat(64)}});if(url.origin==='https://maia.city')return new Response('ignored range',{status:200});return new Response(new Uint8Array(2));}});
 expect(report.results.find(r=>r.kind==='maia-download').reason).toBe('http-or-range-unavailable');expect(report.results.find(r=>r.kind==='download').mbps).toBe(null);expect(options.every(o=>o.credentials==='omit'&&o.referrerPolicy==='no-referrer')).toBe(true);
});
test('cancelled probe does not start requests',async()=>{const c=new AbortController();c.abort();const r=await runNetworkDiagnostics({signal:c.signal,origin:'https://maia.city',fetcher:()=>{throw Error('unexpected')}});expect(r.results).toEqual([]);});
test('oldest unlock landmarks survive noisy calls and reload, failure codes exclude text',()=>{
 const store=new Map(),storage=()=>({getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)});
 const j=createLatencyJournal({storage,schedule:()=>{}});for(let i=0;i<12;i++){j.record('unlock.total',i);for(let n=0;n<130;n++)j.record('call.read_file',1,'failed',failureClass(Error('private content')));}j.flush();
 const restored=createLatencyJournal({storage}).snapshot();expect(restored.milestones.length).toBe(8);expect(restored.milestones[0].ms).toBe(0);expect(restored.samples.at(-1).reason).toBe('failed');expect(JSON.stringify(restored)).not.toContain('private content');
});
test('explicit run supersedes pending background capture without duplicate engine reads',async()=>{
 const owner={},ops=[];let complete,net=0;
 const r=createDiagnosticRunner({ask:o=>{ops.push(o.op);return new Promise(resolve=>complete=resolve)},currentOwner:()=>owner,isOpen:()=>true,snapshot:()=>({}),network:async()=>{net++;return{}},armReactive:()=>{}});
 const capture=r.capture();await Promise.resolve();await r.run();await capture;
 expect(net).toBe(1);expect(ops).toEqual(['network']);expect(r.snapshot().run.status).toBe('finished');complete({ok:{}});
});

test('copied report retains bounded manifest stages without exporting identities',()=>{
 const report=diagnosticSnapshot({manifests:{pending:0,runs:[{ms:12,requested:0,state:'scheduled',catalog:'local',heldManifests:2,matchedLeaves:1,queryLeaves:1,typeDiscoveryHints:1,localRows:0,route:'private-route',vault:'private-vault'}]}});
 expect(report.manifests.runs[0]).toMatchObject({requested:0,heldManifests:2,typeDiscoveryHints:1,localRows:0});
 expect(JSON.stringify(report)).not.toContain('private-');
});

test('copied core phases preserve slow refresh evidence but exclude arbitrary labels and values',()=>{
 const sample={count:3,total_ms:9000,mean_ms:3000,max_ms:4500};
 const report=peerDiagnostics({}, {timers:{refresh:sample,'show: cap groups':sample,
  'private entry name':sample,upkeep:{...sample,max_ms:Infinity},read:{...sample,count:-1}},
  held:{secret:'private account'}});
 expect(report.localWork.status).toBe('captured');
 expect(report.localWork.timers.refresh).toEqual(sample);
 expect(Object.keys(report.localWork.timers)).toEqual(['refresh','show: cap groups']);
 expect(JSON.stringify(report)).not.toContain('private');
 expect(peerDiagnostics({},null).localWork.status).toBe('unavailable');
});
