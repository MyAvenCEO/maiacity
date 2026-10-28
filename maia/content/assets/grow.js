// @ts-nocheck — plain JS
/*
 * A PLANT GROWING ON A VIEWER'S STAGE — as the plants page has grown one since it was made: on from where it stands to
 * its last stage at half a stage a second (seed to ripe in 18 s), by the clock on the wall, between its stages as well
 * as at them, so it grows smoothly rather than stage by stage. A viewer builds it where it has grown to whenever its
 * last build is shown (./AssetViewer.svelte, ./VaultAsset.svelte); a build between two stages is not kept in the
 * device's cache, as no one asks for that one again.
 */

/** how fast it grows, in stages a second */
export const PACE = 0.5;

/** a stage as a build is named by it: to a thousandth, so its name stays short @param {number} g */
export const stageAt = (g) => Math.round(g * 1000) / 1000;

/** whether a stage is one of its own (a whole one), not one on the way between two @param {unknown} g */
export const whole = (g) => Number.isInteger(g);

/**
 * A plant growing by its stage parameter `p` (`min` … `max`), from stage `from`, or from its first if it stands at its
 * last: `on(wall)` grows it on by `wall` seconds and says where it has grown to; `done` once it is at its last.
 * @param {{ min: number, max: number }} p @param {number} from
 */
export function growth(p, from) {
	let at = Number.isFinite(from) && from < p.max ? Math.max(p.min, from) : p.min;
	return {
		on: (wall) => (at = Math.min(p.max, at + Math.max(0, wall) * PACE)),
		get at() {
			return at;
		},
		get done() {
			return at >= p.max;
		}
	};
}
