// @ts-nocheck
import {test,expect} from 'bun:test';
import {storyPostsQuery} from './story-post-query.js';
import {storyWritingQuery} from './story-writing-query.js';
import {createReactiveRead} from './reactive-read.js';
import {observedWindow} from './observed-window.js';
import {queryDiscovery} from './query-window.js';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
const vault='1'.repeat(64),actor='2'.repeat(64);
test('Writing declares only the article vault file dependency and never awaits peer acceptance',async()=>{
 const query=storyWritingQuery(vault,actor),got=[];
 expect(query).toEqual({op:'entry_views',vault,as:actor,types:['file']});
 expect(queryDiscovery(query)).toEqual([{vault,types:['file']}]);
 const owner={run:()=>new Promise(()=>{})};
 const reader=createReactiveRead({read:observedWindow(async(_,op)=>{expect(op).toEqual(query);return {ok:{rows:[],totalEntries:0,readableEntries:0}}}),take:out=>got.push(out),timing:()=>()=>{}});
 reader.update(query,owner);await flush();expect(got).toHaveLength(1);reader.close();
});
test('vault replacement ignores an old picture inventory answer',async()=>{
 const pending=[],got=[];const owner={run:async()=>({ok:{accepted:true}})};
 const reader=createReactiveRead({read:observedWindow((_,op)=>new Promise(resolve=>pending.push({op,resolve}))),take:out=>got.push(out),timing:()=>()=>{}});
 reader.update(storyWritingQuery(vault,actor),owner);await flush();
 reader.update(storyWritingQuery('3'.repeat(64),actor),owner);await flush();
 pending[0].resolve({ok:{rows:[{entry:'old'}]}});await flush();expect(got).toHaveLength(0);
 pending[1].resolve({ok:{rows:[]}});await flush();expect(got).toHaveLength(1);reader.close();
});

test('Derivatives keeps globally authorized post references and reads before peer response',async()=>{
 const query=storyPostsQuery(actor),got=[];
 expect(query).toEqual({op:'entry_views',as:actor,types:['post']});
 const reader=createReactiveRead({read:observedWindow(async(_,op)=>{expect(op).toEqual(query);return {ok:{rows:[{entry:'post',vault:'different',record:{story:{entry:'target'}}}]}}}),take:out=>got.push(out),timing:()=>()=>{}});
 reader.update(query,{run:()=>new Promise(()=>{})});await flush();expect(got[0].ok.rows[0].vault).toBe('different');reader.close();
});
