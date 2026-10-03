<!--
	The Isar in Munich: from the Wittelsbacherbrücke south to the railway bridge, flowing north (src/lib/worlds/isar) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry; along both banks' riverside ways, into the
	river, up onto the Wittelsbacherbrücke. Its map and its ground are open data, credited on the Worlds page.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { IsarHandle } from '$lib/worlds/isar';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let status = $state('Loading the river…');
	let river: IsarHandle | null = null;
	let destroyed = false;
	onMount(async () => {
		const { mountIsar } = await import('$lib/worlds/isar');
		const r = await mountIsar(stage!, (label) => (status = label === 'ready' ? '' : `${label}…`));
		if (destroyed) return r.dispose();
		river = r;
	});
	onDestroy(() => {
		destroyed = true;
		river?.dispose();
	});
</script>

<svelte:head>
	<title>The Isar · Worlds · maiaCITY</title>
</svelte:head>

<div class="world">
	<div class="stage" bind:this={stage}></div>
	<WorldBar title="The Isar" subtitle="Munich · Wittelsbacherbrücke to the railway bridge" />
	{#if status}<p class="status">{status}</p>{/if}
	<WalkHint />
	<TouchStick move={(x, y, hurry) => river?.move(x, y, hurry)} look={(dx, dy) => river?.look(dx, dy)} {stage} taps=".bar a, .bar button" />
</div>

<style>
	.world {
		position: fixed;
		inset: 0;
		background: #8fa7b3;
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
		color: #1f2a23;
		font-size: 0.85rem;
		z-index: 2;
	}
</style>
