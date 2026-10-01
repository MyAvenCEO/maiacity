// The grade's layers as the Grade tab works them: the timeline shows each layer's values on its lane (a line each),
// the aside beside the picture shows the chosen one's controls. One place for what both read and write.
//
// The layers, the last applied on top (the timeline's lanes top to bottom; the base correction on the floor, just above
// the picture; the framing, the shot's place in the frame, apart at the top):
//   frame     Framing — where the shot sits in the frame of the shape seen
//   finish    Finishing — the whole timeline's pop, halation, bloom, grain, vignette
//   timeline  Timeline look — the whole timeline's look
//   scene     Scene look — over the run of shots its scene covers
//   clip      Clip look — the shot's own grade (CDL: gain, lift, gamma, saturation)
//   sec       Secondaries — parts of the shot (a colour key, a window) with their own balance
//   base      Base correction — the shot's balance: white balance, exposure, contrast, highlights, lows, saturation
import { BALANCE_NODES, cleanFinish, cleanLook, cleanSecondaries } from './color.js';

/** @typedef {'finish' | 'timeline' | 'scene' | 'clip' | 'sec' | 'base' | 'frame'} Layer */
/** @typedef {import('$lib/auth/client').Look} Look */
/** @typedef {import('./studio.svelte.js').Clip} Clip */
/** @typedef {import('./studio.svelte.js').Studio} Studio */

/** @type {{ id: Layer, label: string, what: string }[]} */
export const LAYERS = [
	{ id: 'frame', label: 'Framing', what: 'this shot, in this shape' },
	{ id: 'finish', label: 'Finishing', what: 'the whole timeline' },
	{ id: 'timeline', label: 'Timeline look', what: 'the whole timeline' },
	{ id: 'scene', label: 'Scene look', what: 'every shot of the scene' },
	{ id: 'clip', label: 'Clip look', what: 'this shot' },
	{ id: 'sec', label: 'Secondaries', what: 'parts of this shot' },
	{ id: 'base', label: 'Base correction', what: 'this shot' }
];

