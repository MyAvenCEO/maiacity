<!--
	avenCITY Sandbox 2 — the planet itself.

	A globe of hex cards drawn from the map of the Earth, full screen: drag to turn
	it, the wheel or a pinch to come closer, and at the bottom of the zoom walk on
	its cards. Nothing is founded, placed or entered here; it is just the planet.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import { calendar } from '../../../../../game/time';
	import { loadBiomeMap, loadDepthMap, loadLandMask, loadMountainMask } from '../../../../../game/map';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyControl } from '$lib/sandbox-kit';
	import type { WorldHandle } from '$lib/sandbox-2/world/world';

	let stage: HTMLDivElement;
	let world: WorldHandle | null = null;
	let loading = $state(true);
	let failed = $state(false);

	/* the game's month, as the planet's clock counts it */
	const now = calendar(new Date());
	const calendarLabel = `Y${now.year} · M${now.month}`;

	let disposed = false;

	onMount(() => {
		const url = (f: string) => `${base}/sandbox-2/map/${f}`;
		const quiet = <T,>(p: Promise<T>) => p.catch(() => undefined);
		void (async () => {
			try {
				const [{ mountWorld }, isLand, kindOf, isMountain, depthOf] = await Promise.all([
					import('$lib/sandbox-2/world/world'),
					quiet(loadLandMask(url('land.json'))),
					quiet(loadBiomeMap(url('biomes.json'))),
					quiet(loadMountainMask(url('mountains.geojson'))),
					quiet(loadDepthMap(url('depth.json')))
				]);
				if (disposed) return;
				world = mountWorld(stage, { isLand, kindOf, isMountain, depthOf });
			} catch {
				failed = true;
			}
			loading = false;
		})();
	});

	onDestroy(() => {
		disposed = true;
		world?.dispose();
	});
</script>

<svelte:head>
	<title>avenCITY Sandbox 2 · maiaCITY</title>
	<meta name="description" content="The planet: a globe of hex cards drawn from the map of the Earth, to turn, come close to and walk on." />
</svelte:head>

<div class="game">
	<div class="stage" bind:this={stage}></div>

	<!-- on a phone: the joystick walks the planet as WASD does -->
	<TouchStick move={(x, y, hurry) => world?.move(x, y, hurry)} />

	{#if loading}
		<div class="loading" role="status"><span>Growing the planet…</span></div>
	{:else if failed}
		<div class="loading" role="status"><span>The planet would not grow. Try a reload.</span></div>
	{/if}

	<!-- top left: where you are, and when -->
	<div class="corner tl">
		<div class="pill brand">
			<strong>avenCITY Sandbox 2</strong>
			<span class="dim">{calendarLabel}</span>
		</div>
		<!-- the time of the sky: Auto, or set by hand ($lib/sandbox-kit) -->
		<SkyControl />
	</div>
</div>

<style>
	.game {
		position: fixed;
		inset: 0;
		overflow: hidden;
		background: #f2efe7;
		font-family: var(--font-body, system-ui, sans-serif);
		color: #1f2a23;
	}

	.stage {
		position: absolute;
		inset: 0;
	}

	.stage :global(canvas) {
		display: block;
	}

	.stage :global(.hud-reticle) {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 8px;
		height: 8px;
		margin: -4px 0 0 -4px;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.9);
		pointer-events: none;
	}

	.loading {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: linear-gradient(180deg, #d9e2ea, #f2efe7);
		font-size: 0.8rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #5b6660;
	}

	.corner {
		position: absolute;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		max-width: calc(100vw - 2rem);
	}

	.tl { top: calc(1rem + env(safe-area-inset-top, 0px)); left: calc(1rem + env(safe-area-inset-left, 0px)); }

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.55rem 0.9rem;
		border: 1px solid rgb(31 42 35 / 0.08);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.88);
		backdrop-filter: blur(10px);
		font: inherit;
		font-size: 0.85rem;
		color: inherit;
		box-shadow: 0 6px 18px -12px rgb(31 42 35 / 0.4);
	}

	.pill.brand strong { font-family: var(--font-display, serif); font-weight: 500; }

	.dim { color: #7b857a; }
</style>
