<!--
	One note as a docs app shows a document, the whole screen: at the top, in a bar of its own over the layout every
	avenDB view has (./Frame.svelte, bare), its title, its vault, its tags, its edits, the line being edited, who it is
	shared with and Share (this note alone, or a rule its tags match); on the left, on a spark, what its canvas can take
	(./SparkShelf.svelte); in the middle the note on the line picked, as a page, to edit there (a spark's canvas, an
	article as it is read), and what a proposal changes since it started, to merge it into main, as a pull request
	merges, or bring main's changes in: a merge keeps every change of both lines, and where both changed the same words,
	main keeps its own unless the person takes the proposal's there; a conflict on a row of a record that holds rows says
	where under it both changed it, at any depth ("the text of row 11 of its kids"); every edit of both stays in the
	history. On the right, avenDB's one version side (./Lines.svelte), in two tabs: its history, every edit of that
	line, newest first, each with what it changed, word by word, or for a record that is no document the places it
	changed, at any depth, who made it, and the version it made, to view, restore, undo or propose from; and its
	versions, its main line, its proposals and its variants, each a line of its own to switch to, and its copies, the
	notes made from it. Narrower, the right side slides in from
	the round button at the bottom right, and on a phone the left one from the bottom left. A variant is a line that
	stays open beside main and follows it: each merge into main brings main into it, and it keeps its own where both
	changed one place; its numbers are its own ("Silkie v3"), and it says which main version it holds. A copy is a new
	note with what a line reads now, whose first edit names that note and that version by the hashes of its edits
	(avendb's `fork_mark`): its history goes on into the original's edits up to that version, for whoever reads both,
	and the original lists its copies by the version each came from. Delete marks the note deleted, so Sparks lists it
	apart, and its page offers to bring it back; every edit of it stays. All of it acts for the acting vault, whose caps
	the device checks as any peer does: a note it only reads, it reads, every version of it; and a button offers what
	the ops of the caps it writes through allow, as the device answers a dry run of it (`may`): a vault that may only
	suggest changes proposes them, for one whose cap allows it to merge. An edit no rule allows, no reader counts, nor
	anything built on it: the note says how many there are, and shows none of them.
-->
<script>
	import { untrack } from 'svelte';
	import ArticleView from './ArticleView.svelte';
	import { diff } from './diff.js';
	import { flowsFor, stageOf } from './flows.js';
	import { entryCollection } from './entry-collection.svelte.js';
	import { entryDetail } from './entry-detail.svelte.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import Lines from './Lines.svelte';
	import Mark from './Mark.svelte';
	import { allowed, blockText, deleting, may } from './ops.js';
	import { at as atPath, changeWords, clashes, pathWords, valueWords } from './paths.js';
	import Share from './Share.svelte';
	import SparkCanvas from './SparkCanvas.svelte';
	import SparkShelf from './SparkShelf.svelte';
	import Tags from './Tags.svelte';
	import { editWords, lineName, versionWords } from './versions.js';

	/** Whether a record of kind `kind` keeps its text in one field, `text`: an article, a story or a post.
	 *  @param {string | null | undefined} kind */
	const textual = (kind) => kind === 'article' || kind === 'story' || !!kind?.startsWith('post');
	import {
		actingWords,
		count,
		hue,
		nameOf,
		sharedWith,
		sharedWords,
		sharerWords,
		short
	} from './vaults.js';

	/**
	 * @typedef {{ at: unknown[], what: 'value' | 'row' | 'order', base: unknown, ours: unknown, theirs: unknown }} Conflict
	 * @typedef {{ line: string | null, name: string | null, from: string[] | null, heads: string[], history: string[],
	 *   title: string | null, text: string | null, blocks: { id: number, type: string }[] | null,
	 *   base: { title: string | null, text: string | null } | null, conflicts: Conflict[] | null, record?: any,
	 *   version?: import('./versions.js').Described, versions?: { edit: string, version: number }[],
	 *   variant?: boolean, main?: import('./versions.js').Described | null, behind?: boolean }} LineView
	 * @typedef {{ id: string, author: string, actor: string, via: string[], chain: import('./vaults.js').Chain,
	 *   line: string | null, deps: string[],
	 *   kind: 'edit' | 'propose' | 'variant' | 'merge' | 'accept' | 'sealed', name: string | null,
	 *   from: { line: string | null, name: string | null } | null, title: string | null, text: string | null,
	 *   before: string | null, counted: boolean, version?: number | null,
	 *   authors?: { vault: string, name: string | null, kind: string | null }[] | null,
	 *   why: 'builds-on' | 'sealed' | 'unfit' | 'policy' | 'ops' | null }} EditView
	 * @typedef {EditView & { n: number }} Numbered
	 * @typedef {{ vault: string | null, entry: string, kind: string | null, lines: LineView[],
	 *   edits: EditView[] }} NoteData
	 */

	/**
	 * `back` the address its back arrow goes to, `backTo` what it goes to in words: the vault's sparks, or the article
	 * it edits.
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string,
	 *   back?: string, backTo?: string }}
	 */
	let { world, actor, api, busy, entry, back = '#sparks', backTo = 'All sparks' } = $props();

	const detail = entryDetail(() => api, () => entry ? { op: 'note', entry } : null);
	const loaded = $derived(detail.phase !== 'loading');
	const note = $derived(/** @type {NoteData | null} */ (detail.value));

	/** the line picked: `null` for the main line, else the id of its proposal's or variant's first edit */
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
	/** a new proposal or variant being named: which, the version it starts from, that version in words, and its name */
	let naming = $state(
		/** @type {{ kind: 'propose' | 'variant', from: string[], at: string, name: string } | null} */ (null)
	);
	/** the vault a copy goes to, and the copy made */
	let into = $state('');
	let made = $state('');
	let sharing = $state(false);
	/** narrower, the side that slides in, if one does: a spark's shelf (`nav`) or the history and lines (`aside`) */
	let open = $state(/** @type {'' | 'nav' | 'aside'} */ (''));
	/** what the right side shows: the history, or the lines (main, the proposals, the variants) and the copies */
	let side = $state('history');
	/** the conflicts where the person takes the proposal's value, by place (`place`) */
	let taking = $state(/** @type {Record<string, boolean>} */ ({}));

	const collection = entryCollection(() => api, () => ({ op: 'entry_views', entries: [entry], as: actor }));
	const item = $derived(collection.rows.find((e) => e.entry === entry));

	/**
	 * What each write of a record that is no document or article changed (the `history` op's changes, avendb's
	 * `ops::diff`), by its edit, in words: the places it set or took out at any depth, and the lists whose rows it
	 * changed. A document's and an article's show as their text's diff instead. Read again each time the note is.
	 */
	const historyDetail = entryDetail(() => api, () => !note || note.kind === 'document' || (textual(note.kind) && note.kind !== 'story') ? null : { op: 'history', entry });
	const changed = $derived.by(() => {
		/** @type {Record<string, string[]>} */
		const by = {};
		for (const x of historyDetail.value?.edits ?? []) if (x.changes?.length) by[x.id] = x.changes.map(changeWords);
		return by;
	});
	// The original may belong to another vault; its explicit ID retains the same authorization path.
	const originalDetail = entryDetail(() => api, () => item?.forkOf ? { op: 'note', entry: item.forkOf } : null);
	const original = $derived(/** @type {NoteData | null} */ (originalDetail.value));

	const key = (/** @type {string | null} */ l) => l ?? '';
	const lines = $derived(note?.lines ?? []);
	const here = $derived(lines.find((l) => l.line === line) ?? lines[0]);
	/** whether its text is one field of its record, its title no heading: an article of avenDB's article schema, a story's
	 *  full text, or a post's */
	const article = $derived(textual(note?.kind));
	/** whether it is a spark (./sparks.js), its fields beside its text */
	const spark = $derived(note?.kind === 'spark' || item?.type === 'spark');
	/** an article's stage in its flow (./flows.js), its eyebrow as it is read */
	const stage = $derived.by(() => {
		const flow = item && article ? flowsFor(world, item.vault, item.type ?? '')[0] : undefined;
		return item && flow ? stageOf(item, flow) : null;
	});
	const main = $derived(lines[0]);
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
	/** each of them by its id, as the side (./Lines.svelte) hands an edit back */
	const byEdit = $derived(new Map(numbered.map((e) => [e.id, e])));
	const unfit = $derived((note?.edits ?? []).filter((e) => e.why === 'unfit').length);
	const uncounted = $derived((note?.edits.length ?? 0) - counted.length - unfit);
	/** the line's edits, newest first */
	const history = $derived.by(() => {
		const on = new Set(here?.history ?? []);
		return numbered.filter((e) => on.has(e.id)).reverse();
	});
	const seen = $derived(viewing ? history.find((e) => e.id === viewing) : undefined);
	/** an edit's version in words: its number where it is a release of main (each merge into main is the next) or of a
	 * variant (each time it follows main, or takes a proposal), else its place among the note's edits */
	const versionOf = (/** @type {Numbered} */ e) =>
		!e.version || (e.line !== null && !lineOf(e.line).variant)
			? `edit #${e.n}`
			: e.line === null
				? `v${e.version}`
				: `${lineName(lineOf(e.line))} v${e.version}`;
	/** whether its left side lists what its canvas can take: a spark's latest, not a version of it looked back at */
	const shelf = $derived(spark && !seen);
	/** the line's one latest edit, which restoring changes nothing */
	const latest = $derived(here?.heads.length === 1 ? here.heads[0] : '');
	/** the vaults the acting vault may add the copy to, as the device answers a dry run of making it in each */
	const targets = $derived(world.vaults.filter((v) => can[`fork ${v.id}`] === true));
	/** the notes this browser reads, by entry */
	const notes = $derived(new Map(world.entries.filter((e) => e.type === 'note').map((e) => [e.entry, e])));
	const origin = $derived(item?.forkOf ? notes.get(item.forkOf) : undefined);
	const copies = $derived([...notes.values()].filter((n) => n.forkOf === entry));
	/**
	 * The original's edits this note's history goes on into, newest first: those of the version it was made from and
	 * every edit they build on, numbered as the original numbers them.
	 */
	const inherited = $derived.by(() => {
		const edits = (original?.edits ?? []).filter((e) => e.counted !== false);
		const byEdit = new Map(edits.map((e, i) => [e.id, { ...e, n: i + 1 }]));
		const held = new Set();
		const todo = [...(item?.forkAt ?? [])];
		while (todo.length) {
			const id = /** @type {string} */ (todo.pop());
			const e = byEdit.get(id);
			if (!e || held.has(id)) continue;
			held.add(id);
			todo.push(...e.deps);
		}
		return [...byEdit.values()].filter((e) => held.has(e.id)).reverse();
	});
	/** The version of this note copy `v` was made from, in words: its number, as the history numbers it. */
	const madeAt = (/** @type {import('./vaults.js').EntryView} */ v) => {
		const n = (v.forkAt ?? []).map((id) => numbered.find((e) => e.id === id)?.n).filter((n) => n !== undefined);
		return n.length ? `from edit #${Math.max(.../** @type {number[]} */ (n))}` : '';
	};
	const unsaved = $derived(!!here && writes && !seen && (drafts[k] ?? '') !== (here.text ?? ''));
	/** who the note is shared with: its vault first, then the strongest */
	const shared = $derived(item ? sharedWith(world, item.vault, entry) : { who: [], gone: 0 });
	const sharers = $derived(shared.who);

	/**
	 * What the ops of the caps the acting vault writes through let it do on the line shown, as the device answers a
	 * dry run of each (`may`): save its text (`write`), rename it (`title`, and `heading`, the heading it opens with),
	 * propose, start a variant, merge the proposal into main, update it from main, restore or undo the version
	 * shown, make a copy in each vault it may add one to (`fork` and the vault, which only a dry run the device
	 * would make offers), and delete the note or bring it back (`delete`, `back`). Elsewhere only the ops' refusal
	 * (`NotAllowed`) holds a button back, and a merge into main the vault hasn't accepted (`NotAccepted`, `waits`):
	 * what the person then does is the device's to refuse, as any op.
	 */
	let can = $state(/** @type {Record<string, boolean>} */ ({}));
	/** what waits for the vault's accept: a merge into main through a share */
	let waits = $state(/** @type {Record<string, boolean>} */ ({}));
	/** The ops let the acting vault do `what` (`can`), as they do until the device answers. @param {string} what */
	const lets = (what) => can[what] !== false;
	/** Why a button doesn't offer `what`, for its title: nothing where the ops allow it. @param {string} what */
	const barred = (what) =>
		lets(what)
			? undefined
			: waits[what]
				? 'one of the vault’s owners accepts the proposal first'
				: `${nameOf(as)}’s share doesn’t allow it`;
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
		const asks = Object.fromEntries(world.vaults.map((v) => [`fork ${v.id}`, forking(v.id)]));
		if (writes) {
			asks.write = saving(on, `${here.text ?? ''} `, blocks);
			asks.title = { op: 'set', entry, line: on, path: ['title'], value: title };
			if (!article) asks.heading = { op: 'set', entry, line: on, path: blockText(1), value: title };
			asks.propose = { op: 'propose', entry, from: here.heads, name: 'a proposal' };
			asks.variant = { op: 'variant', entry, from: here.heads, name: 'a variant' };
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
			/** what the device refuses, if it does @param {any} a @returns {string | null} */
			const refused = (a) => a?.refused ?? null;
			/** a copy where the device would make it; else all the ops allow @param {string} n @param {any} a */
			const offers = (n, a) =>
				allowed(a) || (!n.startsWith('fork ') && !['NotAllowed', 'NotAccepted'].includes(refused(a) ?? ''));
			if (gone) return;
			can = Object.fromEntries(names.map((n, i) => [n, offers(n, answers[i])]));
			waits = Object.fromEntries(names.map((n, i) => [n, refused(answers[i]) === 'NotAccepted']));
		});
		return () => {
			gone = true;
		};
	});

	let draftEntry = '';
	$effect(() => {
		const now = lines, currentEntry = entry;
		untrack(() => {
			if (draftEntry !== currentEntry) {
				drafts = {}; titles = {}; shown = {}; named = {};
				line = null; viewing = ''; draftEntry = currentEntry;
			}
			for (const l of now) {
				const at = key(l.line);
				// a line the person isn't editing follows what arrives
				if (drafts[at] === undefined || drafts[at] === shown[at]) drafts[at] = l.text ?? '';
				if (titles[at] === undefined || titles[at] === named[at]) titles[at] = l.title ?? '';
				[shown[at], named[at]] = [l.text ?? '', l.title ?? ''];
			}
		});
	});

	/** Line `l` of the note. @param {string | null} l @returns {{ line: string | null, name: string | null, variant?: boolean }} */
	const lineOf = (l) => lines.find((x) => x.line === l) ?? { line: l, name: null };
	/** Line `l` quoted, as a sentence names it. @param {string | null} l */
	const at = (l) => `“${lineName(lineOf(l))}”`;

	/** Vault `id`, by name. @param {string | undefined} id */
	const vaultName = (id) => (id ? nameOf(byId.get(id)) : 'a vault');

	/** Who made edit `e`: its device by name, the vault it acted for and the owners it acted through. @param {EditView} e */
	const who = (e) => actingWords(world, e.author, e.actor, e.via);

	/**
	 * What edit `e` did where a note says it in its own words: renamed it, its text as it was. Elsewhere avenDB's
	 * words (./versions.js `editWords`).
	 * @param {{ id: string }} x
	 */
	function renamed(x) {
		const e = byEdit.get(x.id);
		if (!e || e.kind !== 'edit' || !e.deps.length) return undefined;
		const before = byEdit.get(e.deps[0]);
		const yes = e.text === e.before && before && e.title !== null && before.title !== null && e.title !== before.title;
		return yes ? `Renamed it “${e.title}”${e.line !== here?.line ? ` on ${at(e.line)}` : ''}` : undefined;
	}

	/** What edit `e` did, in words. @param {Numbered} e */
	const what = (e) => renamed(e) ?? editWords(e, lines, here?.line, 'the note');

	/** What edit `e` of the original did, in words, its lines named as the original names them. @param {Numbered} e */
	const theirs = (e) => editWords(e, original?.lines ?? [], null, 'the note');

	/** Pick line `l` to show and edit. @param {string | null} l */
	function pick(l) {
		[line, viewing, naming, open] = [l, '', null, ''];
	}

	/** Name a new proposal from version `from`, `words` saying which. @param {string[]} from @param {string} words */
	function proposeFrom(from, words) {
		naming = { kind: 'propose', from, at: words, name: '' };
	}

	/** Name a new variant from version `from`, `words` saying which. @param {string[]} from @param {string} words */
	function varyFrom(from, words) {
		naming = { kind: 'variant', from, at: words, name: '' };
	}

	/** Start the proposal or the variant being named, and show it. */
	async function propose() {
		const name = naming?.name.trim();
		if (!naming || !name) return;
		const [op, doing] = naming.kind === 'variant' ? ['variant', 'Starting the variant'] : ['propose', 'Proposing'];
		const made = await api.run(doing, { op, as: actor, entry, from: naming.from, name });
		if (made) [line, viewing, naming] = [made.line, '', null];
	}

	/** The blocks of the note on line `on`, as its schema reads them: none if the device can't read it.
	 *  @param {string | null} on @returns {Promise<{ id: number, type: string }[]>} */
	async function blocksOn(on) {
		const got = await api.ask({ op: 'get', entry, line: on });
		return got.ok?.record?.blocks ?? [];
	}

	/**
	 * The op that saves `text` on line `on`, whose blocks are `blocks`: an article's text is its own field; a note's,
	 * its first paragraph, block 2, which a note written elsewhere may not have yet.
	 * @param {string | null} on @param {string} text @param {{ id: number }[]} blocks
	 */
	function saving(on, text, blocks) {
		const op = article
			? { op: 'set', path: ['text'], value: text }
			: blocks.some((b) => b.id === 2)
				? { op: 'set', path: blockText(2), value: text }
				: { op: 'insert', path: ['blocks'], value: { id: 2, type: 'paragraph', text } };
		return { ...op, entry, line: on };
	}

	async function save() {
		if (!here || !unsaved) return;
		const [on, text, target, acting, owner] = [here.line, drafts[k], entry, actor, api];
		const blocks = await blocksOn(on);
		if (entry !== target || actor !== acting || api !== owner) return;
		await owner.run('Saving', { ...saving(on, text, blocks), as: acting });
	}

	async function retitle() {
		const title = (titles[k] ?? '').trim();
		if (!here || !title || title === (here.title ?? '')) return;
		const [on, target, acting, owner] = [here.line, entry, actor, api];
		// the heading a note opens with, block 1, is its title too: one write changes both, where the ops allow both
		const heading = lets('heading') && (await blocksOn(on)).some((b) => b.id === 1 && b.type === 'heading');
		if (entry !== target || actor !== acting || api !== owner) return;
		const set = (/** @type {unknown[]} */ path) => ({ op: 'set', entry, line: on, path, value: title });
		const ops = heading ? [set(['title']), set(blockText(1))] : [set(['title'])];
		await api.run('Renaming', { op: 'batch', as: actor, ops });
	}

	/** A conflict's place, as the engine names it, as a key. @param {Conflict} c */
	const place = (c) => JSON.stringify({ at: c.at, what: c.what });

	/** Where a conflict is, in words: a field, the order of a list, or a row of a list. @param {Conflict} c */
	function where(c) {
		const [field, row] = /** @type {[string, { id?: number } | undefined]} */ (c.at);
		if (c.what === 'order') return `the order of ${pathWords([field])}`;
		if (c.what === 'value') return pathWords(/** @type {string[]} */ (c.at));
		if (field === 'blocks' && row?.id === 1) return 'the heading';
		if (field === 'blocks' && row?.id === 2) return 'the text';
		return pathWords(/** @type {any[]} */ (c.at));
	}

	/**
	 * Where under a conflict's row both lines changed it differently, at any depth (./paths.js `clashes`): each place
	 * in words, as a place of the row, and what main and the proposal hold there. A conflict on a field, a list's order,
	 * or a document's heading or text is its one place.
	 * @param {Conflict} c
	 */
	function spots(c) {
		const [field] = /** @type {[string]} */ (c.at);
		if (c.what !== 'row' || field === 'blocks') return [{ key: '', words: '', ours: c.ours, theirs: c.theirs }];
		const top = /** @type {any[]} */ (c.at);
		return clashes(top, c.base, c.ours, c.theirs).map((p) => {
			const under = p.slice(top.length);
			const words = under.length ? pathWords(under) : '';
			return { key: JSON.stringify(p), words, ours: atPath(c.ours, under), theirs: atPath(c.theirs, under) };
		});
	}

	/** What one side holds at a conflict, in words. @param {unknown} v */
	function holds(v) {
		if (v === null || v === undefined) return 'nothing (taken out)';
		if (typeof v === 'string') return v || '(empty)';
		if (typeof v === 'object' && 'text' in v && typeof v.text === 'string') return v.text || '(empty)';
		return valueWords(v);
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

	/**
	 * The op that makes a copy of the line shown in vault `target`: the device marks the copy, in its first write,
	 * with this note and the version it copies.
	 * @param {string} target
	 */
	const forking = (target) => ({ op: 'fork', entry, line: here?.line ?? null, into: target });

	async function fork() {
		const target = targets.some((v) => v.id === into) ? into : targets[0]?.id;
		if (!here || !target) return;
		made = (await api.run('Making the copy', { ...forking(target), as: actor }))?.entry ?? '';
	}

	/**
	 * Fit a textarea to its text, as a page grows with what is written on it, again when `text` arrives and when its
	 * width changes. Svelte runs an action's update before `bind:value` puts the new text in the field, so an update
	 * fits again on the next frame: else a long text that arrives after the page opens stays cut at the first height.
	 * The column that scrolls keeps its place while the field is measured.
	 * @param {HTMLTextAreaElement} el @param {string} [text]
	 */
	function grow(el, text) {
		void text;
		/** the nearest ancestor that scrolls */
		const pane = () => {
			for (let p = el.parentElement; p; p = p.parentElement) {
				if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
			}
			return null;
		};
		const fit = () => {
			const scroller = pane();
			const top = scroller?.scrollTop ?? 0;
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight}px`;
			if (scroller) scroller.scrollTop = top;
		};
		let frame = 0;
		const soon = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(fit);
		};
		let width = 0;
		const resized = new ResizeObserver(([e]) => {
			if (e.contentRect.width === width) return;
			width = e.contentRect.width;
			fit();
		});
		fit();
		soon();
		resized.observe(el);
		el.addEventListener('input', fit);
		return {
			update: () => (fit(), soon()),
			destroy: () => {
				cancelAnimationFrame(frame);
				resized.disconnect();
				el.removeEventListener('input', fit);
			}
		};
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

<!-- on the left, on a spark’s latest: what its canvas can take (./SparkShelf.svelte) -->
{#snippet shelfNav()}
	{#if item && here}
		<SparkShelf {world} {actor} {api} {busy} {entry} vault={item.vault} line={here.line} record={here.record} {writes} />
	{/if}
{/snippet}

<!-- on the right: the line’s history, or its lines (main, the proposals, the variants) and its copies, avenDB's one
	version side (./Lines.svelte) -->
{#snippet historyAside()}
	{#if here}
		<Lines
			{world}
			{note}
			line={here.line}
			at={viewing}
			bind:tab={side}
			thing="the note"
			onpick={pick}
			onopen={(e) => (viewing = viewing === e.id ? '' : e.id)}
			opens={(e) => byEdit.get(e.id)?.text != null}
			about={(l) => (l.variant ? undefined : (lines.find((x) => x.line === l.line)?.text ?? '') === (main.text ?? '') ? 'reads as main' : 'differs from main')}
			said={renamed}
			also={copies.length}
			{adding}
			below={changes}
			after={inheritedHistory}
			versions={copiesOf}
		/>
	{/if}
{/snippet}

<!-- under its proposals and its variants: a new one, named here first -->
{#snippet adding(/** @type {'propose' | 'variant'} */ kind)}
	{#if writes && here && kind === 'propose'}
		{#if naming}
			<div class="naming">
				<label for="proposal-name">New {naming.kind === 'variant' ? 'variant' : 'proposal'}, from {naming.at}</label>
				<input
					id="proposal-name"
					class="field"
					placeholder="Its name"
					bind:value={naming.name}
					onkeydown={(e) => e.key === 'Enter' && propose()}
				/>
				<div class="row">
					<button class="btn primary" disabled={busy || !naming.name.trim()} onclick={propose}
						>{naming.kind === 'variant' ? 'Start it' : 'Propose'}</button
					>
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
	{:else if writes && kind === 'variant' && !naming}
		<button
			class="btn add"
			disabled={busy || !lets('variant')}
			title={barred('variant')}
			onclick={() => varyFrom(main.heads, `the latest of main`)}
		>
			<Icon name="variant" size={14} /> New variant
		</button>
	{/if}
{/snippet}

<!-- under its lines: the note it is a copy of, its copies, and a new one -->
{#snippet copiesOf()}
	<div class="copies">
		<h4>Copies <small>{copies.length || ''}</small></h4>
		{#if origin}
			<a class="variant" href="#notes/{origin.entry}">
				<Icon name="back" size={13} /> <span>Copy of <b>“{origin.title}”</b></span>
			</a>
		{:else if item?.forkOf}
			<p class="hint soft">A copy of a note {nameOf(as)} doesn’t read.</p>
		{/if}
		{#each copies as v (v.entry)}
			<a class="variant" href="#notes/{v.entry}">
				<Icon name="variant" size={13} />
				<span><b>“{v.title}”</b> <small>in {vaultName(v.vault)} {madeAt(v)}</small></span>
			</a>
		{/each}
		{#if targets.length && here}
			{#if targets.length > 1}
				<select class="field" bind:value={into} aria-label="Make the copy in">
					{#each targets as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
				</select>
			{/if}
			<button class="btn add" disabled={busy} onclick={fork}>
				<Icon name="variant" size={14} /> Make a copy
			</button>
			<p class="hint soft">
				A new note{targets.length === 1 ? ` in ${nameOf(targets[0])}` : ''}, with its tags, of what {at(here.line)} reads
				now. Its history goes on into this note's, up to this version.
			</p>
			{#if made}
				<p class="made">Made a copy. <a href="#notes/{made}">Open it</a></p>
			{/if}
		{/if}
	</div>
{/snippet}

<!-- under an edit of its history: what it changed, and for the one shown, what may be done with it -->
{#snippet changes(/** @type {{ id: string }} */ x)}
	{@const e = byEdit.get(x.id)}
	{#if e}
		{@const wrote = e.kind === 'edit' || e.kind === 'merge'}
		{#if wrote && e.text !== null && (e.before ?? '') !== e.text}
			<p class="diff edit-diff">{@render pieces(diff(e.before ?? '', e.text))}</p>
		{:else if wrote && changed[e.id]}
			{@const said = changed[e.id]}
			<ul class="changes">
				{#each said.slice(0, 4) as w, i (i)}<li>{w}</li>{/each}
				{#if said.length > 4}<li class="soft">and {count(said.length - 4, 'change')} more</li>{/if}
			</ul>
		{/if}
		{#if e.id === viewing && writes}
			<div class="row acts">
				{#if e.text !== null && e.id !== latest}
					<button class="btn quiet" disabled={busy || !lets('restore')} title={barred('restore')} onclick={() => restore(e.id)}
						>Restore</button
					>
				{/if}
				{#if e.kind === 'edit' && e.deps.length}
					<button class="btn quiet" disabled={busy || !lets('undo')} title={barred('undo')} onclick={() => undo(e.id)}>Undo</button>
				{/if}
				<button
					class="btn quiet"
					disabled={busy || !lets('propose')}
					title={barred('propose')}
					onclick={() => proposeFrom([e.id], versionOf(e))}
				>
					Propose from here
				</button>
			</div>
		{/if}
	{/if}
{/snippet}

<!-- under its history, on a copy: the original's, which it goes on into -->
{#snippet inheritedHistory()}
	{#if item?.forkOf}
		<section class="origin" aria-label="The history it goes on into">
			{#if origin}
				<p class="from">
					<Icon name="variant" size={13} />
					<span>
						Made from <a href="#notes/{origin.entry}">“{origin.title}”</a>{inherited.length
							? ` at edit #${inherited[0].n}`
							: ''}: its history goes on there
					</span>
				</p>
				<ol>
					{#each inherited as e (e.id)}
						<li class={e.kind}>
							<span class="what"><b>{theirs(e)}</b> <span class="n mono">#{e.n}</span></span>
							<small class="soft">{who(e)} · <span class="mono" title={e.id}>{short(e.id)}</span></small>
							{#if (e.kind === 'edit' || e.kind === 'merge') && e.text !== null && (e.before ?? '') !== e.text}
								<p class="diff">{@render pieces(diff(e.before ?? '', e.text))}</p>
							{/if}
						</li>
					{/each}
				</ol>
			{:else}
				<p class="hint soft">Made from a note {nameOf(as)} doesn’t read: its history goes on there.</p>
			{/if}
		</section>
	{/if}
{/snippet}

<div class="doc">
	<header class="top">
		<a class="back" href={back} title={backTo} aria-label={backTo}><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name={spark ? 'spark' : 'note'} size={24} /></span>
		<div class="heading">
			{#if here && writes && !seen && lets('title') && !article}
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
			<p class="meta" title={unsaved ? undefined : 'Every edit signed and saved'}>
				{#if item}<Tags {world} {actor} {api} {busy} entry={item} />{/if}
				{vaultName(item?.vault)}{note ? ` · ${count(numbered.length, 'edit')}` : ''}
				{#if unfit}
					·
					<b class="unsaved" title="What they make of the note breaks its schema: no one counts them"
						>{count(unfit, 'edit')} {unfit === 1 ? 'breaks' : 'break'} its schema</b
					>
				{/if}
				{#if uncounted}
					·
					<b class="unsaved" title="Their shares don’t allow what they change: no one counts them"
						>{count(uncounted, 'edit')} not allowed</b
					>
				{/if}
				{#if unsaved}· <b class="unsaved">Unsaved changes</b>{/if}
			</p>
		</div>
		<div class="tools">
			{#if here}
				<span
					class="mode chip"
					class:warn={!!seen}
					class:accent={!seen && writes && !viewOnly}
					class:main={!seen && writes && !viewOnly && here.line === null}
				>
					{#if seen}
						Viewing {versionOf(seen)}
					{:else if !writes}
						Viewing: {nameOf(as)} may only view it
					{:else if viewOnly}
						Viewing: {viewOnly}
					{:else if here.line === null}
						Editing main{here.version ? ` · ${versionWords(here.version)}` : ''}
					{:else if here.variant}
						Editing variant “{lineName(here)}”{here.version ? ` · ${versionWords(here.version)}` : ''}
					{:else}
						Editing proposal “{lineName(here)}”
					{/if}
				</span>
			{/if}
			{#if unsaved}
				<button class="btn primary" disabled={busy} onclick={save}>Save on {at(here?.line ?? null)}</button>
				<button class="btn quiet" onclick={() => (drafts[k] = here?.text ?? '')}>Discard</button>
			{/if}
			<span class="people" title={item ? `Shared with ${sharedWords(shared)}${item.public ? ' · Public' : ''}` : undefined}>
				{#each sharers.filter((x) => byId.has(x.id)) as x (x.id)}
					<span class="person" title="Shared with {sharerWords(x)}"><Mark vault={byId.get(x.id)} size={28} /></span>
				{/each}
			</span>
			{#if owns}
				<button class="btn share" class:primary={!sharing} aria-label="Share" onclick={() => (sharing = !sharing)}>
					<Icon name="share" size={15} /> <span class="label">Share</span>
				</button>
			{/if}
			{#if writes && item && !item.deleted}
				<button
					class="btn quiet danger"
					disabled={busy || !lets('delete')}
					aria-label="Delete"
					title={barred('delete') ?? 'Delete it: Sparks lists it apart, and every edit stays'}
					onclick={() => remove(false)}
				>
					<Icon name="trash" size={15} /> <span class="label">Delete</span>
				</button>
			{/if}
		</div>
	</header>

	{#if item?.deleted}
		<div class="gone" role="status">
			<Icon name="trash" size={16} />
			<span>This {spark ? 'spark' : 'note'} is deleted: Sparks lists it under Deleted, and every edit of it stays.</span>
			{#if writes}
				<button class="btn primary" disabled={busy || !lets('back')} title={barred('back')} onclick={() => remove(true)}
					>Bring it back</button
				>
			{/if}
		</div>
	{/if}

	{#if sharing && item}
		<div class="sharebar">
			<Share {world} {actor} {api} {busy} vault={item.vault} {entry} ondone={() => (sharing = false)} />
		</div>
	{/if}

	<div class="room">
		<Frame
			bare
			flush
			bind:open
			nav={item && here && shelf ? shelfNav : undefined}
			aside={item && here ? historyAside : undefined}
			navLabel="Artifacts"
			navIcon="artifact"
			asideLabel="History and versions"
			asideIcon="history"
		>
			{#if !loaded}
				<p class="soft pad">Opening the note…</p>
			{:else if !item}
				<p class="soft pad">This browser doesn’t know this note.</p>
			{:else if !note || !here}
				<div class="empty pad">This browser holds no edit of this note {nameOf(as)} may read.</div>
			{:else}
				<main class="canvas" class:sheet={article} class:spread={spark && !seen}>
					{#if seen}
						<div class="banner old">
							<span class="chip warn">{versionOf(seen)}</span>
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
										onclick={() => proposeFrom([seen.id], versionOf(seen))}
									>
										Propose from here
									</button>
								{/if}
								<button class="btn quiet" onclick={() => (viewing = '')}>Back to the latest</button>
							</span>
						</div>
					{:else if here.variant}
						<div class="banner proposal" style:--hue={hue(here.line ?? '')}>
							<span>
								<Icon name="variant" size={15} />
								<span>
									Variant <b>“{lineName(here)}”</b>{here.version ? ` · ${versionWords(here.version)}` : ''}{here.main
										? `, holds main ${versionWords(here.main)}`
										: ''}{here.behind ? '. Main has changed since' : ''}
								</span>
							</span>
							{#if writes && here.behind}
								<span class="actions">
									<button
										class="btn primary"
										disabled={busy || !lets('update')}
										title={barred('update') ?? 'Main’s changes come in; where both changed one place, the variant keeps its own'}
										onclick={() => merge(null, here.line)}>Bring main in</button
									>
								</span>
							{/if}
						</div>
					{:else if here.line !== null}
						{@const start = numbered.find((e) => e.id === here.from?.[0])}
						<div class="banner proposal" style:--hue={hue(here.line)}>
							<span>
								<Icon name="proposal" size={15} />
								<span>Proposal <b>“{lineName(here)}”</b>{#if start}, from {versionOf(start)} of {at(start.line)}{/if}</span>
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

					{#if article && item}
						<!-- an article reads as it is read, and is edited where it stands (./ArticleView.svelte) -->
						{#if seen}
							<ArticleView {world} {api} {item} title={seen.title ?? ''} text={seen.text ?? ''} eyebrow={stage?.name ?? 'Article'} />
						{:else}
							<ArticleView
								{world}
								{api}
								{item}
								bind:title={() => titles[k] ?? '', (v) => (titles[k] = v)}
								bind:text={() => drafts[k] ?? '', (v) => (drafts[k] = v)}
								editable={writes && lets('write')}
								renames={writes && lets('title')}
								eyebrow={stage?.name ?? 'Article'}
								onretitle={retitle}
								onsave={save}
							/>
						{/if}
					{:else}
					<!-- a spark is its canvas, the artifacts, notes and sparks it holds, filling the middle; a note is its page -->
					{#if spark && item && !seen}
						<SparkCanvas
							{world}
							{actor}
							{api}
							{busy}
							{entry}
							vault={item.vault}
							line={here.line}
							record={here.record}
							{writes}
							words={here.text ?? ''}
						/>
					{:else}
					<article class="paper" class:old={!!seen} class:short={spark}>
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
					{/if}
					{/if}

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
											{#each spots(c) as s (s.key)}
												{#if s.words}<p class="spot">{s.words}</p>{/if}
												<p><small class="soft">main</small> {holds(s.ours)}</p>
												<p><small class="soft">“{lineName(here)}”</small> {holds(s.theirs)}</p>
											{/each}
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
			{/if}
		</Frame>
	</div>
</div>

<style>
	/* the whole screen, as a docs app's document: a bar on top, then the three columns (./Frame.svelte) in the rest */
	.doc {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: #ece8df;
	}

	.room {
		flex: 1 1 0;
		min-height: 0;
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.7rem;
		padding: calc(0.4rem + env(safe-area-inset-top, 0px)) 1rem 0.4rem;
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
		width: 2rem;
		height: 2rem;
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
		margin: 0 0 0 0.4rem;
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

	.pad {
		margin: 1.5rem;
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

	/* under its lines: its copies */
	.copies {
		margin-top: 1.3rem;
	}

	.copies select {
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
		min-height: 100%;
		box-sizing: border-box;
		padding: 1.4rem clamp(0.8rem, 3vw, 2.4rem) 10rem;
	}

	/* a spark: its canvas fills the middle */
	.canvas.spread {
		display: flex;
		flex-direction: column;
		padding: 0.8rem clamp(0.6rem, 1.5vw, 1.2rem) var(--nav-room, 5rem);
	}

	/* an article: the page edge to edge, as it is read, and what is around it on the same paper */
	.canvas.sheet {
		padding: 0 0 10rem;
		background: var(--cream);
	}

	.sheet .banner,
	.sheet .against {
		max-width: min(51rem, calc(100% - 2rem));
	}

	.sheet .banner {
		margin: 0.9rem auto 0;
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

	.paper.short {
		min-height: 0;
	}

	.paper.short .text {
		min-height: 8rem;
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

	.conflict .spot {
		margin-top: 0.2rem;
		color: #7a4d10;
		font-size: 0.8rem;
	}

	.changes {
		margin: 0.3rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.8rem;
		overflow-wrap: anywhere;
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

	/* under an edit of its history (./Lines.svelte): its words changed, and what may be done with the one shown */
	.edit-diff {
		font-size: 0.8rem;
	}

	.acts {
		margin: 0.35rem 0 0;
	}

	.acts .btn {
		padding: 0.16rem 0.5rem;
		font-size: 0.76rem;
	}

	/* the original's history, below the copy's own, which goes on into it */
	.origin {
		margin-top: 0.9rem;
		padding-top: 0.7rem;
		border-top: 1px dashed rgb(0 0 0 / 0.18);
	}

	.origin .from {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
		margin: 0 0 0.6rem;
		font-size: 0.8rem;
	}

	.origin ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.origin li {
		position: relative;
		margin-left: 0.4rem;
		padding: 0.1rem 0 0.85rem 1.1rem;
		border-left: 2px solid rgb(0 0 0 / 0.12);
		font-size: 0.84rem;
		opacity: 0.8;
	}

	.origin li::before {
		position: absolute;
		top: 0.4rem;
		left: -0.42rem;
		width: 0.62rem;
		height: 0.62rem;
		border: 2px solid #f7f4ee;
		border-radius: 50%;
		background: var(--accent);
		content: '';
	}

	.origin li.propose::before,
	.origin li.variant::before {
		background: #8a6bb8;
	}

	.origin li.merge::before {
		background: #c99a3a;
	}

	.origin li.sealed::before {
		background: rgb(0 0 0 / 0.3);
	}

	.origin .what {
		display: block;
		font-size: 0.82rem;
	}

	.origin .n {
		color: var(--soft);
	}

	.origin small {
		display: block;
		font-size: 0.72rem;
	}

	.origin .diff {
		font-size: 0.8rem;
	}

	/* a phone: a compact head in one row, buttons by their icons */
	@media (max-width: 640px) {
		.top {
			gap: 0.4rem 0.5rem;
			padding: calc(0.4rem + env(safe-area-inset-top, 0px)) 0.6rem 0.5rem;
		}

		.back {
			width: 2rem;
			height: 2rem;
		}

		.docicon {
			display: none;
		}

		/* one row: back, the title, then who it is shared with and the tools */
		.top {
			flex-wrap: nowrap;
		}

		.heading {
			flex: 1 1 0;
		}

		.title {
			padding: 0 0.3rem;
			font-size: 1rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* the avatars say who it is shared with; its line of edits and tags waits on a wider screen, and the buttons
		   go by their icons, so the title keeps its room */
		.meta,
		.tools .mode:not(.warn),
		.tools .label {
			display: none;
		}

		.tools {
			flex: 0 1 auto;
			flex-wrap: nowrap;
			gap: 0.25rem;
			min-width: 0;
		}

		.tools > * {
			flex: none;
		}

		.tools .btn {
			padding: 0.3rem 0.45rem;
		}

		.tools .mode {
			max-width: 7rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.person :global(.mark) {
			transform: scale(0.85);
		}
	}
</style>
