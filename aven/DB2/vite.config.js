// avenOS in the browser, and the control room (SANDBOX.md). One server for both: `localhost` is the control room, and
// each Peer-Light's own origin (`alice.localhost`, `bob.localhost`) runs avenOS, so each keeps its own OPFS.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: 'app',
	plugins: [svelte()],
	// avenOS for the browser (`bun run build`), a deliverable of every release
	build: { outDir: '../dist', emptyOutDir: true },
	server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['localhost', '.localhost'] },
});
