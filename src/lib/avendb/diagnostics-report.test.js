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
 const named=diagnosticSnapshot({manifests:{pending:1,running:[{ms:40,state:'running',matched:['kernel','chat'],firstMs:1}],runs:[{ms:3,state:'scheduled',matched:['kernel','chat','/app/chat/','e'.repeat(64),'a'+'0'.repeat(20)],vaultManifests:1,builtInManifests:1}]}});
 expect(named.manifests.runs[0]).toMatchObject({matched:['kernel','chat'],vaultManifests:1,builtInManifests:1});
 expect(named.manifests.running[0]).toMatchObject({state:'running',matched:['kernel','chat'],firstMs:1});
 expect(JSON.stringify(report)).not.toContain('private-');
});

test('the report carries what a sync lacks of each peer and takes of it, as numbers and 8-hex ids alone', async () => {
 const { observeSync, emptySync } = await import('./sync-status.js');
 const hex = '36ee6eef' + 'a'.repeat(56);
 const sample = n => ({ log: `Entry(EntryId(${String(n).padStart(8, '0')}…))`, held: n % 2 === 0, lacked_heads: ['deadbeef', 'not hex', 'cafebabe1234'], waiting: 2 });
 // the device's `synced` answer, as the page's sync state keeps it (sync.svelte.js), with what a report must not copy
 const synced = { peers: 1, logs: 3090, behind: 2577, pulling: 1, pages: 40, edits: 812,
  from: [{ device: hex, name: "Samuel's Mac", address: '10.0.0.2:443', pulling: { since: 1000, stage: 'taking edits', took: 812 }, pages: 40, edits: 812, last: 1900 }],
  lacked: [{ device: '85b01be4', lacks: 2577, by_stub: 513, stubs: 900, address: 'secret', sample: Array.from({ length: 9 }, (_, n) => sample(n)) }],
  unsaved: { since: 1, tries: 2, error: 'secret path /Users/samuel' } };
 const sync = observeSync(emptySync(), synced, 2000);
 const report = diagnosticSnapshot({ phase: 'open', journal: null, lifecycle: null, manifests: null, sync, playback: null, device: 'iPhone' }).sync;
 expect(report).toMatchObject({ peers: 1, logs: 3090, behind: 2577, pulling: 1, pages: 40, edits: 812, base: 812, at: 2000 });
 expect(report.from).toEqual([{ device: '36ee6eef', reconnecting: false, pulling: { since: 1000, stage: 'taking edits', took: 812 }, pages: 40, edits: 812, last: 1900 }]);
 expect(report.lacked).toHaveLength(1);
 const [peer] = report.lacked;
 expect(peer).toMatchObject({ device: '85b01be4', lacks: 2577, byStub: 513, stubs: 900 });
 expect(peer.sample).toHaveLength(5);
 expect(peer.sample[0]).toEqual({ log: { kind: 'Entry', ids: ['00000000'] }, held: true, lackedHeads: ['deadbeef', 'cafebabe'], waiting: 2 });
 const text = JSON.stringify(report);
 for (const secret of ['Samuel', 'address', '10.0.0.2', 'secret', 'Users', 'a'.repeat(9)]) expect(text).not.toContain(secret);
 // an engine stage that isn't its own few words is not copied
 const odd = observeSync(sync, { ...synced, from: [{ ...synced.from[0], pulling: { since: 1, stage: 'GET https://x/y', took: 1 } }] }, 3000);
 expect(diagnosticSnapshot({ phase: 'open', sync: odd, device: 'iPhone' }).sync.from[0].pulling.stage).toBe('other');
});