const f2 = (/** @type {number} */ v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;

/** a shot's base correction in one line @param {Clip} c */
export function baseText(c) {
	const b = c.balance;
	if (!b) return '—';
	return (
		[b.exposure && `exp ${f2(b.exposure)}`, (b.temp || b.tint) && `wb ${f2(b.temp)}/${f2(b.tint)}`, b.contrast && `con ${f2(b.contrast)}`, b.highlights && `hi ${f2(b.highlights)}`, b.shadows && `lo ${f2(b.shadows)}`, b.sat && `sat ${f2(b.sat)}`]
			.filter(Boolean)
			.join(' · ') || '—'
	);
}

/** a shot's clip look (its CDL) in one line @param {import('$lib/auth/client').Cdl | null | undefined} g */
export function cdlText(g) {
	if (!g) return '—';
	const avg = (/** @type {number[]} */ v) => ((v[0] + v[1] + v[2]) / 3).toFixed(2);
	return `gain ${avg(g.slope)} · lift ${avg(g.offset)}${avg(g.power) !== '1.00' ? ` · gamma ${avg(g.power)}` : ''}${g.sat !== 1 ? ` · sat ${g.sat.toFixed(2)}` : ''}`;
}

// ── the looks: the timeline's, each scene's ──────────────────────────────────────────────────────────────────

/** the timeline's look (a plain CDL or preset from before read as one) @param {Studio} s @returns {Look | null} */
export function timelineLook(s) {
	const g = s.current?.grade;
	return g?.film ?? (g?.look || g?.preset ? /** @type {Look} */ ({ cdl: g.look ?? null, preset: g.preset ?? null, contrast: 0, pivot: 0.4135884, sat: 1, strength: 1 }) : null);
}

/** a scene's look @param {Studio} s @param {string} scene @returns {Look | null} */
export const sceneLook = (s, scene) => s.current?.grade?.scenes?.[scene] ?? null;

/** @param {Studio} s @param {string | null} scene the scene's look, or the timeline's (null) @param {Look | null} look */
export function setLook(s, scene, look) {
	const g = { look: null, ...(s.current?.grade ?? {}) };
	const clean = cleanLook(look);
	if (scene === null) {
		if (clean) g.film = clean;
		else delete g.film;
		delete g.preset;
		g.look = null;
	} else {
		const scenes = { ...(g.scenes ?? {}) };
		if (clean) scenes[scene] = clean;
		else delete scenes[scene];
		g.scenes = scenes;
	}
	s.setMeta({ grade: g });
}

/** a look in one line @param {Look | null} l */
export function lookText(l) {
	if (!l) return '—';
	const parts = [];
	if (l.preset) parts.push(l.preset);
	else if (l.cdl) parts.push('own CDL');
	if (l.split) parts.push(`split ${Math.round(l.split.shadows.hue)}° ${l.split.shadows.amount.toFixed(2)} / ${Math.round(l.split.highlights.hue)}° ${l.split.highlights.amount.toFixed(2)}`);
	if (l.contrast) parts.push(`contrast ${l.contrast > 0 ? '+' : ''}${l.contrast.toFixed(2)}`);
	if (l.hue?.length) parts.push(`hue ${l.hue.length} pts`);
	if (l.hue_sat?.length) parts.push(`hue·sat ${l.hue_sat.length} pts`);
	if (l.sat !== 1) parts.push(`sat ${l.sat.toFixed(2)}`);
	if (l.lut) parts.push('LUT');
	if (l.strength !== 1) parts.push(`${Math.round(l.strength * 100)} %`);
	return parts.join(' · ') || '—';
}

/** a look's sliders: key, label, range, step, and the group they sit in */
export const LOOK_SLIDERS = /** @type {const} */ ([
	['sh', 'shadows hue °', 0, 360, 1, 'Split tone'],
	['sa', 'shadows amount', 0, 1, 0.01, 'Split tone'],
	['hh', 'highlights hue °', 0, 360, 1, 'Split tone'],
	['ha', 'highlights amount', 0, 1, 0.01, 'Split tone'],
	['sb', 'balance', -1, 1, 0.01, 'Split tone'],
	['contrast', 'contrast', -1, 1, 0.01, 'Tone'],
	['sat', 'saturation', 0, 2, 0.01, 'Tone'],
	['hi_sat', 'highlight saturation', 0, 2, 0.01, 'Tone'],
	['strength', 'strength', 0, 1, 0.01, 'Mix']
]);

/** @param {Look | null} l @param {string} k */
export function lookValue(l, k) {
	switch (k) {
		case 'sh': return l?.split?.shadows.hue ?? 280;
		case 'sa': return l?.split?.shadows.amount ?? 0;
		case 'hh': return l?.split?.highlights.hue ?? 125;
		case 'ha': return l?.split?.highlights.amount ?? 0;
		case 'sb': return l?.split?.balance ?? 0;
		case 'contrast': return l?.contrast ?? 0;
		case 'sat': return l?.sat ?? 1;
		case 'hi_sat': return /** @type {any} */ (l)?.hi_sat ?? 1;
		default: return l?.strength ?? 1;
	}
}

/** a look with one of its sliders moved @param {Look | null} l @param {string} k @param {number} v @returns {Look} */
export function withValue(l, k, v) {
	/** @type {Look} */
	const n = structuredClone(l ? JSON.parse(JSON.stringify(l)) : null) ?? { contrast: 0, pivot: 0.4135884, sat: 1, strength: 1 };
	const split = n.split ?? { shadows: { hue: 280, amount: 0 }, highlights: { hue: 125, amount: 0 }, balance: 0 };
	if (k === 'sh') split.shadows.hue = v;
	else if (k === 'sa') split.shadows.amount = v;
	else if (k === 'hh') split.highlights.hue = v;
	else if (k === 'ha') split.highlights.amount = v;
	else if (k === 'sb') split.balance = v;
	else /** @type {any} */ (n)[k] = v;
	if (['sh', 'sa', 'hh', 'ha', 'sb'].includes(k)) n.split = split;
	return n;
}

/** the runs of shots each scene covers, in the strip's order @param {Clip[]} pics */
export function sceneRuns(pics) {
	/** @type {{ key: string, scene: string | null, from: number, count: number }[]} */
	const runs = [];
	pics.forEach((c, i) => {
		const scene = c.script?.scene || null;
		const last = runs[runs.length - 1];
		if (last && last.scene === scene) last.count++;
		else runs.push({ key: `${i}:${scene}`, scene, from: i, count: 1 });
	});
	return runs;
}

// ── the secondaries ──────────────────────────────────────────────────────────────────────────────────────────

/** @param {Studio} s @param {Clip} c @param {any[]} list */
export const setSecondaries = (s, c, list) => s.patchClip(c.id, { secondaries: cleanSecondaries(list).length ? cleanSecondaries(list) : undefined });
/** @param {any} sec */
export const secText = (sec) => sec.name ?? (sec.window?.track ? 'face' : sec.key ? `${Math.round(sec.key.hue[0])}° key` : sec.window ? sec.window.shape : 'part');
// a new secondary starts doing a little, so it is kept (a secondary that changes nothing is dropped)
export const NEW_KEY = { name: 'key', key: { hue: [30, 40], sat: [10, 100], luma: [10, 90], soft: 0.5 }, adjust: { sat: -0.1 }, mix: 1 };
export const NEW_WINDOW = { name: 'window', window: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6, angle: 0, feather: 0.5, invert: false }, adjust: { exposure: 0.15 }, mix: 1 };

