<!--
	The Lab: every device side by side for one entry, over the simulated network. Each column says what the device holds
	of it (its writes and their ciphertext) and what it can open: the entry as its app shows it, or a lock. Take a device
	offline or bring it back, lock it, back it up and restore it, checkpoint its log; sync every device, or one with
	another. Below, the plan's scenarios, each run on a Lab of its own.
-->
<script>
	import Doc from './Doc.svelte';
	import Scenarios from './Scenarios.svelte';
	import Todo from './Todo.svelte';
	import { count, short, size } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   open: (space: string, entry: string) => void,
	 *   devices: any[],
	 *   start: { device: string, space: string, entry: string, todos: string, door: string }
	 * }}
	 */
	let { world, rev, act, open, devices, start } = $props();

	/** @type {{ space: string, entry: string, label: string }[]} */
	let entries = $state([]);
	let picked = $state('');
	/** @type {any[]} */
	let columns = $state([]);
	let error = $state('');
	let from = $state('');
	let to = $state('');

	$effect(() => {
		void rev;
		// what Samuel's Mac knows of: every space the tile writes
		world.view({ view: 'spaces', on: start.device }).then((v) => {
			entries = v.spaces.flatMap((/** @type {any} */ s) =>
				s.entries.map((/** @type {any} */ e) => ({ space: s.id, entry: e.id, label: `${s.name} · ${e.title ?? `entry ${short(e.id)}`}` }))
			);
			if (!entries.some((e) => key(e) === picked)) picked = `${start.space}/${start.entry}`;
		});
	});

	$effect(() => {
		void rev;
		const [space, entry] = picked.split('/');
		if (!space || !entry) return;
		world.view({ view: 'lab', space, entry }).then(
			(v) => ([columns, error] = [v.columns, '']),
			(e) => (error = e.message)
		);
	});

	$effect(() => {
		from ||= devices[0]?.id ?? '';
		to ||= devices[1]?.id ?? '';
	});

	/** @param {{ space: string, entry: string }} e */
	const key = (e) => `${e.space}/${e.entry}`;
	/** @param {string} id */
	const deviceOf = (id) => devices.find((d) => d.id === id);
</script>

<div class="row picker">
	<span class="soft">Every device's copy of</span>
	<select class="field" bind:value={picked}>
		{#each entries as e (key(e))}<option value={key(e)}>{e.label}</option>{/each}
	</select>
	<button class="btn quiet" onclick={() => open(...(/** @type {[string, string]} */ (picked.split('/'))))}>Open it</button>
</div>

<div class="row net">
	<button class="btn primary" onclick={() => act({ do: 'sync_all' })}>Sync every device</button>
	<span class="soft">or sync</span>
	<select class="field" bind:value={from}>
		{#each devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
	</select>
	<span class="soft">into</span>
	<select class="field" bind:value={to}>
		{#each devices as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
	</select>
	<button class="btn" disabled={from === to} onclick={() => act({ do: 'sync', from, to })}>Sync</button>
	<span class="soft small">Offline devices sync with nobody. Each sync sends only what the other side lacks.</span>
</div>

{#if error}<p class="error">{error}</p>{/if}

<div class="columns">
	{#each columns as c (c.device.id)}
		{@const d = deviceOf(c.device.id)}
		<article class="column" class:off={!c.online} class:locked={c.locked}>
			<header>
				<b>{c.device.name}</b>
				<div class="row">
					<span class="chip" class:ok={c.online}>{c.online ? 'online' : 'offline'}</span>
					{#if c.locked}<span class="chip warn">locked</span>{/if}
					{#if c.forks}<span class="chip bad">{count(c.forks, 'fork')}</span>{/if}
				</div>
			</header>
			<dl>
				<dt>Its log</dt>
				<dd>{count(c.ops, 'op')}</dd>
				<dt>Holds</dt>
				<dd>{c.knows ? `${count(c.writes, 'write')}, ${size(c.bytes)}` : 'not even the space'}</dd>
				<dt>Key</dt>
				<dd>epoch {c.epoch} {#if c.holdsKey}<span class="chip ok">held</span>{:else}<span class="chip">not held</span>{/if}</dd>
				<dt>Role</dt>
				<dd>{c.role ?? 'none'}</dd>
			</dl>
			<div class="copy">
				{#if c.opens && c.value}
					{#if c.kind === 'todo'}<Todo value={c.value} />{:else}<Doc value={c.value} />{/if}
				{:else if c.knows && c.writes}
					<div class="sealed">🔒 {size(c.bytes)} of ciphertext it can't open</div>
				{:else}
					<div class="sealed none">nothing of it</div>
				{/if}
			</div>
			<footer class="row">
				<button class="btn" onclick={() => act({ do: 'online', on: c.device.id, online: !c.online })}>{c.online ? 'Take offline' : 'Bring online'}</button>
				{#if d?.person}
					<button class="btn" onclick={() => act({ do: c.locked ? 'unlock' : 'lock', on: c.device.id })}>{c.locked ? 'Unlock' : 'Lock'}</button>
				{/if}
				<button class="btn quiet" onclick={() => act({ do: 'backup', on: c.device.id })}>Back up</button>
				{#if d?.backup}<button class="btn quiet" onclick={() => act({ do: 'restore_backup', on: c.device.id })}>Restore the backup</button>{/if}
				<button class="btn quiet" onclick={() => act({ do: 'checkpoint', on: c.device.id })}>Checkpoint</button>
			</footer>
		</article>
	{/each}
</div>

<h2 class="part">Scenarios</h2>
<Scenarios {world} />

<style>
	.picker,
	.net {
		margin-bottom: 0.8rem;
	}

	.small {
		font-size: 0.8rem;
	}

	.columns {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(17rem, 1fr);
		gap: 0.8rem;
		overflow-x: auto;
		padding-bottom: 0.6rem;
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		font-size: 0.86rem;
	}

	.column.off {
		background: #f0ede6;
	}

	.column.locked {
		border-style: dashed;
	}

	header b {
		display: block;
		margin-bottom: 0.3rem;
	}

	dl {
		display: grid;
		grid-template-columns: 4.5rem 1fr;
		gap: 0.2rem 0.5rem;
		margin: 0;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
	}

	.copy {
		flex: 1;
		font-size: 0.8rem;
	}

	.copy :global(.doc),
	.copy :global(.todo) {
		margin: 0;
		padding: 0.6rem 0.7rem;
		font-size: 0.8rem;
	}

	.copy :global(.doc h2) {
		font-size: 1.1rem;
	}

	.copy :global(.doc h3) {
		font-size: 0.98rem;
	}

	.sealed {
		padding: 0.8rem;
		border: 1px dashed rgb(0 0 0 / 0.2);
		border-radius: 10px;
		text-align: center;
		color: var(--soft);
	}

	.sealed.none {
		border-style: dotted;
	}

	footer .btn {
		padding: 0.15rem 0.55rem;
		font-size: 0.75rem;
	}
</style>
