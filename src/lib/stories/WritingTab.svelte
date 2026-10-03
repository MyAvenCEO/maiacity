<!--
	A story's article: the long-form master, the fullest telling of it, which the blog publishes and every other output
	derives from. Read as the journal sets it (the cover, the title, the words), or written as Markdown with its front
	matter. Read only once its posts derive from it (move it back to Writing to change it), and when it lives in the
	repo (edited there, pushed with the story).
-->
<script>
	import { renderMarkdown, splitArticle } from '$lib/admin/markdown';
	import { wordsOf } from './stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

	/** @type {{ item: ContentItem, locked: boolean, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, locked, onchange } = $props();

	/** @type {'read' | 'write'} */
	let mode = $state('read');
	const article = $derived(item.body?.trim() ? splitArticle(item.body) : null);
	const html = $derived(article ? renderMarkdown(article.body) : '');
	const size = $derived(wordsOf(article?.body ?? ''));
	const why = $derived(
		locked
			? 'Locked: its posts are derived from it. Move the story back to Writing to change it.'
			: item.source
				? `Written in the repo (${item.source}): change it there and push it with the story.`
				: ''
	);
</script>

<div class="writing">
	<div class="bar">
		{#if !why}
			<div class="modes" role="tablist" aria-label="Read or write">
				<button role="tab" aria-selected={mode === 'read'} class:on={mode === 'read'} onclick={() => (mode = 'read')}>Read</button>
				<button role="tab" aria-selected={mode === 'write'} class:on={mode === 'write'} onclick={() => (mode = 'write')}>Write</button>
			</div>
		{:else}
			<p class="why">{why}</p>
		{/if}
		<span class="size">{size.words.toLocaleString('en-GB')} words · {size.minutes} min</span>
	</div>

	{#if mode === 'write' && !why}
		<textarea
			aria-label="The article, in Markdown"
			value={item.body}
			placeholder={'---\ntitle: …\nsubtitle: …\n---\n\nThe whole story, in full: every detail, every source. The film and the posts are cut from this.'}
			oninput={(e) => onchange({ body: e.currentTarget.value })}
		></textarea>
	{:else if article}
		<!-- as the journal sets it: the cover edge to edge, then one centred column — the title, the words -->
		<article class="article">
			{#if article.cover}<figure class="a-hero"><img src={article.cover} alt="" style:object-position={article.coverPosition} /></figure>{/if}
			<div class="a-col">
				<h1 class="a-title">{article.title ?? item.title}</h1>
				{#if article.subtitle}<p class="a-sub">{article.subtitle}</p>{/if}
				<div class="prose a-body">{@html html}</div>
			</div>
		</article>
	{:else}
		<p class="empty">No article yet. It is written last of the words, from the journey: the fullest telling, the blog post every output comes from.</p>
	{/if}
</div>

<style>
	.writing {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
	}

	.modes {
		display: flex;
		padding: 2px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
	}

	.modes button {
		min-width: 4.5rem;
		padding: 0.25rem 0.8rem;
		border: 0;
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}

	.modes button.on {
		background: var(--ink);
		color: var(--paper);
	}

	.why {
		margin: 0;
		padding: 0.45rem 0.8rem;
		border-radius: 10px;
		background: var(--cream);
		font-size: 0.84rem;
		color: var(--ink-soft);
	}

	.size {
		font-size: 0.8rem;
		color: var(--muted);
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: 65vh;
		padding: 1rem 1.1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		font: 0.92rem/1.6 ui-monospace, 'SF Mono', Menlo, monospace;
		color: var(--ink);
		resize: vertical;
		field-sizing: content;
	}

	textarea:focus-visible {
		outline: 2px solid var(--mustard);
		outline-offset: 1px;
	}

	.empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}

	/* the article, set the way the journal sets it; the cover whole, as wide as the journal's film */
	.a-hero {
		width: min(62rem, 100%);
		aspect-ratio: 16 / 9;
		margin: 0 auto 2.5rem;
		overflow: hidden;
		border-radius: 14px;
		background: var(--paper);
	}

	.a-hero img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.a-col {
		max-width: 46rem;
		margin: 0 auto;
		padding-bottom: 3rem;
	}

	.a-title {
		margin: 0;
		font-size: clamp(2.1rem, 5vw, 3.6rem);
	}

	.a-sub {
		margin: 1rem 0 0;
		font-family: var(--font-display);
		font-size: 1.35rem;
		font-weight: 300;
		line-height: 1.35;
		color: var(--ink-soft);
	}

	.a-body {
		margin-top: 2.5rem;
		font-size: 1.12rem;
		line-height: 1.7;
	}

	.a-body :global(h2) {
		margin: 2.75rem 0 1rem;
		font-size: clamp(1.8rem, 3.5vw, 2.4rem);
	}

	.a-body :global(h3) {
		margin: 2rem 0 0.75rem;
		font-size: 1.35rem;
	}

	.a-body :global(blockquote) {
		margin: 2rem 0;
		padding-left: 1.25rem;
		font-size: 1.35rem;
		line-height: 1.45;
	}

	/* figures break out of the column, centred on it */
	.a-body :global(figure) {
		width: min(62rem, calc(96vw - 3.2rem));
		margin-block: 2.5rem;
		margin-left: 50%;
		transform: translateX(-50%);
	}

	.a-body :global(figure img) {
		display: block;
		width: 100%;
		border-radius: var(--radius);
	}

	.a-body :global(figcaption) {
		margin-top: 0.75rem;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--muted);
		text-align: center;
	}

	.a-body :global(a) {
		color: inherit;
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
	}
</style>
