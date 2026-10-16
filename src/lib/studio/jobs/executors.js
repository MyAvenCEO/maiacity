/*
 * How the page does a rule (./worker.js): the executors that need nothing but a file's bytes. The rest run in the
 * Mac app's Rust lanes (vault/app/src/jobs.rs), which read avenDB files through the sidecar's media channel (plan J0a).
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** How many bytes a read asks for at a time. */
const STEP = 1 << 20;

/** @type {Record<string, import('./worker.js').Executor>} */
export const EXECUTORS = {
	/** The test rule: each file the entry brings, read whole through the worker, named by its BLAKE3. */
	async checksum(task, ctx) {
		const e = ctx.entry(task.inputs[0]?.entry ?? '');
		if (!e) throw new Error('its file is not on this device');
		const files = e.files ?? [];
		if (!files.length) throw new Error('it brings no bytes');
		/** @type {Record<string, string>} */
		const sums = {};
		let done = 0;
		for (const f of files) {
			const len = f.len;
			if (len == null) throw new Error('this device cannot open its bytes');
			const h = blake3.create();
			for (let at = 0; at < len; at += STEP) {
				const bytes = await ctx.read(f.root, f.size, at, Math.min(len, at + STEP));
				if (!bytes.length) throw new Error('the file ends early');
				h.update(bytes);
				ctx.progress((done += bytes.length));
			}
			sums[f.root] = bytesToHex(h.digest());
		}
		return { result: { blake3: sums } };
	}
};
