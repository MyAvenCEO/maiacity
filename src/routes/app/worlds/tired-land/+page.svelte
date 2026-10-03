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
	<WorldBar title="The tired land" subtitle="Day 19 · a highway through fields of one crop" />
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
</style>
