<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// The front door: the manifesto, then the journal where it starts, the day after it and the newest days. The journal
	// is one stream, avenDB's feed, the same posts and the same cards as Maia Universe ($lib/universe/stream.svelte.js),
	// taken in in the browser once the page is open, so the site is built without it.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import LatestList from '$lib/blog/LatestList.svelte';
	import Manifesto from '$lib/Manifesto.svelte';
	import PostCard from '$lib/universe/PostCard.svelte';
	import { postHref } from '$lib/universe/posts.js';
	import { dayOf, frontOf } from '$lib/universe/journal.js';
	import { loadFeed, stream } from '$lib/universe/stream.svelte.js';

	let { data } = $props();

	onMount(() => {
		loadFeed();
	});

	const front = $derived(frontOf(stream.posts));
	const post = $derived(front.pinned);
	const waiting = $derived(!post && (stream.feed === 'idle' || stream.feed === 'loading'));
</script>

<svelte:head>
	<title>maiaCITY</title>
	<meta name="description" content="We were never built to survive. We were built to thrive." />
</svelte:head>

<main class="wrap">
	<Manifesto banner={data.banner} />

	<p class="start eyebrow">Where it starts</p>
	{#if post}
		<div class="pinned">
			<PostCard {post} />
			<div class="actions">
				<a class="pill-btn" href={postHref(base, post)}>Read{dayOf(post) == null ? '' : ` day ${dayOf(post)}`} →</a>
				<a class="ghost-btn" href="{base}/universe/?c=Journal">All days</a>
			</div>
		</div>
	{:else}
		<p class="empty">
			{#if waiting}
				Taking in the journal from avenDB…
			{:else}
				The journal can't be reached just now. <a href="{base}/universe/?c=Journal">Read it on Maia Universe →</a>
			{/if}
		</p>
	{/if}

	{#if front.next}
		<section class="onward">
			<p class="eyebrow">Then</p>
			<PostCard post={front.next} />
		</section>
	{/if}

	<div class="latest"><LatestList posts={front.latest} /></div>
</main>

<style>
	main {
		padding-block: 0 6rem;
	}

	.start {
		margin: 4.5rem 0 1.25rem;
		text-align: center;
	}

	/* where it starts, the day after it and the newest days, in one column as wide as a post card on Maia Universe */
	.pinned,
	.onward,
	.latest,
	.empty {
		max-width: 46rem;
		margin-inline: auto;
	}

	.onward {
		margin-top: 2.5rem;
	}

	.onward .eyebrow {
		margin: 0 0 0.75rem;
	}

	.latest {
		margin-top: 3rem;
	}

	.empty {
		padding: 2rem 1rem;
		text-align: center;
		color: var(--ink-soft);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
		margin-top: 1rem;
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
</style>
