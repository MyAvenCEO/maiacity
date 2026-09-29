/** Draws the part of a sound's waveform that a clip plays (a Svelte action on a canvas). */
/**
 * @typedef {{ peaks: number[], from: number, to: number, total: number, color: string }} WaveArgs
 * @param {HTMLCanvasElement} canvas @param {WaveArgs} args
 */
export function wave(canvas, args) {
	/** @param {WaveArgs} a */
	const draw = ({ peaks, from, to, total, color }) => {
		const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
		canvas.width = Math.max(1, w * dpr);
		canvas.height = Math.max(1, h * dpr);
		const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
		g.scale(dpr, dpr);
		if (!peaks.length || !total) return;
		let top = 0;
		for (const p of peaks) top = Math.max(top, p);
		g.fillStyle = color;
		for (let px = 0; px < w; px++) {
			const t = from + ((to - from) * px) / w;
			const p = (peaks[Math.floor((t / total) * peaks.length)] ?? 0) / (top || 1);
			const bar = Math.max(0.5, p * (h / 2 - 2));
			g.fillRect(px, h / 2 - bar, 1, bar * 2);
		}
	};
	draw(args);
	return { update: draw };
}
