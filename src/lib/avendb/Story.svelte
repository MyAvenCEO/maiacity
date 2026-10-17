<!--
	One story, the whole screen: its title and format, the stages of the story flow (./flows.js) with the one it is in
	marked and, for whoever may change it, the stages it goes on to; a tab for each stage, each the step of its journey
	the next milestones fill (sparks and idea, hook, thumbnail, journey, writing, movie, derivatives, scheduled,
	published), the Idea tab the sparks it grows from and its sources (StorySparks), the Hook tab its hooks, the one on the card, its
	image title, intro and description beside how it looks on YouTube (StoryHook), the Thumbnail tab its cards, one per
	shape, in layers (StoryThumbnail), the Journey tab where it starts and ends, its question and its beats with their
	tension (StoryJourney), the Writing tab its article, an entry of its own beside it, with its variants (StoryWriting),
	the Movie tab its script, its scenes, lines and shot list, made from the article (StoryMovie);
	and on the right its lines and its
	history, as a note's: each proposal, what its title reads there and Merge for whoever may merge it, and every edit of
	the main line, newest first, who made it and what title it left, to restore. Agents over the Mac app's MCP write on proposals, which the person merges here.
-->
<script>
	import { untrack } from 'svelte';
	import { flowsFor, moving, STORY, stageOf } from './flows.js';
	import Icon from './Icon.svelte';
	import { allowed, may } from './ops.js';
	import StoryHook from './StoryHook.svelte';
	import StoryJourney from './StoryJourney.svelte';
	import StoryMovie from './StoryMovie.svelte';
	import StorySparks from './StorySparks.svelte';
	import StoryThumbnail from './StoryThumbnail.svelte';
	import StoryWriting from './StoryWriting.svelte';
	import { count, nameOf, short } from './vaults.js';

	/** `step` the stage whose tab it opens on, where it isn't the one it is in
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string, step?: string }} */
	let { world, actor, api, busy, entry, step = '' } = $props();

	/** What each stage's tab will hold, and the milestone that brings it. */
	const STEPS = /** @type {Record<string, [string, string]>} */ ({
		idea: ['The sparks it grows from: thoughts, links, pictures, mood boards, others’ posts.', 'M1'],
		hook: ['Its hook variants side by side, the one chosen, its image title, intro and description.', 'M2'],
		thumbnail: ['Its title cards in layers, one per shape, each rendered into the Library.', 'M3'],
		journey: ['From → to, the question it asks, and its beats with their tension.', 'M4'],
		writing: ['Its article, with proposals and variants (a German one, a shorter one).', 'M5'],
		movie: ['Its script: a scene for each of the journey’s beats, the lines they say and the shots they need, and its first cut for the studio.', 'M6 · M7'],
		derivatives: ['Its master post, and every piece cut from it for each platform.', 'M8 · M9'],
		scheduled: ['When each piece goes out, platform by platform, and again.', 'M10'],
		published: ['Live on the Maia Universe and every platform, each with its link.', 'M11']
	});
	const FORMATS = ['film', 'reel', 'article', 'post', 'thread', 'inspire', 'newsletter', 'podcast'];

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const item = $derived(world.entries.find((e) => e.entry === entry));
	const record = $derived(/** @type {any} */ (item?.record) ?? {});
	const writes = $derived(!!item && (item.writers ?? []).includes(actor));

	const flow = $derived(item ? (flowsFor(world, item.vault, 'story')[0] ?? STORY) : STORY);
	const stage = $derived(item ? stageOf(item, flow) : null);
	const onward = $derived(stage ? flow.stages.filter((s) => stage.next.includes(s.key)) : flow.stages);
	/** the stage whose tab shows: the one it is in, until the person picks another */
	let picked = $state(untrack(() => step));
	const tab = $derived((flow.stages.some((s) => s.key === picked) && picked) || stage?.key || flow.stages[0].key);
	let problem = $state('');

	/** @typedef {{ line: string | null, name: string | null, heads: string[], history: string[], title: string | null,
	 *   record: any }} Line
	 *  @typedef {{ id: string, actor: string, line: string | null, kind: string, name: string | null,
	 *   title: string | null, beforeTitle: string | null, counted: boolean }} Edit */
	let note = $state(/** @type {{ lines: Line[], edits: Edit[] } | null} */ (null));
	$effect(() => {
		void world;
		const e = entry;
		let gone = false;
		api.note(e).then(
			(/** @type {any} */ n) => !gone && (note = n ?? null),
			() => {}
		);
		return () => {
			gone = true;
		};
	});
	const proposals = $derived((note?.lines ?? []).slice(1));
	/** the main line's edits, newest first, numbered in the order the device took them */
	const history = $derived.by(() => {
		const on = new Set(note?.lines[0]?.history ?? []);
		const counted = (note?.edits ?? []).filter((e) => e.counted !== false).map((e, i) => ({ ...e, n: i + 1 }));
		return counted.filter((e) => on.has(e.id)).reverse();
	});

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
		if (!item) return;
		const { ops, errors } = await moving(world, actor, item, flow, to, false);
		problem = errors.join(' · ');
		if (await api.runAll(`Moving it to ${flow.stages.find((s) => s.key === to)?.name ?? to}`, ops)) picked = '';
	}

	/** Merges proposal `line` into its main line. @param {string} line */
	const merge = (line) => api.run('Merging the proposal', { op: 'merge', as: actor, entry, from: line, into: null });

	/** Restores its main line to the version edit `id` made. @param {string} id */
	const restore = (id) => api.run('Restoring that version', { op: 'restore', as: actor, entry, line: null, at: [id] });

	/** What the button that moves it to stage `s` says. @param {import('./flows.js').Stage} s */
	const label = (s) =>
		stage && flow.stages.indexOf(s) < flow.stages.indexOf(stage) ? `Back to ${s.name}` : `Move to ${s.name}`;

	/** What edit `e` did, in words. @param {Edit} e */
	function did(e) {
		if (e.kind === 'propose') return `Proposed “${e.name ?? 'a change'}”`;
		if (e.kind === 'merge') return 'Merged a proposal';
		if (e.title !== null && e.beforeTitle !== null && e.title !== e.beforeTitle) return `Titled it “${e.title}”`;
		return 'Changed it';
	}
