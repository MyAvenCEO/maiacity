// Serves a folder pack.mjs made to phones on the same network, and keeps what probe.html sends back.
//
//   bun scripts/lean-wasm/serve.mjs <folder> [port]
//
// Open http://<this computer's name>.local:<port>/probe.html on the phone. The page's numbers land in
// <folder>/results.jsonl, one line per run.

import { appendFileSync, existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, normalize } from 'node:path';

const [dir, port = '8765'] = process.argv.slice(2);
if (!dir) {
	console.error('usage: bun scripts/lean-wasm/serve.mjs <folder> [port]');
	process.exit(2);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };

Bun.serve({
	port: Number(port),
	hostname: '0.0.0.0',
	async fetch(req) {
		const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^\/+/, '') || 'probe.html';
		if (req.method === 'POST' && path === 'result') {
			const text = await req.text();
			appendFileSync(join(dir, 'results.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...JSON.parse(text) }) + '\n');
			console.log('result:', text);
			return new Response('kept');
		}
		const file = join(dir, path);
		if (path.startsWith('..') || !existsSync(file) || !statSync(file).isFile()) return new Response('not here', { status: 404 });
		const ext = path.slice(path.lastIndexOf('.'));
		return new Response(Bun.file(file), { headers: { 'content-type': types[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
	},
});
console.log(`serving ${dir} on http://${hostname()}.local:${port}/probe.html`);
