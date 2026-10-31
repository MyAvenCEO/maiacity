// Contrast as Face.lean has it, in integers (aven/runtimes/spec, `linear`, `reaches`): sRGB to linear light × 10⁷,
// luminance × 10¹¹, and a ratio reached when den × (hi + 0.05) ≥ num × (lo + 0.05). The tests replay the spec's
// vectors (contrast.json), so this, the face-runtime and the applier compute the same ratio.
export const linear = Array.from({ length: 256 }, (_, i) => {
	const v = i / 255;
	return Math.round((v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) * 1e7);
});

const flare = 5_000_000_000;

export const luminance = ([r, g, b]) => 2126 * linear[r] + 7152 * linear[g] + 722 * linear[b];

export const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// whether two colours reach num:den (4.5:1 is 9:2)
export function reaches(a, b, num, den) {
	const [x, y] = [luminance(a), luminance(b)];
	const hi = Math.max(x, y);
	const lo = Math.min(x, y);
	return den * (hi + flare) >= num * (lo + flare);
}

// enough contrast for a text: 4.5:1, or 3:1 when it is large
export const contrastOk = (fg, bg, large) => (large ? reaches(fg, bg, 3, 1) : reaches(fg, bg, 9, 2));
