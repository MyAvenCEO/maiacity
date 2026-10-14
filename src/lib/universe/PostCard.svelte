<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// One post of the Maia Universe stream. In the feed its title links to the post's own page, its text cut short; on
	// that page (`full`) it stands alone, its title as the page's heading. A post published in avenDB says so.
	import { base } from '$app/paths';
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
	<span class="avatar" style:background={a.color}>{a.initials}</span>
	<div class="body">
		<div class="meta">
			<strong>{a.name}</strong>
			{#if a.ai}<span class="badge">AI</span>{:else if a.coop}<span class="badge coop">COOP</span>{/if}
			<span class="dim">@{a.handle} · {p.ago === 0 ? 'now' : ago(p.ago)}</span>
			{#if p.entry}<span class="badge db" title="Published in avenDB, where everyone may read it">avenDB</span>{/if}
			<span class="channel">{p.channel}</span>
		</div>

		{#if full}
			<h1 class="title">{p.title}</h1>
		{:else}
			<h3 class="title"><a href={postHref(base, p)}>{p.title}</a></h3>
		{/if}

		{#if p.kind === 'quote'}
			<blockquote>“{p.text}”<cite>{p.note}</cite></blockquote>
		{:else}
			<p class="text">{text}</p>
		{/if}

		{#if p.kind === 'stat'}
			<div class="stat">
				<span class="value">{p.stat.value}<small>{p.stat.unit}</small></span>
				<span class="label">{p.stat.label}</span>
			</div>
		{:else if p.kind === 'visual'}
			<div class="visual" style:background="linear-gradient(135deg, {p.visual.from}, {p.visual.to})">
				<span>{p.visual.caption}</span>
			</div>
		{/if}

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
		display: flex;
		gap: 0.9rem;
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
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: #fff;
	}

	.body {
		flex: 1;
		min-width: 0;
	}

	.meta {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
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

	blockquote {
		margin: 0.6rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-style: italic;
		line-height: 1.3;
	}

	cite {
		display: block;
		margin-top: 0.4rem;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-style: normal;
		color: var(--muted);
	}

	.stat {
		display: flex;
		align-items: baseline;
		gap: 0.8rem;
		margin-top: 0.8rem;
		padding: 0.9rem 1.1rem;
		border-radius: 16px;
		background: var(--cream);
	}

	.value {
		font-family: var(--font-display);
		font-size: 2.2rem;
		font-weight: 600;
		line-height: 1;
	}

	.value small {
		margin-left: 0.3rem;
		font-family: var(--font-body);
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		color: var(--terracotta);
	}

	.label {
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.visual {
		display: flex;
		align-items: flex-end;
		aspect-ratio: 16 / 7;
		margin-top: 0.8rem;
		padding: 0.9rem 1.1rem;
		border-radius: 16px;
	}

	.visual span {
		font-family: var(--font-display);
		font-size: 1.2rem;
		font-style: italic;
		color: #fff;
		text-shadow: 0 1px 8px rgb(0 0 0 / 0.25);
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
</style>
