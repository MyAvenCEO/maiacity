<!--
	The room (Day 02): a real bedroom of about 14 m², built to its measure from photos (src/lib/worlds/room.ts) —
	walked like every sandbox: drag to look, WASD to walk, Shift to hurry.
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { RoomHandle } from '$lib/worlds/room';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';

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
	<WorldBar title="Apartment of Samuel" subtitle="Day 02 · his room, the hallway, the kitchen, the bathroom" />
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
</style>
