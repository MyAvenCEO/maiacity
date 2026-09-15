<script lang="ts">
	import { dev } from '$app/environment';
	import { base } from '$app/paths';
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
	<meta name="description" content={post?.excerpt ?? 'maiaCITY — building a city, game first.'} />
</svelte:head>

<main class="wrap">
	<section class="hero">
		<p class="eyebrow"><span class="dot"></span> Building in public</p>
		<h1>maia<span>CITY</span></h1>
		<p class="lede">
			One million founders, one city, sixteen years. Built in a game first, then in soil.
		</p>
	</section>

	{#if post}
		<article class="pinned">
			{#if dev && post.videoLocal}
				<!-- Local master, so the post can be test-run before Stream finishes encoding. -->
				<figure class="player" style:--aspect={post.videoAspect ?? '16 / 9'}>
					<video src="{base}{post.videoLocal}" controls playsinline preload="metadata">
						<track kind="captions" />
					</video>
				</figure>
			{:else if post.video && post.videoLibrary}
				<figure class="player" style:--aspect={post.videoAspect ?? '16 / 9'}>
					<iframe
						src="https://iframe.mediadelivery.net/embed/{post.videoLibrary}/{post.video}?autoplay=false&preload=true"
						title={post.title}
						loading="lazy"
						allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
						allowfullscreen
					></iframe>
				</figure>
			{:else if post.cover}
				<figure class="player" style:--aspect={post.videoAspect ?? '16 / 9'}>
					<img src="{base}{post.cover}" alt={post.coverAlt ?? post.title} />
				</figure>
			{/if}

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
		padding-block: 3.5rem 6rem;
	}

	.dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		margin-right: 0.35rem;
		border-radius: 50%;
		background: var(--mustard);
	}

	h1 {
		margin: 1rem 0 0;
		font-size: clamp(3.5rem, 11vw, 7.5rem);
		font-weight: 300;
	}

	h1 span {
		font-weight: 600;
	}

	.lede {
		max-width: 34ch;
		margin: 1.25rem 0 0;
		font-size: 1.2rem;
		color: var(--ink-soft);
	}

	.pinned {
		display: grid;
		grid-template-columns: 1.15fr 1fr;
		align-items: center;
		gap: 2.5rem;
		margin-top: 3.5rem;
		padding: 1.25rem;
		border-radius: var(--radius);
		background: var(--paper);
	}

	.player {
		margin: 0;
	}

	.player iframe,
	.player img,
	.player video {
		display: block;
		width: 100%;
		aspect-ratio: var(--aspect, 16 / 9);
		border: 0;
		border-radius: calc(var(--radius) - 8px);
		object-fit: cover;
		background: var(--ink);
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
