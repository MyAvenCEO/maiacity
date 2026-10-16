// @ts-nocheck — plain JS, kept loose on purpose
/**
 * THE RULES EVERY KIND OF CODE IS HELD TO, before it is kept: what the one checker (./check.js) runs for each type.
 * Nothing here judges whether code is safe: that holds by construction (logic runs in QuickJS with nothing but the
 * language, a view in a frame only our engine writes, its script in a worker). These rules refuse, at the door and in
 * a sentence the author can act on, what could never work where the code runs: a view that loads from an address, a
 * logic module that imports, a handler written into the markup, data that is not plain JSON. A page that reads code
 * already kept draws it whatever these say; what they refuse, the engines drop anyway.
 *
 * No dependency: the API runs this from game/ as it is (api/Dockerfile copies game/ beside it).
 */

/** what any JSON a piece of code carries may cost */
export const JSON_LIMITS = { depth: 16, bytes: 200_000 };

const PROTO = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Whether `value` is plain JSON: no key that reaches a prototype, no function or class instance, no number that is
 * not finite, at most JSON_LIMITS deep and long. The first problem in a sentence, or ''.
 * @param {unknown} value @param {string} what how the sentence names it
 */
export function plainJson(value, what = 'its data', limits = JSON_LIMITS) {
	const walk = (v, path, depth) => {
		if (depth > limits.depth) return `${what} is more than ${limits.depth} levels deep${path ? ` at ${path}` : ''}`;
		// undefined is left out, as JSON.stringify leaves it out
		if (v === null || v === undefined || typeof v === 'string' || typeof v === 'boolean') return '';
		if (typeof v === 'number') return Number.isFinite(v) ? '' : `${what} holds a number that is not finite${path ? ` at ${path}` : ''}`;
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				const p = walk(v[i], `${path}[${i}]`, depth + 1);
				if (p) return p;
			}
			return '';
		}
		if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
			for (const k of Object.keys(v)) {
				if (PROTO.has(k)) return `${what} has a key "${k}", which no JSON of ours may hold`;
				const p = walk(v[k], path ? `${path}.${k}` : k, depth + 1);
				if (p) return p;
			}
			return '';
		}
		return `${what} holds a ${typeof v === 'object' ? 'class instance' : typeof v}${path ? ` at ${path}` : ''}, which is no JSON`;
	};
	const p = walk(value, '', 0);
	if (p) return p;
	const size = JSON.stringify(value ?? null).length;
	return size > limits.bytes ? `${what} is ${size} characters as JSON, more than ${limits.bytes}` : '';
}

/**
 * JavaScript with its comments and the insides of its strings blanked (quotes and line breaks kept, so every character
 * stays where it was): a scan reads only code, and a word in a comment or a string is never taken for an import.
 * Template literals keep their ${…} code.
 * @param {string} src
 */
export function codeOnly(src) {
	const out = src.split('');
	const blank = (from, to) => {
		for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
	};
	const n = src.length;
	const open = []; // template literals left open by a ${: the brace depth each one started at
	let braces = 0;
	let i = 0;
	/** a string's or template's inside from i, up to its closing quote; returns where it ended */
	const inside = (q) => {
		const from = i;
		while (i < n) {
			const e = src[i];
			if (e === '\\') {
				i += 2;
				continue;
			}
			if (q === '`' && e === '$' && src[i + 1] === '{') {
				blank(from, i);
				i += 2;
				open.push(braces);
				return;
			}
			if (e === q || (q !== '`' && e === '\n')) {
				blank(from, i);
				i++;
				return;
			}
			i++;
		}
		blank(from, n);
	};
	while (i < n) {
		const c = src[i];
		const d = src[i + 1];
		if (c === '/' && d === '/') {
			const end = src.indexOf('\n', i);
			blank(i, end < 0 ? n : end);
			i = end < 0 ? n : end;
		} else if (c === '/' && d === '*') {
			const end = src.indexOf('*/', i + 2);
			blank(i, end < 0 ? n : end + 2);
			i = end < 0 ? n : end + 2;
		} else if (c === "'" || c === '"' || c === '`') {
			i++;
			inside(c);
		} else if (c === '}' && open.length && open.at(-1) === braces) {
			open.pop();
			i++;
			inside('`');
		} else {
			if (c === '{') braces++;
			else if (c === '}') braces--;
			i++;
		}
	}
	return out.join('');
}

