<!--
	Processes: everything this Mac runs, in one place — the Mac's jobs (vault/app jobs.rs), live. Each lane runs one job
	at a time (the GPU: proxies, grading stills, world proxies, renders, hero frames; speech: transcripts; the AI:
	analyses; the disk and the line: sound records, files kept, ingests): what runs now and how far, what waits and why,
	what comes next (to the front, or off the queue), and the history (a failed one made again).
-->
<script>
	import { onDestroy, onMount } from 'svelte';

	/** @typedef {{ id: string, kind: string, lane: 'gpu' | 'speech' | 'ai' | 'io', subject: string, name: string, state: 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled', stage: string, progress: number, priority: number, queued: string, started: string | null, ended: string | null, error: string | null }} Job */

	const LANES = /** @type {const} */ ([
		{ id: 'gpu', label: 'GPU', what: 'proxies, grading stills, world proxies, renders, hero frames' },
		{ id: 'speech', label: 'Speech', what: 'transcripts, on this Mac' },
		{ id: 'ai', label: 'AI', what: 'shot analyses and thumbnails' },
		{ id: 'io', label: 'Disk & line', what: 'ingests, sound records, files kept' }
	]);
	/** @type {Record<string, string>} */
	const KIND = {
		proxy: 'Proxy',
		still: 'Grading still',
		'world-proxy': 'World proxy',
		render: 'Render',
		frame: 'Hero frame',
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
	let now = $state(Date.now());
	let error = $state('');
	let kindFilter = $state('all');
	let stateFilter = $state('all');

	/** @param {string} name @param {Record<string, unknown>} [args] */
	const mac = async (name, args = {}) => {
		const { command } = await import('$lib/native');
		return command(name, args);
	};
	async function load() {
		try {
			const j = /** @type {{ active: Job[], history: Job[], holds: string[] }} */ (await mac('jobs_list', { limit: 300 }));
			active = j.active;
			history = j.history;
			holds = j.holds;
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

	const kinds = $derived([...new Set(history.map((j) => j.kind))]);
	const shown = $derived(history.filter((j) => (kindFilter === 'all' || j.kind === kindFilter) && (stateFilter === 'all' || j.state === stateFilter)));
	const failed = $derived(history.filter((j) => j.state === 'failed').length);
</script>

<section class="processes">
	<header>
		<h2>Processes</h2>
		<p class="lead">Everything this Mac works on, one job at a time in each lane.</p>
		<div class="holds">
			{#each holds as h (h)}<span class="hold">{h === 'ingest' ? 'Waiting for the ingest to finish' : h === 'memory' ? 'Waiting for memory' : `Uploads paused: ${h}`}</span>{/each}
		</div>
	</header>
	{#if error}<p class="error">{error}</p>{/if}

	<div class="lanes">
		{#each LANES as l (l.id)}
			{@const run = running(l.id)}
			{@const next = queued(l.id)}
			<article class="lane" class:busy={run.length > 0}>
				<h3>{l.label} <small>{l.what}</small></h3>
				{#each run as j (j.id)}
					{@const eta = left(j)}
					<div class="job now" class:wait={j.state === 'waiting'}>
						<div class="top"><span class="kind">{KIND[j.kind] ?? j.kind}</span><b title={j.name}>{j.name || j.subject.slice(0, 12)}</b><span class="pct">{Math.round(j.progress * 100)}%</span></div>
						<div class="bar"><i style:width="{j.progress * 100}%"></i></div>
						<p class="meta">{j.stage} · {clock(since(j.started ?? j.queued))}{eta !== null ? ` · about ${clock(eta)} left` : ''}</p>
					</div>
				{:else}
					<p class="idle">Idle</p>
				{/each}
				{#if next.length}
					<p class="next">Next ({next.length})</p>
					<ol>
						{#each next.slice(0, 12) as j, i (j.id)}
							<li>
								<span class="kind">{KIND[j.kind] ?? j.kind}</span>
								<span class="name" title={j.name}>{j.name || j.subject.slice(0, 12)}</span>
								<span class="dim">{clock(since(j.queued))}</span>
								{#if i > 0}<button class="ghost small" onclick={() => bump(j.id)} title="Run it next">↑</button>{/if}
								<button class="ghost small" onclick={() => cancel(j.id)} title="Take it off the queue">×</button>
							</li>
						{/each}
						{#if next.length > 12}<li class="dim">and {next.length - 12} more</li>{/if}
					</ol>
				{/if}
			</article>
		{/each}
	</div>

	<div class="history">
		<div class="hhead">
			<h3>History</h3>
			<div class="filters">
				<button class:on={stateFilter === 'all'} onclick={() => (stateFilter = 'all')}>All</button>
				<button class:on={stateFilter === 'failed'} onclick={() => (stateFilter = 'failed')}>Failed{failed ? ` (${failed})` : ''}</button>
				<button class:on={stateFilter === 'done'} onclick={() => (stateFilter = 'done')}>Done</button>
				<span class="sep"></span>
				<button class:on={kindFilter === 'all'} onclick={() => (kindFilter = 'all')}>Every kind</button>
				{#each kinds as k (k)}<button class:on={kindFilter === k} onclick={() => (kindFilter = k)}>{KIND[k] ?? k}</button>{/each}
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
						<td>{#if j.state === 'failed' || j.state === 'cancelled'}<button class="ghost small" onclick={() => retry(j.id)}>Again</button>{/if}</td>
					</tr>
				{:else}
					<tr><td class="dim" colspan="6">Nothing yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<style>
	.processes {
		grid-area: main;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-height: 0;
		overflow: auto;
		padding: 1.2rem 1.6rem 2rem;
		background: var(--panel);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.4rem 1rem;
	}

	h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.lead {
		margin: 0;
		color: var(--ink-soft);
	}

	.holds {
		display: flex;
		gap: 0.4rem;
		margin-left: auto;
	}

	.hold {
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--warn-line);
		border-radius: 999px;
		background: var(--warn-bg);
		font-size: 0.75rem;
		color: var(--warn);
	}

	.error {
		margin: 0;
		color: var(--bad);
	}

	.lanes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: 0.8rem;
	}

	.lane {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: var(--bg);
	}

	.lane.busy {
		border-color: var(--edge-strong);
	}

	h3 {
		margin: 0;
		font-size: 0.9rem;
	}

	h3 small {
		display: block;
		font-weight: 400;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.job {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.55rem 0.6rem;
		border-radius: 8px;
		background: var(--raised);
	}

	.top {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		min-width: 0;
	}

	.top b {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.pct {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.75rem;
		color: var(--accent);
	}

	.bar {
		height: 6px;
		overflow: hidden;
		border-radius: 3px;
		background: var(--lane);
	}

	.bar i {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	.job.wait .bar i {
		background: var(--warn-line);
	}

	.meta {
		margin: 0;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}

	.job.wait .meta {
		color: var(--warn);
	}

	.idle {
		margin: 0;
		font-size: 0.78rem;
		color: var(--dim);
	}

	.next {
		margin: 0.2rem 0 0;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--dim);
	}

	ol {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		font-size: 0.75rem;
	}

	li .name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.kind {
		flex: none;
		padding: 0 0.4rem;
		border-radius: 4px;
		background: var(--hover);
		font-size: 0.66rem;
		color: var(--ink-soft);
	}

	.dim {
		color: var(--dim);
	}

	.history {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.hhead {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.filters button {
		padding: 0.1rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--raised);
		font: inherit;
		font-size: 0.72rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.filters button.on {
		border-color: var(--accent);
		color: var(--ink);
	}

	.sep {
		width: 1px;
		background: var(--edge);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	td {
		padding: 0.3rem 0.5rem;
		border-bottom: 1px solid var(--edge);
		vertical-align: top;
	}

	td.when {
		white-space: nowrap;
		color: var(--dim);
	}

	td.name {
		max-width: 22rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	td.why {
		max-width: 30rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink-soft);
	}

	tr.done .st {
		color: var(--ok);
	}

	tr.failed .st,
	tr.failed .why {
		color: var(--bad);
	}

	tr.cancelled .st {
		color: var(--dim);
	}
</style>
