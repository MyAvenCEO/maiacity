<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// One post of the Maia Universe stream, an article published in avenDB. In the feed its title links to the post's
	// own page, its text cut short, under its cover where everyone may read it; on that page (`full`) it stands alone,
	// its title as the page's heading. Its voice heads it in one line, and the post runs the card's whole width below.
	import { base } from '$app/paths';
	import { shaped } from '$lib/app/shapes.js';
	import { ago, postHref } from './posts.js';
	import { authorOf, like } from './stream.svelte.js';

	let { post: p, full = false } = $props();
	const a = $derived(authorOf(p));
	const SHORT = 320;
	const text = $derived(
		full || p.text.length <= SHORT ? p.text : `${p.text.slice(0, SHORT - 20).replace(/\s+\S*$/, '')}…`
	);
</script>

<article class="post" class:full>
	<div class="body">
		<div class="meta">
			<span class="avatar" style:background={a.color} style={shaped(a.kind)}>{a.initials}</span>
			<strong>{a.name}</strong>
			{#if a.ai}<span class="badge">AI</span>{:else if a.coop}<span class="badge coop">COOP</span>{/if}
			<span class="dim">@{a.handle}{p.ago == null ? '' : ` · ${p.ago === 0 ? 'now' : ago(p.ago)}`}</span>
			{#if p.entry}<span class="badge db" title="Published in avenDB, where everyone may read it">avenDB</span>{/if}
			<span class="channel">{p.channel}</span>
		</div>

		{#if full}
			<h1 class="title">{p.title}</h1>
		{:else}
			<h3 class="title"><a href={postHref(base, p)}>{p.title}</a></h3>
		{/if}

		{#if p.cover}
			<div class="cover"><img src={p.cover.src} alt={p.cover.alt || p.title} loading="lazy" /></div>
		{/if}

		<p class="text">{text}</p>

		<div class="actions">
			<button class="act" aria-label="Reply">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H8l-4 4z" /></svg>{p.replies}
			</button>
			<button class="act" class:liked={p.liked} aria-pressed={p.liked} aria-label="Like" onclick={() => like(p)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>{p.likes}
			</button>
		</div>
	</div>
</article>

<style>
	.post {
		position: relative;
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.1rem 1.2rem;
		transition: border-color 150ms ease, box-shadow 150ms ease;
	}

	.post:not(.full):hover {
		border-color: var(--sage);
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.06);
	}

	.post.full {
		padding: 1.6rem 1.7rem;
	}

	.avatar {
		display: grid;
		place-items: center;
		flex: none;
		align-self: center;
		width: 2.1rem;
		height: 2.1rem;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
	}

	.body {
		min-width: 0;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.5rem;
		font-size: 0.9rem;
	}

	.dim {
		color: var(--muted);
	}

	.badge {
		padding: 0.05rem 0.4rem;
		border-radius: 6px;
		background: #2f6fbf1f;
		color: #2f6fbf;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.badge.coop {
		background: #1f7a521f;
		color: #1f7a52;
	}

	.badge.db {
		background: #8a5fb01f;
		color: #8a5fb0;
	}

	.channel {
		margin-left: auto;
		font-size: 0.72rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.title {
		margin: 0.45rem 0 0;
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.01em;
	}

	.full .title {
		margin-top: 0.8rem;
		font-size: clamp(1.7rem, 4.5vw, 2.4rem);
		font-weight: 500;
	}

	.title a {
		color: inherit;
		text-decoration: none;
	}

	/* the whole card opens the post; the buttons sit above that link */
	.title a::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
	}

	.title a:hover {
		color: var(--terracotta);
	}

	.text {
		margin: 0.35rem 0 0;
		line-height: 1.55;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.full .text {
		margin-top: 0.8rem;
		font-size: 1.12rem;
	}

	/* the article's cover, where everyone may read it */
	.cover {
		display: block;
		margin-top: 0.8rem;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: 16px;
		background: var(--cream);
	}

	.cover img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.actions {
		position: relative;
		z-index: 1;
		display: flex;
		gap: 1.2rem;
		width: max-content;
		margin-top: 0.7rem;
	}

	.act {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.4rem;
		margin-left: -0.4rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.85rem;
		color: var(--muted);
		cursor: pointer;
	}

	.act svg {
		width: 1.05rem;
		height: 1.05rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linejoin: round;
	}

	.act:hover {
		color: var(--ink);
	}

	.act.liked {
		color: var(--terracotta);
	}

	.act.liked svg {
		fill: currentColor;
	}

	@media (max-width: 520px) {
		.post,
		.post.full {
			gap: 0.7rem;
			padding: 0.95rem;
		}

		.avatar {
			width: 2.2rem;
			height: 2.2rem;
			font-size: 0.72rem;
		}

		.channel {
			margin-left: 0;
		}
	}

	@media (max-width: 520px) {
		.post {
			padding: 0.95rem;
		}
	}
</style>
