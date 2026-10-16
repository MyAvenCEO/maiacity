<!--
	A spark's own fields, over its text on its page (Note), on the line shown (./sparks.js): what it is, its link,
	whose it is where it isn't ours (the source a story cites), its language, a video's or a podcast's words, its
	Library files, and the sparks it gathers, a mood board's; then the stories and mood boards that grow from it, and a
	story to start from it. Each change is one op on that line, for the acting vault, as the device allows it (`may`).
-->
<script>
	import { untrack } from 'svelte';
	import { mediaOf } from './files.js';
	import Icon from './Icon.svelte';
	import { allowed, creatable, may } from './ops.js';
	import SparkCard from './SparkCard.svelte';
	import { addingStory, grownFrom, isSpark, LOOK_NAME, LOOKS, pictureOf } from './sparks.js';
	import { nameOf, reads } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string,
	 *   vault: string, line: string | null, record: any, writes: boolean }}
	 */
	let { world, actor, api, busy, entry, vault, line, record, writes } = $props();

	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const as = $derived(world.vaults.find((v) => v.id === actor));
	const look = $derived(/** @type {import('./sparks.js').Look} */ (record?.look ?? 'thought'));
	const files = $derived(/** @type {string[]} */ (record?.files ?? []));
	const members = $derived(/** @type {string[]} */ (record?.sparks ?? []));
	const grows = $derived(grownFrom(world, entry));
	/** the sparks of its vault it may gather besides those it does: not itself */
	const others = $derived(
		world.entries.filter(
			(e) => e.vault === vault && isSpark(e) && !e.deleted && reads(e, actor) && e.entry !== entry && !members.includes(e.entry)
		)
	);

	/** whether the ops of the acting vault's caps let it change the spark's fields on the line, as the device says */
	let changes = $state(false);
	/** the tags a new story and a new file must carry: `null` where nothing lets it add one */
	let askedStory = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		const ask = { op: 'set', entry, line, path: ['look'], value: look };
		if (writes) may(api, actor, [ask]).then(([a]) => !gone && (changes = allowed(a)));
		else changes = false;
		creatable(api, actor, vault, 'story').then((t) => !gone && (askedStory = t));
		creatable(api, actor, vault, 'file').then((t) => !gone && (askedFile = t));
		return () => {
			gone = true;
		};
	});

	/** the fields as the person edits them, and as last shown: one they aren't editing follows what arrives */
	let f = $state({ url: '', byName: '', byUrl: '', platform: '', language: '', transcript: '' });
	/** @type {Record<string, string>} */
	let shown = {};
	$effect(() => {
		const now = /** @type {Record<string, string>} */ ({
			url: record?.url ?? '',
			byName: record?.by?.name ?? '',
			byUrl: record?.by?.url ?? '',
			platform: record?.by?.platform ?? '',
			language: record?.language ?? '',
			transcript: record?.transcript ?? ''
		});
		untrack(() => {
			const at = /** @type {Record<string, string>} */ (f);
			for (const k of Object.keys(now)) if (shown[k] === undefined || at[k] === shown[k]) at[k] = now[k];
			shown = now;
		});
	});

	/** Runs change `op` on the line as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry, line, as: actor });

	/** Sets field `field` to `value`, or takes it out where it is empty. @param {string} field @param {unknown} value */
	function put(field, value) {
		const empty = value === '' || (value && typeof value === 'object' && !Object.keys(value).length);
		const had = record?.[field];
		if (empty) return had === undefined ? null : change(`Clearing its ${field}`, { op: 'unset', path: [field] });
		if (JSON.stringify(had) === JSON.stringify(value)) return null;
		return change(`Changing its ${field}`, { op: 'set', path: [field], value });
	}

	/** Whose it is, as the fields read now: only those filled in. */
	const by = () =>
		Object.fromEntries(
			Object.entries({ name: f.byName.trim(), url: f.byUrl.trim(), platform: f.platform.trim() }).filter(([, v]) => v)
		);

	/** Adds files to it, each into the Library first. @param {FileList | null} list */
	async function addFiles(list) {
		for (const one of list ?? []) {
			const put = await api.putFile(actor, vault, one, mediaOf(one), askedFile ?? []);
			if (!put) return;
			await change(`Adding ${one.name} to it`, { op: 'insert', path: ['files'], value: put.entry });
		}
	}

	let adding = $state('');

	/** A story that grows from it, opened at once. */
	async function story() {
		if (!askedStory) return;
		const title = record?.title || 'A new story';
		const op = { ...addingStory(world, vault, title, [entry], askedStory), as: actor };
		const made = await api.run(`Starting “${title}”`, op);
		if (made) location.hash = `stories/${made.entry}`;
	}

	/** the pictures of its files, by entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const id of files) {
			const file = byId.get(id);
			if (!file || pics[id]) continue;
			pictureOf(api, file).then((u) => !gone && u && (pics = { ...pics, [id]: u }));
		}
		return () => {
			gone = true;
		};
	});

	const edits = $derived(changes && !busy);
</script>

<section class="fields" aria-label="The spark’s fields">
	<div class="looks" role="group" aria-label="What it is">
		{#each LOOKS as [l, , icon] (l)}
			<button
				class="chip"
				class:on={look === l}
				aria-pressed={look === l}
				disabled={!edits || look === l}
				onclick={() => put('look', l)}><Icon name={icon} size={12} /> {LOOK_NAME[l]}</button
			>
		{/each}
	</div>

	<div class="grid">
		<label>
			<span>Link</span>
			<span class="with">
				<input class="field" bind:value={f.url} placeholder="https://…" disabled={!edits} onchange={() => put('url', f.url.trim())} />
				{#if record?.url}
					<a class="btn quiet" href={record.url} target="_blank" rel="noopener noreferrer" title="Open the link"
						><Icon name="out" size={14} /></a
					>
				{/if}
			</span>
		</label>
		<label>
			<span>Language</span>
			<input class="field" bind:value={f.language} placeholder="en, de, …" disabled={!edits} onchange={() => put('language', f.language.trim())} />
		</label>
	</div>

	<fieldset class="source">
		<legend>Whose it is <small class="soft">the source a story cites, where it isn’t ours</small></legend>
		<div class="grid three">
			<input class="field" bind:value={f.byName} placeholder="Name" aria-label="Whose it is: name" disabled={!edits} onchange={() => put('by', by())} />
			<input class="field" bind:value={f.platform} placeholder="Platform" aria-label="Its platform" disabled={!edits} onchange={() => put('by', by())} />
			<input class="field" bind:value={f.byUrl} placeholder="Their page" aria-label="Their page" disabled={!edits} onchange={() => put('by', by())} />
		</div>
	</fieldset>

	{#if look === 'video' || look === 'post' || look === 'link' || record?.transcript}
		<label class="words">
			<span>Its words <small class="soft">a video’s or a podcast’s transcript, a post’s text</small></span>
			<textarea class="field" rows="5" bind:value={f.transcript} disabled={!edits}></textarea>
			{#if f.transcript !== (record?.transcript ?? '')}
				<span class="row">
					<button class="btn primary" disabled={!edits} onclick={() => put('transcript', f.transcript)}>Save its words</button>
					<button class="btn quiet" onclick={() => (f.transcript = record?.transcript ?? '')}>Discard</button>
				</span>
			{/if}
		</label>
	{/if}

	<div class="part">
		<h4>Files <small class="soft">{files.length || ''}</small></h4>
		<div class="files">
			{#each files as id (id)}
				{@const file = byId.get(id)}
				<span class="file">
					{#if pics[id]}<img src={pics[id]} alt="" />{:else}<span class="blank"><Icon name="file" size={20} /></span>{/if}
					<small>{file?.title ?? 'A file this browser doesn’t hold'}</small>
					{#if edits}
						<button class="x" aria-label="Take {file?.title ?? 'it'} out" onclick={() => change('Taking the file out', { op: 'remove', path: ['files'], value: id })}
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
	</div>

	{#if look === 'moodboard' || members.length}
		<div class="part">
			<h4>The sparks it gathers <small class="soft">{members.length || ''}</small></h4>
			<div class="members">
				{#each members as m (m)}
					{@const it = byId.get(m)}
					{#if it}
						<SparkCard
							{world}
							{api}
							item={it}
							small
							onremove={edits ? () => change('Taking the spark out', { op: 'remove', path: ['sparks'], value: m }) : undefined}
						/>
					{/if}
				{/each}
			</div>
			{#if edits && others.length}
				<span class="row">
					<select class="field" bind:value={adding} aria-label="A spark to gather">
						<option value="">Gather another spark…</option>
						{#each others as o (o.entry)}<option value={o.entry}>{o.title || 'Untitled'}</option>{/each}
					</select>
					<button
						class="btn"
						disabled={!adding}
						onclick={async () => {
							if (await change('Gathering the spark', { op: 'insert', path: ['sparks'], value: adding })) adding = '';
						}}>Gather it</button
					>
				</span>
			{/if}
		</div>
	{/if}

	<div class="part">
		<h4>Grows into</h4>
		{#if grows.length}
			<ul class="grows">
				{#each grows as g (g.entry)}
					<li>
						<a href={g.type === 'story' ? `#stories/${g.entry}` : `#notes/${g.entry}`}>
							<Icon name={g.type === 'story' ? 'story' : 'board'} size={14} />
							{g.title || 'Untitled'}
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="soft">No story or mood board grows from it yet.</p>
		{/if}
		{#if askedStory}
			<button class="btn" disabled={busy} onclick={story}><Icon name="story" size={14} /> Make a story from it</button>
		{/if}
	</div>

	{#if writes && !changes}
		<p class="soft">{nameOf(as)}’s share doesn’t let it change these here.</p>
	{/if}
</section>

<style>
	.fields {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 51rem;
		box-sizing: border-box;
		margin: 0 auto 1.2rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fbfaf7;
	}

	.looks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.looks button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.looks button.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
		opacity: 1;
	}

	.looks button:disabled:not(.on) {
		cursor: default;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
		gap: 0.6rem;
	}

	.grid.three {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	@media (max-width: 640px) {
		.grid,
		.grid.three {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	label,
	.words {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
	}

	label > span:first-child,
	legend,
	h4 {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.with {
		display: flex;
		gap: 0.3rem;
	}

	.with .field {
		flex: 1;
		min-width: 0;
	}

	.field {
		box-sizing: border-box;
		width: 100%;
	}

	.source {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.source legend {
		margin-bottom: 0.3rem;
		padding: 0;
	}

	small.soft {
		font-weight: 400;
	}

	textarea.field {
		resize: vertical;
		font: inherit;
		line-height: 1.5;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.row .field {
		flex: 1 1 14rem;
		width: auto;
	}

	.part h4 {
		margin: 0 0 0.5rem;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
	}

	.file {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		width: 6.5rem;
		font-size: 0.72rem;
	}

	.file img,
	.file .blank {
		width: 6.5rem;
		height: 5rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		object-fit: cover;
		background: #f1efe9;
	}

	.file .blank {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		color: var(--soft);
	}

	.file small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file.add {
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
		border-radius: 999px;
		background: rgb(255 255 255 / 0.92);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
		color: inherit;
		cursor: pointer;
	}

	.members {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.6rem;
		margin-bottom: 0.6rem;
	}

	.members:empty {
		display: none;
	}

	.grows {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0 0 0.6rem;
		padding: 0;
		list-style: none;
	}

	.grows a {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: inherit;
		font-size: 0.86rem;
	}

	.part > p {
		margin: 0 0 0.6rem;
		font-size: 0.82rem;
	}
</style>
