/** Pace preview frames on a stable clock without accumulating timing drift. */
export class FramePacer {
	next = 0;
	rate = 0;
	/** @param {number} now @param {number} fps */
	accept(now, fps) {
		if (fps !== this.rate) {
			this.rate = fps;
			this.next = now;
		}
		if (now + 1 < this.next) return false;
		const interval = 1000 / fps;
		this.next += (Math.floor(Math.max(0, now - this.next) / interval) + 1) * interval;
		return true;
	}
	reset() {
		this.rate = 0;
		this.next = 0;
	}
}
