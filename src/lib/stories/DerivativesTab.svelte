<!--
	Every post derived from a story's article and film, as its platform will show it: two by two, filtered by platform.
	The posts are prepared from the article (the content-derivatives skill) and pushed with the story; here they are
	only looked at.
-->
<script>
	import ChannelGlyph from '$lib/admin/ChannelGlyph.svelte';
	import PostPreview from '$lib/admin/PostPreview.svelte';
	import { PLATFORMS, PLATFORM_LABEL } from '$lib/admin/board';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

	/** @type {{ item: ContentItem }} */
	let { item } = $props();

	let platform = $state('all');
	const posts = $derived(item.posts ?? []);
	const platforms = $derived(PLATFORMS.filter((p) => posts.some((x) => x.platform === p)));
	const shown = $derived(platform === 'all' ? posts : posts.filter((p) => p.platform === platform));
</script>

{#if platforms.length > 1}
	<nav class="ptabs" aria-label="Platforms">
		<button class:on={platform === 'all'} onclick={() => (platform = 'all')}>All <span>{posts.length}</span></button>
		{#each platforms as p (p)}
			<button class:on={platform === p} onclick={() => (platform = p)}><ChannelGlyph platform={p} /> {PLATFORM_LABEL[p]} <span>{posts.filter((x) => x.platform === p).length}</span></button>
		{/each}
	</nav>
{/if}
{#if shown.length}
	<PostPreview posts={shown} deliveries={item.deliveries ?? []} article={item.body} when={item.scheduled_at} layout="grid" />
{:else}
	<p class="empty">No posts derived yet. They are derived from the article and the film (the content-derivatives skill) and pushed with the story.</p>
{/if}

<style>
	.ptabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 1.2rem;
		border-bottom: 1px solid var(--line);
	}

	.ptabs button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.85rem;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.ptabs button.on {
		border-bottom-color: var(--ink);
		font-weight: 600;
		color: var(--ink);
	}

	.ptabs span {
		font-weight: 400;
		opacity: 0.6;
	}

	.empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
</style>
