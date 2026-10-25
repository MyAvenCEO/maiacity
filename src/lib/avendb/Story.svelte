<!--
	One story, the whole screen, in the layout every avenDB view has (./Frame.svelte, bare: its head is its own). On the
	left the stages of the story flow (./flows.js), the one it is in marked, each a tab with an address of its own
	(`#stories/` and its entry, then the stage; with none, the stage it is in), each the step of its journey the next
	milestones fill (sparks and idea, hook, thumbnail, journey, writing, movie, derivatives, scheduled, published). In
	the middle its title, its vault and, for whoever may change it, the stages it goes on to, then the tab picked: the
	Idea tab the sparks it grows from and its sources (StorySparks), the Hook tab its hooks, the one on the card, its
	image title, intro and description beside how it looks on YouTube (StoryHook), the Thumbnail tab its cards, one per
	shape, in layers (StoryThumbnail), the Journey tab where it starts and ends, its question and its beats with their
	tension (StoryJourney), the Writing tab its full text, the base of every post of it (StoryWriting), the Movie tab its
	script, its scenes, lines and shot list (StoryMovie), the Derivatives tab its posts, each of a post type (StoryPosts).
	On the right its lines and its history, avenDB's one version side (./Lines.svelte), as a note's: each open
	proposal, what its title reads there and Merge for whoever may merge it, its variants, and every edit of the main
	line, newest first, who made it and what title it left, to restore. Agents over the Mac app's MCP write on
	proposals, which the person merges here.
