// The Peer-Light's worker (SANDBOX.md, "avenOS in the browser"): one per origin, shared by every tab and frame that
// shows it, since two Peer-Lights with one key would take the relay from each other. It runs the wasm core, posts
// every timeline line to the box, and tells every page that connects the lines so far and each new one.
const pages = new Set();
const lines = [];
let started;
let light;

function tell(line) {
	lines.push(line);
	if (lines.length > 200) lines.shift();
	for (const port of pages) port.postMessage(line);
	fetch(`/events/${JSON.parse(line).peer}`, { method: 'POST', body: line }).catch(() => {});
}

// A browser's own device key, on an Aven Peer's host without a cast (PRODUCTION.md, Part A): made here, in the
// browser, the first time, and kept in this origin's OPFS. It never leaves the browser.
async function deviceSecret() {
	const root = await navigator.storage.getDirectory();
	const handle = await root.getFileHandle('device-key', { create: true });
	let secret = (await (await handle.getFile()).text()).trim();
	if (!/^[0-9a-f]{64}$/.test(secret)) {
		secret = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
		const writable = await handle.createWritable();
		await writable.write(secret);
		await writable.close();
	}
	return secret;
}

// The Peer-Light is configured, never built for a place: its name, secret seed and the Aven Peer's key come from the
// page (a secret `opfs` is this browser's own, and without a name it goes by its key); its relay is this origin,
// where Vite (in the box) or Caddy (in production) passes /relay on to the Aven Peer.
// why the Peer-Light isn't running here, once its start has failed
let down;

async function start({ name, secret, avenKey, avenName, members }) {
	try {
		const url = '/peer-light/aven_peer_light.js';
		light = await import(/* @vite-ignore */ url);
		await light.default();
		if (secret === 'opfs') secret = await deviceSecret();
		await light.start(name, secret, self.location.origin, avenKey, avenName, tell, members ?? null);
	} catch (error) {
		down = String(error?.message ?? error);
		tell(JSON.stringify({ t: Date.now(), peer: name, event: 'failed', why: down }));
	}
}

function connect(port) {
	pages.add(port);
	port.onmessage = async ({ data }) => {
		if (data?.start) started ??= start(data.start);
		// a statement for the Aven Peer, a line for the chat's room, or a message as it is (the box's check), from the page.
		// The page sends its start with each, which only the first one here uses: a worker no page has started yet (Safari
		// can hand a page one) starts then, rather than failing on a Peer-Light it never loaded (aven.maia.city, 30 Oct)
		for (const call of ['send', 'say', 'post']) {
			if (data?.[call] === undefined) continue;
			await started;
			try {
				if (!light) throw new Error(`the Peer-Light isn't running: ${down ?? 'nothing started it'}`);
				light[call](data[call]);
			} catch (error) {
				port.postMessage(JSON.stringify({ t: Date.now(), peer: 'page', event: 'refused', why: String(error?.message ?? error) }));
			}
		}
	};
	for (const line of lines) port.postMessage(line);
	port.start?.();
}

// a SharedWorker hears each page as a port; a plain Worker, where SharedWorker is missing, is its own one port
if ('onconnect' in self) self.onconnect = (event) => connect(event.ports[0]);
else connect(self);
