<!--
	A vault's artifacts (./artifacts.js): every artifact of the vault the acting vault reads, one source fact each, a
	bookmarked link, a picture, a clip, a YouTube video, in the layout every avenDB view has (./Frame.svelte): on the
	left what narrows them, what they are or a tag, the auto tags `sparks` and `stories` among them, and the deleted
	ones apart; in the middle them as a list (./ArtifactRow.svelte), newest first. A tap opens one
	(./Artifact.svelte). Picking some offers a spark that holds them on its canvas. At the foot, docked just above the
	app's nav pill, one row to capture: paste links or drop files, each an artifact of its own at once, each file into
	the Library first, the artifact showing it. A Library file is only bytes; what they are is the artifact's. Nothing
	here names a vault: a vault other than this one adds an artifact only through a cap with write on a slice that holds
	it, tagged as its slice asks (`creatable`), where its ops allow it (`may`).
-->
<script>
	import { addingArtifact, ARTIFACT, fromFile, fromLink, isArtifact, LOOKS, lookOf } from './artifacts.js';
	import { mediaOf } from './files.js';
	import Frame from './Frame.svelte';
	import { entryCollection } from './entry-collection.svelte.js';
	import Icon from './Icon.svelte';
	import ArtifactRow from './ArtifactRow.svelte';
	import { allowed, creatable, may } from './ops.js';
	import { addingSpark, itemsFor, linkIn, SPARK, sparkRecord } from './sparks.js';
	import { count, nameOf, reads, tagsIn, tagsOf, why } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const collection = entryCollection(() => api, () => ({ op: 'entry_views', vault, as: actor, types: ['artifact'] }));
	const entries = $derived(collection.rows);
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const hidden = $derived(collection.totalEntries - collection.readableEntries);
	const all = $derived(seen.filter(isArtifact).sort((a, b) => (b.created ?? 0) - (a.created ?? 0)));
	const live = $derived(all.filter((e) => !e.deleted));
	const deleted = $derived(all.filter((e) => e.deleted));
	const tags = $derived(tagsOf(live).filter((t) => !t.tag.includes(':')));
	/** how many artifacts of each look there are */
	const looks = $derived(LOOKS.map(([l, name, icon]) => ({ l, name, icon, n: live.filter((e) => lookOf(e) === l).length })));

	/** what they are narrowed to: a look, a tag (`#` and it), or '' for all of them; or the deleted ones */
	let only = $state('');
	let bin = $state(false);
	const binned = $derived(bin && deleted.length > 0);
	/** whether there is anything to narrow: the left side shows only then */
	const narrows = $derived(live.length > 0 || deleted.length > 0);
	const shown = $derived.by(() => {
		if (binned) return deleted;
		if (only.startsWith('#')) return live.filter((e) => e.tags?.includes(only.slice(1)));
		return only ? live.filter((e) => lookOf(e) === only) : live;
	});

	/** the line typed, the files dropped, and the tags typed for what they capture */
	let line = $state('');
	let files = $state(/** @type {File[]} */ ([]));
	let tagging = $state('');
	let over = $state(false);
	let tagsOpen = $state(false);
	const typed = $derived(tagsIn(tagging));
	/** the links the line holds, each alone between spaces */
	const links = $derived(line.split(/\s+/).map(linkIn).filter((u) => u !== null));

	/** the tags the caps ask a new artifact, file and spark to carry besides: `null` where nothing lets it add one */
	let asked = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	let askedSpark = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		void collection.rows; // Permission changes also arrive before the broad world summary.
		let gone = false;
		creatable(api, actor, vault, ARTIFACT, typed).then((t) => !gone && (asked = t));
		creatable(api, actor, vault, 'file').then((t) => !gone && (askedFile = t));
		creatable(api, actor, vault, SPARK).then((t) => !gone && (askedSpark = t));
		return () => {
			gone = true;
		};
	});
	const artifactTags = $derived([...typed, ...(asked ?? [])]);

	/** why the device won't add an artifact for the acting vault, as it answers a dry run: '' where it would */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		let gone = false;
		const probe = addingArtifact(vault, { kind: ARTIFACT, title: 'An artifact' }, artifactTags);
		may(api, actor, [probe]).then(([a]) => !gone && (unadded = allowed(a) ? '' : why(/** @type {any} */ (a))));
		return () => {
			gone = true;
		};
	});

	const capturing = $derived(links.length > 0 || files.length > 0);

	/** Captures the links typed and the files dropped, each an artifact, each file into the Library first. */
	async function capture() {
		if (!asked || !capturing) return;
		const [text, dropped] = [line.trim(), files];
		const ops = links.map((u) => addingArtifact(vault, fromLink(u), artifactTags));
		const title = dropped.length === 1 && text && !links.length ? text : '';
		for (const f of dropped) {
			const media = mediaOf(f);
			const put = await api.putFile(actor, vault, f, media, askedFile ?? []);
			if (!put) return;
			ops.push(addingArtifact(vault, fromFile(vault, put.entry, media, f.name, title), artifactTags));
		}
		const what = ops.length === 1 ? 'Adding the artifact' : `Adding ${count(ops.length, 'artifact')}`;
		const made = await api.runAll(what, ops.map((op) => ({ ...op, as: actor })));
		if (!made) return;
		[line, files, tagging, tagsOpen] = ['', [], '', false];
	}

	/** Takes the files of a drop or a pick. @param {FileList | null | undefined} list */
	function take(list) {
		if (list?.length) files = [...files, ...list];
	}

	/** the artifacts picked, by entry, in the order they were picked */
	let picked = $state(/** @type {string[]} */ ([]));
	const pickedNow = $derived(picked.filter((p) => live.some((e) => e.entry === p)));
	let sparkTitle = $state('');

	/** Picks artifact `entry`, or with `on` false, lets it go. @param {string} entry @param {boolean} on */
	const pick = (entry, on) => (picked = on ? [...picked.filter((p) => p !== entry), entry] : picked.filter((p) => p !== entry));

	/** A spark that holds the artifacts picked on its canvas, opened at once. */
	async function spark() {
		if (!askedSpark || !pickedNow.length) return;
		const first = live.find((e) => e.entry === pickedNow[0]);
		const title = sparkTitle.trim() || first?.title || 'A new spark';
		const items = itemsFor([], pickedNow.map((entry) => ({ vault, entry, what: /** @type {const} */ ('artifact') })));
		const made = await api.run(`Making “${title}”`, { ...addingSpark(vault, sparkRecord(title, '', items), askedSpark), as: actor });
		if (!made) return;
		[picked, sparkTitle] = [[], ''];
		onopen(made.entry);
	}
