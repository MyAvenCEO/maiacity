<!--
	The room (Day 02): a real bedroom of about 14 m², built to its measure from photos (src/lib/worlds/room.ts) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { RoomHandle } from '$lib/worlds/room';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyControl, WalkHint } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let room: RoomHandle | null = null;
	let destroyed = false;
	onMount(async () => {
		const { mountRoom } = await import('$lib/worlds/room');
		const r = await mountRoom(stage!);
		if (destroyed) return r.dispose();
		room = r;
	});
	onDestroy(() => {
		destroyed = true;
		room?.dispose();
	});
</script>

<svelte:head>
	<title>Apartment of Samuel · Worlds · maiaCITY</title>
</svelte:head>

<div class="world">
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<a class="out" href="{base}/app/worlds/">← Worlds</a>
		<div class="title"><strong>Apartment of Samuel</strong><span>Day 02 · his room, the hallway, the kitchen, the bathroom</span></div>
		<SkyControl class="time" />
	</div>
	<WalkHint />
	<TouchStick move={(x, y, hurry) => room?.move(x, y, hurry)} look={(dx, dy) => room?.look(dx, dy)} {stage} taps=".bar a, .bar button" />
</div>

<style>
	.world {
		position: fixed;
		inset: 0;
		background: #2a2622;
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
