<!--
	A vault's sparks, its scratchpads (./sparks.js): every spark of the vault the acting vault reads, each an open canvas
	of artifacts, text notes and other sparks, and the notes written before sparks, as a list (./SparkRow.svelte) in
	the middle of the layout every avenDB view has (./Frame.svelte), narrowed on its left to those a story grows from,
	the old notes or a tag, the deleted ones apart. Picking some offers to make a
	story from them, an idea of the story flow that names them among its sparks, or a spark that holds them all on its
	canvas. A click opens a spark as a note opens (Note), its canvas first. At the foot, docked just above the app's
	nav pill, one row to capture: a line of thought a spark of its own; links and dropped files each an artifact
	(./artifacts.js), each file into the Library first, all held by one new spark, titled by the line's other words.
	Nothing here names a vault: a vault other than this one adds a spark only through a cap with write on a slice that
	holds it, tagged as its slice asks (`creatable`), where its ops allow it (`may`), as Notes adds a note.
-->
<script>
	import { addingArtifact, ARTIFACT, fromFile, fromLink } from './artifacts.js';
	import { mediaOf } from './files.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import LegacyCopy from './LegacyCopy.svelte';
	import { allowed, creatable, may } from './ops.js';
	import SparkRow from './SparkRow.svelte';
	import { addingSpark, addingStory, fromLine, grownFrom, isOldNote, isSpark, linkIn, newId, placing, SPARK, sparkRecord, titleOf } from './sparks.js';
	import { count, nameOf, reads, tagsIn, tagsOf, why } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onopen: (entry: string) => void, onstory: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onopen, onstory } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const hidden = $derived(entries.length - seen.length);
	const all = $derived(seen.filter(isSpark).sort((a, b) => (b.created ?? 0) - (a.created ?? 0)));
	const sparks = $derived(all.filter((e) => !e.deleted));
	const deleted = $derived(all.filter((e) => e.deleted));
	const tags = $derived(tagsOf(sparks).filter((t) => !t.tag.includes(':')));
	/** the sparks a story grows from, and the notes written before sparks */
	const storied = $derived(sparks.filter((e) => grownFrom(world, e.entry).some((g) => g.type === 'story')));
	const notes = $derived(sparks.filter(isOldNote));

	/** what the sparks are narrowed to: `stories`, `notes`, a tag (`#` and it), or '' for all of them; or the deleted */
	let only = $state('');
	let bin = $state(false);
	const binned = $derived(bin && deleted.length > 0);
	/** whether there is anything to narrow, and so a list on the left */
	const listed = $derived(sparks.length > 0 || deleted.length > 0);
	const shown = $derived.by(() => {
		if (binned) return deleted;
		if (only.startsWith('#')) return sparks.filter((e) => e.tags?.includes(only.slice(1)));
		return only === 'stories' ? storied : only === 'notes' ? notes : sparks;
	});

	/** the line typed, the files dropped, and the tags typed for what they capture */
	let line = $state('');
	let files = $state(/** @type {File[]} */ ([]));
	let tagging = $state('');
	let over = $state(false);
	/** whether the row shows the field for the tags of what it captures */
	let tagsOpen = $state(false);
	const typed = $derived(tagsIn(tagging));
	/** the line's words, its links apart */
	const words = $derived(line.split(/\s+/).filter(Boolean));
	const links = $derived(words.map(linkIn).filter((u) => u !== null));
	const rest = $derived(words.filter((w) => !linkIn(w)).join(' '));

	/** the tags the caps ask a new spark, artifact, file and story to carry besides: `null` where nothing lets it */
	let asked = $state(/** @type {string[] | null} */ (null));
	let askedArtifact = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	let askedStory = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, SPARK, typed).then((t) => !gone && (asked = t));
		creatable(api, actor, vault, ARTIFACT, typed).then((t) => !gone && (askedArtifact = t));
		creatable(api, actor, vault, 'file').then((t) => !gone && (askedFile = t));
		creatable(api, actor, vault, 'story').then((t) => !gone && (askedStory = t));
		return () => {
			gone = true;
		};
	});

	const sparkTags = $derived([...typed, ...(asked ?? [])]);

	/** why the device won't add a spark, or a story, for the acting vault, as it answers a dry run: '' where it would */
	let unadded = $state('');
	let nostory = $state('');
	$effect(() => {
		if (!asked) return;
		const ops = [addingSpark(vault, sparkRecord('A spark', ''), sparkTags)];
		if (askedStory) ops.push(addingStory(world, vault, 'A story', [], askedStory));
		let gone = false;
		may(api, actor, ops).then(([a, b]) => {
			if (gone) return;
			unadded = allowed(a) ? '' : why(/** @type {any} */ (a));
			nostory = !askedStory ? 'nothing shared with it lets it add a story' : allowed(b) ? '' : why(/** @type {any} */ (b));
		});
		return () => {
			gone = true;
		};
	});

	const capturing = $derived(!!line.trim() || files.length > 0);
	/** whether what is captured makes artifacts besides the spark, and whether the acting vault may add them */
	const sources = $derived(links.length + files.length);

	/**
	 * Captures what is typed and dropped: a line of thought alone one spark; each link and each dropped file an
	 * artifact (each file into the Library first), all of them held by one new spark on its canvas, titled by the
	 * line's other words, else by the one source it holds, else by how many.
	 */
	async function capture() {
		if (!asked || !capturing) return;
		if (!sources) {
			const made = await api.run('Adding the spark', { ...addingSpark(vault, fromLine(line), sparkTags), as: actor });
			if (made) [line, tagging, tagsOpen] = ['', '', false];
			return;
		}
		if (askedArtifact === null) return;
		const atags = [...typed, ...askedArtifact];
		const ops = links.map((u) => addingArtifact(vault, fromLink(u), atags));
		for (const f of files) {
			const media = mediaOf(f);
			const put = await api.putFile(actor, vault, f, media, askedFile ?? []);
			if (!put) return;
			ops.push(addingArtifact(vault, fromFile(vault, put.entry, media, f.name, sources === 1 ? rest : ''), atags));
		}
		const one = sources === 1 ? (links[0] ? fromLink(links[0]).title : files[0].name) : `${count(sources, 'source')}`;
		const title = titleOf(rest || one);
		/** @type {any[]} */
		const items = [];
		placing([], ops.length).forEach((at, i) =>
			items.push({ id: newId(items), what: 'artifact', ref: { vault, entry: `$${i}` }, ...at })
		);
		ops.push(addingSpark(vault, sparkRecord(title, '', items), sparkTags));
		const what = `Adding ${count(ops.length - 1, 'artifact')} on a spark`;
		const made = await api.runAll(what, ops.map((op) => ({ ...op, as: actor })));
		if (!made) return;
		[line, files, tagging, tagsOpen] = ['', [], '', false];
		onopen(made[made.length - 1].entry);
	}

	/** Takes the files of a drop or a pick. @param {FileList | null | undefined} list */
	function take(list) {
		if (list?.length) files = [...files, ...list];
	}

	/** the sparks picked, by entry, in the order they were picked */
	let picked = $state(/** @type {string[]} */ ([]));
	const pickedNow = $derived(picked.filter((p) => sparks.some((e) => e.entry === p)));
	let storyTitle = $state('');

	/** Picks spark `entry`, or with `on` false, lets it go. @param {string} entry @param {boolean} on */
	const pick = (entry, on) => (picked = on ? [...picked.filter((p) => p !== entry), entry] : picked.filter((p) => p !== entry));

	/** A story from the sparks picked, opened at once. */
	async function story() {
		if (!askedStory || !pickedNow.length) return;
		const first = sparks.find((e) => e.entry === pickedNow[0]);
		const title = storyTitle.trim() || first?.title || 'A new story';
		const made = await api.run(`Starting “${title}”`, { ...addingStory(world, vault, title, pickedNow, askedStory), as: actor });
		if (!made) return;
		[picked, storyTitle] = [[], ''];
		onstory(made.entry);
	}

	/** A spark that holds the sparks picked on its canvas, opened at once. */
	async function combine() {
		if (!asked || pickedNow.length < 2) return;
		const title = storyTitle.trim() || 'Combined sparks';
		/** @type {any[]} */
		const items = [];
		placing([], pickedNow.length).forEach((at, i) =>
			items.push({ id: newId(items), what: 'spark', ref: { vault, entry: pickedNow[i] }, ...at })
		);
		const made = await api.run('Combining the sparks', { ...addingSpark(vault, sparkRecord(title, '', items), sparkTags), as: actor });
		if (!made) return;
		[picked, storyTitle] = [[], ''];
		onopen(made.entry);
	}
