<!--
	A vault's docs, in the layout every avenDB view has (./Frame.svelte) (Samuel 2026-10-18: the docs live in avenDB
	alone, not on the public site; every skill one item of them, picked on the left, its history on the right as in
	every other view). Each doc is a story tagged `doc` and its doc post (`post:doc`), both as the seed writes them
	(./seed.js, ./docs.js): the skills of .claude/skills, the theOS paper and the avenDB architecture. On the left each
	doc by its section, with a search; in the middle the one picked (`#docs/` and its entry), its text as it reads on the
	line picked; on the right its history and versions (./Lines.svelte) and its outline. Edit opens its text as a note.
	The two docs that are pages of the site, the theOS paper and the avenDB architecture, show on main as their pages do,
	figures and all (Samuel 2026-10-19: the docs' own layout in the middle, avenDB's version control on the right), with
	their text a tab away; on another line, their text.
-->
<script>
	import { tick } from 'svelte';
	import { render } from './article.js';
	import { readable } from './docs.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import Lines from './Lines.svelte';
	import { postTag } from './posttypes.js';
	import { count, nameOf, reads } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, entry?: string,
	 *   onaccess: () => void }}
	 */
	let { world, vault, actor, api, entry = '', onaccess } = $props();

	const SECTIONS = /** @type {const} */ ([
		['paper', 'Paper'],
		['docs', 'Architecture'],
		['skill', 'Skills']
	]);

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const seen = $derived(world.entries.filter((e) => e.vault === vault && !e.deleted && reads(e, actor)));
	/** each doc post, by the story it is drawn from */
	const posts = $derived(
		new Map(
			seen
				.filter((e) => e.type === 'post' && (e.tags ?? []).includes(postTag('doc')))
				.map((e) => [/** @type {any} */ (e.record)?.story?.entry ?? '', e])
		)
	);
	/** A doc's key, `skill/<name>`, `paper/theos` or `docs/avendb`, from its post's tag `doc:<key>`. @param {string} story */
	const keyOf = (story) => (posts.get(story)?.tags ?? []).find((t) => t.startsWith('doc:'))?.slice(4) ?? '';
	const docs = $derived(
		seen
			.filter((e) => e.type === 'story' && (e.tags ?? []).includes('doc'))
			.map((e) => ({ e, key: keyOf(e.entry) }))
			.sort((a, b) => a.key.localeCompare(b.key))
	);

	let query = $state('');
	const shown = $derived(docs.filter((d) => !query.trim() || `${d.key} ${d.e.title}`.toLowerCase().includes(query.trim().toLowerCase())));
	const groups = $derived(
		[...SECTIONS.map(([at, name]) => ({ name, docs: shown.filter((d) => d.key.startsWith(`${at}/`)) })),
			{ name: 'Other', docs: shown.filter((d) => !SECTIONS.some(([at]) => d.key.startsWith(`${at}/`))) }].filter((g) => g.docs.length)
	);
	const picked = $derived(docs.find((d) => d.e.entry === entry) ?? docs[0]);
	const skill = $derived(!!picked?.key.startsWith('skill/'));
	const post = $derived(picked ? /** @type {any} */ (posts.get(picked.e.entry)?.record) : null);

	/** what the `note` op reads of the doc picked: its lines and every edit */
	let note = $state(/** @type {any} */ (null));
	$effect(() => {
		const e = picked?.e.entry;
		note = null;
		line = null;
		if (!e) return;
		void world;
		let gone = false;
		api.note(e).then(
			(/** @type {any} */ n) => !gone && (note = n ?? null),
			() => {}
		);
		return () => {
			gone = true;
		};
	});
	/** the line whose text shows: main, or a proposal or variant picked on the right */
	let line = $state(/** @type {string | null} */ (null));
	let tab = $state('history');
	const onLine = $derived(note?.lines?.find((/** @type {any} */ l) => l.line === line) ?? note?.lines?.[0]);
	const text = $derived(/** @type {string} */ (onLine?.record?.text ?? /** @type {any} */ (picked?.e.record)?.text ?? ''));
	const html = $derived(render((skill ? readable(text) : text).replace(/^\s*# .+\n+/, ''), () => ''));

	/** the docs that are pages of the site, each drawn here as its page draws it, by its key */
	const PAGES = /** @type {Record<string, () => Promise<{ default: any }>>} */ ({
		'paper/theos': () => import('$lib/theos/Paper.svelte'),
		'docs/avendb': () => import('$lib/docs/AvenDB.svelte')
	});
	/** the doc picked as its page, or as its text */
	let view = $state(/** @type {'page' | 'text'} */ ('page'));
	/** the page of the doc picked, once loaded, if it has one */
	let Page = $state.raw(/** @type {any} */ (null));
	$effect(() => {
		const load = picked ? PAGES[picked.key] : undefined;
		Page = null;
		if (!load) return;
		let gone = false;
		load().then(
			(m) => !gone && (Page = m.default),
			() => {}
		);
		return () => {
			gone = true;
		};
	});
	/** its page shows on main alone: a proposal or a variant reads as its text */
	const paged = $derived(!!picked && !!PAGES[picked.key] && view === 'page' && (onLine?.line ?? null) === null);

	/** @type {HTMLElement | undefined} */
	let article = $state();
	/** its headings as they are drawn, a page's or the text's, those of its own contents left out */
	let headings = $state.raw(/** @type {HTMLElement[]} */ ([]));
	$effect(() => {
		void [html, paged, Page, article];
		let gone = false;
		tick().then(() => {
			if (!gone) headings = [...(article?.querySelectorAll('h2, h3') ?? [])].filter((h) => !h.closest('nav')).map((h) => /** @type {HTMLElement} */ (h));
		});
		return () => {
			gone = true;
		};
	});
	// a section's number stays apart from its title, as the paper sets it in a span of its own
	const outline = $derived(headings.map((h) => ({ deep: h.tagName === 'H3', text: (h.textContent ?? '').replace(/^(\d+(?:\.\d+)*)(?=[^\s\d.])/, '$1 ').trim() })));
	/** A heading of the outline, by its place among the article's headings, brought into view. @param {number} i */
	const goTo = (i) => headings[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	/**
	 * A link to a place in the doc, as a page's contents and its references are, scrolls to it: the address's `#` names
	 * avenDB's views, so it stays as it is.
	 * @param {MouseEvent} e
	 */
	function within(e) {
		const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
		const id = decodeURIComponent(a?.getAttribute('href')?.slice(1) ?? '');
		const to = id ? article?.querySelector(`[id="${CSS.escape(id)}"]`) : null;
		if (!to) return;
		e.preventDefault();
		to.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
</script>

{#snippet list()}
	<input class="nav-search" type="search" placeholder="Search the docs…" bind:value={query} />
	{#each groups as g (g.name)}
		<h3 class="nav-group">{g.name}</h3>
		{#each g.docs as d (d.e.entry)}
			<a class="nav-item" class:on={d === picked} aria-current={d === picked ? 'page' : undefined} href="#docs/{d.e.entry}"
				><Icon name={g.name === 'Skills' ? 'article' : 'text'} size={16} /><span>{d.key.split('/').at(-1) || d.e.title}</span></a
			>
		{/each}
	{/each}
{/snippet}

{#snippet outlined()}
	<ol class="outline">
		{#each outline as h, i (i)}
			<li class:deep={h.deep}><button onclick={() => goTo(i)}>{h.text}</button></li>
		{:else}
			<li class="soft">No headings.</li>
		{/each}
	</ol>
{/snippet}

{#snippet side()}
	{#if picked}
		<Lines
			{world}
			{note}
			{line}
			bind:tab
			thing="the doc"
			onpick={(l) => (line = l)}
			tabs={[{ id: 'outline', label: 'Outline', icon: 'board', count: outline.length, body: outlined }]}
		/>
	{/if}
{/snippet}

<Frame nav={docs.length ? list : undefined} aside={picked ? side : undefined} navLabel="Every doc" navIcon="library" asideLabel="Its history, versions and outline">
	{#if !docs.length}
		<p class="soft empty">
			<Icon name="article" size={18} />
			{#if seen.length}No doc in {nameOf(byId.get(vault))} yet. The seed writes the skills, the theOS paper and the avenDB
				docs into Maia City.{:else}{nameOf(byId.get(actor))} sees nothing in {nameOf(byId.get(vault))}. A vault that owns it can
				share its docs in <button class="link" onclick={onaccess}>Sharing</button>.{/if}
		</p>
	{:else if picked}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<article class="doc" class:paged bind:this={article} onclick={within}>
			<p class="eyebrow soft" class:gone={paged}>
				{skill ? 'Skill' : picked.key.startsWith('paper/') ? 'Paper' : 'Architecture'}{#if onLine && onLine.line !== null}
					· on “{onLine.name ?? 'a line'}”{/if}{#if note} · {count(note.edits?.length ?? 0, 'edit')}{/if}
			</p>
			{#if !paged}<h1>{picked.key.split('/').at(-1) || picked.e.title}</h1>{/if}
			<p class="tools">
				<a class="btn" href="#stories/{picked.e.entry}/edit">Edit</a>
				{#if PAGES[picked.key] && (onLine?.line ?? null) === null}
					<span class="seg" role="group" aria-label="Show it as">
						<button class:on={view === 'page'} aria-pressed={view === 'page'} onclick={() => (view = 'page')}>Page</button>
						<button class:on={view === 'text'} aria-pressed={view === 'text'} onclick={() => (view = 'text')}>Text</button>
					</span>
				{/if}
				{#if post?.page}<a class="btn quiet" href={post.page} target="_blank" rel="noopener">Its live page</a>{/if}
			</p>
			{#if paged}
				{#if Page}<Page embedded />{:else}<p class="soft">Opening its page…</p>{/if}
			{:else}
				<div class="body">{@html html}</div>
			{/if}
		</article>
	{/if}
</Frame>

<style>
	.doc {
		max-width: 48rem;
	}

	/* a page of the site, drawn as it is there: as wide as the column, its own measure inside */
	.doc.paged {
		max-width: none;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--edge);
		border-radius: 999px;
		overflow: hidden;
	}

	.seg button {
		padding: 0.3rem 0.8rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.85rem;
		color: var(--soft);
		cursor: pointer;
	}

	.seg button.on {
		background: var(--edge);
		color: inherit;
	}

	/* a page names itself, so none over it */
	.eyebrow.gone {
		display: none;
	}

	.eyebrow {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0.3rem 0 0.6rem;
		font-size: clamp(1.8rem, 4vw, 2.6rem);
		overflow-wrap: anywhere;
	}

	.tools {
		display: flex;
		gap: 0.5rem;
		margin: 0 0 1.4rem;
	}

	.body {
		line-height: 1.6;
	}

	.body :global(pre) {
		overflow-x: auto;
		padding: 0.8rem 1rem;
		border-radius: 10px;
		background: rgb(0 0 0 / 0.05);
		font-size: 0.85rem;
	}

	.body :global(table) {
		display: block;
		overflow-x: auto;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.body :global(th),
	.body :global(td) {
		padding: 0.35rem 0.6rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		vertical-align: top;
	}

	.body :global(hr) {
		margin: 2.5rem 0 1rem;
		border: 0;
		border-top: 1px solid var(--edge);
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.outline {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}

	.outline button {
		padding: 0.25rem 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.outline button:hover {
		color: var(--accent);
	}

	.outline .deep {
		padding-left: 0.9rem;
		color: var(--soft);
	}
</style>
