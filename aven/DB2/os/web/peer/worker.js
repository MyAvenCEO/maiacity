// The Peer-Light's worker (SANDBOX.md, "avenOS in the browser"): one per origin, shared by every tab and frame that
// shows it, since two Peer-Lights with one key would take the relay from each other. It runs the wasm core, posts
// every timeline line to the box, and tells every page that connects the lines so far and each new one.
const pages = new Set();
const lines = [];
let started;

function tell(line) {
	lines.push(line);
	if (lines.length > 200) lines.shift();
	for (const port of pages) port.postMessage(line);
	fetch(`/events/${JSON.parse(line).peer}`, { method: 'POST', body: line }).catch(() => {});
}

// The Peer-Light is configured, never built for a place: its name, secret seed and the Aven Peer's key come from the
// page; its relay is this origin, where Vite passes /relay on to the Aven Peer.
async function start({ name, secret, avenKey, avenName }) {
	try {
		// OpenDAL's OPFS backend finds OPFS through `web_sys::window()`, which a worker lacks; what it then calls,
		// navigator.storage.getDirectory(), a worker has. So the worker's own scope answers as the window. Our own OPFS
		// backend, with sync access handles in this worker, makes this go (SANDBOX.md, "Open questions").
		self.Window ??= self.constructor;
		const url = '/peer-light/aven_peer_light.js';
		const light = await import(/* @vite-ignore */ url);
		await light.default();
		await light.start(name, secret, self.location.origin, avenKey, avenName, tell);
	} catch (error) {
		tell(JSON.stringify({ t: Date.now(), peer: name, event: 'failed', why: String(error?.message ?? error) }));
	}
}

function connect(port) {
	pages.add(port);
	port.onmessage = ({ data }) => {
		if (data?.start) started ??= start(data.start);
	};
	for (const line of lines) port.postMessage(line);
	port.start?.();
}

// a SharedWorker hears each page as a port; a plain Worker, where SharedWorker is missing, is its own one port
if ('onconnect' in self) self.onconnect = (event) => connect(event.ports[0]);
else connect(self);
