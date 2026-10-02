<!--
	The tired land (Day 19): the fields of one crop, the highway and its trucks (src/lib/worlds/tired-land.ts) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { TiredLandHandle } from '$lib/worlds/tired-land';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyControl, WalkHint } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let land: TiredLandHandle | null = null;
	let destroyed = false;
	onMount(async () => {
		const { mountTiredLand } = await import('$lib/worlds/tired-land');
		const r = await mountTiredLand(stage!);
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
	<div class="bar">
		<a class="out" href="{base}/app/worlds/">← Worlds</a>
		<div class="title"><strong>The tired land</strong><span>Day 19 · a highway through fields of one crop</span></div>
		<SkyControl class="time" />
	</div>
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

	.bar {
		position: absolute;
		top: calc(1rem + env(safe-area-inset-top, 0px));
		left: 1rem;
		right: 1rem;
		display: flex;
		gap: 0.5rem;
		align-items: center;
		z-index: 2;
	}

	.out,
	.title {
		padding: 0.55rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		font-size: 0.85rem;
		color: #1f2a23;
		text-decoration: none;
	}

	.bar :global(.time) {
		margin-left: auto;
	}

	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
</style>
