// The landing page and the control room (SANDBOX.md). One server for both: `localhost` is the control room, and each
// Peer-Light's own origin (`alice.localhost`, `bob.localhost`) shows its landing page, so each keeps its own OPFS.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: 'app',
	plugins: [svelte()],
	server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['localhost', '.localhost'] },
});
