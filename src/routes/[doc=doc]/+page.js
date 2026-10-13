// @ts-nocheck — plain JS, kept loose on purpose
// A post's own page, on the root: /<doc>/?t=<slug of the title>. The doc id finds the post (a fake iroh doc id for now,
// the real one later); the title in ?t= only makes the address readable. The hardcoded posts are prerendered; one
// shared a moment ago opens through the app, from the stream in memory.
import { POSTS } from '$lib/universe/posts.js';

export const entries = () => POSTS.map((p) => ({ doc: p.doc }));

export const load = ({ params }) => ({ doc: params.doc });
