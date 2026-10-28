// A legal document's address ($lib/legal: the site notice, the privacy notices): only those reach its page
// (../routes/[...legal=legal]), so that it never stands in the way of the other page that catches the rest, the old
// addresses' (./moved.js).
import { legalByPath } from '$lib/legal';

/** @param {string} param */
export const match = (param) => !!legalByPath(`/${param}`);
