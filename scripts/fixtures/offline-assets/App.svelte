<script>
 import Assets from '../../../src/lib/avendb/Assets.svelte';
 import { bump } from './fake-session.svelte.js';
 import { createReadWindow } from '../../../src/lib/avendb/query-window.js';
 const vault='b'.repeat(64);
 const world={mine:vault,entriesComplete:false,entries:[],vaults:[{id:vault,name:'Offline fixture',kind:'human',devices:[]}],shares:[],groups:[]};
 let failed=false, row=false, mounted=$state(true);
 window.fixtureCalls=[];
 window.fixtureDemand=[];
 const device={run:async op=>{window.fixtureDemand.push(op);return {ok:{accepted:true,discovery_supported:true}};}};
 window.fixtureChange=mode=>{if(mode==='unmount'){mounted=false;return;}failed=mode==='failed';row=mode==='row';bump();};
 const api={ask:async op=>{
  window.fixtureCalls.push(op);
  if(failed)return {refused:'Unavailable',why:'Fixture local read failed'};
  if(op.op==='database')return {ok:{vault,rows:row?[{entry:'a'.repeat(64),type:'recipe',record:{title:'Incomplete fixture recipe'}}]:[]}};
  if(op.op==='entry_views')return {ok:{rows:row?[{entry:'a'.repeat(64),vault,type:'recipe',public:true,readers:[vault],files:[]}]:[]}};
  throw Error('Unexpected world/network/file read: '+op.op);
 },window:()=>createReadWindow({device:()=>device,read:(_,op)=>api.ask(op)})};
</script>
{#if mounted}
<Assets {world} {vault} actor={vault} {api} />
{/if}
