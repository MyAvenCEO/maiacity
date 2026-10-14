<!--
	A post, as the journal shows it: the film or the cover first, the header, the words, and the door onward. The
	post's own page and the preview of an unpublished day both render through this, so they can't drift apart; and it
	lays the post out as every article on the site is (./PostLayout.svelte).
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { base } from '$app/paths';
	import { dev } from '$app/environment';
	import type { Snippet } from 'svelte';
	import Banner from './Banner.svelte';
	import LatestList from './LatestList.svelte';
	import NextCard from './NextCard.svelte';
	import Player from './Player.svelte';
	import PostLayout from './PostLayout.svelte';
	import { categoryById } from '$lib/inspire-me/categories';
	import type { Post, PostMeta } from './types';

	let {
		post,
		next = null,
		latest = [],
		top
	}: {
		post: Post;
		next?: PostMeta | null;
		latest?: PostMeta[];
		/** above everything, the preview's "only admins see this" bar */
		top?: Snippet;
	} = $props();

	// a post with a film opens on it: the player, its poster the title card, first thing on the page
	const hasFilm = $derived(Boolean((dev && post.videoLocal) || (post.video && post.videoLibrary)));
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

{@render top?.()}

{#snippet hero()}
	<!-- a film post's film (its banner the poster, played in place), or the banner itself -->
	{#if hasFilm}<Player {post} hero />{:else}<Banner {post} />{/if}
{/snippet}

{#snippet back()}<a class="back" href="{base}/blog">← Journal</a>{/snippet}

{#snippet avatar()}
	{#if post.authorImage}<img class="avatar" src={asset(post.authorImage)} alt={post.author} />{/if}
{/snippet}

{#snippet film()}<Player {post} />{/snippet}

{#snippet onward()}
	{#if next}
		<p class="eyebrow keep">Keep reading</p>
		<NextCard post={next} />
	{/if}
	<div class="more"><LatestList posts={latest} /></div>
{/snippet}

<PostLayout
	hero={hasFilm || post.cover ? hero : undefined}
	{back}
	eyebrow={post.day != null ? `Day ${String(post.day).padStart(2, '0')}` : ''}
	title={post.title}
	subtitle={post.subtitle ?? ''}
	{avatar}
	author={post.author}
	meta="{post.authorRole ? `${post.authorRole} · ` : ''}{formatted} · {post.readingMinutes} min read"
	tags={post.categories.map((id) => ({ id, label: categoryById(id).label, color: categoryById(id).color }))}
	film={hasFilm ? undefined : film}
	html={post.html}
	onward={next || latest.length ? onward : undefined}
/>

<style>
	.keep {
		margin: 0 0 1rem;
	}

	.more {
		margin-top: 2.5rem;
	}
</style>
