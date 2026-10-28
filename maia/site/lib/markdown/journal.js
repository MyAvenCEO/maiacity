// @ts-nocheck — plain JS
// The journal's Markdown (blog posts, stories, posts, inspire-me pages) by the one engine: a picture named by its
// content hash is shown from the media vault (asset), a site path from the site's base; the web only over https.
import { asset } from '$lib/media/url';
import { markdown } from './index.js';

const HASHED = /^[0-9a-f]{64}(\.[a-z0-9]+)?$/;

/** Journal Markdown `md` as safe HTML, site paths under `base`. @param {string} md @param {string} [base] */
export function journalHtml(md, base = '') {
	const site = (href) => (href.startsWith('/') && !href.startsWith(`${base}/`) ? `${base}${href}` : href);
	return markdown(md, {
		link: site,
		picture: (href) => {
			const h = href.trim();
			if (HASHED.test(h)) return asset(h);
			if (h.startsWith('/')) return site(h);
			return /^https:\/\//i.test(h) ? asset(h) : null;
		}
	});
}
