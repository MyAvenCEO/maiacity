// @ts-nocheck — plain JS, kept loose on purpose
// A post's own page: /universe/<doc>/<slug>. The doc id finds the post (a fake iroh doc id for now, the real one
// later); the slug only makes the address readable. The hardcoded posts are prerendered; one shared a moment ago
// opens through the app, from the stream in memory.
import { POSTS, slug } from '$lib/universe/posts.js';

export const entries = () => POSTS.map((p) => ({ doc: p.doc, slug: slug(p.title) }));

export const load = ({ params }) => ({ doc: params.doc, slug: params.slug });