</script>

<!-- on the left, what the list is narrowed to: all of them, those in stories, the old notes, the deleted, or a tag -->
{#snippet narrow()}
	<h3 class="nav-group">Sparks</h3>
	<button class="nav-item" class:on={!only && !binned} aria-pressed={!only && !binned} data-pick onclick={() => ([only, bin] = ['', false])}
		><Icon name="spark" size={16} /><span>All</span><small>{sparks.length}</small></button
	>
	{#if storied.length}
		{@const on = only === 'stories' && !binned}
		<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => ([only, bin] = [on ? '' : 'stories', false])}
			><Icon name="story" size={16} /><span>In stories</span><small>{storied.length}</small></button
		>
	{/if}
	{#if notes.length}
		{@const on = only === 'notes' && !binned}
		<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => ([only, bin] = [on ? '' : 'notes', false])}
			><Icon name="note" size={16} /><span>Notes</span><small>{notes.length}</small></button
		>
	{/if}
	{#if deleted.length}
		<button class="nav-item" class:on={binned} aria-pressed={binned} data-pick onclick={() => (bin = !binned)}
			><Icon name="trash" size={16} /><span>Deleted</span><small>{deleted.length}</small></button
		>
	{/if}
	{#if tags.length}
		<h3 class="nav-group">Tags</h3>
		{#each tags as t (t.tag)}
			{@const on = only === `#${t.tag}` && !binned}
			<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => ([only, bin] = [on ? '' : `#${t.tag}`, false])}
				><Icon name="tag" size={16} /><span>{t.tag}</span><small>{t.uses}</small></button
			>
		{/each}
	{/if}
{/snippet}

<Frame nav={listed ? narrow : undefined} navLabel="Narrow the sparks" navIcon="spark">
<LegacyCopy {world} {vault} {actor} {api} {busy} />

{#if binned}
	<p class="soft binned">Deleted sparks keep every edit. Open one to bring it back.</p>
{/if}

{#if !seen.length && vault !== actor}
	<p class="soft">
		{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}: none of
		it is shared with {nameOf(as)}. A vault that owns it can share some of it with {nameOf(as)}, its sparks, whatever is
		tagged one way, in <button class="link" onclick={onaccess}>Sharing</button>.
	</p>
{:else if shown.length}
	<ul class="list">
		{#each shown as it (it.entry)}
			<SparkRow
				{world}
				{api}
				item={it}
				picked={pickedNow.includes(it.entry)}
				onpick={binned ? undefined : (on) => pick(it.entry, on)}
			/>
		{/each}
	</ul>
{:else}
	<p class="soft">
		No spark here{asked ? ' yet: write a line, paste links or drop pictures below.' : '.'} A spark is a scratchpad: its
		canvas holds artifacts, text notes and other sparks, wherever you put them.
	</p>
{/if}

{#if hidden > 0 && seen.length}
	<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
{/if}
</Frame>

<!-- docked just above the app's nav pill: the sparks picked, or one row to capture -->
{#if pickedNow.length}
	<div class="dock picked" class:beside={listed} role="region" aria-label="The sparks picked">
		<b>{pickedNow.length} picked</b>
		<button
			class="btn primary"
			disabled={busy || !!nostory}
			title={nostory ? `${nameOf(as)} can’t add a story here: ${nostory}` : undefined}
			onclick={story}><Icon name="story" size={14} /> Story</button
		>
		<button
			class="btn"
			disabled={busy || !!unadded || pickedNow.length < 2}
			title={pickedNow.length < 2 ? 'Pick two or more to combine them' : 'A spark that holds them all on its canvas'}
			onclick={combine}><Icon name="board" size={14} /> Combine</button
		>
		<button class="btn quiet round" aria-label="Clear the picked" onclick={() => (picked = [])}
			><Icon name="close" size={14} /></button
		>
	</div>
{:else if asked}
	<form
		class="dock capture"
		class:beside={listed}
		class:over
		aria-label="Capture a spark"
		title={unadded ? `${nameOf(as)} can’t add a spark here: ${unadded}` : undefined}
		onsubmit={(e) => (e.preventDefault(), capture())}
		ondragover={(e) => (e.preventDefault(), (over = true))}
		ondragleave={() => (over = false)}
		ondrop={(e) => (e.preventDefault(), (over = false), take(e.dataTransfer?.files))}
	>
		{#if files.length || tagsOpen}
			<div class="extra">
				{#each files as f, i (i)}
					<span class="chip"
						>{f.name}
						<button type="button" aria-label="Leave out {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}
							><Icon name="close" size={11} /></button
						></span
					>
				{/each}
				{#if sources}
					<small class="soft">
						{count(sources, 'artifact')} on a new spark{rest ? ` “${titleOf(rest)}”` : ''}.
					</small>
				{/if}
				{#if tagsOpen}
					<input class="tags" bind:value={tagging} placeholder="Tags, by commas" aria-label="Its tags" />
				{/if}
			</div>
		{/if}
		<div class="one">
			<label class="round attach" class:disabled={busy || !!unadded || askedFile === null} title="Add files">
				<Icon name="plus" size={18} />
				<input
					type="file"
					multiple
					aria-label="Add files"
					disabled={busy || !!unadded || askedFile === null}
					onchange={(e) => (take(e.currentTarget.files), (e.currentTarget.value = ''))}
				/>
			</label>
			<input
				class="line"
				bind:value={line}
				placeholder={unadded ? `${nameOf(as)} can’t add a spark here` : 'Write a thought, paste links, drop pictures'}
				aria-label="A link or a line"
				disabled={busy || !!unadded}
			/>
			<button
				type="button"
				class="round hash"
				class:on={tagsOpen || !!tagging.trim()}
				aria-pressed={tagsOpen}
				title="Tags"
				aria-label="Tags"
				onclick={() => (tagsOpen = !tagsOpen)}>#</button
			>
			<button class="round send" disabled={busy || !!unadded || !capturing} aria-label="Add"
				><Icon name="check" size={18} /></button
			>
		</div>
	</form>
{/if}

<style>
	/* one row docked just above the app's nav pill (--nav-room, src/app.css), over the middle column on a wider screen */
	.dock {
		position: fixed;
		left: 0.5rem;
		right: 0.5rem;
		bottom: var(--nav-room, 5rem);
		z-index: 20;
		box-sizing: border-box;
		max-width: 40rem;
		margin: 0 auto;
		padding: 0.35rem;
		border: 1px solid var(--edge);
		border-radius: 1.6rem;
		background: rgb(255 255 255 / 0.96);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.16);
		backdrop-filter: blur(10px);
	}

	@media (min-width: 761px) {
		.dock {
			right: 1rem;
			left: 1rem;
		}

		.dock.beside {
			left: calc(15.5rem + 1rem);
		}
	}

	.capture.over {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
	}

	.one {
		display: flex;
		align-items: center;
		gap: 0.3rem;
	}

	.line {
		flex: 1;
		min-width: 0;
		padding: 0.55rem 0.4rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.95rem;
		outline: none;
	}

	.round {
		position: relative;
		display: grid;
		flex: none;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: #f1ede4;
		color: inherit;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.round.disabled,
	.round:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.attach input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: inherit;
	}

	.hash.on {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.send {
		background: var(--accent);
		color: #fff;
	}

	.extra {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.4rem 0.4rem;
		border-bottom: 1px solid var(--edge);
		margin-bottom: 0.3rem;
		font-size: 0.78rem;
	}

	.extra .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.74rem;
	}

	.extra .chip button {
		display: grid;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.tags {
		flex: 1 1 10rem;
		min-width: 0;
		padding: 0.4rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.85rem;
		outline: none;
	}

	.tags:focus {
		border-color: var(--accent);
	}

	.picked {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding-left: 1rem;
	}

	.picked b {
		flex: 1;
		font-size: 0.88rem;
	}

	.picked .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.binned {
		margin: 0 0 1rem;
		font-size: 0.82rem;
	}

	/* the sparks as a list, clear of the row docked at the foot */
	.list {
		margin: 0 0 calc(var(--nav-room, 5rem) + 4rem);
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		list-style: none;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
</style>
