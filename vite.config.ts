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
			paths: { base: (process.env.BASE_PATH ?? '') as '' | `/${string}` }
		})
	],
	server: {
		// game/ holds the rules the site and the API share (policies, the calendar,
		// the cap table, the globe); it sits beside src/, so Vite has to be told.
		fs: { allow: ['game'] },
		// The preview harness assigns a free port via PORT.
		port: Number(process.env.PORT) || 5173,
		strictPort: !!process.env.PORT
	}
});
