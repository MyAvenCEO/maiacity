// avenOS in the browser (SANDBOX.md). One server for every view: `localhost` is the box's own, which can act as any
// vault, and each Peer-Light's own origin (`alice.localhost`, `bob.localhost`) runs avenOS as that device, so each keeps
// its own OPFS.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	root: 'os/web',
	plugins: [svelte()],
	// avenOS for the browser (`bun run build`), a deliverable of every release
	build: { outDir: '../../dist', emptyOutDir: true },
	server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: ['localhost', '.localhost'] },
});