/** the names a module exports, as far as its text says (export function / const / let / class / { a, b as c } / default) */
export function exportsOf(src) {
	const code = codeOnly(src);
	const names = new Set();
	for (const m of code.matchAll(/\bexport\s+(?:async\s+)?(?:function\s*\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
	for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g))
		for (const part of m[1].split(',')) {
			const name = part.trim().split(/\s+as\s+/).at(-1)?.trim();
			if (name) names.add(name);
		}
	if (/\bexport\s+default\b/.test(code)) names.add('default');
	return [...names];
}

/** the module names a script imports: import … from, import '…', export … from, and import() of a plain string */
export function importsOf(src) {
	const code = codeOnly(src);
	const names = [];
	// the code shows where each name's quotes are; the name itself is read from the source, at the same place
	const named = (at) => {
		const q = code[at];
		const end = code.indexOf(q, at + 1);
		return end < 0 ? '' : src.slice(at + 1, end);
	};
	for (const m of code.matchAll(/(?:^|[;\s}])(?:import\s*(?:[\w$*{}\s,]+?\s*from\s*)?|export\s*[\w$*{}\s,]*?\s*from\s*)(['"])/g)) names.push(named(m.index + m[0].length - 1));
	for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])/g)) names.push(named(m.index + m[0].length - 1));
	return names;
}

/**
 * A logic module, as QuickJS will run it (src/lib/sandbox/logic.js): a text of at most `max` characters that
 * imports nothing (nothing is there to import) and exports at least one of `hooks`, if any are named.
 * The problems in sentences, and notes: exports no hook calls (kept, never called).
 * @param {string} src @param {{ what?: string, max?: number, hooks?: string[], needs?: boolean }} o
 */
