// @ts-nocheck
import { expect, test } from 'bun:test';
import { readAssetInventory } from './asset-inventory.js';
import { localNavigation, needsWorldEntries } from './startup-summary.js';
import { createReadWindow } from './query-window.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((w) => w.queries ?? []) : undefined };
test('metadata-only #assets starts independent local recipe reads with world and peers withheld', async () => {
 const world = {entriesComplete:false, entries:[]}, vault='v', calls=[];
 const row = {entry:'recipe', type:'recipe', record:{title:'Fig'}, brought:[{edit:'version', files:[]}]};
 const metadata = {entry:'recipe', readers:['actor'], files:[]};
 const api={ask:async op=>{calls.push(flat(op)); if(op.op==='database')return {ok:{vault, rows:[row]}};
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

test('fresh recipe inventory registers demand without waiting for a peer and releases it on close', async () => {
 const vault='b'.repeat(64), calls=[];
 let finish;
 const blocked=new Promise(resolve=>{finish=resolve;});
 const device={run:op=>{calls.push(flat(op));return blocked;}};
 const api={ask:async op=>({ok:op.op==='database'?{vault:op.vault,rows:[]}:{rows:[]}})};
 const window=createReadWindow({device:()=>device,read:(_,op)=>api.ask(op)});
 try {
  const result=await readAssetInventory(api,vault,window);
  expect(result.db.rows).toEqual([]);
  expect(calls[0].queries).toEqual([{types:['recipe'],vault}]);
  expect(calls[0].entries).toEqual([]);
  window.close();
  await Promise.resolve();
  expect(calls.at(-1).queries).toBeUndefined();
  expect(calls.at(-1).entries).toEqual([]);
 } finally {window.close();finish({ok:{accepted:true}});}
});
