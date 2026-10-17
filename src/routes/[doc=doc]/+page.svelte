<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// A post of the Maia Universe on its own page (an inspire post as its report card, $lib/universe/InspirePost.svelte) (or, when the name is an asset recipe's hash, that asset's build:
	// $lib/assets/AssetPage.svelte, as ./+page.js finds), laid out as the journal lays out every article on the site
	// ($lib/blog/PostLayout.svelte): its cover, its channel, its title, its subtitle, who wrote it and when, its words,
	// then more of the stream. Its Markdown reads as avenDB lays it out ($lib/avendb/article.js), with the pictures
	// everyone may read, from avenDB's server or, for a post from before avenDB, the media vault's gateway; one only its
	// vault's readers hold is left out.
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Cover from '$lib/blog/Cover.svelte';
	import PostLayout from '$lib/blog/PostLayout.svelte';
	import { bodyText, laidOut, render } from '$lib/avendb/article.js';
	import { shaped } from '$lib/app/shapes.js';
	import { ago, pictureOf, postHref, slug } from '$lib/universe/posts.js';
	import { authorOf, findPost, loadFeed, stream } from '$lib/universe/stream.svelte.js';
	import PostCard from '$lib/universe/PostCard.svelte';
	import InspirePost from '$lib/universe/InspirePost.svelte';
	import { inspireOf } from '$lib/universe/inspire.js';
	import VaultRecipes from '$lib/assets/VaultRecipes.svelte';

	let { data } = $props();

	// a post published in avenDB opens once its feed is in
	onMount(() => {
		if (!data.asset && !findPost(data.doc)) loadFeed();
	});

	const post = $derived(findPost(data.doc));
	// an inspire post opens as its report card, the inspire delivery's own layout
	const inspire = $derived(post && inspireOf(post, stream.entries));
	const author = $derived(post && authorOf(post));
	const waiting = $derived(!post && (stream.feed === 'idle' || stream.feed === 'loading'));
	// more from the same channel, then the rest of the stream
	const more = $derived(
		post ? [...stream.posts.filter((p) => p !== post && p.channel === post.channel), ...stream.posts.filter((p) => p !== post && p.channel !== post.channel)].slice(0, 3) : []
	);

	// an avenDB article as avenDB lays it out: its subtitle, its cover, then its body, with the pictures everyone reads
	const parts = $derived(laidOut(post?.md ?? ''));
	const PICTURES = /!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;
	const html = $derived.by(() => {
		if (!post) return '';
		const shown = bodyText(parts).replace(PICTURES, (md, name) => (pictureOf(post, name) ? md : ''));
		return render(shown, (name) => pictureOf(post, name) ?? '');
	});
	const meta = $derived(post ? `@${author.handle}${post.ago == null ? '' : ` · ${post.ago === 0 ? 'now' : ago(post.ago)}`} · Published in avenDB` : '');

	// a missing, old or mistyped title still finds the post by its doc id; the address is put right
	$effect(() => {
		if (post && page.url.searchParams.get('t') !== slug(post.title))
			goto(postHref(base, post), { replaceState: true, noScroll: true, keepFocus: true });
	});
</script>

<svelte:head>
	{#if !data.asset}
		<title>{post ? `${post.title} · ${author.name}` : waiting ? 'A post' : 'Post not found'} · Maia Universe</title>
		{#if post}<meta name="description" content={post.text} />{/if}
	{/if}
</svelte:head>

{#snippet back()}<a class="back" href="{base}/universe/">← Maia Universe</a>{/snippet}

{#snippet hero()}
	<Cover src={post.cover.src} alt={post.cover.alt || post.title} />
{/snippet}

{#snippet avatar()}
	<span class="avatar initials" style:background={author.color} style={shaped(author.kind)}>{author.initials}</span>
{/snippet}

{#snippet body()}
	{@html html}
{/snippet}

{#snippet onward()}
	<p class="eyebrow">More in the stream</p>
	<div class="more">
		{#each more as p (p.id)}
			<PostCard post={p} />
		{/each}
	</div>
{/snippet}

{#if data.asset}
	<VaultRecipes><data.AssetPage hash={data.asset} /></VaultRecipes>
{:else if inspire}
	<InspirePost entry={inspire} />
{:else if post}
	<PostLayout
		hero={post.cover ? hero : undefined}
		{back}
		eyebrow={post.channel}
		title={post.title}
		subtitle={parts.subtitleText}
		{avatar}
		author={author.name}
		{meta}
		{body}
		onward={more.length ? onward : undefined}
	/>
{:else}
	<main class="wrap page">
		{@render back()}
		<div class="missing">
			{#if waiting}
				<p>Taking in what was published in avenDB…</p>
			{:else}
				<h1>This post is not in the stream</h1>
				<p>It may have been taken off avenDB, as its article went back to a draft.</p>
				<!-- an asset's own page is found among the Maia City vault's recipes ($lib/assets/vault.js): when they can't be
				     loaded, which this name may be is not known, and the page says why -->
				{#if data.recipes}<p class="bad" role="alert">If it is an asset's page: {data.recipes}</p>{/if}
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

	.missing p.bad {
		color: var(--terracotta);
	}
</style>
