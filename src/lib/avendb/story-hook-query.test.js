// @ts-nocheck
import {test,expect} from 'bun:test';
import {hookArtworkQuery,hookRenderQuery,loadHookCover} from './story-hook-query.js';
import {createReactiveRead} from './reactive-read.js';
import {observedWindow} from './observed-window.js';
import {summaryView,needsWorldEntries} from './startup-summary.js';
const id=n=>String(n).repeat(64);
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
test('Hook reads cross-vault authorized artwork and exact render locally without waiting for peers',async()=>{
 const calls=[],answers=[];
 const owner={run:op=>{calls.push(op);return new Promise(()=>{})}};
 const op=hookArtworkQuery(id(1));
 expect(op).toEqual({op:'entry_views',as:id(1),types:['artwork']});
 const reader=createReactiveRead({read:observedWindow(async(_,q)=>{
  expect(q).toEqual(op);return {ok:{rows:[{entry:id(2),vault:id(3)}],totalEntries:1,readableEntries:1}};
 }),take:out=>answers.push(out),timing:()=>()=>{}});
 reader.update(op,owner);await flush();
 expect(answers[0].ok.rows[0].vault).toBe(id(3));reader.close();
 expect(hookRenderQuery(id(1),id(4))).toEqual({op:'entry_views',as:id(1),entries:[id(4)]});
 expect(hookRenderQuery(id(1),'').entries).toEqual([]);
});
test('cover changes clear old pixels immediately and ignore prior actor/entry response',async()=>{
 const shown=[],pending=[];const read=()=>new Promise(resolve=>pending.push(resolve));
 const closeA=loadHookCover({},'A',read,v=>shown.push(v));await flush();
 closeA();const closeB=loadHookCover({},'B',read,v=>shown.push(v));await flush();
 pending[1]('B pixels');await flush();pending[0]('A pixels');await flush();
 expect(shown).toEqual([null,null,'B pixels']);closeB();
 const close=loadHookCover({},'C',async()=>{throw Error('unavailable')},v=>shown.push(v));await flush();
 expect(shown.at(-1)).toBeNull();close();
});
test('only audited explicit detail stages can open with metadata-only navigation',()=>{
 for(const step of ['hook','journey','writing']){
  expect(summaryView('/app/',`#stories/${id(1)}/${step}`)).toBe(true);
  expect(needsWorldEntries({entriesComplete:false},'stories',true,step)).toBe(false);
 }
 for(const step of ['idea','movie','thumbnail','derivatives','']){
  expect(summaryView('/app/',`#stories/${id(1)}/${step}`)).toBe(false);
  expect(needsWorldEntries({entriesComplete:false},'stories',true,step)).toBe(true);
 }
});
