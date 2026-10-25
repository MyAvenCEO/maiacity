import { observeReferenceClosure } from './entry-reference-closure.js';
import { reads } from './vaults.js';
/** @param {()=>any} api @param {()=>string[]} roots @param {()=>string} actor */
export function entryReferenceClosure(api,roots,actor) {
 let state=$state({rows:/** @type {any[]} */([]),phase:'loading',error:'',limited:false});
 $effect(()=>{const owner=api(),ids=roots(),as=actor();state={rows:[],phase:'loading',error:'',limited:false};return observeReferenceClosure(owner.observe.bind(owner),ids,as,row=>reads(row,as),value=>state=value)});
 return {get rows(){return state.rows},get phase(){return state.phase},get error(){return state.error},get limited(){return state.limited}};
}
