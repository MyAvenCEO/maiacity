<!--
	A post's header picture: its wide banner on a wide screen (the day's 5:2 title card, shown whole), its cover on a
	phone (the 16:9 title card, shown whole) — or the cover alone, cropped to the header, when there is no banner.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import type { PostMeta } from './types';

	let { post }: { post: PostMeta } = $props();
</script>

<picture>
	{#if post.banner}<source media="(min-width: 821px)" srcset={asset(post.banner)} />{/if}
	<img src={asset(post.cover)} alt={post.coverAlt ?? post.title} style:object-position={post.coverPosition} fetchpriority="high" />
</picture>

<style>
	picture,
	img {
		display: block;
		width: 100%;
		height: 100%;
	}

	img {
		object-fit: cover;
	}
</style>
