<!--
	What this device does in the background for the vault the page shows, live, in the layout every avenDB view has
	(./Frame.svelte): on the left what to show, everything, what runs now, what still syncs, what is done and failed,
	or only the failed or only the done; in the middle what it works on now, each job with its kind, what it works on,
	how far it is and how long it has left; what still syncs, by entry and by file, from where each is synced to: each
	device that holds only some of what this one holds of the vault, with how much of it; and what it did, each with
	where what it worked on is synced to now, or why it failed; on the right the job picked, how far it is, when it
	started and ended, what it is about and where that is synced to now. Its jobs (the device's `jobs` op): files
	brought into its store, sealed as their bytes come; files kept whole, their pieces fetched from the peers that hold
	them; and the edits a peer holds for it, asked for page by page and taken. Each job tells the vaults and entries it
	is about, and the page shows only those of its vault, a pull with only that vault's edits.
	On the Mac app, under them and on the left too, the studio's jobs (Samuel 2026-10-18: the studio has no Jobs tab of
	its own any more): the studio's rules, once for every vault this Mac works for, and every job they start, live, as
	the legacy studio's jobs viewer showed them ($lib/studio/jobs/Tasks.svelte).
-->
<script>
	import { onMount } from 'svelte';
	import { native } from '$lib/native';
	import Tasks from '$lib/studio/jobs/Tasks.svelte';
	import { studio } from './db.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { ago, count, short, size } from './vaults.js';

	/**
	 * A job as the device tells it (avendb-net's `jobs`): `done` of `total` `unit`s, `total` 0 while it doesn't know;
	 * `vaults` and `entries` what it is about, in hex, each with how many of its units are theirs.
	 * @typedef {{ id: string, kind: 'bring' | 'keep' | 'pull', subject: string, name: string,
	 *   state: 'running' | 'done' | 'failed', stage: string, done: number, total: number, unit: string,
	 *   started: number, ended: number | null, error: string | null, vaults?: Record<string, number>,
	 *   entries?: Record<string, number> }} Job
	 */

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any }} */
	let { world, vault, actor, api } = $props();

	/** @type {Job[]} */
	let running = $state([]);
	/** @type {Job[]} */
	let ended = $state([]);
	let failed = $state('');
	let now = $state(Date.now());
	/** what the left side shows: everything, one part of the page, or the jobs that ended so */
	let show = $state(/** @type {(typeof PARTS)[number][0]} */ (''));
	/** the job picked, by its id, whose progress the right side shows */
	let picked = $state('');
	/** the side slid in, where the sides slide in */
	let open = $state(/** @type {'' | 'nav' | 'aside'} */ (''));

	const s = $derived(studio(world, null, vault, actor));

	/** Each kind, as its chip names it. */
	const KIND = /** @type {Record<string, string>} */ ({ bring: 'Bringing in', keep: 'Keeping', pull: 'Taking' });
	/** What the left side shows, each by its key, its name and its icon: the studio's in the Mac app alone. */
	const PARTS = /** @type {const} */ ([
		['', 'Everything', 'jobs'],
		['now', 'Now', 'play'],
		['syncing', 'Syncing', 'sync'],
		['ended', 'Done and failed', 'history'],
		['failed', 'Failed', 'close'],
		['done', 'Done', 'check'],
		['studio', 'Studio', 'studio']
	]);

	// the device's jobs, read again each second while the page shows
	onMount(() => {
		let gone = false;
		const read = async () => {
			try {
				const j = await api.jobs();
				if (!gone) [running, ended, failed] = [j.running, j.ended, ''];
			} catch (e) {
				if (!gone) failed = /** @type {Error} */ (e).message ?? String(e);
			}
		};
		void read();
		const again = setInterval(() => {
			now = Date.now();
			void read();
		}, 1000);
		return () => {
			gone = true;
			clearInterval(again);
		};
	});

	/** How far job `j` is, 0 to 1, or `null` while it doesn't know. @param {Job} j */
	const part = (j) => (j.total > 0 ? Math.min(1, j.done / j.total) : null);

	/** An amount of job `j`'s units, as a person reads it. @param {Job} j @param {number} n */
	const amount = (j, n) => (j.unit === 'bytes' ? size(n) : count(n, j.unit.replace(/s$/, ''), j.unit));

	/**
	 * How far job `j` is, in words: "12 MB of 40 MB", or what it did so far; a pull, only what it took of the vault.
	 * @param {Job} j
	 */
	const howFar = (j) =>
		j.kind === 'pull'
			? amount(j, j.vaults?.[vault] ?? 0)
			: j.total > 0
				? `${amount(j, j.done)} of ${amount(j, j.total)}`
				: amount(j, j.done);

	/** A time in seconds, as a clock reads it: "4:05", "1:02:03". @param {number} t */
	const clock = (t) => {
		const n = Math.max(0, Math.round(t));
		const [h, m, r] = [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60];
		const two = (/** @type {number} */ x) => String(x).padStart(2, '0');
		return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
	};

	/** How long job `j` has run, in seconds. @param {Job} j */
	const took = (j) => ((j.ended ?? now) - j.started) / 1000;

	/** How long job `j` has left, from how fast it has gone so far, or `null` while that says too little. @param {Job} j */
	const left = (j) => {
		const p = part(j);
		const t = took(j);
		return p !== null && p > 0.02 && p < 1 && t > 3 ? (t / p) * (1 - p) : null;
	};

	/** A time in milliseconds since 1970, as a person reads it. @param {number} t */
	const stamp = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	/** When job `j` ended, as a person reads it. @param {Job} j */
	const when = (j) => (j.ended ? stamp(j.ended) : '');

	/** the vault's entries, by id */
	const entries = $derived(new Map(world.entries.filter((e) => e.vault === vault).map((e) => [e.entry, e])));
	/** each file of the vault with the entry that brings it, by the file's root */
	const files = $derived(
		new Map([...entries.values()].flatMap((e) => (e.files ?? []).map((f) => [f.root, { file: f, entry: e.entry }])))
	);

	/** Whether job `j` is about the vault. @param {Job} j */
	const ours = (j) => (j.vaults?.[vault] ?? 0) > 0;

	/** The vault's entries job `j` is about, by id. @param {Job} j */
	const itsEntries = (j) => Object.keys(j.entries ?? {}).filter((e) => entries.has(e));

	/**
	 * What job `j` works on, in words: a file by its name or its entry; a pull by the device it took from and the
	 * entries whose edits it took.
	 * @param {Job} j
	 */
	const what = (j) => {
		if (j.kind === 'pull') {
			const titles = itsEntries(j).map((e) => s.entry(e));
			const more = titles.length > 3 ? ` and ${titles.length - 3} more` : '';
			return `from ${s.signer(j.subject)}${titles.length ? `: ${titles.slice(0, 3).join(', ')}${more}` : ''}`;
		}
		if (j.name) return j.name;
		const entry = files.get(j.subject)?.entry ?? itsEntries(j)[0];
		return entry ? s.entry(entry) : `file ${short(j.subject)}`;
	};

	/**
	 * Where what job `j` worked on is synced to now: a file's devices, as its Synced to says; a pull's, each device
	 * with how many it holds of the edits this one holds of the entries whose edits it took, all of them together.
	 * @param {Job} j @returns {import('./vaults.js').Holder[]}
	 */
	const syncedTo = (j) => {
		if (j.kind !== 'pull') return files.get(j.subject)?.file.syncedTo ?? [];
		const each = itsEntries(j).map((e) => entries.get(e)?.syncedTo ?? []);
		const of = each.reduce((n, hs) => n + Math.max(0, ...hs.map((h) => h.of)), 0);
		/** @type {Map<string, number>} */
		const has = new Map();
		/** @type {Map<string, number>} the oldest each device said it holds them, if it isn't connected now */
		const checked = new Map();
		for (const h of each.flat()) {
			has.set(h.device, (has.get(h.device) ?? 0) + h.has);
			if (h.checked != null) checked.set(h.device, Math.min(checked.get(h.device) ?? h.checked, h.checked));
		}
		return [...has].map(([device, n]) => ({ device, has: n, of, checked: checked.get(device) ?? null }));
	};

	/**
	 * What still syncs of the vault, by entry and by file: each device that holds only some of what this one holds of
	 * it, with how much, the entry's title first.
	 * @typedef {{ id: string, what: string, kind: 'entry' | 'file', device: string, has: number, of: number }} Syncing
	 */
	const syncing = $derived.by(() => {
		/** @type {Syncing[]} */
		const rows = [];
		for (const e of entries.values()) {
			const title = s.entry(e.entry);
			for (const h of e.syncedTo ?? []) {
				if (h.has < h.of) rows.push({ id: `${e.entry}:${h.device}`, what: title, kind: 'entry', ...h });
			}
			for (const f of e.files ?? []) {
				for (const h of f.syncedTo ?? []) {
					if (h.has < h.of) rows.push({ id: `${f.root}:${h.device}`, what: title, kind: 'file', ...h });
				}
			}
		}
		return rows;
	});

	const busy = $derived(running.filter(ours));
	const ends = $derived(ended.filter(ours));
	const shown = $derived(ends.filter((j) => (show !== 'failed' && show !== 'done') || j.state === show));
	const failures = $derived(ends.filter((j) => j.state === 'failed').length);
	/** how many each part on the left lists */
	const counts = $derived(
		/** @type {Record<string, number>} */ ({
			now: busy.length,
			syncing: syncing.length,
			ended: ends.length,
			failed: failures,
			done: ends.length - failures
		})
	);
	/** Whether the page shows its part `part`, as the left side picks. @param {string} part */
	const shows = (part) => !show || show === part || (part === 'ended' && (show === 'failed' || show === 'done'));
	/** the job picked, while the device still tells it */
	const job = $derived(picked ? [...busy, ...ends].find((j) => j.id === picked) : undefined);

	/** Picks job `j`, its progress on the right, slid in where the right side slides in. @param {Job} j */
	function pick(j) {
		picked = j.id;
		if (matchMedia('(max-width: 1100px)').matches) open = 'aside';
	}
