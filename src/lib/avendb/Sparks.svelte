<!--
	A vault's sparks, the one inspiration pad (./sparks.js): at the top a quick capture, to paste a link, type a line or
	drop files, each a spark of its own at once, several files with a line besides gathered on a mood board of that
	name; then every spark of the vault the acting vault reads, and the notes written before sparks, as cards, narrowed
	by what they are or a tag, the deleted ones apart. Picking some offers to make a story from them, an idea of the
	story flow that names them among its sparks, or a mood board that gathers them. A click opens a spark as a note
	opens (Note). Nothing here names a vault: a vault other than this one adds a spark only through a cap with write on
	a slice that holds it, tagged as its slice asks (`creatable`), where its ops allow it (`may`), as Notes adds a note.
-->
<script>
	import { mediaOf } from './files.js';
	import Icon from './Icon.svelte';
	import { allowed, creatable, may } from './ops.js';
	import SparkCard from './SparkCard.svelte';
	import { addingSpark, addingStory, fromLine, isSpark, LOOKS, lookOf, lookOfFile, SPARK, sparkRecord } from './sparks.js';
	import { count, list, nameOf, reads, tagsIn, tagsOf, why } from './vaults.js';

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
	const tags = $derived(tagsOf(sparks));
	/** how many sparks of each look there are */
	const looks = $derived(LOOKS.map(([l, name, icon]) => ({ l, name, icon, n: sparks.filter((e) => lookOf(e) === l).length })));

	/** what the sparks are narrowed to: a look, a tag (`#` and it), or '' for all of them; or the deleted ones */
	let only = $state('');
	let bin = $state(false);
	const binned = $derived(bin && deleted.length > 0);
	const shown = $derived.by(() => {
		if (binned) return deleted;
		if (only.startsWith('#')) return sparks.filter((e) => e.tags?.includes(only.slice(1)));
		return only ? sparks.filter((e) => lookOf(e) === only) : sparks;
	});

	/** the line typed, the files dropped, and the tags typed for what they capture */
	let line = $state('');
	let files = $state(/** @type {File[]} */ ([]));
	let tagging = $state('');
	let over = $state(false);
	const typed = $derived(tagsIn(tagging));

	/** the tags the caps ask a new spark, file and story to carry besides: `null` where nothing lets it add one */
	let asked = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	let askedStory = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, SPARK, typed).then((t) => !gone && (asked = t));
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

	/**
	 * Captures what is typed and dropped: a line alone one spark, a link or a thought; each file a spark of its own
	 * (a picture, a video, a note), titled by the line where it is one file; and several files with a line besides,
	 * gathered on a mood board the line names. Each file goes into the Library first.
	 */
	async function capture() {
		if (!asked || !capturing) return;
		const [text, dropped] = [line.trim(), files];
		/** @type {object[]} */
		const ops = [];
		if (!dropped.length) ops.push(addingSpark(vault, fromLine(text), sparkTags));
		for (const f of dropped) {
			const media = mediaOf(f);
			const put = await api.putFile(actor, vault, f, media, askedFile ?? []);
			if (!put) return;
			const title = dropped.length === 1 && text ? text : f.name;
			ops.push(addingSpark(vault, sparkRecord(title, '', { look: lookOfFile(media, f.name), files: [put.entry] }), sparkTags));
		}
		if (dropped.length > 1 && text) {
			const gathers = ops.map((_, i) => `$${i}`);
			ops.push(addingSpark(vault, sparkRecord(text, '', { look: 'moodboard', sparks: gathers }), sparkTags));
		}
		const what = ops.length === 1 ? 'Adding the spark' : `Adding ${count(ops.length, 'spark')}`;
		const made = await api.runAll(what, ops.map((op) => ({ ...op, as: actor })));
		if (!made) return;
		[line, files, tagging] = ['', [], ''];
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

	/** A mood board gathering the sparks picked, opened at once. */
	async function board() {
		if (!asked || pickedNow.length < 2) return;
		const title = storyTitle.trim() || 'Mood board';
		const value = sparkRecord(title, '', { look: 'moodboard', sparks: pickedNow });
		const made = await api.run('Making the mood board', { ...addingSpark(vault, value, sparkTags), as: actor });
		if (!made) return;
		[picked, storyTitle] = [[], ''];
		onopen(made.entry);
	}
</script>

{#if asked}
	<form
		class="capture"
		class:over
		aria-label="Capture a spark"
		onsubmit={(e) => (e.preventDefault(), capture())}
		ondragover={(e) => (e.preventDefault(), (over = true))}
		ondragleave={() => (over = false)}
		ondrop={(e) => (e.preventDefault(), (over = false), take(e.dataTransfer?.files))}
	>
		<span class="mark" aria-hidden="true"><Icon name="spark" size={22} /></span>
		<div class="say">
			<input
				class="line"
				bind:value={line}
				placeholder="Paste a link, write a thought, or drop pictures and films here"
				aria-label="A link or a line"
				disabled={busy || !!unadded}
			/>
			{#if files.length}
				<p class="dropped">
					{#each files as f, i (i)}
						<span class="chip"
							>{f.name}
							<button type="button" aria-label="Leave out {f.name}" onclick={() => (files = files.filter((_, j) => j !== i))}
								><Icon name="close" size={11} /></button
							></span
						>
					{/each}
					{#if files.length > 1}
						<small class="soft">
							{line.trim() ? `A mood board “${line.trim()}” gathers them.` : 'Type a line too to gather them on a mood board.'}
						</small>
					{/if}
				</p>
			{/if}
			<p class="soft hint">
				{#if unadded}
					{nameOf(as)} can’t add a spark here: {unadded}.
				{:else}
					Each one its own spark in {nameOf(here)}, as <b>{nameOf(as)}</b>{asked.length
						? `, tagged ${list(asked.map((t) => `“${t}”`))} as its share asks`
						: ''}.
				{/if}
			</p>
		</div>
		<div class="act">
			<input class="field tags" bind:value={tagging} placeholder="Tags (optional)" aria-label="Its tags" />
			<label class="btn files" class:disabled={busy || !!unadded || askedFile === null}>
				<Icon name="upload" size={15} /> Files
				<input
					type="file"
					multiple
					disabled={busy || !!unadded || askedFile === null}
					onchange={(e) => (take(e.currentTarget.files), (e.currentTarget.value = ''))}
				/>
			</label>
			<button class="btn primary" disabled={busy || !!unadded || !capturing}>Add</button>
		</div>
	</form>
{/if}

{#if sparks.length || deleted.length}
	<nav class="filter" aria-label="Narrow the sparks">
		<button class="chip" class:on={!only && !binned} aria-pressed={!only && !binned} onclick={() => ([only, bin] = ['', false])}
			>All {sparks.length}</button
		>
		{#each looks.filter((x) => x.n) as x (x.l)}
			{@const on = only === x.l && !binned}
			<button class="chip" class:on aria-pressed={on} onclick={() => ([only, bin] = [on ? '' : x.l, false])}
				><Icon name={x.icon} size={12} /> {x.name} <small>{x.n}</small></button
			>
		{/each}
		{#each tags as t (t.tag)}
			{@const on = only === `#${t.tag}` && !binned}
			<button class="chip tag" class:on aria-pressed={on} onclick={() => ([only, bin] = [on ? '' : `#${t.tag}`, false])}
				>#{t.tag} <small>{t.uses}</small></button
			>
		{/each}
		{#if deleted.length}
			<button class="chip bin" class:on={binned} aria-pressed={binned} onclick={() => (bin = !binned)}
				><Icon name="trash" size={12} /> Deleted <small>{deleted.length}</small></button
			>
		{/if}
	</nav>
{/if}

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
	<div class="grid">
		{#each shown as it (it.entry)}
			<SparkCard
				{world}
				{api}
				item={it}
				picked={pickedNow.includes(it.entry)}
				picking={pickedNow.length > 0}
				onpick={binned ? undefined : (on) => pick(it.entry, on)}
			/>
		{/each}
	</div>
{:else}
	<p class="soft">No spark here{asked ? ' yet: paste a link or write a line above.' : '.'}</p>
{/if}

{#if hidden > 0 && seen.length}
	<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
{/if}

{#if pickedNow.length}
	<div class="picked" role="region" aria-label="The sparks picked">
		<b>{count(pickedNow.length, 'spark')} picked</b>
		<input class="field" bind:value={storyTitle} placeholder="Its title (optional)" aria-label="The new story’s or board’s title" />
		<button
			class="btn primary"
			disabled={busy || !!nostory}
			title={nostory ? `${nameOf(as)} can’t add a story here: ${nostory}` : undefined}
			onclick={story}>Make a story from {pickedNow.length === 1 ? 'it' : 'these'}</button
		>
		<button
			class="btn"
			disabled={busy || !!unadded || pickedNow.length < 2}
			title={pickedNow.length < 2 ? 'Pick two or more to gather them' : undefined}
			onclick={board}>Make a mood board</button
		>
		<button class="btn quiet" onclick={() => (picked = [])}>Clear</button>
	</div>
{/if}

<style>
	.capture {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.8rem 1rem;
		margin: 0 0 1.4rem;
		padding: 1rem 1.1rem;
		border: 2px dashed transparent;
		border-radius: 14px;
		background: #e9e4d9;
		transition: border-color 0.15s ease;
	}

	.capture.over {
		border-color: var(--accent);
	}

	.mark {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 10px;
		background: #fff;
		color: #b07a14;
	}

	.say {
		display: flex;
		flex: 1 1 18rem;
		flex-direction: column;
		gap: 0.45rem;
		min-width: 0;
	}

	.line {
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.95rem;
	}

	.line:focus {
		outline: none;
		border-color: var(--accent);
	}

	.hint,
	.dropped {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.5;
	}

	.dropped {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	.dropped .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.74rem;
	}

	.dropped button {
		display: grid;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
	}

	.act {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}

	.tags {
		width: 9.5rem;
	}

	.files {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		cursor: pointer;
	}

	.files.disabled {
		opacity: 0.55;
		cursor: default;
	}

	.files input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: inherit;
	}

	.filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 1rem;
	}

	.filter button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.filter button small {
		color: var(--soft);
	}

	.filter button.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
	}

	.filter .tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.binned {
		margin: -0.4rem 0 1rem;
		font-size: 0.82rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr));
		gap: 1rem;
		padding-bottom: 5rem;
	}

	.picked {
		position: sticky;
		bottom: 4.5rem;
		z-index: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		width: fit-content;
		max-width: 100%;
		box-sizing: border-box;
		margin: -4rem auto 1rem;
		padding: 0.6rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
	}

	.picked .field {
		width: 12rem;
	}

	/* on a phone the bar keeps to its buttons: a story takes its first spark's title, to change on its page */
	@media (max-width: 520px) {
		.picked {
			gap: 0.4rem;
			padding: 0.5rem 0.6rem;
		}

		.picked .field {
			display: none;
		}
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
