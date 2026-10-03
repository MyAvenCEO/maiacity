// The grade as stackable tools, read from their one registry (grade-tools.json: every tool's name, group, kind — a
// colour change on every pixel, a mask group, a texture of the frame — and its controls with their ranges and
// defaults). The maths of every tool is Rust's alone (vault-render `tools.rs`, on Metal), and so are its checks: its
// tests hold them to this same registry. Here is no tool of its own — only the registry read: the studio draws every
// control from it, and the API keeps every saved control inside the range it names.
//
// A tool on a stack: `{ tool: "<id>", on?: false, ...its controls }`. A mask (window, colour key) is a group: it holds
// a stack of its own (`tools`), applied only inside the mask, by `mix` — any tool goes in, and masks nest (a key inside
// a window: where both are).
//
// A stack: `{ strength?: 0…1, tools: [...] }`. The grade's stacks, in the order they apply:
//   a shot's   `stacks.base`  Base correct   (the fixed first nodes: its balance)
//              `stacks.clip`  Clip look      (its own look; its framing beside it, `frame`)
//   the film's `grade.scenes[scene]`  Scene look (every shot of the scene)
//              `grade.timeline`       Timeline look (the film's texture — grain, vignette … — its last tools)

// The registry itself is data — grade-tools.json — read by this module and by vault-render (`tools.rs`, its tests
// check the Rust's checks against it), so a new tool is one entry there and its maths in Rust.
import registry from './grade-tools.json' with { type: 'json' };


/** @typedef {'number' | 'choice' | 'flag' | 'trio' | 'curve' | 'hash'} ParamType */
/** A control: `def` is what it is when a saved tool doesn't say; `new`, what a tool newly put on a stack starts with
 *  when that is not its default (a balance starts linear; one saved before linear was there stays as it was).
 *  @typedef {{ key: string, label: string, type?: ParamType, min?: number, max?: number, step?: number, def: any, new?: any, unit?: string, choices?: string[], wrap?: boolean }} Param */
/** @typedef {'colour' | 'mask' | 'texture'} ToolKind */
/** @typedef {{ id: string, label: string, group: string, kind: ToolKind, what: string, params: Param[] }} ToolDef */

/** @type {ToolDef[]} */
export const TOOLS = /** @type {any} */ (registry.tools);

export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
export const TOOL_GROUPS = [...new Set(TOOLS.map((t) => t.group))];

/** The grade's stacks (bundles), in the order they apply. @type {{ id: string, label: string, of: 'shot' | 'scene' | 'timeline', starter: string[] }[]} */
export const BUNDLES = /** @type {any} */ (registry.bundles);

const MAX_DEPTH = 3;
const MAX_TOOLS = 24;

const clamp = (/** @type {any} */ x, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ d) => {
	const k = Number(x);
	return x !== null && x !== undefined && x !== '' && Number.isFinite(k) ? Math.min(hi, Math.max(lo, k)) : d;
};
/** degrees around the circle, as Rust wraps them (`deg`) */
const deg = (/** @type {any} */ x, /** @type {number} */ d) => ((clamp(x, -720, 720, d) % 360) + 360) % 360;

/** A tool with its controls filled in (the defaults where it has none). @param {string} id */
export function newTool(id) {
	const def = TOOL[id];
	if (!def) throw new Error(`no grading tool "${id}"`);
	/** @type {any} */
	const t = { tool: id };
	for (const p of def.params) t[p.key] = structuredClone(p.new ?? p.def);
	if (def.kind === 'mask') t.tools = [];
	return t;
}

