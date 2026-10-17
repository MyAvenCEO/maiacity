<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// An inspire post laid out as its report card, the inspire delivery's own template (Samuel 2026-10-17: each
	// delivery type has its own template layout): who made the source and where, the title, the hook, the categories,
	// the source's picture in an arch, the shift from → to with its quote, then the report's sections, or the source's
	// own words. Everything comes from the vault's entries everyone reads (./inspire.js `inspireOf`).
	import { base } from '$app/paths';
	import { categoryById, sourceLabel, typeLabel } from '$lib/inspire-me/categories';

	let { entry } = $props();

	let tab = $state('report');
	// the sharpest of the source's pictures that loads
	let picture = $state(0);
	const accent = $derived(categoryById(entry.categories[0] ?? '').color);
	const colors = $derived(entry.categories.map((id) => categoryById(id).color));

	// the story, the belief shifts, a tutorial's concepts and steps, and table-heavy sections span the card's width
	const isWide = (id, html) =>
		['intro', 'the-story', 'beliefs-that-shift', 'from-the-ground-up', 'the-steps'].includes(id) || html.includes('<table');
</script>

<main class="wrap" style:--accent={accent}>
	<a class="back" href="{base}/universe/?c=Inspire%20me">← Inspire me</a>

	<header class="hero">
		<div class="text">
			<p class="eyebrow byline">
				{#if entry.authorImage}
					<img class="portrait" src={entry.authorImage} alt="" />
				{/if}
				{typeLabel(entry.type)}{#if entry.author}&ensp;·&ensp;{entry.author}{/if}
			</p>
			<h1>{entry.title}</h1>
			{#if entry.originalTitle}
				<p class="original">Original title: “{entry.originalTitle}”</p>
			{/if}
			{#if entry.hook}<p class="hook">{entry.hook}</p>{/if}
			<ul class="tag-list">
				{#each entry.categories as id (id)}
					<li style:--c={categoryById(id).color}>
						<a href="{base}/universe/?c=Inspire%20me">{categoryById(id).label}</a>
					</li>
				{/each}
			</ul>
			<div class="actions">
				{#if entry.source}
					<a class="pill-btn" href={entry.source} target="_blank" rel="noopener noreferrer">Open source ↗</a>
				{/if}
				<span class="dates">
					{#if entry.added}Added {entry.added}{/if}{#if entry.published}&ensp;·&ensp;Published {entry.published}{/if}
				</span>
			</div>
		</div>
		<div class="art" style:--a={colors[0] ?? 'var(--sand, #dccfae)'} style:--b={colors[1] ?? 'var(--mustard)'} aria-hidden="true">
			{#if entry.thumbnails[picture]}
				<img src={entry.thumbnails[picture]} alt="" onerror={() => picture++} />
			{:else}
				<span class="orb one"></span>
				<span class="orb two"></span>
			{/if}
		</div>
	</header>

	{#if entry.shift}
		<section class="shift" aria-label="The transformation">
			<div class="from">
				<p class="eyebrow">From</p>
				<p class="line">{entry.shift.from}</p>
			</div>
			<span class="arrow" aria-hidden="true">→</span>
			<div class="to">
				<p class="eyebrow">To</p>
				<p class="line">{entry.shift.to}</p>
			</div>
			{#if entry.quote}
				<blockquote>“{entry.quote}”{#if entry.quoteBy}<cite>— {entry.quoteBy}</cite>{/if}</blockquote>
			{/if}
		</section>
	{/if}

	<nav class="tabs" aria-label="View">
		<button aria-current={tab === 'report' ? 'page' : undefined} onclick={() => (tab = 'report')}>Report card</button>
		{#if entry.sourceHtml}
			<button aria-current={tab === 'source' ? 'page' : undefined} onclick={() => (tab = 'source')}>
				{sourceLabel(entry.type)}{#if entry.language}&nbsp;· {entry.language.toUpperCase()}{/if}
				{#if entry.sourceWords}<small>{entry.sourceWords.toLocaleString('en')} words</small>{/if}
			</button>
		{/if}
	</nav>

	{#if tab === 'report'}
		<div class="report">
			{#each entry.sections as section (section.id)}
				<section id={section.id} class:wide={isWide(section.id, section.html)} class:shifts={section.id === 'beliefs-that-shift'}>
					{#if section.title}<h2 class="eyebrow"><i></i>{section.title}</h2>{/if}
					<div class="prose">{@html section.html}</div>
				</section>
			{/each}
		</div>
	{:else}
		<article class="source prose">{@html entry.sourceHtml}</article>
	{/if}
</main>

<style>
	main {
		padding-block: 2.5rem 6rem;
	}

	.back {
		display: inline-block;
		margin-bottom: 2rem;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	.hero {
		display: grid;
		grid-template-columns: 1.35fr 1fr;
		align-items: center;
		gap: 3rem;
		padding-bottom: 3rem;
	}

	.art {
		position: relative;
		overflow: hidden;
		aspect-ratio: 5 / 6;
		border-radius: 999px 999px var(--radius) var(--radius);
		background: var(--a);
	}

	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.orb {
		position: absolute;
		aspect-ratio: 1;
		border-radius: 50%;
	}

	.one {
		width: 75%;
		right: -20%;
		bottom: -45%;
		background: var(--b);
	}

	.two {
		width: 40%;
		left: 10%;
		top: 15%;
		background: rgb(250 248 242 / 0.4);
	}

	.tabs button {
		padding: 0.55rem 1.2rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.tabs button[aria-current='page'] {
		background: var(--ink);
		color: var(--cream);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.byline {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.portrait {
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--paper);
	}

	h1 {
		font-size: clamp(2.5rem, 5.5vw, 4.6rem);
	}

	.original {
		margin: -0.4rem 0 0;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.hook {
		max-width: 48ch;
		margin: 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}

	.tag-list a {
		text-decoration: none;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.5rem;
		margin-top: 0.5rem;
	}

	.dates {
		font-size: 0.85rem;
		color: var(--muted);
	}

	.shift {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: start;
		gap: 1rem 2rem;
		padding: 2rem 2.25rem;
		border-radius: var(--radius);
		background: var(--accent);
	}

	.shift .line {
		margin: 0.5rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 2.6vw, 2rem);
		letter-spacing: -0.02em;
		line-height: 1.2;
	}

	.shift .from .line {
		color: var(--ink-soft);
		font-weight: 300;
	}

	.shift .to .line {
		font-weight: 500;
	}

	.arrow {
		align-self: center;
		font-family: var(--font-display);
		font-size: 2.5rem;
	}

	.shift blockquote {
		grid-column: 1 / -1;
		margin: 0.5rem 0 0;
		padding-top: 1.25rem;
		border-top: 1px solid rgb(38 56 44 / 0.15);
		font-family: var(--font-display);
		font-size: 1.15rem;
		font-style: italic;
	}

	.shift cite {
		margin-left: 0.6rem;
		font-family: var(--font-body);
		font-size: 0.85rem;
		font-style: normal;
		color: var(--ink-soft);
	}

	.tabs {
		position: sticky;
		top: 0.75rem;
		z-index: 1;
		display: inline-flex;
		gap: 0.25rem;
		margin: 2.5rem 0 2rem;
		padding: 0.3rem;
		border-radius: 999px;
		background: var(--paper);
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.06);
	}

	.tabs small {
		margin-left: 0.3rem;
		opacity: 0.6;
	}

	.report {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		/* Let a half-width section backfill the gap left before a full-width one. */
		grid-auto-flow: row dense;
		gap: 1.25rem;
	}

	.report section {
		padding: 1.6rem 1.75rem;
		border-radius: var(--radius);
		background: var(--paper);
	}

	.report section.wide {
		grid-column: 1 / -1;
	}

	.report h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.report h2 i {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--accent);
	}

	#the-story .prose,
	#intro .prose {
		max-width: 62ch;
		font-family: var(--font-display);
		font-size: 1.3rem;
		line-height: 1.45;
	}

	#the-story .prose :global(p) {
		margin-bottom: 0.7em;
	}

	.source {
		max-width: 70ch;
		font-size: 1.05rem;
		line-height: 1.75;
	}

	@media (max-width: 820px) {
		.hero,
		.report {
			grid-template-columns: 1fr;
		}

		.hero .art {
			width: 100%;
			max-width: none;
			grid-row: 1;
			margin-inline: 0;
		}

		.shift {
			grid-template-columns: 1fr;
		}

		.arrow {
			transform: rotate(90deg);
			justify-self: start;
		}
	}
</style>
