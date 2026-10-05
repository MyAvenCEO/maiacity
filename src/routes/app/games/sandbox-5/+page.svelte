<!--
	avenCITY Sandbox 5 — Sandbox 4's dome cell (interior/village.ts), its food
	forest grown from our own plants ($lib/plants, through interior/flora.js): every
	plant at its stage, from young tree to ripe fruit; the plants of a middle-European
	garden outside, the ones that need the warmth inside the domes. Each plant is
	anchored to the version it was planted with (interior/sandbox5.js).
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { onDestroy, onMount } from 'svelte';
	import type { VillageHandle } from '$lib/sandbox-2/interior/village';
	import TouchStick from '$lib/touch/TouchStick.svelte';
	import { WalkHint, WorldBar } from '$lib/sandbox-kit';

	let stage = $state<HTMLDivElement>();
	let village: VillageHandle | null = null;
	let destroyed = false;
	let loading = $state(true);
	let fading = $state(false);
	let step = $state('Letting in the light');
	let done = $state(0);
	const STEPS = 10;
	/** the dome being opened as you walk up to it */
	let opening = $state<string | null>(null);
	const openingTimer = setInterval(() => (opening = village?.opening() ?? null), 300);

	onMount(() => {
		requestAnimationFrame(() =>
			requestAnimationFrame(async () => {
				const { mountVillage } = await import('$lib/sandbox-2/interior/village');
				const { SANDBOX_5 } = await import('$lib/sandbox-2/interior/sandbox5.js');
				const v = await mountVillage(
					stage!,
					(label) => {
						if (label === 'ready') return;
						step = label;
						// the forest's growing tells how far it is on in its own words, as one step
						if (!label.startsWith('Growing the forest:')) done += 1;
					},
					SANDBOX_5
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
	<title>avenCITY Sandbox 5 · A dome cell grown from our plants · maiaCITY</title>
	<meta name="description" content="Walk a whole maiaCITY dome cell whose food forest is grown from our own plants, stage by stage: a middle-European forest garden outside, the tropics inside the domes." />
</svelte:head>

<div class="village">
	<div class="stage" bind:this={stage}></div>
	<WorldBar title="avenCITY Sandbox 5" subtitle="A dome cell · grown from our plants" />
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
				<p class="eyebrow">avenCITY Sandbox 5</p>
				<strong>A dome cell, grown from our plants</strong>
				<span class="size">a forest garden outside, the tropics inside the domes</span>
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
	/* at the foot, above the walk hint and the app's nav pill (--nav-room, src/app.css) */
	.opening {
		position: absolute;
		bottom: calc(3.8rem + var(--nav-room));
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
		bottom: calc(10vh + var(--nav-room));
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

	/* ── on a phone: above the joystick ($lib/touch/TouchStick; --stick-room, src/app.css) ── */
	@media (hover: none) and (pointer: coarse) {
		.opening {
			bottom: calc(var(--stick-room) + 3rem);
		}
	}

	/* ── a narrow screen ── */
	@media (max-width: 640px) {
		.opening {
			max-width: calc(100vw - 2rem);
			white-space: normal;
			text-align: center;
			font-size: 0.75rem;
		}
	}
</style>
