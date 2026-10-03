<!--
	The backyard: a Munich courtyard built from photos (src/lib/worlds/backyard) — the pergola terrace in front of the old
	workshop, the garden corner, the shed and the driveway; walked like every sandbox: drag to look, WASD to walk, Shift
	to hurry.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { BackyardHandle } from '$lib/worlds/backyard';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let status = $state('Loading the backyard…');
	let yard: BackyardHandle | null = null;
	let destroyed = false;
	onMount(async () => {
		const { mountBackyard } = await import('$lib/worlds/backyard');
		const y = await mountBackyard(stage!, (label) => (status = label === 'ready' ? '' : `${label}…`));
		if (destroyed) return y.dispose();
		yard = y;
	});
	onDestroy(() => {
		destroyed = true;
		yard?.dispose();
	});
</script>

<svelte:head>
	<title>The backyard · Worlds · maiaCITY</title>
</svelte:head>

<div class="world">
	<div class="stage" bind:this={stage}></div>
	<WorldBar title="The backyard" subtitle="Munich · the courtyard, the pergola terrace, the garden corner" />
	{#if status}<p class="status">{status}</p>{/if}
	<WalkHint />
	<TouchStick move={(x, y, hurry) => yard?.move(x, y, hurry)} look={(dx, dy) => yard?.look(dx, dy)} {stage} taps=".bar a, .bar button" />
</div>

<style>
	.world {
		position: fixed;
		inset: 0;
		background: #b8a58c;
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
