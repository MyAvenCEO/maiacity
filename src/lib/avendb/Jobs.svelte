<!--
	Every job for the vault the page shows, in one list, live (Samuel 2026-10-19: one jobs interface, under the hood and
	on the page), in the layout every avenDB view has (./Frame.svelte). Each is a `Job` (./jobs.js), whatever does it:
	this device syncing (files brought in and kept whole, edits taken from a peer: the device's `jobs` op), a task of a
	studio rule as the vault holds it (proxies, stills, transcripts, renders: $lib/studio/jobs, run straight in the
	vault by the Mac's runner, ./runner.js there), and on the Mac app, its own jobs no rule starts (imports, files
	kept), from its lanes (vault/app/src/jobs.rs `jobs_list` and its `jobs` and `jobs-gone` events).
	On the left what to show (everything, now, failed, done, still syncing) and each kind of job, with how its jobs
	stand: a studio rule picked shows what it makes and one switch that turns it off or on in this vault. In the middle
	how it all stands, the Mac's lanes, what runs and waits, what ended, and what still syncs, by entry and by file; on
	the right the job picked, how far it is and what it is about.
-->
<script>
	import { onMount } from 'svelte';
	import { onStir } from './stirs.svelte.js';
	import { native } from '$lib/native';
	import { BUILT_IN, held, toRecord } from '$lib/studio/jobs/rules.js';
	import { RULE } from '$lib/studio/jobs/schemas.js';
	import { retrying, tasksOf, TRIES } from '$lib/studio/jobs/tasks.js';
	import { studio } from './db.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { KINDS, LANES, kindName, live, ordered, studioJobs, stuck, syncJob } from './jobs.js';
	import { ago, count, list, short, size } from './vaults.js';

	/** @typedef {import('./jobs.js').Job} Job */
	/** @typedef {import('./jobs.js').SyncJob} SyncJob */
	/** @typedef {import('./jobs.js').MacJob} MacJob */

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any }} */
	let { world, vault, actor, api } = $props();

	const mac = native();

	/** @type {SyncJob[]} */
	let syncs = $state([]);
	/** @type {MacJob[]} */
	let active = $state([]);
	/** @type {MacJob[]} */
	let history = $state([]);
	/** @type {string[]} what holds the Mac's lanes now: an import, memory */
	let holds = $state([]);
	/** the runner's newest line */
	let said = $state('');
	let failed = $state('');
	let now = $state(Date.now());
	/** what the page shows: everything, or one part */
	let show = $state(/** @type {(typeof SHOWS)[number][0]} */ (''));
	/** the kind of job picked on the left, whose jobs alone show */
	let kind = $state('');
	/** the job picked, by its id, whose progress the right side shows */
	let picked = $state('');
	/** the rule being turned on or off */
	let switching = $state('');
	/** the side slid in, where the sides slide in */
	let open = $state(/** @type {'' | 'nav' | 'aside'} */ (''));

	const s = $derived(studio(world, null, vault, actor));

	const SHOWS = /** @type {const} */ ([
		['', 'Everything', 'jobs'],
		['now', 'Now', 'play'],
		['failed', 'Failed', 'close'],
		['done', 'Done', 'check'],
		['syncing', 'Still syncing', 'sync']
	]);
	const FINISHED = ['done', 'failed', 'cancelled'];

	/** @param {unknown} e */
	const why = (e) => (e instanceof Error ? e.message : String(e));
	/** A command of the Mac app's. @param {string} name @param {Record<string, unknown>} [args] */
	const command = async (name, args = {}) => (await import('$lib/native')).command(name, args);
	/** A round of the Mac's runner now, as after a task is asked again or a rule turned on. */
	const nudge = () => void import('$lib/studio/jobs/mac.js').then((m) => m.nudge());

	/** The Mac's jobs, read whole; between reads its events tell each change. */
	async function loadMac() {
		try {
			const j = /** @type {{ active: MacJob[], history: MacJob[], holds?: string[] }} */ (await command('jobs_list', { limit: 300 }));
			[active, history, holds] = [j.active, j.history, j.holds ?? []];
		} catch (e) {
			failed = why(e);
		}
	}

	/** A job of the Mac's changed, as its event tells it. @param {MacJob} j */
	function changed(j) {
		if (FINISHED.includes(j.state)) {
			active = active.filter((x) => x.id !== j.id);
			history = [j, ...history.filter((x) => !(x.id === j.id && x.ended === j.ended))].slice(0, 300);
		} else {
			const i = active.findIndex((x) => x.id === j.id);
			active = i < 0 ? [...active, j] : active.map((x) => (x.id === j.id ? j : x));
		}
	}

	onMount(() => {
		let gone = false;
		/** @type {(() => void)[]} */
		const unlisten = [];
		// this device's syncs, read again as the device says they changed (./stirs.js), never on a timer
		const read = async (/** @type {AbortSignal} */ signal) => {
			try {
				const j = await api.jobs();
				if (!gone && !signal.aborted) [syncs, failed] = [[...j.running, ...j.ended], ''];
			} catch (e) {
				if (!gone && !signal.aborted) failed = why(e);
			}
		};
		const unstir = onStir(read);
		// the Mac's own jobs: read once, then as its events tell, read whole again now and then (what holds its lanes)
		if (mac) {
			void loadMac();
			void import('@tauri-apps/api/event')
				.then(async ({ listen }) => {
					const on = [
						await listen('jobs', (e) => changed(/** @type {MacJob} */ (e.payload))),
						await listen('jobs-gone', (e) => (active = active.filter((x) => x.id !== e.payload)))
					];
					if (gone) on.forEach((u) => u());
					else unlisten.push(...on);
				})
				.catch(() => {});
		}
		let ticks = 0;
		// the clock their times count from, each second
		const tick = setInterval(async () => {
			now = Date.now();
			if (mac && ++ticks % 15 === 0) void loadMac();
			if (mac) said = (await import('$lib/studio/jobs/mac.js')).lines[0] ?? '';
		}, 1000);
		return () => {
			gone = true;
			unstir();
			clearInterval(tick);
			unlisten.forEach((u) => u());
		};
	});

	/** An amount of sync `j`'s units, as a person reads it. @param {SyncJob} j @param {number} n */
	const amount = (j, n) => (j.unit === 'bytes' ? size(n) : count(n, j.unit.replace(/s$/, ''), j.unit));

	/** the vault's entries, by id */
	const entries = $derived(new Map(world.entries.filter((e) => e.vault === vault).map((e) => [e.entry, e])));
	/** each file of the vault with the entry that brings it, by the file's root */
	const files = $derived(
		new Map([...entries.values()].flatMap((e) => (e.files ?? []).map((f) => [f.root, { file: f, entry: e.entry }])))
	);

	/** The vault's entries sync `j` is about, by id. @param {SyncJob} j */
	const itsEntries = (j) => Object.keys(j.entries ?? {}).filter((e) => entries.has(e));

	/**
	 * What sync `j` works on, in words: a file by its name or its entry; a pull by the device it took from and the
	 * entries whose edits it took.
	 * @param {SyncJob} j
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
	 * Where what sync `j` worked on is synced to now: a file's devices; a pull's, each device with how many it holds
	 * of the edits this one holds of the entries whose edits it took, all of them together.
	 * @param {SyncJob} j @returns {import('./vaults.js').Holder[]}
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

	/** Where device `d` runs a task, as a person reads it. @param {string} d */
	const on = (d) => (d === world.me ? (mac ? 'on this Mac' : 'on this device') : `on ${s.signer(d)}`);

	/** every job for the vault: its syncs, its studio tasks, and the Mac's own jobs */
	const jobs = $derived.by(() => {
		const synced = syncs.filter((j) => (j.vaults?.[vault] ?? 0) > 0).map((j) => ({ ...syncJob(j, vault, amount), name: what(j) }));
		const tasks = tasksOf(world).filter((t) => t.vault === vault);
		const named = (/** @type {string} */ e) => (e && entries.has(e) ? s.entry(e) : '');
		return [...synced, ...studioJobs(tasks, active, history, now, named, on)];
	});

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
			for (const h of e.syncedTo ?? []) if (h.has < h.of) rows.push({ id: `${e.entry}:${h.device}`, what: title, kind: 'entry', ...h });
			for (const f of e.files ?? []) {
				for (const h of f.syncedTo ?? []) if (h.has < h.of) rows.push({ id: `${f.root}:${h.device}`, what: title, kind: 'file', ...h });
			}
		}
		return rows;
	});

	/**
	 * Each studio rule as this vault holds it: its own newest record (`own` its entry), or the app's.
	 * @type {Map<string, { rule: import('$lib/studio/jobs/rules.js').Rule, own: string | null }>}
	 */
	const rules = $derived.by(() => {
		const mine = held(world, vault);
		return new Map(
			BUILT_IN.map((b) => {
				const newest = mine.filter((r) => r.key === b.key).sort((x, y) => y.version - x.version)[0];
				const own = newest
					? world.entries.find((e) => e.vault === vault && e.type === RULE && !e.deleted && e.record?.key === b.key && e.record?.version === newest.version)?.entry
					: null;
				return [b.key, { rule: newest ?? b, own: own ?? null }];
			})
		);
	});
	const isOff = (/** @type {string} */ k) => !!rules.get(k)?.rule.off;

	/** The groups of kinds down the left: each kind of job, with the rules in their two groups. */
	const groups = $derived.by(() => {
		const seen = new Set(jobs.map((j) => j.kind));
		const macKinds = Object.keys(KINDS).filter((k) => KINDS[k].group === 'This Mac' && seen.has(k));
		return [
			{ name: 'Sync', kinds: Object.keys(KINDS).filter((k) => KINDS[k].group === 'Sync') },
			{ name: 'Studio · by themselves', kinds: BUILT_IN.filter((r) => r.when).map((r) => r.key) },
			{ name: 'Studio · when asked', kinds: BUILT_IN.filter((r) => !r.when).map((r) => r.key) },
			...(macKinds.length ? [{ name: 'This Mac', kinds: macKinds }] : [])
		];
	});

	/** How each kind's jobs stand: running, waiting, failed or held. */
	const tally = $derived.by(() => {
		/** @type {Map<string, { run: number, next: number, bad: number }>} */
		const out = new Map();
		for (const j of jobs) {
			const c = out.get(j.kind) ?? { run: 0, next: 0, bad: 0 };
			if (j.state === 'running') c.run++;
			else if (j.state === 'queued') c.next++;
			else if (j.state === 'failed' || j.state === 'held') c.bad++;
			out.set(j.kind, c);
		}
		return out;
	});
	const NONE = { run: 0, next: 0, bad: 0 };

	/** the jobs of the kind picked */
	const ofKind = $derived(kind ? jobs.filter((j) => j.kind === kind) : jobs);
	const nowJobs = $derived(ordered(ofKind.filter(live)));
	const ended = $derived(ordered(ofKind.filter((j) => !live(j))));
	const endedShown = $derived(
		ended.filter((j) => (show === 'failed' ? j.state === 'failed' || j.state === 'held' : show === 'done' ? j.state === 'done' : true))
	);
	/** the jobs done today, and how long each took on average */
	const today = $derived.by(() => {
		const day = new Date(now).toDateString();
		const d = ended.filter((j) => j.state === 'done' && j.ended && new Date(j.ended).toDateString() === day);
		const ts = d.flatMap((j) => (j.started && j.ended ? [(j.ended - j.started) / 1000] : []));
		return { n: d.length, avg: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null };
	});
	const failures = $derived(ended.filter((j) => j.state === 'failed' || j.state === 'held').length);
	/** how many each part on the left shows */
	const counts = $derived(
		/** @type {Record<string, number>} */ ({
			'': ofKind.length,
			now: nowJobs.length,
			failed: failures,
			done: ended.length - failures,
			syncing: syncing.length
		})
	);
	/** Whether the page shows part `part`. @param {string} part */
	const shows = (part) =>
		part === 'syncing'
			? (!show || show === 'syncing') && (!kind || KINDS[kind]?.group === 'Sync')
			: part === 'now'
				? !show || show === 'now'
				: !show || show === 'failed' || show === 'done';

	/** Each lane, what runs in it and how many wait for it: the Mac's four, and syncing beside them. */
	const lanes = $derived(
		LANES.filter((l) => mac || l.id === 'sync').map((l) => {
			const in_ = jobs.filter((j) => j.lane === l.id && live(j));
			return { ...l, run: in_.find((j) => j.state === 'running') ?? null, running: in_.filter((j) => j.state === 'running').length, next: in_.filter((j) => j.state === 'queued').length };
		})
	);

	/** the job picked, while it is still told */
	const job = $derived(picked ? jobs.find((j) => j.id === picked) : undefined);
	/** the rule picked on the left, if a rule is */
	const rule = $derived(kind ? (rules.get(kind)?.rule ?? null) : null);

	/** A time in seconds, as a clock reads it: "4:05", "1:02:03". @param {number} t */
	const clock = (t) => {
		const n = Math.max(0, Math.round(t));
		const [h, m, r] = [Math.floor(n / 3600), Math.floor((n % 3600) / 60), n % 60];
		const two = (/** @type {number} */ x) => String(x).padStart(2, '0');
		return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
	};
	/** How long job `j` has run, or ran, in seconds; `null` before it started. @param {Job} j */
	const took = (j) => (j.started ? ((j.ended ?? now) - j.started) / 1000 : null);
	/** How long job `j` has left, from how fast it has gone so far, or `null` while that says too little. @param {Job} j */
	const left = (j) => {
		const p = j.progress;
		const t = took(j);
		return j.state === 'running' && p !== null && p > 0.02 && p < 1 && t !== null && t > 3 ? (t / p) * (1 - p) : null;
	};
	/** A time in milliseconds since 1970, as a person reads it. @param {number} t */
	const stamp = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	/** What a job says beside how far it is: its stage, what it moved, how long. @param {Job} j */
	const detail = (j) => {
		if (j.state === 'queued') return [j.stage, `waits ${clock((now - j.queued) / 1000)}`].filter(Boolean).join(' · ');
		if (j.state === 'running') {
			const t = took(j);
			const eta = left(j);
			return [j.stage, j.amount, t !== null ? clock(t) : '', eta !== null ? `${clock(eta)} left` : ''].filter(Boolean).join(' · ');
		}
		if (j.state === 'done') {
			const t = took(j);
			return [j.amount, t !== null && t > 0 ? `in ${clock(t)}` : ''].filter(Boolean).join(' · ');
		}
		return [j.error, j.stage].filter(Boolean).join(' · ');
	};
	/** A job's state, as its chip names it, and the chip's colour. @param {Job} j */
	const stateChip = (j) =>
		/** @type {[string, string]} */ (
			j.state === 'running' ? ['Running', 'accent'] : j.state === 'queued' ? ['Waiting', ''] : j.state === 'done' ? ['Done', 'ok'] : j.state === 'held' ? ['Held', 'warn'] : [j.task && j.task.attempts < TRIES ? 'Failed, tries again' : 'Failed', 'bad']
		);
	/** What a rule makes, in a few words. @param {import('$lib/studio/jobs/rules.js').Rule} r */
	const makes = (r) => r.makes.map((m) => ('value' in m ? `its ${m.value}, on the task` : `a file tagged ${m.tags.join(', ')}`)).join('; ');
	/** What a rule waits for: the rules whose work it reads. @param {import('$lib/studio/jobs/rules.js').Rule} r */
	const after = (r) =>
		list(Object.values(r.inputs).flatMap((i) => (typeof i === 'object' ? [`${kindName(i.made)}${i.optional ? ' (if there is one)' : ''}`] : [])));
	/** @param {string} h */
	const holdWords = (h) => (h === 'ingest' ? 'Waiting for the import to finish' : h === 'memory' ? 'Waiting for memory' : `Paused: ${h}`);

	/** Picks job `j`, its progress on the right, slid in where the right side slides in. @param {Job} j */
	function pick(j) {
		picked = j.id;
		if (matchMedia('(max-width: 1100px)').matches) open = 'aside';
	}

	/** Job `j` asked again: a task queued again in the vault, a job of the Mac's run again. @param {Job} j */
	async function again(j) {
		if (j.task) {
			if (await api.run(`Asking ${kindName(j.kind)} again for ${j.name}`, retrying(j.task, actor))) nudge();
		} else if (j.mac) await command('jobs_retry', { id: j.mac.id }).then(loadMac, (e) => (failed = why(e)));
	}
	/** Job `j` run next in its lane. @param {Job} j */
	const front = (j) => j.mac && command('jobs_bump', { id: j.mac.id }).then(loadMac, (e) => (failed = why(e)));
	/** Job `j` taken off its lane. @param {Job} j */
	const stop = (j) => j.mac && command('jobs_cancel', { id: j.mac.id }).then(loadMac, (e) => (failed = why(e)));

	/**
	 * Rule `key` turned off in this vault, or on again: the vault's own rule record says so, made from the app's the
	 * first time, so the app's rule stays as it is.
	 * @param {string} key
	 */
	async function flip(key) {
		const h = rules.get(key);
		if (!h) return;
		const off = !h.rule.off;
		switching = key;
		const op = h.own
			? { op: 'batch', as: actor, ops: [{ op: 'set', entry: h.own, path: ['off'], value: off }] }
			: { op: 'create', vault, type: RULE, value: toRecord({ ...h.rule, off }), as: actor };
		if (await api.run(`Turning ${h.rule.name} ${off ? 'off' : 'on'}`, op)) nudge();
		switching = '';
	}
