import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observeEntryPages } from './entry-pages.js';
import { libraryRelatedQueries } from './library-query.js';
const turn = () => new Promise(resolve => setTimeout(resolve, 10));
const actor = 'a'.repeat(64);
test('dependency beyond first512 resolves progressively and stays reactive until disposal', async () => {
 const ids = Array.from({length: 1100}, (_,n)=>n.toString(16).padStart(64,'0'));
 const queries = libraryRelatedQueries([{type:'task',record:{status:'done',outputs:ids}}], actor);
 /** @type {{op:any,take:(out:any)=>void,stop:boolean}[]} */ const observers=[];
 /** @type {any} */ let latest;
 const close = observeEntryPages((query,take) => {
  const watched={op:query(),take,stop:false}; observers.push(watched);
  return () => { watched.stop=true; };
 },queries,state=>{latest=state;});
 assert.equal(observers.length,1);
 assert.equal(observers[0].op.entries.length,512);
 observers[0].take({ok:{rows:[]}});
 assert.equal(observers.length,1,'next page yields to browser turn');
 await turn(); assert.equal(observers.length,2);
 const target={entry:ids[700],kind:'file'};
 observers[1].take({ok:{rows:[target]}});
 await turn(); assert.equal(observers.length,3);
 observers[2].take({ok:{rows:[]}});
 assert.equal(latest.phase,'ready'); assert.deepEqual(latest.rows,[target]);
 assert.ok(observers.every(o=>o.op.as===actor && o.op.entries.length<=512));
 observers[1].take({ok:null});
 assert.equal(latest.phase,'loading','lost local view is not a settled empty page');
 assert.deepEqual(latest.rows,[]);
 observers[1].take({ok:{rows:[]}});
 assert.deepEqual(latest.rows,[],'revoked or removed rows are not retained');
 close(); assert.ok(observers.every(o=>o.stop));
 observers[1].take({ok:{rows:[target]}});
 assert.deepEqual(latest.rows,[],'late old-context replies cannot restore rows');
});
test('context cleanup cancels queued page starts and errors do not strand later pages', async()=>{
 /** @type {((out:any)=>void)[]} */ const replies=[];
 let stopped=0;
 const queries=[{entries:['one']},{entries:['two']}];
 const close=observeEntryPages((_query,take)=>{replies.push(take);return()=>{stopped++;};},queries,()=>{});
 replies[0]({ok:{rows:[]}}); close(); await turn();
 assert.equal(replies.length,1); assert.equal(stopped,1);
 /** @type {any} */ let latest;
 const end=observeEntryPages((query,take,failed)=>{
  if (query().entries[0]==='one') failed(new Error('unavailable'));
  else take({ok:{rows:[{entry:'two'}]}});
  return()=>{};
 },queries,state=>{latest=state;});
 await turn(); assert.equal(latest.phase,'error'); assert.deepEqual(latest.rows,[{entry:'two'}]); end();
});
test('active leases stay bounded and selected family can move beyond previous window', async()=>{
 const ids=Array.from({length:6000},(_,n)=>n.toString(16).padStart(64,'0'));
 const tasks=ids.map(id=>({type:'task',record:{status:'done',outputs:[id]}}));
 const queries=libraryRelatedQueries(tasks,actor);
 let mounted=0,stopped=0;
 /** @type {any} */ let latest;
 const end=observeEntryPages((_query,take)=>{
  mounted++; take({ok:{rows:[]}}); return()=>{stopped++;};
 },queries,state=>{latest=state;});
 for(let turnIndex=0;turnIndex<12;turnIndex++) await turn();
 assert.equal(mounted,8); assert.equal(latest.phase,'error');
 assert.match(latest.error,/incomplete/);
 end(); assert.equal(stopped,8);
 const selected=ids[5999];
 assert.equal(libraryRelatedQueries(tasks,actor,selected)[0].entries[0],selected);
});
