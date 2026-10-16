<!--
	One artifact on a page of its own (`#artifacts/` and its entry, ./artifacts.js): one source fact, standing on its
	own. Its picture where a Library file it shows is one; what it is, its title, its link and the site it is on, whose
	it is where it isn't ours, when it was made, its language, a video's length, and our own words about it; the Library
	files it shows, each to take off or add; a video's chapters and its transcript, each row from a second; its tags,
	the auto tags `sparks` and `stories` among them; and the sparks whose canvas holds it, and the stories they grow
	into, with a new spark to put it on. A Library file is only bytes: what they are is said here. Each change is one op
	on its main line, for the acting vault, as the device allows it (`may`).
-->
<script>
	import { untrack } from 'svelte';
	import {
		clock,
		entryOf,
		IN_SPARKS,
		IN_STORIES,
		linkTo,
		LOOK_NAME,
		LOOKS,
		lookOf,
		sparksHolding,
		youtubeId,
		youtubePicture
	} from './artifacts.js';
	import { mediaOf } from './files.js';
	import Icon from './Icon.svelte';
	import { allowed, creatable, DELETED, may } from './ops.js';
	import { addingSpark, grownFrom, itemsFor, pictureOf, SPARK, sparkRecord } from './sparks.js';
	import { count, nameOf, signerName } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string }}
	 */
	let { world, actor, api, busy, entry } = $props();

	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const item = $derived(byId.get(entry));
	const record = $derived(/** @type {any} */ (item?.record) ?? {});
	const look = $derived(lookOf(item));
	const as = $derived(world.vaults.find((v) => v.id === actor));
	const files = $derived(/** @type {any[]} */ (record.files ?? []));
	const holding = $derived(sparksHolding(world, entry));
	const stories = $derived([
		...new Map(holding.flatMap((s) => grownFrom(world, s.entry).filter((g) => g.type === 'story')).map((g) => [g.entry, g])).values()
	]);
	const tags = $derived((item?.tags ?? []).filter((t) => !t.includes(':')));
	/** whether tag `t` is one avenDB's pages keep. @param {string} t */
	const auto = (t) => t === IN_SPARKS || t === IN_STORIES;
	const video = $derived(look === 'video' || look === 'youtube');
	/** whether its words carry times: a transcript's do, a text copied in as paragraphs doesn't */
	const timed = $derived((record.transcript ?? []).some((/** @type {any} */ r) => r.t > 0));

	/** whether the acting vault's ops let it change the artifact, as the device says */
	let changes = $state(false);
	let askedFile = $state(/** @type {string[] | null} */ (null));
	let askedSpark = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		if (!item) return;
		let gone = false;
		const probe = { op: 'set', entry, path: ['title'], value: item.title ?? '', as: actor };
		may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		creatable(api, actor, item.vault, 'file').then((t) => !gone && (askedFile = t));
		creatable(api, actor, item.vault, SPARK).then((t) => !gone && (askedSpark = t));
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	/** Runs change `op` on it as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry, as: actor });

	/** the fields as the person edits them, and as last shown: one they aren't editing follows what arrives */
	let f = $state({ title: '', url: '', site: '', byName: '', byUrl: '', platform: '', taken: '', language: '', duration: '', note: '' });
	/** @type {Record<string, string>} */
	let shown = {};
	$effect(() => {
		const now = /** @type {Record<string, string>} */ ({
			title: record.title ?? '',
			url: record.url ?? '',
			site: record.site ?? '',
			byName: record.by?.name ?? '',
			byUrl: record.by?.url ?? '',
			platform: record.by?.platform ?? '',
			taken: record.taken ?? '',
			language: record.language ?? '',
			duration: record.duration === undefined ? '' : String(record.duration),
			note: record.note ?? ''
		});
		untrack(() => {
			const at = /** @type {Record<string, string>} */ (f);
			for (const k of Object.keys(now)) if (shown[k] === undefined || at[k] === shown[k]) at[k] = now[k];
			shown = now;
		});
	});

	/** Sets field `field` to `value`, or takes it out where it is empty. @param {string} field @param {unknown} value */
	function put(field, value) {
		const empty = value === '' || value === null || (value && typeof value === 'object' && !Object.keys(value).length);
		const had = record[field];
		if (empty) return had === undefined ? null : change(`Clearing its ${field}`, { op: 'unset', path: [field] });
		if (JSON.stringify(had) === JSON.stringify(value)) return null;
		return change(`Changing its ${field}`, { op: 'set', path: [field], value });
	}

	/** Whose it is, as the fields read now: only those filled in. */
	const by = () =>
		Object.fromEntries(
			Object.entries({ name: f.byName.trim(), url: f.byUrl.trim(), platform: f.platform.trim() }).filter(([, v]) => v)
		);

	/** Seconds as typed: `612`, `10:12` or `1:02:03`; `null` for anything else. @param {string} t */
	function seconds(t) {
		const parts = t.trim().split(':').map(Number);
		if (!t.trim() || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
		return parts.reduce((s, n) => s * 60 + n, 0);
	}

	/** Adds files it shows, each into the Library first. @param {FileList | null} list */
	async function addFiles(list) {
		if (!item) return;
		for (const one of list ?? []) {
			const putIt = await api.putFile(actor, item.vault, one, mediaOf(one), askedFile ?? []);
			if (!putIt) return;
			await change(`Adding ${one.name} to it`, { op: 'insert', path: ['files'], value: linkTo(item.vault, putIt.entry) });
		}
	}

	/** the pictures of its files, by entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const l of files) {
			const id = entryOf(l);
			const file = byId.get(id);
			if (!file || pics[id]) continue;
			pictureOf(api, file).then((u) => !gone && u && (pics = { ...pics, [id]: u }));
		}
		return () => {
			gone = true;
		};
	});
	const cover = $derived(files.map((l) => pics[entryOf(l)]).find(Boolean) ?? youtubePicture(item?.record));

	/** A new chapter at the time typed. */
	let chapterAt = $state('');
	let chapterTitle = $state('');
	async function addChapter() {
		const t = seconds(chapterAt);
		if (t === null || !chapterTitle.trim()) return;
		const rows = /** @type {any[]} */ (record.chapters ?? []);
		const id = Math.max(0, ...rows.map((r) => r.id)) + 1;
		const at = rows.filter((r) => r.t <= t).length;
		const value = { id, t, title: chapterTitle.trim() };
		if (await change('Adding the chapter', { op: 'insert', path: ['chapters'], value, at })) [chapterAt, chapterTitle] = ['', ''];
	}

	/** A transcript as pasted: each line a row, from its time where it starts with one (`1:05 …`). */
	let pasted = $state('');
	async function saveTranscript() {
		let t = 0;
		const rows = pasted
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean)
			.map((l, i) => {
				const m = /^\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s+(.*)$/.exec(l);
				if (m) t = seconds(m[1]) ?? t;
				return { id: i + 1, t, text: m ? m[2] : l };
			});
		if (await change('Saving its transcript', { op: 'set', path: ['transcript'], value: rows })) pasted = '';
	}

	/** A new spark that holds it on its canvas, opened at once. */
	async function spark() {
		if (!item || askedSpark === null) return;
		const title = item.title || 'A new spark';
		const items = itemsFor([], [{ vault: item.vault, entry, what: 'artifact' }]);
		const made = await api.run(`Making “${title}”`, { ...addingSpark(item.vault, sparkRecord(title, '', items), askedSpark), as: actor });
		if (made) location.hash = `notes/${made.entry}`;
	}

	/** Deletes it, or with `back`, brings it back: a tag in its record, so every edit stays. @param {boolean} back */
	const remove = (back) =>
		change(back ? 'Bringing it back' : 'Deleting it', { op: back ? 'remove' : 'insert', path: ['tags'], value: DELETED });

	const yt = $derived(youtubeId(record.url ?? ''));
