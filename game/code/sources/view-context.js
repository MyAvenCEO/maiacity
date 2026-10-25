/** Semantic URL context stays local. Only explicit entry-address fields become
 * scheduling hints; arbitrary query text, predicates and hashes are never sent.
 * @param {URL} url @param {string | null | undefined} vault */
export function routeDemandContext(url, vault) {
 const hex=/^[0-9a-f]{64}$/;
 const entries=new Set();
 for(const key of ['room','entry','timeline']) {
  const value=url.searchParams.get(key);
  const entry=key==='timeline'&&value?.startsWith('cut:')?value.slice(4):value;
  if(entry&&hex.test(entry))entries.add(entry);
 }
 const [page,entry]=url.hash.replace(/^#/,'').split('/');
 if(['docs','assets','worlds','sparks','artifacts','stories'].includes(page)&&hex.test(entry??''))entries.add(entry);
 return {vault:typeof vault==='string'&&hex.test(vault)?vault:undefined,
  context:`${url.search}${url.hash}`,entries:[...entries]};
}
