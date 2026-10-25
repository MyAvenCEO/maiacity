// @ts-nocheck
import {test,expect} from 'bun:test';
import {watchStudioCollections} from './collection-demand.js';
import {createEntryWindow} from '../avendb/query-window.js';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Studio demand alone replaces vault and device and closes without any content query',async()=>{
 const calls=[],updates=[];
 const node=name=>({run:async op=>{calls.push({name,...op});if(op.op!=='demand')throw Error('unexpected content read');return {ok:{accepted:true,discovery_supported:true}};}});
 let device=node('first');
 const api={vault:'a'.repeat(64),demand(selectors){
  const scope=createEntryWindow({device:()=>device});
  const update=()=>scope.replace([],selectors());updates.push(update);update();return scope;
 }};
 const close=watchStudioCollections(api);await turn();
 expect(calls.at(-1).queries).toEqual([{types:['file','task','story']},{types:['cut'],vault:api.vault}]);
 const firstScope=calls.at(-1).scope;
 api.vault='b'.repeat(64);await updates[0]();await turn();
 expect(calls.at(-1).scope).toBe(firstScope);
 expect(calls.at(-1).queries[1].vault).toBe(api.vault);
 device=node('second');await updates[0]();await turn();
 expect(calls.filter(c=>c.name==='first').at(-1).entries).toEqual([]);
 expect(calls.filter(c=>c.name==='first').at(-1).queries).toBeUndefined();
 expect(calls.filter(c=>c.name==='second').at(-1).queries[1].vault).toBe(api.vault);
 expect(calls.filter(c=>c.name==='second').at(-1).scope).not.toBe(firstScope);
 close();await turn();
 expect(calls.at(-1).queries).toBeUndefined();expect(calls.at(-1).entries).toEqual([]);
 const n=calls.length;await updates[0]();await turn();expect(calls.length).toBe(n);
 expect(calls.every(op=>op.op==='demand')).toBe(true);
});
