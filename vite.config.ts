/// <reference types="node" />
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
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
			}
		})
	],
	server: {
		// game/ holds the rules the site and the API share (policies, the calendar,
		// the cap table, the globe); it sits beside src/, so Vite has to be told.
		fs: { allow: ['game'] },
		// other sessions' worktrees and the Mac app's build folder change all day: watched, each one reloaded the
		// studio in the middle of a session
		watch: { ignored: ['**/.claude/**', '**/.cargo/**', '**/vault/target/**', '**/avendb/target/**'] },
		// The preview harness assigns a free port via PORT.
		port: Number(process.env.PORT) || 5173,
		strictPort: !!process.env.PORT
	}
});
