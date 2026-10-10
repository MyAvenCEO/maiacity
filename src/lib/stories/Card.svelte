<!--
	A title card, drawn from its layers on a 16:9 canvas: a picture (the background), a cut-out (a transparent PNG laid
	over it), the hook as text, a badge ("DAY 1"). Every position is a percent of the canvas, a text's size a percent
	of its width, so the card reads the same at any size: on the Thumbnail step large and editable (a layer is picked
	by clicking it and moved by dragging, sized by a corner, turned by the handle above it), on the Hook step small as
	the YouTube preview. A text breaks its lines only
	where its words do (the image title is one line per entry): its box hugs the lines, never wider than its width,
	so the large card, the small preview and the rendered JPEG (card.js) show the same lines.
-->
<script>
	import { fileUrl } from '$lib/auth/client';

	/** @typedef {import('$lib/auth/client').Layer} Layer */

	/**
	 * @type {{
	 *   layers: Layer[],
	 *   hook?: string,
	 *   selected?: string | null,
	 *   editable?: boolean,
	 *   onselect?: (id: string) => void,
	 *   onmove?: (id: string, x: number, y: number) => void,
	 *   onresize?: (id: string, patch: { w?: number, size?: number, rot?: number }) => void
	 * }}
	 */
	let { layers, hook = '', selected = null, editable = false, onselect, onmove, onresize } = $props();

	/** @type {HTMLElement | null} */
	let canvas = $state(null);

	/** the colours a text can be, by name (a badge: its fill; alert is the red one); anything else is taken as written */
	const COLOR = { white: '#ffffff', gold: '#f6c75a', ink: '#1d2b22', alert: '#e0352b', marine: '#14304f' };
	const colorOf = (/** @type {string | undefined} */ c) => COLOR[/** @type {keyof typeof COLOR} */ (c ?? 'white')] ?? c ?? '#fff';
	/** a badge's words: the dark marine blue on the light fills (gold, white), white on the dark ones (alert, ink) */
	const onFill = (/** @type {string | undefined} */ c) => (['gold', 'white'].includes(c ?? 'gold') ? COLOR.marine : '#fff');
	const rotOf = (/** @type {Layer} */ l) => l.rot ?? 0;
	const turned = (/** @type {Layer} */ l) => (rotOf(l) ? `rotate(${rotOf(l)}deg)` : undefined);

	/** a layer's box, in percent of the canvas; its defaults by kind */
	function boxOf(/** @type {Layer} */ l) {
		const d = l.kind === 'image' ? { x: 0, y: 0, w: 100 } : l.kind === 'cutout' ? { x: 0, y: 10, w: 45 } : l.kind === 'badge' ? { x: 82, y: 86, w: 0 } : { x: 48, y: 16, w: 48 };
		return { x: l.x ?? d.x, y: l.y ?? d.y, w: l.w ?? d.w };
	}
	const sizeOf = (/** @type {Layer} */ l) => l.size ?? (l.kind === 'badge' ? 2.4 : 6.2);

	// ── dragging a layer (the Thumbnail step): its body moves it, the grip at its corner sizes it ──
	/** @type {{ id: string, px: number, py: number, x: number, y: number } | null} */
	let drag = null;
	/** @type {{ id: string, px: number, side: number, w: number, size: number, words: boolean, wide: number } | null} */
	let grip = null;
	/** @type {{ id: string, cx: number, cy: number, from: number, rot: number } | null} */
	let turn = null;

	/** the layer's own element, from a handle on it */
	const layerOf = (/** @type {Event} */ e) => /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (e.currentTarget).parentElement);

	/** a corner taken: dragging it outward grows the layer. @param {PointerEvent} e @param {Layer} l @param {number} side -1 a left corner, 1 a right one */
	function gripDown(e, l, side) {
		if (!editable || e.button !== 0 || !canvas) return;
		const b = boxOf(l);
		// the layer's box as it is, in percent of the card: what the drag is measured against
		const wide = (layerOf(e).getBoundingClientRect().width / canvas.getBoundingClientRect().width) * 100;
		grip = { id: l.id, px: e.clientX, side, w: b.w, size: sizeOf(l), words: l.kind === 'text' || l.kind === 'badge', wide: Math.max(wide, 1) };
		/** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
		e.preventDefault();
		e.stopPropagation();
	}

	/** @param {PointerEvent} e */
	function gripMove(e) {
		if (!grip || !canvas) return;
		const dx = (grip.side * (e.clientX - grip.px) * 100) / canvas.getBoundingClientRect().width;
		// words (a text, a badge) hug their box: the corner scales them; a picture's corner sets its width
		if (grip.words) onresize?.(grip.id, { size: Math.max(0.8, Math.round(((grip.size * (grip.wide + dx)) / grip.wide) * 10) / 10) });
		else onresize?.(grip.id, { w: Math.max(4, Math.round((grip.w + dx) * 10) / 10) });
	}

	const gripUp = () => (grip = null);

	const angleTo = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {PointerEvent} */ e) => (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;

	/** the handle above a layer taken: dragging it round turns the layer about its centre. @param {PointerEvent} e @param {Layer} l */
	function turnDown(e, l) {
		if (!editable || e.button !== 0) return;
		const r = layerOf(e).getBoundingClientRect();
		const cx = r.left + r.width / 2;
		const cy = r.top + r.height / 2;
		turn = { id: l.id, cx, cy, from: angleTo(cx, cy, e), rot: rotOf(l) };
		/** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
		e.preventDefault();
		e.stopPropagation();
	}

	/** @param {PointerEvent} e */
	function turnMove(e) {
		if (!turn) return;
		let rot = turn.rot + angleTo(turn.cx, turn.cy, e) - turn.from;
		rot = ((((rot + 180) % 360) + 360) % 360) - 180;
		if (Math.abs(rot) < 2) rot = 0; // straight again, easily
		onresize?.(turn.id, { rot: Math.round(rot * 10) / 10 });
	}

	const turnUp = () => (turn = null);

	/** @param {PointerEvent} e @param {Layer} l */
	function down(e, l) {
		if (!editable) return;
		onselect?.(l.id);
		if (e.button !== 0 || !canvas) return;
		const b = boxOf(l);
		drag = { id: l.id, px: e.clientX, py: e.clientY, x: b.x, y: b.y };
		/** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	/** @param {PointerEvent} e */
	function move(e) {
		if (!drag || !canvas) return;
		const r = canvas.getBoundingClientRect();
		const x = drag.x + ((e.clientX - drag.px) / r.width) * 100;
		const y = drag.y + ((e.clientY - drag.py) / r.height) * 100;
		onmove?.(drag.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
	}

	const up = () => (drag = null);
</script>

{#snippet handles(/** @type {Layer} */ l)}
	{#if editable && selected === l.id}
		<!-- the picked layer's handles: a grip at each corner sizes it, the one above turns it -->
		{#each [['tl', -1], ['tr', 1], ['bl', -1], ['br', 1]] as [at, side] (at)}
			<span class="grip {at}" role="presentation" title="Drag to size it" onpointerdown={(e) => gripDown(e, l, /** @type {number} */ (side))} onpointermove={gripMove} onpointerup={gripUp} onpointercancel={gripUp}></span>
		{/each}
		<span class="turn" role="presentation" title="Drag to turn it" onpointerdown={(e) => turnDown(e, l)} onpointermove={turnMove} onpointerup={turnUp} onpointercancel={turnUp}></span>
	{/if}
{/snippet}

<div class="card" class:editable bind:this={canvas} role="img" aria-label="The title card">
	{#each layers.filter((l) => l.on !== false) as l (l.id)}
		{@const b = boxOf(l)}
		{#if l.kind === 'image'}
			<div
				class="layer image" role="presentation"
				class:picked={selected === l.id}
				style:left="{b.x}%"
				style:top="{b.y}%"
				style:width="{b.w}%"
				style:height="{b.w}%"
				style:transform={turned(l)}
				onpointerdown={(e) => down(e, l)}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
			>
				{#if l.hash}
					<img src={fileUrl(l.hash)} alt="" draggable="false" style:object-fit={l.fit ?? 'cover'} />
				{:else}
					<span class="none">No picture yet</span>
				{/if}
				{@render handles(l)}
			</div>
		{:else if l.kind === 'cutout'}
			<div class="layer cutout" role="presentation" class:picked={selected === l.id} style:left="{b.x}%" style:top="{b.y}%" style:width="{b.w}%" style:transform={turned(l)} onpointerdown={(e) => down(e, l)} onpointermove={move} onpointerup={up} onpointercancel={up}>
				{#if l.hash}
					<img src={fileUrl(l.hash)} alt="" draggable="false" />
				{:else}
					<span class="none">No cut-out yet</span>
				{/if}
				{@render handles(l)}
			</div>
		{:else if l.kind === 'badge'}
			<div class="layer badge" role="presentation" class:picked={selected === l.id} style:left="{b.x}%" style:top="{b.y}%" style:font-size="{sizeOf(l)}cqw" style:background={colorOf(l.color ?? 'gold')} style:color={onFill(l.color)} style:transform={turned(l)} onpointerdown={(e) => down(e, l)} onpointermove={move} onpointerup={up} onpointercancel={up}>
				{l.text || 'DAY 1'}
				{@render handles(l)}
			</div>
		{:else}
			<div
				class="layer text" role="presentation"
				class:picked={selected === l.id}
				style:left="{b.x}%"
				style:top="{b.y}%"
				style:max-width="{b.w}%"
				style:font-size="{sizeOf(l)}cqw"
				style:color={colorOf(l.color)}
				style:text-align={l.align ?? 'left'}
				style:transform={turned(l)}
				onpointerdown={(e) => down(e, l)}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
			>
				{l.text || hook || 'The hook'}
				{@render handles(l)}
			</div>
		{/if}
	{/each}
</div>

<style>
	.card {
		position: relative;
		aspect-ratio: 16 / 9;
		width: 100%;
		overflow: hidden;
		border-radius: 12px;
		background: #111;
		container-type: inline-size;
		user-select: none;
	}

	.layer {
		position: absolute;
		box-sizing: border-box;
		transform-origin: center;
	}

	.editable .layer {
		cursor: grab;
	}

	.editable .layer:active {
		cursor: grabbing;
	}

	/* the picked layer, outlined (the outline drawn inside, so a full background still shows it) */
	.editable .picked {
		outline: 2px solid #f6c75a;
		outline-offset: -2px;
	}

	/* the picked layer's corners: drag one to size the layer */
	.grip {
		position: absolute;
		width: 1.6cqw;
		height: 1.6cqw;
		min-width: 12px;
		min-height: 12px;
		border: 2px solid #1d2b22;
		border-radius: 3px;
		background: #f6c75a;
		touch-action: none;
	}

	.grip.tl {
		top: -0.7cqw;
		left: -0.7cqw;
		cursor: nwse-resize;
	}

	.grip.tr {
		top: -0.7cqw;
		right: -0.7cqw;
		cursor: nesw-resize;
	}

	.grip.bl {
		bottom: -0.7cqw;
		left: -0.7cqw;
		cursor: nesw-resize;
	}

	.grip.br {
		right: -0.7cqw;
		bottom: -0.7cqw;
		cursor: nwse-resize;
	}

	/* the handle above the picked layer: drag it round to turn the layer */
	.turn {
		position: absolute;
		top: -3.2cqw;
		left: calc(50% - 0.8cqw);
		width: 1.6cqw;
		height: 1.6cqw;
		min-width: 12px;
		min-height: 12px;
		border: 2px solid #1d2b22;
		border-radius: 50%;
		background: #f6c75a;
		cursor: grab;
		touch-action: none;
	}

	.turn::before {
		content: '';
		position: absolute;
		top: 100%;
		left: calc(50% - 1px);
		width: 2px;
		height: 1.6cqw;
		min-height: 10px;
		background: #f6c75a;
	}

	.image img {
		display: block;
		width: 100%;
		height: 100%;
		filter: saturate(1.12) contrast(1.08);
	}

	.cutout img {
		display: block;
		width: 100%;
		height: auto;
		filter: drop-shadow(0 1cqw 2cqw rgb(0 0 0 / 0.45));
	}

	.none {
		display: grid;
		place-items: center;
		width: 100%;
		min-height: 6cqw;
		padding: 1cqw;
		font-size: 1.4cqw;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: rgb(255 255 255 / 0.6);
		background: rgb(255 255 255 / 0.08);
	}

	.image .none {
		height: 100%;
	}

	/* the hook: heavy, big, white, a firm shade behind it — as scripts/film/thumbnail.mjs sets it; the box hugs the
	   lines (width: max-content), which break only at the words' own line breaks, so every size shows the same */
	.text {
		width: max-content;
		padding: 1.2cqw 1.6cqw;
		border-radius: 1cqw;
		background: rgb(0 0 0 / 0.32);
		box-shadow: 0 0 3cqw 3cqw rgb(0 0 0 / 0.32);
		font-family: var(--font-display);
		font-weight: 800;
		line-height: 0.95;
		letter-spacing: -0.025em;
		text-shadow:
			0 0.3cqw 1.2cqw rgb(0 0 0 / 0.55),
			0 0.1cqw 0.2cqw rgb(0 0 0 / 0.45);
		white-space: pre;
	}

	/* the day's badge: dark marine words, tight, on a solid gold fill */
	.badge {
		padding: 0.3em 0.55em;
		border-radius: 0.35em;
		font-family: var(--font-display);
		font-weight: 900;
		line-height: 1;
		letter-spacing: 0;
		text-transform: uppercase;
		white-space: nowrap;
		box-shadow: 0 0.3cqw 1.2cqw rgb(0 0 0 / 0.35);
	}
</style>
