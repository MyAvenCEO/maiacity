<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// Maia Universe: maiaCITY's own content stream. Every post published in avenDB comes from its server's feed, taken
	// in again every minute while the page is open.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { shaped } from '$lib/app/shapes.js';
	import { CHANNELS, postHref } from '$lib/universe/posts.js';
	import { authorOf, loadFeed, stream } from '$lib/universe/stream.svelte.js';
	import PostCard from '$lib/universe/PostCard.svelte';

	onMount(() => {
		// a channel the address names (`?c=Journal`), as the journal's and inspire-me's old addresses lead here
		const asked = new URLSearchParams(location.search).get('c');
		if (asked && CHANNELS.includes(asked)) channel = asked;
		loadFeed();
		const again = setInterval(loadFeed, 60_000);
		return () => clearInterval(again);
	});

	const posts = $derived(stream.posts);
	let channel = $state('All');

	const shown = $derived(channel === 'All' ? posts : posts.filter((p) => p.channel === channel));
	const counts = $derived(Object.fromEntries(CHANNELS.map((c) => [c, c === 'All' ? posts.length : posts.filter((p) => p.channel === c).length])));
	const top = $derived([...posts].sort((a, b) => b.likes - a.likes).slice(0, 3));
	// every voice that has a post in the stream, by its newest post
	const voices = $derived([...new Set(posts.map((p) => p.author))].map((k) => stream.authors[k]).filter(Boolean));
</script>

<svelte:head>
	<title>Maia Universe · maiaCITY</title>
	<meta name="description" content="Maia Universe: the stream of everything that happens in maiaCITY, from the builds and the villages to the COOPs and the avens." />
</svelte:head>

<div class="universe">
	<header class="head">
		<p class="kind">The stream</p>
		<h1>Maia <em>Universe</em></h1>
		<p class="sub">Everything that happens in maiaCITY, as it happens.</p>
	</header>

	<div class="layout">
		<main class="feed">
			<nav class="chips" aria-label="Channels">
				{#each CHANNELS as c (c)}
					<button class:on={channel === c} onclick={() => (channel = c)}>{c}<span>{counts[c]}</span></button>
				{/each}
			</nav>

			{#each shown as p (p.id)}
				<PostCard post={p} />
			{:else}
				<p class="empty">
					{#if stream.feed === 'loading' || stream.feed === 'idle'}
						Taking in what was published in avenDB…
					{:else if channel === 'All'}
						Nothing published yet. An article published in avenDB shows here.
					{:else}
						Nothing in {channel} yet.
					{/if}
				</p>
			{/each}
		</main>

		<aside class="side">
			{#if top.length}
				<section class="card">
					<h2>Most loved</h2>
					<ol>
						{#each top as p (p.id)}
							<li><a href={postHref(base, p)}><strong>{p.title}</strong><span>{authorOf(p).name}</span></a></li>
						{/each}
					</ol>
				</section>
				<section class="card">
					<h2>Voices</h2>
					<ul>
						{#each voices as a (a.handle)}
							<li class="voice"><span class="avatar sm" style:background={a.color} style={shaped(a.kind)}>{a.initials}</span>{a.name}</li>
						{/each}
					</ul>
				</section>
			{/if}
			<p class="note">
				{#if stream.feed === 'loading'}
					Taking in what was published in avenDB…
				{:else if stream.feed === 'failed'}
					avenDB's feed can't be reached right now.
				{:else}
					Every post here is an article published in avenDB, for everyone.
				{/if}
			</p>
		</aside>
	</div>
</div>

<style>
	.universe {
		max-width: 68rem;
		margin: 0 auto;
		padding: 2.5rem 1.25rem 5rem;
		color: var(--ink);
	}

	.head {
		text-align: center;
		margin-bottom: 2rem;
	}

	.kind {
		margin: 0 0 0.6rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(2.2rem, 6vw, 3.4rem);
		font-weight: 400;
		letter-spacing: -0.02em;
		line-height: 1.05;
	}

	h1 em {
		font-weight: 600;
		color: var(--terracotta);
	}

	.sub {
		margin: 0.7rem 0 0;
		font-family: var(--font-display);
		font-style: italic;
		color: var(--ink-soft);
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 18rem;
		gap: 1.5rem;
		align-items: start;
	}

	.feed {
		display: grid;
		gap: 0.9rem;
		min-width: 0;
	}

	.card {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.1rem 1.2rem;
	}

	.avatar {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
	}

	.avatar.sm {
		width: 1.9rem;
		height: 1.9rem;
		font-size: 0.65rem;
	}

	button {
		font: inherit;
		cursor: pointer;
	}

	.chips {
		display: flex;
		gap: 0.4rem;
		overflow-x: auto;
		padding: 0.2rem 0;
		scrollbar-width: none;
	}

	.chips button {
		flex: none;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.95rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: transparent;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.chips button span {
		font-size: 0.72rem;
		color: var(--muted);
	}

	.chips button.on {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--cream);
	}

	.chips button.on span {
		color: var(--sage);
	}

	.empty {
		text-align: center;
		color: var(--muted);
	}

	.side {
		position: sticky;
		top: 6rem;
		display: grid;
		gap: 0.9rem;
	}

	h2 {
		margin: 0 0 0.7rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	ol,
	ul {
		display: grid;
		gap: 0.7rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ol a {
		display: grid;
		color: inherit;
		text-decoration: none;
	}

	ol a:hover strong {
		color: var(--terracotta);
	}

	ol li {
		display: grid;
		gap: 0.15rem;
		font-size: 0.85rem;
	}

	ol li span {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--ink-soft);
	}

	.voice {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
	}

	.note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
		text-align: center;
	}

	@media (max-width: 860px) {
		.layout {
			grid-template-columns: 1fr;
		}

		.side {
			position: static;
		}
	}

	@media (max-width: 520px) {
		.universe {
			padding: 1.5rem 0.75rem 4rem;
		}

		.card {
			padding: 0.95rem;
		}

		.avatar {
			width: 2.2rem;
			height: 2.2rem;
			font-size: 0.72rem;
		}

	}
</style>
