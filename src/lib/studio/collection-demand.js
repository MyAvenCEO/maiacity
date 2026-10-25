/** Keep Studio collection discovery mounted without executing discarded queries.
 * Positive hints use the shared demand scope: no payload read, count or hydration.
 * @param {{vault?:string|null,demand:Function}} api
 * @returns {()=>void}
 */
export function watchStudioCollections(api) {
 const scope = api.demand(() => [
  {types:['file','task','story']},
  {types:['cut'], ...(api.vault ? {vault:api.vault} : {})}
 ]);
 return () => scope.close();
}
