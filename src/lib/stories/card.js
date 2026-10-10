// The title card rendered from its layers, as a picture: the same layout Card.svelte draws on the page (every place a
// percent of the 16:9 canvas, a text's size a percent of its width), drawn on a canvas at full size and encoded as a
// JPEG — what goes into the vault as the card, and what YouTube gets. Every picture comes from the vault (vault://
// in the Mac app, the gateway on the web, both answering CORS so the canvas stays exportable); the font is the page's
// own Fraunces, loaded before drawing.
import { fileUrl } from '$lib/auth/client';

/** @typedef {import('$lib/auth/client').Layer} Layer */

/** the colours a text can be, by name; anything else is taken as written — as Card.svelte */
const COLOR = { white: '#ffffff', gold: '#f6c75a', ink: '#1d2b22', alert: '#e0352b', marine: '#14304f' };
const colorOf = (/** @type {string | undefined} */ c) => COLOR[/** @type {keyof typeof COLOR} */ (c ?? 'white')] ?? c ?? '#fff';
/** a badge's words: white on any fill but the white one, the cold style, whose words are the dark marine blue — as Card.svelte */
const onFill = (/** @type {string | undefined} */ c) => ((c ?? 'gold') === 'white' ? COLOR.marine : '#fff');
const FONT = '"Fraunces Variable", "Iowan Old Style", Georgia, serif';

/** a layer's box, in percent of the canvas; its defaults by kind — as Card.svelte */
function boxOf(/** @type {Layer} */ l) {
	const d = l.kind === 'image' ? { x: 0, y: 0, w: 100 } : l.kind === 'cutout' ? { x: 0, y: 10, w: 45 } : l.kind === 'badge' ? { x: 82, y: 86, w: 0 } : { x: 48, y: 16, w: 48 };
	return { x: l.x ?? d.x, y: l.y ?? d.y, w: l.w ?? d.w };
}
const sizeOf = (/** @type {Layer} */ l) => l.size ?? (l.kind === 'badge' ? 2.4 : 6.2);

/** A picture out of the vault, drawable on a canvas. @param {string} hash */
function picture(hash) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error(`The picture ${hash.slice(0, 10)}… could not be loaded.`));
		img.src = fileUrl(hash);
	});
}

/** A text's lines: where its words break them (the image title is one line per entry) — as Card.svelte, white-space: pre. */
const linesOf = (/** @type {string} */ text) => text.split('\n').map((l) => l.replace(/\s+$/, ''));

/**
 * The card as a JPEG, drawn from its layers at `width` pixels (3240 for the master: the wide and the tall crops stay
 * sharp). A layer whose picture cannot be loaded stops the render, with a sentence saying which.
 * @param {Layer[]} layers @param {string} hook what an empty text says @param {{ width?: number, quality?: number }} [o]
 * @returns {Promise<Blob>}
 */
