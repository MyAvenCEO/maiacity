<!--
	An entry's lines: main and each branch, with the version it started from and its heads. A branch starts from the head
	of any line (or, in History, from any version), is edited on its own, compares with main, and merges into main (main
	keeps its own changes too) or is promoted (main becomes what the branch says). An entry also forks into another
	space: a copy of its history there, under that space's keys.
-->
<script>
	import { diffLines, pretty, short } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   open: (space: string, entry: string) => void,
	 *   space: string,
	 *   entry: string,
	 *   line: string | null,
	 *   app: string,
	 *   data: any,
	 *   oneditline: (line: string | null) => void
	 * }}
	 */
	let { world, device, rev, act, open, space, entry, line, app, data, oneditline } = $props();

	let name = $state('');
	/** @type {string | null} */
	let from = $state(null);
	/** @type {{ line: string, lines: { op: ' ' | '+' | '-', text: string }[] } | null} */
	let compared = $state(null);
	/** @type {any[]} */
	let targets = $state([]);
	let into = $state('');
	/** @type {{ space: string, entry: string } | null} */
	let forked = $state(null);

	const lines = $derived(/** @type {any[]} */ (data.lines));
	const branches = $derived(lines.filter((l) => l.id));

	$effect(() => {
		void rev;
		world.view({ view: 'spaces', on: device }).then(
			(v) => {
				targets = v.spaces.filter((/** @type {any} */ s) => s.id !== space && (s.role === 'write' || s.role === 'owner'));
				if (!targets.some((s) => s.id === into)) into = targets[0]?.id ?? '';
			},
			() => (targets = [])
		);
	});

	/** @param {string} l */
	async function compare(l) {
		if (compared?.line === l) return void (compared = null);
		const at = (/** @type {string | null} */ x) => world.view({ view: 'entry', on: device, space, entry, line: x, app });
		const [main, branch] = await Promise.all([at(null), at(l)]);
		compared = { line: l, lines: diffLines(pretty(main.value ?? main.record), pretty(branch.value ?? branch.record)) };
	}

	async function start() {
		if (!name.trim()) return;
		const done = await act({ do: 'branch', space, entry, line: from, name: name.trim() });
		if (done?.ok) {
			name = '';
			oneditline(done.made.line);
		}
	}

	async function fork() {
		if (!into) return;
		const done = await act({ do: 'fork', space, entry, line, into });
		if (done?.ok) forked = { space: done.made.space, entry: done.made.entry };
	}
</script>

<table>
	<thead><tr><th>Line</th><th>Started from</th><th>Heads</th><th></th></tr></thead>
	<tbody>
		{#each lines as l (l.id ?? 'main')}
			<tr class:here={l.id === line}>
				<td><b>{l.name ?? `branch ${short(l.id)}`}</b></td>
				<td class="mono soft">{l.from ? l.from.map(short).join(', ') || 'nothing' : '—'}</td>
				<td class="mono soft">{l.heads.map(short).join(', ')}</td>
				<td>
					<div class="row">
						{#if l.id !== line}<button class="btn quiet" onclick={() => oneditline(l.id)}>Edit on it</button>{/if}
						{#if l.id}
							<button class="btn quiet" onclick={() => compare(l.id)}>{compared?.line === l.id ? 'Hide' : 'Compare with main'}</button>
							<button class="btn quiet" onclick={() => act({ do: 'merge', space, entry, from: l.id, into: null })}>Merge into main</button>
							<button class="btn quiet" onclick={() => act({ do: 'promote', space, entry, from: l.id, into: null })}>Promote to main</button>
							<button class="btn quiet" onclick={() => act({ do: 'merge', space, entry, from: null, into: l.id })}>Bring main in</button>
						{/if}
					</div>
				</td>
			</tr>
			{#if compared && compared.line === l.id}
				<tr>
					<td colspan="4">
						<div class="diff">
							{#each compared.lines as d, i (i)}
								<div class:add={d.op === '+'} class:del={d.op === '-'}>{d.op} {d.text}</div>
							{/each}
						</div>
						<p class="soft small">Main, with the branch's changes marked: + what the branch adds, − what it takes out.</p>
					</td>
				</tr>
			{/if}
		{/each}
	</tbody>
</table>
{#if !branches.length}<p class="soft small">No branches yet.</p>{/if}

<h3>Start a branch</h3>
<div class="row">
	<input class="field" placeholder="The branch's name" bind:value={name} onkeydown={(e) => e.key === 'Enter' && start()} />
	<span class="soft">from the head of</span>
	<select class="field" bind:value={from}>
		{#each lines as l (l.id ?? 'main')}<option value={l.id}>{l.name ?? `branch ${short(l.id)}`}</option>{/each}
	</select>
	<button class="btn primary" disabled={!name.trim()} onclick={start}>Start it</button>
</div>
<p class="soft small">Or start one from any earlier version, in History.</p>

<h3>Fork into another space</h3>
{#if targets.length}
	<div class="row">
		<span class="soft">Copy it, as it stands on this line, into</span>
		<select class="field" bind:value={into}>
			{#each targets as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
		</select>
		<button class="btn" onclick={fork}>Fork it</button>
		{#if forked}
			<button class="btn primary" onclick={() => forked && open(forked.space, forked.entry)}>Open the copy</button>
		{/if}
	</div>
{:else}
	<p class="soft small">This device writes in no other space to fork it into.</p>
{/if}

<style>
	table {
		width: 100%;
		max-width: 70rem;
		border-collapse: collapse;
		font-size: 0.86rem;
	}

	th,
	td {
		padding: 0.45rem 0.5rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		vertical-align: top;
	}

	th {
		font-weight: 500;
		color: var(--soft);
	}

	tr.here td:first-child {
		box-shadow: inset 3px 0 0 var(--accent);
	}

	td .btn {
		padding: 0.15rem 0.6rem;
		font-size: 0.78rem;
	}

	h3 {
		margin: 1.4rem 0 0.5rem;
		font-size: 1.05rem;
	}

	.small {
		font-size: 0.8rem;
	}
</style>
