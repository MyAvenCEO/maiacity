<!--
	The post's film, with the post's own banner as the poster.

	Bunny Stream's thumbnail URL isn't publicly readable, so the iframe would
	open on a black square. The cover from the frontmatter stands in until
	someone presses play, and the embed is only mounted on that click — which
	also keeps the third-party player out of the page until it is wanted.
-->
<script lang="ts">
	import { dev } from '$app/environment';
	import { base } from '$app/paths';
	import CoverArt from './CoverArt.svelte';
	import type { PostMeta } from './types';

	let {
		post,
		maxHeight = '78vh',
		coverOnly = false
	}: {
		post: PostMeta;
		/** how much of the viewport a tall (square, portrait) film may take */
		maxHeight?: string;
		/** show the banner on its own when the post has no film — the article
		    itself doesn't, because its cover is usually its first figure */
		coverOnly?: boolean;
	} = $props();

	let playing = $state(false);

	// the local master, so a post can be test-run before Stream finishes encoding
	const local = $derived(dev && post.videoLocal ? post.videoLocal : null);
	const embedded = $derived(post.video && post.videoLibrary ? post.video : null);
	const hasFilm = $derived(Boolean(local || embedded));
	const poster = $derived(post.cover ?? null);
</script>

{#if hasFilm || coverOnly}
	<figure class="player" style:--aspect={post.videoAspect ?? '16 / 9'} style:--max-h={maxHeight}>
		<div class="frame" class:flat={!poster}>
			{#if hasFilm && playing}
				{#if local}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src="{base}{local}" poster={poster ? `${base}${poster}` : undefined} controls autoplay playsinline>
						<track kind="captions" />
					</video>
				{:else}
					<iframe
						src="https://iframe.mediadelivery.net/embed/{post.videoLibrary}/{post.video}?autoplay=true&preload=true"
						title={post.title}
						allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
						allowfullscreen
					></iframe>
				{/if}
			{:else}
				<CoverArt {post} eager />
				{#if hasFilm}
					<button type="button" onclick={() => (playing = true)}>
						<span class="glyph" aria-hidden="true"></span>
						<span class="label">Play</span>
					</button>
				{/if}
			{/if}
		</div>
	</figure>
{/if}

<style>
	.player {
		display: flex;
		justify-content: center;
		margin: 2.5rem 0 0;
	}

	/* Shrink-wraps whatever is inside, so the rounding follows the film rather
	   than a box behind it — no dark corners left over. */
	.frame {
		position: relative;
		border-radius: var(--player-radius, var(--radius));
		overflow: hidden;
		line-height: 0;
	}

	.frame.flat {
		width: min(100%, 62rem);
		aspect-ratio: var(--aspect, 16 / 9);
		max-height: var(--max-h, 78vh);
	}

	.frame :is(iframe, video),
	.frame :global(img) {
		display: block;
		width: auto;
		max-width: 100%;
		height: auto;
		/* a square film would otherwise run past the fold */
		max-height: var(--max-h, 78vh);
		aspect-ratio: var(--aspect, 16 / 9);
		object-fit: cover;
		border: 0;
	}

	button {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		border: 0;
		background: linear-gradient(to bottom, rgb(0 0 0 / 0.05), rgb(0 0 0 / 0.35));
		color: #fff;
		cursor: pointer;
		transition: background-color 180ms ease;
	}

	button:hover .glyph {
		transform: scale(1.06);
	}

	.glyph {
		display: grid;
		place-items: center;
		width: 4.5rem;
		height: 4.5rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.92);
		transition: transform 180ms ease;
	}

	.glyph::after {
		content: '';
		margin-left: 0.28rem;
		border-style: solid;
		border-width: 0.72rem 0 0.72rem 1.2rem;
		border-color: transparent transparent transparent var(--ink);
	}

	.label {
		font-size: 0.78rem;
		letter-spacing: 0.14em;
		line-height: 1;
		text-transform: uppercase;
	}

	@media (max-width: 820px) {
		.frame {
			border-radius: 0;
		}
	}
</style>
