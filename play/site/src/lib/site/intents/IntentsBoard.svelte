<!--
	INTENTS, AS A BOARD (Samuel 2026-11-03; the proposals' board until 2026-11-06) — every intent of Maia City's as a card in its column,
	newest first. A card opened is reviewed over the whole board: the version built in the asset box as large as it can
	be, what it says of itself folded to two lines, its source (beside its base's, as the lines that changed) a button
	away. Admins decide here; nothing is proposed or edited here: versions come over MCP only (play/api/src/mcp.ts).

	A MODAL, NOT A PAGE (Samuel 2026-11-05): the board opens from the nav pill's star over whatever page is open
	(./IntentsModal.svelte), the way back closing first what is open on it (a review, an intent), then the board.

	INTENTS (Samuel 2026-11-06, play/SPEC.md §4.12): every card is an intent, something Maia City wants made, fixed or
	improved, in its stage's column: Idea → Specify → Build → Proposal → Ship → Accepted (or Archived), Accepted and
	Archived folded at first. Agents add and specify intents over MCP (never typed in here): a spec is a goal, a scope and checks,
	each one statement that passes or fails, checked by a test, a measure or a look, must or nice. Here an admin approves
	a spec (Specify → Build), and an agent builds it, recording each check's result, until every must check passes:
	then it moves to Proposal by itself (Samuel 2026-11-06), the one gate after the spec, where an admin decides it.

	ONE RECORD (Samuel 2026-11-06: "not a proposal belongs to an intent: the intent has a state, proposal"): an intent's
	work (an asset's, story's, factory's, config's, skill's or sandbox layout's version) is on the intent itself, and
	Proposal is only its stage. Only a whole intent is decided, in its dialog (Samuel 2026-11-07): its Accept applies all its work,
	its Reject archives it; its work's review, opened from it, is read only. No work without an intent (intent 706ed873):
	every intent with work has an approved spec, so every intent opens its dialog. Nothing is accepted from Build.

	SUB-STATES (Samuel 2026-11-07, play/api/src/substate.ts): every open card is failed, waiting, working or idle, its
	reason its one status line, each column grouped under those dividers; Approve spec and Accept only on a waiting one.

	ACCEPT SHIPS IT (Samuel 2026-11-06, play/api/src/ship.ts): code's Accept ("Accept and ship") puts it in Ship, where
	it waits its turn, then play merges it and its way to production shows live (merged, main's checks, the release, the
	deploy's jobs, each with its link), read again every 3 s while any ships. All green, it is Accepted; a red step
	brings it back to Proposal with the report atop its dialog, and Accept there ships it again.

	THE DETAIL, BY STAGE (intent bb3b0773, Samuel 2026-11-07): an intent opened is ./IntentDetail.svelte, on top what its
	stage asks of a person and its one decision, the rest in tabs, as ./detail.ts's detailOf says; the board holds the board.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import { session } from '$lib/session.svelte';
	import { wayBack } from '$lib/site/app/back.svelte.js';
	import { intentsModal } from './intents.svelte';
	import { INDEX, admitProposed, source as catalogSource } from '$lib/content/assets/catalog.js';
	import { changesOnly, lineDiff } from '$lib/diff';
	import Changes, { type Change, type Edit, type PinChange } from '$lib/app/Changes.svelte';
	import StoryPlayer from '$lib/stories/StoryPlayer.svelte';
	import StoryChanges, { type StoryDiff } from '$lib/stories/StoryChanges.svelte';
	import type { Story } from '$lib/stories/timeline';
	import IntentDetail from './IntentDetail.svelte';
	import Decision from './Decision.svelte';
	import { decidable, detailOf, isCode, notLive, shipsAgain, type Intent, type Kind, type Results, type Spec, type Stage, type Work } from './detail';

	const viewer = import('$lib/content/assets/VaultAsset.svelte');
	// a world is shown as the Worlds page shows it (one renderer let go of whole when it closes), not on the asset
	// stage, whose studio, shadows and section cuts over a whole city crashed iPad Safari
	const worldViewer = import('$lib/content/worlds/WorldStage.svelte');

	/** how the board is closed (the modal's ×, Escape with nothing open on it) */
	let { onclose }: { onclose?: () => void } = $props();
	// admins only for now (Samuel 2026-11-02): the nav pill's star is greyed out for everyone else
	const admin = $derived(session.me?.level === 'admin');

	// the intent's types, as play's API serves them, are ./detail.ts's; the work opened for review: the intent's id, with
	// the intent's title, spec and results beside it
	type P = Work & { id: string; intent_id: string; intent_title: string; intent_spec: Spec | null; intent_results: Results | null };
	const SUBS = [['failed', 'Failed'], ['waiting', 'Waiting'], ['working', 'Working'], ['idle', 'Idle']] as const;
	// an intent's kind, shown as what it asks (the kind 'idea' as Make, the stage Idea being its own; Samuel 2026-11-06)
	const KINDS: [Kind, string][] = [
		['idea', 'Make'],
		['fix', 'Fix'],
		['improve', 'Improve']
	];
	const kindName = (k: Kind) => KINDS.find(([x]) => x === k)?.[1] ?? k;
	const COLUMNS = [
		['idea', 'Idea'],
		['specify', 'Specify'],
		['build', 'Build'],
		['proposal', 'Proposal'],
		['ship', 'Ship'],
		['accepted', 'Accepted'],
		['archived', 'Archived']
	] as const;
	type Column = (typeof COLUMNS)[number][0];
	// a column folded away or open, each viewer's own (kept in this browser): Accepted and Archived folded at first
	// (Samuel 2026-11-05; the key named for the intents' columns, Samuel 2026-11-06)
	const FOLDED = 'play:intents:folded';
	let folded = $state<Record<string, boolean>>({ accepted: true, archived: true });
	try {
		const kept = JSON.parse(localStorage.getItem(FOLDED) ?? 'null');
		if (kept && typeof kept === 'object') folded = kept;
	} catch {}
	function fold(s: Column) {
		folded = { ...folded, [s]: !folded[s] };
		try {
			localStorage.setItem(FOLDED, JSON.stringify(folded));
		} catch {}
	}
	const columnsTemplate = $derived(COLUMNS.map(([s]) => (folded[s] ? '2.6rem' : 'minmax(14rem, 1fr)')).join(' '));
	let intents = $state<Intent[]>([]);
	let loaded = $state(false);
	let error = $state('');
	const load = async () => {
		try {
			intents = await api<Intent[]>('/intents');
			error = '';
		} catch (e) {
			error = (e as Error).message;
		}
		loaded = true;
	};
	onMount(async () => {
		if (!admin) return;
		api<{ id: string; label: string }[]>('/docs?kind=schema').then((l) => (schemaNames = new Map(l.map((x) => [x.id, x.label]))), () => {});
		await load();
		// opened on an intent (/intents/#<id>): play finds it, and it opens
		const focus = intentsModal.focus;
		intentsModal.focus = null;
		if (!focus) return;
		try {
			const i = await api<Intent>(`/intents/${focus}`);
			openIntentDialog(intents.find((x) => x.id === i.id) ?? i);
		} catch (e) {
			error = (e as Error).message;
		}
	});
	// a column's cards: the intents at its stage, the latest first (those decided by when they were)
	const inColumn = (s: string): Intent[] => {
		const cards = intents.filter((i) => i.stage === s);
		// Ship is a queue: the one shipping, then the rest in the order accepted, first in line on top
		return s === 'ship' ? [...cards].sort((a, b) => Date.parse(a.decided_at ?? a.created) - Date.parse(b.decided_at ?? b.created)) : cards;
	};
	/** a column's cards under its dividers, Failed, Waiting, Working, Idle, empty ones left out */
	const grouped = (cards: Intent[]) => [...SUBS.map(([k, name]) => ({ k, name, cards: cards.filter((i) => i.sub?.state === k) })), { k: '', name: '', cards: cards.filter((i) => !i.sub) }].filter((g) => g.cards.length);
	// ---- Accept ships it (play/api/src/ship.ts): an intent of code, its pull request named, merged by its Accept
	// while any intent ships, the board (and the intent open on it) is read again every 3 s
	const shipping = $derived(intents.some((i) => i.stage === 'ship'));
	let now = $state(Date.now());
	$effect(() => {
		if (!shipping) return;
		const t = setInterval(async () => {
			now = Date.now();
			await load();
			const o = intent;
			if (o) intent = intents.find((x) => x.id === o.id) ?? o;
		}, 3000);
		return () => clearInterval(t);
	});
	/** what an intent's work is, on its card: "v3 · waiting", "2 changes · accepted" */
	/** the work of intent `i`, opened for review */
	const cardOf = (i: Intent): P => ({ ...i.work!, id: i.id, intent_id: i.id, intent_title: i.title, intent_spec: i.spec, intent_results: i.results });
	const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	/** a card's date, short: "4 Nov, 16:27" */
	const shortWhen = (s: string) => new Date(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	/** the author's mark on a card: their initials in a round badge */
	const initialsOf = (name: string | null | undefined) => (name ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
	/** a note's first line, for its card */
	const gist = (s: string) => (s ?? '').split('\n')[0];

	// reviewing one: the version built in the asset box (the sandboxed frame every recipe runs in), large; its note
	// folded; its readable source beside its base's, as the lines that changed, a button away. Code is only text here.
	type Build = { hash: string; variant: string | null; label: string; first: boolean };
	/** every review of a document's version (play/api/src/versioned.ts reviewDoc): its document, what it changes field by
	 *  field against its seed, the edits that made it, whether Main moved since; an asset's adds its builds, a story's its
	 *  timelines */
	// a sandbox's layout: each pin before and after (pins), whether it still holds, the sandbox to open as it would be
	type DocReview = {
		doc: { id: string; kind: string; what: string; label: string; group?: string; open: string | null } | null; seedNumber: number | null; moved: boolean; changes: Change[]; edits: Edit[];
		pins?: PinChange[]; holds?: boolean; why?: string | null; sandbox?: { title: string; route: string; open: string }; docs?: DocReview[];
	};
	type Review = DocReview & { id: string; source: string | null; recipe: string | null; baseVersion: { number: number; source: string | null } | null; builds: Build[]; pieces?: { hash: string; piece: string; label: string; version: number }[] };
	let open = $state<P | null>(null);
	let review = $state<Review | null>(null);
	let code = $state('');
	let baseCode = $state<string | null>(null);
	let shown = $state('');
	let changes = $state(true);
	let showSource = $state(false);
	let noteOpen = $state(false);
	let reviewError = $state('');
	const text = async (hash: string) => {
		const r = await fetch(`/api/files/${hash}`, { credentials: 'same-origin' });
		if (!r.ok) throw new Error(`The file could not be read (HTTP ${r.status}).`);
		return r.text();
	};
	// a story's (play/api/src/stories.ts): its timeline played in the Stories player, beside what changed clip by clip
	type StoryReview = DocReview & { story: Story; baseStory: (Story & { number: number }) | null; diff: StoryDiff };
	let storyReview = $state<StoryReview | null>(null);
	// any other document's (a factory's, a config's, a skill's, a layout's): field by field, opened as it would be
	let docReview = $state<DocReview | null>(null);
	// an intent may change several documents: every one's review, accepted together
	let alsoDocs = $state<DocReview[]>([]);
	/** what a proposal is of, its card's tag (Samuel 2026-11-05: the type, not how it came) */
	const GROUP_TYPE: Record<string, string> = { plants: 'Plant', things: 'Thing', machines: 'Machine', buildings: 'Building', actors: 'Actor', characters: 'Character', biomes: 'Biome', worlds: 'World', sandboxes: 'Sandbox' };
	const typeOf = (p: { what?: string | null; grp: string | null }) => GROUP_TYPE[p.grp ?? ''] ?? (p.what ? p.what[0].toUpperCase() + p.what.slice(1) : (p.grp ?? ''));
	/** an intent's tag: what its work is (a plant, a story …) where it has some, else its kind */
	const tagOf = (i: Intent) => (i.work ? typeOf(i.work) : kindName(i.kind));
	/** the schemas' labels by their UUIDs, to name an intent's declared work (only shown) */
	let schemaNames = $state<Map<string, string>>(new Map());
	/** what a rule decided of an intent, in a line (its card's Auto mark) */
	const autoTitle = (i: Intent) =>
		[i.auto?.approve ? `Spec approved by rule ${i.auto.approve.label}` : '', i.auto?.accept ? `Accepted by rule ${i.auto.accept.label}` : ''].filter(Boolean).join(' · ');
	const titleOf = (p: Work) => (p.number == null ? 'a change' : `v${p.number}`);
	async function openCard(p: P) {
		intent = null;
		open = p;
		review = null;
		storyReview = null;
		docReview = null;
		alsoDocs = [];
		code = '';
		baseCode = null;
		shown = '';
		showSource = false;
		noteOpen = false;
		reviewError = '';
		// one review for every kind: an asset's build, a story's timelines, or any document's fields
		let got: any;
		try {
			got = (await api<{ review: any }>(`/intents/${p.id}`)).review;
		} catch (e) {
			reviewError = (e as Error).message;
			return;
		}
		if (open?.id !== p.id) return;
		alsoDocs = (got.docs ?? []).slice(1);
		if (got.story) return void (storyReview = got);
		if (!got.builds) return void (docReview = got);
		try {
			const r = got as Review;
			await admitProposed(r.builds);
			review = r;
			shown = (r.builds.find((b) => b.first) ?? r.builds[0])?.hash ?? '';
			code = r.source ? await text(r.source) : r.recipe ? await text(r.recipe) : '';
			baseCode = r.baseVersion?.source ? await text(r.baseVersion.source) : null;
		} catch (e) {
			reviewError = (e as Error).message;
		}
	}
	const close = () => (open = null);
	const diff = $derived(baseCode !== null && code ? changesOnly(lineDiff(baseCode, code)) : null);

	// ---- an intent opened: its spec and checks, its work a click away, the brief that sends an agent to it, and the
	// admin's decision
	let intent = $state<Intent | null>(null);
	let intentError = $state('');
	/** the intent a proposal was made for, from its review */
	async function openIntentOf(id: string) {
		const i = intents.find((x) => x.id === id) ?? (await api<Intent>(`/intents/${id}`).catch(() => null));
		if (i) openIntentDialog(i);
	}
	/** the intent's own dialog (its spec, checks and work), even where it is only its work */
	const depsTitle = (i: Intent) => [i.depends_on?.length ? `Waits for: ${i.depends_on.map((d) => d.title).join(', ')}.` : '', i.needed_by?.length ? `Needed by: ${i.needed_by.map((d) => d.title).join(', ')}.` : ''].filter(Boolean).join(' ')
	async function openIntentDialog(i: Intent) {
		open = null;
		intent = i;
		intentError = '';
	}
	const closeIntent = () => {
		intent = null;
		intentError = '';
	};
	/** an Accept that merges (Accept and ship): GitHub takes a few seconds */
	let merging = $state(false);
	/** a decision taken on the work's review: the intent's own, and the review closes once it is taken */
	async function decideWork(id: string, verdict: 'approve' | 'accept' | 'reject' | 'reopen') {
		const of = intents.find((x) => x.id === id);
		merging = verdict === 'accept' && !!of && isCode(of);
		intentError = '';
		try {
			const r = await api<Intent & { message?: string }>(`/intents/${id}/${verdict}`, { method: 'POST' });
			error = r.message ?? '';
			intents = intents.map((x) => (x.id === r.id ? r : x));
			open = null;
		} catch (e) {
			intentError = (e as Error).message;
		} finally {
			merging = false;
		}
	}
	async function decideIntent(id: string, verdict: 'approve' | 'accept' | 'reject' | 'reopen') {
		merging = verdict === 'accept' && !!intent && isCode(intent);
		intentError = '';
		try {
			// accepted, its work is applied (or archived, where its base moved and the two touch the same field: why, here)
			const r = await api<Intent & { message?: string }>(`/intents/${id}/${verdict}`, { method: 'POST' });
			error = r.message ?? '';
			intents = intents.map((x) => (x.id === r.id ? r : x));
			// shipped: the dialog stays, its way to production ticking
			if (r.stage === 'ship') intent = r;
			else closeIntent();
		} catch (e) {
			intentError = (e as Error).message;
		} finally {
			merging = false;
		}
	}

	// the way back (the nav pill's Back) closes what is open on the board first, then the board itself (the modal's)
	$effect(() => {
		if (!open) return;
		return wayBack('Back to the intents', close);
	});
	$effect(() => {
		if (!intent) return;
		return wayBack('Back to the intents', closeIntent);
	});

	const onKey = (e: KeyboardEvent) => {
		if (e.key !== 'Escape') return;
		if (intent) closeIntent();
		else if (open) close();
		else onclose?.();
	};
</script>

{#snippet docChanges(r: DocReview, several: boolean, done: boolean)}
	<div class="sandbox-review">
		{#if several}<h3>{(r.doc?.what ?? 'document').replace(/^./, (c) => c.toUpperCase())}: {r.doc?.label}</h3>{/if}
		{#if r.holds === false && !done}<p class="error">It no longer holds on {r.doc?.label ?? 'it'} as it is now: {r.why} Accepting it archives it.</p>{/if}
		<p>
			{#if r.sandbox && !done && r.holds !== false}<a class="btn small" href={r.sandbox.open} target="_blank" rel="noopener">Open {r.sandbox.title} as it would be</a>{/if}
			{#if r.doc?.open}<a class="btn small" href={r.doc.open} target="_blank" rel="noopener">{r.sandbox ? `Its layout's history` : `Open ${r.doc.label} as it would be`}</a>{/if}
			{#if r.doc?.group}<span class="muted small"> What every agent is taught ({r.doc.what}s / {r.doc.group}): accepted, it is taught from the next request on.</span>{/if}
			{#if r.moved}<span class="muted small"> It was seeded from v{r.seedNumber}; the {r.doc?.what ?? 'document'} has a newer version since. Accepting merges it where the two touch different fields, and archives it where they touch the same.</span>{/if}
		</p>
		<Changes changes={r.changes} edits={r.edits} pins={r.pins ?? null} seed={r.seedNumber} heading={done ? 'What it changed' : 'What it changes'} />
	</div>
{/snippet}

<svelte:window onkeydown={onKey} />

<div class="intents">
{#if !admin}
	<p class="muted">The intents are Maia City's admins' for now.</p>
{:else}
		<!-- the title alone above the columns: no words about the board (Samuel 2026-11-06) -->
		<header class="head">
			<h1>Intents</h1>
			{#if onclose}<button class="btn small ghost close" onclick={onclose} aria-label="Close the intents" title="Close (Esc)">Close</button>{/if}
		</header>
		{#if error}<p class="error">{error}</p>{/if}
		<div class="board" style:grid-template-columns={columnsTemplate}>
			{#each COLUMNS as [s, name] (s)}
				{@const cards = inColumn(s)}
				<!-- the column's header stays; only its cards scroll (Samuel 2026-11-04); a column folds away to a strip -->
				<section class="column" class:folded={folded[s]} data-status={s}>
					<h2>
						<button class="fold" onclick={() => fold(s)} aria-expanded={!folded[s]} title={folded[s] ? `Open ${name}` : `Fold ${name} away`}>
							<span class="name">{name}</span> <span class="count">{cards.length}</span>
						</button>
					</h2>
					{#if !folded[s]}
						<div class="cards">
							{#each grouped(cards) as g (g.k)}
							{#if g.k}<h3 class="sub" data-sub={g.k}>{g.name} <span class="count">{g.cards.length}</span></h3>{/if}
							{#each g.cards as i (i.id)}
								<!-- an intent: its title, its sub-state and why, who it is by, its type and its date -->
								<article class="card item" class:held={!!i.held_by?.length} data-kind={i.kind}>
									<button class="open" onclick={() => openIntentDialog(i)} title={i.note ? gist(i.note) : undefined}>
										<span class="title">{i.title}</span>
										{#if notLive(i) || i.sub}<span class="for" data-sub={notLive(i) ? 'failed' : i.sub?.state} title={notLive(i) || i.sub?.why}>{notLive(i) || i.sub?.why}</span>{/if}
										<span class="meta">
											<span class="avatar" aria-hidden="true">{initialsOf(i.author)}</span>
											<span class="author">{i.author ?? 'someone'}</span>
											<span class="type" data-type={tagOf(i)} data-kind={i.work ? undefined : i.kind} title={i.via === 'mcp' ? `${tagOf(i)} · by an agent working for them over MCP` : tagOf(i)}>{tagOf(i)}</span>
											{#if i.auto?.approve || i.auto?.accept}<span class="auto" title={autoTitle(i)}>Auto</span>{/if}
											<span class="date">{shortWhen(i.decided_at ?? i.created)}</span>
										</span>
									</button>
									<!-- intents depend on intents: one line, Held and counts; hover names them, the dialog lists them -->
									{#if i.depends_on?.length || i.needed_by?.length}
										<button class="deps" onclick={() => openIntentDialog(i)} title={depsTitle(i)}>{#if i.held_by?.length}<span class="held-tag">Held</span>{/if}<span>{[i.depends_on?.length ? `waits for ${i.depends_on.length}` : '', i.needed_by?.length ? `needed by ${i.needed_by.length}` : ''].filter(Boolean).join(' · ')}</span></button>
									{/if}
								</article>
							{/each}
							{:else}
								<p class="empty muted">{!loaded ? '…' : s === 'idea' ? 'None. Agents add intents over MCP.' : s === 'specify' ? 'None. Agents specify an intent over MCP.' : s === 'build' ? 'None. An approved spec is built here.' : s === 'ship' ? 'None. Accepted code is shipped here.' : 'None'}</p>
							{/each}
						</div>
					{/if}
				</section>
			{/each}
		</div>

	{#if intent}
		<!-- an intent opened: on top what its stage asks of a person, the rest in tabs (./IntentDetail.svelte, ./detail.ts) -->
		<IntentDetail intent={intent} cameWith={intent.came_with ? (intents.find((x) => x.id === intent!.came_with)?.title ?? null) : null} {schemaNames} {now} error={intentError} {merging} onclose={closeIntent} ondecide={(v) => decideIntent(intent!.id, v)} onopenwork={() => openCard(cardOf(intent!))} onopenintent={openIntentOf} />
	{/if}

	{#if open}
		{@const p = open}
		{@const of = intents.find((x) => x.id === p.intent_id)}
		<div class="review" role="dialog" aria-modal="true" aria-label="{p.label} {titleOf(p)}">
			<header class="review-head">
				<div class="who">
					<button class="to-board" onclick={close} title="Back to the intents (Esc)">‹ Intents</button>
					<h2>{p.label} <span class="muted">{titleOf(p)}</span> <span class="pill">{p.status}</span></h2>
					<p class="meta">{p.grp} · by {p.author ?? 'someone'}{#if p.via === 'mcp'}{' '}<span class="via" title="Proposed by an agent working for them over MCP">via MCP</span>{/if} · {when(p.created)}{p.decided_by ? ` · ${p.status} by ${p.decided_by}` : ''}{#if p.intent_id}{' · for '}<button class="link" onclick={() => openIntentOf(p.intent_id!)} title="The intent it was made for: its spec and checks">{p.intent_title}</button>{/if}</p>
					{#if p.intent_spec}
						{@const checks = p.intent_spec.checks}
						{@const musts = checks.filter((c) => c.must)}
						<!-- in plain words, as the intent's detail says it (Samuel 2026-11-07: the audience is a person) -->
						<p class="gate small" title={checks.map((c) => `${c.id} ${c.check}`).join('\n')}>Checks passed: <strong>{musts.filter((c) => p.intent_results?.[c.id]?.pass === true).length} of {musts.length}</strong> required</p>
					{/if}
				</div>
			</header>
			{#if p.note}
				<div class="note" class:folded={!noteOpen}>
					<p>{p.note}</p>
				</div>
				<button class="more" onclick={() => (noteOpen = !noteOpen)}>{noteOpen ? 'Less' : 'More'}</button>
			{/if}
			<!-- the work itself, the left pane on a wide screen -->
			<div class="work-pane">
			{#if !review && !storyReview && !docReview}
				<div class="sandbox-review">
					{#if reviewError}<p class="error">{reviewError}</p>{:else}<p class="muted">Reading it…</p>{/if}
				</div>
			{:else if docReview}
				{#each [docReview, ...alsoDocs] as r, i (i)}
					{@render docChanges(r, alsoDocs.length > 0, p.status === 'accepted')}
				{/each}
			{:else if storyReview}
				<div class="story-review">
					{#if reviewError}<p class="error">{reviewError}</p>
					{:else}
						<div class="story-play"><StoryPlayer story={storyReview.story} compact /></div>
						<div class="story-diff">
							<h3>{storyReview.baseStory ? `Changes from v${storyReview.baseStory.number}` : 'A new story'}</h3>
							<StoryChanges diff={storyReview.diff} fresh={!storyReview.baseStory} links={{ ...storyReview.baseStory?.links, ...storyReview.story.links }} />
							<Changes edits={storyReview.edits} />
						</div>
					{/if}
				</div>
			{:else}
			<div class="review-body" class:split={showSource}>
				<div class="built">
					{#if reviewError}<p class="error">{reviewError}</p>
					{:else if !review}<p class="muted">Reading it…</p>
					{:else}
						{#if review.builds.length > 1}
							<div class="tabs">{#each review.builds as b (b.hash)}<button class="btn small" class:ghost={shown !== b.hash} onclick={() => (shown = b.hash)}>{b.variant ?? b.label}</button>{/each}</div>
						{/if}
						{#if shown}
							<div class="stage">
								{#key shown}
									{#if p.grp === 'worlds'}
										{#await worldViewer then { default: WorldStage }}
											<WorldStage source={catalogSource} engine={INDEX.engine} hash={shown} />
										{/await}
									{:else}
										{#await viewer then { default: VaultAsset }}
											<VaultAsset source={catalogSource} hash={shown} title="{p.label} v{p.number} (proposed)" fill />
										{/await}
									{/if}
								{/key}
							</div>
						{/if}
						<p class="muted small">Built in the asset box: a sandboxed frame with no origin, running the frozen engine in a worker, with no network, no storage and no access to this page.</p>
						{#if review.pieces?.length}
							<p class="muted small">Its pieces, by hash, read from play's files: {#each review.pieces as pc, i (pc.hash)}{i ? ', ' : ''}<a href="/pieces/?piece={pc.piece}&v={pc.version}" title={pc.hash}>{pc.label} v{pc.version}</a> <code>{pc.hash.slice(0, 12)}…</code>{/each}</p>
						{/if}
						<!-- what else it changes (its source is beside it, a button away) and the edits it was made in -->
						<Changes changes={review.changes} edits={review.edits} seed={review.seedNumber} skip={['$.source']} />
					{/if}
				</div>
				{#if showSource && review}
					<div class="code">
						<div class="codebar">
							{#if diff}<button class="btn small ghost" onclick={() => (changes = !changes)}>{changes ? 'Whole file' : `Changes from v${review.baseVersion?.number}`}</button>{/if}
							{#if !review.baseVersion?.source && review.baseVersion}<span class="muted small">v{review.baseVersion.number} has no source to compare (imported)</span>{/if}
						</div>
						{#if diff && changes}
							<pre class="src">{#each diff as l, i (i)}<span class={l.op}>{l.op === 'add' ? '+ ' : l.op === 'del' ? '- ' : l.op === 'skip' ? '' : '  '}{l.text}
</span>{/each}</pre>
						{:else}
							<pre class="src">{code || 'Reading it…'}</pre>
						{/if}
					</div>
				{/if}
			</div>
			{/if}
			{#if !docReview && alsoDocs.length}
				<p class="muted small">This intent changes {alsoDocs.length + 1} documents: accepted together, or archived together.</p>
				{#each alsoDocs as r, i (i)}{@render docChanges(r, true, p.status === 'accepted')}{/each}
			{/if}
			</div>
			<!-- the decision travels with the work (Samuel 2026-11-07): the same bar as the intent's detail, by detailOf, its
			     source a quiet button beside it -->
			{#if intentError}<p class="refused" role="alert">{intentError}</p>{/if}
			<Decision detail={of ? detailOf(of) : { decision: null, reject: false }} {merging} ondecide={(v) => decideWork(p.intent_id, v)}>
				{#snippet extra()}
					{#if review}<button class="btn small ghost" class:on={showSource} onclick={() => (showSource = !showSource)}>{showSource ? 'Hide source' : review.source ? 'Source' : 'Recipe file'}</button>{/if}
				{/snippet}
			</Decision>
		</div>
	{/if}
{/if}
</div>

<style>
	/* the board as tall as the modal it is in: its title and the columns' headers stay, each column scrolls its own
	   cards, the board sideways on a narrow screen (Samuel 2026-11-04); what is opened on it covers it, inside the modal */
	.intents { position: relative; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; padding: 1rem 1rem 0.8rem; }
	.head { flex: 0 0 auto; display: flex; gap: 1rem; align-items: center; justify-content: space-between; margin-bottom: 0.7rem; }
	.head h1 { margin: 0; font-size: clamp(1.6rem, 3.5vw, 2.2rem); }
	.head .close { flex: 0 0 auto; }
	@media (max-width: 640px) { .head { margin-bottom: 0.6rem; } .intents { padding: 0.8rem 0.7rem 0.6rem; } }
	.board { flex: 1 1 auto; min-height: 0; display: grid; grid-auto-flow: column; gap: 0.7rem; overflow-x: auto; align-items: stretch; }
	.column { background: color-mix(in srgb, var(--paper, #f6f1e6) 70%, transparent); border-radius: 14px; padding: 0.7rem 0.6rem 0.5rem; display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; min-height: 0; }
	.column h2 { flex: 0 0 auto; margin: 0; font-size: 0.95rem; min-height: 1.5rem; }
	/* its header folds it away to a strip, its name down the strip, and opens it again */
	.fold { all: unset; box-sizing: border-box; cursor: pointer; width: 100%; display: flex; align-items: center; gap: 0.4rem; padding: 0.1rem 0.2rem; border-radius: 8px; }
	.fold:hover { background: color-mix(in srgb, var(--ink, #26382c) 6%, transparent); }
	.fold:focus-visible { outline: 2px solid var(--mustard); }
	.fold::after { content: '‹'; margin-left: auto; color: var(--muted); font-size: 1rem; line-height: 1; }
	.column.folded { padding: 0.7rem 0.25rem; cursor: pointer; }
	.column.folded h2 { flex: 1 1 auto; }
	.column.folded .fold { height: 100%; flex-direction: column; justify-content: flex-start; gap: 0.5rem; padding: 0.2rem 0; }
	.column.folded .fold::after { content: '›'; margin: 0; order: -1; }
	.column.folded .name { writing-mode: vertical-rl; }
	.cards { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 0.4rem; padding: 0.1rem 0.1rem 0.4rem; }
	/* each card keeps its own height; the column scrolls (a card that clips would otherwise be squeezed to fit) */
	.cards > :global(*) { flex: 0 0 auto; }
	.count { font-size: 0.75rem; font-weight: 600; padding: 0 0.5em; border-radius: 999px; background: var(--card, #fff); }
	.card { padding: 0; overflow: hidden; }
	.open { all: unset; box-sizing: border-box; cursor: pointer; display: grid; gap: 0.3rem; padding: 0.5rem 0.65rem; width: 100%; }
	.open:hover { background: color-mix(in srgb, var(--sage, #8fae8b) 10%, transparent); }
	.open:focus-visible { outline: 2px solid var(--ink, #222); outline-offset: -2px; }
	.title { font-weight: 600; font-size: 0.9rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.meta { font-size: 0.78rem; color: var(--muted, #777); }
	.card .meta { display: flex; align-items: center; gap: 0.35rem; min-width: 0; }
	.avatar { flex: 0 0 auto; display: grid; place-items: center; width: 1.35rem; height: 1.35rem; border-radius: 50%; background: #c8744f; color: #fff; font-size: 0.62rem; font-weight: 700; }
	.author { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.date { margin-left: auto; white-space: nowrap; }
	.empty { margin: 0.2rem; font-size: 0.85rem; }
	.type { display: inline-block; padding: 0 0.45em; border-radius: 999px; background: var(--mustard-soft); color: var(--ink); font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
	.type[data-type='Building'], .type[data-type='World'], .type[data-type='Sandbox'] { background: color-mix(in srgb, var(--terracotta, #c4673f) 22%, transparent); }
	.type[data-type='Plant'], .type[data-type='Biome'] { background: color-mix(in srgb, var(--sage, #8fa67a) 30%, transparent); }
	.type[data-type='Story'] { background: color-mix(in srgb, var(--ink, #1f3a2c) 14%, transparent); }
	/* decided by a rule, not a person (play/SPEC.md §4.12 "Auto-accept rules") */
	.auto { display: inline-block; padding: 0 0.45em; border-radius: 999px; background: color-mix(in srgb, var(--brand-green, #26382c) 18%, transparent); color: var(--ink); font-size: 0.72rem; font-weight: 600; }
	.via { display: inline-block; padding: 0 0.45em; border-radius: 999px; background: var(--mustard-soft); color: var(--ink); font-size: 0.72rem; font-weight: 600; }
	/* an intent's kind its colour, the card of one added over MCP (not only a proposal's) marked with it down its left edge */
	[data-kind='idea'] { --kind: var(--mustard, #efb54d); }
	[data-kind='fix'] { --kind: var(--terracotta, #c8744f); }
	[data-kind='improve'] { --kind: var(--sage, #a8b88a); }
	.type[data-kind] { background: color-mix(in srgb, var(--kind) 35%, transparent); }
	.card.item { border-left: 4px solid var(--kind); }
	/* intents depend on intents: a held card dimmed and marked, its links to what it waits for and what waits on it */
	.card.held { background: repeating-linear-gradient(135deg, transparent 0 8px, color-mix(in srgb, var(--muted, #777) 7%, transparent) 8px 16px), var(--card, #fff); }
	.deps { all: unset; box-sizing: border-box; display: block; width: 100%; cursor: pointer; padding: 0 0.65rem 0.5rem; font-size: 0.74rem; line-height: 1.35; color: var(--muted, #777); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.deps .held-tag { margin-right: 0.4em; }
	.held-tag { display: inline-block; padding: 0 0.5em; border-radius: 999px; background: color-mix(in srgb, #9c3b22 15%, transparent); color: #9c3b22; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.02em; }
	.for { font-size: 0.76rem; color: var(--ink-soft, #4d5d51); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	/* the sub-states: a divider over each group of a column's cards, and each card's reason in its colour */
	.sub { margin: 0.3rem 0.2rem 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--sub); }
	[data-sub] { --sub: var(--ink-soft, #4d5d51); }
	[data-sub='failed'] { --sub: #9c3b22; }
	[data-sub='waiting'] { --sub: var(--brand-green, #24452f); }
	.for[data-sub] { color: var(--sub); font-weight: 600; }
	.for[data-sub='failed']::before { content: '✗ '; }
	.for[data-sub='working']::before { content: '● '; color: var(--mustard, #efb54d); }
	/* a proposal's review: its intent's checks as one strip of marks */
	.gate { margin: 0.25rem 0 0; display: flex; flex-wrap: wrap; gap: 0.3rem; }
	.chk { padding: 0 0.5em; border-radius: 999px; font-size: 0.72rem; font-weight: 600; background: var(--paper, #f6f1e6); color: var(--muted, #777); white-space: nowrap; }
	.chk.pass { background: color-mix(in srgb, var(--sage, #8fae8b) 40%, transparent); color: var(--brand-green, #24452f); }
	.chk.fail { background: color-mix(in srgb, var(--terracotta, #c8744f) 25%, transparent); color: #9c3b22; }

	.link { all: unset; cursor: pointer; text-decoration: underline; font-weight: 600; color: var(--brand-green, #24452f); }
	.link:focus-visible { outline: 2px solid var(--mustard); }
	/* reviewing one: nearly the whole screen, the build as large as it can be */
	.review { position: absolute; inset: 0.4rem; z-index: 10; background: var(--bg, #fbf8f2); border-radius: 16px; box-shadow: 0 20px 60px rgb(0 0 0 / 0.25); display: flex; flex-direction: column; padding: 0.8rem 1rem 0.6rem; gap: 0.4rem; overflow: hidden; }
	.review-head { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: flex-start; }
	.who { min-width: 0; }
	/* ‹ Intents: back to the board from what is open on it; a tap's height (44 px), drawn as a quiet link */
	.to-board { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; min-height: 44px; margin: -0.65rem 0 -0.35rem -0.45rem; padding: 0 0.6rem 0 0.45rem; border-radius: 10px; font-size: 0.88rem; font-weight: 600; color: var(--ink-soft, #4d5d51); }
	.to-board:hover { background: color-mix(in srgb, var(--ink, #26382c) 6%, transparent); color: var(--ink, #1f2a22); }
	.to-board:focus-visible { outline: 2px solid var(--ink, #222); outline-offset: -2px; }
	.review-head h2 { margin: 0; font-size: 1.3rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
	.review-head .meta { margin: 0.15rem 0 0; }
	.btn.on { background: var(--ink, #222); color: var(--bg, #fff); }
	.note { flex: 0 0 auto; }
	.note p { margin: 0; font-size: 0.88rem; white-space: pre-line; }
	.note.folded p { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
	.note:not(.folded) { max-height: 30vh; overflow: auto; }
	.more { all: unset; flex: 0 0 auto; cursor: pointer; font-size: 0.8rem; font-weight: 600; text-decoration: underline; width: fit-content; }
	.review-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.8rem; }
	.review-body.split { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
	@media (max-width: 900px) { .review-body.split { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 3fr) minmax(0, 2fr); } }
	/* the build as large as there is room for, and never squeezed by what follows it (Samuel 2026-11-05: on a pad seven
	   steps squeezed it to a strip): the steps scroll below it */
	.built { min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 0.3rem; }
	.stage { flex: 1 0 auto; min-height: clamp(16rem, 58dvh, 42rem); display: flex; flex-direction: column; }
	.stage > :global(*) { flex: 1 1 auto; min-height: 0; }
	.tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.code { min-height: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.codebar { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
	.src { flex: 1 1 auto; min-height: 0; overflow: auto; margin: 0; padding: 0.8rem; border-radius: 10px; background: var(--paper, #f6f1e6); font-size: 0.78rem; line-height: 1.45; white-space: pre; }
	.src .add { background: color-mix(in srgb, var(--sage, #8fae8b) 30%, transparent); display: block; }
	.src .del { background: color-mix(in srgb, var(--terracotta, #c96f53) 25%, transparent); display: block; }
	.src .same { display: block; opacity: 0.7; }
	.src .skip { display: block; opacity: 0.5; font-style: italic; padding: 0.2rem 0; }
	.small { font-size: 0.8rem; }
	/* a story's proposal: its timeline played, beside what changed against the head */
	.story-review { flex: 1 1 auto; min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr); gap: 1rem; align-items: start; }
	.story-diff { min-width: 0; }
	.story-diff h3 { margin: 0 0 0.5rem; font-size: 1rem; }
	@media (max-width: 1000px) { .story-review { grid-template-columns: minmax(0, 1fr); } }
	/* a document's review: what it changes, field by field (./Changes.svelte) */
	.sandbox-review { flex: 1 1 auto; min-height: 0; overflow: auto; }
	.refused { flex: 0 0 auto; margin: 0; padding: 0.45rem 0.7rem; border-radius: 10px; font-size: 0.85rem; line-height: 1.4; max-height: 5.6em; overflow-y: auto; overflow-wrap: anywhere; color: #9c3b22; background: color-mix(in srgb, var(--terracotta, #c8744f) 12%, var(--card, #fff)); border: 1px solid color-mix(in srgb, var(--terracotta, #c8744f) 45%, transparent); }
	.work-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 0.4rem; overflow: hidden; }
	/* a wide screen: the work large on the left, what it is (its header, its note) and the decision in an aside on the
	   right, as the intent's detail and every versioned thing on play (play/SPEC.md §4.15 One aside) */
	@media (min-width: 900px) {
		.review:not(:global(.item-review)) { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem); grid-template-rows: auto auto auto minmax(0, 1fr) auto auto; column-gap: 1.4rem; align-content: stretch; }
		.work-pane { grid-column: 1; grid-row: 1 / -1; }
		.review > .review-head, .review > .note, .review > .more, .review > .refused, .review > :global(.decide) { grid-column: 2; }
		.review > .review-head { grid-row: 1; }
		.review > .note { grid-row: 2; }
		.review > .more { grid-row: 3; align-self: start; }
		.review > .refused { grid-row: 5; }
		.review > :global(.decide) { grid-row: 6; }
		.review .note:not(.folded) { max-height: none; }
	}
</style>
