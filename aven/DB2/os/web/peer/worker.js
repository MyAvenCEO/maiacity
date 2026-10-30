// The Peer-Light's worker (SANDBOX.md, "avenOS in the browser"): one per origin, shared by every tab and frame that
// shows it, since two Peer-Lights with one key would take the relay from each other. It runs the wasm core, the page's
// one WebAssembly module, posts every timeline line to the box, and tells every page that connects the lines so far and
// each new one. The views of the tree (id.svelte.js) are a snapshot, not a timeline line: each page gets the newest, on
// connecting and whenever it changes. The box's own view (localhost) runs no peer: it loads the core for the views alone.
const pages = new Set();
const lines = [];
let views;
let started;
let light;

// the Peer-Light's wasm, loaded once, whether to start a peer, to compute the box's views or to answer an ask
let loading;
function load() {
	loading ??= (async () => {
		const url = '/peer-light/aven_peer_light.js';
		const core = await import(/* @vite-ignore */ url);
		await core.default();
		light = core;
	})();
	return loading;
}

// every chat line the Peer-Light told, by its name: the history a page that connects later gets whole
const chat = new Map();

function tell(line) {
	const event = JSON.parse(line);
	if (event.event === 'chat' && event.id) {
		chat.set(event.id, line);
		for (const port of pages) port.postMessage(line);
		fetch(`/events/${event.peer}`, { method: 'POST', body: line }).catch(() => {});
		return;
	}
	if (event.event === 'views') {
		views = line;
		for (const port of pages) port.postMessage(line);
		return;
	}
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

// In the box's cast `cast` is its tree, whose views the Peer-Light pushes at once.
async function start({ name, secret, avenKey, avenName, members, cast }) {
	try {
		await load();
		if (secret === 'opfs') secret = await deviceSecret();
		await light.start(name, secret, self.location.origin, avenKey, avenName, tell, members ?? null, cast ?? null);
	} catch (error) {
		down = String(error?.message ?? error);
		tell(JSON.stringify({ t: Date.now(), peer: name, event: 'failed', why: down }));
	}
}

// The box's own view: every view of the cast's tree as the box sees it, acting as every person and serving none
async function showBox({ cast }) {
	try {
		await load();
		tell(JSON.stringify({ t: Date.now(), peer: 'box', event: 'views', ...JSON.parse(light.views(cast, undefined)) }));
	} catch (error) {
		tell(JSON.stringify({ t: Date.now(), peer: 'box', event: 'failed', why: String(error?.message ?? error) }));
	}
}

// What a person's acts need computed, asked by a page and answered to it alone (peer/light/src/acts.rs)
const acts = new Set(['challenge', 'claimText', 'signInText', 'deviceId', 'passkeyId', 'personId', 'validPersonName']);
// a file shared in the chat, a chunk at a time, on the running Peer-Light's store (room.svelte.js)
const running = new Set(['put_chunk', 'share']);
for (const fn of running) acts.add(fn);
for (const fn of ['inviteId', 'inviteText', 'withdrawText', 'joinText', 'oneTimePublic', 'signJoin']) acts.add(fn);
async function answer(port, { id, fn, args }) {
	const reply = { t: Date.now(), peer: 'page', event: 'answer', id };
	try {
		if (!acts.has(fn)) throw new Error(`the Peer-Light computes no ${fn}`);
		await load();
		if (running.has(fn)) await started;
		reply.value = await light[fn](...args);
	} catch (error) {
		reply.error = String(error?.message ?? error);
	}
	port.postMessage(JSON.stringify(reply));
}

function connect(port) {
	pages.add(port);
	port.onmessage = async ({ data }) => {
		if (data?.start) started ??= start(data.start);
		if (data?.box) started ??= showBox(data.box);
		if (data?.ask) answer(port, data.ask);
		// a statement for the Aven Peer, a line for the chat's room, or a message as it is (the box's check), from the page.
		// The page sends its start with each, which only the first one here uses: a worker no page has started yet (Safari
		// can hand a page one) starts then, rather than failing on a Peer-Light it never loaded (aven.maia.city, 30 Oct)
		for (const call of ['send', 'say', 'post', 'post_line']) {
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
	for (const line of chat.values()) port.postMessage(line);
	if (views) port.postMessage(views);
	// a worker nobody has started asks its page for the start: Safari can bring one up behind a page that started an
	// earlier one, which then talks to it as if it ran
	if (!started) port.postMessage(JSON.stringify({ t: Date.now(), peer: 'page', event: 'start?' }));
	port.start?.();
}

// a SharedWorker hears each page as a port; a plain Worker, where SharedWorker is missing, is its own one port
if ('onconnect' in self) self.onconnect = (event) => connect(event.ports[0]);
else connect(self);
