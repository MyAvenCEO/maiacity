<!--
	The tired land (Day 19): the fields of one crop, the highway and its trucks (src/lib/worlds/tired-land.ts) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { TiredLandHandle } from '$lib/worlds/tired-land';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let land: TiredLandHandle | null = null;
	let destroyed = false;
	let status = $state('Loading the tired land…');
	onMount(async () => {
		const { mountTiredLand } = await import('$lib/worlds/tired-land');
		const r = await mountTiredLand(stage!, (label) => (status = label === 'ready' ? '' : `${label}…`));
		if (destroyed) return r.dispose();
		land = r;
	});
	onDestroy(() => {
		destroyed = true;
		land?.dispose();
	});
</script>

<svelte:head>
	<title>The tired land · Worlds · maiaCITY</title>
</svelte:head>

<div class="world">
	<div class="stage" bind:this={stage}></div>
	<WorldBar title="The tired land" subtitle="Day 19 · a highway through fields of one crop" />
	{#if status}<p class="status">{status}</p>{/if}
	<WalkHint />
	<TouchStick move={(x, y, hurry) => land?.move(x, y, hurry)} look={(dx, dy) => land?.look(dx, dy)} {stage} taps=".bar a, .bar button" />
</div>

<style>
	.world {
		position: fixed;
		inset: 0;
		background: #6f6b4a;
	}

	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}

	.status {
		position: absolute;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		margin: 0;
		padding: 0.5rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.7);
		color: #2c2a1e;
		font-size: 0.85rem;
		z-index: 2;
	}
</style>
