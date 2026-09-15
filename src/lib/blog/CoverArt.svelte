<!--
	A post's banner.

	Not every article has artwork, and borrowing an unrelated render to fill the
	hole misrepresents the piece. When there is no cover the banner sets the
	title instead — same shape, same weight in the layout, no invented image.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import type { PostMeta } from './types';

	let {
		post,
		eager = false
	}: {
		post: PostMeta;
		/** the front page's pinned banner is above the fold */
		eager?: boolean;
	} = $props();
</script>

{#if post.cover}
	<img
		src="{base}{post.cover}"
		alt={post.coverAlt ?? post.title}
		loading={eager ? 'eager' : 'lazy'}
	/>
{:else}
	<div class="box">
		<div class="titled">
			<span class="mark">maiaCITY</span>
			<p class="title">{post.title}</p>
			{#if post.day != null}
				<span class="day">Day {String(post.day).padStart(2, '0')}</span>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* sized by whoever places the banner — a card thumb crops it, the player
	   lets it keep its own proportions */
	img {
		display: block;
		object-fit: cover;
	}

	/* the type scales with the banner, which is a card thumb in one place and a
	   full-width block in another */
	.box {
		container-type: inline-size;
		width: 100%;
		height: 100%;
	}

	.titled {
		display: flex;
		width: 100%;
		height: 100%;
		flex-direction: column;
		justify-content: space-between;
		gap: 1.5rem;
		padding: clamp(1rem, 4%, 2rem);
		background: var(--ink);
		color: var(--paper);
		text-align: left;
	}

	.mark,
	.day {
		font-size: 0.68rem;
		letter-spacing: 0.18em;
		line-height: 1;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.title {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.25rem, 4.5cqw, 2.4rem);
		font-weight: 400;
		line-height: 1.15;
		text-wrap: balance;
	}
</style>
