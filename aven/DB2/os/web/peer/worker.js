// The Peer-Light's worker (SANDBOX.md, "avenOS in the browser"): one per origin and name, run by the tab that holds the
// Web Lock (peer/open.js) and shared by every tab and frame over its BroadcastChannel, since two Peer-Lights with one key
// would take the relay from each other. It runs the wasm core, the page's one WebAssembly module, posts every timeline
// line to the box, and tells every page that connects the lines so far and each new one. The views of the tree (id.svelte.js) are a snapshot, not a timeline line: each page gets the newest, on
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
		if (event.file) {
			files.set(event.file.file, { type: event.file.type, key: event.key });
			for (const done of awaited.get(event.file.file) ?? []) done();
			awaited.delete(event.file.file);
		}
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

// A browser's own device key, on an Aven Peer's host without a cast (PRODUCTION.md, Part A): kept in the Peer-Light's
// store (the ref `device-key`), made here the first time. It never leaves the browser.
async function deviceSecret() {
	const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
	return light.deviceSecret(fresh);
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

// The chat's draft, the line being written and not yet sent (room.svelte.js), kept in this origin's OPFS beside the
// store (`/drafts/chat`), so it survives a reload: an update's above all (PEERS.md §7). One draft per origin, the newest
// written by any tab. Written through a sync access handle, which only a worker has in every engine; each write is
// told back to the page that asked (`draft-kept`), so it reloads only once its draft is on disk.
let drafting = Promise.resolve();
async function draftFile() {
	const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('drafts', { create: true });
	return dir.getFileHandle('chat', { create: true });
}
async function readDraft() {
	try {
		return await (await (await draftFile()).getFile()).text();
	} catch {
		return '';
	}
}
function keepDraft(port, { id, text }) {
	drafting = drafting.then(async () => {
		const reply = { t: Date.now(), peer: 'page', event: 'draft-kept', id };
		let handle;
		try {
			handle = await (await draftFile()).createSyncAccessHandle();
			const bytes = new TextEncoder().encode(String(text ?? ''));
			handle.truncate(0);
			handle.write(bytes, { at: 0 });
			handle.flush();
		} catch (error) {
			reply.error = String(error?.message ?? error);
		} finally {
			handle?.close();
		}
		port.postMessage(JSON.stringify(reply));
	});
}

function connect(port) {
	pages.add(port);
	port.onmessage = async ({ data }) => {
		if (data?.start) started ??= start(data.start);
		if (data?.box) started ??= showBox(data.box);
		if (data?.ask) answer(port, data.ask);
		if (data?.draft) keepDraft(port, data.draft);
		// online again or back in view (peer/open.js): the link dials at once if it isn't live
		if (data?.wake) light?.wake?.();
		// signing out (network.svelte.js): every page hears it, and the worker ends, so its store's handles are free
		if (data?.end) {
			tell(JSON.stringify({ t: Date.now(), peer: 'page', event: 'signed-out' }));
			self.close();
			return;
		}
		// a statement for the Aven Peer, a line for the chat's room or a delete of one, or a message as it is (the box's check), from the page.
		// The page sends its start with each, which only the first one here uses: a worker no page has started yet (Safari
		// can hand a page one) starts then, rather than failing on a Peer-Light it never loaded (aven.maia.city, 30 Oct)
		for (const call of ['send', 'say', 'retract', 'post', 'post_line']) {
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
	// the draft as this origin kept it, for the page's line to write in
	readDraft().then((text) => text && port.postMessage(JSON.stringify({ t: Date.now(), peer: 'page', event: 'draft', text })));
	// a worker nobody has started asks its page for the start: Safari can bring one up behind a page that started an
	// earlier one, which then talks to it as if it ran
	if (!started) port.postMessage(JSON.stringify({ t: Date.now(), peer: 'page', event: 'start?' }));
	port.start?.();
}

// Every tab reaches this worker over the BroadcastChannel named as the worker is, `aven-peer-light:<name>`
// (peer/open.js): each tab is a port of its own here, made the first time it speaks, gone when it says bye. A worker
// started by a new leader says so, and every tab says hello again.
const channel = new BroadcastChannel(self.name);
const tabs = new Map();
channel.onmessage = ({ data }) => {
	if (data?.read && data.id !== undefined) return read(data);
	if (data?.release && data.id !== undefined) return judge(data);
	if (!data?.tab) return;
	if (data.bye) {
		pages.delete(tabs.get(data.tab));
		tabs.delete(data.tab);
		return;
	}
	let port = tabs.get(data.tab);
	if (!port) {
		port = { postMessage: (line) => channel.postMessage({ to: data.tab, line }) };
		tabs.set(data.tab, port);
		connect(port);
	}
	if (data.data !== undefined) port.onmessage({ data: data.data });
};
channel.postMessage({ leader: true });

// A newer release, checked for the Service Worker (public/files-sw.js, PEERS.md §7): its record, the counter of the
// release this origin runs and the files the worker fetched, answered `{id, verdict}` by the Peer-Light this device runs
// now (`releaseCheck`, `Aven.ID.Release.check`), so the code it trusts checks the code that would replace it.
async function judge({ id, release: { record, running, fetched } }) {
	try {
		await load();
		channel.postMessage({ id, verdict: JSON.parse(light.releaseCheck(record, running ?? undefined, fetched)) });
	} catch (error) {
		channel.postMessage({ id, verdict: { verdict: 'refuse', why: String(error?.message ?? error) } });
	}
}

// A file's bytes for the Service Worker (public/files-sw.js, peer/bridge.js): `{id, read: {file, start, end}}`, `end`
// exclusive, answered `{id, size, type, bytes}` with at most 1 MiB, clamped to the file's length (`size`, for
// Content-Range), or `{id, error}`: "not found", or why not. Only the leader runs this worker, so only the leader
// answers. The type, and the device that shared the file, are its `file` line's; the bytes come through the
// Peer-Light's `file_range`, which fetches the chunks it lacks: from the Aven Peer, which keeps every file, or else from
// the device that shared it. A read asked again while this one is at it is the same read.
const MiB = 1 << 20;
// how much of each file this browser holds, told to every page when it grew: its card says "fetching 12 of 85 MB"
const held = new Map();
async function holding(file) {
	try {
		const got = await light.file_held(file);
		const was = held.get(file);
		if (was && was.held === got.held && was.len === got.len) return;
		held.set(file, { held: got.held, len: got.len });
		const line = JSON.stringify({ t: Date.now(), peer: 'page', event: 'held', file, held: got.held, len: got.len });
		for (const port of pages) port.postMessage(line);
	} catch {}
}
const files = new Map();
// reads that came before their file's chat line (a reload, a new leader): they wait a moment for it, since without its
// type the Service Worker can only serve the bytes as a download, which no player plays
const awaited = new Map();
const lineOf = (file, ms) =>
	files.get(file) ??
	new Promise((done) => {
		const told = () => done(files.get(file));
		awaited.set(file, [...(awaited.get(file) ?? []), told]);
		setTimeout(told, ms);
	});
const reading = new Set();
async function read({ id, read: { file, start = 0, end } }) {
	if (reading.has(id)) return;
	reading.add(id);
	setTimeout(() => reading.delete(id), 60_000);
	try {
		await started;
		const known = await lineOf(file, 5_000);
		if (!light) throw new Error(`the Peer-Light isn't running: ${down ?? 'nothing started it'}`);
		const from = Math.max(0, Number(start) || 0);
		const to = Math.min(Number.isFinite(Number(end)) ? Number(end) : from + MiB, from + MiB);
		// the Aven Peer, which keeps every file, then the device that shared it
		const holders = known?.key ? [undefined, known.key] : [undefined];
		let got;
		for (const [i, holder] of holders.entries()) {
			try {
				got = await light.file_range(file, from, to, holder);
				break;
			} catch (error) {
				if (i === holders.length - 1) throw error;
			}
		}
		channel.postMessage({ id, size: got.len, type: known?.type ?? null, bytes: got.bytes });
		holding(file);
	} catch (error) {
		channel.postMessage({ id, error: error?.name === 'NotFoundError' ? 'not found' : String(error?.message ?? error) });
	}
}