export function logicSource(src, { what = 'its logic', max = 20_000, hooks = [], needs = false } = {}) {
	const errors = [];
	const notes = [];
	if (typeof src !== 'string') return { errors: [`${what} is JavaScript text`], notes };
	if (src.length > max) errors.push(`${what} is ${src.length} characters, more than ${max}`);
	if (src.includes('\0')) errors.push(`${what} holds a NUL character`);
	const code = codeOnly(src);
	if (importsOf(src).length || /\bimport\s*\(/.test(code)) errors.push(`${what} imports a module: it runs alone in QuickJS, where there is nothing to import; write what it needs inside it`);
	if (/(^|[^.\w$])require\s*\(/.test(code)) errors.push(`${what} calls require(): it runs alone in QuickJS, where there is nothing to require`);
	const exp = exportsOf(src);
	if (hooks.length) {
		const extra = exp.filter((e) => !hooks.includes(e));
		if (needs && src.trim() && !exp.some((e) => hooks.includes(e))) errors.push(`${what} exports none of ${hooks.join(', ')}, so nothing of it would ever run`);
		if (extra.length) notes.push(`${what} exports ${extra.slice(0, 5).join(', ')}, which no hook calls (the hooks: ${hooks.join(', ')})`);
	}
	return { errors, notes };
}

/** the module names a view's script may import, by the libraries it names (game/genui/views.js LIBS) */
export const LIB_MODULES = {
	three: (m) => m === 'three' || m.startsWith('three/addons/') || m.startsWith('three/examples/jsm/'),
	d3: (m) => m === 'd3',
	'mcp-apps': (m) => m === '@modelcontextprotocol/ext-apps' || m === '@modelcontextprotocol/ext-apps/app-with-deps'
};

// what in a view's markup would load from elsewhere, frame something or post a form: never possible here
const REACH = [
	[/<script\b[^>]*\bsrc\s*=/i, 'loads a script from an address: its libraries come with our engine (libs: three, d3, mcp-apps)'],
	[/<(iframe|frame|frameset|object|embed|applet|portal|fencedframe)\b/i, (m) => `holds an <${m[1].toLowerCase()}>: a view frames or embeds nothing`],
	[/<link\b/i, 'links a file (<link>): put its CSS in a <style> and its pictures in data: addresses'],
	[/<base\b/i, 'sets a <base>: a view has no address to resolve against'],
	[/<meta\b[^>]*http-equiv/i, 'sets a <meta http-equiv>: a view sets no header or refresh'],
	[/<form\b[^>]*\baction\s*=/i, 'posts a form to an address: a control sends its value as an event (data-event)'],
	[/\bjavascript\s*:/i, 'names a javascript: address, which never runs here'],
	[/@import\b/i, 'imports a stylesheet (@import): put the CSS in the view'],
	[/url\(\s*['"]?\s*(?:https?:)?\/\//i, 'loads a picture or font from an address in its CSS: use a data: address'],
	[/\s(?:src|href|xlink:href|poster|srcset|data|background)\s*=\s*['"]?\s*(?:https?:)?\/\//i, 'loads a file from an address: put pictures in data: addresses, or draw them'],
	[/<[a-z][\w-]*\b[^>]*\son[a-z]+\s*=/i, 'writes a handler into its markup (onclick=…), which never runs here: listen in its script (addEventListener), or name an event with data-event']
];

/**
 * A view's HTML: its markup and CSS hold nothing that reaches out, and its scripts import only the libraries it names.
 * `libs` are the view's libraries (game/genui/views.js LIBS). Problems in sentences, and notes on what will not work.
 * @param {string} html @param {{ what?: string, libs?: string[] }} o
 */
export function viewHtml(html, { what = 'the view', libs = [] } = {}) {
	const errors = [];
	const notes = [];
	if (typeof html !== 'string') return { errors: [`${what} is HTML text`], notes };
	const scripts = [];
	const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (all, attrs, code) => {
		scripts.push({ code, module: /\btype\s*=\s*['"]?module/i.test(attrs), src: /\bsrc\s*=/i.test(attrs) });
		return all.replace(code, '');
	});
	for (const [re, say] of REACH) {
		const m = markup.match(re);
		if (m) errors.push(`${what} ${typeof say === 'function' ? say(m) : say}`);
	}
	for (const s of scripts) {
		for (const name of importsOf(s.code)) {
			const lib = Object.keys(LIB_MODULES).find((l) => LIB_MODULES[l](name));
			if (!lib) errors.push(`${what}'s script imports "${name.slice(0, 80)}": a view's script may import only three (and three/addons/…), d3 and @modelcontextprotocol/ext-apps, each named in its libs`);
			else if (!libs.includes(lib)) errors.push(`${what}'s script imports "${name.slice(0, 80)}", but its libs do not name ${lib}: add "${lib}" to libs`);
		}
		const code = codeOnly(s.code);
		for (const [re, word] of [
			[/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection)\b/, 'network'],
			[/\b(localStorage|sessionStorage|indexedDB|caches|cookie)\b/, 'storage'],
			[/\b(importScripts|new\s+Worker|SharedWorker)\b/, 'scripts or workers of its own']
		]) {
			const m = code.match(re);
			if (m) notes.push(`${what}'s script uses ${m[1]}: a view has no ${word}, so that part does nothing; put its data in data`);
		}
	}
	const unused = libs.filter((l) => !scripts.some((s) => importsOf(s.code).some((n) => LIB_MODULES[l]?.(n))) && !(l === 'd3' && scripts.some((s) => /\bd3\./.test(codeOnly(s.code)))));
	if (unused.length) notes.push(`${what} names ${unused.join(', ')} in its libs and never imports ${unused.length > 1 ? 'them' : 'it'}`);
	return { errors, notes };
}
