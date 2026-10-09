<!--
	A vault's todos, as the acting vault sees them: each of the vault's spaces, its home first, with the todos it reads
	there, each a tick through open, doing and done where it writes, shared on where it owns, and a new todo where it
	writes in the space. What it holds no cap on stays out of sight, as on a device of that vault alone.
-->
<script>
	import Share from './Share.svelte';
	import { allows, count, nameOf, reads, ROLES } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void, onact: (vault: string) => void }}
	 */
	let { world, vault, actor, api, busy, onaccess, onact } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const spaces = $derived(world.spaces.filter((s) => s.founder === vault));

	/** each space's new todo, as the person types it */
	let drafts = $state(/** @type {Record<string, string>} */ ({}));
	/** the todo whose share form is open */
	let sharing = $state('');

	const NEXT = /** @type {const} */ ({ open: 'doing', doing: 'done', done: 'open' });
	const STATUS = /** @type {const} */ ({ open: 'Open', doing: 'Doing', done: 'Done' });

	/** Space `s`'s name in its vault: Home, or Space 2. @param {import('./vaults.js').SpaceView} s */
	const spaceName = (s) => (s.id === here?.home ? 'Home' : `Space ${spaces.indexOf(s) + 1}`);

	/** @param {string} space */
	async function add(space) {
		const title = (drafts[space] ?? '').trim();
		if (title && (await api.todo(actor, space, title))) drafts[space] = '';
	}
</script>

{#each spaces as s (s.id)}
	{@const role = s.roles[actor]}
	{@const seen = s.items.filter((i) => reads(i, actor))}
	{@const todos = seen.filter((i) => i.kind === 'todo')}
	{@const left = todos.filter((t) => t.status !== 'done').length}
	<section class="space">
		<header class="space-head">
			<h2>{spaceName(s)}</h2>
			{#if todos.length}<span class="chip">{left} of {count(todos.length, 'todo')} left</span>{/if}
			{#if role}<span class="chip accent">{nameOf(as)} {ROLES[role]} it</span>{/if}
		</header>

		{#if !seen.length && !role}
			<div class="empty">
				<p>
					{nameOf(as)} can't see {s.items.length ? `the ${count(s.items.length, 'entry', 'entries')}` : 'anything'} in
					{nameOf(here)}'s {s.id === here?.home ? 'home' : 'space'}. A vault that owns it can share it with {nameOf(as)},
					in <button class="link" onclick={onaccess}>Access</button>.
				</p>
				{#if here?.via && vault !== actor}
					<button class="btn" onclick={() => onact(vault)}>Act as {nameOf(here)}</button>
				{/if}
			</div>
		{:else}
			<ul class="card todos">
				{#each todos as it (it.entry)}
					{@const writes = allows(it.roles[actor], 'write')}
					<li class={it.status ?? 'open'}>
						<button
							class="tick"
							disabled={busy || !writes}
							title={writes ? `Mark it ${NEXT[it.status ?? 'open']}` : `${nameOf(as)} only reads it`}
							onclick={() => api.setStatus(actor, s.id, it.entry, NEXT[it.status ?? 'open'])}
						>
							{STATUS[it.status ?? 'open']}
						</button>
						<span class="title">{it.title}</span>
						{#if it.by}<small class="soft">by {nameOf(byId.get(it.by))}</small>{/if}
						{#if allows(it.roles[actor], 'owner')}
							<button class="btn quiet" disabled={busy} onclick={() => (sharing = sharing === it.entry ? '' : it.entry)}>Share</button>
						{/if}
						{#if sharing === it.entry}
							<div class="sharing">
								<Share {world} {actor} {api} {busy} space={s.id} entry={it.entry} ondone={() => (sharing = '')} />
							</div>
						{/if}
					</li>
				{:else}
					<li class="none soft">No todo here yet.</li>
				{/each}
				{#if allows(role, 'write')}
					<li class="add">
						<input
							class="field grow"
							placeholder="A new todo"
							aria-label="A new todo in {spaceName(s)}"
							bind:value={drafts[s.id]}
							onkeydown={(e) => e.key === 'Enter' && add(s.id)}
						/>
						<button class="btn" disabled={busy || !(drafts[s.id] ?? '').trim()} onclick={() => add(s.id)}>Add the todo</button>
					</li>
				{/if}
			</ul>
		{/if}
	</section>
{:else}
	<div class="empty">{nameOf(here)} has no space yet{here?.via ? ': its home comes with its name.' : '.'}</div>
{/each}

<style>
	.space {
		max-width: 46rem;
		margin-bottom: 2rem;
	}

	.space-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}

	.space-head h2 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
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
