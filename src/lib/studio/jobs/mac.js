/*
 * The worker on this Mac (plan J0d-J0f): one for the app, started the first time the studio asks for it while the
 * app's avenDB device is open, rounds every minute, a round at once when asked (`nudge`). It works on the person's own
 * vault, through the app's device (src/lib/avendb/native.js), until the device hosts a worker device vault of its own
 * (J0c).
 */

import { native } from '$lib/native';
import { Worker } from './worker.js';
import { EXECUTORS } from './executors.js';

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
		send: (op) => d.call('run', op),
		executors: EXECUTORS,
		log: (line) => {
			lines.unshift(`${new Date().toLocaleTimeString()} ${line}`);
			lines.length = Math.min(lines.length, 50);
		}
	});
	worker.start();
	return worker;
}

/** A round now, as when a test file was just added or a task held is asked again. */
export const nudge = () => void worker?.tick().catch(() => {});
