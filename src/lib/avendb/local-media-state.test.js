// @ts-nocheck
import {expect,test} from 'bun:test';
import {mediaEntry,forgetMedia,resetMedia} from './local-media-state.js';
const request=()=>({vault:'v',name:'portrait.png',root:'root',entry:'entry'});
test('incomplete same-device summary retains a previously resolved URL',()=>{
 const wanted=request(),urls={portrait:'blob:existing'},revoked=[];
 const entry=mediaEntry({entries:[],entriesComplete:false},wanted);
 if(entry!==undefined && !entry?.files?.[0])forgetMedia(urls,'portrait',wanted,u=>revoked.push(u));
 expect(urls.portrait).toBe('blob:existing');expect(wanted.root).toBe('root');expect(revoked).toEqual([]);
});
test('full-world deletion clears the URL and held file identity',()=>{
 const wanted=request(),urls={portrait:'blob:existing'},revoked=[];
 const entry=mediaEntry({entries:[]},wanted);
 expect(entry).toBe(null);if(!entry)forgetMedia(urls,'portrait',wanted,u=>revoked.push(u));
 expect(urls).toEqual({});expect(wanted.root).toBeUndefined();expect(wanted.entry).toBeUndefined();expect(revoked).toEqual(['blob:existing']);
});
test('device change clears retained URLs regardless of snapshot completeness',()=>{
 const wanted=new Map([['portrait',request()]]),urls={portrait:'blob:existing'},revoked=[];
 resetMedia(urls,wanted,u=>revoked.push(u));
 expect(urls).toEqual({});expect(wanted.get('portrait').root).toBeUndefined();expect(revoked).toEqual(['blob:existing']);
});
test('complete file records still resolve without network or whole-world fallback',()=>{
 const row={entry:'entry',vault:'v',type:'file',title:'portrait.png',files:[{root:'root',len:12}]};
 expect(mediaEntry({entries:[row]},request())).toBe(row);
 expect(mediaEntry(null,request())).toBeUndefined();
});
