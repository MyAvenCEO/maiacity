<!--
	Jobs: everything this Mac runs, live (vault/app jobs.rs). The aside lists the rules that start jobs by themselves, a
	line each; the one picked is described at the top (when it fires, what it makes, how it looks, the code that keeps it,
	how its jobs stand) and filters the rest to its kind. Below: the lanes in one strip (each runs one job at a time),
	what runs and waits (to the front, or off the queue), and the history (a failed one made again).
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	/** @typedef {{ id: string, kind: string, lane: 'gpu' | 'speech' | 'ai' | 'io', subject: string, name: string, state: 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled', stage: string, progress: number, priority: number, queued: string, started: string | null, ended: string | null, error: string | null }} Job */
	/** @typedef {{ id: string, name: string, when: string, then: string, kind: string, lane: string, watch: string, code: string }} Rule */

	const LANES = /** @type {const} */ ([
		{ id: 'gpu', label: 'GPU', what: 'proxies, grading stills, graded stills, world proxies, renders' },
		{ id: 'speech', label: 'Speech', what: 'transcripts, on this Mac' },
		{ id: 'ai', label: 'AI', what: 'shot analyses and hero frames' },
		{ id: 'io', label: 'Disk & line', what: 'ingests, sound records, files kept' }
	]);
	/** @type {Record<string, string>} */
	const KIND = {
		proxy: 'Proxy',
		still: 'Grading still',
		'world-proxy': 'World proxy',
		render: 'Render',
		frame: 'Graded still',
		transcript: 'Transcript',
		analysis: 'Analysis',
		sound: 'Sound record',
		keep: 'Kept',
		ingest: 'Ingest'
	};
	const FINISHED = ['done', 'failed', 'cancelled'];

	/** @type {Job[]} */
	let active = $state([]);
	/** @type {Job[]} */
	let history = $state([]);
	/** @type {string[]} */
	let holds = $state([]);
	/** @type {Rule[]} */
	let rules = $state([]);
	/** the rule picked in the aside: only its kind of job is shown */
	let rule = $state(/** @type {Rule | null} */ (null));
	let now = $state(Date.now());
	let error = $state('');
	let stateFilter = $state('all');

	/** @param {string} name @param {Record<string, unknown>} [args] */
	const mac = async (name, args = {}) => {
		const { command } = await import('$lib/native');
		return command(name, args);
	};
	async function load() {
		try {
			const j = /** @type {{ active: Job[], history: Job[], holds: string[], rules?: Rule[] }} */ (await mac('jobs_list', { limit: 300 }));
			active = j.active;
			history = j.history;
			holds = j.holds;
			rules = j.rules ?? [];
			error = '';
		} catch (e) {
			error = String(e);
		}
	}
	/** a job as the Mac tells it changed @param {Job} j */
	function changed(j) {
		if (FINISHED.includes(j.state)) {
			active = active.filter((x) => x.id !== j.id);
			history = [j, ...history.filter((x) => !(x.id === j.id && x.ended === j.ended))].slice(0, 300);
		} else {
			const i = active.findIndex((x) => x.id === j.id);
			active = i < 0 ? [...active, j] : active.map((x) => (x.id === j.id ? j : x));
		}
	}
	/** @type {(() => void)[]} */
	const unlisten = [];
	onMount(() => {
		void load();
		void import('@tauri-apps/api/event').then(async ({ listen }) => {
			unlisten.push(await listen('jobs', (e) => changed(/** @type {Job} */ (e.payload))));
			unlisten.push(await listen('jobs-gone', (e) => (active = active.filter((x) => x.id !== e.payload))));
		});
		// the clocks tick; what holds the lanes (an ingest, memory) read again now and then
		const tick = setInterval(() => (now = Date.now()), 1000);
		const again = setInterval(() => void load(), 15000);
		return () => (clearInterval(tick), clearInterval(again));
	});
	onDestroy(() => unlisten.forEach((u) => u()));

	/** @param {string} id */
	const cancel = (id) => mac('jobs_cancel', { id }).then(load, (e) => (error = String(e)));
	/** @param {string} id */
	const bump = (id) => mac('jobs_bump', { id }).then(load, (e) => (error = String(e)));
	/** @param {string} id */
	const retry = (id) => mac('jobs_retry', { id }).then(load, (e) => (error = String(e)));

	/** the lane's running jobs, then its queue in the order it will run @param {string} lane */
	const running = (lane) => active.filter((j) => j.lane === lane && (j.state === 'running' || j.state === 'waiting'));
	/** @param {string} lane */
	const queued = (lane) => active.filter((j) => j.lane === lane && j.state === 'queued').sort((a, b) => a.priority - b.priority || a.queued.localeCompare(b.queued));

	/** @param {number} s */
	const clock = (s) => {
		s = Math.max(0, Math.round(s));
		const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
		return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
	};
	/** @param {string | null} iso */
	const since = (iso) => (iso ? (now - Date.parse(iso)) / 1000 : 0);
	/** time left, from how fast it has gone so far @param {Job} j */
	const left = (j) => {
		const t = since(j.started);
		return j.progress > 0.02 && j.progress < 1 && t > 3 ? (t / j.progress) * (1 - j.progress) : null;
	};
	/** @param {Job} j */
	const took = (j) => (j.started && j.ended ? (Date.parse(j.ended) - Date.parse(j.started)) / 1000 : null);
	/** @param {string} iso */
	const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	const kindFilter = $derived(rule?.kind ?? 'all');
	const shown = $derived(history.filter((j) => (kindFilter === 'all' || j.kind === kindFilter) && (stateFilter === 'all' || j.state === stateFilter)));
	const failed = $derived(history.filter((j) => j.state === 'failed' && (kindFilter === 'all' || j.kind === kindFilter)).length);
	/** what a rule's kind of job is doing now: running, queued, failed in the history @param {string} kind */
	const counts = (kind) => ({
		run: active.filter((j) => j.kind === kind && (j.state === 'running' || j.state === 'waiting')).length,
		next: active.filter((j) => j.kind === kind && j.state === 'queued').length,
		bad: history.filter((j) => j.kind === kind && j.state === 'failed').length
	});
	/** @param {Job} j */
	const off = (j) => kindFilter !== 'all' && j.kind !== kindFilter;
	/** what runs and waits, the running first, each lane's queue in the order it will run */
	const now_and_next = $derived(
		[...active].sort((a, b) => {
			const run = (/** @type {Job} */ j) => (j.state === 'running' || j.state === 'waiting' ? 0 : 1);
			return run(a) - run(b) || a.priority - b.priority || a.queued.localeCompare(b.queued);
		})
	);
	const shownActive = $derived(now_and_next.filter((j) => !off(j)));
	/** @param {string} id */
	const laneLabel = (id) => LANES.find((l) => l.id === id)?.label ?? id;
	/** the picked rule's jobs today: done, and how long they took on average */
	const doneOf = $derived.by(() => {
		if (!rule) return { n: 0, avg: null };
		const day = new Date().toDateString();
		const d = history.filter((j) => j.kind === rule?.kind && j.state === 'done' && j.ended && new Date(j.ended).toDateString() === day);
		const ts = d.map(took).filter((t) => t !== null);
		return { n: d.length, avg: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null };
	});
