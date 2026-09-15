<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { categoryById, sourceLabel, typeLabel } from '$lib/inspire-me/categories';
	import SourceArt from '$lib/inspire-me/SourceArt.svelte';

	let { data } = $props();

	const entry = $derived(data.entry);
	// Query params aren't available while prerendering; the tab switches after hydration.
	const tab = $derived(browser && page.url.searchParams.get('tab') === 'source' ? 'source' : 'report');
	const accent = $derived(categoryById(entry.categories[0] ?? '').color);

	// The story, the belief shifts and table-heavy sections span the full width of the report card.
	const isWide = (id: string, html: string) =>
		id === 'intro' || id === 'the-story' || id === 'beliefs-that-shift' || html.includes('<table');
</script>

<svelte:head>
	<title>{entry.title} · Inspire me · maiaCITY</title>
	<meta name="description" content={entry.hook} />
</svelte:head>

<main class="wrap" style:--accent={accent}>
	<a class="back" href="{base}/inspire-me">← Inspire me</a>

	<header class="hero">
		<div class="text">
			<p class="eyebrow">
				{typeLabel(entry.type)}{#if entry.author}&ensp;·&ensp;{#if entry.authorUrl}<a
							href={entry.authorUrl}
							target="_blank"
							rel="noopener noreferrer">{entry.author}</a
						>{:else}{entry.author}{/if}{/if}
			</p>
			<h1>{entry.title}</h1>
			{#if entry.originalTitle}
				<p class="original">Original title: “{entry.originalTitle}”</p>
			{/if}
			<p class="hook">{entry.hook}</p>
			<ul class="tag-list">
				{#each entry.categories as id (id)}
					<li style:--c={categoryById(id).color}>
						<a href="{base}/inspire-me?c={id}">{categoryById(id).label}</a>
					</li>
				{/each}
			</ul>
			<div class="actions">
				{#if entry.source}
					<a class="pill-btn" href={entry.source} target="_blank" rel="noopener noreferrer">
						Open source ↗
					</a>
				{/if}
				<span class="dates">
					Added {entry.added}{#if entry.published}&ensp;·&ensp;Published {entry.published}{/if}
				</span>
			</div>
		</div>
		<SourceArt {entry} shape="arch" />
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
				{@const by = entry.quoteBy ?? entry.author}
				<blockquote>“{entry.quote}”{#if by}<cite>— {by}</cite>{/if}</blockquote>
			{/if}
		</section>
	{/if}

	<nav class="tabs" aria-label="View">
		<a
			href={page.url.pathname}
			aria-current={tab === 'report' ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate>Report card</a
		>
		<a
			href="?tab=source"
			aria-current={tab === 'source' ? 'page' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-replacestate
		>
			{sourceLabel(entry.type)}{#if entry.language}&nbsp;· {entry.language.toUpperCase()}{/if}
			{#if entry.sourceWords}<small>{entry.sourceWords.toLocaleString('en')} words</small>{/if}
		</a>
	</nav>

	{#if tab === 'report'}
		<div class="report">
			{#each entry.sections as section (section.id)}
				<section
					id={section.id}
					class:wide={isWide(section.id, section.html)}
					class:shifts={section.id === 'beliefs-that-shift'}
				>
					{#if section.title}<h2 class="eyebrow"><i></i>{section.title}</h2>{/if}
					<div class="prose">{@html section.html}</div>
				</section>
			{/each}
		</div>
	{:else if entry.sourceHtml}
		<article class="source prose">{@html entry.sourceHtml}</article>
	{:else}
		<p class="missing">
			No source pasted yet — add <code>inspire-me/{entry.slug}/source.md</code>.
		</p>
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

	.text {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	.eyebrow a {
		text-decoration: none;
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

	.tabs a {
		padding: 0.55rem 1.2rem;
		border-radius: 999px;
		font-size: 0.9rem;
		font-weight: 500;
		text-decoration: none;
		color: var(--ink-soft);
	}

	.tabs a[aria-current='page'] {
		background: var(--ink);
		color: var(--cream);
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

	.missing {
		color: var(--ink-soft);
	}

	@media (max-width: 820px) {
		.hero,
		.report {
			grid-template-columns: 1fr;
		}

		.hero :global(.arch) {
			max-width: 320px;
			grid-row: 1;
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
