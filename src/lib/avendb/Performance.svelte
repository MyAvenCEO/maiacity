<!--
	What this device's work costs and how avenDB's server is doing, one page (Samuel 2026-10-20), in the layout every
	avenDB view has (./Frame.svelte): on the left its sections, each a link that scrolls to it (`#performance/server`),
	in the middle all of them, one after another, and on the right the timer picked.

	Work: the device's timers since it started, each how often it ran, its time in all, on average and at most (replay,
	signature checks, refresh, reads), and its counts (edits offered and checked, refresh rounds), as the device's
	`perf` op answers them (avendb's `Lab::perf`). Storage: what the device holds (its edits, the bodies it opened, the
	entries it shows, the blobs it keeps, the vaults' checkpoints and the edits it holds on their word), in theOS what
	avenDB takes on the Mac's disk (its device's folder and its agents', vault/app's `avendb_disk`), else what this
	browser's storage holds of the origin, the page's OPFS store among it (`navigator.storage.estimate`), and the page's
	memory where the browser says it. Server: avenDB's server's own `GET /feed/health`, its memory, how long it has run,
	its last panic and its starts, and what its shelf takes in its bucket and its folder, as it last measured.

	All of it is read on the device, or from the server's public feed, and kept in this page alone: nothing here is
	written to a vault or sent to a peer. It is read when the page opens and again on Refresh.
