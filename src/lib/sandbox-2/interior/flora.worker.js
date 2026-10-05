/*
 * FLORA'S WORKER — grows one of our plants ($lib/plants) off the page, at a stage, a seed and a detail, and hands back
 * its shape as plain arrays (./flora.js puts them on the graphics card). Several of these grow a forest's plants side
 * by side while the world loads.
 */
import { grow } from './flora.grow.js';

self.onmessage = (/** @type {MessageEvent<{ job: number, kind: import('./flora.grow.js').Kind, tier: 'near' | 'mid' }>} */ e) => {
	const { job, kind, tier } = e.data;
	try {
		const shape = grow(kind, tier);
		const transfer = shape.parts.flatMap((p) => [p.position.buffer, p.normal.buffer, p.color.buffer, p.index.buffer]);
		self.postMessage({ job, shape }, { transfer });
	} catch (err) {
		self.postMessage({ job, error: String(err) });
	}
};
