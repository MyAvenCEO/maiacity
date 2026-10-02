<!--
	The Isar in Munich: from the Wittelsbacherbrücke south to the railway bridge, flowing north (src/lib/worlds/isar) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry; along the east bank, into the river, up onto
	the Wittelsbacherbrücke. Its map and its ground are open data, credited at the foot of the page.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { IsarHandle } from '$lib/worlds/isar';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyControl, WalkHint } from '$lib/sandbox-kit';

	const CREDIT = '© OpenStreetMap contributors (ODbL) · DGM1 © Bayerische Vermessungsverwaltung (CC BY 4.0)';
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
	<div class="bar">
		<a class="out" href="{base}/app/worlds/">← Worlds</a>
		<div class="title"><strong>The Isar</strong><span>Munich · Wittelsbacherbrücke to the railway bridge</span></div>
		<SkyControl class="time" />
	</div>
	{#if status}<p class="status">{status}</p>{/if}
	<p class="credit">{CREDIT}</p>
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

	.credit {
		position: absolute;
		right: 0.6rem;
		bottom: calc(0.4rem + env(safe-area-inset-bottom, 0px));
		margin: 0;
		font-size: 0.65rem;
		color: rgb(255 255 255 / 0.8);
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
		z-index: 2;
		pointer-events: none;
	}
</style>
