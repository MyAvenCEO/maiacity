<!--
	Render (the left of the Render tab): the button that queues this timeline's render for the worker (bun film worker),
	how the job under way goes — its stage, progress, time left — the timeline's earlier renders, and the worker's
	whole queue when the API lists it.
-->
<script>
	import { raw, running } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const earlier = $derived(s.newest.filter((r) => r.id !== s.focus?.id).slice(0, 8));
	/** @param {number} x */
	const mmss = (x) => {
		x = Math.max(0, Math.round(x));
		const h = Math.floor(x / 3600), m = Math.floor((x % 3600) / 60), r = x % 60;
		return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(r).padStart(2, '0')}`;
	};
	/** @param {string} iso */
	const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	/** What the worker is doing, in plain words. */
	/** @param {import('$lib/auth/client').RenderJob} r */
	function stage(r) {
		if (r.status === 'queued') return 'Waiting for the render worker';
		if (r.status === 'done') return 'Rendered';
		if (r.status === 'failed') return 'The render failed';
		/** @type {Record<string, string>} */
		const said = {
			'fetching files': 'Fetching the files',
			'setting the captions': 'Setting the captions',
			rendering: 'Rendering the film',
			'into the library': 'Into the library'
		};
		return said[r.note ?? ''] ?? r.note ?? 'Starting';
	}
	// the clock ticks while something is under way
	$effect(() => {
		if (!s.active && !s.queuing) return;
		s.now = Date.now();
		const tick = setInterval(() => (s.now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
</script>

<aside class="rq">
	<h3>Render</h3>
	<p class="sub">
		{#if s.stage === 'edit'}The edit is not locked: this renders the cut as it stands.{:else if s.stage === 'locked'}Locked, not marked graded yet.{:else}Stage: {s.stage} · v{s.version}{/if}
	</p>
	<button
		class="render"
		class:busy={!!s.active || s.queuing}
		style:--p="{Math.round((s.active?.progress ?? 0) * 100)}%"
		onclick={() => (s.active || s.queuing ? null : s.exportTimeline())}
		disabled={!s.current}
	>
		{s.queuing ? 'Queueing…' : s.active ? (s.active.status === 'queued' ? 'Waiting…' : `Rendering ${Math.round(s.active.progress * 100)}%`) : '⤓ Render every delivery'}
	</button>

	<div class="panel" role="status" aria-live="polite">
		{#if s.queuing && !s.active}
			<div class="rp-head"><b>Saving the edit, queueing the render…</b></div>
			<div class="rp-bar waiting"><i></i></div>
		{:else if s.focus}
			{@const r = s.focus}
			{@const eta = r.status === 'rendering' ? s.left(r) : null}
			<div class="rp-head">
				<b class="st {r.status}">{stage(r)}</b>
				{#if running(r)}<span class="rp-pct">{Math.round(r.progress * 100)}%</span>{/if}
			</div>
			{#if running(r)}
				<div class="rp-bar" class:waiting={r.status === 'queued'}><i style:width="{r.progress * 100}%"></i></div>
				<p class="rp-meta">
					{mmss(s.elapsed(r))} elapsed
					{#if r.note === 'rendering'}· {eta === null ? 'estimating the time left…' : `about ${mmss(eta)} left`}{/if}
				</p>
				{#if r.status === 'queued' && s.elapsed(r) > 10}
					<p class="rp-hint">No render worker running — start it with <code>bun film worker --local</code></p>
				{/if}
			{:else if r.status === 'done'}
				<p class="rp-meta">{when(r.created)} · took {mmss(s.took(r))}</p>
				{#if r.output_cid}
					<div class="rp-acts">
						<button class="ghost" onclick={() => s.openFile(r.output_cid)}>▶ Play in the viewer</button>
						<a class="ghost" href={raw(r.output_cid)} target="_blank" rel="noopener">File ↗</a>
					</div>
				{/if}
			{:else}
				<p class="rp-meta">{when(r.created)} · after {mmss(s.took(r))}</p>
				<pre class="rp-why">{r.note || 'No reason given.'}</pre>
				<div class="rp-acts"><button class="ghost" onclick={() => s.exportTimeline()}>↻ Render again</button></div>
			{/if}
		{:else}
			<p class="rp-meta">Not rendered yet.</p>
		{/if}
	</div>

	{#if earlier.length}
		<h4>Earlier</h4>
		<ul class="rp-list">
			{#each earlier as r (r.id)}
				<li>
					<span class="st {r.status}">{r.status}</span>
					<span class="d">{when(r.created)}</span>
					{#if r.status === 'done' && r.output_cid}
						<button class="link" onclick={() => s.openFile(r.output_cid)}>play</button>
						<a href={raw(r.output_cid)} target="_blank" rel="noopener">file</a>
					{:else if r.status === 'failed'}
						<span class="why" title={r.note ?? ''}>{r.note}</span>
					{:else}
						<span class="d">{Math.round(r.progress * 100)}%</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<h4>The worker's queue</h4>
	{#if s.jobsKnown}
		{#if s.queue.length}
			<ul class="rp-list">
				{#each s.queue as j (j.id)}
					<li>
						<span class="st {j.status}">{j.kind ?? 'render'}</span>
						<span class="d">{j.status}{j.status === 'rendering' ? ` ${Math.round(j.progress * 100)}%` : ''}</span>
						<span class="tgt">{j.timeline_id === s.current?.id ? 'this timeline' : (j.media_cid?.slice(0, 10) ?? j.timeline_id?.slice(0, 8) ?? '')}{j.shape ? ` · ${j.shape}` : ''}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="rp-meta">Nothing waiting.</p>
		{/if}
	{:else}
		<p class="rp-meta">This timeline's renders only (the API does not list the whole queue yet).</p>
	{/if}
	<button class="ghost small" onclick={() => (s.refreshRenders(), s.refreshJobs())}>↻ Refresh</button>
</aside>

<style>
	.rq {
		grid-area: bin;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 0;
		padding: 0.8rem;
		overflow: auto;
		background: var(--panel);
		font-size: 0.75rem;
	}

	h3,
	h4 {
		margin: 0.3rem 0 0;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	h4 {
		margin-top: 0.6rem;
		padding-top: 0.55rem;
		border-top: 1px solid var(--edge);
		font-size: 0.66rem;
	}

	.sub {
		margin: 0;
		color: var(--dim);
	}

	.render {
		padding: 0.55rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		color: #fff;
		cursor: pointer;
	}

	.render:disabled {
		background: var(--accent);
		cursor: default;
	}

	.render.busy {
		/* the button fills as the film renders */
		background: linear-gradient(90deg, var(--accent) var(--p), #c4a672 var(--p));
		cursor: default;
	}

	.panel {
		padding: 0.6rem 0.7rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	.rp-head {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-size: 0.8rem;
	}

	.rp-head b {
		flex: 1;
		font-weight: 600;
	}

	.rp-pct {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
	}

	.rp-bar {
		overflow: hidden;
		height: 6px;
		margin: 0.5rem 0 0.4rem;
		border-radius: 999px;
		background: var(--edge);
	}

	.rp-bar i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.6s ease;
	}

	/* queued: no progress to show, only that it is alive */
	.rp-bar.waiting i {
		width: 30% !important;
		background: var(--dim);
		opacity: 0.5;
		animation: rp-wait 1.6s ease-in-out infinite alternate;
	}

	@keyframes rp-wait {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(333%);
		}
	}

	.rp-meta {
		margin: 0.3rem 0 0;
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}

	.rp-hint {
		margin: 0.5rem 0 0;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		background: #fbf1dc;
		line-height: 1.4;
	}

	.rp-hint code {
		font-size: 0.72rem;
		white-space: nowrap;
	}

	.rp-why {
		overflow: auto;
		max-height: 8rem;
		margin: 0.45rem 0 0;
		padding: 0.45rem 0.55rem;
		border-radius: 6px;
		background: #f8ebe6;
		font-size: 0.72rem;
		line-height: 1.4;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		color: #9c3b26;
	}

	.rp-acts {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.55rem;
	}

	.rp-acts a {
		text-decoration: none;
	}

	.rp-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rp-list li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}

	.rp-list .d {
		color: var(--dim);
		white-space: nowrap;
	}

	.rp-list .why {
		overflow: hidden;
		min-width: 0;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.rp-list a,
	.rp-list .link {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}

	.st {
		font-weight: 600;
	}

	.rp-list .st {
		min-width: 4rem;
	}

	.st.done {
		color: #2f7d4f;
	}

	.st.failed,
	.rp-list .why {
		color: #9c3b26;
	}
</style>
