<!--
	Spaces: every space the device knows, grouped by the vault that founded it, with the device's role there and the vault
	it holds it through. Each entry it lists shows its title where the device opens it, and otherwise only that it is
	there: how many writes and how many bytes of ciphertext it holds. Open one to read it, its history, its branches and
	who may do what; write a new one; found a space for any vault the device acts for.
-->
<script>
	import { count, size } from './ui.js';

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

	/** @type {any} */
	let data = $state(null);
	let error = $state('');
	let spaceName = $state('');
	let founder = $state('');
	/** @type {Record<string, { title: string, kind: string }>} */
	let drafts = $state({});

	$effect(() => {
		void rev;
		world.view({ view: 'spaces', on: device }).then(
			(v) => ([data, error] = [v, '']),
			(e) => (error = e.message)
		);
	});

	/** the spaces by the vault that founded them */
	const groups = $derived.by(() => {
		/** @type {Map<string, any[]>} */
		const by = new Map();
		for (const s of data?.spaces ?? []) by.set(s.founder.name, [...(by.get(s.founder.name) ?? []), s]);
		return [...by.entries()];
	});
	const actsFor = $derived(/** @type {any[]} */ (data?.actsFor ?? []));

	$effect(() => {
		if (!actsFor.some((v) => v.id === founder)) founder = actsFor[0]?.id ?? '';
		for (const s of data?.spaces ?? []) drafts[s.id] ??= { title: '', kind: 'document' };
	});

	/** @param {string} space */
	async function create(space) {
		const d = drafts[space];
		if (!d?.title.trim()) return;
		const done = await act({ do: 'create', space, kind: d.kind, title: d.title.trim() });
		if (done?.ok) {
			drafts[space] = { title: '', kind: d.kind };
			open(space, done.made.entry);
		}
	}

	async function found() {
		if (!spaceName.trim() || !founder) return;
		const done = await act({ do: 'found_space', actor: founder, name: spaceName.trim() });
		if (done?.ok) spaceName = '';
	}
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if data}
	{#each groups as [by, spaces] (by)}
		<h2 class="part">Founded by {by}</h2>
		<div class="cards">
			{#each spaces as s (s.id)}
				<article class="card space">
					<header>
						<h3>{s.name}</h3>
						<div class="row">
							{#if s.role}
								<span class="chip accent">{s.role}{s.through ? ` through ${s.through.name}` : ''}</span>
							{:else}
								<span class="chip">no role here</span>
							{/if}
							{#if s.public}<span class="chip warn">public</span>{/if}
							<span class="chip">{count(s.lane, 'schema or lens', 'schemas and lenses')}</span>
						</div>
					</header>
					<ul>
						{#each s.entries as e (e.id)}
							<li>
								<button onclick={() => open(s.id, e.id)}>
									{#if e.opens}
										<span class="kind">{e.kind === 'todo' ? '☐' : '¶'}</span>
										<span class="title">{e.title || 'Untitled'}</span>
										{#if e.status}<span class="chip" class:ok={e.status === 'done'} class:warn={e.status === 'doing'}>{e.status}</span>{/if}
									{:else}
										<span class="kind">🔒</span>
										<span class="title soft">Sealed: {count(e.held, 'write')} held, {size(e.bytes)} of ciphertext</span>
									{/if}
									{#if e.public}<span class="chip warn">public</span>{/if}
									{#if e.lines > 1}<span class="chip">{count(e.lines - 1, 'branch', 'branches')}</span>{/if}
									{#if e.role && e.role !== s.role}<span class="chip accent">{e.role}</span>{/if}
								</button>
							</li>
						{:else}
							<li class="soft none">No entries this device knows of.</li>
						{/each}
					</ul>
					{#if (s.role === 'write' || s.role === 'owner') && drafts[s.id]}
						<footer class="row">
							<input class="field grow" placeholder="A new entry's title" bind:value={drafts[s.id].title} onkeydown={(e) => e.key === 'Enter' && create(s.id)} />
							<select class="field" bind:value={drafts[s.id].kind}>
								<option value="document">Document</option>
								<option value="todo">Todo</option>
							</select>
							<button class="btn" disabled={!drafts[s.id]?.title.trim()} onclick={() => create(s.id)}>Write</button>
						</footer>
					{/if}
				</article>
			{/each}
		</div>
	{:else}
		<p class="empty">This device knows no space yet: another device has to sync with it first.</p>
	{/each}

	<h2 class="part">Found a space</h2>
	{#if actsFor.length}
		<div class="row">
			<input class="field" placeholder="The space's name" bind:value={spaceName} onkeydown={(e) => e.key === 'Enter' && found()} />
			<span class="soft">for</span>
			<select class="field" bind:value={founder}>
				{#each actsFor as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
			</select>
			<button class="btn primary" disabled={!spaceName.trim()} onclick={found}>Found it</button>
		</div>
		<p class="soft small">The founder owns it, and gives the server relay so it syncs through it, without reading it.</p>
	{:else}
		<p class="empty">This device acts for no vault, so it founds nothing.</p>
	{/if}
{/if}

<style>
	h3 {
		margin: 0 0 0.4rem;
		font-size: 1.15rem;
	}

	ul {
		margin: 0.8rem 0 0;
		padding: 0;
		list-style: none;
	}

	li button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.45rem 0.4rem;
		border: 0;
		border-top: 1px solid var(--edge);
		background: none;
		font: inherit;
		font-size: 0.92rem;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	li button:hover {
		background: rgb(0 0 0 / 0.03);
	}

	.kind {
		width: 1.2rem;
		text-align: center;
		color: var(--soft);
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.none {
		padding: 0.5rem 0.4rem;
		border-top: 1px solid var(--edge);
		font-size: 0.88rem;
	}

	footer {
		margin-top: 0.7rem;
	}

	.grow {
		flex: 1;
		min-width: 8rem;
	}

	.small {
		font-size: 0.82rem;
	}
</style>
