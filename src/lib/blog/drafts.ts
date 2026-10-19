// Where a journal day is read.
import { base } from '$app/paths';
import type { PostMeta } from './types';

/** Where a post is read: its own page, or the address it names. */
export const postHref = (post: PostMeta) => post.href ?? `${base}/blog/${post.slug}`;
