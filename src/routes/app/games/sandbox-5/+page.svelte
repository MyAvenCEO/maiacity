<!--
	avenCITY Sandbox 5 — Sandbox 4's dome cell (interior/village.ts), its food
	forest grown from our own plants ($lib/plants, through interior/flora.js): every
	plant at its stage, from young tree to ripe fruit; the plants of a middle-European
	garden outside, the ones that need the warmth inside the domes. Each plant is
	anchored to the version it was planted with (interior/sandbox5.js). Click or tap
	any plant: a card beside the world tells what it is and where it is in its life.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { onDestroy, onMount } from 'svelte';
	import type { PickedPlant, VillageHandle } from '$lib/sandbox-2/interior/village';
	import { base } from '$app/paths';
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

	/** the plant picked by a click or a tap, and what the library knows of it */
	type Card = { picked: PickedPlant; label: string; latin: string; note: string; from: string; layer: string; stages: { name: string; day: number; note: string }[] };
	let card = $state<Card | null>(null);
	let plants: typeof import('$lib/plants') | null = null;
	/** a press that comes up where it went down, soon, is a click on the world, not a look round */
	let press: { x: number; y: number; t: number } | null = null;
	const down = (e: PointerEvent) => (press = { x: e.clientX, y: e.clientY, t: performance.now() });
	const up = async (e: PointerEvent) => {
		const p = press;
		press = null;
		if (!p || !village || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || performance.now() - p.t > 450) return;
		const picked = village.pickPlant(e.clientX, e.clientY);
		if (!picked) return close();
		plants ??= await import('$lib/plants');
		const plant = plants.plantAt(picked.id, picked.v);
		if (!plant) return (card = null);
		const layer = plants.LAYERS.find((l) => l.id === plant.layer);
		card = { picked, label: plant.label, latin: plant.latin, note: plant.note, from: plant.from, layer: layer ? `${layer.label} — ${layer.note}` : '', stages: plant.stages };
	};
	const close = () => {
		card = null;
		village?.unpick();
	};

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
	<div class="stage" bind:this={stage} role="application" aria-label="Sandbox 5: walk, look round, click a plant" onpointerdown={down} onpointerup={up}></div>
	<WorldBar title="avenCITY Sandbox 5" subtitle="A dome cell · grown from our plants" />
	<WalkHint keys="Drag to look · WASD to walk · Shift to hurry · walk through any door to step inside" />
	<!-- on a phone: the joystick walks, any other finger on the world looks round -->
	<TouchStick
		move={(x, y, hurry) => village?.move(x, y, hurry)}
		look={(dx, dy) => village?.look(dx, dy)}
		{stage}
		taps=".bar a, .bar button, .card a, .card button"
	/>
	{#if card}
		{@const st = card.stages[card.picked.stage]}
		<aside class="card" aria-label="{card.label}: about this plant">
			<button class="close" onclick={close} aria-label="Close">×</button>
			<p class="eyebrow">{card.picked.inside ? 'Under the glass' : 'The forest garden'} · v{card.picked.v}</p>
			<h2>{card.label}</h2>
			<p class="latin">{card.latin}</p>
			<p class="about">{card.note}</p>
			<dl>
				<dt>Layer</dt>
				<dd>{card.layer}</dd>
				<dt>Grows</dt>
				<dd>{card.from} · {card.picked.height.toFixed(1)} m high here</dd>
			</dl>
			<h3>Now: {st?.name} <span>stage {card.picked.stage + 1} of {card.stages.length} · day {st?.day}</span></h3>
			<ol class="life" aria-label="Its stages">
				{#each card.stages as s, k (s.name)}
					<li class:past={k < card.picked.stage} class:now={k === card.picked.stage} class:fruit={k >= 6} title={s.name}></li>
				{/each}
			</ol>
			<p class="about">{st?.note}</p>
			{#if card.picked.stage < card.stages.length - 1}<p class="next">Next: {card.stages[card.picked.stage + 1]!.name}</p>{/if}
			<a class="open" href="{base}/app/plants/?plant={card.picked.id}&stage={card.picked.stage + 1}&v={card.picked.v}">Grow it in the plants library →</a>
		</aside>
	{/if}
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
	/* the picked plant's card, beside the world on the right; over the foot of it on a phone */
	.card {
		position: absolute;
		top: 4.5rem;
		right: 1rem;
		z-index: 2;
		width: min(21rem, calc(100vw - 2rem));
		max-height: calc(100% - 9rem - var(--nav-room));
		overflow: auto;
		padding: 1rem 1.1rem 1.1rem;
		border-radius: 16px;
		background: rgb(250 248 242 / 0.82);
		border: 1px solid rgb(255 255 255 / 0.4);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		backdrop-filter: blur(14px) saturate(1.2);
		color: #1f2a23;
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
	}

	.card .close {
		position: absolute;
		top: 0.5rem;
		right: 0.6rem;
		width: 1.8rem;
		height: 1.8rem;
		border: 0;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.06);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
	}

	.card .eyebrow {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
	}

	.card h2 {
		margin: 0.2rem 0 0;
		font-size: 1.3rem;
	}

	.card .latin {
		margin: 0.1rem 0 0.6rem;
		font-size: 0.82rem;
		font-style: italic;
		opacity: 0.7;
	}

	.card .about {
		margin: 0.4rem 0;
		font-size: 0.84rem;
		line-height: 1.4;
	}

	.card dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 0.7rem;
		margin: 0.6rem 0;
		font-size: 0.78rem;
	}

	.card dt {
		opacity: 0.55;
	}

	.card dd {
		margin: 0;
	}

	.card h3 {
		margin: 0.9rem 0 0.4rem;
		font-size: 0.95rem;
	}

	.card h3 span {
		display: block;
		font-size: 0.72rem;
		font-weight: 400;
		opacity: 0.6;
	}

	/* its ten stages as a row of pips: the ones it has passed, the one it is at, the fruit's own four warmer */
	.life {
		display: flex;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.life li {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: rgb(31 42 35 / 0.12);
	}

	.life li.fruit {
		background: rgb(180 80 40 / 0.18);
	}

	.life li.past {
		background: rgb(61 107 52 / 0.55);
	}

	.life li.fruit.past {
		background: rgb(190 90 40 / 0.6);
	}

	.life li.now {
		background: #2f5f2a;
		box-shadow: 0 0 0 2px rgb(47 95 42 / 0.25);
	}

	.life li.fruit.now {
		background: #c25a22;
		box-shadow: 0 0 0 2px rgb(194 90 34 / 0.25);
	}

	.card .next {
		margin: 0.2rem 0 0.6rem;
		font-size: 0.75rem;
		opacity: 0.6;
	}

	.card .open {
		display: inline-block;
		margin-top: 0.3rem;
		font-size: 0.8rem;
		color: #2f5f2a;
	}

	@media (max-width: 640px) {
		.card {
			top: auto;
			bottom: calc(5.5rem + var(--nav-room));
			right: 1rem;
			max-height: 45vh;
		}
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
