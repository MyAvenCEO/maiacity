<script lang="ts">
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { categories, categoryById, typeLabel } from '$lib/inspire-me/categories';
	import SourceArt from '$lib/inspire-me/SourceArt.svelte';

	let { data } = $props();

	// Query params aren't available while prerendering; the filter applies after hydration.
	const active = $derived(browser ? page.url.searchParams.get('c') : null);

	const counts = $derived(
		data.entries.reduce<Record<string, number>>((acc, entry) => {
			for (const id of entry.categories) acc[id] = (acc[id] ?? 0) + 1;
			return acc;
		}, {})
	);

	const visible = $derived(
		active ? data.entries.filter((entry) => entry.categories.includes(active)) : data.entries
	);
</script>

<svelte:head>
	<title>Inspire me · maiaCITY</title>
</svelte:head>

<main class="wrap">
	<section class="intro">
		<p class="eyebrow">The blueprint library</p>
		<h1>Inspire me</h1>
		<p class="lede">
			Videos, papers, posts and reports that shape the maiaCITY blueprint — each distilled into a
			report card, with the full source one click away.
		</p>
	</section>

	<nav class="filters" aria-label="Filter by category">
		<a href="{base}/inspire-me" class:on={!active} data-sveltekit-noscroll>
			All <span>{data.entries.length}</span>
		</a>
		{#each categories as c (c.id)}
			<a
				href="?c={c.id}"
				title={c.blurb}
				style:--c={c.color}
				class:on={active === c.id}
				class:empty={!counts[c.id]}
				data-sveltekit-noscroll
			>
				<i></i>{c.label} <span>{counts[c.id] ?? 0}</span>
			</a>
		{/each}
	</nav>

	{#if visible.length}
		<ul class="grid">
			{#each visible as entry (entry.slug)}
				<li>
					<a class="card" href="{base}/inspire-me/{entry.slug}">
						<SourceArt {entry} />
						<div class="body">
							<p class="byline">
								{#if entry.authorImage}
									<img class="portrait" src={entry.authorImage} alt="" loading="lazy" />
								{/if}
								<span class="eyebrow">
									{typeLabel(entry.type)}{#if entry.author}&ensp;·&ensp;{entry.author}{/if}
								</span>
							</p>
							<h2>{entry.title}</h2>
							{#if entry.shift}
								<div class="shift">
									<p class="from"><span>From</span>{entry.shift.from}</p>
									<p class="to"><span>To</span>{entry.shift.to}</p>
								</div>
							{:else}
								<p class="hook">{entry.hook}</p>
							{/if}
							<ul class="tag-list">
								{#each entry.categories as id (id)}
									<li style:--c={categoryById(id).color}>{categoryById(id).label}</li>
								{/each}
							</ul>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="none">
			Nothing in <strong>{categoryById(active ?? '').label}</strong> yet — add a folder under
			<code>inspire-me/</code>.
		</p>
	{/if}
</main>

<style>
	main {
		padding-block: 4rem 6rem;
	}

	h1 {
		margin-top: 0.75rem;
		font-size: clamp(3.5rem, 9vw, 6.5rem);
	}

	.lede {
		max-width: 46ch;
		margin: 1.25rem 0 0;
		font-size: 1.15rem;
		color: var(--ink-soft);
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 3rem 0 2.5rem;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--line);
	}

	.filters a {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.45rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.88rem;
		font-weight: 500;
		text-decoration: none;
		transition: background 0.15s ease;
	}

	.filters a:hover {
		background: var(--paper);
	}

	.filters a.empty {
		color: var(--muted);
	}

	.filters a.on {
		border-color: transparent;
		background: var(--c, var(--ink));
		color: var(--ink);
	}

	.filters a.on:not([style]) {
		color: var(--cream);
	}

	.filters i {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: var(--c);
	}

	.filters a.on i {
		background: var(--ink);
	}

	.filters span {
		font-size: 0.75rem;
		opacity: 0.6;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 1.5rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-direction: column;
		height: 100%;
		border-radius: var(--radius);
		background: var(--paper);
		text-decoration: none;
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
	}

	.card:hover {
		transform: translateY(-3px);
		box-shadow: 0 14px 34px rgb(38 56 44 / 0.1);
	}

	.body {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
		padding: 1.4rem 1.5rem 1.6rem;
	}

	.byline {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0;
	}

	.portrait {
		width: 1.85rem;
		height: 1.85rem;
		border-radius: 50%;
		object-fit: cover;
		background: var(--cream);
	}

	.card h2 {
		font-size: 1.6rem;
	}

	.hook,
	.shift {
		flex: 1;
		margin: 0;
		font-size: 0.95rem;
		color: var(--ink-soft);
	}

	.shift p {
		display: grid;
		grid-template-columns: 2.6rem 1fr;
		margin: 0;
	}

	.shift p + p {
		margin-top: 0.35rem;
	}

	.shift span {
		padding-top: 0.2rem;
		font-size: 0.66rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.shift .to {
		font-weight: 500;
		color: var(--ink);
	}

	.none {
		color: var(--ink-soft);
	}
</style>
