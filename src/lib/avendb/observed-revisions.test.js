// @ts-nocheck — Bun runtime fixtures, matching adjacent tests.
import {expect,test} from 'bun:test';
import {observedRevisions} from './observed-revisions.js';
import {createReactiveRead} from './reactive-read.js';
const id='a'.repeat(64),head='b'.repeat(64);
const row={entry:id,readOnly:true,record:{secret:'not-exported'},observedRevision:{kind:'checkpoint-basis',heads:[head],frontierComplete:true}};
test('consumed revision metadata is bounded and excludes row content',()=>{
 const got=observedRevisions({ok:{rows:Array(100).fill(row)}});
 expect(got.length).toBe(64);expect(JSON.stringify(got)).not.toContain('secret');
 expect(got[0]).toEqual({entry:id,readOnly:true,kind:'checkpoint-basis',heads:[head],frontierComplete:true});
 expect(observedRevisions({ok:{rows:[{...row,observedRevision:{...row.observedRevision,heads:Array(33).fill(head)}}]}})).toEqual([]);
});
test('revision callback follows consumer delivery and requires explicit query opt-in',async()=>{
 const order=[];
 const reader=createReactiveRead({read:async()=>({ok:{rows:[row]}}),take:()=>order.push('consumer'),observed:r=>{order.push(r[0].kind);throw Error('measurement failure');},failed:()=>order.push('failed')});
 const owner={};reader.update({op:'query'},owner);await new Promise(r=>setTimeout(r,0));
 reader.update({op:'query',observeRevision:true},owner);await new Promise(r=>setTimeout(r,0));reader.close();
 expect(order).toEqual(['consumer','consumer','checkpoint-basis']);
});
