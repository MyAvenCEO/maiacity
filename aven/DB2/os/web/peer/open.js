// Opens this origin's Peer-Light (store/README.md, "What the store asks of the opfs driver", 3): one per origin and
// name, run in a dedicated worker (peer/worker.js), the only place every engine has OPFS's sync access handles, by the
// one tab that holds the Web Lock `aven-peer-light:<name>`. Every tab, the leader's included, talks to it over the
// BroadcastChannel of the same name, with today's messages (start, box, ask, send, say, post) wrapped as
// `{ tab, data }` and its lines coming back as `{ to: tab, line }`. When the leader's tab closes, the next tab waiting
// for the lock starts the worker again; it says `{ leader: true }`, and every tab says hello and sends its start and its
// unanswered asks again. Frames are tabs. The page's API is the one the SharedWorker had: `{ worker, port }`.
// `new URL(…, import.meta.url)` stays written inside `new Worker(…)`, so Vite's build sees a worker and emits it as a
// file of its own; held in a variable, it was inlined as a `data:` URL with no OPFS (aven.maia.city, 30 Oct 2026).
export function openWorker(name) {
	const key = `aven-peer-light:${name}`;
	const channel = new BroadcastChannel(key);
	const tab = crypto.randomUUID();
	// the leader's worker's load errors, for the page that listens (network.svelte.js)
	const worker = { onerror: null };
	// what a new leader needs again: this tab's start (or the box's), and every ask not answered yet
	let begun;
	const asks = new Map();
	const port = {
		onmessage: null,
		postMessage(data) {
			if (data?.start || data?.box) begun = data.start ? { start: data.start } : { box: data.box };
			if (data?.ask) asks.set(data.ask.id, data);
			channel.postMessage({ tab, data });
		},
		start() {},
	};
	const hello = () => {
		channel.postMessage({ tab, hello: true });
		if (begun) channel.postMessage({ tab, data: begun });
		for (const ask of asks.values()) channel.postMessage({ tab, data: ask });
	};
	channel.onmessage = ({ data }) => {
		if (data?.leader) return hello();
		if (data?.to !== tab) return;
		try {
			const line = JSON.parse(data.line);
			if (line.event === 'answer') asks.delete(line.id);
		} catch {}
		port.onmessage?.({ data: data.line });
	};
	addEventListener('pagehide', () => channel.postMessage({ tab, bye: true }));
	// the device may be back: a phone that changed networks, came back online or woke the tab. The Peer-Light's link
	// dials again at once, without a reload (peer/light, `wake`)
	const wake = () => channel.postMessage({ tab, data: { wake: true } });
	addEventListener('online', wake);
	document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
	hello();
	const lead = () => {
		// this tab runs the Peer-Light now: the check's takeover step reads it (sandbox/chat.mjs)
		globalThis.__avenLeader = Date.now();
		// the browser may then keep its store under pressure; a worker can't ask (StorageManager.persist is a page's)
		navigator.storage?.persist?.().catch(() => {});
		const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: key });
		w.onerror = (event) => worker.onerror?.(event);
	};
	// held until this tab goes; a browser without Web Locks (Safari before 15.4) runs its own, as before
	if (navigator.locks) navigator.locks.request(key, () => new Promise(lead));
	else lead();
	return { worker, port };
}
