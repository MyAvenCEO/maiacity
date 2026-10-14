<!--
	One note as a docs app shows a document, the whole screen: at the top its title, its vault, its tags, its edits, the
	line being edited, who it is shared with and Share (this note alone, or a rule its tags match); on the left its
	main line and its proposals, each a line of its own to switch to, and its variants, the notes made from it; in the
	middle the note on the line picked, as a page, to edit there, and what a proposal changes since it started, to merge
	it into main, as a pull request merges, or bring main's changes in: a merge keeps every change of both lines, and
	where both changed the same words, main keeps its own unless the person takes the proposal's there; every edit of
	both stays in the history. On the right its history, every edit of that line, newest first,
	each with what it changed, word by word, who made it, and the version it made, to view, restore, undo or propose
	from. A variant is a new note with what a line reads now, and none of its history. Delete marks the note deleted, so
	Notes lists it apart, and its page offers to bring it back; every edit of it stays. All of it acts for the acting
	vault, whose caps the device checks as any peer does: a note it only reads, it reads, every version of it; and a
	button offers what the ops of the caps it writes through allow, as the device answers a dry run of it (`may`): a
	vault that may only suggest changes proposes them, for one whose cap allows it to merge. An edit no rule allows,
	no reader counts, nor anything built on it: the note says how many there are, and shows none of them.
