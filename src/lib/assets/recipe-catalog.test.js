// @ts-nocheck
import {expect,test} from 'bun:test';
import {observeRecipeCatalog} from './recipe-catalog.js';
import {createReactiveRead} from '../avendb/reactive-read.js';
import {observedWindow} from '../avendb/observed-window.js';
const id='a'.repeat(64),vault='b'.repeat(64);
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));

test('empty fresh catalog requests recipe discovery and updates on revision without full sync or retry',async()=>{
 let rows=[],invalidate,queries=0;const calls=[],states=[];
 const device={run:async op=>{calls.push(op);if(op.op==='demand')return{ok:{accepted:true,discovery_supported:true}};queries++;return{ok:rows};}};
 const api={observe(query,take,failed){
  const reader=createReactiveRead({read:observedWindow((d,op)=>d.run(op)),take,failed,timing:()=>()=>{}});
  invalidate=()=>reader.update(query(),device);invalidate();
  return()=>reader.close();
 }};
 const close=observeRecipeCatalog(api,vault,state=>states.push(state));
 try {
  await turn();await turn();
  expect(states.at(-1)).toMatchObject({phase:'waiting',rows:[],authoritativeEmpty:false});
  expect(calls.some(op=>op.op==='demand'&&op.queries?.some(q=>q.vault===vault&&q.types.includes('recipe')))).toBe(true);
  rows=[{entry:id,record:{kind:'recipe'}}];invalidate();await turn();await turn();
  expect(states.at(-1)).toMatchObject({phase:'local',rows,authoritativeEmpty:false});
  expect(queries).toBe(2);
  expect(calls.some(op=>['world','bring','synced'].includes(op.op))).toBe(false);
 } finally {close();await turn();}
 expect(calls.at(-1)).toMatchObject({op:'demand',entries:[]});
 const before=queries;invalidate();await turn();expect(queries).toBe(before);
});

test('route closure rejects late catalog delivery and unavailable answers never certify empty',()=>{
 let answer,failed,closed=0;const states=[];
 const stop=observeRecipeCatalog({observe(query,take,error){
  expect(query()).toEqual({op:'code',vault,type:['recipe']});answer=take;failed=error;return()=>closed++;
 }},vault,state=>states.push(state));
 answer({refused:'Locked',why:'Unlock first'});
 expect(states.at(-1)).toMatchObject({phase:'unavailable',authoritativeEmpty:false});
 failed(Error('Local read failed'));expect(states.at(-1).error).toBe('Local read failed');
 stop();answer({ok:[{entry:id}]});
 expect(closed).toBe(1);expect(states).toHaveLength(2);
});
