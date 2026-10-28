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
export const needsWorldEntries = (world, tab) => world?.entriesComplete === false && !['home', 'assets', 'docs', 'models', 'library'].includes(tab);

/** What the Shell shows for `tab`: the view at once, never a loading screen, with how fresh it is. While the world
 * in hand is the summary and the view needs entries, it paints what it has and says it is still reading this view's
 * entries on this device (behind, `reading`); else the world's own freshness, as its read was stamped.
 * @param {any} world @param {string} tab @param {ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf>} fresh */
export function shellView(world, tab, fresh) {
 if (!needsWorldEntries(world, tab)) return { reading: false, fresh };
 const state = /** @type {'offline' | 'behind'} */ (fresh.state === 'offline' ? 'offline' : 'behind');
 return { reading: true, fresh: { ...fresh, state, reading: true } };
}

/** Native hash changes can bypass router page-state notification. Publish the
 * route immediately, then ask the local reader; never await a peer or this read.
 * @param {()=>void} route @param {()=>Promise<unknown>} refresh @param {(e:any)=>void} failed */
export function localNavigation(route, refresh, failed = () => {}) {
 route();
 void refresh().catch(failed);
}