</script>

<div class="doc">
<div class="page">
	<a class="back" href="#artifacts"><Icon name="back" size={14} /> Artifacts</a>
	{#if !item}
		<p class="soft">This browser holds no such artifact, or can’t open it.</p>
	{:else}
		<header>
			<span class="icon {look}" aria-hidden="true">
				{#if cover}<img src={cover} alt="" />{:else}<Icon name={LOOKS.find(([l]) => l === look)?.[2] ?? 'artifact'} size={22} />{/if}
			</span>
			<div class="head">
				<input
					class="title"
					bind:value={f.title}
					disabled={!edits}
					aria-label="Its title"
					placeholder="Untitled"
					onchange={() => put('title', f.title.trim())}
				/>
				<small class="soft"
					>{LOOK_NAME[look]} · added by {signerName(world, item.by)}{record.duration ? ` · ${clock(record.duration)}` : ''}</small
				>
			</div>
		</header>

		{#if item.deleted}
			<p class="banner">
				This artifact is deleted: Artifacts lists it under Deleted, and every edit of it stays.
				{#if edits}<button class="btn" onclick={() => remove(true)}>Bring it back</button>{/if}
			</p>
		{/if}

		{#if cover}
			<img class="cover" src={cover} alt={item.title ?? ''} />
		{/if}

		<div class="looks" role="group" aria-label="What it is">
			{#each LOOKS as [l, , icon] (l)}
				<button class="chip" class:on={look === l} aria-pressed={look === l} disabled={!edits || look === l} onclick={() => put('look', l)}
					><Icon name={icon} size={12} /> {LOOK_NAME[l]}</button
				>
			{/each}
		</div>

		<div class="grid">
			<label class="wide">
				<span>Link</span>
				<span class="with">
					<input class="field" bind:value={f.url} placeholder="https://…" disabled={!edits} onchange={() => put('url', f.url.trim())} />
					{#if record.url}
						<a class="btn quiet" href={record.url} target="_blank" rel="noopener noreferrer" title="Open the link"><Icon name="out" size={14} /></a>
					{/if}
				</span>
			</label>
			<label>
				<span>Site</span>
				<input class="field" bind:value={f.site} placeholder="youtube.com" disabled={!edits} onchange={() => put('site', f.site.trim())} />
			</label>
			<label>
				<span>Made or published</span>
				<input class="field" bind:value={f.taken} placeholder="2026-10-16" disabled={!edits} onchange={() => put('taken', f.taken.trim())} />
			</label>
			<label>
				<span>Language</span>
				<input class="field" bind:value={f.language} placeholder="en, de, …" disabled={!edits} onchange={() => put('language', f.language.trim())} />
			</label>
			{#if video}
				<label>
					<span>Length</span>
					<input class="field" bind:value={f.duration} placeholder="10:12" disabled={!edits} onchange={() => put('duration', seconds(f.duration))} />
				</label>
			{/if}
		</div>

		<fieldset class="source">
			<legend>Whose it is <small class="soft">the source a story cites, where it isn’t ours</small></legend>
			<div class="grid three">
				<input class="field" bind:value={f.byName} placeholder="Name" aria-label="Whose it is: name" disabled={!edits} onchange={() => put('by', by())} />
				<input class="field" bind:value={f.platform} placeholder="Platform" aria-label="Its platform" disabled={!edits} onchange={() => put('by', by())} />
				<input class="field" bind:value={f.byUrl} placeholder="Their page" aria-label="Their page" disabled={!edits} onchange={() => put('by', by())} />
			</div>
		</fieldset>

		<label class="words">
			<span>Our words about it</span>
			<textarea class="field" rows="3" bind:value={f.note} disabled={!edits}></textarea>
			{#if f.note !== (record.note ?? '')}
				<span class="row">
					<button class="btn primary" disabled={!edits} onclick={() => put('note', f.note)}>Save</button>
					<button class="btn quiet" onclick={() => (f.note = record.note ?? '')}>Discard</button>
				</span>
			{/if}
		</label>

		<section class="part">
			<h4>Library files <small class="soft">the bytes it shows {files.length ? `· ${files.length}` : ''}</small></h4>
			<div class="files">
				{#each files as l (entryOf(l))}
					{@const id = entryOf(l)}
					{@const file = byId.get(id)}
					<span class="file">
						{#if pics[id]}<img src={pics[id]} alt="" />{:else}<span class="blank"><Icon name="file" size={20} /></span>{/if}
						<small>{file?.title ?? 'A file this browser doesn’t hold'}</small>
						{#if edits}
							<button class="x" aria-label="Take {file?.title ?? 'it'} off" onclick={() => change('Taking the file off', { op: 'remove', path: ['files'], value: l })}
								><Icon name="close" size={12} /></button
							>
						{/if}
					</span>
				{/each}
				{#if edits && askedFile !== null}
					<label class="file add">
						<span class="blank"><Icon name="upload" size={20} /></span>
						<small>Add files</small>
						<input type="file" multiple onchange={(e) => (addFiles(e.currentTarget.files), (e.currentTarget.value = ''))} />
					</label>
				{/if}
			</div>
		</section>

		{#if video || record.chapters?.length || record.transcript?.length}
			<section class="part">
				{#if video || record.chapters?.length}
				<h4>Chapters <small class="soft">{record.chapters?.length || ''}</small></h4>
				{#if record.chapters?.length}
					<ol class="times">
						{#each record.chapters as c (c.id)}
							<li>
								<span class="t">{clock(c.t)}</span>
								<span>{c.title}</span>
								{#if edits}
									<button class="x inline" aria-label="Take the chapter out" onclick={() => change('Taking the chapter out', { op: 'remove', path: ['chapters', { id: c.id }] })}
										><Icon name="close" size={11} /></button
									>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
				{#if edits}
					<form class="row" onsubmit={(e) => (e.preventDefault(), addChapter())}>
						<input class="field t" bind:value={chapterAt} placeholder="1:05" aria-label="From" />
						<input class="field" bind:value={chapterTitle} placeholder="A chapter" aria-label="The chapter’s title" />
						<button class="btn" disabled={seconds(chapterAt) === null || !chapterTitle.trim()}>Add</button>
					</form>
				{/if}
				{/if}

				<h4>{video ? 'Transcript' : 'Its words'} <small class="soft">{record.transcript?.length ? count(record.transcript.length, timed ? 'line' : 'paragraph') : ''}</small></h4>
				{#if record.transcript?.length}
					<ol class="times transcript" class:untimed={!timed}>
						{#each record.transcript as r (r.id)}
							<li>{#if timed}<span class="t">{clock(r.t)}</span>{/if}<span>{r.text}</span></li>
						{/each}
					</ol>
				{:else}
					<p class="soft">
						No transcript yet.{yt ? ' YouTube’s own comes with the next step; until then, paste it here.' : ''}
					</p>
				{/if}
				{#if edits}
					<textarea class="field" rows="3" bind:value={pasted} placeholder="Paste a transcript: a line each, times like 1:05 at their start"></textarea>
					{#if pasted.trim()}
						<span class="row">
							<button class="btn primary" onclick={saveTranscript}>{record.transcript?.length ? 'Replace the transcript' : 'Save the transcript'}</button>
						</span>
					{/if}
				{/if}
			</section>
		{/if}

		<section class="part">
			<h4>Tags</h4>
			{#if tags.length}
				<span class="tags">{#each tags as t (t)}<span class="chip tag" class:auto={auto(t)} title={auto(t) ? 'Kept by the page, from the sparks and stories that hold it' : undefined}>#{t}</span>{/each}</span>
			{:else}
				<p class="soft">None. It is tagged #{IN_SPARKS} once a spark holds it, and #{IN_STORIES} once a story grows from that spark.</p>
			{/if}
		</section>

		<section class="part">
			<h4>On sparks <small class="soft">{holding.length || ''}</small></h4>
			{#if holding.length}
				<span class="tags">
					{#each holding as s (s.entry)}<a class="chip" href="#notes/{s.entry}"><Icon name="spark" size={12} /> {s.title || 'Untitled'}</a>{/each}
					{#each stories as s (s.entry)}<a class="chip" href="#stories/{s.entry}"><Icon name="story" size={12} /> {s.title || 'A story'}</a>{/each}
				</span>
			{:else}
				<p class="soft">No spark holds it yet.</p>
			{/if}
			{#if askedSpark !== null}
				<button class="btn" disabled={busy} onclick={spark}><Icon name="spark" size={14} /> Put it on a new spark</button>
			{/if}
		</section>

		{#if edits && !item.deleted}
			<p class="foot"><button class="btn quiet danger" onclick={() => remove(false)}><Icon name="trash" size={14} /> Delete it</button></p>
		{/if}
		{#if !changes && !busy}
			<p class="soft">{nameOf(as)}’s share doesn’t let it change this artifact.</p>
		{/if}
	{/if}
</div>
</div>

<style>
	.doc {
		height: 100%;
		overflow-y: auto;
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		max-width: 46rem;
		margin: 0 auto;
		padding: 1rem 1rem calc(var(--nav-room, 5rem) + 1.5rem);
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--soft);
		font-size: 0.85rem;
		text-decoration: none;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.icon {
		display: grid;
		flex: none;
		place-items: center;
		overflow: hidden;
		width: 3rem;
		height: 3rem;
		border-radius: 12px;
		background: #e3eaf3;
		color: #2b3f63;
	}

	.icon img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.icon.video,
	.icon.youtube {
		background: #2a2f2c;
		color: #fff;
	}

	.icon.image {
		background: #e2ece7;
		color: var(--accent);
	}

	.head {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.title {
		width: 100%;
		padding: 0.15rem 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 1.3rem;
		font-weight: 700;
		outline: none;
	}

	.cover {
		width: 100%;
		max-height: 24rem;
		border-radius: 14px;
		object-fit: contain;
		background: #f1ede4;
	}

	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: #fbeee6;
		font-size: 0.85rem;
	}

	.looks,
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.looks .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.looks .chip.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr));
		gap: 0.6rem;
	}

	.grid .wide {
		grid-column: 1 / -1;
	}

	label,
	.words {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.8rem;
	}

	.with {
		display: flex;
		gap: 0.3rem;
	}

	.with .field {
		flex: 1;
		min-width: 0;
	}

	.source {
		margin: 0;
		padding: 0.6rem 0.7rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
	}

	.source legend {
		padding: 0 0.3rem;
		font-size: 0.8rem;
	}

	.three {
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 9rem), 1fr));
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.row .field {
		flex: 1;
		min-width: 0;
	}

	.row .field.t {
		flex: 0 0 5rem;
	}

	.part {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	h4 {
		margin: 0.3rem 0 0;
		font-size: 0.9rem;
	}

	h4 small {
		font-weight: 400;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.file {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 7rem;
		font-size: 0.72rem;
	}

	.file img,
	.blank {
		display: grid;
		place-items: center;
		width: 7rem;
		height: 5rem;
		border-radius: 10px;
		object-fit: cover;
		background: #f1ede4;
		color: #8a6a2f;
	}

	.file small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file.add {
		position: relative;
		cursor: pointer;
	}

	.file.add input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}

	.x {
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.9);
		cursor: pointer;
	}

	.x.inline {
		position: static;
		margin-left: auto;
	}

	.times {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.85rem;
	}

	.times li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}

	.times .t {
		flex: none;
		width: 3.4rem;
		color: var(--soft);
		font-variant-numeric: tabular-nums;
	}

	.transcript {
		max-height: 18rem;
		overflow: auto;
	}

	.transcript.untimed {
		gap: 0.6rem;
		line-height: 1.45;
	}

	.tags .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: inherit;
		text-decoration: none;
	}

	.chip.tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.chip.tag.auto {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.part .btn {
		display: inline-flex;
		align-items: center;
		align-self: flex-start;
		gap: 0.3rem;
	}

	.foot {
		margin: 0;
	}

	.danger {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: #a33a2a;
	}

	p {
		margin: 0;
		font-size: 0.85rem;
	}
</style>