-->
<script>
	import { onMount, tick } from 'svelte';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { read } from './ops.js';
	import { native } from '$lib/native';
	import { disk as readDisk } from './native.js';
	import { feed } from './server.js';
	import { ago, count, nameOf, short, size } from './vaults.js';

	/** @type {{ api: any, world?: import('./vaults.js').WorldView, section?: string, thisName: string }} */
	let { api, world, section = '', thisName } = $props();
	/** a vault's name as this device knows it, by its id, or its id's first digits */
	const vaultName = (/** @type {string | null} */ id) => {
		const v = id ? world?.vaults.find((x) => x.id === id) : undefined;
		return v ? nameOf(v) : id ? `Vault ${short(id)}` : 'No vault';
	};

	/** the page's sections, in order, as its left side lists them: each its address after `#performance/`, name and icon */
	const SECTIONS = /** @type {const} */ ([
		['work', 'Work', 'jobs'],
		['storage', 'Storage', 'database'],
		['server', 'Server', 'sync']
	]);
	/** Scrolls the page to section `id`. @param {string} id */
	const scrollTo = (id) => document.getElementById(`performance-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
	$effect(() => {
		const id = section;
		if (id) tick().then(() => scrollTo(id));
	});
	const at = $derived(SECTIONS.some(([id]) => id === section) ? section : 'work');

	/** what each timer times, as a person reads it, by the engine's name for it (avendb's `Lab`) */
	const WORK = /** @type {Record<string, [string, string]>} */ ({
		replay: ['Replay', 'Every edit it holds run again, in order, into what it shows'],
		check: ['Signature checks', 'The edits a peer or its shelf offered, their signatures and rules checked'],
		keep: ['Keeping', 'Checked edits taken into its log'],
		refresh: ['Refresh', 'One round of bringing what it shows up to date, replay and all'],
		'open keys': ['Opening keys', 'The keys it holds unsealed, to open what they encrypt'],
		read: ['Reading', 'The bodies of entries opened with those keys'],
		'show items': ['Showing', 'Each entry made into what its views read'],
		'show: lanes': ['Showing: lanes', 'Each vault’s schemas and lenses read, to judge its entries’ writes'],
		'show: cap groups': ['Showing: cap groups', 'The cap groups’ writes judged one after the other'],
		'show: entries': ['Showing: entries', 'Every other entry, made anew only where it changed'],
		upkeep: ['Upkeep', 'The rest of a refresh: digests, indexes, what it follows']
	});
	/** what each count counts, as a person reads it */
	const COUNTS = /** @type {Record<string, string>} */ ({
		'edits offered': 'Edits offered to it',
		'edits checked': 'Edits whose signatures it checked',
		'refresh rounds': 'Refresh rounds',
		'replay: removals as chosen before': 'Replays that took the removals as chosen before',
		'keys opened': 'Keys opened from their boxes',
		'keys from the shelf': 'Keys taken from the device’s shelf, no box opened'
	});

	/** @typedef {{ count: number, total_ms: number, mean_ms: number, max_ms: number }} Timer */
	/**
	 * @typedef {{ timers: Record<string, Timer>, counts: Record<string, number>,
	 *   held: { edits: number, bodies: number, shown: number, blobs: number, blob_bytes: number },
	 *   checkpoints?: { standing: number, vouched: number, bare: number, uncovered?: number,
	 *     uncovered_by?: { vault: string | null, edits: number }[] } }} Perf
	 */

	/** the device's own, as its `perf` op answers, or null where it doesn't (an older device) */
	let perf = $state(/** @type {Perf | null} */ (null));
	/** what the browser keeps for this origin, and whether it keeps it for good */
	let storage = $state(/** @type {{ usage: number, quota: number, opfs: number | null, persisted: boolean | null } | null} */ (null));
	/** what avenDB takes on the Mac's disk, in theOS, or null elsewhere */
	let disk = $state(/** @type {{ device: { path: string, files: number, bytes: number }, agents: { path: string, files: number, bytes: number } } | null} */ (null));
	/** the page's JavaScript heap, where the browser says it (Chrome's `performance.memory`) */
	let heap = $state(/** @type {{ used: number, total: number, limit: number } | null} */ (null));
	/** the server's `/feed/health`, or why it couldn't be read */
	let health = $state(/** @type {any} */ (null));
	let healthFailed = $state('');
	/** when it was all last read, and whether it is being read now */
	let readAt = $state(0);
	let reading = $state(false);
	/** the timer the right side shows */
	let picked = $state('replay');
	/** the side slid in, where the sides slide in */
	let open = $state(/** @type {'' | 'nav' | 'aside'} */ (''));

	/** @param {unknown} e */
	const why = (e) => (e instanceof Error ? e.message : String(e));

	async function readStorage() {
		try {
			const s = navigator.storage;
			if (!s?.estimate) return null;
			const e = /** @type {StorageEstimate & { usageDetails?: Record<string, number> }} */ (await s.estimate());
			const persisted = s.persisted ? await s.persisted() : null;
			return { usage: e.usage ?? 0, quota: e.quota ?? 0, opfs: e.usageDetails?.fileSystem ?? null, persisted };
		} catch {
			return null;
		}
	}

	function readHeap() {
		const m = /** @type {any} */ (performance).memory;
		return m ? { used: m.usedJSHeapSize, total: m.totalJSHeapSize, limit: m.jsHeapSizeLimit } : null;
	}

	async function readHealth() {
		try {
			const r = await fetch(`${feed()}/health`, { cache: 'no-store' });
			if (!r.ok) throw new Error(`the server answered ${r.status}`);
			[health, healthFailed] = [await r.json(), ''];
		} catch (e) {
			healthFailed = why(e);
		}
	}

	/** Reads it all again: the device's, the browser's and the server's at once. */
	async function refresh() {
		if (reading) return;
		reading = true;
		const onMac = native() ? readDisk().catch(() => null) : Promise.resolve(null);
		const [p, s, d] = await Promise.all([read(api, { op: 'perf' }, null), readStorage(), onMac, readHealth()]);
		[perf, storage, disk, heap, readAt, reading] = [p, s, d, readHeap(), Math.floor(Date.now() / 1000), false];
	}
	onMount(() => void refresh());

	/** A time in milliseconds, as a person reads it. @param {number | undefined} ms */
	const time = (ms) =>
		ms == null ? '–' : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms < 10 ? ms.toFixed(2) : Math.round(ms)} ms`;
	/** A number of bytes, or a dash for none. @param {number | null | undefined} n */
	const bytes = (n) => (n == null ? '–' : size(n));
	/** A span of seconds, as a person reads it. @param {number} s */
	const span = (s) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : s < 172800 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 86400)} days`);

	/** the timers, the costliest first */
	const timers = $derived(Object.entries(perf?.timers ?? {}).sort(([, a], [, b]) => b.total_ms - a.total_ms));
	const longest = $derived(Math.max(1, ...timers.map(([, t]) => t.total_ms)));
	const all = $derived(timers.reduce((n, [, t]) => n + t.total_ms, 0));
	const timer = $derived(perf?.timers?.[picked] ?? null);
	const counts = $derived(Object.entries(perf?.counts ?? {}));
	const memory = $derived(health?.memory ?? null);
</script>

<!-- down the left, the page's sections, each scrolling to it, and Refresh -->
{#snippet menu()}
	<h3 class="nav-group">Performance</h3>
	{#each SECTIONS as [id, label, icon] (id)}
		<a class="nav-item" class:on={at === id} href="#performance/{id}" aria-current={at === id ? 'location' : undefined} onclick={() => scrollTo(id)}
			><Icon name={icon} size={16} /><span>{label}</span></a
		>
	{/each}
	<div class="again">
		<button class="btn" disabled={reading} data-pick onclick={refresh}>{reading ? 'Reading…' : 'Refresh'}</button>
		{#if readAt}<p class="soft">Read {ago(readAt)}</p>{/if}
	</div>
{/snippet}

<!-- on the right, the timer picked -->
{#snippet details()}
	<h3 class="nav-group">The timer picked</h3>
	{#if timer}
		{@const [name, what] = WORK[picked] ?? [picked, '']}
		<div class="card">
			<h3>{name}</h3>
			{#if what}<p class="soft">{what}.</p>{/if}
			<dl>
				<dt>Ran</dt>
				<dd>{count(timer.count, 'time')}</dd>
				<dt>In all</dt>
				<dd>{time(timer.total_ms)}</dd>
				<dt>On average</dt>
				<dd>{time(timer.mean_ms)}</dd>
				<dt>At most</dt>
				<dd>{time(timer.max_ms)}</dd>
				<dt>Of all timed</dt>
				<dd>{all ? Math.round((100 * timer.total_ms) / all) : 0}%</dd>
			</dl>
		</div>
	{:else}
		<p class="empty">Pick a timer to see how long its work took.</p>
	{/if}
	<p class="soft note">
		Measured on {thisName || 'this device'} since it started, kept in its memory alone: never written to a vault nor sent
		to a peer.
	</p>
{/snippet}

<!-- a section of the page: its heading, then its cards -->
{#snippet part(/** @type {string} */ id, /** @type {import('svelte').Snippet} */ body)}
	{@const [, label, icon] = SECTIONS.find(([x]) => x === id) ?? []}
	<section class="part" id="performance-{id}" aria-label={label}>
		<h2 class="part-head">{#if icon}<Icon name={icon} size={18} />{/if}<span>{label}</span></h2>
		<div class="cards">{@render body()}</div>
	</section>
{/snippet}

{#snippet work()}
	{#if !perf}
		<p class="empty">{reading ? 'Reading what this device’s work cost…' : 'This device doesn’t say what its work costs yet.'}</p>
	{:else}
		<article class="card">
			<h3>At a glance</h3>
			<div class="tiles">
				<div class="tile"><b>{time(perf.timers.replay?.total_ms)}</b><span>replay, {count(perf.timers.replay?.count ?? 0, 'time')}</span></div>
				<div class="tile"><b>{time(perf.timers.check?.total_ms)}</b><span>signature checks</span></div>
				<div class="tile"><b>{(perf.counts['edits checked'] ?? 0).toLocaleString()}</b><span>edits checked</span></div>
				<div class="tile"><b>{(perf.held.edits ?? 0).toLocaleString()}</b><span>edits held</span></div>
			</div>
		</article>
		<article class="card wide">
			<h3>Each step</h3>
			{#if !timers.length}
				<p class="empty">Nothing timed yet.</p>
			{:else}
				<table>
					<thead><tr><th>Work</th><th>Ran</th><th>In all</th><th>Average</th><th>Longest</th></tr></thead>
					<tbody>
						{#each timers as [key, t] (key)}
							<tr class:on={picked === key}>
								<td>
									<button class="name" aria-pressed={picked === key} onclick={() => ((picked = key), (open = 'aside'))}>{WORK[key]?.[0] ?? key}</button>
									<span class="bar" style:width="{(100 * t.total_ms) / longest}%"></span>
								</td>
								<td>{t.count.toLocaleString()}</td>
								<td>{time(t.total_ms)}</td>
								<td>{time(t.mean_ms)}</td>
								<td>{time(t.max_ms)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</article>
		{#if counts.length}
			<article class="card">
				<h3>Counts</h3>
				<dl>
					{#each counts as [key, n] (key)}
						<dt>{COUNTS[key] ?? key}</dt>
						<dd>{n.toLocaleString()}</dd>
					{/each}
				</dl>
			</article>
		{/if}
	{/if}
{/snippet}

{#snippet stored()}
	{#if perf}
		<article class="card">
			<h3>What this device holds</h3>
			<dl>
				<dt>Edits</dt>
				<dd>{perf.held.edits.toLocaleString()}</dd>
				<dt>Bodies opened</dt>
				<dd>{perf.held.bodies.toLocaleString()}</dd>
				<dt>Entries shown</dt>
				<dd>{perf.held.shown.toLocaleString()}</dd>
				<dt>Files kept</dt>
				<dd>{count(perf.held.blobs, 'file')}, {bytes(perf.held.blob_bytes)}</dd>
			</dl>
		</article>
		{#if perf.checkpoints}
			<article class="card">
				<h3>Checkpoints</h3>
				<dl>
					<dt>Standing</dt>
					<dd>{perf.checkpoints.standing.toLocaleString()}</dd>
					<dt>Edits they vouch for</dt>
					<dd>{perf.checkpoints.vouched.toLocaleString()}</dd>
					<dt>Held without signatures</dt>
					<dd>{perf.checkpoints.bare.toLocaleString()}</dd>
					{#if perf.checkpoints.uncovered !== undefined}
						<dt>Old SLH-DSA signatures still checked</dt>
						<dd>{perf.checkpoints.uncovered.toLocaleString()}</dd>
						{#each perf.checkpoints.uncovered_by ?? [] as u (u.vault)}
							<dt class="sub">{vaultName(u.vault)}</dt>
							<dd>{u.edits.toLocaleString()}</dd>
						{/each}
					{/if}
				</dl>
			</article>
		{/if}
	{/if}
	{#if disk}
		<article class="card">
			<h3>This Mac’s disk</h3>
			<dl>
				<dt>This device</dt>
				<dd>{bytes(disk.device.bytes)} in {count(disk.device.files, 'file')}, {disk.device.path}</dd>
				<dt>Its agents</dt>
				<dd>{bytes(disk.agents.bytes)} in {count(disk.agents.files, 'file')}, {disk.agents.path}</dd>
			</dl>
		</article>
	{/if}
	<article class="card">
		<h3>This browser</h3>
		{#if storage}
			<dl>
				<dt>Stored</dt>
				<dd>{bytes(storage.usage)} of {bytes(storage.quota)}</dd>
				{#if storage.opfs != null}
					<dt>Its OPFS store</dt>
					<dd>{bytes(storage.opfs)}</dd>
				{/if}
				<dt>Kept for good</dt>
				<dd>{storage.persisted == null ? '–' : storage.persisted ? 'Yes' : 'No, the browser may clear it'}</dd>
			</dl>
		{:else}
			<p class="empty">This browser doesn’t say what it stores.</p>
		{/if}
		{#if heap}
			<dl>
				<dt>Page memory</dt>
				<dd>{bytes(heap.used)} of {bytes(heap.total)}, at most {bytes(heap.limit)}</dd>
			</dl>
		{/if}
	</article>
{/snippet}

{#snippet server()}
	{#if healthFailed && !health}
		<p class="error">Couldn’t read the server’s health: {healthFailed}</p>
	{:else if !health}
		<p class="empty">Reading the server’s health…</p>
	{:else}
		<article class="card">
			<h3>This run</h3>
			<dl>
				<dt>Started</dt>
				<dd>{ago(health.started)}</dd>
				<dt>Up for</dt>
				<dd>{span(health.up ?? 0)}</dd>
				<dt>Starts this hour</dt>
				<dd>{health.starts?.hour ?? '–'}</dd>
				<dt>Last panic</dt>
				<dd>{health.panic ? `${ago(health.panic.at)}: ${health.panic.message}` : 'None'}</dd>
				{#if health.before}
					<dt>The run before</dt>
					<dd>{health.before.ended?.how ?? '–'}{health.before.ended?.why ? `: ${health.before.ended.why}` : ''}</dd>
				{/if}
			</dl>
			{#if healthFailed}<p class="error">Read again, it failed: {healthFailed}</p>{/if}
		</article>
		<article class="card">
			<h3>Its storage</h3>
			{#if health.shelf}
				<dl>
					{#if health.shelf.bucket}
						<dt>Object storage</dt>
						<dd>
							{health.shelf.bucket.error
								? `Couldn’t list it: ${health.shelf.bucket.error}`
								: `${bytes(health.shelf.bucket.bytes)} in ${count(health.shelf.bucket.objects, 'object')}`}
						</dd>
					{/if}
					{#if health.shelf.folder}
						<dt>{health.shelf.bucket ? 'Its disk cache' : 'Its disk'}</dt>
						<dd>{bytes(health.shelf.folder.bytes)} in {count(health.shelf.folder.files, 'file')}</dd>
					{/if}
					<dt>Measured</dt>
					<dd>{ago(health.shelf.at)}</dd>
				</dl>
			{:else}
				<p class="empty">The server hasn’t measured its storage yet; it does every 10 minutes.</p>
			{/if}
		</article>
		{#if memory}
			<article class="card">
				<h3>Its memory</h3>
				<dl>
					<dt>Held</dt>
					<dd>{bytes(memory.rss)}, at most {bytes(memory.rss_peak)}</dd>
					{#if memory.heap}
						<dt>Heap</dt>
						<dd>{bytes(memory.heap.in_use)} in use, {bytes(memory.heap.free)} kept free</dd>
					{/if}
					<dt>Container</dt>
					<dd>{bytes(memory.container)} of {bytes(memory.limit)}, at most {bytes(memory.container_peak)}</dd>
					<dt>Killed for memory</dt>
					<dd>{memory.oom_kills ?? '–'}</dd>
					<dt>Machine</dt>
					<dd>{bytes(memory.machine_free)} free of {bytes(memory.machine)}</dd>
				</dl>
			</article>
		{/if}
	{/if}
{/snippet}

<Frame nav={menu} aside={details} navLabel="Performance" navIcon="gauge" asideLabel="The timer picked" asideIcon="info" bind:open>
	<div class="page">
		{@render part('work', work)}
		{@render part('storage', stored)}
		{@render part('server', server)}
	</div>
</Frame>

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.part {
		scroll-margin-top: 0.5rem;
	}

	.part-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.8rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.card.wide {
		grid-column: 1 / -1;
	}

	.again {
		margin-top: 1rem;
	}

	.again p,
	.note {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.35rem 0.8rem;
		margin: 0 0 0.4rem;
		font-size: 0.84rem;
		line-height: 1.45;
	}

	dt {
		color: var(--soft);
	}

	dt.sub {
		padding-left: 0.8rem;
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.tile b {
		font-size: 1.3rem;
		font-variant-numeric: tabular-nums;
	}

	.tile span {
		color: var(--soft);
		font-size: 0.78rem;
	}

	/* each step: the costliest first, a bar under its name as long as its time beside the costliest's */
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
		font-variant-numeric: tabular-nums;
	}

	th {
		padding: 0.3rem 0.5rem;
		color: var(--soft);
		font-weight: 500;
		text-align: right;
	}

	td {
		padding: 0.35rem 0.5rem;
		border-top: 1px solid var(--edge);
		text-align: right;
		white-space: nowrap;
	}

	th:first-child,
	td:first-child {
		position: relative;
		width: 40%;
		text-align: left;
	}

	tr.on td {
		background: rgb(0 0 0 / 0.04);
	}

	.name {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.bar {
		display: block;
		height: 3px;
		margin-top: 0.2rem;
		border-radius: 2px;
		background: var(--terracotta, #c8744f);
	}

	@media (max-width: 40rem) {
		th:nth-child(4),
		td:nth-child(4) {
			display: none;
		}
	}
</style>
