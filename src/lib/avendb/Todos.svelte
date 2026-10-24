<!--
	A vault's todos, as the acting vault sees them, in the layout every avenDB view has (./Frame.svelte): on the left
	their tags, to narrow them by one; in the middle one flat list of every todo of the vault it reads, as narrowed,
	each a tick through open, doing and done where it writes and the ops of its caps allow the next one (the
	device answers, by a dry run of each tick: `may`), its tags, to add and take off where it may (Tags), who it is
	shared with, and shared on where it owns; and a new todo where it may add one, tagged as the slice of its cap asks
	(the device says: `creatable`), and where the ops of that cap allow it (`may` again). What it holds no cap on stays
	out of sight, as on a device of that vault alone.
-->
<script>
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { allowed, answer, creatable, may } from './ops.js';
	import Share from './Share.svelte';
	import Tags from './Tags.svelte';
	import {
		count,
		list,
		nameOf,
		reads,
		sharedWith,
		sharedWords,
		sharesOn,
		tagsIn,
		tagsOf,
		why,
		writes,
		authorsLine
	} from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void }}
	 */
	let { world, vault, actor, api, busy, onaccess } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	// One active generic collection subscription; global world remains the metadata
	// source for vault/share navigation, never the barrier for accepted todo edits.
	let collection = $state(/** @type {import('./vaults.js').EntryView[]} */ ([]));
	let collectionError = $state('');
	$effect(() => {
		const selected = vault;
		collection = [];
		collectionError = '';
		return api.observe(() => ({ op: 'entry_views', vault: selected }), (/** @type {any} */ out) => {
			try { collection = answer(out)?.rows ?? []; collectionError = ''; }
			catch (error) { collection = []; collectionError = String(error); }
		}, (/** @type {Error} */ error) => { collection = []; collectionError = error.message; });
	});
	const entries = $derived(collection);
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const todos = $derived(seen.filter((e) => e.kind === 'todo'));
	const tags = $derived(tagsOf(todos));
	/** the tag the todos are narrowed to: '' for all of them */
	let only = $state('');
	/** that tag, while a todo still carries it */
	const by = $derived(tags.some((t) => t.tag === only) ? only : '');
	const shown = $derived(by ? todos.filter((e) => e.tags?.includes(by)) : todos);
	const left = $derived(todos.filter((t) => t.status !== 'done').length);

	/** the new todo, and its tags, as the person types them; and those the acting vault's cap asks for besides */
	let draft = $state('');
	let tagging = $state('');
	const typed = $derived(tagsIn(tagging));
	/** those tags besides, as the device says: `null` while nothing shared with the acting vault lets it add a todo */
	let asked = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, 'todo', typed).then((t) => !gone && (asked = t));
		return () => {
			gone = true;
		};
	});
	/** the todo whose share form is open */
	let sharing = $state('');

	const NEXT = /** @type {const} */ ({ open: 'doing', doing: 'done', done: 'open' });
	const STATUS = /** @type {const} */ ({ open: 'Open', doing: 'Doing', done: 'Done' });

	/** The op that adds a todo titled `title`, tagged as typed and as the cap asks. @param {string} title */
	const adding = (title) => ({
		op: 'create',
		vault,
		type: 'todo',
		tags: [...typed, ...(asked ?? [])],
		value: { kind: 'todo', title }
	});

	async function add() {
		const title = draft.trim();
		if (!title || !asked) return;
		if (await api.run('Adding the todo', { ...adding(title), as: actor })) draft = '';
	}

	/** why the device won't add the todo for the acting vault, as it answers a dry run of adding it: '' */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const op = adding('A todo');
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = allowed(a) ? '' : why(/** @type {any} */ (a));
		});
		return () => {
			gone = true;
		};
	});

	/** The op that ticks todo `entry` on to `status`. @param {string} entry @param {string} status */
	const ticking = (entry, status) => ({ op: 'set', as: actor, entry, path: ['status'], value: status });
	/** Todo `entry` ticked on to `status`. @param {string} entry @param {string} status */
	const tick = (entry, status) => api.run('Saving', ticking(entry, status));

	/** whether the acting vault may tick each todo it writes on, by entry, as the device answers: `true`, or why not */
	let ticks = $state(/** @type {Record<string, import('./vaults.js').Verdict>} */ ({}));
	$effect(() => {
		const writable = shown.filter((it) => writes(it, actor));
		const ops = writable.map((it) => ticking(it.entry, NEXT[it.status ?? 'open']));
		let gone = false;
		may(api, actor, ops).then((answers) => {
			if (!gone) ticks = Object.fromEntries(writable.map((it, i) => [it.entry, answers[i]]));
		});
		return () => {
			gone = true;
		};
	});
</script>

