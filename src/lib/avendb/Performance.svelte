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
	its last panic and its starts, and what its shelf takes in its bucket and its folder, as it last measured. Network
	(Samuel 2026-10-22: "how long and where it is being synced from", "the whole sync topology … what comes directly p2p
	and what via relay"): the device's own endpoint, relay and direct addresses, each peer it is connected to with each
	path of the connection (direct or relayed, the one it sends on, its round trip, the bytes it carried), what it took
	from each peer page by page and how fast, and its newest pages, as the device's `network` op answers (avendb-net's
	`Node::network`), read again every few seconds while the page is open.

	All of it is read on the device, or from the server's public feed, and kept in this page alone: nothing here is
	written to a vault or sent to a peer. It is read when the page opens and again on Refresh.
-->
<script>
	import { onMount, tick } from 'svelte';
	import { onStir } from './stirs.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { read } from './ops.js';
	import { native } from '$lib/native';
	import { disk as readDisk } from './native.js';
	import { feed } from './server.js';
	import { ago, count, nameOf, short, signerName, size } from './vaults.js';
	import { session } from './session.svelte.js';

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
		['network', 'Network', 'link'],
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
		'open view': ['Opening its view', 'The stored view taken from the device’s shelf, unsealed and read'],
		read: ['Reading', 'The bodies of entries opened with those keys'],
		'show items': ['Showing', 'Each entry made into what its views read'],
		'show: lanes': ['Showing: lanes', 'Each vault’s schemas and lenses read, to judge its entries’ writes'],
		'show: cap groups': ['Showing: cap groups', 'The cap groups’ writes judged one after the other'],
		'show: entries': ['Showing: entries', 'Every other entry, made anew only where it changed'],
		upkeep: ['Upkeep', 'The rest of a refresh: digests, indexes, what it follows'],
		'sync: reply': ['Answering a page', 'A page of edits worked out for a peer that asked, from its lab']
	});
	/** what each count counts, as a person reads it */
	const COUNTS = /** @type {Record<string, string>} */ ({
		'edits offered': 'Edits offered to it',
		'edits checked': 'Edits whose signatures it checked',
		'refresh rounds': 'Refresh rounds',
		'replay: from its stored view': 'Unlocks that stepped on the device’s stored view',
		'stored view: none that opens': 'Unlocks with no stored view that opens, so every edit replayed',
		'keys opened': 'Keys opened from their boxes',
		'keys from the shelf': 'Keys taken from the device’s shelf, no box opened',
		'sync: edits sent': 'Edits sent to peers in pages'
	});

	/** @typedef {{ count: number, total_ms: number, mean_ms: number, max_ms: number }} Timer */
	/**
	 * @typedef {{ timers: Record<string, Timer>, counts: Record<string, number>,
	 *   held: { edits: number, bodies: number, shown: number, blobs: number, blob_bytes: number,
	 *     logs?: Record<string, number>, actions?: Record<string, number> },
	 *   checkpoints?: { standing: number, vouched: number, bare: number, uncovered?: number,
	 *     uncovered_by?: { vault: string | null, edits: number }[], vouching?: Vouching | null } }} Perf
	 */
	/**
	 * What a checkpoint by the person's key would cover now (avendb's `Lab::vouching`): `ready` as each unlock offers
	 * it, `waiting` on keys that still sign the old way, by vault, those keys, and `others`, which only other vaults'
	 * owners can vouch for.
	 * @typedef {{ by: string, ready: number, waiting: number, others: number,
	 *   vaults: { vault: string, ready: number, waiting: number }[],
	 *   keys: { signer: string, role: string, of: string | null, edits: number }[] }} Vouching
	 */

	/**
	 * Where the device syncs from and how, as its `network` op answers (avendb-net's `Node::network`).
	 * @typedef {{ pages: number, edits: number, new: number, bytes: number, wait_ms: number, take_ms: number,
	 *   ms: number, askings: number, ask_ms: number, keys?: { asked: number, got: number, bytes: number, ms: number },
	 *   bytes_per_s: number, edits_per_s: number, direct: { pages: number, bytes: number },
	 *   relay: { pages: number, bytes: number }, failed: number, first: number, last: number }} Pulled
	 * @typedef {{ way: string, addr: string, selected: boolean, rtt_ms: number, rx: number, tx: number, lost: number }} Path
	 * @typedef {{ me: { endpoint: string, relays: string[], direct: string[] },
	 *   peers: { device: string, endpoint: string, since: number, dialed: boolean, way: string, paths: Path[],
	 *     rx: number, tx: number, logs: number | null, lacks: number | null, pulled: Pulled | null }[],
	 *   gone: { device: string, pulled: Pulled }[],
	 *   recent: { device: string, at: number, bytes: number, edits: number, new: number, wait_ms: number, take_ms: number, way: string }[] }} Network
	 */
	/** where the device syncs from, or null where it doesn't say (an older device) */
	let network = $state(/** @type {Network | null} */ (null));
	/** Reads the network alone again: what changes from second to second. */
	async function readNetwork() {
		network = await read(api, { op: 'network' }, null);
	}
	// read again as the device says it changed: a page taken, a peer come or gone (./stirs.js), never on a timer
	onMount(() => onStir(readNetwork));

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

	/** what a key still signing the old way is, as a person reads it */
	const ROLES = /** @type {Record<string, string>} */ ({
		device: 'Device of',
		owner: 'Owner key of',
		recovery: 'Recovery key of',
		signer: 'Key'
	});
	/** the log an edit is of (avendb's `sync::LogId`), as a person reads it: an entry's own log is what a snapshot spares */
	const LOGS = /** @type {Record<string, string>} */ ({
		entry: 'entries’ own',
		audience: 'audiences’ keys',
		vault: 'vaults',
		share: 'shares',
		signer: 'signers’ keys'
	});
	/** what an edit does, as a person reads it */
	const ACTIONS = /** @type {Record<string, string>} */ ({
		write: 'writes',
		keys: 'key boxes',
		mark: 'moves',
		wraps: 'key links',
		checkpoint: 'checkpoints',
		snapshot: 'snapshots',
		share: 'shares',
		revoke: 'revocations',
		claim: 'claims',
		settings: 'settings',
		genesis: 'new vaults'
	});
	/** counts by name, the most first, each with its label from `labels` @param {Record<string, number>} by
	 *  @param {Record<string, string>} labels */
	const split = (by, labels) =>
		Object.entries(by)
			.sort((a, b) => b[1] - a[1])
			.map(([k, n]) => `${n.toLocaleString()} ${labels[k] ?? k}`)
			.join(', ');
	/** the checkpoint being signed, and how it went */
	let signing = $state(false);
	let signed = $state('');
	/** Signs a checkpoint over everything the person may vouch for now (the session's `signCheckpoint`), then reads
	 *  the page again. */
	async function vouch() {
		[signing, signed] = [true, ''];
		const covered = await session.signCheckpoint();
		signing = false;
		if (covered === null) return void (signed = session.error || 'Your checkpoint didn’t go through.');
		signed = covered ? `Your checkpoint covers ${covered.toLocaleString()} edits.` : 'There was nothing left to cover.';
		await refresh();
	}

	/** Reads it all again: the device's, the browser's and the server's at once. */
	async function refresh() {
		if (reading) return;
		reading = true;
		const onMac = native() ? readDisk().catch(() => null) : Promise.resolve(null);
		const [p, s, d] = await Promise.all([read(api, { op: 'perf' }, null), readStorage(), onMac, readHealth(), readNetwork()]);
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

	/** A device, as this device knows it: its name, else its id's start. @param {string} id */
	const deviceName = (id) => (world ? signerName(world, id, true) : `Device ${short(id)}`);
	/** How a way of sending reads. @param {string} way */
	const WAYS = /** @type {Record<string, string>} */ ({ direct: 'Direct', relay: 'Relay', other: 'Other', '': 'Not chosen yet' });
	/** Bytes a second, as a person reads it. @param {number} n */
	const rate = (n) => `${size(Math.max(0, Math.round(n)))}/s`;
	/** A time of day, from milliseconds since 1970. @param {number} ms */
	const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	/** what came in all from the peers it took from, live or gone */
	const pulledAll = $derived([...(network?.peers ?? []).map((p) => p.pulled), ...(network?.gone ?? []).map((g) => g.pulled)].filter((x) => !!x));
	const total = $derived(
		pulledAll.reduce(
			(a, p) => ({
				bytes: a.bytes + p.bytes,
				ms: a.ms + (p.ms ?? p.wait_ms + p.take_ms),
				wait: a.wait + p.wait_ms,
				direct: a.direct + p.direct.bytes,
				relay: a.relay + p.relay.bytes,
				pages: a.pages + p.pages
			}),
			{ bytes: 0, ms: 0, wait: 0, direct: 0, relay: 0, pages: 0 }
		)
	);
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

{#snippet net()}
	{#if !network}
		<p class="empty">{reading ? 'Reading where this device syncs from…' : 'This device doesn’t say where it syncs from yet.'}</p>
	{:else}
		{@const direct = network.peers.filter((p) => p.way === 'direct').length}
		{@const relayed = network.peers.filter((p) => p.way === 'relay').length}
		<article class="card">
			<h3>At a glance</h3>
			<div class="tiles">
				<div class="tile"><b>{network.peers.length}</b><span>{network.peers.length === 1 ? 'peer' : 'peers'} connected: {direct} direct, {relayed} through a relay</span></div>
				<div class="tile"><b>{bytes(total.bytes)}</b><span>synced in {count(total.pages, 'page')}</span></div>
				<div class="tile"><b>{total.ms ? rate((total.bytes * 1000) / total.ms) : '–'}</b><span>while pulling ({time(total.wait)} of it waiting for pages)</span></div>
				<div class="tile"
					><b>{total.bytes ? `${Math.round((100 * total.direct) / total.bytes)}% · ${Math.round((100 * total.relay) / total.bytes)}%` : '–'}</b><span
						>direct · through a relay</span
					></div
				>
			</div>
		</article>
		<article class="card">
			<h3>This device</h3>
			<dl>
				<dt>Endpoint</dt>
				<dd>{short(network.me.endpoint)}</dd>
				<dt>Relay</dt>
				<dd>{network.me.relays.length ? network.me.relays.join(', ') : 'None'}</dd>
				<dt>Reached directly at</dt>
				<dd>{network.me.direct.length ? network.me.direct.join(', ') : 'No direct address (a browser syncs through a relay)'}</dd>
			</dl>
		</article>
		<article class="card wide">
			<h3>Its peers</h3>
			{#if !network.peers.length}
				<p class="empty">No peer is connected now.</p>
			{:else}
				<div class="table-wrap"><table>
					<thead><tr><th>Peer</th><th>Way</th><th>Round trip</th><th>Received</th><th>Pages</th><th>Speed</th><th>Lacks</th></tr></thead>
					<tbody>
						{#each network.peers as p (p.endpoint)}
							{@const on = p.paths.find((x) => x.selected)}
							<tr>
								<td>
									<b>{deviceName(p.device)}</b>
									<span class="soft small">{p.dialed ? 'dialed' : 'dialed us'} {ago(Math.floor(p.since / 1000))}</span>
								</td>
								<td><span class="way {p.way || 'none'}">{WAYS[p.way] ?? p.way}</span></td>
								<td>{on ? time(on.rtt_ms) : '–'}</td>
								<td>{bytes(p.rx)}</td>
								<td>{p.pulled ? p.pulled.pages.toLocaleString() : '0'}</td>
								<td>{p.pulled ? rate(p.pulled.bytes_per_s) : '–'}</td>
								<td>{p.lacks == null ? '–' : count(p.lacks, 'log')}</td>
							</tr>
							{#each p.paths as x (x.addr)}
								<tr class="path">
									<td>{x.selected ? '▸ ' : ''}{x.way === 'relay' ? 'Relay' : x.way === 'direct' ? 'Direct' : 'Path'} {x.addr}</td>
									<td>{x.selected ? 'in use' : 'standby'}</td>
									<td>{time(x.rtt_ms)}</td>
									<td>{bytes(x.rx)}</td>
									<td colspan="3">sent {bytes(x.tx)}{x.lost ? `, lost ${bytes(x.lost)}` : ''}</td>
								</tr>
							{/each}
						{/each}
					</tbody>
				</table></div>
			{/if}
		</article>
		{#each [...network.peers.filter((p) => p.pulled).map((p) => ({ device: p.device, pulled: /** @type {Pulled} */ (p.pulled), live: true })), ...network.gone.map((g) => ({ ...g, live: false }))] as x (x.device)}
			{@const t = x.pulled}
			<article class="card">
				<h3>Synced from {deviceName(x.device)}{x.live ? '' : ' (not connected now)'}</h3>
				<dl>
					<dt>Pages</dt>
					<dd>{t.pages.toLocaleString()}{t.failed ? `, ${t.failed} that never came` : ''}</dd>
					<dt>Edits</dt>
					<dd>{t.edits.toLocaleString()}, {t.new.toLocaleString()} new</dd>
					<dt>Bytes</dt>
					<dd>{bytes(t.bytes)}: {bytes(t.direct.bytes)} direct, {bytes(t.relay.bytes)} through a relay</dd>
					<dt>Waited for pages</dt>
					<dd>{time(t.wait_ms)}{t.pages ? `, ${time(t.wait_ms / t.pages)} each` : ''}</dd>
					<dt>Took them in</dt>
					<dd>{time(t.take_ms)}{t.pages ? `, ${time(t.take_ms / t.pages)} each` : ''}</dd>
					{#if t.ms != null}
						<dt>In all</dt>
						<dd>{time(t.ms)}, the next page asked for while one is taken in</dd>
					{/if}
					{#if t.askings}
						<dt>Askings</dt>
						<dd>{t.askings.toLocaleString()}, {time(t.ask_ms)} working out what to ask</dd>
					{/if}
					{#if t.keys?.asked}
						<dt>Sealing keys after</dt>
						<dd>{t.keys.got} of {t.keys.asked}, {bytes(t.keys.bytes)} in {time(t.keys.ms)}</dd>
					{/if}
					<dt>Speed</dt>
					<dd>{rate(t.bytes_per_s)}, {t.edits_per_s.toLocaleString()} edits/s</dd>
					<dt>From – to</dt>
					<dd>{t.first ? `${clock(t.first)} – ${clock(t.last)}` : '–'}</dd>
				</dl>
			</article>
		{/each}
		<article class="card wide">
			<h3>The newest pages</h3>
			{#if !network.recent.length}
				<p class="empty">No page of edits has come since this device started.</p>
			{:else}
				<div class="table-wrap"><table>
					<thead><tr><th>When</th><th>From</th><th>Way</th><th>Size</th><th>Edits</th><th>Waited</th><th>Took in</th></tr></thead>
					<tbody>
						{#each network.recent as r, i (i)}
							<tr>
								<td>{clock(r.at)}</td>
								<td>{deviceName(r.device)}</td>
								<td><span class="way {r.way || 'none'}">{WAYS[r.way] ?? r.way}</span></td>
								<td>{bytes(r.bytes)}</td>
								<td>{r.edits.toLocaleString()}{r.new !== r.edits ? ` (${r.new.toLocaleString()} new)` : ''}</td>
								<td>{time(r.wait_ms)}</td>
								<td>{time(r.take_ms)}</td>
							</tr>
						{/each}
					</tbody>
				</table></div>
			{/if}
		</article>
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
				{#if perf.held.logs}
					<dt>Its edits, by log</dt>
					<dd>{split(perf.held.logs, LOGS)}</dd>
				{/if}
				{#if perf.held.actions}
					<dt>Its edits, by kind</dt>
					<dd>{split(perf.held.actions, ACTIONS)}</dd>
				{/if}
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
					{#if perf.checkpoints.vouching}
						{@const v = perf.checkpoints.vouching}
						<dt>You can vouch for now</dt>
						<dd>{(v.ready + v.waiting).toLocaleString()}</dd>
						{#each v.vaults as u (u.vault)}
							<dt class="sub">{vaultName(u.vault)}</dt>
							<dd>{(u.ready + u.waiting).toLocaleString()}</dd>
						{/each}
						{#if v.others}
							<dt>Only other vaults’ owners can vouch for</dt>
							<dd>{v.others.toLocaleString()}</dd>
						{/if}
					{/if}
				</dl>
				{#if perf.checkpoints.vouching}
					{@const v = perf.checkpoints.vouching}
					{#if v.keys.length}
						<p class="soft">
							{v.waiting.toLocaleString()} of them were signed by keys that still sign the old way, so the checkpoint your unlock offers leaves them
							out. Signing here covers them too.
						</p>
						<dl>
							{#each v.keys.slice(0, 12) as k (k.signer)}
								<dt class="sub">{ROLES[k.role] ?? 'Key'} {k.of ? vaultName(k.of) : ''} · {short(k.signer)}</dt>
								<dd>{k.edits.toLocaleString()}</dd>
							{/each}
						</dl>
					{/if}
					{#if v.ready + v.waiting}
						<button class="btn" disabled={signing} onclick={vouch}>{signing ? 'Signing…' : 'Sign checkpoint'}</button>
					{/if}
				{/if}
				{#if signed}<p class="soft">{signed}</p>{/if}
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
		{#if health.sync}
			<article class="card">
				<h3>Its answers to peers</h3>
				<dl>
					<dt>Pages sent</dt>
					<dd>{health.sync.pages.toLocaleString()}, {health.sync.edits.toLocaleString()} edits, {bytes(health.sync.bytes)}</dd>
					<dt>Each page took it</dt>
					<dd>{time(health.sync.mean_ms)} on average, {time(health.sync.max_ms)} at most</dd>
					{#if health.sync.recent?.length}
						<dt>The newest</dt>
						<dd>{health.sync.recent.slice(0, 8).map((/** @type {{ ms: number }} */ r) => time(r.ms)).join(', ')}</dd>
					{/if}
				</dl>
			</article>
		{/if}
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
		{@render part('network', net)}
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

	tr.path td {
		border-top: 0;
		padding-top: 0;
		color: var(--soft);
		font-size: 0.78rem;
	}

	.small {
		display: block;
		font-size: 0.74rem;
	}

	/* the way a page or a peer came: direct green, through a relay amber */
	.way {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.06);
		font-size: 0.76rem;
	}

	.way.direct {
		background: rgb(46 160 67 / 0.16);
	}

	.way.relay {
		background: rgb(210 153 34 / 0.2);
	}

	.table-wrap {
		overflow-x: auto;
	}

	@media (max-width: 40rem) {
		th:nth-child(4),
		td:nth-child(4) {
			display: none;
		}
	}
</style>
