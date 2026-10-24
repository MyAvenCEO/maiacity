/** Real local-write completion and reactive DOM, synthetic worker/passkey boundary. See fixtures/local-write/CONTRACT.md.
 * bun scripts/test-avendb-local-write.mjs --browser chromium|webkit
 * No account, live store, network peer or secret is used. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
const { chromium, webkit } = await import(process.env.AVENDB_TEST_PLAYWRIGHT || 'playwright');
const at = process.argv.indexOf('--browser');
const engine = at < 0 ? 'chromium' : process.argv[at + 1];
assert(['chromium', 'webkit'].includes(engine));
const collectionAt = process.argv.indexOf('--collection');
const collectionView = collectionAt < 0 ? '' : process.argv[collectionAt + 1];
assert(!collectionView || ['sparks','artifacts'].includes(collectionView));
const detailAt = process.argv.indexOf('--detail');
const detailView = detailAt < 0 ? '' : process.argv[detailAt + 1];
assert(!detailView || ['story','note'].includes(detailView));
const worldView = process.argv.includes('--world-view');
const coldChat = process.argv.includes('--cold-chat');
const dmReuse = process.argv.includes('--dm-reuse');
const remote = `
const entry = 'a'.repeat(64), mine = 'b'.repeat(64);
const messages = [], waiters = [];
let status='open';
let revision = 0;
let serial = Promise.resolve();
window.fixtureOperations = [];
const counts = window.fixtureCounts = { brings: 0, writes: 0, worlds: 0, activeWorlds:0, maxWorlds:0 };
const world = { mine, vaults:[{id:mine,name:'Fixture',kind:'human',acting:{as:mine},devices:[]}],
 shares:[], groups:[], entries:[{entry:'c'.repeat(64),vault:mine,by:mine,authors:[mine],type:'custom-task-label',kind:'todo',title:'Generic collection acceptance',status:'open',tags:[],readers:[mine],writers:[mine],sharers:[mine],levels:{[mine]:'owner'}},{entry,vault:mine,type:'room',kind:'room',readers:[mine],record:{kind:'room',look:'self',name:'Fixture'}}] };
if(new URLSearchParams(location.search).has('dm-reuse')){
 world.vaults.push({id:'f'.repeat(64),name:'Friend',kind:'human',devices:[]});
 for(let i=1;i<=51;i++)world.entries.push({entry:i.toString(16).padStart(64,'0'),vault:mine,type:'room',readers:[mine,i===51?'f'.repeat(64):'other'],record:{kind:'room',look:'dm',name:i===51?'Existing friend DM':'Other DM '+i}});
}
const collectionKind = new URLSearchParams(location.search).get('collection');
if(collectionKind){
 const type=collectionKind==='sparks'?'spark':'artifact';
 const make=(id,title,vault=mine,extra={})=>({entry:id.repeat(64),vault,by:mine,authors:[mine],type,kind:type==='spark'?'note':'record',title,text:'',created:1,tags:[],readers:[mine],writers:[mine],sharers:[mine],levels:{[mine]:'owner'},record:type==='spark'?{kind:'spark',title,items:[]}:{kind:'artifact',title,look:'link',url:'https://example.test/'},...extra});
 world.entries.push(make('d','Collection seed'),make('e','Other vault entry','f'.repeat(64)),make('9','Hidden entry',mine,{readers:[],writers:[]}));
 if(type==='spark')world.entries.push(make('7','Legacy note',mine,{type:'note'}));
 world.vaults.push({id:'f'.repeat(64),name:'Other vault',kind:'coop',devices:[]});
 window.fixtureCollectionRemote=(patch)=>{Object.assign(world.entries.find(e=>e.entry==='d'.repeat(64)),patch);wake();};
 window.fixtureCollectionAdd=()=>{world.entries.push(make('8','New collection entry'));wake();};
 window.fixtureCollectionRevoke=()=>{for(const e of world.entries)if(e.vault===mine)e.readers=[];wake();};
 window.fixtureCollectionReadOps=[];
}
const detailKind = new URLSearchParams(location.search).get('detail');
if(detailKind){
 const make=(id,title)=>({entry:id.repeat(64),vault:mine,type:detailKind,kind:'note',title,text:'Body',tags:[],readers:[mine],writers:[mine],sharers:[mine],record:{kind:detailKind==='story'?'story':'document',title,text:'Body'}});
 world.entries.push(make('d','Detail seed'),make('e','Other detail'));
 window.fixtureDetailRefuse=()=>{window.detailRefused=true;wake();};
 window.fixtureDetailRemote=title=>{const e=world.entries.find(e=>e.entry==='d'.repeat(64));e.title=e.record.title=title;wake();};
}
const wake = () => { revision++; if(!window.fixtureMuteWake) for(const resolve of waiters.splice(0)) resolve(true); };
window.fixtureManyRooms = () => {for(let i=1;i<=51;i++)world.entries.push({entry:i.toString(16).padStart(64,'0'),vault:mine,type:'room',readers:[mine],record:{kind:'room',look:'channel',name:'Room '+i}});wake();};
window.fixtureRemoteStatus = next => {status=next;world.entries[0].status=next;wake();};
window.fixtureRevokeTodo = () => {world.entries[0].readers=[];world.entries[0].writers=[];wake();};
window.fixtureRemote = text => { messages.push({id:messages.length+1,text,at:Date.now(),by:{vault:mine},actor:mine});wake(); };
window.fixtureHoldWorld = new URLSearchParams(location.search).has('cold-chat');
window.fixtureReleaseWorld = () => { window.fixtureHoldWorld = false; for(const resolve of (window.worldWaiters ?? []).splice(0)) resolve(); };
const meta={name:'Synthetic fixture',credential:'fixture',nonce:'01'.repeat(32)};
export const load=async()=>{};
export const openStore=async()=>({hold:async()=>{},release:async()=>{}});
export const storeMeta=async()=>({...meta});
export const prfSalt=async()=>new Uint8Array(32);
export const deviceSalt=async()=>new Uint8Array(32);
export class Device {
 static async open(){return new Device();}
 async size(){return [revision,0];}
 async changed(edits){return edits!==revision?true:new Promise(r=>waiters.push(r));}
 async moving(){return null;}
 async run(op){
  if(!window.fixtureSerial)return this.runNow(op);
  window.fixtureOperations.push(op.op);
  const result=serial.then(()=>this.runNow(op));
  serial=result.catch(()=>{});
  return result;
 }
 async runNow(op){
  if(op.op==='world'){counts.worlds++;counts.activeWorlds++;counts.maxWorlds=Math.max(counts.maxWorlds,counts.activeWorlds);try{const snapshot={...structuredClone(world),marker:window.fixtureWorldVersion??0};if(window.fixtureHoldWorld)await new Promise(r=>(window.worldWaiters??=[]).push(r));return {ok:snapshot};}finally{counts.activeWorlds--;}}
  if(op.op==='query'){
   if(window.fixtureQueryRefuse)return {refused:'NoCap',why:'NoCap'};
   const rows=window.fixtureRoomDenied?[]:structuredClone(world.entries.filter(e=>e.type==='room'));
   const look=op.where?.all?.find(part=>part.path?.[0]==='look')?.eq;
   const selected=rows.filter(e=>(!op.vault || e.vault===op.vault) && (!look || e.record?.look===look));
   const reply={ok:{rows:selected.slice(op.offset??0,(op.offset??0)+(op.limit??50)),count:selected.length}};
   if(window.fixtureHoldQuery)await new Promise(resolve=>(window.queryWaiters??=[]).push(resolve));
   return reply;
  }
  if(op.op==='entry_views'){
   window.fixtureCollectionReadOps?.push(structuredClone(op));
   if(window.fixtureRoomDenied)return {ok:{rows:[],totalEntries:0,readableEntries:0}};
   if(window.fixtureCollectionRefuse)return {refused:'NoCap',why:'NoCap'};
   const all=world.entries.filter(e=>op.entries ? op.entries.includes(e.entry) : e.vault===op.vault), actor=op.as??op.vault;
   const result={ok:{rows:structuredClone(all.filter(e=>(!op.types || op.types.includes(e.type)) && (!op.kind || e.kind===op.kind))),totalEntries:all.length,readableEntries:all.filter(e=>e.public || e.readers?.includes(actor)).length}};
   if(window.fixtureHoldCollection && op.vault===mine)await new Promise(resolve=>(window.collectionWaiters??=[]).push(resolve));
   return result;
  }
  if(op.op==='note'){
   if(window.detailRefused)return {refused:'NoCap',why:'NoCap'};
   const e=world.entries.find(e=>e.entry===op.entry);
   if(!e)return {ok:null};
   return {ok:{vault:e.vault,entry:e.entry,kind:e.record?.kind,lines:[{line:null,name:null,heads:[],history:[],title:e.title,text:e.text,record:e.record,blocks:[],base:null,conflicts:null}],edits:[]}};
  }
  if(op.op==='history')return {ok:{edits:[]}};
  if(op.op==='room' && window.fixtureRoomDenied)return {refused:'NoCap',why:'NoCap'};
  if(op.op==='room'){const row=world.entries.find(e=>e.entry===op.entry);return {ok:row?{entry:op.entry,room:{...row.record,messages:op.entry===entry?structuredClone(messages):[]},count:op.entry===entry?messages.length:0}:null};}
  if(op.op==='bring'){counts.brings++;return new Promise(()=>{});}
  if(op.op==='get')return {ok:{status,record:world.entries.find(e=>e.entry===op.entry)?.record??{}}};
  if(op.op==='set'){const target=world.entries.find(e=>e.entry===op.entry);if(target){target[op.path[0]]=op.value;if(target.record)target.record[op.path[0]]=op.value;}status=op.value;wake();return {ok:true};}
  if(op.op==='create'){counts.writes++;return {ok:{entry:'9'.repeat(64)}};}
  if(op.op==='may')return {ok:op.ops.map(()=>true)};
  if(op.op==='creatable')return {ok:{tags:[]}};
  if(op.op==='taggable')return {ok:{tags:[]}};
  if(op.op==='insert' && window.fixtureRefuse)return {refused:'NoCap',why:'NoCap'};
  if(op.op==='insert'){counts.writes++;messages.push({...op.value,by:{vault:mine},actor:mine});wake();return {ok:{entry}};}
  return {ok:null};
 }
 async close(){}
}`;
const passkey = `export const ceremonies=()=>({unlock:async()=>{return {}},sign:async()=>{throw Error('unexpected signing')}});`;
let server, browser;
try {
 server = await createServer({ optimizeDeps: { noDiscovery:true, entries:[] },
   server: { host:'127.0.0.1', port:0, strictPort:false, fs:{allow:['scripts/fixtures/local-write']} },
   plugins:[{name:'local-write-fixture', configureServer(s){s.middlewares.use((req,res,next)=>{
     if(req.url?.split('?')[0]!=='/__local-write')return next();
     res.setHeader('Content-Type','text/html');
     res.end('<!doctype html><html><body><script type="module" src="/scripts/fixtures/local-write/main.js"></script></body></html>');
   });}}] });
 await server.listen();
 const address=server.httpServer.address();
 assert(address && typeof address==='object');
 const origin=`http://127.0.0.1:${address.port}`;
 const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
 browser=await (engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,
   executablePath:process.env.AVENDB_CHROMIUM || (existsSync(chrome)?chrome:undefined)}));
 const context=await browser.newContext();
 await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/src/lib/avendb/remote.js')return route.fulfill({contentType:'text/javascript',body:remote});
   if(url.pathname==='/src/lib/avendb/device/passkey.js')return route.fulfill({contentType:'text/javascript',body:passkey});
   return route.continue();
 });
 const page=await context.newPage();
 page.setDefaultTimeout(20000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__local-write?room='+ 'a'.repeat(64)+(worldView?'&world-view':'')+(collectionView?'&collection='+collectionView:'')+(detailView?'&detail='+detailView:'')+(coldChat?'&cold-chat':'')+(dmReuse?'&dm-reuse':''));
 await page.getByTestId('phase').filter({hasText:'closed'}).waitFor();
 await page.getByRole('button',{name:'Unlock fixture'}).click();
 await page.getByTestId('phase').filter({hasText:'open'}).waitFor();
 if(dmReuse){
  await page.getByRole('button',{name:'More rooms',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Existing friend DM',exact:true}).count(),0);
  await page.getByRole('button',{name:'New message',exact:true}).first().click();
  await page.getByRole('button',{name:'Friend Human vault',exact:true}).click();
  await page.locator('.room-head h2').filter({hasText:'Existing friend DM'}).waitFor({timeout:1500});
  assert.equal(await page.evaluate(()=>window.fixtureCounts.writes),0);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': actual Chat reuses a DM beyond its sidebar page without a write');
 } else if(coldChat){
  await page.getByRole('button',{name:'Note to self',exact:true}).waitFor({timeout:1500});
  await page.getByText('No messages yet. Say hello.',{exact:true}).waitFor({timeout:1500});
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  assert.equal(await page.evaluate(()=>window.fixtureSession.world),null);
  await page.evaluate(()=>window.fixtureRemote('Cold local message'));
  await page.getByText('Cold local message',{exact:true}).waitFor({timeout:1500});
  await page.evaluate(()=>window.fixtureManyRooms());
  await page.getByRole('button',{name:'More rooms',exact:true}).click();
  await page.getByRole('button',{name:'# Room 51',exact:true}).waitFor({timeout:1500});
  await page.getByText('Cold local message',{exact:true}).waitFor({timeout:1500});
  await page.getByRole('button',{name:'Previous rooms',exact:true}).click();
  await page.evaluate(()=>{window.fixtureQueryRefuse=true;window.fixtureRemoteStatus('changed');});
  await page.getByRole('alert').filter({hasText:'Rooms could not be read'}).waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureQueryRefuse=false;window.fixtureRoomDenied=true;window.fixtureRemoteStatus('changed again');});
  await page.getByText('Cold local message',{exact:true}).waitFor({state:'hidden',timeout:1500});
  await page.getByText('No rooms held on this device yet.',{exact:true}).waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureRoomDenied=false;window.fixtureRemoteStatus('restored');});
  await page.getByText('Cold local message',{exact:true}).waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureHoldQuery=true;window.fixtureRemoteStatus('old pending query');});
  await page.waitForFunction(()=>(window.queryWaiters??[]).length>0);
  await page.evaluate(()=>window.fixtureSession.lock());
  await page.getByTestId('phase').filter({hasText:'closed'}).waitFor();
  await page.evaluate(()=>{window.fixtureHoldQuery=false;window.fixtureRoomDenied=true;for(const done of window.queryWaiters.splice(0))done();});
  await page.getByRole('button',{name:'Unlock fixture'}).click();
  await page.getByTestId('phase').filter({hasText:'open'}).waitFor();
  await page.getByText('No rooms held on this device yet.',{exact:true}).waitFor({timeout:1500});
  assert.equal(await page.getByText('Cold local message',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': cold Chat room discovery and content before first world snapshot');
 } else if(detailView){
  const title=detailView==='story'?page.getByLabel('Its title',{exact:true}):page.locator('input.title');
  await title.waitFor();
  assert.equal(await title.inputValue(),'Detail seed');
  await page.evaluate(()=>{window.fixtureHoldWorld=true;});
  await page.evaluate(()=>window.fixtureSession.run('Rename detail',{op:'set',entry:'d'.repeat(64),path:['title'],value:'Accepted detail title'}));
  await page.waitForFunction(()=>document.querySelector('input.title')?.value==='Accepted detail title',null,{timeout:1500});
  await page.evaluate(()=>window.fixtureDetailRemote('Remote detail title'));
  await page.waitForFunction(()=>document.querySelector('input.title')?.value==='Remote detail title',null,{timeout:1500});
  await title.fill('Unsubmitted detail draft');
  await page.evaluate(()=>window.fixtureDetailRemote('New remote detail title'));
  await page.waitForTimeout(250);
  assert.equal(await title.inputValue(),'Unsubmitted detail draft');
  await page.evaluate(()=>window.fixtureSwitchEntry('e'.repeat(64)));
  await page.waitForFunction(()=>document.querySelector('input.title')?.value==='Other detail',null,{timeout:1500});
  if(detailView==='note'){
   await page.evaluate(()=>window.fixtureDetailRefuse());
   await page.getByText('This browser holds no edit of this note',{exact:false}).waitFor({timeout:1500});
   assert.equal(await page.getByText('Opening the note…',{exact:true}).count(),0);
  }
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': actual '+detailView+' local and remote title with world held');
 } else if(collectionView){
  const rowTitle=text=>page.locator('li.row b').filter({hasText:new RegExp('^'+text+'$')});
  await rowTitle('Collection seed').waitFor();
  assert.equal(await rowTitle('Hidden entry').count(),0);
  if(collectionView==='sparks')await rowTitle('Legacy note').waitFor();
  const draft=page.getByPlaceholder(collectionView==='sparks'?'Write a thought, paste links, drop pictures':'Paste links, drop pictures or clips');
  await draft.fill('Unsubmitted capture draft');
  await page.evaluate(()=>{window.fixtureHoldWorld=true;});
  await page.evaluate(()=>window.fixtureSession.run('Rename collection entry',{op:'set',entry:'d'.repeat(64),path:['title'],value:'Accepted collection title'}));
  await rowTitle('Accepted collection title').waitFor({timeout:1500});
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  await page.evaluate(()=>window.fixtureCollectionRemote({title:'Remote collection title'}));
  await rowTitle('Remote collection title').waitFor({timeout:1500});
  assert.equal(await draft.inputValue(),'Unsubmitted capture draft');
  await page.evaluate(()=>window.fixtureCollectionAdd());
  await rowTitle('New collection entry').waitFor({timeout:1500});
  await page.evaluate(()=>window.fixtureCollectionRemote({deleted:true}));
  await rowTitle('Remote collection title').waitFor({state:'hidden',timeout:1500});
  await page.evaluate(()=>window.fixtureCollectionRemote({deleted:false}));
  await rowTitle('Remote collection title').waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureHoldCollection=true;window.fixtureCollectionRemote({title:'Late old vault title'});});
  await page.waitForFunction(()=>(window.collectionWaiters??[]).length>0);
  await page.evaluate(()=>window.fixtureSwitchVault('f'.repeat(64)));
  await rowTitle('Other vault entry').waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureHoldCollection=false;for(const done of window.collectionWaiters.splice(0))done();});
  assert.equal(await rowTitle('Late old vault title').count(),0);
  await page.evaluate(()=>{window.fixtureCollectionRemote({title:'Remote collection title'});window.fixtureSwitchVault('b'.repeat(64));});
  await rowTitle('Remote collection title').waitFor({timeout:1500});
  await page.evaluate(()=>{window.fixtureCollectionRefuse=true;window.fixtureCollectionRemote({tags:['changed']});});
  await page.getByRole('alert').waitFor();
  assert.equal(await rowTitle('Remote collection title').count(),0);
  await page.evaluate(()=>{window.fixtureCollectionRefuse=false;window.fixtureCollectionRemote({tags:[]});});
  await rowTitle('Remote collection title').waitFor({timeout:1500});
  await page.evaluate(()=>window.fixtureCollectionRevoke());
  await rowTitle('Remote collection title').waitFor({state:'hidden',timeout:1500});
  const reads=await page.evaluate(()=>window.fixtureCollectionReadOps);
  assert(reads.length>0);
  for(const op of reads){assert.equal(op.as,'b'.repeat(64));assert.deepEqual(op.types,collectionView==='sparks'?['spark','note']:['artifact']);if(collectionView==='sparks')assert.equal(op.kind,'note');}
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': actual '+collectionView+' local/remote/create/delete/revoke/context updates with world held');
 } else if(worldView){
  await page.getByText('Generic collection acceptance',{exact:true}).waitFor();
  await page.evaluate(()=>{window.fixtureHoldWorld=true;});
  await page.getByRole('button',{name:'Open',exact:true}).click();
  await page.getByRole('button',{name:'Doing',exact:true}).waitFor({timeout:1500});
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  await page.evaluate(()=>window.fixtureRemoteStatus('done'));
  await page.getByRole('button',{name:'Done',exact:true}).waitFor({timeout:1500});
  await page.evaluate(()=>window.fixtureRevokeTodo());
  await page.getByText('Generic collection acceptance',{exact:true}).waitFor({state:'hidden',timeout:1500});
  assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
  assert.deepEqual(errors,[]);
  console.log('PASS '+engine+': actual Todos reflects locally accepted change before blocked world summary');
 } else {
 await page.waitForSelector('textarea');
 await page.evaluate(()=>{window.fixtureBehind();window.fixtureHoldWorld=true;});
 await page.locator('textarea').first().fill('local message while peers unavailable');
 const started=Date.now();
 await page.locator('textarea').first().press('Enter');
 await page.getByText('local message while peers unavailable',{exact:true}).waitFor({timeout:1500});
 assert.equal(await page.evaluate(()=>window.fixtureCounts.writes),1);
 // Background freshness reads may also bring; only foreground completion is asserted.
 assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
 const localMs=Date.now()-started;
 await page.waitForFunction(()=>document.querySelector('textarea').value==='');
 const nonchat=await page.evaluate(async()=>{
  const result=await window.fixtureSession.run('Tick todo',{op:'set',entry:'c'.repeat(64),path:['status'],value:'done'});
  return {result,held:window.fixtureHoldWorld};
 });
 assert.deepEqual(nonchat,{result:true,held:true});
 await page.getByTestId('todo-status').filter({hasText:'done'}).waitFor({timeout:1500});
 await page.evaluate(()=>window.fixtureRefuse=true);
 await page.locator('textarea').first().fill('refused message stays draft');
 await page.locator('textarea').first().press('Enter');
 await page.waitForFunction(()=>window.fixtureSession.error.includes('Refused'));
 assert.equal(await page.locator('.msg').filter({hasText:'refused message stays draft'}).count(),0);
 assert.equal(await page.locator('textarea').first().inputValue(),'refused message stays draft');
 assert.equal(await page.evaluate(()=>window.fixtureCounts.writes),1);

 await page.evaluate(()=>window.fixtureRemote('remote accepted while world held'));
 await page.getByText('remote accepted while world held',{exact:true}).waitFor({timeout:1500});
 assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
 await page.evaluate(()=>window.fixtureReleaseWorld());
 await page.evaluate(async()=>{
  await window.fixtureSession.refresh();
  window.fixtureWorldVersion=1;
  window.fixtureHoldWorld=true;
  window.oldWorldRead=window.fixtureSession.refresh();
 });
 await page.waitForFunction(()=>(window.worldWaiters??[]).length>0);
 await page.evaluate(()=>{
  window.fixtureWorldVersion=2;
  window.newWorldFinished=false;
  window.newWorldRead=window.fixtureSession.refresh().then(()=>window.newWorldFinished=true);
 });
 assert.equal(await page.evaluate(()=>window.newWorldFinished),false);
 assert.equal(await page.evaluate(()=>window.fixtureCounts.activeWorlds),1);
 await page.evaluate(async()=>{window.fixtureReleaseWorld();await Promise.all([window.oldWorldRead,window.newWorldRead]);});
 assert.equal(await page.evaluate(()=>window.fixtureSession.world.marker),2);
 assert.equal(await page.evaluate(()=>window.fixtureCounts.maxWorlds),1);
 // A serialized engine cannot run a targeted read behind a held world query.
 // Suppress the independent remote-change wake: this exercises local acceptance's
 // own invalidation even when the engine change notification has not arrived yet.
 await page.evaluate(async()=>{await window.fixtureSession.refresh();});
 await page.waitForTimeout(400);
 await page.evaluate(()=>{
  window.fixtureSerial=true;window.fixtureMuteWake=true;
  window.fixtureOperations=[];window.fixtureHoldWorld=true;
  window.priorityWrite=window.fixtureSession.run('Update generic status',
   {op:'set',entry:'c'.repeat(64),path:['status'],value:'priority'});
 });
 try {
  await page.getByTestId('todo-status').filter({hasText:'priority'}).waitFor({timeout:1500});
 } catch(error) {
  console.error('Serialized operation dispatch order:',await page.evaluate(()=>window.fixtureOperations));
  throw error;
 }
 await page.waitForFunction(()=>window.fixtureOperations.includes('world'));
 const dispatch=await page.evaluate(()=>window.fixtureOperations);
 assert(dispatch.indexOf('get')>=0 && dispatch.indexOf('get')<dispatch.indexOf('world'),
  'generic targeted read must dispatch before background world: '+JSON.stringify(dispatch));
 assert.equal(await page.evaluate(()=>window.fixtureHoldWorld),true);
 await page.evaluate(async()=>{window.fixtureReleaseWorld();await window.priorityWrite;await window.fixtureSession.refresh();window.fixtureSerial=false;window.fixtureMuteWake=false;});
 // A captured-device explicit barrier must fail rather than let follow-up work
 // use a different account's world after a lock/replacement.
 await page.evaluate(()=>{
  window.fixtureHoldWorld=true;
  window.staleWorld=window.fixtureSession.refresh().then(()=>false,()=>true);
 });
 await page.waitForFunction(()=>(window.worldWaiters??[]).length>0);
 await page.evaluate(async()=>{await window.fixtureSession.lock();});
 assert.equal(await page.evaluate(()=>window.staleWorld),true);
 await page.evaluate(()=>window.fixtureReleaseWorld());
 assert.deepEqual(errors,[]);
 console.log('PASS '+engine+': actual Session renders accepted chat+non-chat local mutations, preserves refused draft, and remote messages before blocked world refresh; local browser harness '+localMs+'ms (synthetic device, not physical latency)');
 }
} finally {
 // Release deliberately held fake engine work before shutting down the local fixture server.
 for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
  await page.evaluate(() => window.fixtureReleaseWorld?.()).catch(() => {});
 }
 await browser?.close(); await server?.close();
}
