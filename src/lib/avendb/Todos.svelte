<!--
	Todos: every todo the device opens, in any space it knows, as a checklist: its own (in spaces a vault it acts for
	founded), then those shared with it. Tick one through open, doing and done where the device may write; open it for
	the same five tabs as any entry.
-->
<script>
	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   open: (space: string, entry: string) => void
	 * }}
	 */
	let { world, device, rev, act, open } = $props();

	/** @type {any[] | null} */
	let todos = $state(null);
	let error = $state('');

	$effect(() => {
		void rev;
		world.view({ view: 'todos', on: device }).then(
			(v) => ([todos, error] = [v.todos, '']),
			(e) => (error = e.message)
		);
	});

	const all = $derived(/** @type {any[]} */ (todos ?? []));
	/** @type {[string, any[]][]} */
	const groups = $derived([
		['Yours', all.filter((t) => !t.shared)],
		['Shared with me', all.filter((t) => t.shared)]
	]);

	const NEXT = /** @type {Record<string, string>} */ ({ open: 'doing', doing: 'done', done: 'open' });

	/** @param {any} t */
	function tick(t) {
		const value = { kind: 'todo', title: t.title, status: NEXT[t.status] ?? 'open', notes: t.notes ?? '' };
		act({ do: 'put', space: t.space.id, entry: t.id, app: 'v2', value: t.due ? { ...value, due: t.due } : value });
	}

	/** @param {any} t */
	const writes = (t) => t.role === 'write' || t.role === 'owner';
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if todos}
	{#each groups as [title, list] (title)}
		<h2 class="part">{title}</h2>
		{#if list.length}
			<ul>
				{#each list as t (t.id)}
					<li>
						<button class="state {t.status}" disabled={!writes(t)} title={writes(t) ? `Mark it ${NEXT[t.status]}` : 'This device may only read it'} onclick={() => tick(t)}>
							{t.status === 'done' ? '✓' : t.status === 'doing' ? '…' : ''}
						</button>
						<button class="title" onclick={() => open(t.space.id, t.id)}>
							<b class:done={t.status === 'done'}>{t.title || 'Untitled'}</b>
							<span class="soft">{t.space.name}{t.due ? ` · due ${t.due}` : ''}</span>
						</button>
						<span class="chip" class:ok={t.status === 'done'} class:warn={t.status === 'doing'}>{t.status}</span>
						{#if t.role}<span class="chip accent">{t.role}</span>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">{title === 'Yours' ? 'No todos of its own on this device.' : 'Nothing shared with it.'}</p>
		{/if}
	{/each}
{/if}

<style>
	ul {
		max-width: 52rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.4rem;
		border-bottom: 1px solid var(--edge);
	}

	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		text-align: left;
	}

	.state {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		border: 1.5px solid rgb(0 0 0 / 0.35);
		border-radius: 6px;
		font-size: 0.8rem;
	}

	.state:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.state.done {
		border-color: var(--ok);
		background: var(--ok);
		color: #fff;
	}

	.state.doing {
		border-color: #c99a2e;
		color: #8a6512;
	}

	.title {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.title span {
		font-size: 0.8rem;
	}

	b.done {
		text-decoration: line-through;
		text-decoration-color: rgb(0 0 0 / 0.3);
	}
</style>
