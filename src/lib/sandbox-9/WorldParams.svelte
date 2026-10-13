<!--
	Sandbox 8 · the World tab: every parameter a run used, grouped and in plain units ($lib/sandbox-9/params.js). For an
	experiment, the base world and the changed world side by side, with the setting the experiment changes marked; on
	the Proof tab, the base world alone, with what it sets apart from the defaults marked.
-->
<script>
	// @ts-nocheck — plain JS
	import { paramRows, plain, words } from './params.js';

	/**
	 * sets: one param set per world, each { settings, catalog } · names: a column name per world · defaults: the
	 * ./genesis.js DEFAULTS, to mark what a run sets apart from them
	 */
	let { sets = [], names = ['Base', 'Changed'], defaults = null, records = null } = $props();

	/** the whole catalog the engine reads (./engine.js catalogAll: [path, { v, u, src, est }]), the same for every world */
	let find = $state('');
	const recRows = $derived(
		(records ?? []).map(([path, r]) => ({ path, name: path.split('.').map(words).join(' · '), text: plain(r), src: r?.src ?? '', est: !!r?.est }))
	);
	const recShown = $derived.by(() => {
		const q = find.trim().toLowerCase();
		return q ? recRows.filter((r) => `${r.name} ${r.text} ${r.src}`.toLowerCase().includes(q)) : recRows;
	});

	const groups = $derived(paramRows(sets, defaults));
	const two = $derived(sets.filter(Boolean).length > 1);
	const counts = $derived.by(() => {
		let s = 0, c = 0, diff = 0, set = 0;
		for (const g of groups)
			for (const r of g.rows) {
				if (r.kind === 'setting') s++;
				else c++;
				if (r.diff) diff++;
				if (r.set) set++;
			}
		return { s, c, diff, set };
	});
	let only = $state(false);
	const shown = $derived(only ? groups.map((g) => ({ ...g, rows: g.rows.filter((r) => (two ? r.diff : r.set)) })).filter((g) => g.rows.length) : groups);
	const tone = (/** @type {number} */ j) => (j === 0 ? 'base' : 'changed');
</script>

