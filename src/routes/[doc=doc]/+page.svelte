<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { postHref, slug } from '$lib/universe/posts.js';
	import { authorOf, findPost, loadFeed, stream } from '$lib/universe/stream.svelte.js';
	import PostCard from '$lib/universe/PostCard.svelte';

	let { data } = $props();

	// a post published in avenDB opens once its feed is in
	onMount(() => {
		if (!findPost(data.doc)) loadFeed();
	});

	const post = $derived(findPost(data.doc));
	const author = $derived(post && authorOf(post));
	const waiting = $derived(!post && (stream.feed === 'idle' || stream.feed === 'loading'));
	// more from the same channel, then the rest of the stream
	const more = $derived(
		post ? [...stream.posts.filter((p) => p !== post && p.channel === post.channel), ...stream.posts.filter((p) => p !== post && p.channel !== post.channel)].slice(0, 3) : []
	);

	// a missing, old or mistyped title still finds the post by its doc id; the address is put right
	$effect(() => {
		if (post && page.url.searchParams.get('t') !== slug(post.title))
			goto(postHref(base, post), { replaceState: true, noScroll: true, keepFocus: true });
	});
</script>

<svelte:head>
	<title>{post ? `${post.title} · ${author.name}` : waiting ? 'A post' : 'Post not found'} · Maia Universe</title>
	{#if post}<meta name="description" content={post.text} />{/if}
</svelte:head>

<div class="page">
	<a class="back" href="{base}/universe/">← Maia Universe</a>

	{#if post}
		<PostCard {post} full />

		<p class="doc">
			{#if post.entry}
				<span>avenDB entry</span>
				<code>{post.entry}</code>
			{:else}
				<span>iroh doc</span>
				<code>{post.doc}</code>
			{/if}
		</p>

		{#if more.length}
			<h2>More in the stream</h2>
			<div class="more">
				{#each more as p (p.id)}
					<PostCard post={p} />
				{/each}
			</div>
		{/if}
	{:else if waiting}
		<div class="missing">
			<p>Taking in what was published in avenDB…</p>
		</div>
	{:else}
		<div class="missing">
			<h1>This post is not in the stream</h1>
			<p>
				It may have been taken off avenDB, or shared here before the last reload: what is shared here lives in
				memory alone.
			</p>
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
