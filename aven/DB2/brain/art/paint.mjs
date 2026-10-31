// avenBRAIN's paint kit: objects drawn by hand in code as SVG, the way the reference icons are painted. Soft wobbly
// dark outlines, volume from gradients lit from the top left, a fine paper grain over every surface, and a soft
// mauve shadow to the lower right. render.mjs turns each object into a transparent PNG, named by its BLAKE3 hash, that
// a slide places as an image layer.

// a seeded random, so a drawing is the same every time it is built
export function rng(seed) {
	let s = seed >>> 0 || 1;
	return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// a closed shape through points, its corners jittered a little and joined by smooth curves: a hand-drawn line
export function blob(points, { wobble = 1.2, seed = 1, closed = true, round = 0.1 } = {}) {
	const r = rng(seed);
	// long straight edges keep points near their ends, so a box keeps its corners, only a little rounded
	const dense = [];
	points.forEach((a, i) => {
		dense.push(a);
		const b = points[(i + 1) % points.length];
		if (!closed && i === points.length - 1) return;
		if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 24) return;
		for (const t of [round, 0.5, 1 - round]) dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
	});
	const p = dense.map(([x, y]) => [x + (r() - 0.5) * 2 * wobble, y + (r() - 0.5) * 2 * wobble]);
	const n = p.length;
	const at = (i) => p[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
	let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
	for (let i = 0; i < (closed ? n : n - 1); i++) {
		const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
		const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
		const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
		d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
	}
	return closed ? `${d} Z` : d;
}

// points round an ellipse, from angle a0 to a1 (radians), n of them
export const arc = (cx, cy, rx, ry, a0, a1, n) => Array.from({ length: n }, (_, i) => {
	const a = a0 + ((a1 - a0) * i) / (n - 1);
	return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
});
export const ellipse = (cx, cy, rx, ry, n = 16) => arc(cx, cy, rx, ry, 0, Math.PI * 2 * (1 - 1 / n), n);

export const INK = '#3b2c27';

// a filled shape with the hand-drawn outline
export const shape = (d, fill, { stroke = INK, width = 2.6, extra = '' } = {}) =>
	`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
// a line only: grain, a seam, a highlight
export const line = (d, stroke, width = 1.6, opacity = 1) =>
	`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}"/>`;

let gid = 0;
// a gradient, lit from the top left: returns [defs, url]
export function grad(stops, { x1 = 0, y1 = 0, x2 = 1, y2 = 1, radial = false, cx = 0.35, cy = 0.3, r = 0.8 } = {}) {
	const id = `g${++gid}`;
	const st = stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('');
	const def = radial
		? `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${st}</radialGradient>`
		: `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${st}</linearGradient>`;
	return [def, `url(#${id})`];
}

// a drawing: its gradients, then its shadow, then its body under a paper grain
export function drawing(w, h, defs, shadow, body) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/>
<feColorMatrix in="noise" type="matrix" values="0 0 0 0 0.22  0 0 0 0 0.15  0 0 0 0 0.1  0 0 0 0.55 -0.12" result="speck"/>
<feComposite in="speck" in2="SourceAlpha" operator="in" result="grainy"/>
<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="grainy"/></feMerge>
</filter>
${defs.join('\n')}
</defs>
${shadow ? `<ellipse cx="${shadow[0]}" cy="${shadow[1]}" rx="${shadow[2]}" ry="${shadow[3]}" fill="#8f7b86" opacity="0.32" filter="url(#soft)"/>` : ''}
<g filter="url(#grain)">
${body.join('\n')}
</g>
</svg>`;
}
