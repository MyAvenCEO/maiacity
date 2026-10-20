// Each old address of the list ($lib/app/redirects.js), prerendered as a small page that passes on to the new one.
import { MOVED, movedTo } from '$lib/app/redirects.js';

export const prerender = true;
export const ssr = false;

/** @type {import('./$types').EntryGenerator} */
export const entries = () => Object.keys(MOVED).map((path) => ({ moved: path.replace(/^\/|\/$/g, '') }));

/** @type {import('./$types').PageLoad} */
export const load = ({ params }) => ({ to: /** @type {string} */ (movedTo(params.moved)) });
