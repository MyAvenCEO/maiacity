// @ts-nocheck — plain JS
/** Mounted previews only. Reserve encoded bytes before reading, bound concurrent readers and queued jobs,
 * and release each URL when its last visible consumer leaves. These bounds do not measure decoded image RAM. */
export function previewPool({ changed, dispose, concurrency = 2, maxBytes = 32 << 20, maxJobs = 64,
	scheduleRetry = setTimeout, cancelRetry = clearTimeout }) {
	const jobs = new Map(), owners = new Map();
	let active = 0, bytes = 0, closed = false;
	const pump = () => {
		if (closed) return;
		for (const job of jobs.values()) {
			if (active >= concurrency) break;
			if (job.state !== 'queued' || bytes + job.bytes > maxBytes) continue;
			job.state = 'loading'; active++; bytes += job.bytes;
			Promise.resolve().then(() => {
				job.controller.signal.throwIfAborted();
				return job.load(job.controller.signal);
			}).then((value) => {
				if (closed || jobs.get(job.key) !== job) { dispose(value); return; }
				job.value = value; job.state = 'ready'; changed(job.key, value);
			}, () => {
				if (jobs.get(job.key) !== job) return;
				job.state = 'failed'; job.failures = Math.min(6, job.failures + 1);
				job.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** (job.failures - 1));
			}).finally(() => {
				active--;
				if (job.state !== 'ready') bytes -= job.bytes;
				pump();
			});
		}
	};
	// A later world/visibility update requests one retry. Rapid updates share its bounded backoff timer;
	// a failed retry schedules nothing by itself, so an offline mounted row cannot poll forever.
	const retry = (job, load) => {
		if (job.state !== 'failed') return;
		job.load = load;
		if (job.retryTimer !== undefined) return;
		job.retryTimer = scheduleRetry(() => {
			job.retryTimer = undefined;
			if (closed || jobs.get(job.key) !== job || !job.owners.size) return;
			job.controller = new AbortController(); job.state = 'queued'; pump();
		}, Math.max(0, job.retryAt - Date.now()));
	};
	const release = (owner) => {
		const job = owners.get(owner);
		if (!job) return;
		owners.delete(owner); job.owners.delete(owner);
		if (job.owners.size) return;
		jobs.delete(job.key);
		if (job.retryTimer !== undefined) cancelRetry(job.retryTimer);
		job.controller.abort();
		if (job.state === 'ready') {
			bytes -= job.bytes; changed(job.key, null); dispose(job.value);
		}
		pump();
	};
	return {
		retain(owner, { key, bytes: size, load }) {
			if (closed) return false;
			const held = owners.get(owner);
			if (held?.key === key) { retry(held, load); return true; }
			release(owner);
			if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) return false;
			let job = jobs.get(key);
			if (!job) {
				if (jobs.size >= maxJobs) return false;
				job = { key, bytes: size, load, owners: new Set(), state: 'queued', controller: new AbortController(), failures: 0, retryAt: 0, retryTimer: undefined };
				jobs.set(key, job);
			}
			owners.set(owner, job); job.owners.add(owner); retry(job, load); pump(); return true;
		},
		release,
		close() { closed = true; for (const owner of [...owners.keys()]) release(owner); }
	};
}
