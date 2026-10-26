import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
/** @param {any} actual */
const expect=(actual)=>({
 /** @param {any} expected */ toBe:expected=>assert.equal(actual,expected),
 /** @param {any} expected */ toEqual:expected=>assert.deepEqual(actual,expected),
 /** @param {string} expected */ toContain:expected=>assert.ok(actual.includes(expected)),
 toBeUndefined:()=>assert.equal(actual,undefined),
 not:{toContain:(/** @type {string} */ expected)=>assert.ok(!actual.includes(expected))}
});
import {documentQuery} from './document-query.js';
import {createReactiveRead} from './reactive-read.js';
import {observedWindow} from './observed-window.js';
import {summaryView,needsWorldEntries} from './startup-summary.js';
import {readCompleteness} from './read-completeness.js';
// an Interest op seen as the one list of entries and selectors it wants (tiers aside)
const flat = (op) => op?.op !== 'interest' ? op : { ...op, entries: (op.wants ?? []).flatMap((w) => w.entries ?? []), queries: op.wants?.length ? op.wants.flatMap((w) => w.queries ?? []) : undefined };
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
test('fresh Docs reads its authorized collection without world entries or peer acknowledgement',async()=>{
 const vault='a'.repeat(64), actor='b'.repeat(64);
 /** @type {any[]} */ const calls=[];
 /** @type {any[]} */ const answers=[];
 /** @type {any[]} */ const reads=[];
 /** @type {(value:any)=>void} */ let finish=()=>{};
 const pending=new Promise(resolve=>{finish=resolve;});
 const owner={run:(/** @type {any} */ op)=>{calls.push(flat(op));return pending;}};
 const reader=createReactiveRead({read:observedWindow(async(_d,op)=>{reads.push(op);return {ok:{rows:[],totalEntries:0,readableEntries:0}};}),take:out=>answers.push(out),timing:()=>()=>{}});
 try {
  expect(summaryView('/app/','#docs/entry')).toBe(true);
  expect(needsWorldEntries({entriesComplete:false},'docs')).toBe(false);
  reader.update(documentQuery(vault,actor),owner); await flush();
  expect(reads).toEqual([{op:'entry_views',vault,as:actor,types:['story','post']}]);
  expect(calls[0].queries).toEqual([{types:['story','post'],vault}]);
  expect(JSON.stringify(calls)).not.toContain(actor);
  expect(answers.length).toBe(1); expect(readCompleteness(answers[0]).authoritativeEmpty).toBe(false);
  reader.close();await flush();expect(calls.at(-1).queries).toBeUndefined();
 } finally {reader.close();finish({ok:{accepted:true}});await flush();}
});
test('Docs is wired to scoped collection and targeted observer, without world-entry barrier',async()=>{
 const source=await readFile(new URL('./Docs.svelte',import.meta.url),'utf8');
 expect(source).toContain('entryCollection(() => api, () => documentQuery(vault, actor))');
 expect(source).toContain("api.observe(() => ({ op: 'note', entry: e })");
 expect(source).not.toContain('world.entries');
 expect(source).toContain('available locally');
});
