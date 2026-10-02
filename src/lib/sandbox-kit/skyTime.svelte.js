/**
 * THE SKY'S TIME — one state for every sandbox: automatic (the in-game clock) or set by hand (a slider), the single
 * source of truth every world's sky reads (./sky.js `createSkyClock`) and the time control sets
 * (./SkyControl.svelte). It starts automatic on every visit; set by hand it starts at noon. Moving from one sandbox
 * to another keeps it. A film pins its own hour over both (window.__interiorHour).
 */
import { gameHour } from '../../../game/time';

/** the hour a hand-set sky starts at: noon */
export const NOON = 12;

export const skyTime = $state({
	/** true: the in-game clock; false: the hour set by hand */
	auto: true,
	/** the hour set by hand, 0…24 */
	hour: NOON
});

/** Follow the in-game clock again. */
export function automatic() {
	skyTime.auto = true;
}

/**
 * Set the hour by hand (noon when none is given: the hand-set sky starts there).
 * @param {number} [hour]
 */
export function manual(hour = NOON) {
	skyTime.auto = false;
	skyTime.hour = Math.max(0, Math.min(24, hour));
}

/** The hour the sky shows (but for a film's): the clock's, or the one set by hand. */
export function skyHour() {
	return skyTime.auto ? gameHour() : skyTime.hour;
}
