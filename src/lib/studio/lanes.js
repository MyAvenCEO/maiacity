/*
 * A world shot's lanes in the timeline (Samuel 2026-10-18: "display its different world controls in different
 * timelines … camera, light animations … all the moving parts of a 3D world for the movie"): the camera, the hour,
 * the exposure, every light, each channel of every moving part its world declares (game/film/worlds.js `parts`), and
 * the cues. A curve lane is a value over the shot (game/film/shot.js `Curve`: one value, or [t, value] keys), read
 * and written in the spec itself, so what the lanes show is exactly what renders: one truth, data only.
 */

import { LIGHTS } from '../../../game/film/shot.js';
import { partsOf } from '../../../game/film/worlds.js';

/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
/** @typedef {number | [number, number][]} Curve */
/**
 * One lane: `kind` how it is drawn (`camera` keys, `cues`, a `text` line, or a `curve` with keys to drag), `label`
 * its head; a curve lane its `range` and where it lives in the spec (`get`: undefined where the spec leaves it to
 * the world; `set`: written, `undefined` hands it back), `rest` the value it has where the spec leaves it.
 * @typedef {{ key: string, kind: 'camera' | 'cues' | 'text' | 'curve', label: string, title?: string,
 *   range?: [number, number], rest?: number | null, get?: (sp: ShotSpec) => Curve | undefined,
 *   set?: (sp: ShotSpec, c: Curve | undefined) => void }} Lane
 */

/** What a light's intensity scales: the hour's own light, so 1 changes nothing. */
const LIGHT_RANGE = /** @type {[number, number]} */ ([0, 4]);

/**
 * The lanes of `spec`, its world's parts among them.
 * @param {ShotSpec} spec @returns {Lane[]}
 */
export function lanesOf(spec) {
	/** @type {Lane[]} */
	const out = [
		{ key: 'camera', kind: 'camera', label: 'Camera' },
		{ key: 'hour', kind: 'text', label: 'Hour' },
		{
			key: 'exposure',
			kind: 'curve',
			label: 'Exposure',
			title: 'Stops over the meter',
			range: [-6, 6],
			rest: 0,
			get: (sp) => sp.exposure.stops,
			set: (sp, c) => void (sp.exposure.stops = c ?? 0)
		}
	];
	for (const id of LIGHTS) {
		/** @param {ShotSpec} sp */
		const of = (sp) => sp.lights.find((l) => l.id === id);
		out.push({
			key: `light:${id}`,
			kind: 'curve',
			label: `Light · ${id}`,
			title: `The ${id} light's intensity, over what the hour gives it (1 = as the hour has it)`,
			range: LIGHT_RANGE,
			rest: 1,
			get: (sp) => of(sp)?.intensity,
			set: (sp, c) => {
				const l = of(sp);
				if (c === undefined) {
					if (l && !l.color) sp.lights = sp.lights.filter((x) => x !== l);
					else if (l) delete l.intensity;
				} else if (l) l.intensity = c;
				else sp.lights = [...sp.lights, { id, intensity: c }];
			}
		});
	}
	for (const part of partsOf(spec.world.sandbox)) {
		for (const [ch, def] of Object.entries(part.channels)) {
			/** @param {ShotSpec} sp */
			const of = (sp) => /** @type {any[]} */ (sp.parts ?? []).find((q) => q.id === part.id);
			out.push({
				key: `part:${part.id}:${ch}`,
				kind: 'curve',
				label: `${part.label} · ${def.label}`,
				title: `${part.label}, ${def.label.toLowerCase()}: ${def.unit}. Left alone, it moves as the world moves it.`,
				range: def.range,
				rest: null,
				get: (sp) => of(sp)?.[ch],
				set: (sp, c) => {
					const q = of(sp);
					const parts = /** @type {any[]} */ (sp.parts ?? []);
					if (c === undefined) {
						if (!q) return;
						delete q[ch];
						if (Object.keys(q).length === 1) /** @type {any} */ (sp).parts = parts.filter((x) => x !== q);
					} else if (q) q[ch] = c;
					else /** @type {any} */ (sp).parts = [...parts, { id: part.id, [ch]: c }];
				}
			});
		}
	}
	out.push({ key: 'cues', kind: 'cues', label: 'Cues' });
	return out;
}

/** @param {number} v @param {[number, number]} r */
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
/** a time on the 30 fps grid the other keys use @param {number} t */
const frame = (t) => Math.round(t * 30) / 30;

/** A curve's keys, a single value as no keys. @param {Curve | undefined} c @returns {[number, number][]} */
export const keysOf = (c) => (Array.isArray(c) ? c : []);

/**
 * Curve `c` with a key at `t` of value `v` (one already at that frame: its value changed).
 * @param {Curve | undefined} c @param {number} t @param {number} v @param {[number, number]} range @returns {Curve}
 */
export function withKey(c, t, v, range) {
	const k = /** @type {[number, number]} */ ([frame(t), clamp(v, range)]);
	const keys = keysOf(c).filter(([x]) => Math.abs(x - k[0]) > 1e-6);
	return [...keys, k].sort((a, b) => a[0] - b[0]);
}

/**
 * Curve `c` with its key `i` moved to `t`, `v` (kept between its neighbours' times, so the keys keep their order).
 * @param {Curve | undefined} c @param {number} i @param {number} t @param {number} v @param {[number, number]} range
 * @returns {Curve}
 */
export function movedKey(c, i, t, v, range) {
	const keys = keysOf(c).map((k) => /** @type {[number, number]} */ ([...k]));
	if (!keys[i]) return c ?? keys;
	const lo = keys[i - 1]?.[0] ?? -Infinity, hi = keys[i + 1]?.[0] ?? Infinity;
	keys[i] = [Math.min(hi - 1 / 30, Math.max(lo + 1 / 30, frame(t))), clamp(v, range)];
	return keys;
}

/**
 * Curve `c` without its key `i`: the last key left becomes the value the whole shot holds; none, `undefined`.
 * @param {Curve | undefined} c @param {number} i @returns {Curve | undefined}
 */
export function withoutKey(c, i) {
	const keys = keysOf(c).filter((_, j) => j !== i);
	return keys.length > 1 ? keys : keys.length ? keys[0][1] : undefined;
}
