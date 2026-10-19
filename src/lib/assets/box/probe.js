// @ts-nocheck — plain JS, runs inside the box
/*
 * WHAT THE BOX CAN'T DO — every way out an untrusted recipe would try, tried from inside the box, by a recipe like any
 * other (`probeRecipe`, made into a recipe file by ./plugin.js). Each answers `blocked` (refused, as it must be) or
 * `OPEN` (it got through: a hole), and the answers leave the box the only way anything does: as the names of the
 * parts of the object it builds. The box's page (/app/assets/box/) runs it; every answer must be blocked. With it,
 * `spinRecipe`: a builder that never stops, which the box must end; and `answerRecipe`: one that answers other
 * recipes' builds with its own model, which must never reach the page as theirs.
 */
import * as THREE from 'three';

const tries = {
	fetch: () => fetch('https://api.maia.city/api/me', { credentials: 'include' }).then((r) => r.status),
	'fetch same site': () => fetch('/').then((r) => r.status),
	XMLHttpRequest: () =>
		new Promise((ok, no) => {
			const x = new XMLHttpRequest();
			x.onload = () => ok(x.status);
			x.onerror = () => no(new Error('error'));
			x.open('GET', 'https://example.com/');
			x.send();
		}),
	WebSocket: () =>
		new Promise((ok, no) => {
			const w = new WebSocket('wss://echo.websocket.org/');
			w.onopen = () => ok('open');
			w.onerror = () => no(new Error('error'));
		}),
	EventSource: () =>
		new Promise((ok, no) => {
			const s = new EventSource('https://example.com/');
			s.onopen = () => ok('open');
			s.onerror = () => no(new Error('error'));
		}),
	importScripts: () => importScripts('https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'),
	'import()': () => import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'),
	indexedDB: () =>
		new Promise((ok, no) => {
			const r = indexedDB.open('box-probe');
			r.onsuccess = () => ok('opened');
			r.onerror = () => no(r.error);
		}),
	OPFS: () => navigator.storage.getDirectory().then(() => 'opened'),
	caches: () => caches.open('box-probe').then(() => 'opened'),
	'nested worker': () =>
		new Promise((ok, no) => {
			const w = new Worker('data:text/javascript,postMessage(fetch)');
			w.onmessage = () => ok('started');
			w.onerror = () => no(new Error('error'));
		}),
	BroadcastChannel: () => new BroadcastChannel('box-probe') && 'opened',
	'eval': () => (0, eval)('1 + 1'),
	'new Function': () => new Function('return 1')(),
	origin: () => (self.origin === 'null' ? Promise.reject(new Error('opaque origin')) : self.origin)
};

/** every way out, tried: { name: 'blocked: …' | 'OPEN: …' } */
export async function probe() {
	const out = {};
	for (const [name, attempt] of Object.entries(tries)) {
		try {
			const got = await Promise.race([Promise.resolve().then(attempt), new Promise((_, no) => setTimeout(() => no(new Error('no answer in 3 s')), 3000))]);
			out[name] = `OPEN: ${String(got).slice(0, 80)}`;
		} catch (err) {
			out[name] = `blocked: ${String(err?.message ?? err).slice(0, 80)}`;
		}
	}
	return out;
}

/** the probe as a recipe: an object with a part named for each way out and what came of it */
export const probeRecipe = () => ({
	meta: { group: 'things', id: 'probe', version: 1, label: 'Every way out' },
	build: async () => {
		const root = new THREE.Group();
		for (const [name, said] of Object.entries(await probe())) {
			const part = new THREE.Group();
			part.name = `${name}=${said}`;
			root.add(part);
		}
		return root;
	}
});

/**
 * A recipe that answers for others. From its start it hears every job its worker is handed, and the model it made
 * leaves again under each job of another recipe it hears, named as that recipe's, ahead of that recipe's own answer;
 * and, blind, for half a minute, under the next job numbers the page may ask, named as `target` (a recipe of ours, by
 * its hash). A box that gives each recipe a worker of its own hands it no job but its own, and takes no answer from it
 * for another's.
 */
export const answerRecipe = () => {
	const send = self.postMessage.bind(self);
	let mine = null;
	const forge = (id, recipe) => mine && send([{ ...mine, id, card: { ...mine.card, recipe } }, []]);
	// its own answer copied as it leaves (what leaves is moved), to be sent again as another's
	self.postMessage = (m, t) => {
		if (!mine && Array.isArray(m) && m[0]?.ok === true && m[0].card) mine = structuredClone(m[0]);
		return send(m, t);
	};
	self.addEventListener('message', (e) => {
		const m = e.data;
		if (m?.op === 'build' && typeof m.recipe?.hash === 'string') forge(m.id, m.recipe.hash);
	});
	return {
		meta: { group: 'things', id: 'answer', version: 1, label: 'A recipe that answers for others', params: [{ id: 'target', label: 'The recipe it answers as', type: 'string', value: '', maxLength: 64 }] },
		build: (target) => {
			const until = Date.now() + 30000;
			const blind = setInterval(() => {
				if (Date.now() > until) return clearInterval(blind);
				if (mine && target) for (let id = mine.id + 1; id <= mine.id + 40; id++) forge(id, target);
			}, 20);
			const root = new THREE.Group();
			const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#ff00ff' }));
			mesh.name = 'answered for another';
			root.add(mesh);
			return root;
		}
	};
};

/** a builder that never stops */
export const spinRecipe = () => ({
	meta: { group: 'things', id: 'spin', version: 1, label: 'A builder that never stops' },
	build: () => {
		for (;;);
	}
});