<div class="world">
	{#if !groups.length}
		<p class="fine">The parameters arrive with the run.</p>
	{:else}
		<p class="sum">
			{counts.s} settings and {counts.c} catalog constants and village facts{two ? ` for each world. ${counts.diff ? `${counts.diff} differ between the worlds, marked` : 'None differ between the worlds'}` : `. ${counts.set ? `${counts.set} set apart from the defaults, marked` : 'All settings at their defaults'}`}.
		</p>
		<label class="only"><input type="checkbox" bind:checked={only} /> {two ? 'Only what differs' : 'Only what this run sets'}</label>
		{#each shown as g (g.id)}
			<section>
				<h4>{g.label}</h4>
				<table class:two>
					{#if two}
						<thead><tr><th>Parameter</th>{#each names as n, j}<th class={tone(j)}>{n}</th>{/each}</tr></thead>
					{/if}
					<tbody>
						{#each g.rows as r (r.kind + r.key)}
							<tr class:diff={r.diff} class:set={r.set && !r.diff}>
								<td class="lbl" title={r.src || r.key}>
									{r.label}{#if r.diff}<em class="tag">{two ? 'changed' : ''}</em>{:else if r.set}<em class="tag soft">set</em>{/if}{#if r.kind !== 'setting'}<small class="cat">{r.kind === 'village' ? 'village plan' : 'catalog'}{r.est ? ', estimate' : ''}</small>{/if}
								</td>
								{#each r.text as t, j}<td class="val {tone(j)}">{t}</td>{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
		{/each}
		{#if only && !shown.length}<p class="fine">{two ? 'The two worlds ran with the same parameters.' : 'This run uses the defaults everywhere.'}</p>{/if}
		{#if recRows.length}
			<details class="catalog">
				<summary><b>The whole catalog, with sources</b> <span>{recRows.length} records the engine reads, the same for every world</span></summary>
				<input type="search" placeholder="Find (e.g. glulam, kcal, geothermal)" bind:value={find} aria-label="Find a catalog record" />
				<div class="recs">
					<table>
						<tbody>
							{#each recShown as r (r.path)}
								<tr>
									<td class="lbl" title={r.path}>{r.name}{#if r.est}<small class="cat">estimate</small>{/if}</td>
									<td class="val">{r.text}{#if r.src}<small class="src">{r.src}</small>{/if}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				{#if !recShown.length}<p class="fine">Nothing matches “{find}”.</p>{/if}
			</details>
		{/if}
		<p class="fine">Settings are the world’s knobs ($lib/sandbox-9/genesis.js DEFAULTS with this run’s changes); catalog constants and the village plan are what the world was built from ($lib/sandbox-9/primitives.js and the Sandbox 6 village in $lib/sandbox-7). Hover a name for its key or its source.</p>
	{/if}
</div>

<style>
	.world {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		min-width: 0;
	}
	.sum {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ink-soft);
	}
	.only {
		font-size: 0.78rem;
		color: var(--ink-soft);
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	section {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.45rem 0.6rem 0.5rem;
		min-width: 0;
	}
	h4 {
		margin: 0 0 0.2rem;
		font-size: 0.82rem;
		font-family: var(--font-body, inherit);
		font-weight: 700;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.74rem;
		table-layout: fixed;
	}
	table:not(.two) .lbl {
		width: 55%;
	}
	table.two .lbl {
		width: 40%;
	}
	th {
		text-align: left;
		font-weight: 600;
		color: var(--muted);
		font-size: 0.7rem;
		padding: 0.15rem 0.3rem;
	}
	th.base {
		color: #2a78d6;
	}
	th.changed {
		color: #c4521f;
	}
	td {
		padding: 0.22rem 0.3rem;
		border-top: 1px solid var(--line);
		vertical-align: top;
		overflow-wrap: anywhere;
		line-height: 1.35;
	}
	td.val {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}
	.lbl {
		color: var(--ink-soft);
	}
	.lbl .cat {
		color: var(--muted);
		font-size: 0.62rem;
		margin-left: 0.35rem;
		white-space: nowrap;
	}
	tr.diff td {
		background: #fdebd9;
	}
	tr.diff td.val {
		font-weight: 700;
	}
	tr.set td {
		background: #eef3f8;
	}
	.tag {
		font-style: normal;
		font-size: 0.6rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #fff;
		background: #eb6834;
		border-radius: 999px;
		padding: 0 0.35rem;
		margin-left: 0.3rem;
		white-space: nowrap;
	}
	.tag:empty {
		display: none;
	}
	.tag.soft {
		background: #2a78d6;
	}
	.catalog {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 0.45rem 0.6rem 0.5rem;
		min-width: 0;
	}
	.catalog summary {
		cursor: pointer;
		font-size: 0.82rem;
		display: flex;
		flex-wrap: wrap;
		gap: 0.15rem 0.5rem;
		align-items: baseline;
	}
	.catalog summary span {
		font-size: 0.72rem;
		color: var(--muted);
	}
	.catalog input {
		margin: 0.45rem 0 0.3rem;
		width: 100%;
		max-width: 22rem;
		font: inherit;
		font-size: 0.8rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.25rem 0.5rem;
		background: #fff;
		color: var(--ink);
		box-sizing: border-box;
	}
	.recs {
		max-height: 28rem;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.recs table {
		table-layout: fixed;
	}
	.recs .lbl {
		width: 38%;
	}
	.src {
		display: block;
		color: var(--muted);
		font-size: 0.64rem;
		line-height: 1.3;
		margin-top: 0.1rem;
	}
	.fine {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
		line-height: 1.4;
	}
</style>
