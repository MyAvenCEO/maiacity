<!--
	One snippet, opened large from the board (and from the calendar, through the board): its title, the six steps it
	moves through as its new versions come in (its hook, the article, the posts derived from it, their times, going
	out), and the version of any step it has reached — click a step to see it:

	  idea         the idea itself, big enough to read
	  hook         its title cards: the thumbnail in each ratio (16:9, 1:1, 9:16, 5:2)
	  draft        the base article (the day's Markdown, the one source everything derives from)
	  derivatives  every post derived from it, simulated on its platform, two by two, filtered by platform
	  scheduled    the week they go out in: one small summary per post at its time (and the files)
	  published    the same week, as it went out

	Nothing to type here: the article is written in the repo and the posts derived from it; the board only moves them.
-->
<script lang="ts">
	import { STATUSES, type ContentItem, type Status } from '$lib/auth/client';
	import ChannelGlyph from './ChannelGlyph.svelte';
	import Deliveries from './Deliveries.svelte';
	import HookCards from './HookCards.svelte';
	import PostPreview from './PostPreview.svelte';
	import ScheduleWeek from './ScheduleWeek.svelte';
	import { PLATFORMS, PLATFORM_LABEL, dateLabel, cutsOf, entriesOf, launchOf, placeLabel, statusLabel } from './board';
	import { renderMarkdown, splitArticle } from './markdown';

	let {
		item,
		statuses = STATUSES,
		onmove,
		ondelete,
		onclose
	}: {
		item: ContentItem;
		/** the steps in the API's order */
		statuses?: readonly Status[];
		/** move it to another step (the page saves it) */
		onmove: (status: Status) => void;
		ondelete: () => void;
		onclose: () => void;
	} = $props();

	let sure = $state(false);
	const at = $derived(statuses.indexOf(item.status));
	// the step on view: where the card stands, until another step it has reached is clicked
	let view = $state<Status>('idea');
	$effect(() => {
		void item.id;
		view = item.status;
	});
	const cuts = $derived(cutsOf(item));
	const posts = $derived(item.posts ?? []);
	// the derivatives, filtered by the platform they go to
	let platform = $state<string>('all');
	const platforms = $derived(PLATFORMS.filter((p) => posts.some((x) => x.platform === p)));
	const shown = $derived(platform === 'all' ? posts : posts.filter((p) => p.platform === platform));
	const article = $derived(item.body?.trim() ? splitArticle(item.body) : null);
	const html = $derived(article ? renderMarkdown(article.body) : '');
	// the day it is, as the journal writes it ("Day 01")
	const dayNo = $derived(item.project?.match(/\d+/)?.[0]?.padStart(2, '0') ?? null);
	// the posts in the order a day is read, each at its time
	// the launch: the first moment several platforms go out together
	const launch = $derived(launchOf(entriesOf(item)));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

{#snippet theArticle()}
	{#if article}
		<!-- as the journal sets it: the cover edge to edge, then one centred column — the day, the title, the words -->
		<article class="article">
			{#if article.cover}<figure class="a-hero"><img src={article.cover} alt="" style:object-position={article.coverPosition} /></figure>{/if}
			<div class="a-col">
				{#if dayNo}<p class="eyebrow">Day {dayNo}</p>{/if}
				<h1 class="a-title">{article.title ?? item.title}</h1>
				{#if article.subtitle}<p class="a-sub">{article.subtitle}</p>{/if}
				<div class="prose a-body">{@html html}</div>
			</div>
		</article>
	{:else}
		<p class="empty">No base article yet.</p>
	{/if}
{/snippet}

<div class="modal" role="dialog" aria-modal="true" aria-labelledby="item-title">
	<button class="scrim" aria-label="Close" onclick={onclose}></button>
	<div class="box">
		<header>
			<div class="titles">
				{#if item.project || cuts.length}<p class="meta">{[item.project, ...cuts].filter(Boolean).join(' · ')}</p>{/if}
				<h2 id="item-title">{item.title}</h2>
				{#if item.source}<p class="src">{item.source}</p>{/if}
			</div>
			<button class="x" aria-label="Close" onclick={onclose}>×</button>
		</header>

		<div class="state">
			<!-- the six steps: the card reaches them as its versions come in; a reached step can be looked at -->
			<ol class="steps">
				{#each statuses as s, i (s)}
					<li class:done={i < at} class:now={i === at}>
						<button class:viewing={s === view} disabled={i > at} onclick={() => (view = s)} aria-current={i === at ? 'step' : undefined}>{statusLabel(s)}</button>
					</li>
				{/each}
			</ol>
			{#if item.scheduled_at && (item.status === 'scheduled' || item.status === 'published')}
				<p class="when">{item.status === 'published' ? 'Went out' : 'Goes out'} <b>{dateLabel(item.scheduled_at)}</b></p>
			{/if}
		</div>

		<div class="content">
			{#if view === 'idea'}
				<!-- the swipe file: the idea -->
				{#if item.body?.trim() && item.status === 'idea'}
					<p class="idea">{item.body}</p>
				{:else}
					<p class="idea">{item.title}</p>
				{/if}
			{:else if view === 'hook'}
				<!-- the hook: the title cards, one per ratio -->
				<HookCards deliveries={item.deliveries ?? []} />
			{:else if view === 'draft'}
				<!-- the base article: the one source everything else derives from -->
				{@render theArticle()}
			{:else if view === 'derivatives'}
				<!-- every post derived from it, as its platform shows it: two by two, filtered by platform -->
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
					<p class="empty">No posts derived yet.</p>
				{/if}
			{:else}
				<!-- scheduled, published: the week it goes out in, one small summary per post -->
				{#if launch}
					<p class="launch">
						{view === 'published' ? 'Went out' : 'Launch'} <b>{dateLabel(launch.when)}</b> on
						{#each launch.entries as e, i (e.index)}{#if i}{i === launch.entries.length - 1 ? ' and ' : ', '}{/if}<span class="lp"><ChannelGlyph platform={e.post!.platform} /> {placeLabel(e.post!)}</span>{/each}
					</p>
				{/if}
				<ScheduleWeek {posts} when={item.scheduled_at} />
				{#if item.deliveries?.length}
					<details class="fold files">
						<summary>Files <small>{item.deliveries.length}</small></summary>
						<Deliveries deliveries={item.deliveries} />
					</details>
				{/if}
			{/if}
		</div>

		<footer>
			<button class="del" class:sure onclick={() => (sure ? ondelete() : (sure = true))} onblur={() => (sure = false)}>
				{sure ? 'Delete for good?' : 'Delete'}
			</button>
			<span class="grow"></span>
			<button class="quiet" onclick={onclose}>Close</button>
		</footer>
	</div>
</div>

<style>
	.modal {
		position: fixed;
		inset: 0;
		z-index: 60;
	}

	.scrim {
		position: absolute;
		inset: 0;
		border: 0;
		background: rgb(20 28 22 / 0.4);
	}

	/* almost the whole window, centred; only the middle scrolls */
	.box {
		position: absolute;
		top: 3vh;
		bottom: 3vh;
		left: 50%;
		display: flex;
		flex-direction: column;
		width: min(1400px, 96vw);
		transform: translateX(-50%);
		overflow: hidden;
		border-radius: 18px;
		background: var(--paper);
		box-shadow: 0 20px 60px rgb(38 56 44 / 0.25);
	}

	header,
	.state,
	footer {
		flex: none;
		padding-inline: 1.6rem;
	}

	header {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding-top: 1.3rem;
	}

	.titles {
		flex: 1;
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-size: clamp(1.5rem, 2.6vw, 2.1rem);
		line-height: 1.12;
		overflow-wrap: anywhere;
	}

	.meta {
		margin: 0 0 0.3rem;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.src {
		margin: 0.35rem 0 0;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.x {
		flex: none;
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 1.7rem;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
	}

	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1.4rem;
		padding-block: 0.9rem 1rem;
		border-bottom: 1px solid var(--line);
	}

	.when {
		margin: 0;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.when b {
		font-weight: 600;
		color: var(--ink);
	}

	/* ── the steps: where the card stands, and which version is on view ── */
	.steps {
		display: flex;
		flex: 1 1 26rem;
		gap: 0.25rem;
		max-width: 40rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.steps li {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font-size: 0.74rem;
		text-align: center;
		color: var(--muted);
	}

	.steps li.done {
		border-color: transparent;
		background: var(--cream);
		color: var(--ink-soft);
	}

	.steps li.now {
		border-color: var(--ink);
		background: var(--ink);
		font-weight: 600;
		color: var(--paper);
	}

	.steps li:has(button.viewing) {
		box-shadow: 0 0 0 2px var(--paper), 0 0 0 4px #e3b35c;
	}

	/* ── the content ── */
	.content {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2rem;
		padding: 1.6rem;
		overflow: auto;
		overscroll-behavior: contain;
	}

	.empty {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.idea {
		max-width: 46rem;
		margin: 1rem auto;
		font-family: var(--font-display);
		font-size: clamp(1.3rem, 2.2vw, 1.75rem);
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	/* the base article, set the way the journal sets it */
	/* the cover whole, as wide as the journal's film (its title card must not be cropped) */
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
		margin: 0.75rem 0 0;
		font-size: clamp(2.3rem, 5vw, 3.8rem);
	}

	.a-sub {
		margin: 1rem 0 0;
		font-family: var(--font-display);
		font-size: 1.4rem;
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

	.fold {
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
	}

	.fold summary {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.fold summary small {
		margin-left: 0.5rem;
		font-weight: 400;
		color: var(--muted);
	}

	.fold[open] summary {
		margin-bottom: 1rem;
	}


	/* "Launch Tue 29 Sep · 09:00 on YouTube, X Article and LinkedIn" */
	.launch {
		margin: -0.2rem 0 0.7rem;
		font-size: 0.85rem;
		line-height: 1.7;
		color: var(--ink-soft);
	}

	.launch b,
	.launch .lp {
		font-weight: 600;
		color: var(--ink);
	}

	.lp {
		white-space: nowrap;
	}

	/* ── delete and close ── */
	footer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding-block: 0.7rem;
		border-top: 1px solid var(--line);
	}

	.grow {
		flex: 1;
	}

	.del,
	.quiet {
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.del {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		color: #9c3b26;
	}

	.del.sure {
		background: #9c3b26;
		color: var(--paper);
	}

	.quiet {
		color: var(--ink-soft);
	}

	@media (max-width: 900px) {
	}

	@media (max-width: 600px) {
		.box {
			top: 0;
			bottom: 0;
			width: 100vw;
			border-radius: 0;
		}

		header,
		.state,
		footer,
		.content {
			padding-inline: 1rem;
		}
	}
	/* ── the steps: reached ones can be looked at ── */
	.steps button {
		width: 100%;
		padding: 0.3rem 0.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.steps button:disabled {
		cursor: default;
	}

	/* ── the derivatives, by platform ── */
	.ptabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0.4rem 0 1.2rem;
		border-bottom: 1px solid var(--line, #e3ddd0);
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
		color: var(--ink-soft, #6b6b62);
		cursor: pointer;
	}

	.ptabs button.on {
		border-bottom-color: var(--ink, #26382c);
		font-weight: 600;
		color: var(--ink, #26382c);
	}

	.ptabs span {
		font-weight: 400;
		opacity: 0.6;
	}
</style>
