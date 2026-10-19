/*
 * The Mac's job runner (./runner.js): one for the app, started by the app's layout (src/routes/app/+layout.svelte)
 * once the app's avenDB device is open, rounds every minute, a round at once when asked (`nudge`). It works straight
 * in every vault the person reaches, acting as each vault's acting vault, through the app's device
 * (src/lib/avendb/native.js).
 */

import { native } from '$lib/native';
import { Runner } from './runner.js';
import { EXECUTORS, NATIVE } from './executors.js';

/** @type {Runner | null} */
let runner = null;
/** @type {string[]} the runner's last lines, newest first */
export const lines = [];

/** whether the studio is playing: the runner starts nothing then (`held`) */
let playing = false;
/** The studio says when it plays and stops. @param {boolean} on */
export const studioPlaying = (on) => void (playing = on);
/** whether the studio's live world is open: no world proxy is rendered then, a second world beside it (`held`) */
let worldOpen = false;
/** The world viewer says when its world is up and when it is let go. @param {boolean} on */
export const studioWorld = (on) => void (worldOpen = on);

/** The app's device, or `null` off the Mac app or while it isn't open. */
async function device() {
	if (!native()) return null;
	const { call, status } = await import('$lib/avendb/native.js');
	const s = await status().catch(() => null);
	return s?.open ? { call } : null;
}

/** This Mac's runner, started; `null` where it can't run. */
export async function macRunner() {
	if (runner) return runner;
	const d = await device();
	if (!d) return null;
	runner = new Runner({
		send: (op) => d.call('run', op),
		// every vault the person reaches but a device's: the Maia City vault's footage as much as their own
		vaults: (w) => (w.vaults ?? []).filter((/** @type {any} */ v) => v.kind !== 'device' && v.acting?.reaches).map((/** @type {any} */ v) => v.id),
		executors: { ...EXECUTORS, ...NATIVE },
		// one task at a time, none while the studio plays and no world proxy beside its live world (Samuel's Mac, 8 GB: a proxy, the speech model and an analysis
		// at once, beside the app's own pages, ran it out of memory before the studio was even open)
		max: 1,
		held: (t) => playing || (t.rule === 'world-proxy' && worldOpen),
		log: (line) => {
			lines.unshift(`${new Date().toLocaleTimeString()} ${line}`);
			lines.length = Math.min(lines.length, 50);
		}
	});
	runner.start();
	return runner;
}

/** A round now, as when a file was just brought in or a task held is asked again; the runner started if it wasn't. */
export const nudge = () =>
	void macRunner()
		.then((r) => r?.tick())
		.catch(() => {});
