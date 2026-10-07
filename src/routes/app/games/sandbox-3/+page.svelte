<!--
	avenCITY Sandbox 3 — inside the domes. The tent a settler starts in, the four
	domes of a village and the factory that makes their glass, each one open to
	walk through, without an account and without a village around it.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { base } from '$app/paths';
	import DomeInterior from '$lib/sandbox-2/DomeInterior.svelte';
	import { enter } from '$lib/app/immersive.svelte';
	import { DOMES, type DomeKind } from '$lib/sandbox-2/interior/interior';
	import { DOMES_IN_ORDER } from '$lib/buildings/domes.js'; // the Buildings app's domes, the same list

	const src = (image: string) => asset(image);

	let walking = $state<DomeKind | null>(null);
	// inside a dome the world has the whole screen, the nav pill over it (its way back steps out of the dome)
	$effect(() => {
		if (walking) return enter();
	});
</script>

<svelte:head>
	<title>avenCITY Sandbox 3 · Inside the domes · maiaCITY</title>
	<meta name="description" content="Walk inside a maiaCITY village: the bell tent, the glamping dome, the medium dome, the large dome, the master dome, and the solar factory dome." />
</svelte:head>

<div class="page">
	<header>
		<p class="eyebrow">avenCITY Sandbox 3</p>
		<h1>Inside the domes</h1>
		<p class="lede">A village starts in tents, grows four kinds of dome, and makes their glass itself. Choose one and step inside: drag to look, WASD to walk, Shift to hurry.</p>
	</header>

	<ul class="grid">
		{#each DOMES_IN_ORDER as d (d.kind)}
			<li>
				<button class="card" onclick={() => (walking = d.kind)}>
					<img src={src(d.image)} alt="Inside the {DOMES[d.kind].label.toLowerCase()}" loading="lazy" />
					<span class="body">
						<span class="size">{DOMES[d.kind].diameter} m across · {DOMES[d.kind].people}</span>
						<strong>{DOMES[d.kind].label}</strong>
						<span class="text">{d.text}</span>
						<span class="go">Step inside →</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>

	<p class="more">
		Want the whole village around it? <a href="{base}/app/games/sandbox-2/">avenCITY Sandbox 2</a> ·
		How it was built: <a href="{base}/blog/day-15-inside-the-domes/">Day 15</a>
	</p>
</div>

{#if walking}
	<div class="walk"><DomeInterior kind={walking} place="Sandbox 3" onclose={() => (walking = null)} /></div>
{/if}

<style>
	.page {
		max-width: 76rem;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 5rem;
	}
	.eyebrow {
		margin: 2rem 0 0;
		font-size: 0.8rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #c8744f;
	}
	h1 {
		margin: 0.4rem 0 0;
		font-size: clamp(2.6rem, 6vw, 4.2rem);
	}
	.lede {
		max-width: 40rem;
		margin: 1rem 0 2.5rem;
		font-size: 1.12rem;
		line-height: 1.6;
		color: var(--ink-soft, #55605a);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.card {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		padding: 0;
		border: 0;
		border-radius: 18px;
		background: var(--paper, #faf8f2);
		color: inherit;
		font: inherit;
		text-align: left;
		overflow: hidden;
		cursor: pointer;
		transition: transform 180ms ease, box-shadow 180ms ease;
	}
	.card:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 34px rgb(38 56 44 / 0.12);
	}
	.card img {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 10;
		object-fit: cover;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		padding: 1.1rem 1.2rem 1.3rem;
	}
	.size {
		font-size: 0.78rem;
		color: #7b857a;
	}
	strong {
		font-family: var(--font-display, serif);
		font-size: 1.4rem;
		font-weight: 500;
	}
	.text {
		line-height: 1.5;
		color: var(--ink-soft, #55605a);
	}
	.go {
		margin-top: 0.4rem;
		font-weight: 600;
		color: #c8744f;
	}
	.more {
		margin-top: 2.5rem;
		color: var(--ink-soft, #55605a);
	}
	.walk {
		position: fixed;
		inset: 0;
		z-index: 50;
	}
</style>
