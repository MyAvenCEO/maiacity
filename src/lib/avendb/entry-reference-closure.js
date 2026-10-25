import { answer } from './ops.js';
const ID = /^[a-f0-9]{64}$/;
/** Explicit, schema-owned references only; never inspect arbitrary text as identifiers.
 * @param {any} row @returns {string[]} */
export function sparkReferences(row) {
 const record = row?.record ?? {};
 const list = (/** @type {any} */ value) => Array.isArray(value) ? value.slice(0,4097) : [];
 let report;
 if (typeof record.result === 'string' && record.result.length <= 1048576) { try { report=JSON.parse(record.result)?.file; } catch {} }
 const ref = (/** @type {any} */ value) => typeof value === 'string' ? value : value?.entry;
 return [...list(record.items).map((/** @type {any} */ item) => ref(item.ref)), ...list(record.files).map(ref), ...list(record.sparks).map(ref), ...list(record.layers).map((/** @type {any} */ layer)=>ref(layer.file)), ref(record.render), ref(record.from), ref(report), ...list(record.inputs).map(ref), ...list(record.outputs).map(ref)]
  .filter(value => typeof value === 'string' && ID.test(value));
}
/** Bounded reactive closure of explicit entry references. Pages remain observed for
 * revocation; old replies cannot revive a closed context. One new page per turn.
 * Partly filled pages expand in place with generation guards, so graph depth does
 * not consume one observer per edge. Local presence is not global completeness. Previously discovered IDs are retained
 * within this bounded context, but unreachable rows are never published.
 * @param {any} observe @param {string[]} roots @param {string} actor
 * @param {(row:any)=>boolean} readable @param {(state:any)=>void} take */
export function observeReferenceClosure(observe, roots, actor, readable, take) {
 let closed=false, next=0, limited=roots.length>4096;
 /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer;
 /** @type {(()=>void)[]} */ const stops=[];
 const rootIds=roots.slice(0,4096).filter(id=>ID.test(id));
 const wanted=new Set(rootIds), requested=new Set(), pages=new Map(), settled=new Set(), errors=new Map();
 /** @type {string[][]} */ const pageIds=[];
 /** @type {number[]} */ const generations=[];
 const rows=()=>new Map([...pages.values()].flat().map(row=>[row.entry,row]));
 const reachable=()=>{
  const held=rows(), seen=new Set(), result=[];
  /** @type {string[]} */ const queue=[];
  const enqueue=(/** @type {string} */ id)=>{if(held.has(id)&&!seen.has(id)){seen.add(id);queue.push(id)}};
  for(const id of rootIds)enqueue(id);
  while(queue.length){const id=queue.pop();const row=held.get(id);result.push(row);for(const ref of sparkReferences(row))enqueue(ref);}
  return result;
 };
 const publish=()=>{if(!closed)take({rows:reachable(),phase:errors.size?'error':settled.size<next||[...wanted].some(id=>!requested.has(id))&&(next<8||(pageIds[next-1]?.length??512)<512)?'loading':'ready',error:[...errors.values()].join('; '),limited});};
 const schedule=()=>{if(closed||timer!==undefined)return;timer=setTimeout(()=>{timer=undefined;start()},0)};
 const start=()=>{
  if(closed)return;
  const pending=[...wanted].filter(id=>!requested.has(id));
  if(!pending.length){publish();return;}
  const reuse=next>0 && pageIds[next-1].length<512;
  if(!reuse && next>=8){limited=true;publish();return;}
  const index=reuse?next-1:next++;
  const previous=pageIds[index]??[];
  const added=pending.slice(0,512-previous.length), ids=[...previous,...added];
  pageIds[index]=ids;for(const id of added)requested.add(id);
  const generation=(generations[index]??0)+1;generations[index]=generation;
  const active=()=>!closed && generations[index]===generation;
  stops[index]?.();settled.delete(index);publish();
  const fail=(/** @type {any} */ error)=>{if(!active())return;pages.delete(index);errors.set(index,String(error.message??error));settled.add(index);publish();schedule()};
  try{
   const stop=observe(()=>({op:'entry_views',entries:ids,as:actor}),(/** @type {any} */ out)=>{
    if(!active())return;
    try{const got=answer(out);if(!got){pages.delete(index);settled.delete(index);publish();return;}
     if(!Array.isArray(got.rows))throw Error('Reference read did not return rows');
     const valid=got.rows.filter((/** @type {any} */ row)=>ids.includes(row.entry)&&readable(row));pages.set(index,valid);errors.delete(index);settled.add(index);
     for(const row of reachable())for(const id of sparkReferences(row)){if(wanted.size<4096||wanted.has(id))wanted.add(id);else limited=true;}
     publish();schedule();
    }catch(error){fail(error)}
   },fail);
   if(!active())stop();else {stops[index]=stop;schedule();}
  }catch(error){fail(error)}
 };
 publish();start();
 return ()=>{closed=true;if(timer!==undefined)clearTimeout(timer);for(const stop of stops)stop();pages.clear()};
}
