<script lang="ts">
	import { base } from '$app/paths';
	import { categoryById, typeLabel } from '$lib/inspire-me/categories';
	import SourceArt from '$lib/inspire-me/SourceArt.svelte';

	let { data } = $props();

	const author = $derived(data.author);
	const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');
</script>

<svelte:head>
	<title>{author.name} · Inspire me · maiaCITY</title>
	<meta name="description" content="Everything by {author.name} in the maiaCITY library." />
</svelte:head>

<main class="wrap">
	<a class="back" href="{base}/inspire-me">← Inspire me</a>

	<header>
		<p class="eyebrow">Author</p>
		<h1>{author.name}</h1>
		<p class="count">
			{author.entries.length}
			{author.entries.length === 1 ? 'source' : 'sources'} in the library
		</p>
		{#if author.urls.length}
			<ul class="links">
				{#each author.urls as url (url)}
					<li><a href={url} target="_blank" rel="noopener noreferrer">{hostOf(url)} ↗</a></li>
				{/each}
			</ul>
		{/if}
	</header>

	<ul class="grid">
		{#each author.entries as entry (entry.slug)}
			<li>
				<a class="card" href="{base}/inspire-me/{entry.slug}">
					<SourceArt {entry} />
					<div class="body">
						<p class="eyebrow">{typeLabel(entry.type)}&ensp;·&ensp;{entry.added}</p>
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

	header {
		padding-bottom: 2.5rem;
		margin-bottom: 2.5rem;
		border-bottom: 1px solid var(--line);
	}

	h1 {
		margin: 0.75rem 0 0;
		font-size: clamp(2.5rem, 7vw, 5rem);
	}

	.count {
		margin: 0.75rem 0 0;
		color: var(--ink-soft);
	}

	.links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin: 1.25rem 0 0;
		padding: 0;
		list-style: none;
	}

	.links a {
		display: inline-block;
		padding: 0.35rem 0.9rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.85rem;
		text-decoration: none;
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
</style>
