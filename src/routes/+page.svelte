<script lang="ts">
	import { base } from '$app/paths';
	import Player from '$lib/blog/Player.svelte';
	import Manifesto from '$lib/Manifesto.svelte';
	import { categoryById } from '$lib/inspire-me/categories';

	let { data } = $props();

	const post = $derived(data.pinned);
	const formatted = $derived(
		post?.date
			? new Date(post.date).toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'long',
					year: 'numeric'
				})
			: ''
	);
</script>

<svelte:head>
	<title>maiaCITY</title>
	<meta name="description" content="We were never built to survive. We were built to thrive." />
</svelte:head>

<main class="wrap">
	<Manifesto banner={data.banner} />

	{#if post}
		<p class="start eyebrow">Where it starts</p>
		<article class="pinned">
			<Player {post} maxHeight="72vh" coverOnly />

			<div class="body">
				<p class="eyebrow">
					{#if post.day != null}Day {String(post.day).padStart(2, '0')}&ensp;·&ensp;{/if}{formatted}
				</p>
				<h2><a href="{base}/blog/{post.slug}">{post.title}</a></h2>
				<p class="excerpt">{post.excerpt}</p>

				<div class="foot">
					{#if post.authorImage}
						<img class="avatar" src="{base}{post.authorImage}" alt="" />
					{/if}
					<span>{post.author}</span>
					<ul class="tag-list">
						{#each post.categories as id (id)}
							<li style:--c={categoryById(id).color}>{categoryById(id).label}</li>
						{/each}
					</ul>
				</div>

				<div class="actions">
					<a class="pill-btn" href="{base}/blog/{post.slug}">Read day {post.day ?? ''} →</a>
					<a class="ghost-btn" href="{base}/blog">All days</a>
				</div>
			</div>
		</article>
	{/if}
</main>

<style>
	main {
		padding-block: 2.5rem 6rem;
	}

	.start {
		margin: 4.5rem 0 1.25rem;
		text-align: center;
	}

	.pinned {
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		align-items: center;
		gap: 2.5rem;
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
		/* the film sits inside the card, so its corners follow the card's */
		--player-radius: calc(var(--radius) - 8px);
	}

	.pinned :global(.player) {
		margin: 0;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.5rem 1rem 1rem 0;
	}

	h2 {
		font-size: clamp(1.8rem, 3.2vw, 2.6rem);
	}

	h2 a {
		text-decoration: none;
	}

	.excerpt {
		margin: 0;
		color: var(--ink-soft);
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.avatar {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.25rem;
	}

	.ghost-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.75rem 1.35rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		font-size: 0.95rem;
		font-weight: 500;
		text-decoration: none;
		color: var(--ink-soft);
	}

	.ghost-btn:hover {
		color: var(--ink);
		background: var(--cream);
	}

	@media (max-width: 860px) {
		.pinned {
			grid-template-columns: 1fr;
			gap: 1.25rem;
		}

		.body {
			padding: 0 0.5rem 0.75rem;
		}
	}
</style>