export async function renderCard(layers, hook, o = {}) {
	const W = o.width ?? 3240;
	const H = Math.round((W * 9) / 16);
	const shown = layers.filter((l) => l.on !== false);
	// the pictures first, all of them, so a missing one is said before anything is drawn
	const pics = new Map(await Promise.all(shown.filter((l) => (l.kind === 'image' || l.kind === 'cutout') && l.hash).map(async (l) => /** @type {[string, HTMLImageElement]} */ ([/** @type {string} */ (l.hash), await picture(/** @type {string} */ (l.hash))]))));
	if (typeof document !== 'undefined' && document.fonts?.load) await Promise.all([document.fonts.load(`800 100px ${FONT}`), document.fonts.load(`760 100px ${FONT}`)]).catch(() => {});

	const canvas = document.createElement('canvas');
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No canvas here.');
	const cq = (/** @type {number} */ n) => (n / 100) * W; // n cqw
	ctx.fillStyle = '#111';
	ctx.fillRect(0, 0, W, H);

	for (const l of shown) {
		const b = boxOf(l);
		const bx = (b.x / 100) * W;
		const by = (b.y / 100) * H;
		const bwMax = (b.w / 100) * W;
		ctx.save();
		/** the layer turned about its box's centre, as the page does (transform-origin: center) @param {number} w @param {number} h */
		const turn = (w, h) => {
			if (!l.rot) return;
			ctx.translate(bx + w / 2, by + h / 2);
			ctx.rotate((l.rot * Math.PI) / 180);
			ctx.translate(-(bx + w / 2), -(by + h / 2));
		};
		if (l.kind === 'image') {
			const img = l.hash ? pics.get(l.hash) : undefined;
			const bw = bwMax;
			const bh = (b.w / 100) * H; // the box is 16:9 like the canvas
			turn(bw, bh);
			if (img) {
				ctx.beginPath();
				ctx.rect(bx, by, bw, bh);
				ctx.clip();
				const cover = (l.fit ?? 'cover') === 'cover';
				const s = cover ? Math.max(bw / img.naturalWidth, bh / img.naturalHeight) : Math.min(bw / img.naturalWidth, bh / img.naturalHeight);
				const dw = img.naturalWidth * s;
				const dh = img.naturalHeight * s;
				if ('filter' in ctx) ctx.filter = 'saturate(1.12) contrast(1.08)';
				ctx.drawImage(img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh);
			}
		} else if (l.kind === 'cutout') {
			const img = l.hash ? pics.get(l.hash) : undefined;
			if (img) {
				const bw = bwMax;
				const dh = (bw * img.naturalHeight) / img.naturalWidth;
				turn(bw, dh);
				ctx.shadowColor = 'rgba(0,0,0,0.45)';
				ctx.shadowBlur = cq(2);
				ctx.shadowOffsetY = cq(1);
				ctx.drawImage(img, bx, by, bw, dh);
			}
		} else if (l.kind === 'badge') {
			// white words, compact, on a solid fill in the badge's colour (gold), as Card.svelte
			const fs = cq(sizeOf(l));
			ctx.font = `760 ${fs}px ${FONT}`;
			if ('letterSpacing' in ctx) ctx.letterSpacing = `${0.04 * fs}px`;
			ctx.textBaseline = 'alphabetic';
			const words = (l.text || 'DAY 1').toUpperCase();
			const tw = ctx.measureText(words).width;
			const padX = 0.9 * fs;
			const padY = 0.5 * fs;
			const bw2 = tw + 2 * padX;
			const bh2 = fs + 2 * padY;
			turn(bw2, bh2);
			ctx.shadowColor = 'rgba(0,0,0,0.35)';
			ctx.shadowBlur = cq(1.2);
			ctx.shadowOffsetY = cq(0.3);
			ctx.beginPath();
			ctx.roundRect(bx, by, bw2, bh2, 0.45 * fs);
			ctx.fillStyle = colorOf(l.color ?? 'gold');
			ctx.fill();
			ctx.shadowBlur = 0;
			ctx.shadowOffsetY = 0;
			ctx.fillStyle = onFill(l.color);
			ctx.fillText(words, bx + padX, by + padY + fs * 0.82);
		} else {
			const fs = cq(sizeOf(l));
			const padX = cq(1.6);
			const padY = cq(1.2);
			ctx.font = `800 ${fs}px ${FONT}`;
			if ('letterSpacing' in ctx) ctx.letterSpacing = `${-0.025 * fs}px`;
			// the box hugs the lines, never wider than the layer's width — as Card.svelte (width: max-content)
			const lines = linesOf(l.text || hook || 'The hook');
			const lh = 0.95 * fs;
			const bw = Math.min(bwMax, Math.max(...lines.map((line) => ctx.measureText(line).width)) + 2 * padX);
			const bh2 = lines.length * lh + 2 * padY;
			turn(bw, bh2);
			// the shade: a dark box with a soft halo, as the page's box-shadow
			ctx.shadowColor = 'rgba(0,0,0,0.32)';
			ctx.shadowBlur = cq(3);
			ctx.fillStyle = 'rgba(0,0,0,0.32)';
			ctx.beginPath();
			ctx.roundRect(bx - cq(1.5), by - cq(1.5), bw + cq(3), bh2 + cq(3), cq(1.5));
			ctx.fill();
			ctx.shadowBlur = 0;
			ctx.beginPath();
			ctx.roundRect(bx, by, bw, bh2, cq(1));
			ctx.fill();
			// the words, with their shadow
			ctx.shadowColor = 'rgba(0,0,0,0.55)';
			ctx.shadowBlur = cq(1.2);
			ctx.shadowOffsetY = cq(0.3);
			ctx.fillStyle = colorOf(l.color);
			ctx.textBaseline = 'alphabetic';
			const align = l.align ?? 'left';
			ctx.textAlign = align;
			const tx = align === 'right' ? bx + bw - padX : align === 'center' ? bx + bw / 2 : bx + padX;
			lines.forEach((line, i) => ctx.fillText(line, tx, by + padY + i * lh + fs * 0.78));
		}
		ctx.restore();
	}
	return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The card could not be encoded.'))), 'image/jpeg', o.quality ?? 0.92));
}
