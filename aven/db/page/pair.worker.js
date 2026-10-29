// @ts-nocheck — plain JS, trusted: a worker of the device's worker (./remote.worker.js)
/*
 * A PAIR WORKER — makes the Classic McEliece pair of a seed the device wants (`wantedPairs`), beside the device's own
 * worker, which a pair would hold for seconds: a new browser's own key's took 7.8 s of its sign-in, made only as it
 * joined (fresh10, 2026-10-29). Each message is a seed, 32 bytes; each answer `{seed, pair}`, the pair's public key and
 * then its secret key in one buffer, or `{seed}` alone where it couldn't, and the device makes it itself when it needs it.
 */

import init, { makePair } from './device/avendb_browser.js';

let started = null;

onmessage = async ({ data: seed }) => {
	try {
		started ??= init();
		await started;
		const pair = makePair(seed);
		postMessage({ seed, pair }, [pair.buffer]);
	} catch {
		postMessage({ seed });
	}
};
