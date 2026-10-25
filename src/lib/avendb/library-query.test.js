// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compile } from 'svelte/compiler';
import { libraryFilesQuery, libraryTasksQuery, libraryRelatedQuery } from './library-query.js';
import { queryDiscovery, queryEntries } from './query-window.js';
import { summaryView, needsWorldEntries } from './startup-summary.js';
import { readCompleteness } from './read-completeness.js';
const vault='a'.repeat(64), actor='b'.repeat(64), related='c'.repeat(64);
test('Library preserves semantic file kind and actor while prioritizing ordinary files and tasks',()=>{
 const query=libraryFilesQuery(vault,actor);
 assert.deepEqual(query,{op:'entry_views',vault,as:actor,kind:'file'});
 assert.deepEqual(queryDiscovery(query),[{types:['file'],vault}]);
 assert.deepEqual(queryDiscovery(libraryTasksQuery(vault,actor)),[{types:['task']}]);
 assert.equal(summaryView('/app/','#library'),true);
 assert.equal(needsWorldEntries({entriesComplete:false},'library'),false);
 assert.equal(readCompleteness({ok:{rows:[]}}).authoritativeEmpty,false);
});
test('Library derived-file dependencies use bounded explicit IDs and current actor',()=>{
 const query=libraryRelatedQuery([{type:'task',record:{status:'done',outputs:[related,related,'bad'],inputs:[{entry:vault}]}}],actor);
 assert.deepEqual(query,{op:'entry_views',entries:[vault,related],as:actor,kind:'file'});
 assert.deepEqual(queryEntries(query),[vault,related]);
 assert.deepEqual(queryDiscovery(query),[]);
 assert.equal(libraryRelatedQuery([{type:'task',record:{status:'queued',outputs:[related]}}],actor).entries.length,0);
 const ids=Array.from({length:600},(_,n)=>n.toString(16).padStart(64,'0'));
 assert.equal(libraryRelatedQuery([{type:'task',record:{status:'done',outputs:ids}}],actor).entries.length,512);
});
test('Library compiles without whole-world inventory and retains actor-filtered dependencies',async()=>{
 const source=await readFile(new URL('./Library.svelte',import.meta.url),'utf8');
 compile(source,{filename:'Library.svelte',generate:'client'});
 assert.ok(!source.includes('world.entries'));
 assert.ok(source.includes('libraryFilesQuery(vault, actor)'));
 assert.ok(source.includes('libraryRelatedQuery(jobs.rows.filter((e) => reads(e, actor)), actor)'));
 assert.ok(source.includes('inventory.phase === \'error\''));
 assert.ok(!source.includes('none of it is shared'));
});
