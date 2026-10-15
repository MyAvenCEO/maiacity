// @ts-nocheck — plain JS, kept loose on purpose
// A post's own page, on the root: /<doc>/?t=<slug of the title>. The doc id, its avenDB entry, finds the post in
// avenDB's feed; the title in ?t= only makes the address readable. No post is known as the site is built, so each
// opens through the app.
export const prerender = false;

export const load = ({ params }) => ({ doc: params.doc });
