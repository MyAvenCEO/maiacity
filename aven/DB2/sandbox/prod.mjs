// Production's stand-in in the box (PRODUCTION.md, "How it is checked"): avenOS at http://localhost:5174, served by the
// same Vite as every other view, in front of an Aven Peer in production's configuration (compose's `prod`: no cast,
// its tree in the box's S3 under a root of its own, the box's test MaiaCityGuardian). A passkey's RP ID is
// `localhost`, which Chromium accepts only on `localhost` itself, not on `*.localhost`: so this view is a port of its
// own, with its own origin and OPFS. On it, `/aven.json` tells avenOS which Aven Peer it is in front of, as production's host will, and
// the relay's paths go to that peer's relay, as Caddy will send aven.maia.city's: iroh dials `/relay` at its URL's
// root, so the route is by port, not by path.
import { request } from 'node:http';
import { createServer } from 'node:http';
import { connect } from 'node:net';

const relayPaths = ['/relay', '/ping', '/generate_204'];

export function prod({
	port = Number(process.env.AVENSANDBOX_PROD_PORT ?? 5174),
	relay = process.env.AVENSANDBOX_PROD_RELAY ?? 'http://localhost:3341',
	peer = process.env.AVENSANDBOX_PROD_KEY,
} = {}) {
	const target = new URL(relay);
	const relayed = (url) => relayPaths.some((path) => url === path || url.startsWith(`${path}?`) || url.startsWith(`${path}/`));
	const ours = (req) => req.socket.localPort === port;

	// a WebSocket to the relay, passed through whole: the request as it came, then both ways
	function tunnel(req, socket, head) {
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

	return {
		name: 'aven-prod',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!ours(req)) return next();
				const url = req.url ?? '/';
				if (url === '/aven.json') {
					if (!peer) return res.writeHead(503).end('the box gives no Aven Peer key: bun run up sets AVENSANDBOX_PROD_KEY');
					res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
					return res.end(JSON.stringify({ network: 'aven', peer, rpId: 'localhost' }));
				}
				if (!relayed(url)) return next();
				const out = request({ host: target.hostname, port: target.port, method: req.method, path: url, headers: req.headers }, (answer) => {
					res.writeHead(answer.statusCode ?? 502, answer.headers);
					answer.pipe(res);
				});
				out.on('error', () => res.writeHead(502).end());
				req.pipe(out);
			});
			// the second port: the same app, its relay upgraded to the prod peer's, and Vite's own WebSocket (hot reload)
			const second = createServer(server.middlewares);
			second.on('upgrade', (req, socket, head) => {
				if (relayed(req.url ?? '')) tunnel(req, socket, head);
				else server.httpServer?.emit('upgrade', req, socket, head);
			});
			second.listen(port, '0.0.0.0');
			server.httpServer?.on('close', () => second.close());
		},
	};
}
