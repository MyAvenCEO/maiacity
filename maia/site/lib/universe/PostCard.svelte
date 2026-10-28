<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// One post of the Maia Universe stream, an article published in avenDB. In the feed its title links to the post's
	// own page, its text cut short, under its cover where everyone may read it; on that page (`full`) it stands alone,
	// its title as the page's heading. Its co-authors head it, their marks side by side and their names below, and the post runs the card's whole width below.
	import { base } from '$app/paths';
	import { shaped } from '$lib/app/shapes.js';
	import { ago, postHref, coverOf } from './posts.js';
	import { authorOf, faceOf, like } from './stream.svelte.js';

	let { post: p, full = false } = $props();
	const a = $derived(authorOf(p));
	const cover = $derived(coverOf(p) || p.cover);
	const SHORT = 320;
	const text = $derived(
		full || p.text.length <= SHORT ? p.text : `${p.text.slice(0, SHORT - 20).replace(/\s+\S*$/, '')}…`
	);
</script>

<article class="post" class:full>
	<div class="body">
		<header class="meta">
			<div class="voices">
				<div class="stack" aria-hidden="true">
					{#each a.people ?? [a] as v, i (i)}
						<span class="ring" style={shaped(v.kind)} style:z-index={10 - i}>
							<span class="avatar" style:background={v.color} style={shaped(v.kind)}>
								{v.initials}
								{#if faceOf(v.vault)}<img src={faceOf(v.vault)} alt="" />{/if}
							</span>
						</span>
					{/each}
				</div>
				<ul class="names" aria-label="Written by">
					{#each a.people ?? [a] as v, i (i)}
						<li>
							{v.name}{#if v.ai}<span class="badge">AI</span>{:else if v.coop}<span class="badge coop">COOP</span>{/if}
						</li>
					{/each}
					{#if p.ago != null}<li class="when">{p.ago === 0 ? 'now' : ago(p.ago)}</li>{/if}
				</ul>
			</div>
			<span class="channel">{p.channel}</span>
		</header>

		{#if full}
			<h1 class="title">{p.title}</h1>
		{:else}
			<h3 class="title"><a href={postHref(base, p)}>{p.title}</a></h3>
		{/if}

		{#if cover}
			<div class="cover"><img src={cover.src} alt={cover.alt || p.title} loading="lazy" /></div>
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

	/* the co-authors' marks side by side, each over the next, ringed in the card's paper */
	.voices {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}

	.stack {
		display: flex;
		padding-left: 0.55rem;
	}

	.ring {
		position: relative;
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		margin-left: -0.55rem;
		background: var(--paper);
	}

	.avatar {
		position: relative;
		overflow: hidden;
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
	}

	/* its profile picture over its initials, once the server hands it */
	.avatar img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.body {
		min-width: 0;
	}

	.meta {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.8rem;
	}

	/* the names below the marks, small, one by one */
	.names {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem 0;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--ink);
	}

	.names li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.names li + li::before {
		content: '·';
		margin: 0 0.4rem;
		color: var(--muted);
		font-weight: 400;
	}

	.names .when {
		font-weight: 400;
		color: var(--muted);
	}

	.badge {
		padding: 0.02rem 0.32rem;
		border-radius: 5px;
		background: #2f6fbf1f;
		color: #2f6fbf;
		font-size: 0.58rem;
		font-weight: 700;
		letter-spacing: 0.08em;
	}

	.badge.coop {
		background: #1f7a521f;
		color: #1f7a52;
	}

	.channel {
		flex: none;
		padding: 0.25rem 0.6rem;
		border: 1px solid color-mix(in srgb, var(--terracotta) 35%, transparent);
		border-radius: 999px;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.title {
		margin: 0.85rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(1.4rem, 3.2vw, 1.75rem);
		font-weight: 600;
		line-height: 1.18;
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

		.ring {
			width: 2.4rem;
			height: 2.4rem;
		}

		.avatar {
			width: 2.1rem;
			height: 2.1rem;
			font-size: 0.72rem;
		}
	}

	@media (max-width: 520px) {
		.post {
			padding: 0.95rem;
		}
	}
</style>
