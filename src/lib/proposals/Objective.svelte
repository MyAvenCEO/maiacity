<!--
	An AIP's objective in the Proposals app: what it must deliver, metrics written in Lean (avendb/spec/AvenDB/
	Objective.lean), each checked by avenDB's engine against the readings its author recorded while working on it
	(`aip_measure`), those a Measurer of the vault wrote (`measured "name"`: the vault itself or an owner, who accept
	it, or a holder of its Measurer group, never its author), and the numbers its own lines propose (`proposed "path"`,
	against main's, `current "path"`), and the measuring logic it names, which those who accept it run on their own
	device (`logic "name"`, ./measure.js), and real Lean's verdict on it, where one of them checked it with Lean in theOS
	(./lean.js). Each
	metric: its name and note, its goal and targets, where it started (its first reading, or what main holds) and
	where it stands now, a bar of its progress and whether it is met; then the Lean itself, the numbers read from its
	lines and every reading, in sections that open. Read only: an objective is written and measured by its author, an agent through the MCP.
-->
<script>
	// @ts-nocheck — plain JS
	import { when } from './aips.js';
	import { verdictLine } from './lean.js';

	/** o: the objective as the `aip` read gives it ($lib/avendb/hitl.js `Objective`), or null */
	let { o } = $props();

	const GOAL = { atLeast: 'at least', atMost: 'at most', between: 'between', equals: 'exactly' };
	const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en', { maximumFractionDigits: 6 }));
	const target = (m) => (m.goal === 'between' ? `${num(m.targets[0])} and ${num(m.targets[1])}` : num(m.targets[0]));
	const pct = (p) => `${Math.round((p ?? 0) * 100)} %`;
	/** What a metric still needs before it reads: its readings, or numbers its lines hold at its paths. */
	const needs = (m) =>
		[
			...m.readings.map((r) => (m.measured?.includes(r) ? `${r}, measured by those who accept it` : r)),
			...(m.paths ?? []).map((p) => `a number at ${p}`)
		].join(', ');
	/** Whether a metric reads the proposal alone: its baseline is main's number, not a first reading. */
	const lines = (m) => !m.readings.length && !!m.paths?.length;
</script>

{#if !o}
	<p class="dim">No objective yet. Before it is proposed, its author states what it must deliver: one or more measurable metrics in Lean.</p>
{:else}
	<div class="objective">
		{#if o.error}
			<p class="err">Its Lean does not read: {o.error}</p>
		{:else}
			<p class="total"><b>{o.met} of {o.total} met</b> · {pct(o.progress)} of the way</p>
			{#if o.verdict}
				<p class="lean" class:ok={o.verdict.ok}>
					<span class="tick" aria-hidden="true">{o.verdict.ok ? '✓' : '✗'}</span>{verdictLine(o.verdict)}
					<small class="dim">{o.verdict.note?.split(': ')[0] ?? ''}{o.verdict.at ? ` · ${when(o.verdict.at)}` : ''}</small>
				</p>
			{/if}
			{#if o.measures?.length}<p class="paths">Measured by {#each o.measures as n, i (n)}{i ? ', ' : ''}the logic <code>{n}</code>{/each}, which those who accept it run on its lines, on their own device</p>{/if}
			<ul class="metrics">
				{#each o.metrics as m (m.id)}
					<li class:met={m.met}>
						<p class="name"><span class="tick" aria-hidden="true">{m.met ? '✓' : '○'}</span><b>{m.name}</b> <small>{GOAL[m.goal]} {target(m)}</small></p>
						{#if m.note}<p class="note">{m.note}</p>{/if}
						<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(m.progress * 100)}><span style="width: {m.progress * 100}%"></span></div>
						<p class="nums">
							{#if m.value == null}Not measured yet{needs(m) ? `: needs ${needs(m)}` : ''}
							{:else if lines(m)}Proposed {num(m.value)}{m.baseline == null ? ', new' : m.baseline !== m.value ? `, main holds ${num(m.baseline)}` : ''} · {pct(m.progress)}
							{:else}Now {num(m.value)}{m.baseline != null && m.baseline !== m.value ? `, from ${num(m.baseline)}` : ''} · {pct(m.progress)}{/if}
						</p>
						{#if m.paths?.length}<p class="paths">Reads {#each m.paths as p, i (p)}{i ? ', ' : ''}<code>{p}</code>{/each}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<details>
			<summary>The objective in Lean</summary>
			<pre><code>{o.lean}</code></pre>
		</details>
		{#if o.fields?.length}
			<details>
				<summary>Numbers from its lines <small>{o.fields.length}</small></summary>
				<ul class="readings">
					{#each o.fields as f (f.path)}
						<li><code>{f.path}</code> {f.line ? `${num(f.proposed)}, main ${num(f.current)}` : 'no line holds it'}</li>
					{/each}
				</ul>
			</details>
		{/if}
		{#if o.readings?.length}
			<details>
				<summary>Readings <small>{o.readings.length}</small></summary>
				<ul class="readings">
					{#each [...o.readings].reverse() as r (r.id)}
						<li><b>{r.name}</b> {num(r.value)}{r.at ? ` · ${when(r.at)}` : ''}{#if r.measured}<span class="measured" title="Written by those who accept the AIP, not its author"> · measured</span>{/if}{#if r.note}<span class="dim"> · {r.note}</span>{/if}</li>
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
	.lean {
		margin: 0;
		color: #8a3b00;
	}
	.lean .tick {
		color: inherit;
	}
	.lean.ok {
		color: #136b4b;
	}
	.lean small {
		margin-left: 0.35rem;
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
	.nums,
	.paths {
		font-size: 0.8rem;
	}
	.paths {
		margin: 0.15rem 0 0;
		color: var(--muted);
	}
	code {
		font-size: 0.76rem;
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
	.measured {
		color: #136b4b;
		font-weight: 600;
	}
	.err {
		color: #a03224;
		margin: 0;
	}
</style>
