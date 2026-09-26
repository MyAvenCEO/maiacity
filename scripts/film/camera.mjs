// Camera moves for shot lists (scripts/film/*.mjs): a pose is [x, y, z, yaw, pitch], as Sandbox 4's camera takes it.
const lerp = (a, b, t) => a + (b - a) * t;

/** Starts and stops gently, the way a dolly or a crane moves. */
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** A slower, steadier ease for long drifts. */
export const drift = (t) => t * t * (3 - 2 * t);

/** A pose that looks from point p at point q. */
export const look = (p, q) => {
	const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
	return [p[0], p[1], p[2], Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};

/** From one camera position and aim to another. */
export const move = (from, to, aimFrom, aimTo, curve = ease) => (t) => {
	const e = curve(t);
	return look(from.map((v, i) => lerp(v, to[i], e)), aimFrom.map((v, i) => lerp(v, aimTo[i], e)));
};

/** Round a centre: angle a0→a1 (radians), radius r0→r1, height y0→y1, always looking at `aim`. */
export const orbit = (centre, a0, a1, r0, r1, y0, y1, aim, curve = ease) => (t) => {
	const e = curve(t), a = lerp(a0, a1, e), r = lerp(r0, r1, e);
	return look([centre[0] + r * Math.sin(a), lerp(y0, y1, e), centre[1] + r * Math.cos(a)], aim);
};

/** Turn in place: yaw and pitch from one to the other (for looking up into a dome). */
export const turn = (at, yaw0, yaw1, pitch0, pitch1, curve = drift) => (t) => {
	const e = curve(t);
	return [at[0], at[1], at[2], lerp(yaw0, yaw1, e), lerp(pitch0, pitch1, e)];
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
