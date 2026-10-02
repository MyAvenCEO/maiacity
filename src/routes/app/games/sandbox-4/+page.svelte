<!--
	avenCITY Sandbox 4 — a whole dome cell in one world: the master dome, six
	large domes, six medium domes, the paths and streams between them and the
	food forest round it all (interior/village.ts). Walk up to any dome and its
	full inside is built into the village as you come; walk in through its door
	with nothing to wait for.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { base } from '$app/paths';
	import { onDestroy, onMount } from 'svelte';
	import type { VillageHandle } from '$lib/sandbox-2/interior/village';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { SkyToggle, WalkHint, WorldClock } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let village: VillageHandle | null = null;
	let destroyed = false;
	let loading = $state(true);
	let fading = $state(false);
	let step = $state('Letting in the light');
	let done = $state(0);
	const STEPS = 8;
	/** the dome being opened as you walk up to it */
	let opening = $state<string | null>(null);
	const openingTimer = setInterval(() => (opening = village?.opening() ?? null), 300);
	/* the sky kept at day while the clock runs on; every visit starts on the real sky ($lib/sandbox-kit) */
	let alwaysDay = $state(false);

	onMount(() => {
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountVillage } = await import('$lib/sandbox-2/interior/village');
				const v = await mountVillage(
					stage!,
					(label) => {
						if (label === 'ready') return;
						step = label;
						done += 1;
					}
				);
				if (destroyed) return v.dispose();
				village = v;
				done = STEPS;
				fading = true;
				setTimeout(() => (loading = false), 1100);
			})
		);
	});
	onDestroy(() => {
		destroyed = true;
		clearInterval(openingTimer);
		village?.dispose();
	});
</script>

<svelte:head>
	<title>avenCITY Sandbox 4 · A dome cell · maiaCITY</title>
	<meta name="description" content="Walk a whole maiaCITY dome cell: the master dome, six large domes and six medium domes, with paths, streams and a food forest between them. Step into any of them." />
</svelte:head>

<div class="village">
	<div class="stage" bind:this={stage}></div>
	<div class="bar">
		<a class="out" href="{base}/app/">← Dashboard</a>
		<div class="title"><strong>avenCITY Sandbox 4</strong><span>A dome cell · thirteen domes</span></div>
		<WorldClock class="clock" />
		<SkyToggle class="daylight" bind:on={alwaysDay} onchange={(on) => village?.alwaysDay(on)} />
	</div>
	<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · walk through any door to step inside" />
	<!-- on a phone: the joystick walks, any other finger on the world looks round -->
	<TouchStick
		move={(x, y, hurry) => village?.move(x, y, hurry)}
		look={(dx, dy) => village?.look(dx, dy)}
		{stage}
		taps=".bar a, .bar button"
	/>
	{#if opening}<p class="opening">The {opening.toLowerCase()} ahead is opening its doors…</p>{/if}

	{#if loading}
		<div class="loading" class:opening={fading} role="status" aria-live="polite">
			<img src={asset('9e442ce81d3237243f561780fa6d3aeeeb7f1d83ea8e68f3a166650739c398b2.jpg') /* Day 03: a dome from inside */} alt="" />
			<div class="shade"></div>
			<div class="label">
				<p class="eyebrow">avenCITY Sandbox 4</p>
				<strong>A dome cell</strong>
				<span class="size">the master dome, six large domes, six medium domes</span>
				<div class="progress"><span style:width="{Math.min(100, (done / STEPS) * 100)}%"></span></div>
				<span class="step">{fading ? 'Welcome' : `${step}…`}</span>
			</div>
		</div>
	{/if}

</div>

<style>
	.village {
		position: fixed;
		inset: 0;
		background: #1f2a23;
	}
	.stage {
		position: absolute;
		inset: 0;
		cursor: grab;
	}
	.opening {
		position: absolute;
		bottom: calc(3.8rem + env(safe-area-inset-bottom, 0px));
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		padding: 0.45rem 0.9rem;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.6);
		border: 1px solid rgb(255 255 255 / 0.35);
		-webkit-backdrop-filter: blur(12px) saturate(1.2);
		backdrop-filter: blur(12px) saturate(1.2);
		color: #1f2a23;
		font-size: 0.8rem;
		white-space: nowrap;
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
	/* see-through pills: the world shows through, blurred (the clock and the sky switch are $lib/sandbox-kit's) */
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
	.bar :global(.daylight) {
		margin-left: auto;
	}
	.title span {
		margin-left: 0.4rem;
		color: #7b857a;
	}
	.loading {
		position: absolute;
		inset: 0;
		z-index: 3;
		overflow: hidden;
		background: #1f2a23;
		transition: opacity 1s ease;
	}
	.loading.opening {
		opacity: 0;
	}
	.loading img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		transform: scale(1.08);
		transform-origin: 45% 45%;
		animation: closer 20s ease-out forwards;
	}
	@keyframes closer {
		to {
			transform: scale(1.22);
		}
	}
	.shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgb(20 26 22 / 0.85) 0%, rgb(20 26 22 / 0.35) 38%, transparent 62%);
	}
	.label {
		position: absolute;
		left: 50%;
		bottom: calc(10vh + env(safe-area-inset-bottom, 0px));
		transform: translateX(-50%);
		width: min(34rem, calc(100vw - 3rem));
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		color: #f2efe7;
		text-align: center;
	}
	.eyebrow {
		margin: 0;
		font-size: 0.75rem;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #f0c49a;
	}
	.label strong {
		font-family: var(--font-display, serif);
		font-size: clamp(2.2rem, 5vw, 3.4rem);
		font-weight: 400;
		line-height: 1.05;
	}
	.size {
		font-size: 0.95rem;
		color: rgb(242 239 231 / 0.85);
	}
	.progress {
		width: 100%;
		height: 3px;
		margin-top: 1rem;
		border-radius: 3px;
		background: rgb(242 239 231 / 0.25);
		overflow: hidden;
	}
	.progress span {
		display: block;
		height: 100%;
		background: #f0a47c;
		transition: width 0.6s ease;
	}
	.step {
		font-size: 0.85rem;
		color: #f0c49a;
	}

	/* ── on a phone: above the joystick ($lib/touch/TouchStick) ── */
	@media (hover: none) and (pointer: coarse) {
		.opening {
			bottom: calc(11rem + env(safe-area-inset-bottom, 0px));
		}
	}

	/* ── a narrow screen: a shorter bar that fits ── */
	@media (max-width: 640px) {
		.bar {
			left: 0.75rem;
			right: 0.75rem;
			gap: 0.35rem;
		}
		.out,
		.title {
			padding: 0.5rem 0.75rem;
			font-size: 0.8rem;
			white-space: nowrap;
		}
		.title {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
		}
		.title span {
			display: none;
		}
		.bar :global(.clock) {
			margin-left: auto;
		}
		.bar :global(.daylight) {
			margin-left: 0;
		}
		.opening {
			max-width: calc(100vw - 2rem);
			white-space: normal;
			text-align: center;
			font-size: 0.75rem;
		}
	}
</style>
