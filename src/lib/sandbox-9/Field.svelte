<!--
	Sandbox 8 · one field on one canvas ($lib/sandbox-9/field.js does the drawing). It sizes its canvas to its box
	(devicePixelRatio at most 1.5), and a tap on a blob picks that person or COOP. The lab draws both fields from one
	animation loop, at most 30 times a second, through draw().
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { createField } from './field.js';

	/** @type {{ label: string, sub?: string, tone: 'base' | 'changed', selected?: any, bars?: number, onpick?: (p: any) => void }} */
	let { label, sub = '', tone, selected = null, bars = -1, onpick } = $props();

	/** @type {HTMLCanvasElement} */
	let canvas;
	/** @type {HTMLDivElement} */
	let box;
	/** @type {ReturnType<typeof createField> | null} */
	let field = null;

	onMount(() => {
		field = createField(canvas);
		const ro = new ResizeObserver(() => {
			const r = box.getBoundingClientRect();
			field?.resize(r.width, r.height, window.devicePixelRatio || 1);
		});
		ro.observe(box);
		return () => ro.disconnect();
	});
	$effect(() => field?.select(selected));
	$effect(() => void field?.setBars(bars));

	/** a new day for this field */
	export function setFrame(/** @type {any} */ f) {
		field?.setFrame(f);
	}
	/** draw now (called by the lab's loop) */
	export function draw(/** @type {number} */ now) {
		field?.draw(now);
	}

	function tap(/** @type {MouseEvent} */ e) {
		const r = canvas.getBoundingClientRect();
		const p = field?.pick(e.clientX - r.left, e.clientY - r.top);
		onpick?.(p ?? null);
	}
</script>

<div class="field" bind:this={box}>
	<canvas bind:this={canvas} onclick={tap}></canvas>
	<div class="tag {tone}"><b>{label}</b>{#if sub}<span>{sub}</span>{/if}</div>
</div>

<style>
	.field {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		min-width: 0;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		cursor: pointer;
		touch-action: manipulation;
	}
	.tag {
		position: absolute;
		top: 0.35rem;
		left: 0.45rem;
		display: flex;
		flex-direction: column;
		max-width: 70%;
		pointer-events: none;
		font-size: 0.72rem;
		line-height: 1.25;
		padding: 0.2rem 0.5rem;
		border-radius: 8px;
		background: rgb(250 248 242 / 0.88);
		border-left: 3px solid #2a78d6;
	}
	.tag.changed {
		border-left-color: #eb6834;
	}
	.tag span {
		color: var(--ink-soft);
	}
</style>
