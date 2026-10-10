<!--
	A vault's notes, as a docs app lists its documents: a blank note to start, made at once and opened, then every note
	of the vault the acting vault reads, one flat library, narrowed by a tag; each a page with its tags, its edits, its
	proposals, whether it is a variant of another, and who holds a role on it; a click opens it (Note). Everything else
	stays out of sight, as on a device of the acting vault alone: the device's world says which vault holds which role
	on each entry, by the caps whose slices hold it (avendb-browser's `World`), and every edit goes out acting for that
	vault. A vault other than this one adds a note only through a cap with write on a slice that holds it, tagged as its
	slice asks, and where the rules of that cap allow it, as the device answers a dry run of adding it (`may`).
-->
<script>
	import Icon from './Icon.svelte';
	import { may, noteRecord } from './ops.js';
	import { count, creates, holders, list, nameOf, reads, ROLES, tagsIn, tagsOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onact: (vault: string) => void, onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onact, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const docs = $derived(seen.filter((e) => e.kind === 'note'));
	const hidden = $derived(entries.length - seen.length);
	const tags = $derived(tagsOf(docs));
	/** the tag the notes are narrowed to: '' for all of them */
	let only = $state('');
	const shown = $derived(only && tags.some((t) => t.tag === only) ? docs.filter((e) => e.tags?.includes(only)) : docs);
	/** the new note's tags, as the person types them, and those the acting vault's cap asks for besides */
	let tagging = $state('');
	const typed = $derived(tagsIn(tagging));
	const asked = $derived(creates(world, vault, actor, 'note', typed));
	/** every note this browser knows, by entry: to name the one a variant came from */
	const notes = $derived(new Map(world.entries.filter((e) => e.kind === 'note').map((e) => [e.entry, e])));

	/** the tags the cap asks a new note to carry, in words */
	const tagsWords = $derived(asked?.length ? `, tagged ${list(asked.map((t) => `“${t}”`))} as its cap asks` : '');

	/** The op that adds a blank note, tagged as typed and as the cap asks. */
	const blankNote = () => ({
		op: 'create',
		vault,
		type: 'note',
		tags: [...typed, ...(asked ?? [])],
		value: noteRecord('Untitled note', '')
	});

	/** A blank note, opened at once. */
	async function blank() {
		if (!asked) return;
		const made = await api.run('Writing the note', { ...blankNote(), as: actor });
		if (!made) return;
		tagging = '';
		onopen(made.entry);
	}

	/** why the rules of the cap the acting vault adds through don't let it add the note, as the device answers: '' */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const op = blankNote();
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = a !== true && a.refused === 'NotAllowed' ? a.why : '';
		});
		return () => {
			gone = true;
		};
	});
</script>

