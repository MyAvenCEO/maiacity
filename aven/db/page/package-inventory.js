/** Local authorized file-entry discovery. Pins identify entries, not downloaded bytes.
 * @param {string} vault @param {string} actor */
export const packageQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, types: ['file'] });

/** Absence in local discovery is never proof that a package needs republishing.
 * @param {'loading'|'ready'|'error'} phase */
export const missingPackageLabel = phase => phase === 'loading' ? 'Checking local entries…'
 : phase === 'error' ? 'Local inventory unavailable' : 'Not found in local entries yet';
