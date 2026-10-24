// @ts-nocheck
import { expect, test } from 'bun:test';
import { readAssetInventory } from './asset-inventory.js';
import { localNavigation, needsWorldEntries } from './startup-summary.js';
test('metadata-only #assets starts independent local recipe reads with world and peers withheld', async () => {
 const world = {entriesComplete:false, entries:[]}, vault='v', calls=[];
 const row = {entry:'recipe', type:'recipe', record:{title:'Fig'}, brought:[{edit:'version', files:[]}]};
 const metadata = {entry:'recipe', readers:['actor'], files:[]};
 const api={ask:async op=>{calls.push(op); if(op.op==='database')return {ok:{vault, rows:[row]}};
  if(op.op==='entry_views')return {ok:{rows:[metadata]}};
  throw Error('No world, bring, or network allowed');}};
 let route='home'; localNavigation(()=>{route='assets';},()=>new Promise(()=>{}));
 expect(needsWorldEntries(world,route)).toBe(false);
 const inventory=await readAssetInventory(api,vault);
 expect(inventory.db.rows).toEqual([row]); expect(inventory.entries).toEqual([metadata]);
 expect(calls).toEqual([{op:'database',vault,types:['recipe']},{op:'entry_views',vault,types:['recipe']}]);
 expect(world.entriesComplete).toBe(false);
});
test('refused or missing local inventories are errors rather than confirmed empty', async () => {
 for(const response of [{refused:'Locked'}, {ok:null}, {ok:{vault:'other',rows:[]}}]){
  await expect(readAssetInventory({ask:async()=>response},'v')).rejects.toThrow();
 }
});
