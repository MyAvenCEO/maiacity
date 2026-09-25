<script lang="ts">
	import { base } from '$app/paths';
	import LatestList from '$lib/blog/LatestList.svelte';
	import NextCard from '$lib/blog/NextCard.svelte';
	import Player from '$lib/blog/Player.svelte';
	import { categoryById } from '$lib/inspire-me/categories';

	let { data } = $props();

	const post = $derived(data.post);
	const formatted = $derived(
		post.date
			? new Date(post.date).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'long',
					year: 'numeric'
				})
			: ''
	);
</script>

<svelte:head>
	<title>{post.title} · maiaCITY</title>
	<meta name="description" content={post.excerpt} />
</svelte:head>

{#if post.cover}
	<!-- the cover, edge to edge, before anything else -->
	<figure class="hero">
		<img src="{base}{post.cover}" alt={post.coverAlt ?? post.title} fetchpriority="high" />
	</figure>
{/if}

<main class="wrap">
	<a class="back" href="{base}/blog">← Journal</a>

	<article>
		<header>
			{#if post.day != null}
				<p class="eyebrow">Day {String(post.day).padStart(2, '0')}</p>
			{/if}
			<h1>{post.title}</h1>
			{#if post.subtitle}<p class="subtitle">{post.subtitle}</p>{/if}

			<div class="byline">
				{#if post.authorImage}
					<img class="avatar" src="{base}{post.authorImage}" alt={post.author} />
				{/if}
				<div>
					<p class="author">{post.author}</p>
					<p class="meta">
						{#if post.authorRole}{post.authorRole}&ensp;·&ensp;{/if}{formatted}&ensp;·&ensp;{post.readingMinutes}
						min read
					</p>
				</div>
			</div>

			{#if post.categories.length}
				<ul class="tag-list">
					{#each post.categories as id (id)}
						<li style:--c={categoryById(id).color}>{categoryById(id).label}</li>
					{/each}
				</ul>
			{/if}
		</header>

		<div class="film"><Player {post} /></div>

		<div class="prose article">{@html post.html}</div>

		{#if data.next || data.latest.length}
			<footer class="onward">
				{#if data.next}
					<p class="eyebrow">Keep reading</p>
					<NextCard post={data.next} />
				{/if}
				<div class="more"><LatestList posts={data.latest} /></div>
			</footer>
		{/if}
	</article>
</main>

<style>
	main {
		padding-block: 2.5rem 6rem;
	}

	.hero {
		margin: 0;
		width: 100%;
		height: 50vh;
		height: 50svh;
		min-height: 16rem;
		background: var(--paper);
	}

	.hero img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.back {
		display: inline-block;
		margin-bottom: 2rem;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	article {
		max-width: 46rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0.75rem 0 0;
		font-size: clamp(2.5rem, 6vw, 4.2rem);
	}

	.onward {
		margin-top: 4rem;
		padding-top: 2.5rem;
		border-top: 1px solid var(--line);
	}

	.onward .eyebrow {
		margin: 0 0 1rem;
	}

	.more {
		margin-top: 2.5rem;
	}

	.subtitle {
		margin: 1rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 300;
		line-height: 1.35;
		color: var(--ink-soft);
	}

	.byline {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin: 2rem 0 0;
	}

	.avatar {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.author {
		margin: 0;
		font-weight: 500;
	}

	.meta {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.tag-list {
		margin-top: 1.25rem;
	}

	/* The film breaks out of the text column, staying centred on it. */
	.film {
		width: min(62rem, calc(100vw - 3rem));
		margin-left: 50%;
		transform: translateX(-50%);
	}


	.article {
		margin-top: 2.5rem;
		font-size: 1.12rem;
		line-height: 1.7;
	}

	.article :global(h2) {
		margin: 2.75rem 0 1rem;
		font-size: clamp(1.8rem, 3.5vw, 2.4rem);
	}

	.article :global(h3) {
		margin: 2rem 0 0.75rem;
		font-size: 1.35rem;
	}

	.article :global(blockquote) {
		margin: 2rem 0;
		padding-left: 1.25rem;
		font-size: 1.35rem;
		line-height: 1.45;
	}

	/* Figures break out of the text column, staying centred on it. */
	.article :global(figure) {
		width: min(62rem, calc(100vw - 3rem));
		margin-block: 2.5rem;
		margin-left: 50%;
		transform: translateX(-50%);
	}

	.article :global(figure img) {
		display: block;
		width: 100%;
		border-radius: var(--radius);
		background: var(--paper);
	}

	.article :global(figcaption) {
		margin-top: 0.75rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted);
		text-align: center;
	}

	@media (max-width: 820px) {
		.film {
			width: 100vw;
		}

		.article :global(figure) {
			width: 100vw;
		}

		.article :global(figure img) {
			border-radius: 0;
		}

		.article :global(figcaption) {
			padding-inline: 1.5rem;
			text-align: left;
		}
	}
</style>
