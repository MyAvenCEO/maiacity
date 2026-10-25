/** Prepare owner-reviewable changes without writing or granting access. */
export function manifestPlan(declared, held) {
 const keys=['kind','id','title','note','routes','priority','parts'];
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 return declared.flatMap(value=>{
  const rows=held.filter(r=>r.record?.id===value.id && !(r.tags??[]).includes('avendb:deleted'));
  if(rows.length>1) throw Error(`Duplicate manifest ${value.id}; resolve before proposing changes`);
  if(!rows.length) return [{kind:'create',value}];
  const fields=keys.filter(key=>!same(rows[0].record?.[key],value[key]));
  return fields.length ? [{kind:'update',entry:rows[0].entry,value,fields}] : [];
 });
}
