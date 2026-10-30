// avenOS in the browser (SANDBOX.md). One server for every view: `localhost` is the box's own, which can act as any
// vault, and each Peer-Light's own origin (`alice.localhost`, `bob.localhost`) runs avenOS as that device, so each keeps
// its own OPFS. The Aven Peer's relay is reached at every origin's own `/relay`, passed on to the `aven` container: the
// same path from the box's Chromium and from a browser on a Mac. avenOS reads the vault tree through aven-id's wasm,
// which `bun run up` and `bun run build` build into target/wasm/aven-id (id/core/wasm/build.sh). Production's stand-in,
// an Aven Peer that keeps its tree and is claimed with a passkey, is served at localhost:5174 (sandbox/prod.mjs).
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { peers } from './sandbox/peers.mjs';
import { prod } from './sandbox/prod.mjs';

const relay = process.env.AVENSANDBOX_RELAY ?? 'http://localhost:3340';

export default defineConfig({
	root: 'os/web',
	plugins: [svelte(), peers(), prod()],
	resolve: { alias: { 'aven-id': fileURLToPath(new URL('target/wasm/aven-id/aven_id.js', import.meta.url)) } },
	// avenOS for the browser (`bun run build`), a deliverable of every release
	build: { outDir: '../../dist', emptyOutDir: true },
	server: {
		host: '0.0.0.0',
		port: 5173,
		strictPort: true,
		allowedHosts: ['localhost', '.localhost'],
		proxy: {
			'/relay': { target: relay, ws: true },
			'/ping': { target: relay },
			'/generate_204': { target: relay },
		},
	},
});
