<!--
	A vault's stories, in the layout every avenDB view has (./Frame.svelte): in the middle as a board lays out its
	cards, a column for each stage of the story flow (./flows.js), from Idea to Published, each story a card in the
	column of the stage it is in, by its tag; on the left those stages, how many stories each holds, each bringing its
	column into view. A story is one content piece from its first spark to every platform it goes out on, a record of
	avenDB's own `story` schema; nothing here names a vault, so every vault has its stories, as it has its notes. A new
	one starts as an idea, written by the acting vault, where a cap lets it add one (`creatable`, `may`). A click opens
	it (Story).
-->
<script>
	import { flowsFor, STORY, stageOf, stageTag } from './flows.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { allowed, creatable, may } from './ops.js';
	import { count, nameOf, reads, why } from './vaults.js';

	/** The type of a story's entry, and the kind of its record. */
	const TYPE = 'story';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onopen } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const stories = $derived(
		seen.filter((e) => e.type === TYPE && !e.deleted).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
	);
	const hidden = $derived(entries.length - seen.length);

	/** the flow its stories go through: the vault's own story flow first, else the app's */
	const flow = $derived(flowsFor(world, vault, TYPE)[0] ?? STORY);
	/** the stories in each stage, and those in none of them (a tag taken off by hand) */
	const columns = $derived(
		flow.stages.map((s) => ({ stage: s, stories: stories.filter((e) => stageOf(e, flow)?.key === s.key) }))
	);
	const loose = $derived(stories.filter((e) => !stageOf(e, flow)));

	/** the tags the acting vault's caps ask a new story to carry: `null` where nothing lets it add one */
	let asked = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, TYPE).then((t) => !gone && (asked = t));
		return () => {
			gone = true;
		};
	});

	/** The op that adds story `title`, an idea. @param {string} title */
	const adding = (title) => ({
		op: 'create',
		vault,
		type: TYPE,
		tags: [...(asked ?? []), stageTag(flow.key, flow.stages[0].key)],
		value: { kind: TYPE, title, tags: [] }
	});

	/** why the device won't add a story for the acting vault, as it answers a dry run: '' where it would */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const op = adding('A story');
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = allowed(a) ? '' : why(/** @type {any} */ (a));
		});
		return () => {
			gone = true;
		};
	});

	let title = $state('');

	async function add() {
		const name = title.trim();
		if (!name) return;
		const made = await api.run(`Starting “${name}”`, { ...adding(name), as: actor });
		if (made) {
			title = '';
			onopen(made.entry);
		}
	}

	/** What a story is, in a few words, on its card. @param {import('./vaults.js').EntryView} e */
	const format = (e) => /** @type {any} */ (e.record)?.format ?? '';

	/** @type {HTMLElement | undefined} */
	let board = $state();
	/** Brings stage `key`'s column into view on the board. @param {string} key */
	const toStage = (key) =>
		board?.querySelector(`[data-stage="${CSS.escape(key)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
	/** whether the board shows: the acting vault sees something here, or it is the vault itself */
	const boarded = $derived(seen.length > 0 || vault === actor);
</script>

<!-- the left side: the flow's stages, each with how many stories it holds, each bringing its column into view -->
{#snippet stages()}
	<h3 class="nav-group">{flow.name} stages</h3>
	{#each columns as { stage, stories: in_ } (stage.id)}
		<button class="nav-item" data-pick onclick={() => toStage(stage.key)}
			><Icon name="story" size={16} /><span>{stage.name}</span><small>{in_.length}</small></button
		>
	{/each}
{/snippet}

<Frame nav={boarded ? stages : undefined} navLabel="The stages of {flow.name}" navIcon="story">
	{#if asked}
		<form class="start" onsubmit={(ev) => (ev.preventDefault(), add())}>
			<input
				class="field"
				bind:value={title}
				placeholder="A new story, its working title"
				aria-label="The new story's working title"
				disabled={busy || !!unadded}
			/>
			<button class="btn primary" disabled={busy || !!unadded || !title.trim()}>Start it as an idea</button>
			{#if unadded}<p class="soft">{nameOf(as)} can’t add a story here: {unadded}.</p>{/if}
		</form>
	{/if}

	{#if !boarded}
		<p class="soft">
			{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}: none of
			it is shared with {nameOf(as)}. A vault that owns it can share its stories with {nameOf(as)} in
			<button class="link" onclick={onaccess}>Sharing</button>.
		</p>
	{:else}
		<div class="board" bind:this={board} aria-label="{nameOf(here)}'s stories by stage">
			{#each columns as { stage, stories: in_ } (stage.id)}
				<section class="column" data-stage={stage.key} aria-label={stage.name}>
					<header>
						<b>{stage.name}</b>
						<small class="soft">{in_.length || ''}</small>
					</header>
					{#each in_ as e (e.entry)}
						<a class="card" href="#stories/{e.entry}">
							<b>{e.title || 'Untitled story'}</b>
							<small class="soft">
								{#if format(e)}{format(e)} · {/if}By {nameOf(byId.get(e.by))}{e.proposals
									? ` · ${count(e.proposals, 'proposal')}`
									: ''}
							</small>
						</a>
					{/each}
				</section>
			{/each}
		</div>
		{#if loose.length}
			<p class="soft">
				In no stage of {flow.name}:
				{#each loose as e, i (e.entry)}{#if i}, {/if}<a href="#stories/{e.entry}">{e.title || 'Untitled story'}</a>{/each}
			</p>
		{/if}
		{#if !stories.length}
			<p class="soft empty">
				<Icon name="story" size={18} />
				No story in {nameOf(here)}{asked ? ' yet: start one above.' : '.'}
			</p>
		{/if}
	{/if}

	{#if hidden > 0 && seen.length}
		<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
	{/if}
</Frame>

<style>
	.start {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 1.2rem;
	}

	.start .field {
		flex: 1 1 16rem;
		min-width: 0;
	}

	.start p {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.84rem;
	}

	/* the stages side by side, as a board's columns, scrolling sideways on their own */
	.board {
		display: grid;
		grid-auto-columns: minmax(12.5rem, 1fr);
		grid-auto-flow: column;
		gap: 0.7rem;
		overflow-x: auto;
		padding-bottom: 0.6rem;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		min-height: 9rem;
		padding: 0.6rem;
		border-radius: 12px;
		background: #ece8de;
	}

	.column header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 0 0.2rem 0.2rem;
		font-size: 0.82rem;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 9px;
		background: #fff;
		color: inherit;
		text-decoration: none;
		transition: border-color 0.15s ease;
	}

	.card:hover,
	.card:focus-visible {
		border-color: var(--accent);
	}

	.card b {
		font-size: 0.88rem;
		line-height: 1.35;
	}

	.card small {
		font-size: 0.72rem;
	}

	.empty {
		display: flex;
		align-items: center;
		gap: 0.4rem;
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
