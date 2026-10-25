/** Only consumers audited to use navigation metadata or their own scoped queries
 * can use an incomplete world. Unknown/legacy routes retain the complete path.
 * @param {string} pathname @param {string} [hash] */
export function summaryView(pathname, hash = '') {
 return (/\/app\/?$/.test(pathname) && (!hash || hash === '#home' || /^#(?:assets|docs|models|code|library)(?:\/|$)/.test(hash))) || /\/app\/chat\/?$/.test(pathname);
}
/** @param {import('./vaults.js').WorldView | null | undefined} world */
export const completeEntries = world => !!world && world.entriesComplete !== false;

/** Legacy consumers need a complete world; Assets, Docs and package pages own scoped inventories.
 * @param {any} world @param {string} tab */
export const needsWorldEntries = (world, tab) => world?.entriesComplete === false && !['home', 'assets', 'docs', 'models', 'code', 'library'].includes(tab);

/** Native hash changes can bypass router page-state notification. Publish the
 * route immediately, then ask the local reader; never await a peer or this read.
 * @param {()=>void} route @param {()=>Promise<unknown>} refresh @param {(e:any)=>void} failed */
export function localNavigation(route, refresh, failed = () => {}) {
 route();
 void refresh().catch(failed);
}
