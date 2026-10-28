// @ts-nocheck — plain JS, kept loose on purpose
/*
 * THE MATH CORE — the one way LaTeX we cannot trust becomes maths: a doc's formulas (`$…$`, `$$…$$`), whoever wrote
 * them, a person, an agent, an aven or a vault we follow. KaTeX turns each formula into MathML, and nothing else.
 *
 * - MathML only (`output: 'mathml'`): no inline styles, no fonts, no SVG and no CSS to load. The browser draws it.
 * - Trust off: `\href`, `\url`, `\includegraphics` and the HTML extension (`\htmlClass`, `\htmlStyle`, `\htmlId`,
 *   `\htmlData`) are refused. Strict: whatever is not LaTeX as KaTeX knows it is an error, and a command it doesn't know
 *   or refuses is no formula either: KaTeX marks those with `errorColor`, a colour no formula can name (`UNKNOWN`), and
 *   a formula that holds one, or an error, comes back as nothing. Its source is then shown as text.
 * - Bounded: `maxExpand` macro expansions a formula (a `\def` that calls itself stops there), `maxSize` ems for any size
 *   it sets, `LIMITS` characters a formula and of MathML, formulas a batch and work a batch. Each formula starts with no
 *   macros: nothing one formula defines reaches the next.
 * - It runs nowhere near a page: the math engine's worker runs it (./math-engine.js, frozen, in the shell of
 *   ./frame.js), and so do our tests. What it hands back is still only a string to the page, which checks every one
 *   (./mathml.js) before anything of it is drawn.
 *
 * KaTeX is passed in, so the page can read `LIMITS` without loading it.
 */

/** A colour no formula can name (KaTeX allows only `#hex` or letters): what KaTeX marks a command it does not run with. */
export const UNKNOWN = 'unsupported-command';

/**
 * What a formula may take: `tex` characters a formula; `batch` formulas a request (one doc's); `ms` of work a batch,
 * after which the formulas left are not typeset; `out` characters of MathML a formula, and `total` a batch.
 */
export const LIMITS = { tex: 4000, batch: 1000, ms: 4000, out: 200_000, total: 8_000_000 };

/** KaTeX's settings for every formula, `displayMode` and a fresh `macros` added for each. */
export const OPTIONS = Object.freeze({
	output: 'mathml',
	trust: false,
	throwOnError: false,
	strict: 'error',
	errorColor: UNKNOWN,
	maxExpand: 200,
	maxSize: 10,
	globalGroup: false
});

/** KaTeX's settings for one formula: display or inline, and macros of its own. @param {boolean} display */
export const settings = (display) => ({ ...OPTIONS, displayMode: display === true, macros: {} });

const WRAP = ['<span class="katex">', '</span>'];

/**
 * Formula `tex` as MathML (one `<math>` element), by KaTeX module `katex`; or null where it is too long, KaTeX
 * failed, or it holds anything KaTeX did not typeset (an error, a command it doesn't know or refuses).
 * @param {any} katex @param {unknown} tex @param {boolean} display @returns {string | null}
 */
export function one(katex, tex, display) {
	if (typeof tex !== 'string' || !tex.trim() || tex.length > LIMITS.tex) return null;
	let html;
	try {
		html = katex.renderToString(tex, settings(display));
	} catch {
		return null;
	}
	if (typeof html !== 'string' || !html.startsWith(WRAP[0]) || !html.endsWith(WRAP[1])) return null;
	const math = html.slice(WRAP[0].length, -WRAP[1].length);
	if (!math.startsWith('<math') || !math.endsWith('</math>') || math.length > LIMITS.out) return null;
	// an attribute's value is always escaped, so only KaTeX's own mark can stand here with its quotes
	if (math.includes(`="${UNKNOWN}"`)) return null;
	return math;
}

/**
 * Formulas `items` (`{ tex, display }` each, one doc's) as MathML, each by `one`: the first `LIMITS.batch` of them,
 * while the batch's work (`LIMITS.ms`, by `now`) and its MathML (`LIMITS.total`) last; null for each of the rest.
 * @param {any} katex @param {unknown} items @param {() => number} [now]
 * @returns {(string | null)[]}
 */
export function typeset(katex, items, now = () => performance.now()) {
	if (!Array.isArray(items)) return [];
	const start = now();
	let total = 0;
	return items.slice(0, LIMITS.batch).map((it) => {
		if (now() - start > LIMITS.ms || total > LIMITS.total) return null;
		const math = one(katex, it?.tex, it?.display === true);
		if (math) total += math.length;
		return math && total <= LIMITS.total ? math : null;
	});
}