<!-- the left side: all the todos, or those of one tag -->
{#snippet narrow()}
	<h3 class="nav-group">Todos</h3>
	<button class="nav-item" class:on={!by} aria-pressed={!by} data-pick onclick={() => (only = '')}
		><Icon name="todo" size={16} /><span>All</span><small>{todos.length}</small></button
	>
	<h3 class="nav-group">Tags</h3>
	{#each tags as t (t.tag)}
		<button class="nav-item" class:on={only === t.tag} aria-pressed={only === t.tag} data-pick onclick={() => (only = only === t.tag ? '' : t.tag)}
			><Icon name="tag" size={16} /><span>{t.tag}</span><small>{t.uses}</small></button
		>
	{/each}
{/snippet}

<Frame nav={tags.length ? narrow : undefined} navLabel="Narrow the todos" navIcon="todo">
	<section class="todos-of">
		{#if collectionError}<p role="alert">{collectionError}</p>{/if}
		{#if todos.length}<p class="head"><span class="chip">{left} of {count(todos.length, 'todo')} left</span></p>{/if}

		{#if !seen.length && vault !== actor}
			<div class="empty">
				<p>
					{nameOf(as)} can't see {entries.length ? `the ${count(entries.length, 'entry', 'entries')}` : 'anything'} in
					{nameOf(here)}. A vault that owns it can share its todos with {nameOf(as)}, all of them or those tagged one way, in
					<button class="link" onclick={onaccess}>Sharing</button>.
				</p>
			</div>
		{:else}
			<ul class="card todos">
				{#each shown as it (it.entry)}
					{@const changes = writes(it, actor)}
					{@const answer = ticks[it.entry]}
					{@const refused = answer === undefined || allowed(answer) ? null : /** @type {any} */ (answer)}
					<li class={it.status ?? 'open'}>
						<button
							class="tick"
							disabled={busy || !changes || !!refused}
							title={!changes
								? `${nameOf(as)} may only view it`
								: refused
									? `It can't be marked ${NEXT[it.status ?? 'open']}: ${why(refused)}`
									: `Mark it ${NEXT[it.status ?? 'open']}`}
							onclick={() => tick(it.entry, NEXT[it.status ?? 'open'])}
						>
							{STATUS[it.status ?? 'open']}
						</button>
						<span class="title">{it.title}</span>
						<Tags {world} {actor} {api} {busy} entry={it} />
						{#if it.authors?.length || it.by !== vault}<small class="soft">by {authorsLine(world, it.authors, nameOf(byId.get(it.by)))}</small>{/if}
						{#if sharesOn(it, actor)}
							<button class="btn quiet" disabled={busy} onclick={() => (sharing = sharing === it.entry ? '' : it.entry)}>Share</button>
						{/if}
						<small class="soft shared">
							Shared with {sharedWords(sharedWith(world, vault, it.entry))}{it.public ? ' · Public' : ''}
						</small>
						{#if sharing === it.entry}
							<div class="sharing">
								<Share {world} {actor} {api} {busy} {vault} entry={it.entry} ondone={() => (sharing = '')} />
							</div>
						{/if}
					</li>
				{:else}
					<li class="none soft">No todo here{by ? ` tagged “${by}”` : ''} yet.</li>
				{/each}
				{#if asked}
					<li class="add">
						<input
							class="field grow"
							placeholder="A new todo"
							aria-label="A new todo"
							bind:value={draft}
							onkeydown={(e) => e.key === 'Enter' && add()}
						/>
						<input class="field tagging" placeholder="tags (optional)" bind:value={tagging} aria-label="The new todo’s tags" />
						<button class="btn" disabled={busy || !draft.trim() || !!unadded} onclick={add}
							>Add the todo</button
						>
						{#if unadded}
							<small class="soft">{nameOf(as)} can’t add it: {unadded}.</small>
						{:else if asked.length}
							<small class="soft">Tagged {list(asked.map((t) => `“${t}”`))} too, as {nameOf(as)}’s share asks.</small>
						{/if}
					</li>
				{/if}
			</ul>
			{#if entries.length > seen.length}
				<p class="soft">{count(entries.length - seen.length, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
			{/if}
		{/if}
	</section>
</Frame>

<style>
	.todos-of {
		max-width: 52rem;
		margin-bottom: 2rem;
	}

	.head {
		margin: 0 0 0.7rem;
	}

	.tagging {
		width: 9rem;
	}

	.todos {
		margin: 0;
		padding: 0.3rem 0.9rem;
		list-style: none;
	}

	.todos li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.todos li:last-child {
		border-bottom: 0;
	}

	.todos .title {
		flex: 1 1 10rem;
	}

	.todos li.done .title {
		color: var(--soft);
		text-decoration: line-through;
	}

	.none {
		font-size: 0.88rem;
	}

	.tick {
		min-width: 4.2rem;
		padding: 0.2rem 0.55rem;
		border: 1px solid rgb(0 0 0 / 0.15);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
	}

	.tick:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.doing .tick {
		border-color: #c99a3a;
		background: #efe3c8;
	}

	.done .tick {
		border-color: var(--ok);
		background: #dcebd9;
	}

	.sharing,
	.shared {
		flex-basis: 100%;
	}

	.shared {
		margin-top: -0.3rem;
		padding-left: 4.8rem;
		font-size: 0.74rem;
	}

	.grow {
		flex: 1 1 12rem;
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
