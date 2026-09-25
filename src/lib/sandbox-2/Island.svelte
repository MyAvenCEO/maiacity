<!--
	A city's island, opened from a card of the planet: Sandbox 1's island world,
	copied into Sandbox 2 (./island) with the generator in game/island. What stands on
	it comes from the server: every settlement at its cell, at the level its
	headcount has reached. Nothing is kept in the browser.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { HexTile } from '../../../game/island/hexmap';
	import { buildingForLevel, type PlacedKind } from './island/buildWorld';
	import type { SceneApi } from './island/scene';
	import { gameHour } from '../../../game/time';

	let {
		seed,
		settlements,
		focus = undefined,
		onpick
	}: {
		/** The island seed, from the city's card on the planet. */
		seed: number;
		/** What stands on the island: a settlement at its cell, at its level. */
		settlements: { cell: string; level: number }[];
		/** The cell the opening shot frames. */
		focus?: string;
		/** A cell was chosen — or none, when the choice is cleared. */
		onpick: (tile: HexTile | null) => void;
	} = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let api: SceneApi | undefined = $state();
	let loading = $state(true);

	const buildings = $derived(
		Object.fromEntries(
			settlements.flatMap((s) => {
				const kind = buildingForLevel(s.level);
				return kind ? [[s.cell, kind as PlacedKind]] : [];
			})
		)
	);

	/* The parent hands in a fresh expression on every data refresh; a derived only
	   changes when the seed itself does, so a refresh never rebuilds the island. */
	const seedNow = $derived(seed);

	const twoFrames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

	$effect(() => {
		const el = canvas;
		const island = seedNow; // another city is another island: rebuild
		if (!el) return;
		let disposed = false;
		let sunTimer: ReturnType<typeof setInterval> | undefined;
		loading = true;
		// read once, untracked: new settlement data updates the island below, it never rebuilds it
		const first = untrack(() => $state.snapshot(buildings));
		void import('./island/scene').then(async ({ createScene }) => {
			if (disposed) return;
			// Growing the island clears its selection; only picks after that are the player's.
			let ready = false;
			const scene = createScene(el, { buildings: first, focus, onSelect: (tiles) => ready && onpick(tiles[0] ?? null) });
			// the sun stands where the in-game clock says, and moves on with it
			scene.setHour(gameHour());
			sunTimer = setInterval(() => scene.setHour(gameHour()), 2000);
			// growing the island takes a moment: let the loading word paint first
			await twoFrames();
			if (disposed) return scene.dispose();
			scene.setWorld(island);
			ready = true;
			api = scene;
			await twoFrames();
			loading = false;
		});
		return () => {
			disposed = true;
			clearInterval(sunTimer);
			api?.dispose();
			api = undefined;
		};
	});

	// A settlement founded, joined or grown: the island follows the server.
	$effect(() => {
		api?.setBuildings($state.snapshot(buildings));
	});

	/** Bring a cell to the middle of the view. */
	export function frame(cell: string) {
		api?.frame(cell);
	}
</script>

<div class="island">
	<canvas bind:this={canvas}></canvas>
	{#if loading}
		<div class="loading" role="status"><span>Landing on the island…</span></div>
	{/if}
</div>

<style>
	.island {
		position: absolute;
		inset: 0;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: #f2efe7;
		color: #7b857a;
		font-size: 0.95rem;
	}
</style>
