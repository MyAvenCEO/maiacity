<!--
	What this device does in the background for the vault the page shows, live: what it works on now, each job with its kind, what it works on, how far it is and how
	long it has left; and what it did, each with where what it worked on is synced to now, or why it failed. Its jobs
	(the device's `jobs` op): files brought into its store, sealed as their bytes come; files kept whole, their pieces
	fetched from the peers that hold them; and the edits a peer holds for it, asked for page by page and taken. Each
	job tells the vaults and entries it is about, and the page shows only those of its vault, a pull with only that
	vault's edits. Beside them, what still syncs, by entry and by file, from where each is synced to: each device that
	holds only some of what this one holds of the vault, with how much of it.
	On the Mac app, under them, the studio's jobs (Samuel 2026-10-18: the studio has no Jobs tab of its own any more):
	the rules of each vault this Mac works for and the tasks they want, each where it stands
	($lib/studio/jobs/Tasks.svelte).
-->
<script>
	import { onMount } from 'svelte';
	import { native } from '$lib/native';
	import Tasks from '$lib/studio/jobs/Tasks.svelte';
	import { studio } from './db.js';
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
	let filter = $state(/** @type {'all' | 'failed' | 'done'} */ ('all'));

	const s = $derived(studio(world, null, vault, actor));

	/** Each kind, as its chip names it. */
	const KIND = /** @type {Record<string, string>} */ ({ bring: 'Bringing in', keep: 'Keeping', pull: 'Taking' });

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

	/** When job `j` ended, as a person reads it. @param {Job} j */
	const when = (j) =>
		j.ended
			? new Date(j.ended).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
			: '';

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
	const shown = $derived(ends.filter((j) => filter === 'all' || j.state === filter));
	const failures = $derived(ends.filter((j) => j.state === 'failed').length);
</script>

<div class="jobs">
	<p class="soft lead">
		What this device does in the background for this vault: files it brings in and keeps whole, edits it takes from
		your other devices and avenDB’s server, where each is synced to now, and what still syncs, by entry and by file.
	</p>
	{#if failed}<p class="error">Reading the jobs failed: {failed}</p>{/if}

	<section>
		<h3>Now</h3>
		{#if busy.length}
			<table>
				<tbody>
					{#each busy as j (j.id)}
						{@const p = part(j)}
						{@const eta = left(j)}
						<tr>
							<td><span class="chip accent">{KIND[j.kind] ?? j.kind}</span></td>
							<td class="name" title={j.subject}>{what(j)}</td>
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

	<section>
		<div class="head">
			<h3>Done and failed</h3>
			<div class="seg">
				<button class:on={filter === 'all'} onclick={() => (filter = 'all')}>All</button>
				<button class:on={filter === 'failed'} onclick={() => (filter = 'failed')}>
					Failed{failures ? ` (${failures})` : ''}
				</button>
				<button class:on={filter === 'done'} onclick={() => (filter = 'done')}>Done</button>
			</div>
		</div>
		{#if shown.length}
			<table>
				<tbody>
					{#each shown as j (j.id)}
						<tr class={j.state}>
							<td class="soft when">{when(j)}</td>
							<td><span class="chip">{KIND[j.kind] ?? j.kind}</span></td>
							<td class="name" title={j.subject}>{what(j)}</td>
							<td>
								<div class="where">
									{#if j.state === 'failed'}
										<span class="chip bad">Failed</span>
									{:else}
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
									{/if}
								</div>
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

	{#if native()}
		<section class="studio">
			<h3>Studio</h3>
			<p class="soft">What the studio’s rules want made of each vault’s footage and cuts (proxies, stills, transcripts, renders), and this Mac doing it.</p>
			<Tasks />
		</section>
	{/if}
</div>

<style>
	/* the studio's tasks list, in this page's colours */
	.studio {
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

	h3 {
		margin: 0 0 0.5rem;
		font-size: 0.72rem !important;
		letter-spacing: 0.06em !important;
		text-transform: uppercase;
		color: var(--soft);
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.4rem;
	}

	.head h3 {
		margin: 0;
	}

	.seg {
		display: inline-flex;
		padding: 0.15rem;
		border-radius: 9px;
		background: rgb(0 0 0 / 0.06);
	}

	.seg button {
		padding: 0.25rem 0.7rem;
		border: 0;
		border-radius: 7px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		color: inherit;
		cursor: pointer;
	}

	.seg button.on {
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
		font-weight: 600;
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

	@media (max-width: 640px) {
		.bar,
		.when {
			display: none;
		}
	}
</style>
