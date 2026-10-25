// @ts-nocheck
import {test,expect} from 'bun:test';
import {collectionLifetime} from './collection-lifetime.js';
import {collectionEntries} from './collection-entries.js';
const turn=()=>new Promise(r=>setTimeout(r,1));
test('Studio destruction aborts actual cold collection continuation before next page or metadata read',async()=>{
 const lifetime=collectionLifetime(),calls=[];
 const call=async(_,op)=>{calls.push(op);return {ok:{rows:[],count:0,countExact:false,pageComplete:false,readiness:{deferredCandidates:12}}};};
 const pending=lifetime.run('initial',signal=>collectionEntries(call,'file',null,{signal}));
 await turn();lifetime.close();await expect(pending).rejects.toThrow();
 expect(calls.map(c=>c.op)).toEqual(['query']);
 await expect(lifetime.run('reload',signal=>collectionEntries(call,'file',null,{signal}))).rejects.toThrow();
 expect(calls.length).toBe(1);
});
test('replaced vault reload cancels old enumeration without discarding the new result',async()=>{
 const lifetime=collectionLifetime();let release;const calls=[];
 const call=async(_,op)=>{
  calls.push(op);
  if(op.op==='entry_views')return {ok:{rows:op.entries.map(entry=>({entry,type:'cut',vault:'new'}))}};
  if(op.vault==='old')return new Promise(r=>release=r);
  return {ok:{rows:[{entry:'newcut'}],count:1}};
 };
 const old=lifetime.run('timelines',signal=>collectionEntries(call,'cut','old',{signal}));
 await turn();
 const fresh=lifetime.run('timelines',signal=>collectionEntries(call,'cut','new',{signal}));
 release({ok:{rows:[{entry:'oldcut'}],count:100}});
 await expect(old).rejects.toThrow();expect(await fresh).toEqual([{entry:'newcut',type:'cut',vault:'new'}]);
 expect(calls.filter(c=>c.op==='entry_views').map(c=>c.entries)).toEqual([['newcut']]);lifetime.close();
});
