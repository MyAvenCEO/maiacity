<!--
	An AIP's objective in the Proposals app: what it must deliver, metrics written in Lean (avendb/spec/AvenDB/
	Objective.lean), each checked by avenDB's engine against the readings its author recorded while working on it
	(`aip_measure`). Each metric: its name and note, its goal and targets, where it started (its first reading) and
	where it stands now, a bar of its progress and whether it is met; then the Lean itself and every reading, in
	sections that open. Read only: an objective is written and measured by its author, an agent through the MCP.
-->
<script>
	// @ts-nocheck — plain JS
	import { when } from './aips.js';

	/** o: the objective as the `aip` read gives it ($lib/avendb/hitl.js `Objective`), or null */
	let { o } = $props();

	const GOAL = { atLeast: 'at least', atMost: 'at most', between: 'between', equals: 'exactly' };
	const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: 6 }));
	const target = (m) => (m.goal === 'between' ? `${num(m.targets[0])} and ${num(m.targets[1])}` : num(m.targets[0]));
	const pct = (p) => `${Math.round((p ?? 0) * 100)} %`;
</script>

{#if !o}
	<p class="dim">No objective yet. Before it is proposed, its author states what it must deliver: one or more measurable metrics in Lean.</p>
{:else}
	<div class="objective">
		{#if o.error}
			<p class="err">Its Lean does not read: {o.error}</p>
		{:else}
			<p class="total"><b>{o.met} of {o.total} met</b> · {pct(o.progress)} of the way</p>
			<ul class="metrics">
				{#each o.metrics as m (m.id)}
					<li class:met={m.met}>
						<p class="name"><span class="tick" aria-hidden="true">{m.met ? '✓' : '○'}</span><b>{m.name}</b> <small>{GOAL[m.goal]} {target(m)}</small></p>
						{#if m.note}<p class="note">{m.note}</p>{/if}
						<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(m.progress * 100)}><span style="width: {m.progress * 100}%"></span></div>
						<p class="nums">
							{#if m.value == null}Not measured yet{m.readings.length ? `: needs ${m.readings.join(', ')}` : ''}
							{:else}Now {num(m.value)}{m.baseline != null && m.baseline !== m.value ? `, from ${num(m.baseline)}` : ''} · {pct(m.progress)}{/if}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
		<details>
			<summary>The objective in Lean</summary>
			<pre><code>{o.lean}</code></pre>
		</details>
		{#if o.readings?.length}
			<details>
				<summary>Readings <small>{o.readings.length}</small></summary>
				<ul class="readings">
					{#each [...o.readings].reverse() as r (r.id)}
						<li><b>{r.name}</b> {num(r.value)}{r.at ? ` · ${when(r.at)}` : ''}{#if r.note}<span class="dim"> · {r.note}</span>{/if}</li>
					{/each}
				</ul>
			</details>
		{/if}
	</div>
{/if}

<style>
	.objective {
		display: grid;
		gap: 0.5rem;
	}
	.total {
		margin: 0;
		color: #24452f;
	}
	.metrics {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}
	.metrics li {
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		background: #f4f1e8;
	}
	.name,
	.note,
	.nums {
		margin: 0;
	}
	.name small,
	.note,
	.nums {
		color: var(--muted);
	}
	.note {
		margin-top: 0.15rem;
		font-size: 0.84rem;
	}
	.tick {
		display: inline-block;
		width: 1.2rem;
		color: #8a5a00;
	}
	.met .tick {
		color: #136b4b;
	}
	.bar {
		height: 6px;
		margin: 0.45rem 0 0.3rem;
		border-radius: 999px;
		background: #1f2a2314;
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: #eda100;
		border-radius: 999px;
	}
	.met .bar span {
		background: #1baf7a;
	}
	.nums {
		font-size: 0.8rem;
	}
	summary {
		cursor: pointer;
		color: #24452f;
		font-weight: 600;
	}
	summary small {
		font-weight: 400;
		color: var(--muted);
	}
	pre {
		margin: 0.4rem 0 0;
		padding: 0.7rem 0.8rem;
		border-radius: 10px;
		background: #1f2a23;
		color: #f4f1e8;
		font-size: 0.78rem;
		overflow-x: auto;
	}
	.readings {
		margin: 0.4rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.84rem;
	}
	.dim {
		color: var(--muted);
	}
	.err {
		color: #a03224;
		margin: 0;
	}
</style>
