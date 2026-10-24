/** Only consumers audited to use navigation metadata or their own scoped queries
 * can use an incomplete world. Unknown/legacy routes retain the complete path.
 * @param {string} pathname @param {string} [hash] */
export function summaryView(pathname, hash = '') {
 return (/\/app\/?$/.test(pathname) && (!hash || hash === '#home')) || /\/app\/chat\/?$/.test(pathname);
}
/** @param {import('./vaults.js').WorldView | null | undefined} world */
export const completeEntries = world => !!world && world.entriesComplete !== false;
