<!--
	A vault's docs, in the layout every avenDB view has (./Frame.svelte) (Samuel 2026-10-18: the docs live in avenDB
	alone, not on the public site; every skill one item of them, picked on the left, its history on the right as in
	every other view). Each doc is a story tagged `doc` and its doc post (`post:doc`), both as an accepted AIP brings them
	(scripts/propose-doc.mjs, ./seed.js `docRecords`, ./docs.js): the skills of .claude/skills, the theOS paper and the
	avenDB and avenBRAIN architectures. On the left each doc by its section, with a search; in the middle the one picked
	(`#docs/` and its entry), its text as it reads on the line picked; on the right its history and versions
	(./Lines.svelte) and its outline. Edit opens its text as a note.
	Every doc is drawn from its vault's text alone, never from a page of the repository (Samuel 2026-10-20: docs are
	served from avenDB only), and nothing of it runs here: its text goes through the one Markdown engine, as an
	article's (./article.js: its own HTML shown as text, links only to the web, mail or this site, pictures only the
	vault's own files), and its diagrams are SVG files of the vault's Library, named by their hashes, each shown as a
	data URL in an image, where the browser runs no script of it and loads nothing, never as a page of this site, as
	the Library shows an SVG. Its maths (`$…$`, `$$…$$`: the paper's) the Markdown engine leaves as its LaTeX source, and
	the math host typesets after, off the page ($lib/sandbox/math-host.js: KaTeX in a worker of the shell, with no
	origin and no network), each formula's MathML drawn only as its checker passed it, element by element, never as
	HTML; until then, or where it can't, the source is what shows.
-->
<script>
	import { windowRead } from './ops.js';
	import { tick } from 'svelte';
	import { typesetIn } from '$lib/sandbox/math-host.js';
	import { DOC_PICTURE, fileNamed, pictures, render } from './article.js';
	import { readable } from './docs.js';
	import { dataUrl, mediaOf, whole } from './files.js';
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

	let noteWindow = $state.raw(/** @type {any} */ (null));
	$effect(() => {
		const window = api.window?.();
		noteWindow = window;
		return () => window?.close();
	});

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
	/** A doc's key, `skill/<name>`, `paper/theos`, `docs/avendb` or `docs/avenbrain`, from its post's tag `doc:<key>`. @param {string} story */
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

	/** what the `note` op reads of the doc picked: its lines and every edit */
	let note = $state(/** @type {any} */ (null));
	$effect(() => {
		const e = picked?.e.entry;
		note = null;
		line = null;
		if (!e) return;
		void world;
		if (api.window && !noteWindow) return;
		let gone = false;
		const request = windowRead(api, { op: 'note', entry: e }, null, noteWindow);
		request.result.then((/** @type {any} */ n) => { if (!gone) note = n; });
		return () => { gone = true; request.close(); };
	});
	/** the line whose text shows: main, or a proposal or variant picked on the right */
	let line = $state(/** @type {string | null} */ (null));
	let tab = $state('history');
	const onLine = $derived(note?.lines?.find((/** @type {any} */ l) => l.line === line) ?? note?.lines?.[0]);
	const text = $derived(/** @type {string} */ (onLine?.record?.text ?? /** @type {any} */ (picked?.e.record)?.text ?? ''));

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);
	/** the doc's pictures, by their names, once read: a diagram (an SVG) as a data URL, any other as a blob URL */
	let urls = $state(/** @type {Record<string, string>} */ ({}));
	const reading = new Set();
	$effect(() => {
		for (const name of pictures(text, DOC_PICTURE)) {
			const file = reading.has(name) ? undefined : fileNamed(world, vault, name)?.files?.[0];
			if (!file || file.len === null) continue;
			reading.add(name);
			whole(read, file, mediaOf({ name, type: '' }))
				.then((blob) => (name.endsWith('.svg') ? dataUrl(blob) : URL.createObjectURL(blob)))
				.then((url) => (urls = { ...urls, [name]: url }))
				.catch(() => reading.delete(name));
		}
	});
	$effect(() => () => Object.values(urls).forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)));
	const html = $derived(render((skill ? readable(text) : text).replace(/^\s*# .+\n+/, ''), (name) => urls[name] ?? '', DOC_PICTURE, { math: true }));

	/** @type {HTMLElement | undefined} */
	let body = $state();
	// its maths typeset once it is drawn, each formula's source swapped for its MathML (none: the source stays)
	$effect(() => {
		void [html, body];
		let gone = false;
		tick().then(() => {
			if (!gone && body) typesetIn(body).catch(() => {});
		});
		return () => {
			gone = true;
		};
	});

	/** @type {HTMLElement | undefined} */
	let article = $state();
	/** its headings as they are drawn, those of its own contents left out */
	let headings = $state.raw(/** @type {HTMLElement[]} */ ([]));
	$effect(() => {
		void [html, article];
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
	 * A link to a place in the doc scrolls to it: the address's `#` names avenDB's views, so it stays as it is.
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
			{#if seen.length}No doc in {nameOf(byId.get(vault))} yet. Each doc goes into Maia City as an AIP its owners
				accept.{:else}{nameOf(byId.get(actor))} sees nothing in {nameOf(byId.get(vault))}. A vault that owns it can
				share its docs in <button class="link" onclick={onaccess}>Sharing</button>.{/if}
		</p>
	{:else if picked}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<article class="doc" bind:this={article} onclick={within}>
			<p class="eyebrow soft">
				{skill ? 'Skill' : picked.key.startsWith('paper/') ? 'Paper' : 'Architecture'}{#if onLine && onLine.line !== null}
					· on “{onLine.name ?? 'a line'}”{/if}{#if note} · {count(note.edits?.length ?? 0, 'edit')}{/if}
			</p>
			<h1>{picked.key.split('/').at(-1) || picked.e.title}</h1>
			<p class="tools">
				<a class="btn" href="#stories/{picked.e.entry}/edit">Edit</a>
			</p>
			<div class="body" bind:this={body}>{@html html}</div>
		</article>
	{/if}
</Frame>

<style>
	.doc {
		max-width: 48rem;
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

	.body :global(figure) {
		margin: 1.6rem 0;
	}

	.body :global(figure img) {
		display: block;
		max-width: 100%;
		height: auto;
	}

	/* a diagram keeps a size its words read at: on a narrow screen it scrolls sideways */
	.body :global(figure:has(img[data-picture$='.svg'])) {
		overflow-x: auto;
	}

	.body :global(img[data-picture$='.svg']) {
		width: 100%;
		min-width: 40rem;
		max-width: none;
	}

	.body :global(figcaption) {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--soft);
	}

	/* maths: the browser's own MathML, in its own maths font, none loaded; a display formula centred on its line, and
	   sideways scroll where it is wider than the screen */
	.body :global(.math[data-math='display']) {
		display: block;
		margin: 1rem 0;
		overflow-x: auto;
		overflow-y: hidden;
		text-align: center;
	}

	.body :global(.math > math[display='block']) {
		margin: 0 auto;
		padding: 0.15rem 0;
	}

	/* a numbered formula (\tag): its number at the right edge, as KaTeX lays it out, in a table the full width of the
	   line (MathML Core reads no width attribute: the browser has to be told, and the frame round the table too) */
	.body :global(.math > math > semantics:has(> mtable[width='100%'])),
	.body :global(.math mtable[width='100%']) {
		width: 100%;
	}

	.body :global(.math mtd[width='50%']) {
		width: 50%;
	}

	/* a formula's source, until it is typeset or where it can't be */
	.body :global(.math:not(:has(> math))) {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.85em;
		color: var(--soft);
		white-space: pre-wrap;
	}

	.body :global(.math[data-math='inline']:not(:has(> math))::before),
	.body :global(.math[data-math='inline']:not(:has(> math))::after) {
		content: '$';
	}

	.body :global(.math[data-math='display']:not(:has(> math))::before),
	.body :global(.math[data-math='display']:not(:has(> math))::after) {
		content: '$$';
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