{#if asked}
	<section class="start" aria-label="Start a new note">
		<button class="blank" disabled={busy || !!unadded} onclick={blank}>
			<span class="sheet"><Icon name="plus" size={34} /></span>
			<span class="label">Blank note</span>
		</button>
		<div class="say">
			<p class="soft">
				{#if unadded}
					{nameOf(as)} can’t add a note here: {unadded}.
				{:else}
					A new note in {nameOf(here)}, as <b>{nameOf(as)}</b>{tagsWords}: it opens at once, to title and
					write.
				{/if}
			</p>
			<input class="field" placeholder="Tags for it (optional)" bind:value={tagging} aria-label="The new note’s tags" />
		</div>
	</section>
{/if}

{#if tags.length}
	<nav class="filter" aria-label="Narrow by tag">
		<button class="chip" class:on={!only} aria-pressed={!only} onclick={() => (only = '')}>All {docs.length}</button>
		{#each tags as t (t.tag)}
			<button class="chip" class:on={only === t.tag} aria-pressed={only === t.tag} onclick={() => (only = only === t.tag ? '' : t.tag)}
				>#{t.tag} <small>{t.uses}</small></button
			>
		{/each}
	</nav>
{/if}

{#if !seen.length && vault !== actor}
	<div class="empty">
		<p>
			{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}: it holds no
			cap on any of it. A vault that owns it can share some of it with {nameOf(as)}, a note, its todos, whatever is tagged
			one way, in <button class="link" onclick={onaccess}>Access</button>.
		</p>
		{#if here?.via}
			<button class="btn" onclick={() => onact(vault)}>Act as {nameOf(here)}</button>
		{/if}
	</div>
{:else if shown.length}
	<div class="docs">
		{#each shown as it (it.entry)}
			{@const origin = it.variantOf ? notes.get(it.variantOf) : undefined}
			<a class="note" href="#notes/{it.entry}" aria-label={it.title}>
				<span class="thumb" aria-hidden="true">
					<span class="page"><b>{it.title}</b><span>{it.text}</span></span>
				</span>
				<span class="info">
					<b>{it.title}</b>
					<small class="soft">
						{count(it.edits ?? 0, 'edit')}{it.proposals ? ` · ${count(it.proposals, 'proposal')}` : ''}{it.by !== vault
							? ` · by ${nameOf(byId.get(it.by))}`
							: ''}
					</small>
					{#if it.variantOf}
						<small class="variant"><Icon name="variant" size={12} /> Variant of {origin?.title ? `“${origin.title}”` : 'a note'}</small>
					{/if}
					{#if it.tags?.length}
						<span class="who">{#each it.tags as t (t)}<span class="chip tag">#{t}</span>{/each}</span>
					{/if}
					<span class="who">
						{#each holders(it.roles) as h (h.id)}
							<span class="chip" class:accent={h.id === actor}>{nameOf(byId.get(h.id))} {ROLES[h.role]}</span>
						{/each}
						{#if it.public}<span class="chip">everyone reads</span>{/if}
					</span>
				</span>
			</a>
		{/each}
	</div>
{:else}
	<p class="soft">No note here{asked ? ' yet: start one above.' : '.'}</p>
{/if}

{#if hidden > 0 && seen.length}
	<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
{/if}

<style>
	.start {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.4rem;
		margin: 0 0 1.8rem;
		padding: 1rem 1.2rem;
		border-radius: 14px;
		background: #e9e4d9;
	}

	.start p {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.blank .sheet {
		display: grid;
		place-items: center;
		width: 6.6rem;
		height: 8.4rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 6px;
		background: #fff;
		color: var(--accent);
		transition: border-color 0.15s ease;
	}

	.blank:hover:not(:disabled) .sheet {
		border-color: var(--accent);
	}

	.blank:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.blank .label {
		font-size: 0.84rem;
		font-weight: 600;
	}

	.say {
		display: flex;
		flex: 1 1 14rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.say .field {
		width: min(100%, 16rem);
	}

	/* the tags as a docs app's filters: one picked narrows the notes to those that carry it */
	.filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 1rem;
	}

	.filter button {
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

	.tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	/* the notes as a docs app's documents: a page's thumbnail over its title */
	.docs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 12.5rem), 1fr));
		gap: 1rem;
	}

	.note {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
		color: inherit;
		text-decoration: none;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.note:hover,
	.note:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
	}

	.thumb {
		display: block;
		height: 9.5rem;
		overflow: hidden;
		padding: 0.9rem 1.1rem 0;
		border-bottom: 1px solid var(--edge);
		background: #f1efe9;
	}

	.page {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		height: 100%;
		padding: 0.8rem 0.85rem;
		box-sizing: border-box;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
		font-size: 0.56rem;
		line-height: 1.45;
		overflow: hidden;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.page b {
		font-size: 0.72rem;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.6rem 0.75rem 0.7rem;
		min-width: 0;
	}

	.info > b {
		overflow: hidden;
		font-size: 0.9rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.info small {
		font-size: 0.74rem;
	}

	.variant {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: #6a4b9a;
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.3rem;
	}

	.who .chip {
		font-size: 0.66rem;
	}

	.empty p {
		margin: 0 0 0.6rem;
		line-height: 1.5;
	}

	.empty p:last-child {
		margin: 0;
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
