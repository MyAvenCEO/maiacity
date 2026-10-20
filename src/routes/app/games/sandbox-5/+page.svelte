<!--
	avenCITY Sandbox 5 — Sandbox 4's dome cell (interior/village.ts), its food
	forest grown from our own plants ($lib/plants, through interior/flora.js): every
	plant at its stage, from young tree to ripe fruit; the plants of a middle-European
	garden outside, the ones that need the warmth inside the domes. Each plant is
	anchored to the version it was planted with (interior/sandbox5.js). Click or tap
	any plant: a card beside the world tells what it is and where it is in its life.
	The page round it is the kit's ($lib/sandbox-kit/WorldPage.svelte).
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import type { PickedPlant, VillageHandle } from '$lib/sandbox-2/interior/village';
	import { base } from '$app/paths';
	import { WorldPage } from '$lib/sandbox-kit';
	import PlantLook from '$lib/sandbox-2/interior/PlantLook.svelte';
	import { fly } from 'svelte/transition';

	let village: VillageHandle | null = null;

	/** the plant picked by a click or a tap, and what the library knows of it */
	type Card = { picked: PickedPlant; label: string; latin: string; note: string; from: string; layer: string; stages: { name: string; day: number; note: string }[] };
	let card = $state<Card | null>(null);
	let plants: typeof import('$lib/plants') | null = null;
	/** the card slides in from the right beside the world; on a phone, up from the foot of it */
	let narrow = $state(false);
	/** a press that comes up where it went down, soon (by the events' own times: a busy frame between them is no matter), is a click on the world, not a look round */
	let press: { x: number; y: number; t: number } | null = null;
	const down = (e: PointerEvent) => (press = { x: e.clientX, y: e.clientY, t: e.timeStamp });
	const up = async (e: PointerEvent) => {
		const p = press;
		press = null;
		if (!p || !village || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || e.timeStamp - p.t > 450) return;
		const picked = village.pickPlant(e.clientX, e.clientY);
		if (!picked) return close();
		plants ??= await import('$lib/plants');
		const plant = plants.plantAt(picked.id, picked.v);
		if (!plant) return (card = null);
		const layer = plants.LAYERS.find((l) => l.id === plant.layer);
		narrow = matchMedia('(max-width: 640px)').matches;
		card = { picked, label: plant.label, latin: plant.latin, note: plant.note, from: plant.from, layer: layer ? `${layer.label} — ${layer.note}` : '', stages: plant.stages };
	};
	const close = () => {
		card = null;
		village?.unpick();
	};
</script>

<svelte:head>
	<title>avenCITY Sandbox 4 · A dome cell grown from our plants · maiaCITY</title>
	<meta name="description" content="Walk a whole maiaCITY dome cell whose food forest is grown from our own plants, stage by stage: a middle-European forest garden outside, the tropics inside the domes." />
</svelte:head>

<WorldPage
	mount={async (stage, onProgress) => {
		const { mountVillage } = await import('$lib/sandbox-2/interior/village');
		const SANDBOX_5 = await (await import('$lib/sandbox-2/interior/sandbox5.js')).sandbox5();
		return (village = await mountVillage(stage, onProgress, SANDBOX_5));
	}}
	title="avenCITY Sandbox 4"
	subtitle="A dome cell · grown from our plants"
	keys="Drag to look · WASD to walk · Shift to hurry · walk through any door to step inside"
	cover={{
		image: asset('9e442ce81d3237243f561780fa6d3aeeeb7f1d83ea8e68f3a166650739c398b2.jpg') /* Day 03: a dome from inside */,
		eyebrow: 'avenCITY Sandbox 4',
		title: 'A dome cell, grown from our plants',
		size: 'a forest garden outside, the tropics inside the domes',
		steps: 10,
		// the forest's growing tells how far it is on in its own words, as one step
		counts: (label) => !label.startsWith('Growing the forest:')
	}}
	notice={() => {
		const opening = village?.opening();
		return opening ? `The ${opening.toLowerCase()} ahead is opening its doors…` : null;
	}}
	label="Sandbox 4: walk, look round, click a plant"
	onpointerdown={down}
	onpointerup={up}
	taps=".bar a, .bar button, .card a, .card button"
>
	{#if card}
		{@const st = card.stages[card.picked.stage]}
		<aside class="card" aria-label="{card.label}: about this plant" transition:fly={narrow ? { y: 400, duration: 300 } : { x: 400, duration: 320 }}>
			<div class="look">
				<PlantLook kind={{ id: card.picked.id, v: card.picked.v, stage: card.picked.stage, seed: card.picked.seed }} />
				<button class="close" onclick={close} aria-label="Close">×</button>
			</div>
			<div class="text">
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
				<a class="open" href="{base}/app/#assets">Grow it in the assets →</a>
			</div>
		</aside>
	{/if}
</WorldPage>

<style>
	/* the picked plant's card: a panel down the whole right side of the world, over its bar, the plant itself turning
	   at the top of it; on a phone a sheet up from the foot of it */
	.card {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 4;
		display: flex;
		flex-direction: column;
		width: min(23rem, 100vw);
		padding: max(0.75rem, env(safe-area-inset-top, 0px)) 0.75rem 0 0.75rem;
		box-sizing: border-box;
		background: rgb(250 248 242 / 0.86);
		border-left: 1px solid rgb(255 255 255 / 0.45);
		-webkit-backdrop-filter: blur(16px) saturate(1.2);
		backdrop-filter: blur(16px) saturate(1.2);
		color: #1f2a23;
		box-shadow: -10px 0 30px rgb(0 0 0 / 0.16);
	}

	.card .look {
		position: relative;
		flex: none;
		height: clamp(11rem, 34vh, 17rem);
	}

	.card .text {
		flex: 1;
		min-height: 0;
		overflow: auto;
		/* room at its foot for the app's nav pill, should the world be narrow enough for it to reach the panel */
		padding: 0.9rem 0.4rem var(--nav-room);
		overscroll-behavior: contain;
	}

	.card .close {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 999px;
		background: rgb(250 248 242 / 0.8);
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.12);
		font-size: 1.15rem;
		line-height: 1;
		cursor: pointer;
	}

	.card .eyebrow {
		margin: 0;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		opacity: 0.6;
		/* the cover's warm eyebrow colour, as it had when the cover lived on this page */
		color: #f0c49a;
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
			left: 0;
			width: auto;
			height: 72vh;
			border-left: 0;
			border-radius: 18px 18px 0 0;
			box-shadow: 0 -10px 30px rgb(0 0 0 / 0.16);
		}

		.card .look {
			height: 30vh;
		}
	}
</style>