-->
<script>
	import { untrack } from 'svelte';
	import { flowsFor, moving, STORY, stageOf } from './flows.js';
	import { entryCollection } from './entry-collection.svelte.js';
	import { entryDetail } from './entry-detail.svelte.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import Lines from './Lines.svelte';
	import { allowed, may } from './ops.js';
	import StoryHook from './StoryHook.svelte';
	import StoryJourney from './StoryJourney.svelte';
	import StoryMovie from './StoryMovie.svelte';
	import StoryPosts from './StoryPosts.svelte';
	import StorySparks from './StorySparks.svelte';
	import StoryThumbnail from './StoryThumbnail.svelte';
	import StoryWriting from './StoryWriting.svelte';
	import { storyFallbackQuery } from './stories-query.js';
	import { count, nameOf, short, seedCity, reads } from './vaults.js';

	/** `step` the stage whose tab shows, as its address names it, where it isn't the one it is in
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string, step?: string }} */
	let { world, actor, api, busy, entry, step = '' } = $props();


	/** Each stage's icon in the list on the left; a stage of a vault's own flow has `flow`'s. */
	const ICONS = /** @type {Record<string, import('svelte').ComponentProps<typeof Icon>['name']>} */ ({
		idea: 'spark',
		hook: 'quote',
		thumbnail: 'image',
		journey: 'flow',
		writing: 'text',
		movie: 'film',
		derivatives: 'post',
		scheduled: 'todo',
		published: 'out'
	});

	/** What each stage's tab will hold, and the milestone that brings it. */
	const STEPS = /** @type {Record<string, [string, string]>} */ ({
		idea: ['The sparks it grows from: thoughts, links, pictures, mood boards, others’ posts.', 'M1'],
		hook: ['Its hook variants side by side, the one chosen, its image title, intro and description.', 'M2'],
		thumbnail: ['Its title cards in layers, one per shape, each rendered into the Library.', 'M3'],
		journey: ['From → to, the question it asks, and its beats with their tension.', 'M4'],
		writing: ['Its full text, written out: the base every post of it is drawn from.', 'M5'],
		movie: ['Its script: a scene for each of the journey’s beats, the lines they say and the shots they need, its first cut for the studio, and its rendered films as film posts.', 'M6 · M7'],
		derivatives: ['Its posts, each one way it goes out, of a post type with its own template.', 'M8 · M9'],
		scheduled: ['When each piece goes out, platform by platform, and again.', 'M10'],
		published: ['Live on the Maia Universe and every platform, each with its link.', 'M11']
	});

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const collection = entryCollection(() => api, () => ({ op: 'entry_views', entries: [entry], as: actor }));
	const item = $derived(collection.rows.find((e) => e.entry === entry));
	const record = $derived(/** @type {any} */ (item?.record) ?? {});
	let titleDraft = $state('');
	let titleEntry = '', shownTitle = '';
	$effect(() => {
		const next = record.title ?? '';
		if (titleEntry !== entry || untrack(() => titleDraft) === shownTitle) titleDraft = next;
		titleEntry = entry; shownTitle = next;
	});
	const writes = $derived(!!item && (item.writers ?? []).includes(actor));

	const workflows = entryCollection(() => api, () => item
		? { op: 'entry_views', vault: item.vault, as: actor, types: ['flow'] }
		: { op: 'entry_views', entries: [], as: actor });
	const defaults = entryCollection(() => api, () => storyFallbackQuery(item?.vault ?? '', actor, seedCity(world)?.id));
	const flowWorld = $derived({ ...world, entries: [...workflows.rows, ...defaults.rows].filter(e => reads(e, actor)) });
	const flow = $derived(item ? (flowsFor(flowWorld, item.vault, 'story')[0] ?? STORY) : STORY);
	const stage = $derived(item ? stageOf(item, flow) : null);
	const onward = $derived(stage ? flow.stages.filter((s) => stage.next.includes(s.key)) : flow.stages);
	/** the stage whose tab shows: the one its address names, else the one it is in */
	const tab = $derived((world.entriesComplete === false && ['hook', 'journey'].includes(step ?? '') && step) || (flow.stages.some((s) => s.key === step) && step) || stage?.key || flow.stages[0].key);
	let problem = $state('');

	/** @typedef {import('svelte').ComponentProps<typeof Lines>} LinesProps a line and an edit, as the `note` op reads them
	 *  @typedef {NonNullable<LinesProps['note']>['lines'][number] & { title: string | null, record: any }} Line
	 *  @typedef {NonNullable<LinesProps['note']>['edits'][number] & { title: string | null,
	 *   beforeTitle: string | null }} Edit */
	const detail = entryDetail(() => api, () => ({ op: 'note', entry }));
	const note = $derived(/** @type {{ lines: Line[], edits: Edit[] } | null} */ (detail.value));
	/** what the right side shows: its history, or its lines */
	let side = $state('history');

	const proposals = $derived((note?.lines ?? []).slice(1).filter((l) => !l.variant));
	/** its edits by id, as the side (./Lines.svelte) hands one back */
	const byEdit = $derived(new Map((note?.edits ?? []).map((e) => [e.id, e])));
	/** the main line's one latest edit, which restoring changes nothing */
	const latest = $derived(note?.lines[0]?.heads.length === 1 ? note.lines[0].heads[0] : '');

	/** what the acting vault's caps let it do, as the device answers a dry run: rename, merge each proposal */
	let can = $state(/** @type {Record<string, boolean>} */ ({}));
	$effect(() => {
		if (!item) return;
		/** @type {Record<string, object>} */
		const asks = { title: { op: 'set', entry, path: ['title'], value: record.title ?? '' } };
		for (const p of proposals) if (p.line) asks[p.line] = { op: 'merge', entry, from: p.line, into: null };
		const names = Object.keys(asks);
		let gone = false;
		may(api, actor, Object.values(asks)).then((answers) => {
			if (!gone) can = Object.fromEntries(names.map((n, i) => [n, allowed(answers[i])]));
		});
		return () => {
			gone = true;
		};
	});

	/** Sets field `path` of its main line to `value`, where it changed. @param {string} path @param {unknown} value */
	async function set(path, value) {
		if (!writes || value === (record[path] ?? '')) return;
		await api.run(`Changing its ${path}`, { op: 'set', as: actor, entry, path: [path], value });
	}

	/** Moves it to stage `to` of its flow, with the functions the flow runs then. @param {string} to */
	async function move(to) {
		if (world.entriesComplete === false) return;
		if (!item) return;
		const { ops, errors } = await moving(world, actor, item, flow, to, false);
		problem = errors.join(' · ');
		if (errors.length) return;
		const moved = await api.runAll(`Moving it to ${flow.stages.find((s) => s.key === to)?.name ?? to}`, ops);
		// the tab of the stage it is in now shows
		if (moved && step) location.hash = `stories/${entry}`;
	}

	/** Merges proposal `line` into its main line. @param {string} line */
	const merge = (line) => api.run('Merging the proposal', { op: 'merge', as: actor, entry, from: line, into: null });

	/** Restores its main line to the version edit `id` made. @param {string} id */
	const restore = (id) => api.run('Restoring that version', { op: 'restore', as: actor, entry, line: null, at: [id] });

	/** What the button that moves it to stage `s` says. @param {import('./flows.js').Stage} s */
	const label = (s) =>
		stage && flow.stages.indexOf(s) < flow.stages.indexOf(stage) ? `Back to ${s.name}` : `Move to ${s.name}`;

	/** What edit `x` did where a story says it in its own words: titled it. Elsewhere avenDB's (./Lines.svelte).
	 *  @param {{ id: string }} x */
	function titled(x) {
		const e = byEdit.get(x.id);
		if (e?.kind !== 'edit' || e.title === null || e.beforeTitle === null || e.title === e.beforeTitle) return undefined;
		return `Titled it “${e.title}”`;
	}

	/** What its title reads on line `l`, where it isn't what main's reads. @param {{ line: string | null }} l */
	function titleOn(l) {
		const title = note?.lines.find((x) => x.line === l.line)?.title ?? null;
		return title !== null && title !== record.title ? `Title: “${title}”` : undefined;
	}
