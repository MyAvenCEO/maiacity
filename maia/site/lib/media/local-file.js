/** Find a named or legacy-hash file only among records already in the local world.
 * @param {any[]} entries @param {string} vault @param {string} name
 */
export const localFile = (entries, vault, name) => entries.find(e =>
	!e.deleted && e.type === 'file' && (!vault || e.vault === vault) &&
	(e.title === name || (/^[a-f0-9]{64}$/.test(name) && e.title?.startsWith(name + '.')) || e.files?.some((/** @type {any} */ f) => f.root === name))
);