/** One tool as data, checked as Rust checks it (`tools::clean`): its controls in range; null when not a tool. */
export function cleanTool(/** @type {any} */ v, depth = 0) {
	if (!v || typeof v !== 'object' || !TOOL[v.tool]) return null;
	const def = TOOL[v.tool];
	/** @type {any} */
	const out = { tool: def.id };
	if (v.on === false) out.on = false;
	for (const p of def.params) {
		const x = v[p.key];
		switch (p.type) {
			case 'trio':
				out[p.key] = [0, 1, 2].map((i) => clamp(Array.isArray(x) ? x[i] : x, /** @type {number} */ (p.min), /** @type {number} */ (p.max), p.def[i]));
				break;
			case 'choice':
				out[p.key] = p.choices?.includes(x) ? x : p.def;
				break;
			case 'flag':
				out[p.key] = typeof x === 'boolean' ? x : p.def;
				break;
			case 'curve':
				out[p.key] = (Array.isArray(x) ? x : [])
					.filter((q) => Array.isArray(q) && q.length >= 2)
					.slice(0, 16)
					.map((q) => [deg(q[0], 0), clamp(q[1], /** @type {number} */ (p.min), /** @type {number} */ (p.max), p.key === 'hue_sat' ? 1 : 0)])
					.sort((a, b) => a[0] - b[0]);
				break;
			case 'hash':
				out[p.key] = typeof x === 'string' && /^[0-9a-f]{64}$/.test(x) ? x : '';
				break;
			default:
				// a hue goes around the circle (`wrap`: 640° is 280°); every other control stays in its range
				out[p.key] = p.wrap ? deg(x, p.def) : clamp(x, /** @type {number} */ (p.min), /** @type {number} */ (p.max), p.def);
		}
	}
	if (def.kind === 'mask') out.tools = depth < MAX_DEPTH ? cleanTools(v.tools, depth + 1) : [];
	if (def.id === 'lut' && !out.hash) return null;
	return out;
}

/** A list of tools, checked. @returns {any[]} */
export const cleanTools = (/** @type {any} */ v, depth = 0) => (Array.isArray(v) ? v.slice(0, MAX_TOOLS).map((t) => cleanTool(t, depth)).filter(Boolean) : []);

/** A stack, checked: null when it holds no tool. */
export function cleanStack(/** @type {any} */ v) {
	if (!v || typeof v !== 'object') return null;
	const tools = cleanTools(Array.isArray(v) ? v : v.tools);
	if (!tools.length) return null;
	const strength = clamp(v.strength ?? 1, 0, 1, 1);
	return strength === 1 ? { tools } : { strength, tools };
}

/** A shot's stacks (base, clip), checked; null when none. */
export function cleanClipStacks(/** @type {any} */ v) {
	if (!v || typeof v !== 'object') return null;
	/** @type {any} */
	const out = {};
	for (const k of ['base', 'clip']) {
		const s = cleanStack(v[k]);
		if (s) out[k] = s;
	}
	return Object.keys(out).length ? out : null;
}

/** The film's stacks (timeline, scenes), checked. */
export function cleanFilmStacks(/** @type {any} */ v) {
	/** @type {any} */
	const out = {};
	if (!v || typeof v !== 'object') return out;
	const s = cleanStack(v.timeline);
	if (s) out.timeline = s;
	if (v.scenes && typeof v.scenes === 'object' && !Array.isArray(v.scenes)) {
		/** @type {any} */
		const scenes = {};
		for (const [name, st] of Object.entries(v.scenes).slice(0, 64)) {
			const c = cleanStack(st);
			if (c && name.trim()) scenes[name.trim().slice(0, 120)] = c;
		}
		if (Object.keys(scenes).length) out.scenes = scenes;
	}
	return out;
}

/** A tool's controls in one line (the timeline's lanes). @param {any} t */
export function toolText(t) {
	const def = TOOL[t.tool];
	if (!def) return '';
	const changed = def.params.filter((p) => p.type === 'number' && t[p.key] !== p.def && p.key !== 'pivot' && p.key !== 'mix');
	const f = (/** @type {number} */ v) => (Math.abs(v) >= 10 ? Math.round(v) : v.toFixed(2));
	const parts = changed.slice(0, 3).map((p) => `${p.label.replace(' °', '')} ${f(t[p.key])}`);
	// a flag set the other way than its default (a linear balance, a window's outside)
	parts.unshift(...def.params.filter((p) => p.type === 'flag' && t[p.key] !== undefined && t[p.key] !== p.def).map((p) => (t[p.key] ? p.label : `not ${p.label}`)));
	const inner = def.kind === 'mask' && t.tools?.length ? ` [${t.tools.map((/** @type {any} */ x) => TOOL[x.tool]?.label ?? x.tool).join(', ')}]` : '';
	return `${def.label}${parts.length ? ` ${parts.join(' ')}` : ''}${inner}${t.on === false ? ' (off)' : ''}`;
}

/** A stack in one line. @param {any} s */
export const stackText = (s) => (s?.tools?.length ? s.tools.map(toolText).join(' · ') + (s.strength !== undefined && s.strength !== 1 ? ` · ${Math.round(s.strength * 100)} %` : '') : '—');
