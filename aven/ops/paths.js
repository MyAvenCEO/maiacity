// Where the repo keeps what (./paths.json): the site's folder and its static files, the import aliases, the folders
// beside the site its dev server serves. Read by vite.config.ts, by the bundlers of the frozen engines and of the asset
// box, and by the tests that follow imports by hand.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** the repo's root, its trailing / kept */
export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** @type {{ site: string, static: string, aliases: Record<string, string>, served: string[] }} */
export const paths = JSON.parse(readFileSync(new URL('./paths.json', import.meta.url), 'utf8'));

/** @type {Record<string, string>} each import alias and the folder it names, from the repo's root; $lib is the site's own library */
export const aliases = { $lib: `${paths.site}/lib`, ...paths.aliases };

/** the same, each folder as an absolute path, for a bundler's resolve.alias */
export const aliasDirs = Object.fromEntries(Object.entries(aliases).map(([name, dir]) => [name, ROOT + dir]));

/** the path from the repo's root that an aliased import names (`$kernel/sandbox/bundle.js`), or null for any other @param {string} spec */
export function unaliased(spec) {
	for (const [name, dir] of Object.entries(aliases)) if (spec === name || spec.startsWith(name + '/')) return dir + spec.slice(name.length);
	return null;
}
