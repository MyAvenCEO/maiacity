<!--
	An entry's history as the device holds it: every commit, newest first, with what it did, the device that wrote it and
	the vault it acted for, when, under which key epoch and which schemas. Any version opens read-only; two compare line
	by line; the latest commit on the line reverts, an earlier version is restored, one commit is undone, or a branch
	starts from it.
-->
<script>
	import Doc from './Doc.svelte';
	import Todo from './Todo.svelte';
	import { diffLines, pretty, short, size, when } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   space: string,
	 *   entry: string,
	 *   line: string | null,
	 *   app: string,
	 *   data: any,
	 *   titled: (id: string) => string
	 * }}
	 */
	let { world, device, act, space, entry, line, app, data, titled } = $props();

	/** @type {{ op: string, version: any } | null} */
	let opened = $state(null);
	/** @type {string[]} */
	let picked = $state([]);
	/** @type {{ op: string, value: any }[]} */
	let compared = $state([]);
	/** @type {string | null} */
	let branching = $state(null);
	let branchName = $state('');
	let error = $state('');

	const commits = $derived(/** @type {any[]} */ ([...data.commits].reverse()));
	/** @param {string | null} id */
	const lineOf = (id) => data.lines.find((/** @type {any} */ l) => l.id === id)?.name ?? (id ? `branch ${short(id)}` : 'main');

	/** @param {string} op */
	const versionAt = (op) => world.view({ view: 'version', on: device, space, entry, version: [op], line, app });

	/** @param {string} op */
	async function show(op) {
		if (opened?.op === op) return void (opened = null);
		try {
			opened = { op, version: await versionAt(op) };
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {string} op */
	async function pick(op) {
		picked = picked.includes(op) ? picked.filter((p) => p !== op) : [...picked, op].slice(-2);
		compared = [];
		if (picked.length < 2) return;
		// oldest first, as the history reads
		const order = data.commits.map((/** @type {any} */ c) => c.op);
		const two = [...picked].sort((a, b) => order.indexOf(a) - order.indexOf(b));
		const versions = await Promise.all(two.map(versionAt));
		compared = two.map((op, i) => ({ op, value: versions[i].value ?? versions[i].record }));
	}

	async function branch() {
		if (!branching || !branchName.trim()) return;
		await act({ do: 'branch', space, entry, line, name: branchName.trim(), from: [branching] });
		[branching, branchName] = [null, ''];
	}
</script>

<div class="row top">
	<button class="btn" onclick={() => act({ do: 'revert', space, entry, line })}>Revert the latest commit on {lineOf(line)}</button>
	<span class="soft small">Goes back to what the line's latest commit built on, as a new commit: nothing is erased.</span>
</div>
{#if error}<p class="error">{error}</p>{/if}

{#if compared.length === 2}
	<section class="compare">
		<h3>{short(compared[0].op)} against {short(compared[1].op)}</h3>
		<div class="diff">
			{#each diffLines(pretty(compared[0].value), pretty(compared[1].value)) as d, i (i)}
				<div class:add={d.op === '+'} class:del={d.op === '-'}>{d.op} {d.text}</div>
			{/each}
		</div>
	</section>
{:else if picked.length === 1}
	<p class="soft small">Pick one more commit to compare the two versions.</p>
{/if}

<ol class="commits">
	{#each commits as c (c.op)}
		<li class:here={c.line === line}>
			<div class="row">
				<span class="chip" class:accent={c.kind === 'edit' || c.kind === 'create'} class:warn={c.kind === 'merge' || c.kind === 'promote' || c.kind === 'branch'} class:bad={c.kind === 'sealed'}>{c.kind}</span>
				{#if c.name}<b>{c.name}</b>{/if}
				<span class="mono soft">{short(c.op)}</span>
				<span>{c.author.name}</span>
				<span class="soft">for {c.actor.name}</span>
				<span class="soft">{when(c.when)}</span>
				<span class="chip">{lineOf(c.line)}</span>
				<span class="soft small">key epoch {c.epoch} · {size(c.bytes)}</span>
			</div>
			{#if c.schemas.length}
				<div class="row under">
					<span class="soft small">under</span>
					{#each c.schemas as s (s)}<span class="chip" title={s}>{titled(s)}</span>{/each}
				</div>
			{/if}
			{#if c.opened}
				<div class="row tools">
					<button class="btn quiet" onclick={() => show(c.op)}>{opened?.op === c.op ? 'Close' : 'Open'}</button>
					<label class="soft small"><input type="checkbox" checked={picked.includes(c.op)} onchange={() => pick(c.op)} /> compare</label>
					<button class="btn quiet" onclick={() => act({ do: 'restore', space, entry, line, version: [c.op] })}>Restore this version</button>
					<button class="btn quiet" onclick={() => act({ do: 'undo', space, entry, line, op: c.op })}>Undo just this</button>
					<button class="btn quiet" onclick={() => ([branching, branchName] = [c.op, ''])}>Branch from here</button>
				</div>
			{:else}
				<p class="soft small">This device can't open it: it holds the ciphertext only.</p>
			{/if}
			{#if branching === c.op}
				<div class="row tools">
					<input class="field" placeholder="The branch's name" bind:value={branchName} onkeydown={(e) => e.key === 'Enter' && branch()} />
					<button class="btn primary" disabled={!branchName.trim()} onclick={branch}>Start the branch</button>
					<button class="btn quiet" onclick={() => (branching = null)}>Cancel</button>
				</div>
			{/if}
			{#if opened && opened.op === c.op}
				<div class="version">
					<p class="soft small">The version {short(c.op)} and the {opened.version.commits - 1} commits it builds on, read-only:</p>
					{#if data.kind === 'todo'}
						<Todo value={opened.version.value ?? opened.version.record} {app} />
					{:else}
						<Doc value={opened.version.value ?? opened.version.record} {app} />
					{/if}
				</div>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.top {
		margin-bottom: 1rem;
	}

	.small {
		font-size: 0.8rem;
	}

	.compare {
		margin-bottom: 1.2rem;
	}

	.compare h3 {
		margin: 0 0 0.4rem;
		font-size: 1rem;
	}

	.commits {
		margin: 0;
		padding: 0;
		list-style: none;
		max-width: 70rem;
	}

	.commits li {
		padding: 0.7rem 0.8rem;
		border-left: 3px solid transparent;
		border-bottom: 1px solid var(--edge);
		font-size: 0.88rem;
	}

	.commits li.here {
		border-left-color: var(--accent);
		background: rgb(255 255 255 / 0.55);
	}

	.under,
	.tools {
		margin-top: 0.35rem;
	}

	.tools .btn {
		padding: 0.15rem 0.6rem;
		font-size: 0.78rem;
	}

	.commits p {
		margin: 0.3rem 0 0;
	}

	.version {
		margin-top: 0.6rem;
	}
</style>
