// @ts-nocheck — plain JS, kept loose on purpose
// A small clock for the SVG figures: calls onTick(seconds) every frame while the figure is on screen.
// With reduced motion it calls onTick once with `still` and never runs.

export function runClock(el, onTick, still = 0) {
	if (typeof window === 'undefined') return () => {};
	if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
		onTick(still);
		return () => {};
	}
	let raf = 0, visible = false, last = 0, t = 0;
	const frame = (now) => {
		t += Math.min(0.1, (now - last) / 1000);
		last = now;
		onTick(t);
		raf = requestAnimationFrame(frame);
	};
	const io = new IntersectionObserver(([e]) => {
		if (e.isIntersecting && !visible) {
			visible = true;
			last = performance.now();
			raf = requestAnimationFrame(frame);
		} else if (!e.isIntersecting && visible) {
			visible = false;
			cancelAnimationFrame(raf);
		}
	});
	io.observe(el);
	onTick(still);
	return () => {
		io.disconnect();
		cancelAnimationFrame(raf);
	};
}

export const HEART = 'M0,4 C-7,-1 -5,-8 0,-4.5 C5,-8 7,-1 0,4Z';

export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// a point on a quadratic curve from a to b, bent sideways by `bend` pixels (negative bends a left-to-right path upward)
export function arc(a, b, p, bend = -40) {
	const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
	const mx = (a[0] + b[0]) / 2 - (dy / len) * bend, my = (a[1] + b[1]) / 2 + (dx / len) * bend;
	const q = 1 - p;
	return [q * q * a[0] + 2 * q * p * mx + p * p * b[0], q * q * a[1] + 2 * q * p * my + p * p * b[1]];
}

// tells cb(true) while the figure is narrower than `px` (a phone held upright), so it can switch to a tall layout
export function watchNarrow(el, cb, px = 560) {
	if (typeof ResizeObserver === 'undefined') return () => {};
	const ro = new ResizeObserver(([e]) => cb(e.contentRect.width < px));
	ro.observe(el);
	return () => ro.disconnect();
}