-->
<script>
	import { untrack } from 'svelte';
	import { diff } from './diff.js';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { allowed, blockText, deleting, may, variantMark } from './ops.js';
	import Share from './Share.svelte';
	import Tags from './Tags.svelte';
	import { actingWords, chainSteps, count, hue, nameOf, sharedWith, sharedWords, sharerWords, short } from './vaults.js';

	/**
	 * @typedef {{ at: unknown[], what: 'value' | 'row' | 'order', base: unknown, ours: unknown, theirs: unknown }} Conflict
	 * @typedef {{ line: string | null, name: string | null, from: string[] | null, heads: string[], history: string[],
	 *   title: string | null, text: string | null, blocks: { id: number, type: string }[] | null,
	 *   base: { title: string | null, text: string | null } | null, conflicts: Conflict[] | null }} LineView
	 * @typedef {{ id: string, author: string, actor: string, via: string[], chain: import('./vaults.js').Chain,
	 *   line: string | null, deps: string[],
	 *   kind: 'edit' | 'propose' | 'merge' | 'sealed', name: string | null,
	 *   from: { line: string | null, name: string | null } | null, title: string | null, text: string | null,
	 *   before: string | null, counted: boolean, why: 'builds-on' | 'sealed' | 'unfit' | 'ops' | null }} EditView
	 * @typedef {EditView & { n: number }} Numbered
	 * @typedef {{ vault: string | null, entry: string, lines: LineView[], edits: EditView[] }} NoteData
	 */

	/**
	 * `back` the address its back arrow goes to, `backTo` what it goes to in words: the vault's notes, or the article it
	 * edits.
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string,
	 *   back?: string, backTo?: string }}
	 */
	let { world, actor, api, busy, entry, back = '#notes', backTo = 'All notes' } = $props();

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
	/** the conflicts where the person takes the proposal's value, by place (`place`) */
	let taking = $state(/** @type {Record<string, boolean>} */ ({}));

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
	/** whether the acting vault changes the note, and shares it on, as the device says */
	const writes = $derived(!!item?.writers.includes(actor));
	const owns = $derived(!!item?.sharers.includes(actor));
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const as = $derived(byId.get(actor));
	/** every edit of the note its readers count, numbered in the order the device took them; how many they don't count
	 * as what they make of it breaks its schema, and how many they don't for any other reason */
	const counted = $derived((note?.edits ?? []).filter((e) => e.counted !== false));
	const numbered = $derived(counted.map((e, i) => ({ ...e, n: i + 1 })));
	const unfit = $derived((note?.edits ?? []).filter((e) => e.why === 'unfit').length);
	const uncounted = $derived((note?.edits.length ?? 0) - counted.length - unfit);
	/** the line's edits, newest first */
	const history = $derived.by(() => {
		const on = new Set(here?.history ?? []);
		return numbered.filter((e) => on.has(e.id)).reverse();
	});
	const seen = $derived(viewing ? history.find((e) => e.id === viewing) : undefined);
	/** the line's one latest edit, which restoring changes nothing */
	const latest = $derived(here?.heads.length === 1 ? here.heads[0] : '');
	/** the vaults the acting vault may add the variant to, as the device answers a dry run of making it in each */
	const targets = $derived(world.vaults.filter((v) => can[`variant ${v.id}`] === true));
	/** the notes this browser reads, by entry */
	const notes = $derived(new Map(world.entries.filter((e) => e.type === 'note').map((e) => [e.entry, e])));
	const origin = $derived(item?.variantOf ? notes.get(item.variantOf) : undefined);
	const variants = $derived([...notes.values()].filter((n) => n.variantOf === entry));
	const unsaved = $derived(!!here && writes && !seen && (drafts[k] ?? '') !== (here.text ?? ''));
	/** who the note is shared with: its vault first, then the strongest */
	const shared = $derived(item ? sharedWith(world, item.vault, entry) : { who: [], gone: 0 });
	const sharers = $derived(shared.who);

	/**
	 * What the ops of the caps the acting vault writes through let it do on the line shown, as the device answers a
	 * dry run of each (`may`): save its text (`write`), rename it (`title`, and `heading`, the heading it opens with),
	 * propose, merge the proposal into main, update it from main, restore or undo the version
	 * shown, make a variant in each vault it may add one to (`variant` and the vault, which only a dry run the device
	 * would make offers), and delete the note or bring it back (`delete`, `back`). Elsewhere only the ops' refusal
	 * (`NotAllowed`) holds a button back: what the person then does is the device's to refuse, as any op.
	 */
	let can = $state(/** @type {Record<string, boolean>} */ ({}));
	/** The ops let the acting vault do `what` (`can`), as they do until the device answers. @param {string} what */
	const lets = (what) => can[what] !== false;
	/** Why a button doesn't offer `what`, for its title: nothing where the ops allow it. @param {string} what */
	const barred = (what) => (lets(what) ? undefined : `${nameOf(as)}’s share doesn’t allow it`);
	/** what the acting vault may do on the line, in words, where it writes the note and the ops allow no change */
	const viewOnly = $derived.by(() => {
		if (!writes || lets('write') || lets('title')) return '';
		if (here?.line === null && lets('propose')) return `${nameOf(as)} may only propose changes`;
		return `${nameOf(as)}’s share allows no change here`;
	});

	$effect(() => {
		if (!here) return;
		const [on, blocks, title] = [here.line, here.blocks ?? [], `${here.title ?? ''} `];
		/** @type {Record<string, object>} */
		const asks = Object.fromEntries(world.vaults.map((v) => [`variant ${v.id}`, varying(v.id)]));
		if (writes) {
			asks.write = saving(on, `${here.text ?? ''} `, blocks);
			asks.title = { op: 'set', entry, line: on, path: ['title'], value: title };
			asks.heading = { op: 'set', entry, line: on, path: blockText(1), value: title };
			asks.propose = { op: 'propose', entry, from: here.heads, name: 'a proposal' };
			asks[item?.deleted ? 'back' : 'delete'] = deleting(entry, item?.deleted);
		}
		if (writes && on !== null) {
			asks.merge = { op: 'merge', entry, from: on, into: null };
			asks.update = { op: 'merge', entry, from: null, into: on };
		}
		if (writes && seen) {
			asks.restore = { op: 'restore', entry, line: on, at: [seen.id] };
			asks.undo = { op: 'undo', entry, line: on, edit: seen.id };
		}
		const names = Object.keys(asks);
		let gone = false;
		may(api, actor, Object.values(asks)).then((answers) => {
			/** a variant where the device would make it; else all the ops allow @param {string} n @param {any} a */
			const offers = (n, a) => allowed(a) || (!n.startsWith('variant ') && a.refused !== 'NotAllowed');
			if (!gone) can = Object.fromEntries(names.map((n, i) => [n, offers(n, answers[i])]));
		});
		return () => {
			gone = true;
		};
	});

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

	/** Who made edit `e`: its device by name, the vault it acted for and the owners it acted through. @param {EditView} e */
	const who = (e) => actingWords(world, e.author, e.actor, e.via);

	/** What edit `e` did, in words. @param {Numbered} e */
	function what(e) {
		const elsewhere = e.line !== here?.line ? ` on ${at(e.line)}` : '';
		const from = e.from?.line ?? null;
		switch (e.kind) {
			case 'propose':
				return `Proposed “${e.name ?? '…'}”${e.from ? ` from ${at(from)}` : ''}`;
			case 'merge':
				if (e.line === null) return `Merged ${at(from)} into main`;
				if (from === null) return `Updated ${at(e.line)} from main`;
				return `Merged ${at(from)} into ${at(e.line)}`;
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

	/**
	 * The op that saves `text` on line `on`, whose blocks are `blocks`: its text is its first paragraph, block 2,
	 * which a note written elsewhere may not have yet.
	 * @param {string | null} on @param {string} text @param {{ id: number }[]} blocks
	 */
	function saving(on, text, blocks) {
		const op = blocks.some((b) => b.id === 2)
			? { op: 'set', path: blockText(2), value: text }
			: { op: 'insert', path: ['blocks'], value: { id: 2, type: 'paragraph', text } };
		return { ...op, entry, line: on };
	}

	async function save() {
		if (!here || !unsaved) return;
		const [on, text] = [here.line, drafts[k]];
		await api.run('Saving', { ...saving(on, text, await blocksOn(on)), as: actor });
	}

	async function retitle() {
		const title = (titles[k] ?? '').trim();
		if (!here || !title || title === (here.title ?? '')) return;
		const on = here.line;
		// the heading a note opens with, block 1, is its title too: one write changes both, where the ops allow both
		const heading = lets('heading') && (await blocksOn(on)).some((b) => b.id === 1 && b.type === 'heading');
		const set = (/** @type {unknown[]} */ path) => ({ op: 'set', entry, line: on, path, value: title });
		const ops = heading ? [set(['title']), set(blockText(1))] : [set(['title'])];
		await api.run('Renaming', { op: 'batch', as: actor, ops });
	}

	/** A conflict's place, as the engine names it, as a key. @param {Conflict} c */
	const place = (c) => JSON.stringify({ at: c.at, what: c.what });

	/** Where a conflict is, in words. @param {Conflict} c */
	function where(c) {
		const [field, row] = /** @type {[string, { id?: number } | undefined]} */ (c.at);
		if (c.what === 'order') return `the order of the ${field}`;
		if (c.what === 'value') return `the ${field}`;
		if (field === 'blocks' && row?.id === 1) return 'the heading';
		if (field === 'blocks' && row?.id === 2) return 'the text';
		return `${field} ${row?.id ?? ''}`.trim();
	}

	/** What one side holds at a conflict, in words. @param {unknown} v */
	function holds(v) {
		if (v === null || v === undefined) return 'nothing (taken out)';
		if (typeof v === 'string') return v || '(empty)';
		if (typeof v === 'object' && 'text' in v && typeof v.text === 'string') return v.text || '(empty)';
		return JSON.stringify(v);
	}

	/**
	 * Merge line `from` into line `to`, then show `to`: `to` keeps every change of its own, and takes `from`'s value
	 * at the conflicts the person picked, merging into main.
	 * @param {string | null} from @param {string | null} to
	 */
	async function merge(from, to) {
		/** @type {Conflict[]} */
		const conflicts = to === null ? (lines.find((l) => l.line === from)?.conflicts ?? []) : [];
		const take = conflicts.filter((c) => taking[place(c)]).map((c) => ({ at: c.at, what: c.what }));
		const op = { op: 'merge', as: actor, entry, from, into: to, take };
		if (await api.run('Merging', op)) [line, viewing, taking] = [to, '', {}];
	}

	/**
	 * Delete the note, then go back to the list it is in, the notes or the articles; or with `again`, bring it back.
	 * @param {boolean} again
	 */
	async function remove(again) {
		const done = await api.run(again ? 'Bringing it back' : 'Deleting', { ...deleting(entry, again), as: actor });
		if (done && !again) location.hash = back.split('/')[0];
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

	/** The op that makes a variant of the line shown in vault `target`. @param {string} target */
	function varying(target) {
		// the copy names the note it came from, in place of the note this one came from, if any, in its first write
		const from = item?.variantOf;
		const mark = [
			...(from ? [{ op: 'remove', path: ['tags'], value: variantMark(from) }] : []),
			{ op: 'insert', path: ['tags'], value: variantMark(entry) }
		];
		return { op: 'variant', entry, line: here?.line ?? null, into: target, ops: mark };
	}

	async function variant() {
		const target = targets.some((v) => v.id === into) ? into : targets[0]?.id;
		if (!here || !target) return;
		made = (await api.run('Making the variant', { ...varying(target), as: actor }))?.entry ?? '';
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
		<a class="back" href={back} title={backTo} aria-label={backTo}><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="note" size={24} /></span>
		<div class="heading">
			{#if here && writes && !seen && lets('title')}
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
				{vaultName(item?.vault)}{note ? ` · ${count(numbered.length, 'edit')}` : ''} ·
				{#if unfit}
					<b class="unsaved" title="What they make of the note breaks its schema: no one counts them"
						>{count(unfit, 'edit')} {unfit === 1 ? 'breaks' : 'break'} its schema</b
					> ·
				{/if}
				{#if uncounted}
					<b class="unsaved" title="Their shares don’t allow what they change: no one counts them"
						>{count(uncounted, 'edit')} not allowed</b
					> ·
				{/if}
				{#if unsaved}<b class="unsaved">Unsaved changes</b>{:else}Every edit signed and saved{/if}
			</p>
			{#if item}
				<p class="meta">Shared with {sharedWords(shared)}{item.public ? ' · Public' : ''}</p>
			{/if}
		</div>
		<div class="tools">
			{#if here}
				<span class="mode chip" class:warn={!!seen} class:accent={!seen && writes && !viewOnly}>
					{#if seen}
						Viewing version #{seen.n}
					{:else if !writes}
						Viewing: {nameOf(as)} may only view it
					{:else if viewOnly}
						Viewing: {viewOnly}
					{:else if here.line === null}
						Editing main
					{:else}
						Editing proposal “{lineName(here)}”
					{/if}
				</span>
			{/if}
			{#if unsaved}
				<button class="btn primary" disabled={busy} onclick={save}>Save on {at(here?.line ?? null)}</button>
				<button class="btn quiet" onclick={() => (drafts[k] = here?.text ?? '')}>Discard</button>
			{/if}
			<span class="people">
				{#each sharers.filter((x) => byId.has(x.id)) as x (x.id)}
					<span class="person" title="Shared with {sharerWords(x)}"><Mark vault={byId.get(x.id)} size={28} /></span>
				{/each}
			</span>
			{#if owns}
				<button class="btn share" class:primary={!sharing} onclick={() => (sharing = !sharing)}>
					<Icon name="share" size={15} /> Share
				</button>
			{/if}
			{#if writes && item && !item.deleted}
				<button
					class="btn quiet danger"
					disabled={busy || !lets('delete')}
					title={barred('delete') ?? 'Delete the note: Notes lists it apart, and every edit stays'}
					onclick={() => remove(false)}
				>
					<Icon name="trash" size={15} /> Delete
				</button>
			{/if}
		</div>
	</header>

	{#if item?.deleted}
		<div class="gone" role="status">
			<Icon name="trash" size={16} />
			<span>This note is deleted: Notes lists it under Deleted, and every edit of it stays.</span>
			{#if writes}
				<button class="btn primary" disabled={busy || !lets('back')} title={barred('back')} onclick={() => remove(true)}
					>Bring it back</button
				>
			{/if}
		</div>
	{/if}

	{#if sharing && item}
		<div class="sharebar">
			<span class="who">
				<span class="soft">Shared with</span>
				{#each sharers as x (x.id)}
					<span class="chip" class:accent={x.id === actor}>{sharerWords(x)}</span>
				{/each}
				{#if item?.public}<span class="chip">Public</span>{/if}
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
						<p class="hint soft">None yet. A proposal is a line of its own, to edit apart from main and then merge into it.</p>
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
							<button
								class="btn add"
								disabled={busy || !lets('propose')}
								title={barred('propose')}
								onclick={() => proposeFrom(here.heads, `the latest of ${at(here.line)}`)}
							>
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
								<button
									class="btn primary"
									disabled={busy || !lets('restore')}
									title={barred('restore')}
									onclick={() => restore(seen.id)}>Restore this version</button
								>
							{/if}
							{#if writes}
								<button
									class="btn"
									disabled={busy || !lets('propose')}
									title={barred('propose')}
									onclick={() => proposeFrom([seen.id], `version #${seen.n}`)}
								>
									Propose from here
								</button>
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
								<button
									class="btn primary"
									disabled={busy || !lets('merge')}
									title={barred('merge')}
									onclick={() => merge(here.line, null)}>Merge into main</button
								>
								<button
									class="btn"
									disabled={busy || !lets('update')}
									title={barred('update')}
									onclick={() => merge(null, here.line)}>Update from main</button
								>
							</span>
						{/if}
					</div>
				{/if}

				<article class="paper" class:old={!!seen}>
					{#if seen}
						<div class="text">{seen.text || '…'}</div>
					{:else if writes && lets('write')}
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
					{@const base = here.base ?? main}
					{@const conflicts = here.conflicts ?? []}
					<section class="against">
						<h4>What “{lineName(here)}” changes</h4>
						{#if (base.text ?? '') === (here.text ?? '')}
							<p class="soft">Nothing in its text since it started from main.</p>
						{:else}
							<p class="diff">{@render pieces(diff(base.text ?? '', here.text ?? ''))}</p>
						{/if}
						{#if (base.text ?? '') !== (main.text ?? '')}
							<p class="hint soft">Main changed too since then. Merging keeps those changes.</p>
						{/if}
						{#if conflicts.length}
							<div class="conflicts">
								<h5>{count(conflicts.length, 'conflict')}: both changed the same place</h5>
								{#each conflicts as c (place(c))}
									<div class="conflict">
										<b>{where(c)}</b>
										<p><small class="soft">main</small> {holds(c.ours)}</p>
										<p><small class="soft">“{lineName(here)}”</small> {holds(c.theirs)}</p>
										{#if writes}
											<label>
												<input type="checkbox" bind:checked={taking[place(c)]} />
												Use “{lineName(here)}”’s here
											</label>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
						<p class="hint soft">
							Merging into main works as a pull request: main keeps every change it made, and all this proposal changed
							comes in.{#if conflicts.length}
								Where both changed the same words, main keeps its own unless you pick the proposal’s.{/if} Every edit of
							both stays in the history.
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
						{@const changed = e.kind === 'edit' || e.kind === 'merge'}
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
							{#if e.id === viewing}
								<ol class="chain" aria-label="Who stands behind it">
									{#each chainSteps(world, e.chain) as step, i (i)}<li>{step.says}</li>{/each}
								</ol>
							{/if}
							{#if e.id === viewing && writes}
								<div class="row actions">
									{#if e.text !== null && e.id !== latest}
										<button
											class="btn quiet"
											disabled={busy || !lets('restore')}
											title={barred('restore')}
											onclick={() => restore(e.id)}>Restore</button
										>
									{/if}
									{#if e.kind === 'edit' && e.deps.length}
										<button
											class="btn quiet"
											disabled={busy || !lets('undo')}
											title={barred('undo')}
											onclick={() => undo(e.id)}>Undo</button
										>
									{/if}
									<button
										class="btn quiet"
										disabled={busy || !lets('propose')}
										title={barred('propose')}
										onclick={() => proposeFrom([e.id], `version #${e.n}`)}
									>
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

	.gone {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 0.8rem;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--edge);
		background: #f6e7e1;
		color: #7a3422;
		font-size: 0.86rem;
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

	.conflicts {
		display: grid;
		gap: 0.5rem;
		margin-top: 0.8rem;
	}

	.conflicts h5 {
		margin: 0;
		color: #7a4d10;
		font-size: 0.8rem;
	}

	.conflict {
		display: grid;
		gap: 0.25rem;
		padding: 0.55rem 0.7rem;
		border-left: 3px solid #c99a3a;
		border-radius: 0 8px 8px 0;
		background: #fbf6ea;
		font-size: 0.85rem;
	}

	.conflict p {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.conflict small {
		display: inline-block;
		min-width: 4.5rem;
	}

	.conflict label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.8rem;
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

	.history li.merge::before {
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

	/* who stands behind the edit viewed, link by link back to the passkeys */
	.history ol.chain {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
		list-style: decimal;
		color: var(--soft);
		font-size: 0.76rem;
	}

	.history ol.chain li {
		margin: 0;
		padding: 0.08rem 0;
		border: 0;
		font-size: inherit;
	}

	.history ol.chain li::before {
		content: none;
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
