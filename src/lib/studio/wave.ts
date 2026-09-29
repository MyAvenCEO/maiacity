/** Draws the part of a sound's waveform that a clip plays (a Svelte action on a canvas). */
export function wave(canvas: HTMLCanvasElement, args: { peaks: number[]; from: number; to: number; total: number; color: string }) {
	const draw = ({ peaks, from, to, total, color }: typeof args) => {
		const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
		canvas.width = Math.max(1, w * dpr);
		canvas.height = Math.max(1, h * dpr);
		const g = canvas.getContext('2d')!;
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