</script>

<!-- where what sync `j` worked on is synced to now, a chip each device -->
{#snippet where(/** @type {SyncJob} */ j)}
	<div class="where">
		{#each syncedTo(j) as h (h.device)}
			{@const all = h.has >= h.of}
			{@const since = h.checked == null ? '' : `, as it said ${ago(h.checked, now)}`}
			<span class="chip" class:ok={all} class:warn={!all} title="{s.signer(h.device)} holds {all ? 'all of it' : `${h.has} of ${h.of}`}{since}">
				{s.signer(h.device)}{all ? '' : ` ${Math.round((100 * h.has) / h.of)} %`}{h.checked == null ? '' : ` · ${ago(h.checked, now)}`}
			</span>
		{:else}
			<span class="chip">Not synced yet</span>
		{/each}
	</div>
{/snippet}

<!-- one job, one row, the same wherever it is: its kind, what it works on, how far it is, what it says, what to do -->
{#snippet row(/** @type {Job} */ j)}
	{@const [label, tone] = stateChip(j)}
	<tr class={j.state} class:on={picked === j.id}>
		<td class="kind"><span class="dot {j.lane}" class:live={j.state === 'running'}></span><span class="tag">{kindName(j.kind)}</span></td>
		<td class="name"><button class="pick" aria-pressed={picked === j.id} title={j.subject} onclick={() => pick(j)}>{j.name}</button></td>
		<td class="state">
			{#if j.state === 'running'}
				<span class="bar"><i style:width="{(j.progress ?? 0) * 100}%" class:unknown={j.progress === null}></i></span>
				<b class="num">{j.progress === null ? '' : `${Math.round(j.progress * 100)} %`}</b>
			{:else}
				<span class="chip {tone}">{label}</span>
			{/if}
		</td>
		<td class="why" title={j.error || detail(j)}>{detail(j)}</td>
		<td class="acts">
			{#if j.front}<button class="act" title="Run it next" onclick={() => front(j)}>To front</button>{/if}
			{#if j.stop}<button class="act" title="Take it off its lane" onclick={() => stop(j)}>Stop</button>{/if}
			{#if j.again}<button class="act" onclick={() => again(j)}>Again</button>{/if}
		</td>
	</tr>
{/snippet}

<!-- down the left: what the page shows, then each kind of job with how its jobs stand -->
{#snippet nav()}
	<h3 class="nav-group">Show</h3>
	{#each SHOWS as [key, label, icon] (key)}
		<button class="nav-item" class:on={show === key} aria-pressed={show === key} data-pick onclick={() => (show = key)}
			><Icon name={icon} size={16} /><span>{label}</span><small>{counts[key]}</small></button
		>
	{/each}
	{#each groups as g (g.name)}
		<h3 class="nav-group">{g.name}</h3>
		{#each g.kinds as k (k)}
			{@const c = tally.get(k) ?? NONE}
			<button
				class="nav-item kind-item"
				class:on={kind === k}
				class:off={isOff(k)}
				aria-pressed={kind === k}
				title={BUILT_IN.find((r) => r.key === k)?.about ?? KINDS[k]?.about}
				data-pick
				onclick={() => (kind = kind === k ? '' : k)}
			>
				<span class="dot {BUILT_IN.find((r) => r.key === k)?.lane ?? (KINDS[k]?.group === 'Sync' ? 'sync' : 'io')}" class:live={c.run > 0}></span>
				<span>{kindName(k)}</span>
				<span class="ct">
					{#if isOff(k)}<i>Off</i>{/if}
					{#if c.run}<b class="run">{c.run}</b>{/if}
					{#if c.next}<b>{c.next}</b>{/if}
					{#if c.bad}<b class="bad">{c.bad}</b>{/if}
				</span>
			</button>
		{/each}
	{/each}
{/snippet}

<!-- on the right, the job picked: how far it is, when, and what it is about -->
{#snippet aside()}
	{#if job}
		{@const [label, tone] = stateChip(job)}
		{@const eta = left(job)}
		{@const t = took(job)}
		<header class="about-head">
			<small>{kindName(job.kind)}</small>
			<h3>{job.name}</h3>
		</header>
		{#if job.state === 'running'}
			<div class="meter">
				<span class="bar"><i style:width="{(job.progress ?? 0) * 100}%" class:unknown={job.progress === null}></i></span>
				<b class="num">{job.progress === null ? '' : `${Math.round(job.progress * 100)} %`}</b>
			</div>
		{/if}
		<dl>
			<dt>It is</dt>
			<dd><span class="chip {tone}">{label}</span></dd>
			{#if job.stage}<dt>Stage</dt><dd>{job.stage}</dd>{/if}
			{#if job.amount}<dt>{job.state === 'done' ? 'It did' : 'So far'}</dt><dd>{job.amount}</dd>{/if}
			<dt>Lane</dt>
			<dd>{LANES.find((l) => l.id === job.lane)?.label ?? job.lane}</dd>
			<dt>Asked</dt>
			<dd>{stamp(job.queued)}</dd>
			{#if job.started}<dt>Started</dt><dd>{stamp(job.started)}</dd>{/if}
			{#if job.ended}<dt>Ended</dt><dd>{stamp(job.ended)}</dd>{/if}
			{#if t !== null}<dt>{job.ended ? 'It took' : 'Running for'}</dt><dd>{clock(t)}</dd>{/if}
			{#if eta !== null}<dt>Left</dt><dd>{clock(eta)}</dd>{/if}
			{#if job.task}<dt>Tries</dt><dd>{job.task.attempts} of {TRIES}</dd>{/if}
			{#if job.error}<dt>Why</dt><dd class="error">{job.error}</dd>{/if}
		</dl>
		{#if job.front || job.stop || job.again}
			<div class="side-acts">
				{#if job.front}<button class="act" onclick={() => job && front(job)}>To front</button>{/if}
				{#if job.stop}<button class="act" onclick={() => job && stop(job)}>Stop</button>{/if}
				{#if job.again}<button class="act" onclick={() => job && again(job)}>Again</button>{/if}
			</div>
		{/if}
		<h4 class="side-head">What it is about</h4>
		<dl>
			{#if job.sync}
				{@const about = itsEntries(job.sync)}
				<dt>{job.kind === 'pull' ? 'From' : 'File'}</dt>
				{#if job.kind === 'pull'}<dd>{s.signer(job.subject)}</dd>{:else}<dd class="mono" title={job.subject}>{short(job.subject)}</dd>{/if}
				{#if about.length}<dt>{about.length === 1 ? 'Entry' : 'Entries'}</dt><dd>{about.map((e) => s.entry(e)).join(', ')}</dd>{/if}
			{:else if job.task}
				<dt>Rule</dt>
				<dd>{kindName(job.task.rule)} v{job.task.version}</dd>
				<dt>{job.task.inputs.length === 1 ? 'Input' : 'Inputs'}</dt>
				<dd>{job.task.inputs.map((i) => (entries.has(i.entry) ? s.entry(i.entry) : short(i.entry))).join(', ')}</dd>
				<dt>Task</dt>
				<dd class="mono" title={job.task.entry}>{short(job.task.entry)}</dd>
			{:else}
				<dt>What</dt>
				<dd class="mono" title={job.subject}>{job.subject}</dd>
			{/if}
		</dl>
		{#if job.sync && job.state === 'done'}
			<h4 class="side-head">Synced to</h4>
			{@render where(job.sync)}
		{/if}
	{/if}
{/snippet}

<Frame {nav} aside={job ? aside : undefined} bind:open navLabel="What it shows" asideLabel="The job" navIcon="jobs" asideIcon="info">
	<div class="jobs">
		<p class="soft lead">
			Everything done in the background for this vault, in one list: its files and edits syncing between your devices,
			and the studio’s rules making proxies, stills, transcripts and renders of its footage{mac ? ', on this Mac straight in the vault' : ''}.
		</p>
		{#if failed}<p class="error">Reading the jobs failed: {failed}</p>{/if}

		<div class="summary">
			<span><b>{nowJobs.filter((j) => j.state === 'running').length}</b> running</span>
			<span><b>{nowJobs.filter((j) => j.state === 'queued').length}</b> waiting</span>
			<span><b>{today.n}</b> done today{today.avg !== null ? ` · ${clock(today.avg)} each` : ''}</span>
			<span class:bad={failures > 0}><b>{failures}</b> failed</span>
			{#if !kind}<span><b>{BUILT_IN.filter((r) => !isOff(r.key)).length}</b> of {BUILT_IN.length} studio rules on</span>{/if}
			{#each holds as h (h)}<span class="chip warn">{holdWords(h)}</span>{/each}
		</div>

		{#if lanes.length > 1}
			<div class="lanes">
				{#each lanes as l (l.id)}
					{@const j = l.run}
					<div class="lane" class:busy={!!j} title={l.what}>
						<span class="dot {l.id}" class:live={!!j}></span>
						<span class="ln">{l.label}</span>
						<span class="jn" class:soft={!j} title={j ? `${kindName(j.kind)} · ${j.name}` : ''}>{j ? (l.running > 1 ? `${j.name} +${l.running - 1}` : j.name) : 'idle'}</span>
						{#if j?.progress != null}<span class="pct">{Math.round(j.progress * 100)}%</span>{/if}
						{#if l.next}<span class="nx">+{l.next}</span>{/if}
						{#if j?.progress != null}<i class="lane-bar" style:width="{j.progress * 100}%"></i>{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if kind}
			<article class="card-kind">
				<div class="head">
					<h3>{kindName(kind)}</h3>
					{#if rule}<span class="tag">v{rule.version}</span>{/if}
					<span class="grow"></span>
					{#if rule}
						<button
							class="switch"
							role="switch"
							aria-checked={!rule.off}
							disabled={!!switching}
							title={rule.off ? 'Turn it on in this vault' : 'Turn it off in this vault'}
							onclick={() => flip(rule.key)}
						>
							<i></i><span>{switching === rule.key ? '…' : rule.off ? 'Off' : 'On'}</span>
						</button>
					{/if}
					<button class="act" title="Every kind" onclick={() => (kind = '')}>All kinds</button>
				</div>
				{#if rule}
					{@const a = after(rule)}
					<dl>
						<dt>Makes</dt><dd>{rule.about} <span class="soft">({makes(rule)})</span></dd>
						<dt>When</dt><dd>{rule.when ? 'By itself: for each entry it picks, as soon as the Mac sees it' : 'When asked: by a button, an agent or a cut'}</dd>
						{#if a}<dt>After</dt><dd>{a}</dd>{/if}
						<dt>Lane</dt><dd>{LANES.find((l) => l.id === (rule.lane === 'net' ? 'io' : rule.lane))?.label}</dd>
					</dl>
				{:else if KINDS[kind]}
					<p class="soft">{KINDS[kind].about}</p>
				{/if}
			</article>
		{/if}

		{#if shows('now')}
			<section>
				<h3>Now</h3>
				{#if nowJobs.length}
					<table><tbody>
						{#each nowJobs.slice(0, 60) as j (j.id)}{@render row(j)}{/each}
						{#if nowJobs.length > 60}<tr><td class="soft" colspan="5">and {nowJobs.length - 60} more</td></tr>{/if}
					</tbody></table>
				{:else}
					<p class="empty">Nothing runs or waits now.</p>
				{/if}
			</section>
		{/if}

		{#if shows('ended')}
			<section>
				<h3>{show === 'failed' ? 'Failed' : show === 'done' ? 'Done' : 'Done and failed'}</h3>
				{#if endedShown.length}
					<table><tbody>
						{#each endedShown.slice(0, 150) as j (j.id)}{@render row(j)}{/each}
						{#if endedShown.length > 150}<tr><td class="soft" colspan="5">and {endedShown.length - 150} more</td></tr>{/if}
					</tbody></table>
				{:else}
					<p class="empty">Nothing yet.</p>
				{/if}
				{#if said}<p class="soft said">{said}</p>{/if}
			</section>
		{/if}

		{#if shows('syncing')}
			<section>
				<h3>Still syncing</h3>
				{#if syncing.length}
					<table><tbody>
						{#each syncing as r (r.id)}
							<tr>
								<td class="kind"><span class="dot sync"></span><span class="tag">{r.kind === 'file' ? 'File' : 'Entry'}</span></td>
								<td class="name">{r.what}</td>
								<td class="state"><span class="bar"><i style:width="{(r.has / r.of) * 100}%"></i></span><b class="num">{Math.round((100 * r.has) / r.of)} %</b></td>
								<td class="why">{s.signer(r.device)} holds {r.has} of {count(r.of, r.kind === 'file' ? 'piece' : 'edit')}</td>
								<td class="acts"></td>
							</tr>
						{/each}
					</tbody></table>
				{:else}
					<p class="empty">Everything here is on every device that holds it.</p>
				{/if}
			</section>
		{/if}
	</div>
</Frame>

<style>
	.jobs {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		max-width: 64rem;
		font-size: 0.86rem;
	}

	.lead {
		margin: 0;
	}

	.jobs section h3 {
		margin: 0 0 0.5rem;
		font-size: 0.72rem !important;
		letter-spacing: 0.06em !important;
		text-transform: uppercase;
		color: var(--soft);
	}

	/* how it all stands, in one line */
	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 1.2rem;
		color: var(--soft);
	}

	.summary b {
		font-variant-numeric: tabular-nums;
		color: var(--ink, inherit);
	}

	.summary .bad,
	.summary .bad b {
		color: var(--bad, #b23a22);
	}

	/* a lane's colour, on its kinds, rows and in the strip */
	.dot {
		flex: none;
		display: inline-block;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--soft);
		opacity: 0.6;
	}

	.dot.gpu { background: #3f78cf; }
	.dot.speech { background: #8458d0; }
	.dot.ai { background: #c98a16; }
	.dot.io,
	.dot.net { background: #23906c; }
	.dot.sync { background: #c2507a; }

	.dot.live {
		opacity: 1;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	/* the lanes, one strip: each runs one job at a time */
	.lanes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
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
		border-radius: 8px;
		background: var(--card);
		font-size: 0.78rem;
	}

	.lane.busy {
		border-color: color-mix(in srgb, var(--accent) 45%, var(--edge));
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
	}

	.pct,
	.nx {
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		color: var(--soft);
	}

	.pct {
		color: var(--accent);
	}

	.lane-bar {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 2px;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	/* the kind picked, described, a rule with its switch */
	.card-kind {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.75rem 0.9rem;
		border-radius: 12px;
		background: var(--card);
	}

	.card-kind .head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.card-kind h3 {
		margin: 0;
		font-size: 0.98rem;
	}

	.card-kind p {
		margin: 0;
	}

	.grow {
		flex: 1;
	}

	.tag {
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		background: rgb(0 0 0 / 0.05);
		font-size: 0.7rem;
		white-space: nowrap;
		color: var(--soft);
	}

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.76rem;
		color: var(--soft);
		cursor: pointer;
	}

	.switch i {
		position: relative;
		width: 1.9rem;
		height: 1.1rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.18);
		transition: background 0.15s ease;
	}

	.switch i::after {
		content: '';
		position: absolute;
		top: 0.15rem;
		left: 0.15rem;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
		transition: transform 0.15s ease;
	}

	.switch[aria-checked='true'] i {
		background: var(--ok, #2f7a4a);
	}

	.switch[aria-checked='true'] i::after {
		transform: translateX(0.8rem);
	}

	.switch:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.act {
		padding: 0.15rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--card);
		font: inherit;
		font-size: 0.72rem;
		white-space: nowrap;
		color: inherit;
		cursor: pointer;
	}

	.act:hover {
		border-color: var(--accent);
	}

	/* the kinds on the left: how each one's jobs stand */
	.kind-item.off span:not(.ct) {
		opacity: 0.55;
	}

	.ct {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: auto;
	}

	.ct i {
		font-size: 0.68rem;
		font-style: normal;
		color: var(--soft);
	}

	.ct b {
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.06);
		font-size: 0.66rem;
		font-weight: 600;
		text-align: center;
		color: var(--soft);
	}

	.ct b.run {
		background: var(--accent);
		color: #fff;
	}

	.ct b.bad {
		color: var(--bad, #b23a22);
	}

	/* every list: one row a job */
	table {
		width: 100%;
		border-collapse: collapse;
		border-radius: 12px;
		background: var(--card);
		overflow: hidden;
	}

	td {
		padding: 0.45rem 0.6rem;
		border-top: 1px solid var(--edge);
		vertical-align: middle;
	}

	tr:first-child td {
		border-top: 0;
	}

	tr.on td {
		background: rgb(0 0 0 / 0.04);
	}

	td.kind {
		width: 1%;
		white-space: nowrap;
	}

	td.kind .dot {
		margin-right: 0.4rem;
		vertical-align: middle;
	}

	.name {
		max-width: 16rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.pick {
		display: block;
		max-width: 16rem;
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

	td.state {
		width: 9.5rem;
		white-space: nowrap;
	}

	td.state .bar {
		display: inline-block;
		width: 5.5rem;
		vertical-align: middle;
	}

	td.state .num {
		margin-left: 0.4rem;
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

	.num {
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	/* what is left of the row, cut short */
	td.why {
		width: 100%;
		max-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--soft);
	}

	tr.failed td.why,
	tr.held td.why {
		color: var(--bad, #b23a22);
	}

	td.acts {
		width: 1%;
		text-align: right;
		white-space: nowrap;
	}

	td.acts .act + .act {
		margin-left: 0.25rem;
	}

	.said {
		margin: 0.4rem 0 0;
		font-size: 0.72rem;
	}

	.where {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	/* the right side: the job picked */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0.8rem;
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

	.side-acts {
		display: flex;
		gap: 0.35rem;
		margin-top: 0.8rem;
	}

	.meter {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0 0 0.7rem;
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
		td.why {
			display: none;
		}

		td.state {
			width: auto;
		}

		td.state .bar {
			width: 3rem;
		}
	}
</style>
