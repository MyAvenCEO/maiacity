// World clips in the render: a clip of kind 'world' on the timeline is a shot record (contract C2), rendered to
// pixels only here — one plate per delivery shape, at that shape's own resolution, by stream B's renderPlate()
// (scripts/film/world/render.mjs, contract C4): ACEScct, 10-bit HEVC, tagged maiacity:color=acescct. Plates are
// render-step intermediates: cached on this machine by B's fingerprint() of the shot and what is rendered of it,
// never library assets. A plate covers the clip's whole stretch of its shot (clip.in … clip.in + clip.dur).
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashOf } from '../../game/film/transforms.js';
import { CACHE } from './color/ffmpeg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RENDER_MODULE = resolve(HERE, 'world/render.mjs');
export const SHOT_MODULE = resolve(HERE, '../../game/film/shot.js');

/**
 * @typedef {{ spec: any, from: number, to: number, shape: string, width: number, height: number, fps: number, out: string, site: string }} PlateRequest
 * @typedef {(o: PlateRequest) => Promise<{ file: string, frames: number, ev?: number }>} RenderPlate
 * @typedef {(spec: any, ...rest: any[]) => string} Fingerprint
 */

/**
 * Stream B's plate renderer and shot fingerprint. Until B's modules are in this build, a world clip fails the render
 * with this error rather than rendering something else.
 * @returns {Promise<{ renderPlate: RenderPlate, fingerprint: Fingerprint }>}
 */
export async function worldModules() {
	const missing = [RENDER_MODULE, SHOT_MODULE].filter((f) => !existsSync(f));
	if (missing.length)
		throw new Error(`world clips need stream B's plate renderer — ${missing.map((f) => f.replace(resolve(HERE, '../..') + '/', '')).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not in this build`);
	const render = await import(pathToFileURL(RENDER_MODULE).href);
	const shot = await import(pathToFileURL(SHOT_MODULE).href);
	if (typeof render.renderPlate !== 'function') throw new Error('scripts/film/world/render.mjs has no renderPlate()');
	if (typeof shot.fingerprint !== 'function') throw new Error('game/film/shot.js has no fingerprint()');
	return { renderPlate: render.renderPlate, fingerprint: shot.fingerprint };
}

/**
 * The plates of one world clip, one per shape: from the cache when this exact plate was rendered before.
 * @param {{ id: string, shot?: string, shotVersion?: number, in: number, dur: number }} clip
 * @param {{ aspect: string, width: number, height: number }[]} shapes
 * @param {{ fps: number, site: string, fetchShot: (id: string, version: number | undefined) => Promise<any>,
 *   renderPlate: RenderPlate, fingerprint: Fingerprint, cache?: string, say?: (s: string) => void }} deps
 * @returns {Promise<Map<string, { file: string, key: string, fingerprint: string, reused: boolean, frames: number, ev?: number }>>}
 */
export async function platesFor(clip, shapes, deps) {
	if (!clip.shot) throw new Error(`world clip ${clip.id} names no shot`);
	const record = await deps.fetchShot(clip.shot, clip.shotVersion);
	const spec = record?.spec ?? record;
	if (!spec || typeof spec !== 'object') throw new Error(`shot ${clip.shot} v${clip.shotVersion ?? '?'} has no spec`);
	const dir = join(deps.cache ?? CACHE, 'plates');
	mkdirSync(dir, { recursive: true });
	const from = clip.in, to = clip.in + clip.dur;
	/** @type {Map<string, { file: string, key: string, fingerprint: string, reused: boolean, frames: number, ev?: number }>} */
	const out = new Map();
	for (const s of shapes) {
		const what = { from, to, shape: s.aspect, width: s.width, height: s.height, fps: deps.fps };
		const fp = String(deps.fingerprint(spec, what));
		const key = hashOf({ fingerprint: fp, ...what });
		const file = join(dir, `${key}.mp4`);
		if (existsSync(file)) {
			out.set(s.aspect, { file, key, fingerprint: fp, reused: true, frames: Math.round((to - from) * deps.fps) });
			continue;
		}
		deps.say?.(`  plate: shot ${clip.shot} v${clip.shotVersion ?? '?'} ${from.toFixed(2)}–${to.toFixed(2)} s · ${s.aspect} ${s.width}×${s.height}`);
		const part = join(dir, `${key}.part.mp4`);
		rmSync(part, { force: true });
		const r = await deps.renderPlate({ spec, ...what, out: part, site: deps.site });
		renameSync(r.file ?? part, file);
		out.set(s.aspect, { file, key, fingerprint: fp, reused: false, frames: r.frames, ev: r.ev });
	}
	return out;
}
