<!--
	The door to the next day: banner, day, title and excerpt, as one link.
	Sits at the foot of every post and under the pinned day on the front page,
	so the journal always hands the reader on rather than ending.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import CoverArt from './CoverArt.svelte';
	import type { PostMeta } from './types';

	let {
		post,
		label = 'Next'
	}: {
		post: PostMeta;
		/** the word before the day number — "Next", "Then", … */
		label?: string;
	} = $props();

	const day = $derived(post.day != null ? String(post.day).padStart(2, '0') : null);
	const formatted = $derived(
		post.date
			? new Date(post.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
			: ''
	);
</script>

<a class="next" href="{base}/blog/{post.slug}">
	<div class="thumb"><CoverArt {post} /></div>
	<div class="body">
		<p class="eyebrow">
			{label}{#if day}&ensp;·&ensp;Day {day}{/if}{#if formatted}&ensp;·&ensp;{formatted}{/if}
		</p>
		<h3>{post.title}</h3>
		<p class="excerpt">{post.excerpt}</p>
		<span class="go">Read day {post.day ?? ''} <span aria-hidden="true">→</span></span>
	</div>
</a>

<style>
	.next {
		display: grid;
		grid-template-columns: minmax(0, 15rem) minmax(0, 1fr);
		gap: 1.75rem;
		align-items: center;
		padding: 1rem;
		border-radius: var(--radius);
		background: var(--paper);
		text-decoration: none;
		color: inherit;
		transition:
			transform 180ms ease,
			box-shadow 180ms ease;
	}

	.next:hover {
		transform: translateY(-2px);
		box-shadow: 0 14px 34px -22px rgb(31 42 35 / 0.45);
	}

	.thumb {
		aspect-ratio: 4 / 3;
		border-radius: calc(var(--radius) - 8px);
		overflow: hidden;
		background: var(--cream);
	}

	.thumb :global(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 400ms ease;
	}

	.next:hover .thumb :global(img) {
		transform: scale(1.03);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.25rem 0.75rem 0.25rem 0;
	}

	h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(1.45rem, 2.4vw, 1.9rem);
		font-weight: 400;
		line-height: 1.15;
	}

	.excerpt {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		font-size: 0.98rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	.go {
		margin-top: 0.35rem;
		font-size: 0.9rem;
		font-weight: 500;
		color: var(--terracotta);
	}

	.go span {
		display: inline-block;
		transition: transform 150ms ease;
	}

	.next:hover .go span {
		transform: translateX(3px);
	}

	@media (max-width: 640px) {
		.next {
			grid-template-columns: 1fr;
			gap: 1rem;
		}

		.thumb {
			aspect-ratio: 16 / 10;
		}

		.body {
			padding: 0 0.5rem 0.5rem;
		}
	}
</style>