</script>

<!-- on the left: the flow's stages, each a tab with an address of its own, the one it is in marked -->
{#snippet stages()}
	<h3 class="nav-group">Stages</h3>
	{#each flow.stages as s (s.id)}
		<a
			class="nav-item"
			class:on={tab === s.key}
			href="#stories/{entry}/{s.key}"
			aria-current={tab === s.key ? 'page' : undefined}
			title={stage?.key === s.key ? `It is in ${s.name}` : undefined}
			><Icon name={ICONS[s.key] ?? 'flow'} size={16} /><span>{s.name}</span>{#if stage?.key === s.key}<small>Now</small>{/if}</a
		>
	{/each}
{/snippet}

<!-- on the right: its lines and the main line's history, avenDB's one version side -->
{#snippet about()}
	{#if item}
		<Lines
			{world}
			{note}
			bind:tab={side}
			thing="the story"
			said={titled}
			about={(l) => (l.variant ? undefined : titleOn(l))}
			lineEnd={writes ? merging : undefined}
			below={writes ? restoring : undefined}
			versions={item.proposals ? inAll : undefined}
		/>
	{/if}
{/snippet}

<!-- beside an open proposal: Merge, for whoever may merge it -->
{#snippet merging(/** @type {{ line: string | null, variant?: boolean }} */ l)}
	{#if l.line && !l.variant}
		{@const p = l.line}
		<button
			class="btn"
			disabled={busy || can[p] === false}
			title={can[p] === false ? 'Its share doesn’t let it merge' : undefined}
			onclick={() => merge(p)}>Merge</button
		>
	{/if}
{/snippet}

<!-- under an edit of main: Restore, to put that version back -->
{#snippet restoring(/** @type {{ id: string, kind: string }} */ e)}
	{#if e.id !== latest && e.kind !== 'propose' && e.kind !== 'variant' && e.kind !== 'sealed'}
		<button class="btn quiet restore" disabled={busy} onclick={() => restore(e.id)}>Restore</button>
	{/if}
{/snippet}

<!-- under its lines: how many proposals it has had in all -->
{#snippet inAll()}
	<p class="soft all">{count(item?.proposals ?? 0, 'proposal')} in all.</p>
{/snippet}

<Frame
	bare
	nav={item ? stages : undefined}
	aside={item ? about : undefined}
	navLabel="{flow.name}: its stages"
	navIcon="flow"
	asideLabel="Its proposals and history"
>
	<header class="top">
		<a class="back-arrow" href="#stories" title="All stories" aria-label="All stories"><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="story" size={24} /></span>
		{#if item}
			<input
				class="title"
				bind:value={titleDraft}
				aria-label="Its title"
				disabled={!writes || busy || can.title === false}
				onchange={(ev) => set('title', /** @type {HTMLInputElement} */ (ev.target).value.trim())}
			/>
			<p class="where soft">{nameOf(byId.get(item.vault))}</p>
			{#if writes}
				<span class="moves">
					{#each onward as s (s.id)}
						<button class="btn" class:primary={!stage || flow.stages.indexOf(s) > flow.stages.indexOf(stage)} disabled={busy || world.entriesComplete === false} onclick={() => move(s.key)}>{label(s)}</button>
					{/each}
				</span>
			{/if}
			{#if world.entriesComplete === false}<p class="soft">Stage transitions need their workflow dependencies; this view’s local content is available now.</p>{/if}
			{#if problem}<p class="bad">{problem}</p>{/if}
		{:else}
			<p class="soft">This device holds no story {short(entry)}.</p>
		{/if}
	</header>

	{#if item}
		<section class="step" class:filled={['idea', 'hook', 'thumbnail', 'journey', 'writing', 'movie', 'derivatives'].includes(tab)} aria-label={flow.stages.find((s) => s.key === tab)?.name}>
			<h2>{flow.stages.find((s) => s.key === tab)?.name}</h2>
			{#if tab === 'idea'}
				<p>{STEPS.idea[0]}</p>
				<StorySparks {world} {actor} {api} {busy} {item} {writes} />
			{:else if tab === 'hook'}
				<p>{STEPS.hook[0]}</p>
				<StoryHook {world} {actor} {api} {busy} {item} {writes} lines={note?.lines ?? []} />
			{:else if tab === 'thumbnail'}
				<p>{STEPS.thumbnail[0]}</p>
				<StoryThumbnail {world} {actor} {api} {busy} {item} {writes} />
			{:else if tab === 'journey'}
				<p>{STEPS.journey[0]}</p>
				<StoryJourney {world} {actor} {api} {busy} {item} {writes} lines={note?.lines ?? []} />
			{:else if tab === 'writing'}
				<p>{STEPS.writing[0]}</p>
				<StoryWriting {world} {actor} {api} {busy} {item} {writes} />
			{:else if tab === 'movie'}
				<p>{STEPS.movie[0]}</p>
				<StoryMovie {world} {actor} {api} {busy} {item} {writes} />
			{:else if tab === 'derivatives'}
				<p>{STEPS.derivatives[0]}</p>
				<StoryPosts {world} {actor} {api} {busy} {item} {writes} />
			{:else if STEPS[tab]}
				<p>{STEPS[tab][0]}</p>
				<p class="soft">This step comes with milestone {STEPS[tab][1]} of the content plan.</p>
			{:else}
				<p class="soft">A stage of {flow.name}, {nameOf(byId.get(item.vault))}’s own.</p>
			{/if}
		</section>
	{/if}
</Frame>

<style>
	/* its own head, over the tab picked: back, its title, its vault and the stages it goes on to */
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}

	.back-arrow,
	.docicon {
		display: grid;
		place-items: center;
		color: inherit;
	}

	.title {
		flex: 1 1 14rem;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid transparent;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 1.35rem;
		font-weight: 650;
	}

	.title:hover:not(:disabled),
	.title:focus {
		border-color: var(--edge);
		background: #fff;
	}

	.where {
		margin: 0;
		font-size: 0.82rem;
	}

	.moves {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-left: auto;
	}

	.bad {
		flex-basis: 100%;
		margin: 0;
		color: #9a3324;
		font-size: 0.84rem;
	}

	.step {
		padding: 1.1rem 1.2rem;
		border: 1px dashed var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	.step.filled {
		border-style: solid;
	}

	.step h2 {
		margin: 0 0 0.5rem;
		font-size: 1.05rem;
	}

	.step p {
		margin: 0.3rem 0 0;
		line-height: 1.5;
	}

	/* under an edit of its history (./Lines.svelte) */
	.restore {
		margin-top: 0.3rem;
		padding: 0.16rem 0.5rem;
		font-size: 0.76rem;
	}

	.all {
		margin: 0 0.35rem;
		font-size: 0.76rem;
	}
</style>
