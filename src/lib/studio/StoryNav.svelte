<!--
	The stories, on every tab, a thin aside on the left (Samuel 2026-10-18): each story the studio's timelines belong
	to (a cut's `story` link), its timelines under it, a click opening one; a new timeline of a story where the
	person can edit; the timelines of no story last. A legacy film coming into the Maia City vault (./legacyfilms.js)
	shows under its story as it comes: how many of its files are in, a bar for how far, and after, the files that
	could not come, or why it stopped, with Try again. Under the open timeline, its chapters (Samuel 2026-10-18):
	a click goes to one, a double click renames it, × removes it, + Chapter (or M) adds one at the playhead.
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	/** @typedef {import('$lib/auth/client').Timeline} Timeline */
	/** @param {Timeline} t */
	const storyOf = (t) => /** @type {any} */ (t).story?.entry ?? '';

	/** each story that has a timeline, by title, its timelines under it; then those of no story (or of a story gone) */
	const groups = $derived.by(() => {
		/** @type {Map<string, Timeline[]>} */
		const by = new Map();
		for (const t of s.timelines) by.set(storyOf(t), [...(by.get(storyOf(t)) ?? []), t]);
		for (const l of by.values()) l.sort((a, b) => (a.variant ?? a.name).localeCompare(b.variant ?? b.name, undefined, { numeric: true }));
		const known = s.stories.filter((x) => by.has(x.id) || s.films[x.title]).map((x) => ({ story: x, list: by.get(x.id) ?? [] }));
		// a film whose story isn't read yet: its name, as its story will be called
		const coming = Object.keys(s.films).filter((n) => !known.some((g) => g.story.title === n));
		const rest = [...by.entries()].filter(([id]) => !s.stories.some((x) => x.id === id)).flatMap(([, l]) => l);
		return { known, coming, rest };
	});

	/** whether a story's timelines are folded away: open unless folded, and always where the open timeline is */
	const folded = (/** @type {string} */ id) => s.expanded.includes(`fold:${id}`) && !s.timelines.some((t) => t.id === s.current?.id && storyOf(t) === id);

	/** the chapter being renamed, and its name as typed */
	let naming = $state(/** @type {number | null} */ (null));
	let typed = $state('');
	/** @param {import('$lib/auth/client').Chapter} c */
	function rename(c) {
		if (!s.canEdit) return;
		naming = c.id;
		typed = c.name;
	}
	function named() {
		if (naming !== null && typed.trim()) s.editChapter(naming, { name: typed.trim() });
		naming = null;
	}
	/** @param {HTMLInputElement} el */
	const focusIt = (el) => (el.focus(), el.select());

	/** @param {Timeline} t */
	async function pick(t) {
		if (t.id !== s.current?.id) await s.openTimeline(t);
	}
</script>

{#snippet film(/** @type {string} */ name)}
	{@const f = s.films[name]}
	{#if f}
		<div class="film" class:bad={!!f.error}>
			{#if f.coming}
				<span class="line">Coming in · {f.line}</span>
				{#if f.total}<span class="bar"><i style:width="{Math.round(((f.done + f.part) / f.total) * 100)}%"></i></span>{/if}
			{:else if f.error}
				<span class="line" title={f.error}>Stopped: {f.error}</span>
				<button class="again" disabled={!!s.importing} onclick={() => s.bringFilms()}>Try again</button>
			{:else if f.failed.length}
				<span class="line" title={f.failed.map((x) => `${x.hash.slice(0, 12)}…: ${x.error}`).join('\n')}>{f.failed.length} {f.failed.length === 1 ? 'file' : 'files'} not in the old vault on this Mac</span>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet row(/** @type {Timeline} */ t)}
	<li class="row" class:on={s.current?.id === t.id}>
		<button class="open" onclick={() => pick(t)} title={t.description || t.name}>
			<span class="nm">{t.name}</span>
			{#if t.variant}<span class="vr">{t.variant}</span>{/if}
		</button>
		<button class="x" onclick={() => s.removeTimeline(t)} aria-label="Delete {t.name}" title="Delete">×</button>
	</li>
	{#if s.current?.id === t.id}
		<li class="chapters">
			<ol>
				{#each s.chapters as c (c.id)}
					<li class="chapter" class:on={s.chapterAt()?.id === c.id}>
						{#if naming === c.id}
							<input class="name" bind:value={typed} use:focusIt onblur={named} onkeydown={(e) => (e.stopPropagation(), e.key === 'Enter' ? named() : e.key === 'Escape' && (naming = null))} aria-label="Chapter name" />
						{:else}
							<button class="go" onclick={() => s.seek(c.at)} ondblclick={() => rename(c)} title="Go to {c.name}{s.canEdit ? '; double click to rename' : ''}">
								<span class="at">{clockText(c.at)}</span><span class="nm">{c.name}</span>
							</button>
							{#if s.canEdit}<button class="x" onclick={() => s.removeChapter(c.id)} aria-label="Remove {c.name}" title="Remove">×</button>{/if}
						{/if}
					</li>
				{/each}
			</ol>
			{#if s.canEdit}<button class="chapter-add" onclick={() => s.addChapter()} title="A chapter at the playhead (M)">+ Chapter</button>{/if}
		</li>
	{/if}
{/snippet}

<nav class="stories" aria-label="Stories and their timelines">
	<h3>Stories</h3>
	<div class="list">
		{#each groups.coming as name (name)}
			<section>
				<header><span class="story plain">{name}</span></header>
				{@render film(name)}
			</section>
		{/each}
		{#each groups.known as g (g.story.id)}
			<section>
				<header>
					<button class="story" onclick={() => s.expand(`fold:${g.story.id}`)} aria-expanded={!folded(g.story.id)} title={g.story.title}>
						<span class="caret">{folded(g.story.id) ? '▸' : '▾'}</span>{g.story.title}
					</button>
					<button class="add" onclick={() => s.newTimeline(g.story)} title="A new timeline of {g.story.title}" aria-label="New timeline of {g.story.title}">+</button>
				</header>
				{@render film(g.story.title)}
				{#if !folded(g.story.id)}
					<ul>{#each g.list as t (t.id)}{@render row(t)}{/each}</ul>
				{/if}
			</section>
		{/each}
		{#if groups.rest.length}
			<section>
				<header><span class="story plain">No story</span></header>
				<ul>{#each groups.rest as t (t.id)}{@render row(t)}{/each}</ul>
			</section>
		{/if}
		{#if !s.timelines.length && !Object.keys(s.films).length}<p class="none">No timelines yet.</p>{/if}
	</div>
	<button class="new" onclick={() => s.newTimeline()}>+ New timeline</button>
</nav>

<style>
	.stories {
		grid-area: nav;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-height: 0;
		padding: 0.7rem 0.45rem 0.6rem;
		background: var(--chrome);
		font-size: 0.76rem;
	}

	h3 {
		margin: 0 0.35rem;
		font-family: var(--font-body);
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.film {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.1rem 0.35rem 0.25rem 1.15rem;
		font-size: 0.68rem;
		color: var(--dim);
	}

	.film.bad .line {
		color: var(--bad);
	}

	.line {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar {
		height: 3px;
		border-radius: 2px;
		background: var(--hover);
		overflow: hidden;
	}

	.bar i {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 200ms;
	}

	.again {
		align-self: flex-start;
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		color: var(--ink);
		cursor: pointer;
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	section + section {
		margin-top: 0.35rem;
	}

	header {
		display: flex;
		align-items: center;
	}

	.story {
		flex: 1;
		min-width: 0;
		padding: 0.2rem 0.35rem;
		border: 0;
		background: none;
		font: inherit;
		font-weight: 600;
		text-align: left;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.story.plain {
		color: var(--dim);
		cursor: default;
	}

	.caret {
		display: inline-block;
		width: 0.8rem;
		color: var(--dim);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		border-radius: 6px;
	}

	.row:hover {
		background: var(--hover);
	}

	.row.on {
		background: var(--chosen);
	}

	.open {
		display: flex;
		flex: 1;
		gap: 0.3rem;
		align-items: baseline;
		min-width: 0;
		padding: 0.22rem 0.35rem 0.22rem 1.15rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.vr {
		flex: none;
		font-size: 0.64rem;
		color: var(--dim);
	}

	.x,
	.add {
		flex: none;
		width: 1.3rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--dim);
		cursor: pointer;
	}

	.x {
		visibility: hidden;
	}

	.row:hover .x {
		visibility: visible;
	}

	.add:hover,
	.x:hover {
		color: var(--ink);
	}

	.chapters {
		margin: 0.1rem 0 0.3rem 1.15rem;
	}

	ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chapter {
		display: flex;
		align-items: center;
		border-radius: 6px;
	}

	.chapter:hover {
		background: var(--hover);
	}

	.chapter.on .go {
		color: var(--ink);
	}

	.go {
		display: flex;
		flex: 1;
		gap: 0.35rem;
		align-items: baseline;
		min-width: 0;
		padding: 0.15rem 0.35rem;
		border: 0;
		border-left: 2px solid var(--accent);
		background: none;
		font: inherit;
		font-size: 0.7rem;
		text-align: left;
		color: var(--dim);
		cursor: pointer;
	}

	.at {
		flex: none;
		font-variant-numeric: tabular-nums;
		font-size: 0.62rem;
	}

	.chapter:hover .x {
		visibility: visible;
	}

	.name {
		flex: 1;
		min-width: 0;
		padding: 0.1rem 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: var(--raised);
		font: inherit;
		font-size: 0.7rem;
		color: var(--ink);
	}

	.chapter-add {
		margin: 0.15rem 0.35rem 0;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.68rem;
		color: var(--dim);
		cursor: pointer;
	}

	.chapter-add:hover {
		color: var(--ink);
	}

	.none {
		margin: 0.3rem 0.35rem;
		color: var(--dim);
	}

	.new {
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.72rem;
		color: var(--dim);
		cursor: pointer;
	}
</style>
