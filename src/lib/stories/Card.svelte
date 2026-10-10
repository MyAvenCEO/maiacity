<!--
	A title card, drawn from its layers on a 16:9 canvas: a picture (the background), a cut-out (a transparent PNG laid
	over it), the hook as text, a badge ("DAY 1"). Every position is a percent of the canvas, a text's size a percent
	of its width, so the card reads the same at any size: on the Thumbnail step large and editable (a layer is picked
	by clicking it and moved by dragging), on the Hook step small as the YouTube preview.
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
	 *   onmove?: (id: string, x: number, y: number) => void
	 * }}
	 */
	let { layers, hook = '', selected = null, editable = false, onselect, onmove } = $props();

	/** @type {HTMLElement | null} */
	let canvas = $state(null);

	/** the colours a text can be, by name; anything else is taken as written */
	const COLOR = { white: '#ffffff', gold: '#f6c75a', ink: '#1d2b22' };
	const colorOf = (/** @type {string | undefined} */ c) => COLOR[/** @type {keyof typeof COLOR} */ (c ?? 'white')] ?? c ?? '#fff';

	/** a layer's box, in percent of the canvas; its defaults by kind */
	function boxOf(/** @type {Layer} */ l) {
		const d = l.kind === 'image' ? { x: 0, y: 0, w: 100 } : l.kind === 'cutout' ? { x: 0, y: 10, w: 45 } : l.kind === 'badge' ? { x: 82, y: 86, w: 0 } : { x: 48, y: 16, w: 48 };
		return { x: l.x ?? d.x, y: l.y ?? d.y, w: l.w ?? d.w };
	}
	const sizeOf = (/** @type {Layer} */ l) => l.size ?? (l.kind === 'badge' ? 2.4 : 6.2);

	// ── dragging a layer (the Thumbnail step) ──
	/** @type {{ id: string, px: number, py: number, x: number, y: number } | null} */
	let drag = null;

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

<div class="card" class:editable bind:this={canvas} role="img" aria-label="The title card">
	{#each layers.filter((l) => l.on !== false) as l (l.id)}
		{@const b = boxOf(l)}
		{#if l.kind === 'image'}
			<div
				class="layer image"
				class:picked={selected === l.id}
				style:left="{b.x}%"
				style:top="{b.y}%"
				style:width="{b.w}%"
				style:height="{b.w}%"
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
			</div>
		{:else if l.kind === 'cutout'}
			<div class="layer cutout" class:picked={selected === l.id} style:left="{b.x}%" style:top="{b.y}%" style:width="{b.w}%" onpointerdown={(e) => down(e, l)} onpointermove={move} onpointerup={up} onpointercancel={up}>
				{#if l.hash}
					<img src={fileUrl(l.hash)} alt="" draggable="false" />
				{:else}
					<span class="none">No cut-out yet</span>
				{/if}
			</div>
		{:else if l.kind === 'badge'}
			<div class="layer badge" class:picked={selected === l.id} style:left="{b.x}%" style:top="{b.y}%" style:font-size="{sizeOf(l)}cqw" style:color={colorOf(l.color ?? 'gold')} onpointerdown={(e) => down(e, l)} onpointermove={move} onpointerup={up} onpointercancel={up}>
				{l.text || 'DAY 1'}
			</div>
		{:else}
			<div
				class="layer text"
				class:picked={selected === l.id}
				style:left="{b.x}%"
				style:top="{b.y}%"
				style:width="{b.w}%"
				style:font-size="{sizeOf(l)}cqw"
				style:color={colorOf(l.color)}
				style:text-align={l.align ?? 'left'}
				onpointerdown={(e) => down(e, l)}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
			>
				{l.text || hook || 'The hook'}
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

	/* the hook: heavy, big, white, a firm shade behind it — as scripts/film/thumbnail.mjs sets it */
	.text {
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
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	/* the day's badge: gold, letter-spaced, a gold edge on a dark fill */
	.badge {
		padding: 0.45em 0.8em;
		border: 0.12em solid currentColor;
		border-radius: 0.45em;
		background: rgb(10 14 12 / 0.55);
		font-family: var(--font-display);
		font-weight: 760;
		line-height: 1;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		white-space: nowrap;
		backdrop-filter: blur(4px);
	}
</style>
