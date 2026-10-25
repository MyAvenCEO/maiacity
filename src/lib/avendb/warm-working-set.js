// Local scheduling hints only: opaque entry IDs from existing mounted query
// windows, no records/keys/authentication. Corruption or unknown routes use [].
const KEY = 'avendb.active-view-entries.v1';
const MAX = 256;
/** @param {unknown} value */
const ids = value => Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)))].slice(0,MAX) : [];
/** @param {{read:()=>string|null,write:(value:string)=>void,route:()=>string}} storage */
export function createWarmWorkingSetHints(storage) {
 /** @type {Map<symbol,{route:string,entries:string[]}>} */ const scopes = new Map();
 return {
  /** @param {symbol} scope @param {unknown} entries */
  remember(scope,entries) {
   const route=storage.route(); scopes.set(scope,{route,entries:ids(entries)});
   const selected=ids([...scopes.values()].filter(value=>value.route===route).flatMap(value=>value.entries));
   if (!selected.length) return;
   try { storage.write(JSON.stringify({route,entries:selected})); } catch { /* optional hint */ }
  },
  /** @param {symbol} scope */
  release(scope) { scopes.delete(scope); },
  initial() {
   try {
    const text=storage.read(); if (!text || text.length>20000) return [];
    const value=JSON.parse(text);
    return value?.route===storage.route() ? ids(value.entries) : [];
   } catch { return []; }
  }
 };
}
export const warmWorkingSet = createWarmWorkingSetHints({
 read:()=>typeof localStorage==='undefined'?null:localStorage.getItem(KEY),
 write:value=>{if(typeof localStorage!=='undefined') localStorage.setItem(KEY,value);},
 route:()=>typeof location==='undefined'?'':location.pathname+location.hash
});