</script>

<!-- where what job `j` worked on is synced to now, a chip each device -->
{#snippet where(/** @type {Job} */ j)}
	<div class="where">
		{#each syncedTo(j) as h (h.device)}
			{@const all = h.has >= h.of}
			{@const held = all ? 'all of it' : `${h.has} of ${h.of}`}
			{@const since = h.checked == null ? '' : `, as it said ${ago(h.checked, now)}`}
			<span class="chip" class:ok={all} class:warn={!all} title="{s.signer(h.device)} holds {held}{since}">
				{s.signer(h.device)}{all ? '' : ` ${Math.round((100 * h.has) / h.of)} %`}{h.checked == null
					? ''
					: ` · ${ago(h.checked, now)}`}
			</span>
		{:else}
			<span class="chip">Not synced yet</span>
		{/each}
	</div>
{/snippet}

<!-- what job `j` works on, to pick it: its progress shows on the right -->
{#snippet name(/** @type {Job} */ j)}
	<button class="pick" aria-pressed={picked === j.id} title={j.subject} onclick={() => pick(j)}>{what(j)}</button>
{/snippet}

<!-- down the left, what the page shows: everything, a part of it, or the jobs that ended so -->
{#snippet parts()}
	<h3 class="nav-group">Show</h3>
	{#each PARTS as [key, label, icon] (key)}
		{#if key !== 'studio' || native()}
			<button class="nav-item" class:on={show === key} aria-pressed={show === key} data-pick onclick={() => (show = key)}
				><Icon name={icon} size={16} /><span>{label}</span>{#if key in counts}<small>{counts[key]}</small>{/if}</button
			>
		{/if}
	{/each}
{/snippet}

<!-- on the right, the job picked: how far it is, when, what it is about and where that is synced to -->
{#snippet progress()}
	{#if job}
		{@const p = part(job)}
		{@const eta = left(job)}
		{@const about = itsEntries(job)}
		<header class="about-head">
			<small>{KIND[job.kind] ?? job.kind}</small>
			<h3>{what(job)}</h3>
		</header>
		<h4 class="side-head">{job.state === 'running' ? 'How far it is' : job.state === 'failed' ? 'Why it failed' : 'What it did'}</h4>
		{#if job.state === 'running'}
			<div class="meter">
				<span class="bar"><i style:width="{(p ?? 0) * 100}%" class:unknown={p === null}></i></span>
				<b class="num">{p === null ? '' : `${Math.round(p * 100)} %`}</b>
			</div>
		{/if}
		<dl>
			<dt>It is</dt>
			<dd>
				{#if job.state === 'failed'}<span class="chip bad">Failed</span>
				{:else if job.state === 'done'}<span class="chip ok">Done</span>
				{:else}<span class="chip accent">Running</span>{/if}
			</dd>
			{#if job.stage}
				<dt>Stage</dt>
				<dd>{job.stage}</dd>
			{/if}
			<dt>{job.state === 'running' ? 'So far' : 'It did'}</dt>
			<dd>{howFar(job)}</dd>
			<dt>Started</dt>
			<dd>{stamp(job.started)}</dd>
			{#if job.ended}
				<dt>Ended</dt>
				<dd>{when(job)}</dd>
			{/if}
			<dt>{job.ended ? 'It took' : 'Running for'}</dt>
			<dd>{clock(took(job))}</dd>
			{#if eta !== null}
				<dt>Left</dt>
				<dd>{clock(eta)}</dd>
			{/if}
			{#if job.error}
				<dt>Why</dt>
				<dd class="error">{job.error}</dd>
			{/if}
		</dl>
		<h4 class="side-head">What it is about</h4>
		<dl>
			<dt>{job.kind === 'pull' ? 'From' : 'File'}</dt>
			{#if job.kind === 'pull'}
				<dd>{s.signer(job.subject)}</dd>
			{:else}
				<dd class="mono" title={job.subject}>{short(job.subject)}</dd>
			{/if}
			{#if about.length}
				<dt>{about.length === 1 ? 'Entry' : 'Entries'}</dt>
				<dd>{about.map((e) => s.entry(e)).join(', ')}</dd>
			{/if}
		</dl>
		{#if job.state === 'done'}
			<h4 class="side-head">Synced to</h4>
			{@render where(job)}
		{/if}
	{/if}
{/snippet}

<Frame
	nav={parts}
	aside={job ? progress : undefined}
	bind:open
	navLabel="What it shows"
	asideLabel="The job’s progress"
	navIcon="jobs"
	asideIcon="info"
>
	<div class="jobs">
		<p class="soft lead">
			What this device does in the background for this vault: files it brings in and keeps whole, edits it takes from
			your other devices and avenDB’s server, where each is synced to now, and what still syncs, by entry and by file.
		</p>
		{#if failed}<p class="error">Reading the jobs failed: {failed}</p>{/if}

		{#if shows('now')}
			<section>
				<h3>Now</h3>
				{#if busy.length}
					<table>
						<tbody>
							{#each busy as j (j.id)}
								{@const p = part(j)}
								{@const eta = left(j)}
								<tr class:on={picked === j.id}>
									<td><span class="chip accent">{KIND[j.kind] ?? j.kind}</span></td>
									<td class="name">{@render name(j)}</td>
									<td class="bar"><i style:width="{(p ?? 0) * 100}%" class:unknown={p === null}></i></td>
									<td class="num">{p === null ? '' : `${Math.round(p * 100)} %`}</td>
									<td class="soft">
										{[j.stage, howFar(j), clock(took(j)), eta !== null ? `${clock(eta)} left` : '']
											.filter(Boolean)
											.join(' · ')}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="empty">Nothing runs now.</p>
				{/if}
			</section>
		{/if}

		{#if shows('syncing')}
			<section>
				<h3>Syncing</h3>
				{#if syncing.length}
					<table>
						<tbody>
							{#each syncing as r (r.id)}
								<tr>
									<td><span class="chip">{r.kind === 'file' ? 'File' : 'Entry'}</span></td>
									<td class="name">{r.what}</td>
									<td class="bar"><i style:width="{(r.has / r.of) * 100}%"></i></td>
									<td class="num">{Math.round((100 * r.has) / r.of)} %</td>
									<td class="soft">
										{s.signer(r.device)} holds {r.has} of {count(r.of, r.kind === 'file' ? 'piece' : 'edit')}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="empty">Everything here is on every device that holds it.</p>
				{/if}
			</section>
		{/if}

		{#if shows('ended')}
			<section>
				<h3>{show === 'failed' ? 'Failed' : show === 'done' ? 'Done' : 'Done and failed'}</h3>
				{#if shown.length}
					<table>
						<tbody>
							{#each shown as j (j.id)}
								<tr class={j.state} class:on={picked === j.id}>
									<td class="soft when">{when(j)}</td>
									<td><span class="chip">{KIND[j.kind] ?? j.kind}</span></td>
									<td class="name">{@render name(j)}</td>
									<td>
										{#if j.state === 'failed'}
											<span class="chip bad">Failed</span>
										{:else}
											{@render where(j)}
										{/if}
									</td>
									<td class="soft" title={j.error ?? ''}>
										{j.state === 'failed' ? j.error : `${howFar(j)} in ${clock(took(j))}`}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				{:else}
					<p class="empty">Nothing yet.</p>
				{/if}
			</section>
		{/if}

		{#if native() && shows('studio')}
			<section class="studio">
				<h3>Studio</h3>
				<p class="soft">What the studio’s rules want made of your vaults’ footage and cuts (proxies, stills, transcripts, renders), and this Mac making it, as every vault’s worker.</p>
				<Tasks />
			</section>
		{/if}
	</div>
</Frame>

<style>
	/* the studio's jobs, in this page's colours */
	.studio {
		--warn: #9a6a14;
		--dim: var(--muted, #8a8579);
		--hover: #f1eee6;
		--ok: #2f7a4a;
		--accent: #b8742a;
		--bad: #b23a22;
	}

	.studio :global(.ghost.small) {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font-size: 0.74rem;
		cursor: pointer;
	}

	.jobs {
		display: flex;
		flex-direction: column;
		gap: 1.6rem;
		max-width: 64rem;
		font-size: 0.86rem;
	}

	.lead {
		margin: 0;
	}

	.jobs h3 {
		margin: 0 0 0.5rem;
		font-size: 0.72rem !important;
		letter-spacing: 0.06em !important;
		text-transform: uppercase;
		color: var(--soft);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		border-radius: 12px;
		background: var(--card);
		overflow: hidden;
	}

	td {
		padding: 0.5rem 0.65rem;
		border-top: 1px solid var(--edge);
		vertical-align: middle;
	}

	tr:first-child td {
		border-top: 0;
	}

	.name {
		max-width: 18rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	/* what a job works on, to pick it */
	.pick {
		display: block;
		max-width: 18rem;
		overflow: hidden;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.pick:hover {
		text-decoration: underline;
	}

	tr.on td {
		background: rgb(0 0 0 / 0.04);
	}

	.bar {
		width: 8rem;
	}

	.bar i {
		display: block;
		height: 0.35rem;
		border-radius: 999px;
		background: var(--accent);
	}

	.bar i.unknown {
		width: 100% !important;
		opacity: 0.25;
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}

	.num,
	.when {
		white-space: nowrap;
	}

	.where {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	/* the right side: the job picked, how far it is, then what it is about */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.meter {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0 0 0.7rem;
		font-size: 0.86rem;
	}

	.meter .bar {
		display: block;
		flex: 1;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	dt {
		opacity: 0.6;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	@media (max-width: 640px) {
		td.bar,
		.when {
			display: none;
		}
	}
</style>
