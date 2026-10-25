/** Keep the existing cross-vault artwork relationship; canonical reads authorize each row.
 * @param {string} actor */
export const hookArtworkQuery = actor => ({ op: 'entry_views', as: actor, types: ['artwork'] });
/** @param {string} actor @param {string} render */
export const hookRenderQuery = (actor, render) => ({ op: 'entry_views', as: actor, entries: render ? [render] : [] });
/** Clear the old identity immediately, ignore obsolete completion, and contain file failures.
 * @param {any} api @param {any} file @param {(api:any,file:any)=>Promise<string|null>} read
 * @param {(value:string|null)=>void} take */
export function loadHookCover(api, file, read, take) {
 let closed = false;
 take(null);
 if (file) Promise.resolve().then(() => closed ? null : read(api, file))
  .then(value => { if (!closed) take(value); }, () => { if (!closed) take(null); });
 return () => { closed = true; };
}