</script>

<section class="jobs">
	<aside class="rules">
		<p class="cap">Rules <small>start jobs by themselves</small></p>
		<button class="rule" class:on={!rule} onclick={() => (rule = null)}>
			<span class="dot all"></span><span class="nm">All jobs</span>
			<span class="ct">{#if active.length}<b class="run">{active.length}</b>{/if}</span>
		</button>
		{#each rules as r (r.id)}
			{@const c = counts(r.kind)}
			<button class="rule" class:on={rule?.id === r.id} title="When {r.when} → {r.then}" onclick={() => (rule = rule?.id === r.id ? null : r)}>
				<span class="dot {r.lane}" class:live={c.run > 0}></span><span class="nm">{r.name}</span>
				<span class="ct">
					{#if c.run}<b class="run">{c.run}</b>{/if}
					{#if c.next}<b>{c.next}</b>{/if}
					{#if c.bad}<b class="bad">{c.bad}</b>{/if}
				</span>
			</button>
		{:else}
			<p class="dim small">The Mac app tells its rules once it is up to date.</p>
		{/each}
	</aside>

	<div class="main">
		<header>
			<h2>Jobs</h2>
			<div class="holds">
				{#each holds as h (h)}<span class="hold">{h === 'ingest' ? 'Waiting for the ingest to finish' : h === 'memory' ? 'Waiting for memory' : `Uploads paused: ${h}`}</span>{/each}
			</div>
		</header>
		{#if error}<p class="error">{error}</p>{/if}

		<article class="detail">
			{#if rule}
				{@const c = counts(rule.kind)}
				<div class="dhead">
					<span class="dot {rule.lane}"></span>
					<h3>{rule.name}</h3>
					<span class="kind">{KIND[rule.kind] ?? rule.kind}</span>
					<span class="kind">{laneLabel(rule.lane)} lane</span>
					<button class="ghost small x" onclick={() => (rule = null)} title="Every job">×</button>
				</div>
				<dl>
					<dt>When</dt><dd>{rule.when}</dd>
					<dt>Then</dt><dd>{rule.then}</dd>
					<dt>Looks</dt><dd>{rule.watch}</dd>
					<dt>Code</dt><dd><code>{rule.code}</code></dd>
				</dl>
				<div class="stats">
					<span><b>{c.run}</b> running</span>
					<span><b>{c.next}</b> waiting</span>
					<span><b>{doneOf.n}</b> done today{doneOf.avg !== null ? ` · ${clock(doneOf.avg)} each` : ''}</span>
					<span class:bad={c.bad > 0}><b>{c.bad}</b> failed</span>
				</div>
			{:else}
				<div class="dhead"><span class="dot all"></span><h3>All jobs</h3></div>
				<p class="dim small">Everything this Mac works on, one job at a time in each lane. Pick a rule to see what starts it, what it makes and the code that keeps it.</p>
				<div class="stats">
					<span><b>{active.filter((j) => j.state === 'running' || j.state === 'waiting').length}</b> running</span>
					<span><b>{active.filter((j) => j.state === 'queued').length}</b> waiting</span>
					<span class:bad={failed > 0}><b>{failed}</b> failed</span>
					<span><b>{rules.length}</b> rules</span>
				</div>
			{/if}
		</article>

		<div class="lanes">
			{#each LANES as l (l.id)}
				{@const run = running(l.id)}
				{@const next = queued(l.id)}
				{@const j = run[0]}
				<div class="lane" class:busy={!!j} class:off={!!j && off(j)} title={l.what}>
					<span class="dot {l.id}" class:live={!!j}></span>
					<span class="ln">{l.label}</span>
					{#if j}
						<span class="jn" class:wait={j.state === 'waiting'} title="{KIND[j.kind] ?? j.kind} · {j.name} · {j.stage}">{j.name || j.subject.slice(0, 12)}</span>
						<span class="pct">{Math.round(j.progress * 100)}%</span>
					{:else}<span class="jn dim">idle</span>{/if}
					{#if next.length}<span class="nx">+{next.length}</span>{/if}
					{#if j}<i class="bar" style:width="{j.progress * 100}%"></i>{/if}
				</div>
			{/each}
		</div>

		{#if shownActive.length}
			<div class="block">
				<p class="cap">Now and next</p>
				<table>
					<tbody>
						{#each shownActive.slice(0, 40) as j (j.id)}
							{@const eta = left(j)}
							<tr class={j.state}>
								<td class="when">{laneLabel(j.lane)}</td>
								<td><span class="kind">{KIND[j.kind] ?? j.kind}</span></td>
								<td class="name" title={j.name}>{j.name || j.subject.slice(0, 12)}</td>
								<td class="st">{j.state === 'queued' ? `waits ${clock(since(j.queued))}` : `${Math.round(j.progress * 100)}%`}</td>
								<td class="why">{j.state === 'queued' ? '' : `${j.stage} · ${clock(since(j.started ?? j.queued))}${eta !== null ? ` · ${clock(eta)} left` : ''}`}</td>
								<td class="acts">
									{#if j.state === 'queued'}
										<button class="ghost small" onclick={() => bump(j.id)} title="Run it next">↑</button>
										<button class="ghost small" onclick={() => cancel(j.id)} title="Take it off the queue">×</button>
									{/if}
								</td>
							</tr>
						{/each}
						{#if shownActive.length > 40}<tr><td class="dim" colspan="6">and {shownActive.length - 40} more</td></tr>{/if}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="block">
			<div class="hhead">
				<p class="cap">History</p>
				<div class="filters">
					<button class:on={stateFilter === 'all'} onclick={() => (stateFilter = 'all')}>All</button>
					<button class:on={stateFilter === 'failed'} onclick={() => (stateFilter = 'failed')}>Failed{failed ? ` (${failed})` : ''}</button>
					<button class:on={stateFilter === 'done'} onclick={() => (stateFilter = 'done')}>Done</button>
				</div>
			</div>
			<table>
				<tbody>
					{#each shown as j (j.id + (j.ended ?? ''))}
						{@const t = took(j)}
						<tr class={j.state}>
							<td class="when">{j.ended ? when(j.ended) : ''}</td>
							<td><span class="kind">{KIND[j.kind] ?? j.kind}</span></td>
							<td class="name" title={j.name}>{j.name || j.subject.slice(0, 12)}</td>
							<td class="st">{j.state}</td>
							<td class="why" title={j.error ?? ''}>{j.state === 'done' ? (t !== null ? `in ${clock(t)}` : '') : (j.error ?? j.stage)}</td>
							<td class="acts">{#if j.state === 'failed' || j.state === 'cancelled'}<button class="ghost small" onclick={() => retry(j.id)}>Again</button>{/if}</td>
						</tr>
					{:else}
						<tr><td class="dim" colspan="6">Nothing yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</section>

<style>
	.jobs {
		grid-area: main;
		display: grid;
		grid-template-columns: 14rem 1fr;
		min-height: 0;
		background: var(--panel);
		font-size: 0.8rem;
	}

	/* ── the rules: a line each ── */
	.rules {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		overflow: auto;
		padding: 0.9rem 0.5rem 1.5rem;
		border-right: 1px solid var(--edge);
		background: var(--bg);
	}

	.cap {
		margin: 0 0 0.35rem;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.cap small {
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	.rules .cap {
		padding: 0 0.45rem;
	}

	.rule {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		height: 1.75rem;
		padding: 0 0.45rem;
		border: 0;
		border-radius: 5px;
		background: transparent;
		font: inherit;
		font-size: 0.78rem;
		text-align: left;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.rule:hover {
		background: var(--hover);
		color: var(--ink);
	}

	.rule.on {
		background: var(--raised);
		box-shadow: inset 2px 0 0 var(--accent);
		color: var(--ink);
	}

	.nm {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.ct {
		display: flex;
		gap: 0.2rem;
	}

	.ct b {
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--hover);
		font-size: 0.64rem;
		text-align: center;
		color: var(--ink-soft);
	}

	.ct b.run {
		background: var(--accent);
		color: var(--on-accent);
	}

	.ct b.bad {
		color: var(--bad);
	}

	/* a lane's colour, on its rules and in the strip */
	.dot {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--dim);
		opacity: 0.55;
	}

	.dot.gpu { background: #6aa7ff; }
	.dot.speech { background: #b98cff; }
	.dot.ai { background: #e8b04a; }
	.dot.io { background: #5fc4a0; }
	.dot.all { background: var(--ink-soft); }

	.dot.live {
		opacity: 1;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
	}

	/* ── the main area ── */
	.main {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		min-width: 0;
		min-height: 0;
		overflow: auto;
		padding: 0.9rem 1.2rem 2rem;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}

	h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.holds {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
	}

	.hold {
		padding: 0.1rem 0.55rem;
		border: 1px solid var(--warn-line);
		border-radius: 999px;
		background: var(--warn-bg);
		font-size: 0.7rem;
		color: var(--warn);
	}

	.error {
		margin: 0;
		color: var(--bad);
	}

	/* the rule picked, described */
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.75rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: var(--bg);
	}

	.dhead {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dhead .dot {
		width: 0.6rem;
		height: 0.6rem;
		opacity: 1;
	}

	h3 {
		margin: 0 0.3rem 0 0;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
	}

	.dhead .x {
		margin-left: auto;
	}

	dl {
		display: grid;
		grid-template-columns: 3.6rem 1fr;
		gap: 0.25rem 0.8rem;
		margin: 0;
	}

	dt {
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		line-height: 1.6;
		text-transform: uppercase;
		color: var(--dim);
	}

	dd {
		margin: 0;
		line-height: 1.4;
		color: var(--ink);
	}

	code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.2rem;
		padding-top: 0.45rem;
		border-top: 1px solid var(--edge);
		color: var(--ink-soft);
	}

	.stats b {
		font-variant-numeric: tabular-nums;
		color: var(--ink);
	}

	.stats .bad,
	.stats .bad b {
		color: var(--bad);
	}

	/* the lanes, one strip */
	.lanes {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.4rem;
	}

	.lane {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		height: 2rem;
		padding: 0 0.6rem;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--bg);
	}

	.lane.busy {
		border-color: var(--edge-strong);
	}

	.lane.off {
		opacity: 0.45;
	}

	.ln {
		flex: none;
		font-weight: 600;
	}

	.jn {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink-soft);
	}

	.jn.wait {
		color: var(--warn);
	}

	.pct {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.7rem;
		color: var(--accent);
	}

	.nx {
		font-size: 0.68rem;
		color: var(--dim);
	}

	.lane .bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	/* the tables */
	.block {
		display: flex;
		flex-direction: column;
	}

	.hhead {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.hhead .cap {
		margin: 0;
	}

	.filters {
		display: flex;
		gap: 0.25rem;
	}

	.filters button {
		padding: 0.05rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.7rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.filters button.on {
		border-color: var(--accent);
		color: var(--ink);
	}

	table {
		width: 100%;
		margin-top: 0.3rem;
		border-collapse: collapse;
		font-size: 0.76rem;
	}

	td {
		padding: 0.22rem 0.45rem;
		border-bottom: 1px solid var(--edge);
		vertical-align: middle;
	}

	td.when {
		width: 7rem;
		white-space: nowrap;
		color: var(--dim);
	}

	td.name {
		max-width: 20rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	td.st {
		white-space: nowrap;
	}

	td.why {
		max-width: 28rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink-soft);
	}

	td.acts {
		width: 4rem;
		text-align: right;
		white-space: nowrap;
	}

	.kind {
		flex: none;
		padding: 0 0.4rem;
		border-radius: 4px;
		background: var(--hover);
		font-size: 0.66rem;
		color: var(--ink-soft);
	}

	tr.done .st {
		color: var(--ok);
	}

	tr.running .st {
		color: var(--accent);
	}

	tr.waiting .st,
	tr.waiting .why {
		color: var(--warn);
	}

	tr.failed .st,
	tr.failed .why {
		color: var(--bad);
	}

	tr.cancelled .st,
	tr.queued .st {
		color: var(--dim);
	}

	.dim {
		color: var(--dim);
	}

	.small {
		margin: 0;
		font-size: 0.75rem;
	}
</style>
