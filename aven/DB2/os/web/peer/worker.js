// The Peer-Light's worker (SANDBOX.md, "avenOS in the browser"): one per origin, shared by every tab and frame that
// shows it, since two Peer-Lights with one key would take the relay from each other. It runs the wasm core, posts
// every timeline line to the box, and tells every page that connects the lines so far and each new one.
import * as standin from './standin.js';

const pages = new Set();
const lines = [];
let started;
let light;

function tell(line) {
	if (standin.standing(light) && !standin.before(line, toPages)) return;
	toPages(line);
	fetch(`/events/${JSON.parse(line).peer}`, { method: 'POST', body: line }).catch(() => {});
}

function toPages(line) {
	lines.push(line);
	if (lines.length > 200) lines.shift();
	for (const port of pages) port.postMessage(line);
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
async function start({ name, secret, avenKey, avenName }) {
	try {
		const url = '/peer-light/aven_peer_light.js';
		light = await import(/* @vite-ignore */ url);
		await light.default();
		if (secret === 'opfs') secret = await deviceSecret();
		await light.start(name, secret, self.location.origin, avenKey, avenName, tell);
	} catch (error) {
		tell(JSON.stringify({ t: Date.now(), peer: name, event: 'failed', why: String(error?.message ?? error) }));
	}
}

function connect(port) {
	pages.add(port);
	port.onmessage = async ({ data }) => {
		if (data?.start) started ??= start(data.start);
		if (data?.say || data?.send) await started;
		if (standin.standing(light) && standin.take(data)) return;
		// a chat line from the page, for the room: the Peer-Light signs and gossips it (MILESTONE2.md, thread A)
		if (data?.say) {
			await started;
			try {
				light.say(data.say);
			} catch (error) {
				port.postMessage(JSON.stringify({ t: Date.now(), peer: 'page', event: 'refused', why: String(error?.message ?? error) }));
			}
		}
		// a claim, a sign-in, an invite, a withdrawal or a join for the Aven Peer, from the page
		if (data?.send) {
			await started;
			try {
				light.send(data.send);
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
