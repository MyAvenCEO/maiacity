// @ts-nocheck — plain JS
/**
 * SANDBOX 8 · A PROOF WORKER — runs one job of the proof suite at a time (a base world on one seed, or one
 * experiment) off the page's thread, and sends back its result (./proofRun.js). The page starts a few of these and
 * hands each the next job when it is done.
 *
 * In: { job }  ·  Out: { result } or { error }
 */
import { runJob } from './proofRun.js';

self.onmessage = (e) => {
	try {
		self.postMessage({ result: runJob(e.data.job) });
	} catch (err) {
		self.postMessage({ error: String(err?.stack || err) });
	}
};
