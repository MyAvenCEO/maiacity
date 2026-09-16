<script lang="ts">
	import { base } from '$app/paths';
	import NextCard from '$lib/blog/NextCard.svelte';
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

	{#if data.next}
		<section class="onward">
			<NextCard post={data.next} label="Then" />
		</section>
	{/if}

	{#if data.latest.length}
		<section class="latest" aria-labelledby="latest-title">
			<div class="latest-head">
				<p class="eyebrow" id="latest-title">Latest days</p>
				<a href="{base}/blog">All days →</a>
			</div>
			<ul>
				{#each data.latest as day (day.slug)}
					<li>
						<a href="{base}/blog/{day.slug}">
							<span class="num">{String(day.day ?? '').padStart(2, '0')}</span>
							<span class="title">{day.title}</span>
							<span class="date">
								{new Date(day.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
							</span>
							<span class="arrow" aria-hidden="true">→</span>
						</a>
					</li>
				{/each}
			</ul>
		</section>
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

	/* the door to day 02, as wide as the pinned card */
	.onward {
		margin: 1rem 0 0;
	}

	/* three quiet rows under the pinned day: number, title, date */
	.latest {
		max-width: 52rem;
		margin: 3rem auto 0;
	}

	.latest-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 0 0.25rem 0.75rem;
	}

	.latest-head a {
		font-size: 0.85rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	.latest-head a:hover {
		color: var(--ink);
	}

	.latest ul {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
	}

	.latest li a {
		display: grid;
		grid-template-columns: 2.5rem minmax(0, 1fr) auto 1rem;
		align-items: baseline;
		gap: 0.9rem;
		padding: 0.95rem 0.25rem;
		border-bottom: 1px solid var(--line);
		text-decoration: none;
		transition: background-color 150ms ease;
	}

	.latest li a:hover {
		background: var(--paper);
	}

	.num {
		font-family: var(--font-display);
		font-size: 1.1rem;
		color: var(--terracotta);
	}

	.title {
		overflow: hidden;
		font-family: var(--font-display);
		font-size: 1.15rem;
		line-height: 1.25;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.date {
		font-size: 0.8rem;
		color: var(--muted);
		white-space: nowrap;
	}

	.arrow {
		color: var(--muted);
		transition: transform 150ms ease;
	}

	.latest li a:hover .arrow {
		transform: translateX(3px);
		color: var(--ink);
	}

	@media (max-width: 560px) {
		.latest li a {
			grid-template-columns: 2rem minmax(0, 1fr) 1rem;
		}

		.title {
			white-space: normal;
		}

		.date {
			display: none;
		}
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
