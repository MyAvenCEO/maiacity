<!--
	A story's Writing tab (./Story.svelte): its article, an entry of its own beside the story (avendb's `article` schema,
	v2), which links the story (`story`): the base long text everything else is cut from, a film's voice-over script.
	The article reads as the journal lays it out and is edited where it stands (./ArticleView.svelte), saved on its main
	line; above it what used to be a frontmatter, its language, its excerpt and the quote it carries, each a field of
	its record. Its variants, a German one or a shorter one, are variants of it (the `variant` op): each a whole
	article of its own that names the one it came from and links the same story, shown here side by side. Proposals,
	an agent's above all, and the history of every edit are the article editor's (Note), a click away, whose back arrow
	comes back here. A story with no article yet starts one from its journey: the question it holds open as the
	subtitle, a heading for each beat with the beat's lines under it.
-->
<script>
	import { untrack } from 'svelte';
	import ArticleView from './ArticleView.svelte';
	import { entryOf } from './artifacts.js';
	import { CONTENT, flowsFor, stageOf, stageTag } from './flows.js';
	import { allowed, creatable, may } from './ops.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world, actor, api, busy, item } = $props();

	const ARTICLE = 'article';
	/** The languages an article is usually in, by their codes. */
	const LANGUAGES = /** @type {const} */ ([
		['en', 'English'],
		['de', 'Deutsch'],
		['es', 'Español'],
		['fr', 'Français']
	]);
	/** A language's name, by its code. @param {string | undefined} code */
	const languageOf = (code) => LANGUAGES.find(([c]) => c === code)?.[1] ?? code ?? '';

	const story = $derived(/** @type {any} */ (item.record) ?? {});
	/** the story's articles, the one written first before its variants, each in the order it was made */
	const articles = $derived(
		world.entries
			.filter((e) => e.type === ARTICLE && !e.deleted && entryOf(/** @type {any} */ (e.record)?.story) === item.entry)
			.sort((a, b) => (a.variantOf ? 1 : 0) - (b.variantOf ? 1 : 0) || (a.created ?? 0) - (b.created ?? 0))
	);
	const main = $derived(articles[0]);
	let picked = $state('');
	const shown = $derived(articles.find((a) => a.entry === picked) ?? main);
	const record = $derived(/** @type {any} */ (shown?.record) ?? {});

	/** what a chip calls article `a`: its language, and what its title adds to the main one's @param {any} a */
	function chip(a) {
		const lang = languageOf(a.record?.language) || 'Article';
		const extra = main && a.entry !== main.entry && (a.title ?? '').startsWith(main.title ?? '') ? (a.title ?? '').slice((main.title ?? '').length) : '';
		const more = extra.replace(/^[\s·:–-]+/, '').trim();
		return more && more !== lang ? `${lang} · ${more}` : lang;
	}

	/** the flow its article goes through, the stage it is in */
	const flow = $derived(flowsFor(world, item.vault, ARTICLE)[0] ?? CONTENT);
	const stage = $derived(shown ? stageOf(shown, flow) : null);

	/** the tags the acting vault's caps ask a new article to carry: `null` where nothing lets it write one, `undefined`
	 *  while the device is asked */
	let asked = $state(/** @type {string[] | null | undefined} */ (undefined));
	/** whether it may change the article shown, and make a variant of it, as the device answers a dry run */
	let can = $state({ write: false, variant: false });
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, item.vault, ARTICLE).then((t) => !gone && (asked = t));
		if (shown) {
			const write = { op: 'set', entry: shown.entry, path: ['title'], value: shown.title ?? '' };
			const variant = { op: 'variant', entry: shown.entry, into: shown.vault };
			may(api, actor, [write, variant]).then(([w, v]) => {
				if (!gone) can = { write: allowed(w), variant: allowed(v) };
			});
		}
		return () => {
			gone = true;
		};
	});
	const edits = $derived(!!shown && (shown.writers ?? []).includes(actor) && can.write && !busy);

	/** the article's proposals, as its note's lines name them */
	let proposals = $state(/** @type {{ line: string, name: string | null }[]} */ ([]));
	$effect(() => {
		void world;
		const e = shown?.entry;
		if (!e) return void (proposals = []);
		let gone = false;
		api.note(e).then(
			(/** @type {any} */ n) => !gone && (proposals = (n?.lines ?? []).slice(1)),
			() => {}
		);
		return () => {
			gone = true;
		};
	});

	/** what the person has written of each article and not saved yet, by its entry */
	let drafts = $state(/** @type {Record<string, string>} */ ({}));
	let titles = $state(/** @type {Record<string, string>} */ ({}));
	const k = $derived(shown?.entry ?? '');
	const unsaved = $derived(!!shown && drafts[k] !== undefined && drafts[k] !== (shown.text ?? ''));

	/** Runs change `op` on the article shown, on its main line, as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry: k, as: actor });

	async function save() {
		if (!unsaved) return;
		await change('Saving the article', { op: 'set', path: ['text'], value: drafts[k] });
	}

	async function retitle() {
		const title = (titles[k] ?? '').trim();
		if (!shown || !title || title === (shown.title ?? '')) return;
		await change('Renaming the article', { op: 'set', path: ['title'], value: title });
	}

	/** Sets field `field` of the article to `value`, where it changed; a blank one is taken out. @param {string} field
	 *  @param {string} value */
	function put(field, value) {
		if ((record[field] ?? '') === value) return;
		return change(`Changing its ${field}`, value ? { op: 'set', path: [field], value } : { op: 'unset', path: [field] });
	}

	/** Sets the quote's words or whose they are to `value`; a quote left with neither is taken out.
	 *  @param {'text' | 'by'} part @param {string} value */
	function quote(part, value) {
		const q = { ...(record.quote ?? {}), [part]: value };
		if (!value) delete q[part];
		if (JSON.stringify(q) === JSON.stringify(record.quote ?? {})) return;
		return change('Changing its quote', Object.keys(q).length ? { op: 'set', path: ['quote'], value: q } : { op: 'unset', path: ['quote'] });
	}

	/** The article a story starts with: its title, the question it holds open as the subtitle, a heading per beat. */
	function starter() {
		const beats = /** @type {any[]} */ (story.beats ?? []);
		const lines = [];
		if (story.question?.trim()) lines.push(`*${story.question.trim()}*`);
		for (const b of beats) {
			if (b.title?.trim()) lines.push(`## ${b.title.trim()}`);
			if (b.text?.trim()) lines.push(b.text.trim());
		}
		return lines.join('\n\n');
	}

	async function start() {
		const value = {
			kind: ARTICLE,
			title: story.title || item.title || 'Untitled',
			text: starter(),
			story: { vault: item.vault, entry: item.entry },
			language: 'en',
			tags: []
		};
		const tags = [...(asked ?? []), stageTag(flow.key, 'draft')];
		const made = await api.run('Starting its article', { op: 'create', vault: item.vault, type: ARTICLE, tags, value, as: actor });
		if (made?.entry) picked = made.entry;
	}

	/** Makes a variant of the main article in language `lang`, its title marked `mark`. @param {string} lang
	 *  @param {string} mark */
	async function variant(lang, mark) {
		if (!main) return;
		const ops = [
			{ op: 'set', path: ['title'], value: `${main.title ?? ''} · ${mark}` },
			{ op: 'set', path: ['language'], value: lang }
		];
		const made = await api.run(`Making a ${mark} variant`, { op: 'variant', entry: main.entry, into: main.vault, ops, as: actor });
		if (made?.entry) picked = made.entry;
	}
	let other = $state('');
