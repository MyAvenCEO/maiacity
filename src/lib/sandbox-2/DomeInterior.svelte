<!--
	Stepping inside a dome: a full-screen, walkable interior (interior/interior.ts)
	over the island. Drag or click to look, WASD or the arrows to walk, Shift to
	hurry, Esc and the button to come back out.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DOMES, type DomeKind, type InteriorHandle } from './interior/interior';

	let { kind, place, onclose }: { kind: DomeKind; place: string; onclose: () => void } = $props();

	let stage: HTMLDivElement;
	let handle: InteriorHandle | null = null;
	let loading = $state(true);
	const spec = $derived(DOMES[kind]);

	onMount(() => {
		// building a big dome takes a moment: let the loading word paint first
		requestAnimationFrame(() =>
			requestAnimationFrame(() =>
				void import('./interior/interior').then(({ mountInterior }) => {
					handle = mountInterior(stage, kind, () => (loading = false));
				})
			)
		);
	});
	onDestroy(() => handle?.dispose());

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
	<p class="help">Drag to look · WASD to walk · Shift to hurry{spec.gallery ? ' · the stair leads up to the private rooms' : ''}</p>
	{#if loading}<div class="loading" role="status">Opening the door…</div>{/if}
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
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: #f2efe7;
		color: #7b857a;
	}
</style>
