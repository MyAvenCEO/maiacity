// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { storiesQuery, storyFallbackQuery } from './stories-query.js';
import { queryDiscovery } from './query-window.js';
import { createReactiveRead } from './reactive-read.js';
import { observedWindow } from './observed-window.js';
import { summaryView, needsWorldEntries } from './startup-summary.js';
const vault='a'.repeat(64), actor='b'.repeat(64), city='c'.repeat(64);
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('Stories declares local cards/flows and only existing trusted city fallback',()=>{
 assert.deepEqual(storiesQuery(vault,actor),{op:'entry_views',vault,as:actor,types:['story','flow']});
 assert.deepEqual(queryDiscovery(storiesQuery(vault,actor)),[{vault,types:['story','flow']}]);
 assert.deepEqual(storyFallbackQuery(vault,actor,city),{op:'entry_views',vault:city,as:actor,types:['flow']});
 assert.deepEqual(storyFallbackQuery(vault,actor,vault),{op:'entry_views',entries:[],as:actor});
 assert.deepEqual(storyFallbackQuery(vault,actor,undefined),{op:'entry_views',entries:[],as:actor});
});
test('only the audited Stories inventory bypasses world readiness; detail subviews retain their guard',()=>{
 for(const hash of ['#stories','#stories/','#articles'])assert.equal(summaryView('/app/',hash),true);
 assert.equal(summaryView('/app/','#stories/'+vault),true);
 assert.equal(needsWorldEntries({entriesComplete:false},'stories',false),false);
 assert.equal(needsWorldEntries({entriesComplete:false},'stories',true),false);
});
test('Stories local inventory does not wait for peers to accept its demand',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);const calls=[],answers=[];
 const owner={run:op=>{calls.push(op);return pending;}};
 const reader=createReactiveRead({read:observedWindow(async(_owner,op)=>({ok:{rows:[{entry:city,type:'story'}],totalEntries:1,readableEntries:1}})),take:out=>answers.push(out),timing:()=>()=>{}});
 try{reader.update(storiesQuery(vault,actor),owner);await flush();assert.equal(answers.length,1);assert.equal(answers[0].ok.rows[0].entry,city);assert.equal(JSON.stringify(calls).includes(actor),false);}
 finally{reader.close();finish({ok:{accepted:true}});await flush();}
});
test('Stories component compiles with scoped flow dependencies and incomplete-state wording',async()=>{
 const source=await readFile(new URL('./Stories.svelte',import.meta.url),'utf8');
 compile(source,{filename:'Stories.svelte',generate:'client'});
 assert.ok(!source.includes('world.entries'));
 assert.ok(source.includes('storyFallbackQuery(vault, actor, seedCity(world)?.id)'));
 assert.ok(source.includes('.filter((e) => reads(e, actor))'));
 assert.ok(source.includes("defaults.phase !== 'ready'"));
 assert.ok(!source.includes('none of\n\t\t\tit is shared'));
});
