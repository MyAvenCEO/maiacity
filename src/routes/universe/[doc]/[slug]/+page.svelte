<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { AUTHORS, postHref, slug } from '$lib/universe/posts.js';
	import { findPost, stream } from '$lib/universe/stream.svelte.js';
	import PostCard from '$lib/universe/PostCard.svelte';

	let { data } = $props();

	const post = $derived(findPost(data.doc));
	const author = $derived(post && AUTHORS[post.author]);
	// more from the same channel, then the rest of the stream
	const more = $derived(
		post ? [...stream.posts.filter((p) => p !== post && p.channel === post.channel), ...stream.posts.filter((p) => p !== post && p.channel !== post.channel)].slice(0, 3) : []
	);

	// an old or mistyped slug still finds the post by its doc id; the address is put right
	$effect(() => {
		if (post && slug(post.title) !== data.slug) goto(postHref(base, post), { replaceState: true });
	});
</script>

<svelte:head>
	<title>{post ? `${post.title} · ${author.name}` : 'Post not found'} · Maia Universe</title>
	{#if post}<meta name="description" content={post.text} />{/if}
</svelte:head>

<div class="page">
	<a class="back" href="{base}/universe/">← Maia Universe</a>

	{#if post}
		<PostCard {post} full />

		<p class="doc">
			<span>iroh doc</span>
			<code>{post.doc}</code>
		</p>

		{#if more.length}
			<h2>More in the stream</h2>
			<div class="more">
				{#each more as p (p.id)}
					<PostCard post={p} />
				{/each}
			</div>
		{/if}
	{:else}
		<div class="missing">
			<h1>This post is not in the stream</h1>
			<p>The stream lives in memory for now, so a post shared before the last reload is gone.</p>
		</div>
	{/if}
</div>

<style>
	.page {
		display: grid;
		gap: 1rem;
		max-width: 44rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 5rem;
		color: var(--ink);
	}

	.back {
		justify-self: start;
		padding: 0.4rem 0.9rem;
		margin-left: -0.9rem;
		border-radius: 999px;
		font-size: 0.85rem;
		color: var(--ink-soft);
		text-decoration: none;
	}

	.back:hover {
		background: var(--cream);
		color: var(--ink);
	}

	.doc {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.6rem;
		margin: 0;
		padding: 0 0.4rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.doc span {
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.doc code {
		overflow-wrap: anywhere;
		font-size: 0.75rem;
	}

	h2 {
		margin: 1.5rem 0 0;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.more {
		display: grid;
		gap: 0.9rem;
	}

	.missing {
		padding: 3rem 0;
		text-align: center;
	}

	.missing h1 {
		margin: 0;
		font-family: var(--font-display);
		font-weight: 500;
	}

	.missing p {
		color: var(--ink-soft);
	}

	@media (max-width: 520px) {
		.page {
			padding: 1.25rem 0.75rem 4rem;
		}
	}
</style>
