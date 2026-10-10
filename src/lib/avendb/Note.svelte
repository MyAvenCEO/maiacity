<!--
	One note as a docs app shows a document, the whole screen: at the top its title, its vault, its tags, its edits, the
	line being edited, who holds a role on it and Share (this note alone, or a rule its tags match); on the left its
	main line and its proposals, each a line of its own to switch to, and its variants, the notes made from it; in the
	middle the note on the line picked, as a page, to edit there, and what a proposal changes against main, to accept
	it, make main match it or bring main's changes in; on the right its history, every edit of that line, newest first,
	each with what it changed, word by word, who made it, and the version it made, to view, restore, undo or propose
	from. A variant is a new note with what a line reads now, and none of its history. All of it acts for the acting
	vault, whose caps the device checks as any peer does: a note it only reads, it reads, every version of it.
-->
<script>
	import { untrack } from 'svelte';
	import { diff } from './diff.js';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { blockText, variantMark } from './ops.js';
	import Share from './Share.svelte';
	import Tags from './Tags.svelte';
	import { allows, count, creates, holders as rank, hue, nameOf, ROLES, short } from './vaults.js';

	/**
	 * @typedef {{ line: string | null, name: string | null, from: string[] | null, heads: string[], history: string[],
	 *   title: string | null, text: string | null }} LineView
	 * @typedef {{ id: string, author: string, actor: string, line: string | null, deps: string[],
	 *   kind: 'edit' | 'propose' | 'merge' | 'promote' | 'sealed', name: string | null,
	 *   from: { line: string | null, name: string | null } | null, title: string | null, text: string | null,
	 *   before: string | null }} EditView
	 * @typedef {EditView & { n: number }} Numbered
	 * @typedef {{ vault: string | null, entry: string, lines: LineView[], edits: EditView[] }} NoteData
	 */

	/** @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string }} */
	let { world, actor, api, busy, entry } = $props();

	let note = $state(/** @type {NoteData | null} */ (null));
	let loaded = $state(false);
	/** the line picked: `null` for the main line, else the id of its proposal's first edit */
	let line = $state(/** @type {string | null} */ (null));
	/** the edit whose version shows, read-only: '' for the line's latest */
	let viewing = $state('');
	/** each line's text and title as the person edits them, and as last shown, by line ('' for the main line) */
	let drafts = $state(/** @type {Record<string, string>} */ ({}));
	let titles = $state(/** @type {Record<string, string>} */ ({}));
	/** @type {Record<string, string>} */
	let shown = {};
	/** @type {Record<string, string>} */
	let named = {};
	/** a new proposal being named: the version it starts from, that version in words, and its name */
	let naming = $state(/** @type {{ from: string[], at: string, name: string } | null} */ (null));
	/** the vault a variant goes to, and the variant made */
	let into = $state('');
	let made = $state('');
	let sharing = $state(false);

	const item = $derived(world.entries.find((e) => e.entry === entry));

	// what the device holds changed: read the note again
	$effect(() => {
		void world;
		const [known, e] = [!!item, entry];
		if (!known) return;
		let gone = false;
		api.note(e).then(
			(/** @type {NoteData | undefined} */ n) => {
				if (!gone) [note, loaded] = [n ?? null, true];
			},
			() => {
				if (!gone) loaded = true;
			}
		);
		return () => {
			gone = true;
		};
	});

	const key = (/** @type {string | null} */ l) => l ?? '';
	const lines = $derived(note?.lines ?? []);
	const here = $derived(lines.find((l) => l.line === line) ?? lines[0]);
	const main = $derived(lines[0]);
	const proposals = $derived(lines.slice(1));
	const k = $derived(key(here?.line ?? null));
	const writes = $derived(allows(item?.roles[actor], 'write'));
	const owns = $derived(allows(item?.roles[actor], 'owner'));
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const as = $derived(byId.get(actor));
	/** the devices this browser knows, by id: their name and their vault */
	const devices = $derived(new Map(world.vaults.flatMap((v) => v.devices.map((d) => [d.id, { name: d.name, vault: v }]))));
	/** every edit of the note, numbered in the order the device took them */
	const numbered = $derived((note?.edits ?? []).map((e, i) => ({ ...e, n: i + 1 })));
	/** the line's edits, newest first */
	const history = $derived.by(() => {
		const on = new Set(here?.history ?? []);
		return numbered.filter((e) => on.has(e.id)).reverse();
	});
	const seen = $derived(viewing ? history.find((e) => e.id === viewing) : undefined);
	/** the line's one latest edit, which restoring changes nothing */
	const latest = $derived(here?.heads.length === 1 ? here.heads[0] : '');
	/** the vaults the acting vault may add the variant to, of the note's type and with its tags, as its caps let it */
	const targets = $derived(
		world.vaults.filter((v) => creates(world, v.id, actor, item?.type ?? 'note', item?.tags ?? [])?.length === 0)
	);
	/** the notes this browser reads, by entry */
	const notes = $derived(new Map(world.entries.filter((e) => e.kind === 'note').map((e) => [e.entry, e])));
	const origin = $derived(item?.variantOf ? notes.get(item.variantOf) : undefined);
	const variants = $derived([...notes.values()].filter((n) => n.variantOf === entry));
	const unsaved = $derived(!!here && writes && !seen && (drafts[k] ?? '') !== (here.text ?? ''));
	/** the vaults that hold a role on the note, the strongest first */
	const holders = $derived(rank(item?.roles ?? {}));

	$effect(() => {
		const now = lines;
		untrack(() => {
			for (const l of now) {
				const at = key(l.line);
				// a line the person isn't editing follows what arrives
				if (drafts[at] === undefined || drafts[at] === shown[at]) drafts[at] = l.text ?? '';
				if (titles[at] === undefined || titles[at] === named[at]) titles[at] = l.title ?? '';
				[shown[at], named[at]] = [l.text ?? '', l.title ?? ''];
			}
		});
	});

	/** A line's name, as a person reads it. @param {{ line: string | null, name: string | null } | null | undefined} l */
	const lineName = (l) => (!l ? 'a line' : l.line === null ? 'main' : (l.name ?? 'a proposal this browser can’t name'));
	/** Line `l` of the note. @param {string | null} l */
	const lineOf = (l) => lines.find((x) => x.line === l) ?? { line: l, name: null };
	/** Line `l` quoted, as a sentence names it. @param {string | null} l */
	const at = (l) => `“${lineName(lineOf(l))}”`;

	/** Vault `id`, by name. @param {string | undefined} id */
	const vaultName = (id) => (id ? nameOf(byId.get(id)) : 'a vault');

	/** Who made edit `e`: its device by name, and the vault it acted for. @param {EditView} e */
	function who(e) {
		const d = devices.get(e.author);
		const device = d?.name ?? (d ? `A device of ${nameOf(d.vault)}` : 'A device this browser doesn’t know');
		return `${device}, for ${nameOf(byId.get(e.actor))}`;
	}

	/** What edit `e` did, in words. @param {Numbered} e */
	function what(e) {
		const elsewhere = e.line !== here?.line ? ` on ${at(e.line)}` : '';
		const from = e.from?.line ?? null;
		switch (e.kind) {
			case 'propose':
				return `Proposed “${e.name ?? '…'}”${e.from ? ` from ${at(from)}` : ''}`;
			case 'merge':
				if (e.line === null) return `Accepted ${at(from)} into main`;
				if (from === null) return `Updated ${at(e.line)} from main`;
				return `Merged ${at(from)} into ${at(e.line)}`;
			case 'promote':
				return `Made ${at(e.line)} match ${at(from)}`;
			case 'sealed':
				return `An edit this browser can’t open${elsewhere}`;
			default: {
				if (!e.deps.length) return `Wrote the note${elsewhere}`;
				const before = numbered.find((x) => x.id === e.deps[0]);
				const renamed = e.text === e.before && before && e.title !== null && before.title !== null && e.title !== before.title;
				return renamed ? `Renamed it “${e.title}”${elsewhere}` : `Edited${elsewhere}`;
			}
		}
	}

	/** Pick line `l` to show and edit. @param {string | null} l */
	function pick(l) {
		[line, viewing, naming] = [l, '', null];
	}

	/** Name a new proposal from version `from`, `words` saying which. @param {string[]} from @param {string} words */
	function proposeFrom(from, words) {
		naming = { from, at: words, name: '' };
	}

	async function propose() {
		const name = naming?.name.trim();
		if (!naming || !name) return;
		const made = await api.run('Proposing', { op: 'propose', as: actor, entry, from: naming.from, name });
		if (made) [line, viewing, naming] = [made.line, '', null];
	}

	/** The blocks of the note on line `on`, as its schema reads them: none if the device can't read it.
	 *  @param {string | null} on @returns {Promise<{ id: number, type: string }[]>} */
	async function blocksOn(on) {
		const got = await api.ask({ op: 'get', entry, line: on });
		return got.ok?.record.blocks ?? [];
	}

	async function save() {
		if (!here || !unsaved) return;
		const [on, text] = [here.line, drafts[k]];
		// its text is its first paragraph, block 2, which a note written elsewhere may not have yet
		const op = (await blocksOn(on)).some((b) => b.id === 2)
			? { op: 'set', path: blockText(2), value: text }
			: { op: 'insert', path: ['blocks'], value: { id: 2, type: 'paragraph', text } };
		await api.run('Saving', { ...op, as: actor, entry, line: on });
	}

	async function retitle() {
		const title = (titles[k] ?? '').trim();
		if (!here || !title || title === (here.title ?? '')) return;
		const on = here.line;
		// the heading a note opens with, block 1, is its title too: one write changes both
		const heading = (await blocksOn(on)).some((b) => b.id === 1 && b.type === 'heading');
		const set = (/** @type {unknown[]} */ path) => ({ op: 'set', entry, line: on, path, value: title });
		const ops = heading ? [set(['title']), set(blockText(1))] : [set(['title'])];
		await api.run('Renaming', { op: 'batch', as: actor, ops });
	}

	/**
	 * Merge line `from` into line `to`, then show `to`; with `promote`, `to` then shows exactly what `from` does.
	 * @param {string | null} from @param {string | null} to @param {boolean} promote
	 */
	async function merge(from, to, promote) {
		const op = { op: 'merge', as: actor, entry, from, into: to, promote };
		if (await api.run(promote ? 'Making it match' : 'Merging', op)) [line, viewing] = [to, ''];
	}

	/** Put version `id` back on the line. @param {string} id */
	async function restore(id) {
		if (!here) return;
		if (await api.run('Restoring', { op: 'restore', as: actor, entry, line: here.line, at: [id] })) viewing = '';
	}

	/** Undo edit `id` on the line, keeping every change since. @param {string} id */
	async function undo(id) {
		if (!here) return;
		if (await api.run('Undoing', { op: 'undo', as: actor, entry, line: here.line, edit: id })) viewing = '';
	}

	async function variant() {
		const target = targets.some((v) => v.id === into) ? into : targets[0]?.id;
		if (!here || !target) return;
		// the copy names the note it came from, in place of the note this one came from, if any, in its first write
		const from = item?.variantOf;
		const mark = [
			...(from ? [{ op: 'remove', path: ['tags'], value: variantMark(from) }] : []),
			{ op: 'insert', path: ['tags'], value: variantMark(entry) }
		];
		const op = { op: 'variant', as: actor, entry, line: here.line, into: target, ops: mark };
		made = (await api.run('Making the variant', op))?.entry ?? '';
	}

	/**
	 * Fit a textarea to its text, as a page grows with what is written on it, and again when `text` arrives.
	 * @param {HTMLTextAreaElement} el @param {string} [text]
	 */
	function grow(el, text) {
		void text;
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight}px`;
		};
		fit();
		el.addEventListener('input', fit);
		return { update: fit, destroy: () => el.removeEventListener('input', fit) };
	}

	/** Save on Ctrl+S or ⌘S, as a docs app does. @param {KeyboardEvent} e */
	function keys(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			save();
		}
	}
</script>

{#snippet pieces(/** @type {import('./diff.js').Piece[]} */ ps)}
	{#each ps as p, i (i)}{#if p.kind === 'in'}<ins>{p.text}</ins>{:else if p.kind === 'out'}<del>{p.text}</del>{:else}<span
				>{p.text}</span
			>{/if}{/each}
{/snippet}

<div class="doc">
	<header class="top">
		<a class="back" href="#notes" title="All notes" aria-label="All notes"><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="note" size={24} /></span>
		<div class="heading">
			{#if here && writes && !seen}
				<input
					class="title"
					bind:value={titles[k]}
					onchange={retitle}
					onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					aria-label="The note’s title on {lineName(here)}"
				/>
			{:else}
				<h1 class="title">{(seen ? seen.title : here?.title) ?? item?.title ?? 'A note'}</h1>
			{/if}
			<p class="meta">
				{#if item}<Tags {world} {actor} {api} {busy} entry={item} />{/if}
				{vaultName(item?.vault)}{note ? ` · ${count(note.edits.length, 'edit')}` : ''} ·
				{#if unsaved}<b class="unsaved">Unsaved changes</b>{:else}Every edit signed and saved{/if}
			</p>
		</div>
		<div class="tools">
			{#if here}
				<span class="mode chip" class:warn={!!seen} class:accent={!seen && writes}>
					{#if seen}Viewing version #{seen.n}{:else if !writes}Viewing: {nameOf(as)} only reads it{:else if here.line === null}Editing
						main{:else}Editing proposal “{lineName(here)}”{/if}
				</span>
			{/if}
			{#if unsaved}
				<button class="btn primary" disabled={busy} onclick={save}>Save on {at(here?.line ?? null)}</button>
				<button class="btn quiet" onclick={() => (drafts[k] = here?.text ?? '')}>Discard</button>
			{/if}
			<span class="people">
				{#each holders as h (h.id)}
					<span class="person" title="{nameOf(byId.get(h.id))} {ROLES[h.role]} it"><Mark vault={byId.get(h.id)} size={28} /></span>
				{/each}
			</span>
			{#if owns}
				<button class="btn share" class:primary={!sharing} onclick={() => (sharing = !sharing)}>
					<Icon name="share" size={15} /> Share
				</button>
			{/if}
		</div>
	</header>

	{#if sharing && item}
		<div class="sharebar">
			<span class="who">
				{#each holders as h (h.id)}
					<span class="chip" class:accent={h.id === actor}>{nameOf(byId.get(h.id))} {ROLES[h.role]}</span>
				{/each}
				{#if item?.public}<span class="chip">everyone reads</span>{/if}
			</span>
			<Share {world} {actor} {api} {busy} vault={item.vault} {entry} ondone={() => (sharing = false)} />
		</div>
	{/if}

	{#if !item}
		<p class="soft pad">This browser doesn’t know this note.</p>
	{:else if !loaded}
		<p class="soft pad">Opening the note…</p>
	{:else if !note || !here}
		<div class="empty pad">This browser holds no edit of this note {nameOf(as)} may read.</div>
	{:else}
		<div class="body">
			<aside class="versions" aria-label="Main, proposals and variants">
				<section>
					<h4>Main</h4>
					<button
						class="line"
						class:on={here.line === null}
						aria-current={here.line === null ? 'true' : undefined}
						onclick={() => pick(null)}
					>
						<i class="dot main"></i>
						<span><b>Main</b><small>{count(main.history.length, 'edit')}</small></span>
					</button>
				</section>

				<section>
					<h4>Proposals <small>{proposals.length || ''}</small></h4>
					{#each proposals as l (key(l.line))}
						<button
							class="line"
							class:on={l.line === here.line}
							style:--hue={hue(l.line ?? '')}
							aria-current={l.line === here.line ? 'true' : undefined}
							onclick={() => pick(l.line)}
						>
							<i class="dot"></i>
							<span>
								<b>{lineName(l)}</b>
								<small>{(l.text ?? '') === (main.text ?? '') ? 'reads as main' : 'differs from main'} · {count(l.history.length, 'edit')}</small>
							</span>
						</button>
					{:else}
						<p class="hint soft">None yet. A proposal is a line of its own, to edit apart from main and then accept into it.</p>
					{/each}
					{#if writes}
						{#if naming}
							<div class="naming">
								<label for="proposal-name">New proposal, from {naming.at}</label>
								<input
									id="proposal-name"
									class="field"
									placeholder="Its name"
									bind:value={naming.name}
									onkeydown={(e) => e.key === 'Enter' && propose()}
								/>
								<div class="row">
									<button class="btn primary" disabled={busy || !naming.name.trim()} onclick={propose}>Propose</button>
									<button class="btn quiet" onclick={() => (naming = null)}>Cancel</button>
								</div>
							</div>
						{:else}
							<button class="btn add" disabled={busy} onclick={() => proposeFrom(here.heads, `the latest of ${at(here.line)}`)}>
								<Icon name="proposal" size={14} /> New proposal
							</button>
						{/if}
					{/if}
				</section>

				<section class="variants">
					<h4>Variants <small>{variants.length || ''}</small></h4>
					{#if origin}
						<a class="variant" href="#notes/{origin.entry}">
							<Icon name="back" size={13} /> <span>Variant of <b>“{origin.title}”</b></span>
						</a>
					{:else if item?.variantOf}
						<p class="hint soft">A variant of a note {nameOf(as)} doesn’t read.</p>
					{/if}
					{#each variants as v (v.entry)}
						<a class="variant" href="#notes/{v.entry}">
							<Icon name="variant" size={13} /> <span><b>“{v.title}”</b> <small>in {vaultName(v.vault)}</small></span>
						</a>
					{/each}
					{#if targets.length}
						{#if targets.length > 1}
							<select class="field" bind:value={into} aria-label="Make the variant in">
								{#each targets as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
							</select>
						{/if}
						<button class="btn add" disabled={busy} onclick={variant}>
							<Icon name="variant" size={14} /> Make a variant
						</button>
						<p class="hint soft">
							A new note{targets.length === 1 ? ` in ${nameOf(targets[0])}` : ''}, with its tags, of what {at(here.line)} reads
							now, and none of its history.
						</p>
						{#if made}
							<p class="made">Made a variant. <a href="#notes/{made}">Open it</a></p>
						{/if}
					{/if}
				</section>
			</aside>

			<main class="canvas">
				{#if seen}
					<div class="banner old">
						<span class="chip warn">Version #{seen.n}</span>
						<span class="soft">as it was after: {what(seen)}</span>
						<span class="actions">
							{#if writes && seen.id !== latest}
								<button class="btn primary" disabled={busy} onclick={() => restore(seen.id)}>Restore this version</button>
							{/if}
							{#if writes}
								<button class="btn" disabled={busy} onclick={() => proposeFrom([seen.id], `version #${seen.n}`)}>Propose from here</button>
							{/if}
							<button class="btn quiet" onclick={() => (viewing = '')}>Back to the latest</button>
						</span>
					</div>
				{:else if here.line !== null}
					{@const start = numbered.find((e) => e.id === here.from?.[0])}
					<div class="banner proposal" style:--hue={hue(here.line)}>
						<span>
							<Icon name="proposal" size={15} />
							<span>Proposal <b>“{lineName(here)}”</b>{#if start}, from version #{start.n} of {at(start.line)}{/if}</span>
						</span>
						{#if writes}
							<span class="actions">
								<button class="btn primary" disabled={busy} onclick={() => merge(here.line, null, false)}>Accept into main</button>
								<button class="btn" disabled={busy} onclick={() => merge(here.line, null, true)}>Make main match it</button>
								<button class="btn" disabled={busy} onclick={() => merge(null, here.line, false)}>Update from main</button>
							</span>
						{/if}
					</div>
				{/if}

				<article class="paper" class:old={!!seen}>
					{#if seen}
						<div class="text">{seen.text || '…'}</div>
					{:else if writes}
						<textarea
							class="text"
							use:grow={drafts[k]}
							bind:value={drafts[k]}
							onkeydown={keys}
							placeholder="Start writing"
							aria-label="The note’s text on {lineName(here)}"
						></textarea>
					{:else}
						<div class="text">{here.text || '…'}</div>
					{/if}
				</article>

				{#if seen && (seen.text ?? '') !== (here.text ?? '')}
					<section class="against">
						<h4>What {at(here.line)} has changed since</h4>
						<p class="diff">{@render pieces(diff(seen.text ?? '', here.text ?? ''))}</p>
					</section>
				{:else if !seen && here.line !== null}
					<section class="against">
						<h4>What “{lineName(here)}” changes against main</h4>
						{#if (main.text ?? '') === (here.text ?? '')}
							<p class="soft">It reads the same as main.</p>
						{:else}
							<p class="diff">{@render pieces(diff(main.text ?? '', here.text ?? ''))}</p>
						{/if}
						<p class="hint soft">
							Accepting keeps the changes of both lines; making main match brings main to exactly this text. Both keep every
							edit of each.
						</p>
					</section>
				{/if}
			</main>

			<aside class="history" aria-label="History">
				<header>
					<h4>History</h4>
					<small class="soft">{count(history.length, 'edit')} of {at(here.line)}, newest first</small>
				</header>
				<ol>
					{#each history as e (e.id)}
						{@const changed = e.kind === 'edit' || e.kind === 'merge' || e.kind === 'promote'}
						<li class={e.kind} class:on={e.id === viewing}>
							<button
								class="what"
								disabled={e.kind === 'sealed' || e.text === null}
								aria-pressed={e.id === viewing}
								onclick={() => (viewing = viewing === e.id ? '' : e.id)}
							>
								<b>{what(e)}</b>
								<span class="n mono">#{e.n}</span>
							</button>
							<small class="soft">{who(e)} · <span class="mono" title={e.id}>{short(e.id)}</span></small>
							{#if changed && e.text !== null && (e.before ?? '') !== e.text}
								<p class="diff">{@render pieces(diff(e.before ?? '', e.text))}</p>
							{/if}
							{#if e.id === viewing && writes}
								<div class="row actions">
									{#if e.text !== null && e.id !== latest}
										<button class="btn quiet" disabled={busy} onclick={() => restore(e.id)}>Restore</button>
									{/if}
									{#if (e.kind === 'edit' || e.kind === 'promote') && e.deps.length}
										<button class="btn quiet" disabled={busy} onclick={() => undo(e.id)}>Undo</button>
									{/if}
									<button class="btn quiet" disabled={busy} onclick={() => proposeFrom([e.id], `version #${e.n}`)}>
										Propose from here
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ol>
			</aside>
		</div>
	{/if}
</div>

<style>
	/* the whole screen, as a docs app's document: a bar on top, then three columns, each scrolling on its own */
	.doc {
		display: grid;
		grid-template-rows: auto auto minmax(0, 1fr);
		height: 100%;
		min-height: 0;
		background: #ece8df;
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 0.9rem;
		padding: calc(0.6rem + env(safe-area-inset-top, 0px)) 1rem 0.6rem;
		border-bottom: 1px solid var(--edge);
		background: #f7f5f0;
	}

	.back {
		display: grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 50%;
		color: inherit;
	}

	.back:hover {
		background: rgb(0 0 0 / 0.06);
	}

	.docicon {
		display: grid;
		place-items: center;
		width: 2.3rem;
		height: 2.3rem;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
	}

	.heading {
		flex: 1 1 14rem;
		min-width: 0;
	}

	.title {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		padding: 0.1rem 0.35rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-family: var(--font-body);
		font-size: 1.2rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
		color: inherit;
		overflow-wrap: anywhere;
	}

	input.title:hover {
		border-color: rgb(0 0 0 / 0.15);
	}

	input.title:focus {
		border-color: var(--accent);
		outline: none;
		background: #fff;
	}

	.meta {
		margin: 0.1rem 0 0 0.4rem;
		color: var(--soft);
		font-size: 0.78rem;
	}

	.unsaved {
		color: #8a5a12;
	}

	.tools {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.mode {
		font-size: 0.76rem;
	}

	.people {
		display: flex;
		padding: 0 0.2rem;
	}

	.person + .person {
		margin-left: -0.45rem;
	}

	.person :global(.mark) {
		box-shadow: 0 0 0 2px #f7f5f0;
	}

	.sharebar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--edge);
		background: #fff;
	}

	.sharebar .who {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.pad {
		margin: 1.5rem;
	}

	.body {
		display: grid;
		grid-template-columns: 15rem minmax(0, 1fr) 21rem;
		min-height: 0;
	}

	.versions,
	.canvas,
	.history {
		min-height: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	/* left: the main line, the proposals and the variants */
	.versions {
		padding: 1rem 0.8rem 9rem;
		border-right: 1px solid var(--edge);
		background: #f3f0e9;
	}

	.versions section + section {
		margin-top: 1.3rem;
	}

	h4 {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		margin: 0 0 0.45rem 0.35rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.line {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		width: 100%;
		margin-bottom: 0.15rem;
		padding: 0.45rem 0.55rem;
		border: 0;
		border-radius: 8px;
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.line:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.line.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
	}

	.line span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.line b {
		overflow-wrap: anywhere;
		font-size: 0.88rem;
	}

	.line small {
		color: var(--soft);
		font-size: 0.72rem;
	}

	.dot {
		flex: none;
		width: 0.62rem;
		height: 0.62rem;
		margin-top: 0.3rem;
		border-radius: 50%;
		background: hsl(var(--hue, 170) 45% 45%);
	}

	.dot.main {
		background: var(--accent);
	}

	.hint {
		margin: 0.3rem 0.35rem 0.5rem;
		font-size: 0.76rem;
		line-height: 1.45;
	}

	.add {
		max-width: 100%;
		margin: 0.35rem 0 0 0.2rem;
	}

	.naming {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		margin-top: 0.4rem;
		padding: 0.6rem;
		border-radius: 10px;
		background: #fff;
	}

	.naming label {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.variant {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		padding: 0.4rem 0.55rem;
		border-radius: 8px;
		color: inherit;
		font-size: 0.84rem;
		text-decoration: none;
	}

	.variant:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.variant :global(.icon) {
		margin-top: 0.2rem;
		color: #6a4b9a;
	}

	.variant small {
		color: var(--soft);
	}

	.variants select {
		width: 100%;
		margin: 0.35rem 0 0;
	}

	.made {
		margin: 0.4rem 0.35rem 0;
		font-size: 0.82rem;
	}

	.made a {
		color: var(--accent);
	}

	/* the middle: the note as a page */
	.canvas {
		padding: 1.4rem clamp(0.8rem, 3vw, 2.4rem) 10rem;
	}

	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.8rem;
		max-width: 51rem;
		margin: 0 auto 0.9rem;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		font-size: 0.86rem;
	}

	.banner > span:first-child {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	.banner.proposal {
		background: hsl(var(--hue, 170) 40% 92%);
		color: hsl(var(--hue, 170) 45% 22%);
	}

	.banner.old {
		background: #f7ecd2;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin-left: auto;
	}

	.paper {
		max-width: 51rem;
		min-height: 62vh;
		margin: 0 auto;
		padding: clamp(1.4rem, 5vw, 4.5rem) clamp(1.2rem, 6vw, 5rem);
		box-sizing: border-box;
		background: #fff;
		box-shadow:
			0 1px 3px rgb(60 64 67 / 0.18),
			0 4px 14px rgb(60 64 67 / 0.08);
	}

	.paper.old {
		background: #fffdf6;
	}

	.text {
		display: block;
		width: 100%;
		min-height: 18rem;
		box-sizing: border-box;
		margin: 0;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 1rem;
		line-height: 1.7;
		color: inherit;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		resize: none;
		overflow: hidden;
	}

	textarea.text:focus {
		outline: none;
	}

	.against {
		max-width: 51rem;
		margin: 1rem auto 0;
		padding: 0.9rem 1rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.against h4 {
		margin-left: 0;
	}

	.against .hint {
		margin: 0.5rem 0 0;
	}

	.diff {
		margin: 0.3rem 0 0.2rem;
		line-height: 1.55;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.diff :global(ins) {
		border-radius: 3px;
		background: #d4ecd0;
		color: #1f4d2a;
		text-decoration: none;
	}

	.diff :global(del) {
		border-radius: 3px;
		background: #f6dcd3;
		color: #7a2f1c;
	}

	/* right: the line's history */
	.history {
		padding: 1rem 0.9rem 9rem;
		border-left: 1px solid var(--edge);
		background: #f7f5f0;
	}

	.history header {
		margin: 0 0 0.8rem 0.35rem;
	}

	.history header h4 {
		margin: 0 0 0.15rem;
	}

	.history header small {
		font-size: 0.74rem;
	}

	.history ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.history li {
		position: relative;
		margin-left: 0.4rem;
		padding: 0.1rem 0 0.85rem 1.1rem;
		border-left: 2px solid rgb(0 0 0 / 0.12);
		font-size: 0.84rem;
	}

	.history li::before {
		position: absolute;
		top: 0.4rem;
		left: -0.42rem;
		width: 0.62rem;
		height: 0.62rem;
		border: 2px solid #f7f5f0;
		border-radius: 50%;
		background: var(--accent);
		content: '';
	}

	.history li.propose::before {
		background: #8a6bb8;
	}

	.history li.merge::before,
	.history li.promote::before {
		background: #c99a3a;
	}

	.history li.sealed::before {
		background: rgb(0 0 0 / 0.3);
	}

	.history li.on {
		border-radius: 0 10px 10px 0;
		background: #fff;
	}

	.what {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem;
		width: 100%;
		padding: 0.15rem 0.3rem 0.1rem 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.what:disabled {
		cursor: default;
	}

	.what:hover:not(:disabled) b {
		color: var(--accent);
	}

	.n {
		color: var(--soft);
	}

	.history small {
		display: block;
		font-size: 0.72rem;
	}

	.history .diff {
		font-size: 0.8rem;
	}

	.history .actions {
		margin: 0.35rem 0 0;
	}

	.history .actions .btn {
		padding: 0.16rem 0.5rem;
		font-size: 0.76rem;
	}

	/* narrower: one column, the lines and variants above the page, its history below */
	/* one column under another, scrolled as one: each as tall as what it holds */
	@media (max-width: 1100px) {
		.body {
			display: block;
			overflow-y: auto;
			overscroll-behavior: contain;
		}

		.versions,
		.canvas,
		.history {
			overflow: visible;
		}

		.versions {
			display: flex;
			flex-wrap: wrap;
			gap: 0.6rem 1.4rem;
			padding: 0.8rem 1rem;
			border-right: 0;
			border-bottom: 1px solid var(--edge);
		}

		.versions section {
			flex: 1 1 14rem;
		}

		.versions section + section {
			margin-top: 0;
		}

		.canvas {
			padding-bottom: 2rem;
		}

		.history {
			padding-bottom: 10rem;
			border-left: 0;
			border-top: 1px solid var(--edge);
		}
	}
</style>
