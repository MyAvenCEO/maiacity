/** @param {() => Promise<void>} read @param {{ allowed?: () => boolean, delay?: number, failed?: (error: unknown) => void }} [options] */
export function refreshQueue(read, { allowed = () => true, delay = 150, failed = () => {} } = {}) {
	let dirty = false;
	let running = false;
	let closed = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	const schedule = () => {
		if (closed || running || timer !== undefined || !dirty || !allowed()) return;
		timer = setTimeout(async () => {
			timer = undefined;
			if (closed || !allowed()) return;
			dirty = false;
			running = true;
			try { await read(); } catch (error) { if (!closed) failed(error); }
			finally { running = false; schedule(); }
		}, delay);
	};
	return {
		invalidate() { dirty = true; schedule(); },
		resume: schedule,
		close() { closed = true; dirty = false; clearTimeout(timer); timer = undefined; }
	};
}
