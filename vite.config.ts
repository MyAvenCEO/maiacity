/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { aliases, paths } from './aven/ops/paths.js';
import { assetBox } from './maia/content/assets/box/plugin.js';
import { pageCsp } from './aven/kernel/sandbox/policy.js';
import { frozenEngines } from './aven/kernel/fetch-engines.mjs';

/** the folders the import aliases name beside the site, which the site's checks and dev server take in as the site's own */
const beside = Object.values(paths.aliases).filter((dir) => !(dir + '/').startsWith(paths.site + '/'));
/**
 * what those folders and the site's hold besides the pages' code, which the type check reads only where a page imports
 * it: the static files (the frozen engines' bytes among them, fetched by hash), the vault's code entries, and the game's and the
 * scripts' folders, which the API and bun run as well
 */
const unchecked = [paths.static, 'maia/content/code', 'maia/content/game', 'maia/content/scripts'];

function commit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return 'local';
	}
}

// a dev server's pages (`serve`) may also reach this machine; a build's never (aven/kernel/sandbox/policy.js pageCsp)
export default defineConfig(({ command }) => ({
	plugins: [
		// every frozen engine fetched by its hash into the static files first, as git does not carry them (aven/kernel/fetch-engines.mjs)
		frozenEngines(),
		tailwindcss(),
		// the asset box's worker, bundled whole (maia/content/assets/box)
		assetBox(),
		sveltekit({
			// where the site and its static files are, and the aliases of the folders that left its library
			// (aven/ops/paths.json): $avendb the page's avenDB, $kernel the kernel, $content the content
			files: { src: paths.site, assets: paths.static },
			alias: Object.fromEntries(Object.entries(aliases).filter(([name]) => name !== '$lib')),
			typescript: {
				config: (c) => {
					c.include.push(...beside.flatMap((dir) => ['js', 'ts', 'svelte'].map((e) => `../${dir}/**/*.${e}`)));
					c.exclude.push(...unchecked.map((dir) => `../${dir}/**`));
				}
			},

			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Caddy serves the prerendered site from the active immutable release.
			adapter: adapter({ fallback: '404.html' }),

			// Production uses the domain root; other mounts may supply BASE_PATH.
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
			// built, so a Mac of Maia City can witness the live site (aven/ops/release.mjs)
			version: { name: process.env.GITHUB_SHA || commit() },

			// every page's own policy (aven/kernel/sandbox/policy.js): the scripts it may run, its own start script by its
			// hash, written into each page as a <meta>, as a prerendered page has no headers of its own (aven/ops/deploy/Caddyfile
			// sends what a <meta> can't hold, frame-ancestors; the Mac app sends it with its own, theos/app/tauri.conf.json)
			csp: { mode: 'hash', directives: pageCsp((text) => createHash('sha256').update(text).digest('base64'), { dev: command === 'serve' }) }
		})
	],
	server: {
		// what sits beside the site, so Vite has to be told: the folders the aliases name, and what the pages read in the
		// browser (paths.json `served`): the rules the site and the API share (maia/content/game/: policies, the calendar, the cap
		// table, the globe), the journal, which avenDB's pages read (aven/db/page/article.js), the inspire-me library and
		// the journal's sources, the films, and the documents the repository proposes: the skills (aven/db/page/docs.js)
		fs: { allow: [...beside, ...paths.served] },
		// other sessions' worktrees and the Mac app's build folder change all day: watched, each one reloaded the
		// studio in the middle of a session
		watch: { ignored: ['**/.claude/**', '**/.cargo/**', '**/theos/target/**', '**/aven/db/target/**'] },
		// The preview harness assigns a free port via PORT.
		port: Number(process.env.PORT) || 5173,
		strictPort: !!process.env.PORT
	}
}));
