// @ts-nocheck
import {test,expect} from 'bun:test';
import {watchStudioCollections} from './collection-demand.js';
import {createReactiveRead} from '../avendb/reactive-read.js';
import {observedWindow} from '../avendb/observed-window.js';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
test('empty Studio collections retain typed demand and selected-vault changes replace cut scope',async()=>{
 const calls=[],updates=[];
 const device={run:async op=>{calls.push(op);return op.op==='demand'?{ok:{accepted:true,discovery_supported:true}}:{ok:{rows:[],count:0}};}};
 const api={vault:'a'.repeat(64),observe(query,take,failed){
  const reader=createReactiveRead({read:observedWindow((d,op)=>d.run(op)),take,failed,timing:()=>()=>{}});
  const update=()=>reader.update(query(),device);updates.push(update);update();return()=>reader.close();
 }};
 const close=watchStudioCollections(api);
 await turn();await turn();
 const selectors=()=>calls.filter(op=>op.op==='demand').flatMap(op=>op.queries??[]);
 expect(selectors().some(q=>q.types.includes('file')&&q.types.includes('task')&&q.types.includes('story')&&!q.vault)).toBe(true);
 expect(selectors().some(q=>q.types.includes('cut')&&q.vault==='a'.repeat(64))).toBe(true);
 api.vault='b'.repeat(64);updates.forEach(update=>update());await turn();await turn();
 expect(selectors().some(q=>q.types.includes('cut')&&q.vault===api.vault)).toBe(true);
 expect(calls.filter(op=>op.op==='query').every(op=>op.limit===1&&op.select.length===0)).toBe(true);
 close();await turn();
 const n=calls.length;updates.forEach(update=>update());await turn();expect(calls.length).toBe(n);
 expect(calls.some(op=>op.op==='world'||op.op==='bring')).toBe(false);
});
