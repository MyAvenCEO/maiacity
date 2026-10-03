/*
 * BUILDING OFF THE PAGE — an animal's skin takes a few hundred milliseconds to sculpt and mesh, too long for a frame:
 * walking up to a flock would stutter. So the skins are meshed in workers beside the page (a few at once, one per
 * spare core), each handed back as plain arrays and kept (./sculpt.ts), and the animal is built from it in a moment
 * when it is wanted. Until its skin is ready an animal near the eye is drawn as it is from afar.
 *
 * A film waits for every skin asked for (`settled`), so a shot never renders an animal half there.
 */
import * as THREE from 'three';
import { keep, type Skin } from './sculpt';

type Sent = { key: string; bones: string[]; pos: Float32Array; nrm: Float32Array; col: Float32Array; idx: Uint32Array; index: Uint16Array; weight: Float32Array };

const pending = new Map<string, Promise<void>>();
const done = new Set<string>();
let workers: Worker[] = [];
let turn = 0;
let calls = 0;
const waiting = new Map<number, () => void>();

function pool(): Worker[] {
	if (workers.length || typeof Worker === 'undefined') return workers;
	const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
	workers = Array.from({ length: n }, () => {
		const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (e: MessageEvent<{ call: number; skins: Sent[] }>) => {
			for (const s of e.data.skins) {
				const geo = new THREE.BufferGeometry();
				geo.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
				geo.setAttribute('normal', new THREE.BufferAttribute(s.nrm, 3));
				geo.setAttribute('color', new THREE.BufferAttribute(s.col, 3));
				geo.setIndex(new THREE.BufferAttribute(s.idx, 1));
				keep(s.key, { geo, bones: s.bones, index: s.index, weight: s.weight } satisfies Skin);
			}
			waiting.get(e.data.call)?.();
			waiting.delete(e.data.call);
		};
		return w;
	});
	return workers;
}

/** Mesh an actor's skins (`id` as ./casts.ts names it, at a level of detail) in a worker; resolves when they are kept. */
export function prepare(id: string, detail = 1): Promise<void> {
	const key = `${id}@${detail}`;
	if (pending.has(key)) return pending.get(key)!;
	const ws = pool();
	const p = !ws.length
		? Promise.resolve()
		: new Promise<void>((resolve) => {
				const call = ++calls;
				waiting.set(call, () => {
					done.add(key);
					resolve();
				});
				ws[turn++ % ws.length]!.postMessage({ call, id, detail });
			});
	pending.set(key, p);
	return p;
}

/** whether an actor's skins are ready (or there are no workers, and it is meshed when built) */
export const ready = (id: string, detail = 1) => done.has(`${id}@${detail}`) || !pool().length;

/** every skin asked for, ready */
export async function settled() {
	await Promise.all(pending.values());
}

/** the arrays a skin is sent as */
export function packed(key: string, s: Skin): [Sent, Transferable[]] {
	const g = s.geo;
	const pos = g.attributes.position!.array as Float32Array, nrm = g.attributes.normal!.array as Float32Array, col = g.attributes.color!.array as Float32Array;
	const idx = Uint32Array.from(g.index!.array as ArrayLike<number>);
	const index = s.index.slice(), weight = s.weight.slice();
	const out: Sent = { key, bones: s.bones, pos: pos.slice(), nrm: nrm.slice(), col: col.slice(), idx, index, weight };
	return [out, [out.pos.buffer, out.nrm.buffer, out.col.buffer, idx.buffer, index.buffer, weight.buffer]];
}