</script>

<div class="doc">
	<header class="top">
		<a class="back-arrow" href="#stories" title="All stories" aria-label="All stories"><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="story" size={24} /></span>
		{#if item}
			<input
				class="title"
				value={record.title ?? ''}
				aria-label="Its title"
				disabled={!writes || busy || can.title === false}
				onchange={(ev) => set('title', /** @type {HTMLInputElement} */ (ev.target).value.trim())}
			/>
			<select
				class="field"
				value={record.format ?? ''}
				aria-label="What it is"
				disabled={!writes || busy}
				onchange={(ev) => set('format', /** @type {HTMLSelectElement} */ (ev.target).value)}
			>
				<option value="" disabled>What it is…</option>
				{#each FORMATS as f (f)}<option value={f}>{f}</option>{/each}
			</select>
			<p class="where soft">{nameOf(byId.get(item.vault))}</p>
		{:else}
			<p class="soft">This device holds no story {short(entry)}.</p>
		{/if}
	</header>

	{#if item}
		<nav class="flow" aria-label="{flow.name}: its stages">
			{#each flow.stages as s, i (s.id)}
				{#if i}<span class="soft" aria-hidden="true">→</span>{/if}
				<button class="stage" class:on={stage?.key === s.key} class:shown={tab === s.key} onclick={() => (picked = s.key)}
					>{s.name}</button
				>
			{/each}
			{#if writes}
				<span class="moves">
					{#each onward as s (s.id)}
						<button class="btn" class:primary={!stage || flow.stages.indexOf(s) > flow.stages.indexOf(stage)} disabled={busy} onclick={() => move(s.key)}>{label(s)}</button>
					{/each}
				</span>
			{/if}
			{#if problem}<p class="bad">{problem}</p>{/if}
		</nav>

		<div class="body">
			<section class="step" class:filled={['idea', 'hook', 'thumbnail', 'journey', 'writing', 'movie'].includes(tab)} aria-label={flow.stages.find((s) => s.key === tab)?.name}>
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
				{:else if STEPS[tab]}
					<p>{STEPS[tab][0]}</p>
					<p class="soft">This step comes with milestone {STEPS[tab][1]} of the content plan.</p>
				{:else}
					<p class="soft">A stage of {flow.name}, {nameOf(byId.get(item.vault))}’s own.</p>
				{/if}
			</section>

			<aside class="side" aria-label="Its proposals and history">
				<h3>Proposals</h3>
				{#if proposals.length}
					<ul>
						{#each proposals as p (p.line)}
							<li>
								<span>
									<b>{p.name ?? 'A proposal'}</b>
									{#if p.title !== null && p.title !== record.title}<small class="soft">Title: “{p.title}”</small>{/if}
								</span>
								{#if writes && p.line}
									<button
										class="btn"
										disabled={busy || can[p.line] === false}
										title={can[p.line] === false ? 'Its share doesn’t let it merge' : undefined}
										onclick={() => p.line && merge(p.line)}>Merge</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="soft">None. An agent working on it over the Mac app’s MCP proposes its changes here.</p>
				{/if}

				<h3>History</h3>
				<ol>
					{#each history as e, i (e.id)}
						<li>
							<span>
								<b>#{e.n} {did(e)}</b>
								<small class="soft">{nameOf(byId.get(e.actor))}</small>
							</span>
							{#if writes && i > 0 && e.kind !== 'propose'}
								<button class="btn quiet" disabled={busy} onclick={() => restore(e.id)}>Restore</button>
							{/if}
						</li>
					{/each}
				</ol>
				{#if item.proposals}<p class="soft">{count(item.proposals, 'proposal')} in all.</p>{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.doc {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		height: 100%;
		overflow-y: auto;
		padding: 1rem clamp(1rem, 3vw, 2rem) 5rem;
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
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

	.flow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem 0.4rem;
	}

	.stage {
		padding: 0.2rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.stage.shown {
		border-color: var(--accent);
	}

	.stage.on {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
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

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(15rem, 20rem);
		gap: 1.2rem;
		align-items: start;
	}

	@media (max-width: 760px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
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

	.side h3 {
		margin: 0 0 0.4rem;
		font-size: 0.86rem;
	}

	.side h3 + * {
		margin-bottom: 1rem;
	}

	.side ul,
	.side ol {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.side li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		font-size: 0.82rem;
	}

	.side li span {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.side p {
		font-size: 0.82rem;
	}
</style>
