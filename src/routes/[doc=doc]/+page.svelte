<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// A post of the Maia Universe on its own page, laid out as the journal lays out every article on the site
	// ($lib/blog/PostLayout.svelte): its channel, its title, an avenDB article's subtitle, who wrote it and when, its
	// words, then more of the stream. An avenDB article's Markdown reads as avenDB lays it out ($lib/avendb/article.js),
	// without its pictures, which only its vault's readers hold.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PostLayout from '$lib/blog/PostLayout.svelte';
	import { laidOut, render } from '$lib/avendb/article.js';
	import { ago, postHref, slug } from '$lib/universe/posts.js';
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

	// an avenDB article as avenDB lays it out: its subtitle, then its body, no pictures; a post of the stream, its words
	const parts = $derived(laidOut(post?.md ?? ''));
	const NO_PICTURES = /!\[[^\]]*\]\([^)]*\)/g;
	const html = $derived(
		post?.md !== undefined
			? render(parts.blocks.slice(parts.body).map((b) => b.md + b.gap).join('').replace(NO_PICTURES, ''), () => '')
			: render(post?.kind === 'quote' ? '' : (post?.text ?? ''), () => '')
	);
	const meta = $derived(post ? `@${author.handle} · ${post.ago === 0 ? 'now' : ago(post.ago)}${post.entry ? ' · Published in avenDB' : ''}` : '');

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

{#snippet back()}<a class="back" href="{base}/universe/">← Maia Universe</a>{/snippet}

{#snippet hero()}
	<div class="visual" style:background="linear-gradient(135deg, {post.visual.from}, {post.visual.to})">
		<span>{post.visual.caption}</span>
	</div>
{/snippet}

{#snippet avatar()}
	<span class="avatar initials" style:background={author.color}>{author.initials}</span>
{/snippet}

{#snippet body()}
	{#if post.kind === 'quote'}
		<blockquote>“{post.text}”</blockquote>
		{#if post.note}<p class="note">{post.note}</p>{/if}
	{:else}
		{@html html}
	{/if}
	{#if post.kind === 'stat'}
		<div class="stat">
			<span class="value">{post.stat.value}<small>{post.stat.unit}</small></span>
			<span class="label">{post.stat.label}</span>
		</div>
	{/if}
{/snippet}

{#snippet onward()}
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
		<p class="eyebrow">More in the stream</p>
		<div class="more">
			{#each more as p (p.id)}
				<PostCard post={p} />
			{/each}
		</div>
	{/if}
{/snippet}

{#if post}
	<PostLayout
		hero={post.kind === 'visual' ? hero : undefined}
		{back}
		eyebrow={post.channel}
		title={post.title}
		subtitle={parts.subtitleText}
		{avatar}
		author={author.name}
		{meta}
		{body}
		{onward}
	/>
{:else}
	<main class="wrap page">
		{@render back()}
		<div class="missing">
			{#if waiting}
				<p>Taking in what was published in avenDB…</p>
			{:else}
				<h1>This post is not in the stream</h1>
				<p>
					It may have been taken off avenDB, or shared here before the last reload: what is shared here lives in
					memory alone.
				</p>
			{/if}
		</div>
	</main>
{/if}

<style>
	.page {
		padding-block: 2.5rem 6rem;
	}

	.page .back {
		display: inline-block;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	/* the author's mark, their initials on their colour, where the journal shows a portrait */
	.initials {
		display: grid;
		place-items: center;
		flex: none;
		color: #fff;
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.visual {
		display: grid;
		place-items: end start;
		width: 100%;
		height: 100%;
		padding: 1.5rem;
		box-sizing: border-box;
	}

	.visual span {
		color: #fff;
		font-family: var(--font-display);
		font-size: 1.4rem;
		text-shadow: 0 1px 8px rgb(0 0 0 / 0.25);
	}

	.note {
		color: var(--ink-soft);
	}

	.stat {
		display: grid;
		gap: 0.3rem;
		margin: 2.5rem 0;
		padding: 1.5rem 1.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--paper);
	}

	.stat .value {
		font-family: var(--font-display);
		font-size: clamp(2.5rem, 6vw, 3.6rem);
		line-height: 1;
		letter-spacing: -0.03em;
	}

	.stat small {
		margin-left: 0.4rem;
		font-size: 0.4em;
		letter-spacing: 0.08em;
	}

	.stat .label {
		color: var(--ink-soft);
	}

	.doc {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.3rem 0.6rem;
		margin: 0 0 2.5rem;
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

	.more {
		display: grid;
		gap: 0.9rem;
		margin-top: 1rem;
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
</style>
