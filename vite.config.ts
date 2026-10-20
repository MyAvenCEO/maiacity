/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { assetBox } from './src/lib/assets/box/plugin.js';
import { pageCsp } from './src/lib/sandbox/policy.js';

function commit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return 'local';
	}
}

export default defineConfig({
	plugins: [
		tailwindcss(),
		// the asset box's worker, bundled whole (src/lib/assets/box)
		assetBox(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// The whole site is prerendered and served from GitHub Pages.
			adapter: adapter({ fallback: '404.html' }),

			// GitHub Pages serves the project site under /<repo>; CI sets BASE_PATH.
			paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` },

			// a link to a journal day that is not published yet: its page comes with it being published — a warning,
			// not a failed build; any other missing page still stops the build
			prerender: {
				handleHttpError: ({ path, referrer, message }) => {
					if (/^\/blog\/day-/.test(path)) return console.warn(`not published yet: ${path} (linked from ${referrer})`);
					throw new Error(message);
				}
			},

			// the build named by its commit, not the time it ran: the same commit builds the same bytes wherever it is
			// built, so a Mac of Maia City can witness the live site (scripts/release.mjs)
			version: { name: process.env.GITHUB_SHA || commit() },

			// every page's own policy (src/lib/sandbox/policy.js): the scripts it may run, its own start script by its
			// hash, written into each page as a <meta>, as a prerendered page has no headers of its own (deploy/Caddyfile
			// sends what a <meta> can't hold, frame-ancestors; the Mac app sends it with its own, vault/app/tauri.conf.json)
			csp: { mode: 'hash', directives: pageCsp((text) => createHash('sha256').update(text).digest('base64')) }
		})
	],
	server: {
		// game/ holds the rules the site and the API share (policies, the calendar,
		// the cap table, the globe); it sits beside src/, so Vite has to be told. So do the journal, which avenDB's pages
		// read in the browser (src/lib/avendb/article.js), the inspire-me library and the journal's sources, and the documents
		// the repository proposes: the skills (src/lib/avendb/docs.js).
		fs: { allow: ['game', 'blog', 'inspire-me', 'sources', 'films', '.claude/skills'] },
		// other sessions' worktrees and the Mac app's build folder change all day: watched, each one reloaded the
		// studio in the middle of a session
		watch: { ignored: ['**/.claude/**', '**/.cargo/**', '**/vault/target/**', '**/avendb/target/**'] },
		// The preview harness assigns a free port via PORT.
		port: Number(process.env.PORT) || 5173,
		strictPort: !!process.env.PORT
	}
});
