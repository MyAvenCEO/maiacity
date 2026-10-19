/*
 * The Mac's job runner (./runner.js): one for the app, started by the app's layout (src/routes/app/+layout.svelte)
 * once the app's avenDB device is open, rounds every minute, a round at once when asked (`nudge`). It works straight
 * in every vault the person reaches, acting as each vault's acting vault, through the app's device
 * (src/lib/avendb/native.js).
 */

import { native } from '$lib/native';
import { answer } from '$lib/avendb/ops.js';
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

/** The name the studio's old worker vaults went by, one a vault, before the Mac worked straight in the vaults (#1010). */
const OLD_WORKER = 'Studio worker';

/**
 * The studio's old worker vaults let go of, once (Samuel 2026-10-19: "trigger the deleting of the 2 worker devices"):
 * each device of a device vault named so is taken out of it, as Owners & devices' Remove does, so it syncs and acts no
 * more and leaves the vault switcher (vaults.js `pillVaults`). Its passkey sheet comes once; a refusal isn't asked again.
 * @param {{ call: (name: string, ...args: any[]) => Promise<any> }} d
 */
async function retireWorkers(d) {
	const KEY = 'studio-workers-retired';
	try {
		if (localStorage.getItem(KEY)) return;
	} catch {}
	const world = answer(await d.call('run', { op: 'world' }));
	const old = (world?.vaults ?? []).filter((/** @type {any} */ v) => v.kind === 'device' && v.name === OLD_WORKER && v.devices?.length);
	for (const v of old) {
		for (const dv of v.devices) {
			try {
				answer(await d.call('run', { op: 'revoke', vault: v.id, device: dv.id }));
				lines.unshift(`${new Date().toLocaleTimeString()} removed the old studio worker ${v.id.slice(0, 8)}`);
			} catch (e) {
				lines.unshift(`${new Date().toLocaleTimeString()} the old studio worker ${v.id.slice(0, 8)} stays: ${e instanceof Error ? e.message : e}`);
			}
		}
	}
	try {
		localStorage.setItem(KEY, String(Date.now()));
	} catch {}
}

/** This Mac's runner, started; `null` where it can't run. */
export async function macRunner() {
	if (runner) return runner;
	const d = await device();
	if (!d) return null;
	if (!runner) await retireWorkers(d).catch(() => {});
	if (runner) return runner;
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
