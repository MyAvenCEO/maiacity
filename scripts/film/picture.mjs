// One piece of the picture track as an ffmpeg filter chain: a clip's stretch of its source, brought to the film's
// clock and frame, through the colour-managed path (input transform, grades, output transform) into the timeline's
// YUV — 4:2:0 10-bit, BT.709 matrix, TV range — exactly `frames` long. Every piece ends in the same format, so the
// pieces join end to end.
import { cleanCdl } from '../../game/film/color.js';
import { clipColor, SETPARAMS } from './color/ffmpeg.mjs';

/** @typedef {import('./sources.mjs').Source} Source */
/** @typedef {import('../../game/film/color.js').Cdl} Cdl */

/**
 * The frame a picture is cut to: scaled to cover W×H (times its zoom), then cropped where its reframing for this shape
 * puts it (x, y in −1…1 of the free room: −1 the left/top edge, 0 the middle). No reframing: the middle.
 * @param {{ width: number, height: number }} src @param {number} W @param {number} H
 * @param {{ x?: number, y?: number, zoom?: number } | undefined} frame
 */
export function geometry(src, W, H, frame) {
	const clamp = (/** @type {number | undefined} */ v) => Math.max(-1, Math.min(1, Number(v) || 0));
	const zoom = Math.max(1, Number(frame?.zoom) || 1);
	const s = Math.max(W / src.width, H / src.height) * zoom;
	const w = Math.max(W, 2 * Math.round((src.width * s) / 2)), h = Math.max(H, 2 * Math.round((src.height * s) / 2));
	const x = Math.round(((w - W) / 2) * (1 + clamp(frame?.x))), y = Math.round(((h - H) / 2) * (1 + clamp(frame?.y)));
	/** @type {string[]} */
	const out = [];
	if (w !== src.width || h !== src.height) out.push(`zscale=w=${w}:h=${h}:f=lanczos`);
	if (w !== W || h !== H) out.push(`crop=${W}:${H}:${x}:${y}`);
	return out;
}

/**
 * The filters of one piece (after its input `[n:v]`).
 * @param {{ source: Source, grade?: unknown, look?: Cdl | null, frame?: { x?: number, y?: number, zoom?: number }, W: number, H: number, frames: number, fps: number }} o
 * @returns {{ filters: string[], used: Record<string, string> }}
 */
export function pieceFilters(o) {
	const color = clipColor({ profile: o.source.profile, coding: o.source.coding, grade: cleanCdl(o.grade), look: o.look ?? null });
	const geo = geometry(o.source, o.W, o.H, o.frame);
	const timing = ['tpad=stop_mode=clone:stop_duration=1', `trim=end_frame=${o.frames}`, `setpts=N/${o.fps}/TB`];
	return { filters: [`fps=${o.fps}`, ...color.before, ...geo, ...timing, ...color.after], used: color.used };
}

/** A gap in the picture: black (TV-range black in 10-bit YUV), exactly `frames` long. */
export const blackFilters = (/** @type {number} */ W, /** @type {number} */ H, /** @type {number} */ fps, /** @type {number} */ frames) =>
	`color=c=black:s=${W}x${H}:r=${fps},format=yuv420p10le,trim=end_frame=${frames},setpts=N/${fps}/TB,${SETPARAMS}`;
