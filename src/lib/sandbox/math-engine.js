// @ts-nocheck — plain JS, the math host's own code
/*
 * THE MATH ENGINE — what runs in the math host's worker (./math-host.js, inside the shell of ./frame.js): the shell's
 * second lock, KaTeX and the math core (./math.js), and nothing else. It runs no code of anyone's: it only reads
 * LaTeX. It is frozen by version: `node scripts/freeze-engine.mjs --math "…"` bundles this file into
 * static/engines/math-v<n>.js and writes its BLAKE3 hash into ./engines.json, and a frozen engine never changes. A new
 * KaTeX, or new settings, is a new engine, beside the old ones.
 *
 * What an engine promises (version 1): KaTeX 0.16.22, MathML only, trust off, strict, with the core's limits; each
 * formula on its own, with no macros carried from another.
 *
 * Messages: { id, op: 'typeset', items: [{ tex, display }] } is answered with { id, ok: true, out: [mathml | null] },
 * one for each formula of the batch, in order.
 */
import './lockdown.js';
import katex from 'katex';
import { typeset } from './math.js';

const answer = (m) => self.postMessage([m, []]);

self.onmessage = (e) => {
	const m = e.data;
	if (!m || typeof m !== 'object') return;
	if (m.op !== 'typeset' || !Array.isArray(m.items)) return answer({ id: m.id, ok: false, error: `no op ${String(m.op).slice(0, 40)}` });
	try {
		answer({ id: m.id, ok: true, out: typeset(katex, m.items) });
	} catch (err) {
		answer({ id: m.id, ok: false, error: String(err?.message ?? err).slice(0, 200) });
	}
};
answer({ op: 'ready' });
