<!--
	A vault's todos, as the acting vault sees them: one flat list of every todo of the vault it reads, narrowed by a
	tag, each a tick through open, doing and done where it writes and the rules of its caps allow the next one (the
	device answers, by a dry run of each tick: `may`), its tags, to add and take off where it may (Tags), and shared on
	where it owns; and a new todo where it may add one, tagged as the slice of its cap asks, and where the rules of
	that cap allow it (`may` again). What it holds no cap on stays out of sight, as on a device of that vault alone.
-->
<script>
	import { may } from './ops.js';
	import Share from './Share.svelte';
	import Tags from './Tags.svelte';
	import { allows, count, creates, list, nameOf, reads, tagsIn, tagsOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onact: (vault: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onact } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const todos = $derived(seen.filter((e) => e.kind === 'todo'));
	const tags = $derived(tagsOf(todos));
	/** the tag the todos are narrowed to: '' for all of them */
	let only = $state('');
	const shown = $derived(only && tags.some((t) => t.tag === only) ? todos.filter((e) => e.tags?.includes(only)) : todos);
	const left = $derived(todos.filter((t) => t.status !== 'done').length);

	/** the new todo, and its tags, as the person types them; and those the acting vault's cap asks for besides */
	let draft = $state('');
	let tagging = $state('');
	const typed = $derived(tagsIn(tagging));
	const asked = $derived(creates(world, vault, actor, 'todo', typed));
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

	/** why the rules of the cap the acting vault adds through don't let it add the todo, as the device answers: '' */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const op = adding('A todo');
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = a !== true && a.refused === 'NotAllowed' ? a.why : '';
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
	let ticks = $state(/** @type {Record<string, true | { refused: string, why: string }>} */ ({}));
	$effect(() => {
		const writable = shown.filter((it) => allows(it.roles[actor], 'write'));
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

<section class="todos-of">
	<header class="head">
		{#if todos.length}<span class="chip">{left} of {count(todos.length, 'todo')} left</span>{/if}
		{#each tags as t (t.tag)}
			<button class="chip pick" class:on={only === t.tag} aria-pressed={only === t.tag} onclick={() => (only = only === t.tag ? '' : t.tag)}
				>#{t.tag} <small>{t.uses}</small></button
			>
		{/each}
	</header>

	{#if !seen.length && vault !== actor}
		<div class="empty">
			<p>
				{nameOf(as)} can't see {entries.length ? `the ${count(entries.length, 'entry', 'entries')}` : 'anything'} in
				{nameOf(here)}. A vault that owns it can share its todos with {nameOf(as)}, all of them or those tagged one way, in
				<button class="link" onclick={onaccess}>Access</button>.
			</p>
			{#if here?.via}
				<button class="btn" onclick={() => onact(vault)}>Act as {nameOf(here)}</button>
			{/if}
		</div>
	{:else}
		<ul class="card todos">
			{#each shown as it (it.entry)}
				{@const writes = allows(it.roles[actor], 'write')}
				{@const answer = ticks[it.entry]}
				{@const ruled = answer === true ? null : answer}
				<li class={it.status ?? 'open'}>
					<button
						class="tick"
						disabled={busy || !writes || !!ruled}
						title={!writes
							? `${nameOf(as)} only reads it`
							: ruled
								? `It can't be marked ${NEXT[it.status ?? 'open']}: ${ruled.why}`
								: `Mark it ${NEXT[it.status ?? 'open']}`}
						onclick={() => tick(it.entry, NEXT[it.status ?? 'open'])}
					>
						{STATUS[it.status ?? 'open']}
					</button>
					<span class="title">{it.title}</span>
					<Tags {world} {actor} {api} {busy} entry={it} />
					{#if it.by !== vault}<small class="soft">by {nameOf(byId.get(it.by))}</small>{/if}
					{#if allows(it.roles[actor], 'owner')}
						<button class="btn quiet" disabled={busy} onclick={() => (sharing = sharing === it.entry ? '' : it.entry)}>Share</button>
					{/if}
					{#if sharing === it.entry}
						<div class="sharing">
							<Share {world} {actor} {api} {busy} {vault} entry={it.entry} ondone={() => (sharing = '')} />
						</div>
					{/if}
				</li>
			{:else}
				<li class="none soft">No todo here{only ? ` tagged “${only}”` : ''} yet.</li>
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
						<small class="soft">Tagged {list(asked.map((t) => `“${t}”`))} too, as {nameOf(as)}’s cap asks.</small>
					{/if}
				</li>
			{/if}
		</ul>
		{#if entries.length > seen.length}
			<p class="soft">{count(entries.length - seen.length, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
		{/if}
	{/if}
</section>

<style>
	.todos-of {
		max-width: 52rem;
		margin-bottom: 2rem;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.7rem;
	}

	.pick {
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.pick small {
		color: var(--soft);
	}

	.pick.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
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

	.sharing {
		flex-basis: 100%;
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
