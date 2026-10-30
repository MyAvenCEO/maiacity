// The box's wiring for the peers in Vite (SANDBOX.md, "The box", "The Control Room"). It serves the Peer-Light's wasm
// from the shared build folder and reloads the pages when it changes; it gathers every peer's events, JSON lines in
// one file per peer, into one timeline, and pushes it to the pages as server-sent events: a backlog, then each new
// line as it lands (README, rule 8). The Peer-Lights post their lines here; the Peers write theirs into the folder.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const cast = JSON.parse(readFileSync(new URL('./cast.json', import.meta.url), 'utf8'));
const lights = Object.keys(cast.peers).filter((id) => cast.peers[id].kind === 'peer-light');
const backlog = 400;
const types = { '.js': 'text/javascript', '.wasm': 'application/wasm' };

export function peers({ light = 'target/light', events = process.env.AVENSANDBOX_EVENTS ?? 'runs/events' } = {}) {
	mkdirSync(events, { recursive: true });
	const clients = new Set();
	const offsets = new Map();
	const recent = [];
	// each peer's newest record, which the views show however long ago it was told: kept beside the backlog's tail
	const stored = new Map();
	const keepStored = (lines) => {
		for (const line of lines) if (line.event === 'stored') stored.set(line.peer, line);
	};

	// every file's new whole lines since the last look
	function read() {
		const fresh = [];
		for (const name of readdirSync(events).filter((n) => n.endsWith('.jsonl'))) {
			const path = join(events, name);
			const size = statSync(path).size;
			const from = offsets.get(path) ?? 0;
			if (size < from) offsets.set(path, 0);
			if (size <= from) continue;
			const text = readFileSync(path).subarray(from, size).toString();
			const end = text.lastIndexOf('\n') + 1;
			offsets.set(path, from + Buffer.byteLength(text.slice(0, end)));
			for (const line of text.slice(0, end).split('\n'))
				try {
					if (line) fresh.push(JSON.parse(line));
				} catch {}
		}
		return fresh.sort((a, b) => a.t - b.t);
	}
	const first = read();
	keepStored(first);
	recent.push(...first.slice(-backlog));

	return {
		name: 'aven-peers',
		configureServer(server) {
			setInterval(() => {
				const fresh = read();
				if (!fresh.length) return;
				keepStored(fresh);
				recent.push(...fresh);
				recent.splice(0, Math.max(0, recent.length - backlog));
				for (const res of clients) for (const line of fresh) res.write(`data: ${JSON.stringify(line)}\n\n`);
			}, 200);

			let built = 0;
			setInterval(() => {
				const wasm = join(light, 'aven_peer_light_bg.wasm');
				const at = existsSync(wasm) ? statSync(wasm).mtimeMs : 0;
				if (built && at !== built) server.ws.send({ type: 'full-reload' });
				built = at;
			}, 500);

			server.middlewares.use((req, res, next) => {
				const url = new URL(req.url, 'http://box');
				if (req.method === 'GET' && url.pathname === '/events') {
					res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
					const told = [...stored.values()].filter((line) => !recent.includes(line)).sort((a, b) => a.t - b.t);
					for (const line of [...told, ...recent]) res.write(`data: ${JSON.stringify(line)}\n\n`);
					clients.add(res);
					req.on('close', () => clients.delete(res));
					return;
				}
				const posted = url.pathname.match(/^\/events\/([a-z0-9-]+)$/);
				if (req.method === 'POST' && posted) {
					// the cast's Peer-Lights, and the browsers of production's stand-in, named by their keys
					if (!lights.includes(posted[1]) && !/^device-[0-9a-f]{16}$/.test(posted[1])) return res.writeHead(403).end();
					let body = '';
					req.on('data', (chunk) => (body += chunk));
					req.on('end', () => {
						const lines = body.split('\n').filter((line) => {
							try {
								return JSON.parse(line).peer === posted[1];
							} catch {
								return false;
							}
						});
						if (lines.length) appendFileSync(join(events, `${posted[1]}.jsonl`), `${lines.join('\n')}\n`);
						res.writeHead(204).end();
					});
					return;
				}
				const file = url.pathname.match(/^\/peer-light\/([\w.-]+\.(js|wasm))$/);
				if (req.method === 'GET' && file) {
					const path = join(light, file[1]);
					if (!existsSync(path)) return res.writeHead(404).end('the Peer-Light is not built yet: bun run up builds it');
					res.writeHead(200, { 'content-type': types[`.${file[2]}`], 'cache-control': 'no-store' });
					return res.end(readFileSync(path));
				}
				next();
			});
		},
	};
}
