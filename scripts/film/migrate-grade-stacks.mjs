// One migration (2026-10-01): every timeline's grade from before the tools — a clip's balance, secondaries and CDL; the
// film's look, preset, scene looks and finishing — as stacks of tools (game/film/grade-tools.js). Run once; the API and
// the render read only stacks since.
//
//   node scripts/film/migrate-grade-stacks.mjs < timelines.json > migrated.json
//
// In: an array of timelines (as the API lists them). Out: [{ id, clips, grade }] — each to be saved as it is.
import { cleanClipStacks, cleanStack, cleanFilmStacks } from '../../game/film/grade-tools.js';

const PIVOT = 0.4135884;
// the grade presets from before (vault-render grade.rs `preset`, their exact CDLs)
const c = (slope, offset, power, sat) => ({ slope, offset, power, sat });
const PRESETS = {
	cold: c([0.97, 0.99, 1.05], [-0.004, 0.0, 0.012], [1, 1, 1], 0.5),
	dip: c([0.94, 1.0, 1.0], [-0.012, 0.004, 0.006], [1.06, 1.04, 1.04], 0.55),
	bright: c([1.02, 1.02, 1.0], [0.004, 0.004, 0.0], [1, 1, 1], 1.14),
	night: c([0.98, 1.0, 1.06], [0.01, 0.012, 0.024], [0.96, 0.96, 0.94], 1.08),
	warm: c([1.05, 1.0, 0.93], [0.006, 0.002, -0.004], [1, 1, 1], 1.06)
};
const preset = (name) => PRESETS[name] ?? null;


const isNeutralBal = (/** @type {any} */ b) => !b || ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'sat'].every((k) => !Number(b[k]));

/** A look from before (`creative::Look`) as tools, in the order it applied. @param {any} l @param {(name: string) => any} [preset] */
function lookTools(l, preset) {
	if (!l) return null;
	const tools = [];
	const cdl = l.cdl ?? (l.preset && preset ? preset(l.preset) : null);
	if (cdl) tools.push({ tool: 'cdl', ...cdl });
	const pivot = l.pivot ?? PIVOT;
	if (l.contrast) tools.push({ tool: 'contrast', amount: l.contrast, pivot });
	if (l.split) tools.push({ tool: 'split', sh_hue: l.split.shadows?.hue ?? 280, sh_amount: l.split.shadows?.amount ?? 0, hi_hue: l.split.highlights?.hue ?? 125, hi_amount: l.split.highlights?.amount ?? 0, balance: l.split.balance ?? 0, pivot });
	if (l.hue?.length || l.hue_sat?.length || l.hue_lum?.length || (l.sat ?? 1) !== 1) tools.push({ tool: 'hue', hue: l.hue ?? [], hue_sat: l.hue_sat ?? [], hue_lum: l.hue_lum ?? [], sat: l.sat ?? 1 });
	if ((l.hi_sat ?? 1) !== 1) tools.push({ tool: 'hi_sat', amount: l.hi_sat, pivot });
	if (l.lut) tools.push({ tool: 'lut', hash: l.lut });
	return cleanStack({ strength: l.strength ?? 1, tools });
}

/** A secondary from before as a mask group: its window around its key around its own balance. @param {any} s */
function secondaryTool(s) {
	let inner = [{ tool: 'balance', ...s.adjust }];
	let mix = s.mix ?? 1;
	if (s.key) {
		inner = [{ tool: 'key', hue: s.key.hue[0], width: s.key.hue[1], sat_lo: s.key.sat?.[0] ?? 1, sat_hi: s.key.sat?.[1] ?? 100, luma_lo: s.key.luma?.[0] ?? 0, luma_hi: s.key.luma?.[1] ?? 100, soft: s.key.soft ?? 0.5, mix: s.window ? 1 : mix, tools: inner }];
		if (!s.window) return inner[0];
		mix = s.mix ?? 1;
	}
	const w = s.window;
	return { tool: 'window', shape: w.shape, x: w.x, y: w.y, w: w.w, h: w.h, angle: w.angle ?? 0, feather: w.feather ?? 0.5, invert: !!w.invert, track: w.track === 'face' ? 'face' : '', mix, tools: inner };
}

/** A clip from before: its balance, secondaries and grade as its stacks (the clip itself, without the old fields). */
function clipFromBefore(/** @type {any} */ c) {
	const { balance, grade, secondaries, ...rest } = c;
	if (rest.stacks || (!balance && !grade && !secondaries)) return { ...rest, ...(c.stacks ? { stacks: c.stacks } : {}) };
	const base = isNeutralBal(balance) ? [] : [{ tool: 'balance', ...balance }];
	const neutralCdl = (/** @type {any} */ g) => !g || ([0, 1, 2].every((i) => (g.slope?.[i] ?? 1) == 1 && (g.offset?.[i] ?? 0) == 0 && (g.power?.[i] ?? 1) == 1) && (g.sat ?? 1) == 1);
	const clip = [...(Array.isArray(secondaries) ? secondaries.map(secondaryTool) : []), ...(!neutralCdl(grade) ? [{ tool: 'cdl', ...grade }] : [])];
	const stacks = cleanClipStacks({ base: { tools: base }, clip: { tools: clip } });
	return stacks ? { ...rest, stacks } : rest;
}

/** The film's grade from before (look, preset, film, scenes, finish) as its stacks: the finishing's textures go last on the timeline's look. @param {any} g @param {(name: string) => any} [preset] */
function gradeFromBefore(g, preset) {
	if (!g || typeof g !== 'object') return {};
	if (g.timeline || (g.finish && Array.isArray(g.finish.tools)) || Object.values(g.scenes ?? {}).some((s) => Array.isArray(/** @type {any} */ (s)?.tools))) {
		// stacks already, maybe with a finishing stack of its own (both at full strength: the same picture)
		const tl = g.timeline?.tools ?? [], fin = g.finish?.tools ?? [];
		return cleanFilmStacks({ ...g, timeline: tl.length || fin.length ? { ...(g.timeline ?? {}), tools: [...tl, ...fin] } : undefined });
	}
	const film = g.film ?? (g.look || g.preset ? { cdl: g.look ?? null, preset: g.preset ?? null } : null);
	/** @type {any} */
	const out = {};
	const tl = lookTools(film, preset);
	const scenes = Object.fromEntries(Object.entries(g.scenes ?? {}).map(([k, l]) => [k, lookTools(l, preset)]).filter(([, s]) => s));
	if (Object.keys(scenes).length) out.scenes = scenes;
	const f = g.finish;
	if (f) {
		const tools = ['pop', 'halation', 'bloom', 'grain', 'vignette'].filter((k) => f[k]).map((k) => ({ tool: k, ...f[k] }));
		const st = cleanStack({ tools: [...(tl?.tools ?? []), ...tools] });
		if (st) out.timeline = st;
	} else if (tl) out.timeline = tl;
	return out;
}

const input = JSON.parse(await new Response(process.stdin).text());
const out = input.map((t) => ({ id: t.id, name: t.name, clips: t.clips.map(clipFromBefore), grade: gradeFromBefore(t.grade, preset) }));
process.stdout.write(JSON.stringify(out, null, 1));