/** @typedef {{ id: string, label: string, lo: number, hi: number, step: number, get: (x: any) => number, set: (x: any, v: number) => any }} SecField */
const ADJUST = BALANCE_NODES.flatMap((n) => n.fields);
/** @param {(typeof ADJUST)[number]} f @returns {SecField} */
const adjustField = (f) => ({ id: `a:${f.key}`, label: f.key === 'shadows' ? 'lows' : f.label.toLowerCase(), lo: f.min, hi: f.max, step: f.step, get: (x) => x.adjust?.[f.key] ?? 0, set: (x, v) => ({ ...x, adjust: { ...x.adjust, [f.key]: v } }) });
/** @param {'hue' | 'sat' | 'luma'} part @param {0 | 1} i @param {string} label @param {number} lo @param {number} hi @returns {SecField} */
const keyField = (part, i, label, lo, hi) => ({ id: `k:${part}${i}`, label, lo, hi, step: 1, get: (x) => x.key?.[part]?.[i] ?? 0, set: (x, v) => ({ ...x, key: { ...x.key, [part]: i ? [x.key[part][0], v] : [v, x.key[part][1]] } }) });
/** @param {string} k @param {string} label @param {number} lo @param {number} hi @param {number} step @returns {SecField} */
const windowField = (k, label, lo, hi, step) => ({ id: `w:${k}`, label, lo, hi, step, get: (x) => x.window?.[k] ?? 0, set: (x, v) => ({ ...x, window: { ...x.window, [k]: v } }) });

/** a secondary's controls in groups: its balance, its mix, its key, its window @param {any} sec @returns {{ group: string, fields: SecField[] }[]} */
export function secGroups(sec) {
	/** @type {{ group: string, fields: SecField[] }[]} */
	const out = [{ group: 'Its balance', fields: [...ADJUST.map(adjustField), { id: 'mix', label: 'mix', lo: 0, hi: 1, step: 0.01, get: (x) => x.mix ?? 1, set: (x, v) => ({ ...x, mix: v }) }] }];
	if (sec.key)
		out.push({
			group: 'Colour key',
			fields: [
				keyField('hue', 0, 'hue °', 0, 359),
				keyField('hue', 1, 'width °', 1, 360),
				keyField('sat', 0, 'saturation from', 0, 100),
				keyField('sat', 1, 'saturation to', 0, 100),
				keyField('luma', 0, 'luma from', 0, 100),
				keyField('luma', 1, 'luma to', 0, 100),
				{ id: 'k:soft', label: 'softness', lo: 0, hi: 1, step: 0.01, get: (x) => x.key?.soft ?? 0.5, set: (x, v) => ({ ...x, key: { ...x.key, soft: v } }) }
			]
		});
	if (sec.window)
		out.push({
			group: 'Window',
			fields: [windowField('x', 'x', -1, 2, 0.01), windowField('y', 'y', -1, 2, 0.01), windowField('w', 'width', 0.01, 4, 0.01), windowField('h', 'height', 0.01, 4, 0.01), windowField('angle', 'angle', -180, 180, 1), windowField('feather', 'feather', 0, 1, 0.01)]
		});
	return out;
}

// ── finishing ────────────────────────────────────────────────────────────────────────────────────────────────

/** @param {Studio} s @param {any} f */
export function setFinish(s, f) {
	const g = { look: null, ...(s.current?.grade ?? {}) };
	const clean = cleanFinish(f);
	if (clean) g.finish = clean;
	else delete g.finish;
	s.setMeta({ grade: g });
}

/** finishing's controls: part, key, label, range, step, its default, the group */
export const FINISH_SLIDERS = /** @type {const} */ ([
	['pop', 'amount', 'pop', -1, 1, 0.01, 0, 'Pop'],
	['pop', 'radius', 'radius', 2, 80, 1, 18, 'Pop'],
	['halation', 'amount', 'halation', 0, 1, 0.01, 0, 'Halation'],
	['halation', 'threshold', 'threshold', 0.3, 1.2, 0.01, 0.55, 'Halation'],
	['halation', 'radius', 'radius', 1, 120, 1, 14, 'Halation'],
	['bloom', 'amount', 'bloom', 0, 1, 0.01, 0, 'Bloom'],
	['bloom', 'threshold', 'threshold', 0.3, 1.2, 0.01, 0.55, 'Bloom'],
	['bloom', 'radius', 'radius', 1, 120, 1, 14, 'Bloom'],
	['grain', 'amount', 'grain', 0, 1, 0.01, 0, 'Grain'],
	['grain', 'size', 'size', 0.5, 4, 0.01, 1, 'Grain'],
	['grain', 'chroma', 'colour', 0, 1, 0.01, 0, 'Grain'],
	['vignette', 'amount', 'vignette', 0, 1, 0.01, 0, 'Vignette'],
	['vignette', 'size', 'size', 0.2, 2, 0.01, 0.9, 'Vignette'],
	['vignette', 'softness', 'softness', 0, 1, 0.01, 0.5, 'Vignette'],
	['vignette', 'roundness', 'roundness', 0, 1, 0.01, 0, 'Vignette']
]);

/** @param {any} f */
export const finishText = (f) =>
	f
		? Object.entries(f)
				.map(([k, v]) => `${k} ${/** @type {any} */ (v).amount.toFixed(2)}`)
				.join(' · ')
		: '—';
