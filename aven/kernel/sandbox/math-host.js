// @ts-nocheck — plain JS
/*
 * THE MATH HOST — how the page turns LaTeX we cannot trust into maths: KaTeX in the math engine (./math-engine.js,
 * frozen), in a worker of the shell (./frame.js), as the logic host runs QuickJS. Two walls: a worker in a frame with no
 * origin, no connection and nothing of ours in reach, its every way out taken off it (./lockdown.js); and the checker
 * (./mathml.js), through which every formula's MathML passes before anything of it is drawn, element by element, never
 * as HTML. KaTeX never runs in the page's own realm, and not on the page's thread: a batch that runs long cannot hold
 * the page.
 *
 * - Formulas go one doc's at a time, as one batch: at most `LIMITS.batch` of them, each at most `LIMITS.tex`
 *   characters; a longer one, or one past the batch, is not sent.
 * - The engine holds a batch to its own work budget (./math.js `LIMITS.ms`); the page gives it `TIMEOUT`, and a batch
 *   that runs past it ends its worker: the shell's frame is removed with it, and the next batch starts in a fresh one.
 *   The batch's formulas are then asked again in halves, until the one that overran is alone and given up; past
 *   `RETRIES` such ends, the rest of the batch is given up too (and asked again the next time a page asks).
 * - A formula that is too long, fails, overruns or comes back as anything the checker refuses has no MathML: the reader
 *   sees its LaTeX source as text, as before it was typeset.
 *
 * The engine is the latest frozen one, never one below the kind's floor (./engines.js): a formula names no engine.
 * Outside a page (our scripts and tests) there is no frame to make, and the core runs in the process itself, its
 * answers held to the same checker.
 *
 *   typeset(items)    [{ tex, display }] → for each, its checked tree (./mathml.js `check`) or null
 *   typesetIn(root)   every formula the Markdown engine left in `root` (a span.math[data-math]) typeset in place
 */
import { LIMITS, typeset as core } from './math.js';
import { check, draw } from './mathml.js';
import { engineFor, latestOf } from './engines.js';
import { BUDGETS } from './policy.js';

/** how long one batch may hold the math shell before its worker is ended (ms): past the engine's own budget */
export const TIMEOUT = BUDGETS.mathJob;

/** how many times a batch's worker may be ended before the rest of its formulas are given up */
export const RETRIES = 4;

const inPage = () => typeof document !== 'undefined' && typeof window !== 'undefined';

/**
 * A shell for math: the shell's walls, no WebAssembly, `TIMEOUT` a job, its workers running `code` (a frozen engine's,
 * checked against its hash: ./frame.js `engineCode`).
 * @param {() => Promise<string>} code
 */
export const mathShell = (code) => import('./frame.js').then(({ Shell }) => new Shell({ code, timeout: TIMEOUT }));

/** the page's math shell: the latest frozen math engine (never below the floor), started on first use */
let shell = null;
function shellOf() {
	if (!shell) {
		const e = engineFor('math', latestOf('math')?.v);
		shell = e ? import('./frame.js').then(({ engineCode }) => mathShell(() => engineCode('math', e.v))) : Promise.reject(new Error('no math engine is frozen'));
		shell.catch(() => (shell = null));
	}
	return shell;
}

/** whether `it` is a formula the page sends: text of at most `LIMITS.tex` characters */
const sendable = (it) => typeof it.tex === 'string' && it.tex.trim() !== '' && it.tex.length <= LIMITS.tex;

/**
 * Batch `batch` typeset by shell `s`: the engine's answer, a list of MathML strings or nulls as long as the batch; or
 * null where its worker was ended (it ran past `TIMEOUT`, or crashed) or the answer is not such a list.
 * @param {any} s @param {{ tex: string, display: boolean }[]} batch
 */
async function ask(s, batch) {
	try {
		const { out } = await s.ask('typeset', { items: batch });
		return Array.isArray(out) && out.length === batch.length && out.every((x) => x === null || typeof x === 'string') ? out : null;
	} catch {
		return null;
	}
}

/**
 * Batch `batch` typeset by shell `s`, the halves of one whose worker was ended asked again apart while `left.tries`
 * lasts: for each formula its MathML, null where the engine typeset none, undefined where it was given up.
 */
async function halves(s, batch, left) {
	const out = await ask(s, batch);
	if (out) return out;
	left.tries -= 1;
	if (batch.length === 1 || left.tries <= 0) return batch.map(() => undefined);
	const half = Math.ceil(batch.length / 2);
	return [...(await halves(s, batch.slice(0, half), left)), ...(await halves(s, batch.slice(half), left))];
}

/** Batch `batch` typeset: by shell `given`, else the page's own, else (no page) the core in this process. */
async function answers(batch, given) {
	if (!given && !inPage()) {
		const { default: katex } = await import('katex');
		return core(katex, batch);
	}
	const s = given ?? (await shellOf().catch(() => null));
	return s ? halves(s, batch, { tries: RETRIES }) : batch.map(() => undefined);
}

/** what the page's own shell typeset, by display and source: each formula's checked tree, or null (at most `KEPT`) */
const known = new Map();
const KEPT = 5000;
const keyOf = (it) => `${it.display ? 'D' : 'I'}${it.tex}`;

/**
 * Formulas `items` (`{ tex, display }` each, one doc's) typeset: for each its checked tree (./mathml.js `check`, which
 * `draw` makes into a `<math>` element), or null where it has none and its source is shown. `shell`: a shell of
 * `mathShell` to use instead of the page's own (the probe's), whose answers are not kept.
 * @param {{ tex: string, display?: boolean }[]} items @param {{ shell?: any }} [o]
 * @returns {Promise<(ReturnType<typeof check>)[]>}
 */
export async function typeset(items, { shell: given } = {}) {
	const all = (Array.isArray(items) ? items : []).map((it) => ({ tex: it?.tex, display: it?.display === true }));
	const kept = given ? new Map() : known;
	// each formula not typeset yet, once, and only as many as a batch holds
	const wanted = new Map();
	for (const it of all) if (!kept.has(keyOf(it)) && sendable(it) && wanted.size < LIMITS.batch) wanted.set(keyOf(it), it);
	if (wanted.size) {
		const batch = [...wanted.values()];
		const got = await answers(batch, given);
		if (kept.size + batch.length > KEPT) kept.clear();
		batch.forEach((it, i) => {
			// a formula given up when its worker was ended is not kept: the next ask tries it again
			if (got[i] === undefined) return;
			kept.set(keyOf(it), got[i] === null ? null : check(got[i], { display: it.display }));
		});
	}
	return all.map((it) => kept.get(keyOf(it)) ?? null);
}

/**
 * Every formula the Markdown engine (its `math` option) left in element `root`, a `span.math` whose words are its
 * LaTeX source and `data-math` whether it is inline or display, typeset: each one with MathML swapped in for its
 * source, drawn by the checker (./mathml.js `draw`); each one without kept as its source. A span no longer in the page
 * by then is left alone.
 * @param {Element} root
 */
export async function typesetIn(root) {
	const spans = [...root.querySelectorAll('span.math[data-math]')].filter((s) => !s.querySelector('math'));
	if (!spans.length) return;
	const trees = await typeset(spans.map((s) => ({ tex: s.textContent ?? '', display: s.dataset.math === 'display' })));
	trees.forEach((tree, i) => {
		const span = spans[i];
		if (tree && span.isConnected && !span.querySelector('math')) span.replaceChildren(draw(tree, span.ownerDocument));
	});
}