</script>

<!-- the left side: what narrows the artifacts, what they are or a tag, or the deleted ones instead -->
{#snippet narrow()}
	<h3 class="nav-group">Artifacts</h3>
	<button class="nav-item" class:on={!only && !binned} aria-pressed={!only && !binned} data-pick onclick={() => ([only, bin] = ['', false])}
		><Icon name="artifact" size={16} /><span>All</span><small>{live.length}</small></button
	>
	{#each looks.filter((x) => x.n) as x (x.l)}
		{@const on = only === x.l && !binned}
		<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => ([only, bin] = [on ? '' : x.l, false])}
			><Icon name={x.icon} size={16} /><span>{x.name}</span><small>{x.n}</small></button
		>
	{/each}
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

<Frame nav={narrows ? narrow : undefined} navLabel="Narrow the artifacts" navIcon="artifact">
	{#if binned}
		<p class="soft binned">Deleted artifacts keep every edit. Open one to bring it back.</p>
	{/if}

	{#if collection.phase === 'loading'}
		<p role="status">Loading the collection…</p>
	{:else if collection.phase === 'error'}
		<p role="alert">{collection.error}</p>
	{:else if !collection.readableEntries && vault !== actor}
		<p class="soft">
			{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}: none of
			it is shared with {nameOf(as)}. A vault that owns it can share some of it with {nameOf(as)} in
			<button class="link" onclick={onaccess}>Sharing</button>.
		</p>
	{:else if shown.length}
		<ul class="list">
			{#each shown as it (it.entry)}
				<ArtifactRow
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
			No artifact here{asked ? ' yet: paste a link or drop a picture or a clip below.' : '.'} Each source is an artifact:
			a link, a picture, a video. Sparks hold them on their canvas.
		</p>
	{/if}

	{#if collection.phase === 'ready' && hidden > 0 && collection.readableEntries}
		<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
	{/if}

	<!-- docked just above the app's nav pill: the artifacts picked, or one row to capture -->
	{#if pickedNow.length}
		<div class="dock picked" class:beside={narrows} role="region" aria-label="The artifacts picked">
			<b>{pickedNow.length} picked</b>
			<input class="name" bind:value={sparkTitle} placeholder="The spark’s title" aria-label="The spark’s title" />
			<button
				class="btn primary"
				disabled={busy || askedSpark === null}
				title={askedSpark === null ? `${nameOf(as)} can’t add a spark here` : undefined}
				onclick={spark}><Icon name="spark" size={14} /> Spark</button
			>
			<button class="btn quiet round" aria-label="Clear the picked" onclick={() => (picked = [])}
				><Icon name="close" size={14} /></button
			>
		</div>
	{:else if asked}
		<form
			class="dock capture"
			class:beside={narrows}
			class:over
			aria-label="Capture an artifact"
			title={unadded ? `${nameOf(as)} can’t add an artifact here: ${unadded}` : undefined}
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
					{#if tagsOpen}
						<input class="tags" bind:value={tagging} placeholder="Tags, by commas" aria-label="Their tags" />
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
					placeholder={unadded ? `${nameOf(as)} can’t add an artifact here` : 'Paste links, drop pictures or clips'}
					aria-label="Links"
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
</Frame>

<style>
	/* one row docked just above the app's nav pill (--nav-room, src/app.css), over the pages' column on a wider screen */
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

	/* beside the left side of the layout (./Frame.svelte), where it stands */
	@media (min-width: 761px) {
		.dock.beside {
			left: calc(15.5rem + 1rem);
			right: 1rem;
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
		flex: none;
		font-size: 0.88rem;
	}

	.picked .name {
		flex: 1;
		min-width: 0;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		font: inherit;
		font-size: 0.85rem;
		outline: none;
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
