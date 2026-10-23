// @ts-nocheck — plain JS, kept loose on purpose
/**
 * theOS's activity, as its log says it (vault/app/src/activity.rs), read into rows for avenDB's Activity view
 * (./Activity.svelte): each line its number, time, level, where it came from and what it says. The app's log is
 * `tracing`'s plain lines, `2026-10-21T11:35:15.934Z DEBUG avendb_device: call run`, spans before the target
 * (`router.accept{me=4926d82c53}: iroh::protocol: …`), ANSI colours in it.
 */

/** The levels, the quietest last, as the log names them. */
export const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

/** Where a line comes from, by its target: avenDB's device and engine, the network, the store, the app's pages, the app. */
export const SOURCES = [
	['avendb', 'avenDB'],
	['network', 'Network'],
	['store', 'Store'],
	['pages', 'Pages'],
	['app', 'App']
];

/** Source `target` comes from. @param {string} target */
export function sourceOf(target) {
	if (/^avendb/.test(target)) return 'avendb';
	if (/^(iroh|noq|quinn|hickory|netwatch|portmapper|swarm_discovery|n0)/.test(target)) return 'network';
	if (/^(loro|redb|sled)/.test(target)) return 'store';
	if (target === 'webview') return 'pages';
	return 'app';
}

const ANSI = /\x1b\[[0-9;]*m/g;
const LINE = /^(\S+)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(.*)$/;
// a target: a module path, `a::b::c`
const TARGET = /^[A-Za-z_]\w*(?:::\w+)*$/;

/**
 * Text `rest` cut at each `: ` outside braces: the spans (`name{fields}`, joined by `:`, fields that hold braces and
 * colons of their own), the target, then the message, whose own `: ` it cuts too. @param {string} rest
 */
function cuts(rest) {
	const parts = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < rest.length; i++) {
		const c = rest[i];
		if (c === '{') depth++;
		else if (c === '}') depth = Math.max(0, depth - 1);
		else if (c === ':' && rest[i + 1] === ' ' && depth === 0) {
			parts.push([rest.slice(from, i), i + 2]);
			from = i + 2;
		}
	}
	return parts;
}

/**
 * Line `text`, number `n`, as a row: `{ n, time, level, target, spans, source, message, text }`. A line that isn't
 * `tracing`'s (a panic's, a child's stderr) is the previous row's continuation: `level` '' and the whole text its message.
 * @param {number} n @param {string} text
 */
export function parse(n, text) {
	const plain = String(text).replace(ANSI, '');
	const m = LINE.exec(plain);
	if (!m) return { n, time: '', level: '', target: '', spans: '', source: 'app', message: plain, text: plain };
	const [, time, level, rest] = m;
	// the spans come first, each with braces or a dash in it; the first module path is the target
	const spans = [];
	for (const [part, after] of cuts(rest)) {
		if (TARGET.test(part)) {
			const target = part;
			return { n, time, level, target, spans: spans.join(' › '), source: sourceOf(target), message: rest.slice(after), text: plain };
		}
		if (!/[{-]/.test(part)) break;
		spans.push(...part.split(/(?<=\}):|:(?=[\w.-]+\{)/));
	}
	return { n, time, level, target: '', spans: '', source: 'app', message: rest, text: plain };
}

/** The device's calls the page itself makes every few seconds, which say nothing new. */
const POLLS = new Set(['run', 'agents', 'drives', 'changed', 'stirred', 'status', 'steps', 'size', 'moving', 'qrSvg', 'agentDevices', 'sessions']);

/**
 * Whether row `r` is routine: a call the page polls the device with, or the store's own block diagnostics, which
 * fill the log by the thousand and tell a person nothing. @param {any} r
 */
export function routine(r) {
	if (r.target === 'avendb_device' && /^call \w+$/.test(r.message)) return POLLS.has(r.message.slice(5));
	return /^loro_internal::oplog::change_store::block_encode/.test(r.target);
}

/**
 * The rows of `rows` filter `f` keeps: of its levels (`levels`, a Set), its sources (`sources`, a Set), not routine
 * where `quiet`, and with every word of `search` in the line. @param {any[]} rows @param {any} f
 */
export function keep(rows, { levels, sources, quiet, search }) {
	const words = String(search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
	return rows.filter(
		(r) =>
			(!r.level || levels.has(r.level)) &&
			sources.has(r.source) &&
			!(quiet && routine(r)) &&
			words.every((w) => r.text.toLowerCase().includes(w))
	);
}

/** Time `iso` as a person reads it here: the local hour, minute, second and milliseconds. @param {string} iso */
export function clock(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	const two = (x) => String(x).padStart(2, '0');
	return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
