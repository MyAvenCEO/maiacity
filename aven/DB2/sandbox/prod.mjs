// Production's stand-in in the box (PRODUCTION.md, "How it is checked"): avenOS at http://localhost:5174, served by the
// same Vite as every other view, in front of an Aven Peer in production's configuration (compose's `prod`: no cast,
// its tree in the box's S3 under a root of its own, the box's test MaiaCityGuardian). A passkey's RP ID is
// `localhost`, which Chromium accepts only on `localhost` itself, not on `*.localhost`: so this view is a port of its
// own, with its own origin and OPFS. On it, `/aven.json` tells avenOS which Aven Peer it is in front of, as production's host will, and
// the relay's paths go to that peer's relay, as Caddy will send aven.maia.city's: iroh dials `/relay` at its URL's
// root, so the route is by port, not by path.
//
// `served` stands in for aven.maia.city itself: avenOS's release build (dist/, `bun run build`) as Caddy serves it
// (aven/ops/deploy/Caddyfile: the files, any other path answered with index.html, /aven.json, the relay passed on).
// The dev server above never runs the build, and a build without its Peer-Light never went live (30 Oct 2026).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { extname, join } from 'node:path';

const relayPaths = ['/relay', '/ping', '/healthz', '/generate_204'];
const relayed = (url) => relayPaths.some((path) => url === path || url.startsWith(`${path}?`) || url.startsWith(`${path}/`));
const config = (peer) => JSON.stringify({ network: 'aven', peer, rpId: 'localhost' });

// a WebSocket to the relay, passed through whole: the request as it came, then both ways
function tunnel(target, req, socket, head) {
	const upstream = connect(Number(target.port), target.hostname, () => {
		const headers = [];
		for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
		upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join('\r\n')}\r\n\r\n`);
		upstream.write(head);
		socket.pipe(upstream).pipe(socket);
	});
	upstream.on('error', () => socket.destroy());
	socket.on('error', () => upstream.destroy());
}

// the relay's plain HTTP paths (its latency probe, health, the captive-portal check), passed on
function pass(target, req, res) {
	const out = request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
		res.writeHead(answer.statusCode ?? 502, answer.headers);
		answer.pipe(res);
	});
	out.on('error', () => res.writeHead(502).end());
	req.pipe(out);
}

export function prod({
	port = Number(process.env.AVENSANDBOX_PROD_PORT ?? 5174),
	relay = process.env.AVENSANDBOX_PROD_RELAY ?? 'http://localhost:3341',
	peer = process.env.AVENSANDBOX_PROD_KEY,
} = {}) {
	const target = new URL(relay);
	const ours = (req) => req.socket.localPort === port;

	return {
		name: 'aven-prod',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!ours(req)) return next();
				const url = req.url ?? '/';
				if (url === '/aven.json') {
					if (!peer) return res.writeHead(503).end('the box gives no Aven Peer key: bun run up sets AVENSANDBOX_PROD_KEY');
					res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
					return res.end(config(peer));
				}
				if (!relayed(url)) return next();
				pass(target, req, res);
			});
			// the second port: the same app, its relay upgraded to the prod peer's, and Vite's own WebSocket (hot reload)
			const second = createServer(server.middlewares);
			second.on('upgrade', (req, socket, head) => {
				if (relayed(req.url ?? '')) tunnel(target, req, socket, head);
				else server.httpServer?.emit('upgrade', req, socket, head);
			});
			// A restart (vite.config.js or a plugin changed) makes the new server before it closes the old one: so this
			// port listens with Vite's own, and goes with the old server's close, not after its last connection, which a
			// relay's WebSocket holds (EADDRINUSE otherwise)
			server.httpServer?.once('listening', () => second.listen(port, '0.0.0.0'));
			const http = server.httpServer;
			if (http) {
				const close = http.close.bind(http);
				http.close = (done) => {
					second.close();
					return close(done);
				};
			}
		},
	};
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };

// avenOS's build at http://localhost:PORT, as Caddy serves aven.maia.city, in front of the prod peer; resolves once it
// listens, to the server
export function served({
	root,
	port,
	relay = process.env.AVENSANDBOX_PROD_RELAY ?? 'http://localhost:3341',
	peer = process.env.AVENSANDBOX_PROD_KEY,
}) {
	const target = new URL(relay);
	const server = createServer((req, res) => {
		const url = req.url ?? '/';
		if (url === '/aven.json') {
			res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			return res.end(config(peer));
		}
		if (relayed(url)) return pass(target, req, res);
		// Caddy's try_files: the file, or the page
		let file = join(root, decodeURIComponent(new URL(url, 'http://x').pathname));
		if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
		res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
		res.end(readFileSync(file));
	});
	server.on('upgrade', (req, socket, head) => (relayed(req.url ?? '') ? tunnel(target, req, socket, head) : socket.destroy()));
	return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}
