import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWarmWorkingSetHints } from './warm-working-set.js';
/** @param {number} n */
const id = n => n.toString(16).padStart(64,'0');
function fixture() {
 /** @type {string|null} */ let text=null; let route='/app/chat';
 const hints=createWarmWorkingSetHints({read:()=>text,write:value=>{text=value;},route:()=>route});
 return {hints,setText:/** @param {string} value */ value=>{text=value;},setRoute:/** @param {string} value */ value=>{route=value;}};
}
test('mounted query scopes retain bounded route-specific startup hints',()=>{
 const f=fixture(),a=Symbol(),b=Symbol();
 f.hints.remember(a,[id(1),id(2)]); f.hints.remember(b,[id(2),id(3)]);
 assert.deepEqual(f.hints.initial(),[id(1),id(2),id(3)]);
 f.hints.release(a);f.hints.release(b);
 assert.deepEqual(f.hints.initial(),[id(1),id(2),id(3)]);
 f.setRoute('/app/assets'); assert.deepEqual(f.hints.initial(),[]);
 f.hints.remember(Symbol(),[id(4)]); assert.deepEqual(f.hints.initial(),[id(4)]);
});
test('unknown/corrupt hints remain optional and cannot grow without bound',()=>{
 const f=fixture(); assert.deepEqual(f.hints.initial(),[]);
 f.hints.remember(Symbol(),['bad',null,...Array.from({length:400},(_,i)=>id(i))]);
 assert.equal(f.hints.initial().length,256);
 f.setText('{');assert.deepEqual(f.hints.initial(),[]);
 f.setText('x'.repeat(20001));assert.deepEqual(f.hints.initial(),[]);
 const unavailable=createWarmWorkingSetHints({read:()=>{throw Error();},write:()=>{throw Error();},route:()=>'/'});
 unavailable.remember(Symbol(),[id(1)]);assert.deepEqual(unavailable.initial(),[]);
});
