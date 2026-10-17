<!--
	An article as the journal lays it out, the one layout every article on the site reads in: an article in avenDB
	($lib/avendb/ArticleView.svelte) and a post of the Maia Universe (src/routes/[doc=doc]), the journal's days and the
	inspire-me reports among them. Its header picture edge to edge, then the way back, the eyebrow, the title and its subtitle,
	who wrote it and when, its tags, a film, the words, with their figures wider than the text, and the door onward.

	Each part is the post's own: `hero`, `back` (a link with the class `back`), `avatar` (with the class `avatar`),
	`film`, `body` and `onward` are drawn by the page, and the
	title and the subtitle too where it edits them (`heading`, `sub`), with the classes `post-title` and
	`post-subtitle`, which carry their type. The figures and the header picture break out as wide as the page:
	`--page`, the viewport's width unless a column sets its own, as avenDB's does for its editor's middle column (with
	its container named `page`).
-->
<script>
	/** @typedef {import('svelte').Snippet} Part */
	/**
	 * @type {{ hero?: Part, back?: Part, eyebrow?: string, title?: string, heading?: Part,
	 *   subtitle?: string, sub?: Part, avatar?: Part, author?: string, meta?: string,
	 *   tags?: { id: string, label: string, color?: string }[], film?: Part, html?: string, body?: Part,
	 *   onward?: Part }}
	 */
	let {
		hero,
		back,
		eyebrow = '',
		title = '',
		heading,
		subtitle = '',
		sub,
		avatar,
		author = '',
		meta = '',
		tags = [],
		film,
		html = '',
		body,
		onward
	} = $props();
</script>

{#if hero}
	<!-- the header, edge to edge, before anything else: one frame, one height, for a film and a banner -->
	<div class="hero">{@render hero()}</div>
{/if}

<main class="wrap">
	{@render back?.()}

	<article>
		<header>
			{#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
			{#if heading}{@render heading()}{:else}<h1 class="post-title">{title}</h1>{/if}
			{#if sub}{@render sub()}{:else if subtitle}<p class="post-subtitle">{subtitle}</p>{/if}

			<div class="byline">
				{@render avatar?.()}
				<div>
					<p class="author">{author}</p>
					{#if meta}<p class="meta">{meta}</p>{/if}
				</div>
			</div>

			{#if tags.length}
				<ul class="tag-list">
					{#each tags as t (t.id)}
						<li style:--c={t.color}>{t.label}</li>
					{/each}
				</ul>
			{/if}
		</header>

		{#if film}<div class="film">{@render film()}</div>{/if}

		<div class="prose article">
			{#if body}{@render body()}{:else}{@html html}{/if}
		</div>

		{#if onward}<footer class="onward">{@render onward()}</footer>{/if}
	</article>
</main>

<style>
	main {
		padding-block: 2.5rem 6rem;
	}

	.hero {
		/* the same gap below the navbar as the navbar keeps from the top of the page */
		margin: 1.25rem 0 0;
		width: 100%;
		/* one height for a banner and a film: on a wide screen the 5:2 banner's own (a title card shown whole), on a
		   phone the 16:9 cover's */
		height: min(calc(var(--page, 100vw) * 0.4), 80vh);
		height: min(calc(var(--page, 100vw) * 0.4), 80svh);
		background: var(--paper);
	}

	/* the way back, a link of the page's own with the class `back` */
	main :global(.back) {
		display: inline-block;
		margin-bottom: 2rem;
		font-size: 0.9rem;
		text-decoration: none;
		color: var(--ink-soft);
	}

	article {
		max-width: 46rem;
		margin: 0 auto;
	}

	/* the title and the subtitle, read or edited: the display face, whatever a page around it sets for headings */
	article :global(.post-title) {
		display: block;
		margin: 0.75rem 0 0;
		font-family: var(--font-display);
		font-size: clamp(2.5rem, 6vw, 4.2rem);
		font-weight: 400;
		font-variation-settings: 'opsz' 144;
		letter-spacing: -0.03em;
		line-height: 1.05;
	}

	article :global(.post-subtitle) {
		display: block;
		margin: 1rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
		font-weight: 300;
		line-height: 1.35;
		color: var(--ink-soft);
	}

	.onward {
		margin-top: 4rem;
		padding-top: 2.5rem;
		border-top: 1px solid var(--line);
	}

	.byline {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		margin: 2rem 0 0;
	}

	.byline :global(.avatar) {
		width: 3rem;
		height: 3rem;
		border-radius: 50%;
		object-fit: cover;
	}

	.author {
		margin: 0;
		font-weight: 500;
	}

	.meta {
		margin: 0.15rem 0 0;
		font-size: 0.85rem;
		color: var(--muted);
	}

	.tag-list {
		margin-top: 1.25rem;
	}

	/* The film breaks out of the text column, staying centred on it. */
	.film {
		width: min(62rem, calc(var(--page, 100vw) - 3rem));
		margin-left: 50%;
		transform: translateX(-50%);
	}

	.article {
		margin-top: 2.5rem;
		font-size: 1.12rem;
		line-height: 1.7;
	}

	/* the display face for its headings, as everywhere on the site, whatever a page around it sets */
	.article :global(:is(h2, h3)) {
		font-family: var(--font-display);
		font-weight: 400;
		font-variation-settings: 'opsz' 144;
		letter-spacing: -0.03em;
		line-height: 1.05;
	}

	.article :global(h2) {
		margin: 2.75rem 0 1rem;
		font-size: clamp(1.8rem, 3.5vw, 2.4rem);
	}

	.article :global(h3) {
		margin: 2rem 0 0.75rem;
		font-size: 1.35rem;
	}

	.article :global(blockquote) {
		margin: 2rem 0;
		padding-left: 1.25rem;
		font-size: 1.35rem;
		line-height: 1.45;
	}

	/* Figures break out of the text column, staying centred on it. */
	.article :global(figure) {
		width: min(62rem, calc(var(--page, 100vw) - 3rem));
		margin-block: 2.5rem;
		margin-left: 50%;
		transform: translateX(-50%);
	}

	.article :global(figure img) {
		display: block;
		width: 100%;
		border-radius: var(--radius);
		background: var(--paper);
	}

	.article :global(figcaption) {
		margin-top: 0.75rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted);
		text-align: center;
	}

	@media (max-width: 820px) {
		.hero {
			height: calc(var(--page, 100vw) * 0.5625);
		}

		.film {
			width: var(--page, 100vw);
		}

		.article :global(figure) {
			width: var(--page, 100vw);
		}

		.article :global(figure img) {
			border-radius: 0;
		}

		.article :global(figcaption) {
			padding-inline: 1.5rem;
			text-align: left;
		}
	}

	/* the same, where a column of its own is that narrow on a wider screen */
	@container page (max-width: 820px) {
		.hero {
			height: calc(var(--page, 100vw) * 0.5625);
		}

		.film {
			width: var(--page, 100vw);
		}

		.article :global(figure) {
			width: var(--page, 100vw);
		}

		.article :global(figure img) {
			border-radius: 0;
		}

		.article :global(figcaption) {
			padding-inline: 1.5rem;
			text-align: left;
		}
	}
</style>
