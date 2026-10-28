// An old address the site has moved ($lib/app/redirects.js): only those reach the page that passes them on
// (../routes/[...moved=moved]); every other address keeps its own page.
import { movedTo } from '$lib/app/redirects.js';

/** @param {string} param */
export const match = (param) => movedTo(param) !== null;
