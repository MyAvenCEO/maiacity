// @ts-nocheck — plain JS, trusted: the renderer's own worker (./lower.js)
/*
 * THE SIMPLIFYING WORKER — a kind's drawings come in as plain arrays, and go back lighter, once for each level asked
 * for (./simplify.js), their arrays handed over, not copied. Nothing of an asset runs here: only our simplifier, on
 * numbers the page has checked.
 */
import { lowerDraws } from './simplify.js';

self.onmessage = async (e) => {
	const { id, draws, plans } = e.data;
	try {
		const out = await lowerDraws(draws, plans);
		const moved = new Set();
		for (const level of out)
			for (const d of level.draws) {
				if (!d || d === 'same') continue;
				moved.add(d.index.buffer);
				for (const a of Object.values(d.attributes)) moved.add(a.array.buffer);
			}
		self.postMessage({ id, out }, [...moved]);
	} catch (err) {
		self.postMessage({ id, error: String(err?.message ?? err) });
	}
};
