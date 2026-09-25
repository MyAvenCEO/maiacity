<!--
	Stepping inside a dome: a full-screen, walkable interior (interior/interior.ts)
	over the island. Drag or click to look, WASD or the arrows to walk, Shift to
	hurry, Esc and the button to come back out.

	While the dome is built, two timber doors stand closed over it with the step
	being done written between them; when it is ready they swing open.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DOMES, type DomeKind, type InteriorHandle } from './interior/interior';

	let { kind, place, onclose }: { kind: DomeKind; place: string; onclose: () => void } = $props();

	let stage: HTMLDivElement;
	let handle: InteriorHandle | null = null;
	let destroyed = false;
	/** closed → opening (the doors swing) → open (gone) */
	let doors = $state<'closed' | 'opening' | 'open'>('closed');
	let step = $state('Opening the doors');
	const spec = $derived(DOMES[kind]);

	onMount(() => {
		// let the closed doors paint before the heavy build starts
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountInterior } = await import('./interior/interior');
				const h = await mountInterior(stage, kind, (label) => {
					if (label === 'ready') return;
					step = label;
				});
				if (destroyed) return h.dispose();
				handle = h;
				doors = 'opening';
				setTimeout(() => (doors = 'open'), 1300);
			})
		);
	});
	onDestroy(() => {
		destroyed = true;
		handle?.dispose();
	});

	const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.pointerLockElement && onclose();
</script>

<svelte:window onkeydown={onKey} />

<div class="interior">
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<button class="out" onclick={onclose}>← Back outside</button>
		<div class="title">
			<strong>{spec.label}</strong>
			<span>{place} · {spec.diameter} m across · {spec.people}</span>
		</div>
	</div>
	<p class="help">Drag to look · WASD to walk · Shift to hurry{spec.gallery ? ' · the stairs lead up to the private rooms and the terrace' : ' · the door leads out into the forest'}</p>

	{#if doors !== 'open'}
		<div class="loading" class:opening={doors === 'opening'} role="status" aria-live="polite">
			<div class="door left"><span class="panel"></span><span class="panel"></span><span class="handle"></span></div>
			<div class="door right"><span class="panel"></span><span class="panel"></span><span class="handle"></span></div>
			<div class="label">
				<strong>{spec.label}</strong>
				<span>{doors === 'opening' ? 'Welcome in' : `${step}…`}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.interior {
		position: absolute;
		inset: 0;
		z-index: 20;
		background: #f2efe7;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.bar {
		position: absolute;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 1rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		z-index: 2;
	}
	.out,
	.title {
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.9);
		backdrop-filter: blur(10px);
		font: inherit;
		font-size: 0.85rem;
		color: #1f2a23;
	}
	.out {
		cursor: pointer;
	}
	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
	.help {
		position: absolute;
		bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(31 42 35 / 0.75);
		color: #f2efe7;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	/* the closed doors, and their swing */
	.loading {
		position: absolute;
		inset: 0;
		z-index: 3;
		perspective: 1600px;
		background: linear-gradient(#cfe6f0, #f2efe7 70%);
		transition: background 1.2s ease;
	}
	.loading.opening {
		background: transparent;
	}
	.door {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 50%;
		display: grid;
		grid-template-rows: 1fr 1fr;
		gap: 3vh;
		padding: 6vh 4vw;
		box-sizing: border-box;
		background: repeating-linear-gradient(90deg, #8a5a33 0 18px, #93613a 18px 36px, #7f5230 36px 54px);
		box-shadow: inset 0 0 0 10px #6b4427;
		transition: transform 1.2s cubic-bezier(0.6, 0, 0.3, 1);
	}
	.door.left {
		left: 0;
		transform-origin: left center;
	}
	.door.right {
		right: 0;
		transform-origin: right center;
	}
	.opening .door.left {
		transform: rotateY(-100deg);
	}
	.opening .door.right {
		transform: rotateY(100deg);
	}
	.panel {
		border-radius: 999px 999px 8px 8px;
		background: linear-gradient(rgb(220 240 245 / 0.55), rgb(200 225 232 / 0.35));
		box-shadow: inset 0 0 0 6px #6b4427;
	}
	.handle {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 70px;
		border-radius: 6px;
		background: #2e3236;
		transform: translateY(-50%);
	}
	.left .handle {
		right: 22px;
	}
	.right .handle {
		left: 22px;
	}
	.label {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.3rem;
		padding: 1rem 1.6rem;
		border-radius: 18px;
		background: rgb(31 42 35 / 0.88);
		color: #f2efe7;
		text-align: center;
		transition: opacity 0.6s ease;
	}
	.opening .label {
		opacity: 0;
	}
	.label strong {
		font-family: var(--font-display, serif);
		font-size: 1.4rem;
		font-weight: 500;
	}
	.label span {
		font-size: 0.9rem;
		color: #f0a47c;
	}
</style>
