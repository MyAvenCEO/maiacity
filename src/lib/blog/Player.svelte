<!--
	The post's film.

	In production it is Bunny's player, mounted straight away, opening on the
	post's own banner (set on the video with scripts/bunny-thumbnail.mjs) so
	one click plays. Mounting it on a click of our own cost a second click:
	Safari won't autoplay a freshly created cross-origin player with sound.

	In dev the local master plays in a <video>, behind our own poster and
	play button, so a post can be test-run before Stream finishes encoding.
-->
<script lang="ts">
	import { asset } from '$lib/media/url';
	import { dev } from '$app/environment';
	import { base } from '$app/paths';
	import { tick } from 'svelte';
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
	let frame: HTMLDivElement | undefined = $state();

	/** Play, and go fullscreen on the same click — the film is the post, and a
	 * square cut wants the whole screen. The player mounts on the click, so we
	 * wait one tick for it; the click's activation still covers the request.
	 * Anything that refuses (an old iOS, a browser policy) just plays inline. */
	async function play(): Promise<void> {
		playing = true;
		await tick();
		const el = frame?.querySelector<HTMLElement>('video, iframe');
		if (!el) return;
		try {
			if (el.requestFullscreen) await el.requestFullscreen();
			else (el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
		} catch {
			// not allowed here — inline is fine
		}
	}

	// the local master, so a post can be test-run before Stream finishes encoding
	const local = $derived(dev && post.videoLocal ? post.videoLocal : null);
	const embedded = $derived(post.video && post.videoLibrary ? post.video : null);
	const hasFilm = $derived(Boolean(local || embedded));
	const poster = $derived(post.poster ?? post.cover ?? null);
	// the aspect as a number, so the frame's width can be capped from its height
	const ratio = $derived.by(() => {
		const [w, h] = (post.videoAspect ?? '16 / 9').split('/').map((n) => Number(n.trim()));
		return w > 0 && h > 0 ? w / h : 16 / 9;
	});
</script>

{#if hasFilm || coverOnly}
	<!-- the front page shows the banner alone; the post shows the film -->
	{@const showEmbed = Boolean(embedded) && !local && !coverOnly}
	<figure
		class="player"
		style:--aspect={post.videoAspect ?? '16 / 9'}
		style:--ratio={ratio}
		style:--max-h={maxHeight}
	>
		<div class="frame" bind:this={frame}>
			{#if showEmbed}
				<iframe
					src="https://iframe.mediadelivery.net/embed/{post.videoLibrary}/{post.video}?autoplay=false&preload=true"
					title={post.title}
					allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
					allowfullscreen
				></iframe>
			{:else if local && playing}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src="{base}{local}" poster={asset(poster)} controls autoplay playsinline>
					<track kind="captions" />
				</video>
			{:else}
				<!-- a film waiting to play shows its own still, not the post's cover -->
				<CoverArt post={coverOnly ? post : { ...post, cover: poster ?? undefined }} eager />
				{#if local && !coverOnly}
					<button type="button" onclick={play}>
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

	/* The frame owns the size: the film's aspect, as wide as the column allows,
	   and never taller than --max-h (so a square film doesn't run past the
	   fold — its width is capped from that height through --ratio). Poster,
	   video and the embedded player all fill it, so the rounding follows the
	   film whatever is showing, and an iframe can't fall back to its 300px
	   default. */
	.frame {
		position: relative;
		width: min(100%, 62rem, calc(var(--max-h, 78vh) * var(--ratio, 1.7778)));
		aspect-ratio: var(--aspect, 16 / 9);
		border-radius: var(--player-radius, var(--radius));
		overflow: hidden;
		/* Safari drops the rounding on an iframe unless the clip is promoted */
		isolation: isolate;
		transform: translateZ(0);
		line-height: 0;
		background: #000;
	}

	.frame :is(iframe, video),
	.frame :global(img) {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		border: 0;
	}

	/* The film itself is never cropped: a square cut on a wide screen — and in
	   fullscreen, where the element fills the display — keeps its whole frame
	   and takes black at the sides, never a zoom that loses the top and bottom. */
	.frame video {
		object-fit: contain;
		background: #000;
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
