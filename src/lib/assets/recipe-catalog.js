/** A mounted catalog uses the same reactive read/demand owner as every other
 * avenDB view. Empty local results remain pending, never confirmed empty.
 * @param {{observe: (query:()=>any, take:(answer:any)=>void, failed:(error:Error)=>void)=>()=>void}} api
 * @param {string} vault
 * @param {(state:{phase:'waiting'|'local'|'unavailable',rows:any[],authoritativeEmpty:false,error?:string})=>void} take
 */
export function observeRecipeCatalog(api, vault, take) {
 let closed=false;
 const publish=(/** @type {Parameters<typeof take>[0]} */ state)=>{if(!closed)take(state);};
 const stop=api.observe(()=>({op:'code',vault,type:['recipe']}),answer=>{
  const rows=answer?.ok;
  if(!Array.isArray(rows)) {
   publish({phase:'unavailable',rows:[],authoritativeEmpty:false,error:String(answer?.why??answer?.refused??'Local recipe catalog unavailable')});
  } else {
   publish({phase:rows.length?'local':'waiting',rows,authoritativeEmpty:false});
  }
 },error=>publish({phase:'unavailable',rows:[],authoritativeEmpty:false,error:error.message}));
 return ()=>{closed=true;stop();};
}
