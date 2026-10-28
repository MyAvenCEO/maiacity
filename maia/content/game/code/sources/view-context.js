/** Semantic URL context stays local. Only explicit entry-address fields become slots of the page's Interest (the
 * manifests' `$room`, `$timeline`, `$asset`, `$entry`) and entries on screen now; arbitrary query text, predicates
 * and hashes are never sent.
 * @param {URL} url @param {string | null | undefined} vault */
export function routeDemandContext(url, vault) {
 const hex=/^[0-9a-f]{64}$/;
 const entries=new Set();
 /** @type {Record<string, string>} */
 const bind={};
 for(const key of ['room','entry','timeline']) {
  const value=url.searchParams.get(key);
  const entry=key==='timeline'&&value?.startsWith('cut:')?value.slice(4):value;
  if(entry&&hex.test(entry)){entries.add(entry);bind[key]=entry;}
 }
 const [page,entry]=url.hash.replace(/^#/,'').split('/');
 if(['docs','assets','worlds','sparks','artifacts','stories'].includes(page)&&hex.test(entry??'')){
  entries.add(entry);
  bind[page==='assets'?'asset':'entry']??=entry;
 }
 return {vault:typeof vault==='string'&&hex.test(vault)?vault:undefined,
  context:`${url.search}${url.hash}`,entries:[...entries],bind};
}
