/*
 * The worker on this Mac (plan J0d-J0f): one for the app, started by the app's layout (src/routes/app/+layout.svelte) once
 * the app's avenDB device is open, rounds every minute, a round at once when asked (`nudge`). It works on every vault
 * the person reaches, acting as each vault's acting vault, through the app's device (src/lib/avendb/native.js), until
 * this Mac is made a vault's studio worker (J0c: by itself, as the Jobs page opens, ./Tasks.svelte), and then as that
 * worker there.
 */

import { native } from '$lib/native';
import { Worker } from './worker.js';
import { EXECUTORS, NATIVE } from './executors.js';

/** @type {Worker | null} */
let worker = null;
/** @type {string[]} the worker's last lines, newest first */
export const lines = [];

/** The app's device, or `null` off the Mac app or while it isn't open. */
async function device() {
	if (!native()) return null;
	const { call, status } = await import('$lib/avendb/native.js');
	const s = await status().catch(() => null);
	return s?.open ? { call } : null;
}

/** This Mac's worker, started; `null` where it can't run. */
export async function macWorker() {
	if (worker) return worker;
	const d = await device();
	if (!d) return null;
	worker = new Worker({
		send: (op, node) => (node ? d.call('run', op, node) : d.call('run', op)),
		hosted: () => d.call('workers'),
		// every vault the person reaches but a device's: the Maia City vault's footage as much as their own
		vaults: (w) => (w.vaults ?? []).filter((/** @type {any} */ v) => v.kind !== 'device' && v.acting?.reaches).map((/** @type {any} */ v) => v.id),
		executors: { ...EXECUTORS, ...NATIVE },
		log: (line) => {
			lines.unshift(`${new Date().toLocaleTimeString()} ${line}`);
			lines.length = Math.min(lines.length, 50);
		}
	});
	worker.start();
	return worker;
}

/** A round now, as when a file was just brought in or a task held is asked again; the worker started if it wasn't. */
export const nudge = () =>
	void macWorker()
		.then((w) => w?.tick())
		.catch(() => {});
