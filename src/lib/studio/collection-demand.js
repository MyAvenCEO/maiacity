/** Keep Studio's actual collection queries discoverable for its mounted lifetime,
 * including an empty first local answer. Native collection readers still read
 * local data; these shared query windows own peer demand and cancellation.
 * @param {{vault?:string|null,observe:Function}} api
 * @returns {()=>void}
 */
export function watchStudioCollections(api) {
 const ignore = () => {};
 const stops = [
  api.observe(() => ({op:'query',where:{type:['file','task','story']},select:[],limit:1}),ignore,ignore),
  api.observe(() => ({op:'query',where:{type:['cut']},select:[],limit:1,
   ...(api.vault ? {vault:api.vault} : {})}),ignore,ignore)
 ];
 return () => stops.forEach(stop => stop());
}
