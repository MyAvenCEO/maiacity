// Camera moves for shot lists (scripts/film/*.mjs): a pose is [x, y, z, yaw, pitch], as Sandbox 4's camera takes it.
// The moves are data now (game/film/camera.js): each function here returns the path as before — a function of the
// shot's progress 0–1 — with its record attached as `.spec`, so every shot list written with these is a list of
// records too (game/film/shot.js fromLegacy). The maths is camera.js's own: no pose changes.
import { curveName, drift, ease, glide, landing, look, pathOf } from '../../game/film/camera.js';

export { drift, ease, glide, landing, look };

/** The path of a camera record, carrying the record as `.spec`. A curve of the shot list's own (not one of
 *  camera.js's CURVES) still gives the path, but not as data. */
const withSpec = (spec, curve) => {
	const name = curveName(curve);
	if (!name) {
		const base = pathOf(spec); // glide: its progress is the curve's
		return (t) => base(curve(t));
	}
	const full = name === 'glide' ? spec : { ...spec, curve: name };
	const path = pathOf(full);
	path.spec = full;
	return path;
};

/** From one camera position and aim to another. */
export const move = (from, to, aimFrom, aimTo, curve = glide) => withSpec({ kind: 'move', from, to, aimFrom, aimTo }, curve);

/** Round a centre: angle a0→a1 (radians), radius r0→r1, height y0→y1, always looking at `aim`. */
export const orbit = (centre, a0, a1, r0, r1, y0, y1, aim, curve = glide) => withSpec({ kind: 'orbit', centre, a0, a1, r0, r1, y0, y1, aim }, curve);

/** Turn in place: yaw and pitch from one to the other (for looking up into a dome). */
export const turn = (at, yaw0, yaw1, pitch0, pitch1, curve = glide) => withSpec({ kind: 'turn', at, yaw0, yaw1, pitch0, pitch1 }, curve);

/** A drone flight through several points: [position, aim] keys, joined by a smooth curve (Catmull-Rom) at an even
 *  pace — rising out of a forest, over the canopy, out to the view — in one move with no stops on the way. */
export const fly = (keys, curve = glide) => withSpec({ kind: 'fly', keys }, curve);

/** A whip pan: the camera flicks sideways over the last (`out`) or first (`into`) moments of a shot, `by` radians,
 *  fast enough to blur — the cut hides in the blur, and the next shot comes out of the same flick. Pair a whip out
 *  with a whip in, the same way round, and give both shots `blur`. */
export const whip = (path, { out = 0, into = 0, d = 0.12 } = {}) => {
	if (!path.spec) {
		// a path that is not data: whipped as before
		return (t) => {
			const p = path(t);
			const a = t > 1 - d && out ? out * Math.pow((t - (1 - d)) / d, 2) : 0;
			const b = t < d && into ? -into * Math.pow((d - t) / d, 2) : 0;
			return [p[0], p[1], p[2], p[3] + a + b, p[4]];
		};
	}
	const spec = { kind: 'whip', path: path.spec, ...(out ? { out } : {}), ...(into ? { into } : {}), ...(d !== 0.12 ? { d } : {}) };
	const f = pathOf(spec);
	f.spec = spec;
	return f;
};

/** Where to cut: every shot runs from the middle of the pause before its line to the middle of the pause after. */
export function cuts(spans, { lead = 2, tail = 4, overlap = 0.6 } = {}) {
	return spans.map((s, i) => {
		const start = i === 0 ? 0 : lead + (spans[i - 1].end + s.start) / 2;
		const end = i === spans.length - 1 ? lead + s.end + tail : lead + (s.end + spans[i + 1].start) / 2;
		// each shot runs a little longer, so the next can dissolve over it
		return { start, end, seconds: end - start + (i === spans.length - 1 ? 0 : overlap) };
	});
}
