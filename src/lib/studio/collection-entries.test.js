// @ts-nocheck — Bun fixtures inject the device boundary.
import {test, expect} from 'bun:test';
import {collectionEntries} from './collection-entries.js';

test('collection reads page only selected records and never request the world', async()=>{
 const rows=Array.from({length:73},(_,i)=>({entry:String(i),type:'cut',vault:'mine',record:{kind:'cut'}}));
 const calls=[];
 const call=async(_,op)=>{
  calls.push(op);
  if(op.op==='query') return {ok:{count:rows.length,rows:rows.slice(op.offset,op.offset+op.limit)}};
  if(op.op==='entry_views') return {ok:{rows:rows.filter(row=>op.entries.includes(row.entry))}};
  throw Error('broad read');
 };
 expect(await collectionEntries(call,'cut','mine')).toEqual(rows);
 expect(calls.map(op=>op.op)).toEqual(['query','entry_views','query','entry_views']);
 expect(calls.filter(op=>op.op==='query').every(op=>op.vault==='mine' && op.where.type[0]==='cut')).toBe(true);
 expect(calls.filter(op=>op.op==='entry_views').map(op=>op.entries.length)).toEqual([50,23]);
});
test('refused queries and metadata do not become empty collections',async()=>{
 await expect(collectionEntries(async()=>({refused:'locked'}),'cut')).rejects.toThrow();
 await expect(collectionEntries(async(_,op)=>op.op==='query'?{ok:{count:1,rows:[{entry:'a'}]}}:{refused:'revoked'},'cut')).rejects.toThrow();
});
test('concurrent removal cannot make paging spin forever',async()=>{
 await expect(collectionEntries(async()=>({ok:{rows:[],count:2}}),'story')).rejects.toThrow('changed');
});
test('provisional zero count never truncates a cold collection',async()=>{
 let queries=0;const offsets=[];
 const call=async(_,op)=>{
  if(op.op==='query') {offsets.push(op.offset);return ++queries===1
   ?{ok:{rows:[],count:0,countExact:false,pageComplete:false,readiness:{deferredCandidates:3}}}
   :{ok:{rows:[{entry:'a'}],count:1,countExact:true,pageComplete:true}};}
  return {ok:{rows:[{entry:'a',type:'file'}]}};
 };
 expect(await collectionEntries(call,'file')).toEqual([{entry:'a',type:'file'}]);expect(offsets).toEqual([0,0]);
});
test('inexact result without continuable local work is not silently accepted',async()=>{
 await expect(collectionEntries(async()=>({ok:{rows:[],count:0,countExact:false,pageComplete:false}}),'file')).rejects.toThrow('did not complete');
});