</script>

{#if !main}
	<div class="blank">
		<p>
			No article yet. The article is the story’s base text, written out: the voice-over of a film, the post on the blog,
			what every piece cut from it later goes back to.
		</p>
		{#if asked}
			<button class="btn primary" disabled={busy} onclick={start}>Start its article from the journey</button>
			<p class="soft">
				{(story.beats ?? []).length
					? `Its question as the subtitle and a heading for each of its ${(story.beats ?? []).length} beats.`
					: 'Its journey has no beats yet: it starts blank.'}
			</p>
		{:else if asked === null}
			<p class="soft">The acting vault may not write articles here.</p>
		{/if}
	</div>
{:else if shown}
	<div class="writing">
		<div class="bar">
			<span class="chips" role="tablist" aria-label="The article and its variants">
				{#each articles as a (a.entry)}
					<button class="pick" class:on={a.entry === shown.entry} role="tab" aria-selected={a.entry === shown.entry} onclick={() => (picked = a.entry)}>
						{chip(a)}{#if a.variantOf}<small>variant</small>{/if}
					</button>
				{/each}
			</span>
			{#if can.variant && shown.entry === main.entry && !busy}
				<span class="adds">
					{#if !articles.some((a) => a.record?.language === 'de')}<button class="btn quiet" onclick={() => variant('de', 'Deutsch')}>+ German</button>{/if}
					<button class="btn quiet" onclick={() => variant(main.record?.language ?? 'en', 'Short')}>+ Shorter</button>
					<input class="other" bind:value={other} placeholder="Another variant…" aria-label="Another variant, by its name" onkeydown={(e) => e.key === 'Enter' && other.trim() && variant(main.record?.language ?? 'en', other.trim()).then(() => (other = ''))} />
				</span>
			{/if}
			<span class="grow"></span>
			<span class="soft">{stage?.name ?? 'No stage'}</span>
			<a class="btn" href="#articles/{shown.entry}/edit/{item.entry}">Proposals and history</a>
		</div>

		{#if proposals.length}
			<p class="proposed">
				{#each proposals as p, i (p.line)}{#if i}, {/if}<b>“{p.name ?? 'A proposal'}”</b>{/each}
				{proposals.length === 1 ? 'proposes changes' : 'propose changes'} to it:
				<a href="#articles/{shown.entry}/edit/{item.entry}">read and merge {proposals.length === 1 ? 'it' : 'them'}</a>.
			</p>
		{/if}

		<!-- open where it has no excerpt yet, as it opens: writing one doesn't close it -->
		{#key shown.entry}
		<details class="front" open={untrack(() => !record.excerpt)}>
			<summary>Its details <span class="soft">language, excerpt, quote</span></summary>
			<div class="fields">
				<label>
					<span>Language</span>
					<select value={record.language ?? ''} disabled={!edits} onchange={(e) => put('language', e.currentTarget.value)}>
						<option value="">—</option>
						{#each LANGUAGES as [code, name] (code)}<option value={code}>{name}</option>{/each}
						{#if record.language && !LANGUAGES.some(([c]) => c === record.language)}<option value={record.language}>{record.language}</option>{/if}
					</select>
				</label>
				<label>
					<span>Excerpt <small>what a list or a share shows of it, where its opening words won’t do</small></span>
					<textarea rows="2" value={record.excerpt ?? ''} disabled={!edits} onchange={(e) => put('excerpt', e.currentTarget.value.trim())}></textarea>
				</label>
			</div>
			<div class="fields quote">
				<label>
					<span>Quote <small>words it carries, someone’s or our own</small></span>
					<textarea rows="2" value={record.quote?.text ?? ''} disabled={!edits} onchange={(e) => quote('text', e.currentTarget.value.trim())}></textarea>
				</label>
				<label>
					<span>Whose words</span>
					<input value={record.quote?.by ?? ''} disabled={!edits} onchange={(e) => quote('by', e.currentTarget.value.trim())} />
				</label>
			</div>
		</details>
		{/key}

		{#if unsaved}
			<div class="save">
				<b>Unsaved changes</b>
				<button class="btn primary" disabled={busy} onclick={save}>Save</button>
				<button class="btn quiet" onclick={() => delete drafts[k]}>Discard</button>
			</div>
		{/if}

		<div class="page">
			{#key shown.entry}
				<ArticleView
					{world}
					{api}
					item={shown}
					bind:title={() => titles[k] ?? shown?.title ?? '', (v) => (titles[k] = v)}
					bind:text={() => drafts[k] ?? shown?.text ?? '', (v) => (drafts[k] = v)}
					editable={edits}
					renames={edits}
					eyebrow={stage?.name ?? 'Article'}
					onretitle={retitle}
					onsave={save}
				/>
			{/key}
		</div>
	</div>
{/if}

<style>
	.blank {
		padding: 2rem 1.5rem;
		border: 1px dashed var(--edge);
		border-radius: 14px;
		text-align: center;
	}

	.blank p {
		max-width: 34rem;
		margin: 0 auto 1rem;
	}

	.writing {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.chips,
	.adds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.pick {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.pick.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.pick small {
		font-size: 0.68rem;
		opacity: 0.75;
	}

	.other {
		width: 10rem;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		font: inherit;
		font-size: 0.82rem;
	}

	.grow {
		flex: 1;
	}

	.proposed {
		margin: 0;
		padding: 0.6rem 0.9rem;
		border: 1px dashed var(--edge);
		border-radius: 10px;
		background: #fbfaf6;
		font-size: 0.86rem;
	}

	.front {
		padding: 0.6rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.front summary {
		font-weight: 600;
		cursor: pointer;
	}

	.front summary .soft {
		margin-left: 0.4rem;
		font-weight: 400;
		font-size: 0.82rem;
	}

	.fields {
		display: grid;
		grid-template-columns: minmax(0, 12rem) minmax(0, 1fr);
		gap: 0.7rem 1rem;
		margin-top: 0.8rem;
	}

	.fields.quote {
		grid-template-columns: minmax(0, 1fr) minmax(0, 12rem);
	}

	.fields label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.fields small {
		font-weight: 400;
		opacity: 0.7;
	}

	.fields input,
	.fields select,
	.fields textarea {
		box-sizing: border-box;
		width: 100%;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 400;
	}

	.fields textarea {
		resize: vertical;
	}

	.save {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.8rem;
		border-radius: 10px;
		background: #fff6e0;
		font-size: 0.86rem;
	}

	.page {
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		overflow: hidden;
	}

	@media (max-width: 640px) {
		.fields,
		.fields.quote {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
