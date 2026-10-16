// @ts-nocheck — plain JS, trusted: runs in the page
/*
 * THE LOWER LEVELS, MADE BESIDE THE PAGE — a renderer's (./index.js) levels of detail made from a finer level it has
 * (./simplify.js), in a worker of its own where the browser has one, so even the biggest machine (the LifeTrac, one
 * shape of 437,713 corners) never holds the page's frames: a second or two of simplifying happens off them. Without a
 * worker, in the page, a drawing at a time between frames. One kind at a time, in the order they were asked for, and
 * kept only in memory: a device that has the build makes its levels again in a moment.
 */
import * as THREE from 'three';
import { LEFT, lowerDraws } from './simplify.js';

/** a typed array on a buffer of its own, so that sending it copies only itself */
const own = (A) => (A.byteOffset === 0 && A.byteLength === A.buffer.byteLength ? A : A.slice());

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();

/** a level's drawing as plain arrays, with how big it is drawn at the most (its ball's diameter, m) */
export function plainOf(d) {
	const g = d.geometry;
	const attributes = {};
	for (const [k, a] of Object.entries(g.attributes)) {
		if (LEFT.has(k)) continue;
		const array = a.isInterleavedBufferAttribute ? Float32Array.from({ length: a.count * a.itemSize }, (_, i) => a.getComponent(Math.floor(i / a.itemSize), i % a.itemSize)) : own(a.array);
		attributes[k] = { array, itemSize: a.itemSize, normalized: a.normalized };
	}
	const index = g.index ? own(g.index.array) : Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i);
	if (!g.boundingSphere) g.computeBoundingSphere();
	let scale = 0;
	for (let k = 0; k < d.n; k++) {
		_m.fromArray(d.locals, k * 16).decompose(_p, _q, _s);
		scale = Math.max(scale, Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));
	}
	return { attributes, index, tris: d.tris, n: d.n, size: 2 * g.boundingSphere.radius * scale };
}

/** a level made from `source` and what the simplifier made of its drawings: its measure the source's */
export function levelOf(source, made) {
	const draws = [];
	made.draws.forEach((r, i) => {
		const d = source.draws[i];
		if (r === 'same') draws.push(d);
		else if (r) {
			const g = new THREE.BufferGeometry();
			for (const [k, a] of Object.entries(r.attributes)) g.setAttribute(k, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized));
			g.setIndex(new THREE.BufferAttribute(r.index, 1));
			g.computeBoundingBox();
			g.computeBoundingSphere();
			draws.push({ ...d, geometry: g, tris: r.index.length / 3 });
		}
	});
	// `same`: nothing taken away (every drawing kept as it is), so drawn as the level it was made from
	const same = made.draws.every((r) => r === 'same');
	return { ...source, draws, tris: draws.reduce((a, d) => a + d.tris * d.n, 0), same, made: { error: made.error, passes: made.passes } };
}

/**
 * The renderer's maker of lower levels.
 * @param {{ worker?: boolean }} [o] `worker: false` makes them in the page
 * @returns {{ lower: (source: import('./prepare.js').Level, plans: { budget: number, error: number, smallest: number }[]) => Promise<import('./prepare.js').Level[]>, readonly busy: number, dispose: () => void }}
 */
export function createLowering(o = {}) {
	/** @type {Worker | null} */
	let worker = null;
	/** no worker to be had (none here, or it stopped): the page makes them */
	let gone = o.worker === false;
	let disposed = false;
	let next = 1, busy = 0;
	/** @type {Map<number, { ok: Function, no: Function }>} */
	const waiting = new Map();
	/** one kind at a time: the next waits for the one before */
	let line = Promise.resolve();

	function start() {
		if (worker || gone || typeof Worker === 'undefined') return worker;
		try {
			worker = new Worker(new URL('./simplify.worker.js', import.meta.url), { type: 'module' });
		} catch {
			gone = true;
			return null;
		}
		worker.onmessage = (e) => {
			const w = waiting.get(e.data.id);
			waiting.delete(e.data.id);
			if (e.data.error) w?.no(new Error(e.data.error));
			else w?.ok(e.data.out);
		};
		// a worker that cannot start (no module workers, its code refused): the page does it, between frames
		worker.onerror = (e) => {
			e.preventDefault?.();
			gone = true;
			worker?.terminate();
			worker = null;
			for (const w of waiting.values()) w.no(Object.assign(new Error('the simplifying worker stopped'), { again: true }));
			waiting.clear();
		};
		return worker;
	}

	const frame = () => new Promise((ok) => setTimeout(ok, 0));

	/** the drawings lowered, in the worker or else in the page */
	async function run(draws, plans) {
		if (disposed) throw new Error('the renderer was disposed');
		const w = start();
		if (w) {
			try {
				return await new Promise((ok, no) => {
					const id = next++;
					waiting.set(id, { ok, no });
					w.postMessage({ id, draws, plans });
				});
			} catch (err) {
				if (!err.again) throw err;
			}
		}
		return lowerDraws(draws, plans, frame);
	}

	return {
		lower(source, plans) {
			busy++;
			const job = line.then(async () => {
				const made = await run(source.draws.map(plainOf), plans);
				return made.map((m) => levelOf(source, m));
			});
			line = job.catch(() => {}).finally(() => busy--);
			return job;
		},
		/** how many kinds are waiting for their levels, or being lowered */
		get busy() {
			return busy;
		},
		dispose() {
			disposed = true;
			worker?.terminate();
			worker = null;
			for (const w of waiting.values()) w.no(new Error('the renderer was disposed'));
			waiting.clear();
		}
	};
}
