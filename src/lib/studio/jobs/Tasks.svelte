<!--
	The studio's jobs on this Mac, as the legacy studio's jobs viewer showed them (Samuel 2026-10-18: one list of
	rules, not one for every vault, and this Mac every vault's worker by itself). The aside lists the rules once
	(./rules.js), a line each with how its jobs stand, all jobs first; the one picked is described at the top (what it
	makes, when it fires, after what, how its jobs stand, and one switch that turns it off or on in every vault this Mac
	works for) and filters the rest to its kind. Below: the lanes in one strip (each runs one job at a time), what runs
	and waits (to the front, or off the queue), and the history, a failed one made again.

	What runs is the Mac's own jobs (vault/app/src/jobs.rs: `jobs_list` and its `jobs` and `jobs-gone` events), which
	every avenDB task the Mac does goes through (aven.rs `studio_job`, subject `aven:<task>`), beside the avenDB tasks
	themselves (./tasks.js): one queued and not yet claimed, one claimed by another device, one that failed or is held,
	with its error and Again, which asks the task again. The worker (./mac.js) works for every vault the person
	reaches; for each one of theirs whose studio worker this Mac doesn't host yet (J0c), it is made one as the page
	opens, one vault after another, once each time the app starts: adding one asks for the passkey once, in the app's
	sheet, so a refusal stops the round, said in one line with Try again, and no other sheet follows it. "Checksum
	test" adds a small file tagged jobs:test to the person's vault, which the test rule picks up (J0f).
-->
<script module>
	/** The vaults this Mac was made the worker of, or tried to be, since the app started: the sheet comes once. */
	const tried = new Set();
	/** @type {Map<string, string>} why this Mac couldn't become a vault's worker, by vault */
	const refused = new Map();
	/** Whether the round of hiring stopped at a refusal: the rest wait for Try again, so a sheet put away isn't followed by another. */
	const paused = { yes: false };
</script>

<script>
	import { onMount } from 'svelte';
	import { answer } from '$lib/avendb/ops.js';
	import { list, nameOf, owns, short } from '$lib/avendb/vaults.js';
	import { BUILT_IN, held, toRecord } from './rules.js';
	import { RULE } from './schemas.js';
	import { retrying, tasksOf, TRIES } from './tasks.js';
	import { lines, macWorker, nudge } from './mac.js';
	import { WORKER_NAME, WORKER_SHARES } from './worker.js';

	/**
	 * A job as the Mac tells it (jobs.rs `Job`).
	 * @typedef {{ id: string, kind: string, lane: 'gpu' | 'speech' | 'ai' | 'io', subject: string, name: string,
	 *   state: 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled', stage: string, progress: number,
	 *   priority: number, queued: string, started: string | null, ended: string | null, error: string | null }} Job
	 */
	/**
	 * One line of what runs, waits or ran: a Mac job, an avenDB task, or both, the job doing the task. `rule` the rule
	 * it is of (or the job's kind, for jobs no rule starts), times in milliseconds; `open` a failure not yet made good,
	 * `again` whether Again shows.
	 * @typedef {{ id: string, rule: string, lane: string, name: string, state: string, stage: string, progress: number,
	 *   priority: number, queued: number, started: number | null, ended: number | null, error: string,
	 *   job: Job | null, task: import('./tasks.js').Task | null, open: boolean, again: boolean }} Row
	 */
	/**
	 * A rule in one vault this Mac works for: as the vault holds it (its own record, `own` its entry) or the app's.
	 * @typedef {{ rule: import('./rules.js').Rule, own: string | null }} Held
	 */

	const LANES = /** @type {const} */ ([
		{ id: 'gpu', label: 'GPU', what: 'proxies, grading stills, graded stills, world proxies, renders' },
		{ id: 'speech', label: 'Speech', what: 'transcripts, on this Mac' },
		{ id: 'ai', label: 'AI', what: 'shot analyses and hero frames' },
		{ id: 'io', label: 'Disk & line', what: 'probes, imports, files kept, pages from the web' }
	]);
	/** @type {Record<string, string>} each lane, as a person names it; the web's tasks run on the Mac's disk lane */
	const LANE_NAMES = { gpu: 'GPU', speech: 'Speech', ai: 'AI', io: 'Disk & line', net: 'Web' };
	/** @type {Record<string, string>} the rule each kind of the Mac's jobs does, as studio_job maps them */
	const KIND_RULE = { sound: 'probe', proxy: 'proxy', still: 'still', transcript: 'transcript', analysis: 'analysis', render: 'render', frame: 'frame', 'world-proxy': 'world-proxy', fetch: 'youtube' };
	/** The Mac's jobs no rule starts, with what each is. */
	const OTHER = /** @type {Record<string, { name: string, lane: string, about: string }>} */ ({
		ingest: { name: 'Imports', lane: 'io', about: 'Files brought into avenDB: dropped on the app, from a card or a drive, or from the old vault.' },
		keep: { name: 'Keeping', lane: 'io', about: 'Files this Mac or a drive keeps, fetched and pinned, or let go of.' }
	});
	const RULE_NAMES = Object.fromEntries(BUILT_IN.map((r) => [r.key, r.name]));
	const FINISHED = ['done', 'failed', 'cancelled'];

	/** @type {import('./worker.js').Worker | null} */
	let worker = $state(null);
	let ready = $state(false);
	/** @type {Job[]} */
	let active = $state([]);
	/** @type {Job[]} */
	let history = $state([]);
	/** @type {string[]} what holds the Mac's lanes now: an ingest, memory */
	let holds = $state([]);
	/** @type {import('./tasks.js').Task[]} */
	let tasks = $state([]);
	/** @type {Record<string, string>} each entry's title, by its id */
	let names = $state({});
	/** this Mac's device, and the devices of the workers it hosts */
	let mine = $state(/** @type {Set<string>} */ (new Set()));
	/** @type {{ vault: string, name: string, worker: boolean, yours: boolean, rules: Record<string, Held> }[]} each vault this Mac works for */
	let vaults = $state([]);
	let log = $state(/** @type {string[]} */ ([]));
	let error = $state('');
	let adding = $state(false);
	/** @type {string | null} the vault this Mac is being made the worker of */
	let hiring = $state(null);
	let failures = $state(/** @type {[string, string][]} */ ([...refused]));
	/** the rule turned on or off now, in every vault */
	let switching = $state(/** @type {string | null} */ (null));
	/** the rule (or kind of job) picked in the aside: only its jobs are shown */
	let picked = $state(/** @type {string | null} */ (null));
	let stateFilter = $state(/** @type {'all' | 'failed' | 'done'} */ ('all'));
	let now = $state(Date.now());

	/** @param {string} name @param {Record<string, unknown>} [args] */
	const mac = async (name, args = {}) => {
		const { command } = await import('$lib/native');
		return command(name, args);
	};
	/** @param {unknown} e */
	const why = (e) => (e instanceof Error ? e.message : String(e));

	/** The Mac's jobs, read whole; between reads its events tell each change. */
	async function loadJobs() {
		try {
			const j = /** @type {{ active: Job[], history: Job[], holds: string[] }} */ (await mac('jobs_list', { limit: 300 }));
			active = j.active;
			history = j.history;
			holds = j.holds ?? [];
		} catch (e) {
			error = why(e);
		}
	}

	/** A job as the Mac tells it changed. @param {Job} j */
	function changed(j) {
		if (FINISHED.includes(j.state)) {
			active = active.filter((x) => x.id !== j.id);
			history = [j, ...history.filter((x) => !(x.id === j.id && x.ended === j.ended))].slice(0, 300);
		} else {
			const i = active.findIndex((x) => x.id === j.id);
			active = i < 0 ? [...active, j] : active.map((x) => (x.id === j.id ? j : x));
		}
	}

	/** The device's world: the tasks, the entries' titles, and each vault this Mac works for with its rules. */
	async function load() {
		if (!worker) return;
		try {
			const world = await worker.world();
			const hosted = await worker.hosted().catch(() => []);
			tasks = tasksOf(world);
			names = Object.fromEntries(world.entries.map((/** @type {any} */ e) => [e.entry, e.title || e.record?.title || e.record?.name || '']));
			mine = new Set([world.me, ...hosted.map((w) => w.device)]);
			vaults = worker.vaults(world).map((v) => {
				const own = held(world, v);
				/** @type {Record<string, Held>} */
				const rules = {};
				for (const b of BUILT_IN) {
					const newest = own.filter((r) => r.key === b.key).sort((x, y) => y.version - x.version)[0];
					const entry = newest
						? world.entries.find((/** @type {any} */ e) => e.vault === v && e.type === RULE && !e.deleted && e.record?.key === b.key && e.record?.version === newest.version)?.entry
						: null;
					rules[b.key] = { rule: newest ?? b, own: entry ?? null };
				}
				return {
					vault: v,
					name: nameOf(world.vaults?.find((/** @type {any} */ x) => x.id === v)),
					worker: hosted.some((w) => (w.for ?? w.vault) === v),
					// a worker works for the person's vault or one it owns (avendb-device worker.rs `add_worker`)
					yours: v === world.mine || owns(world, world.mine, v),
					rules
				};
			});
			log = [...lines];
			error = '';
		} catch (e) {
			error = why(e);
		}
	}

	/**
	 * This Mac made the studio worker of every vault of the person's it works for that has none here yet, one after
	 * another, each once while the app runs: a device vault of the vault's own, with a key this Mac keeps and the
	 * Worker shares (./worker.js), or this Mac's key added to the worker the vault has on another Mac of theirs. The
	 * first refusal stops the round until Try again (`again`), which asks the refused ones again and goes on.
	 * @param {boolean} [again]
	 */
	async function hireAll(again = false) {
		if (hiring || (paused.yes && !again)) return;
		paused.yes = false;
		for (const v of vaults) {
			if (!v.yours || v.worker || (tried.has(v.vault) && !(again && refused.has(v.vault)))) continue;
			tried.add(v.vault);
			if (!(await hire(v.vault))) {
				paused.yes = true;
				return;
			}
		}
	}

	/** This Mac made vault `vault`'s worker, in one passkey sheet at most; whether it is. @param {string} vault */
	async function hire(vault) {
		hiring = vault;
		try {
			const { call } = await import('$lib/avendb/native.js');
			await call('addWorker', vault, WORKER_NAME, WORKER_SHARES);
			refused.delete(vault);
			nudge();
			await load();
			return true;
		} catch (e) {
			refused.set(vault, why(e));
			return false;
		} finally {
			hiring = null;
			failures = [...refused];
		}
	}

	/** @param {import('./tasks.js').Task} t */
	async function again(t) {
		if (!worker) return;
		try {
			answer(await worker.send(retrying(t, worker.as(t.vault))));
			nudge();
			await load();
		} catch (e) {
			error = why(e);
		}
	}

	/** @param {string} id */
	const cancel = (id) => mac('jobs_cancel', { id }).then(loadJobs, (e) => (error = why(e)));
	/** @param {string} id */
	const bump = (id) => mac('jobs_bump', { id }).then(loadJobs, (e) => (error = why(e)));
	/** @param {string} id */
	const retry = (id) => mac('jobs_retry', { id }).then(loadJobs, (e) => (error = why(e)));

	/** @param {Row} r */
	function redo(r) {
		if (r.task) void again(r.task);
		else if (r.job) void retry(r.job.id);
	}

	/** Whether rule `key` is off in every vault this Mac works for, in some, or in none. @param {string} key */
	const offIn = (key) => {
		const off = vaults.filter((v) => v.rules[key]?.rule.off).length;
		return off === 0 ? 'none' : off === vaults.length ? 'all' : 'some';
	};

	/**
	 * Rule `key` turned on in every vault this Mac works for, or off in every one: each vault's own rule record says
	 * so (made from the app's own the first time), so the app's rule stays as it is. Off in some, it goes on.
	 * @param {string} key
	 */
	async function flip(key) {
		if (!worker) return;
		const on = offIn(key) !== 'none';
		switching = key;
		const failed = [];
		for (const v of vaults) {
			const h = v.rules[key];
			if (!h || h.rule.off !== on) continue;
			try {
				const as = worker.as(v.vault);
				const op = h.own
					? { op: 'batch', ops: [{ op: 'set', entry: h.own, path: ['off'], value: !on }], as }
					: { op: 'create', vault: v.vault, type: RULE, value: toRecord({ ...h.rule, off: !on }), as };
				answer(await worker.send(op));
			} catch (e) {
				failed.push(`${v.name}: ${why(e)}`);
			}
		}
		nudge();
		await load();
		if (failed.length) error = failed.join(' · ');
		switching = null;
	}

	/** A 3 MB file of known bytes, tagged jobs:test, into the person's own vault. */
	async function test() {
		if (!worker) return;
		adding = true;
		try {
			const world = await worker.world();
			const bytes = new Uint8Array(3 << 20).map((_, i) => (i * 31 + 7) % 251);
			const { NativeDevice } = await import('$lib/avendb/native.js');
			const op = { op: 'put_file', vault: world.mine, name: `checksum test ${new Date().toISOString()}.bin`, media: 'application/octet-stream', tags: ['jobs:test'], len: bytes.length };
			answer(await new NativeDevice(/** @type {any} */ ({})).putFile(op, async (at, n) => bytes.subarray(at, at + n)));
			nudge();
			setTimeout(load, 1500);
		} catch (e) {
			error = why(e);
		} finally {
			adding = false;
		}
	}

	onMount(() => {
		let gone = false;
		/** @type {(() => void)[]} */
		const unlisten = [];
		void loadJobs();
		void import('@tauri-apps/api/event')
			.then(async ({ listen }) => {
				const on = [
					await listen('jobs', (e) => changed(/** @type {Job} */ (e.payload))),
					await listen('jobs-gone', (e) => (active = active.filter((x) => x.id !== e.payload)))
				];
				if (gone) on.forEach((u) => u());
				else unlisten.push(...on);
			})
			.catch(() => {});
		void (async () => {
			worker = await macWorker();
			ready = true;
			await load();
			if (!gone) await hireAll();
		})();
		// the clocks tick; the tasks read again every few seconds, the Mac's jobs (and what holds its lanes) now and then
		const tick = setInterval(() => (now = Date.now()), 1000);
		const tasksAgain = setInterval(load, 4000);
		const jobsAgain = setInterval(loadJobs, 15000);
		return () => {
			gone = true;
			clearInterval(tick);
			clearInterval(tasksAgain);
			clearInterval(jobsAgain);
			unlisten.forEach((u) => u());
		};
	});

	/** @param {string | null | undefined} iso */
	const ms = (iso) => (iso ? Date.parse(iso) : null);
	/** @param {import('./tasks.js').Task} t */
	const inputOf = (t) => names[t.inputs[0]?.entry ?? ''] || t.inputs[0]?.entry.slice(0, 12) || t.entry.slice(0, 12);
	/** What a done task made, in a few words. @param {import('./tasks.js').Task} t */
	const made = (t) => {
		try {
			const r = JSON.parse(t.result || 'null');
			if (r?.blake3) return Object.values(r.blake3).map((h) => String(h).slice(0, 16)).join(' ');
		} catch {}
		return t.outputs.length ? `${t.outputs.length} made` : 'done';
	};
	/** Whether the Mac makes a job no task asked for again itself (jobs.rs `retry`). @param {Job} j */
	const retriable = (j) => !j.subject.startsWith('aven:') && !['render', 'frame', 'ingest', 'fetch'].includes(j.kind);

	/** @type {Map<string, import('./tasks.js').Task>} */
	const taskBy = $derived(new Map(tasks.map((t) => [t.entry, t])));

	/** A Mac job as a line, with the task it does, if it does one. @param {Job} j @returns {Row} */
	const fromJob = (j) => {
		const t = j.subject.startsWith('aven:') ? (taskBy.get(j.subject.slice(5)) ?? null) : null;
		return {
			id: j.id + (j.ended ?? ''),
			rule: t?.rule ?? KIND_RULE[j.kind] ?? j.kind,
			lane: j.lane,
			name: j.name || (t ? inputOf(t) : j.subject.slice(0, 12)),
			state: j.state,
			stage: j.stage,
			progress: j.progress,
			priority: j.priority,
			queued: ms(j.queued) ?? 0,
			started: ms(j.started),
			ended: ms(j.ended),
			error: j.error ?? '',
			job: j,
			task: t,
			open: false,
			again: false
		};
	};
	/** An avenDB task the Mac has no job of, as a line. @param {import('./tasks.js').Task} t @param {string} state @param {string} stage @returns {Row} */
	const fromTask = (t, state, stage) => ({
		id: t.entry,
		rule: t.rule,
		lane: t.lane === 'net' ? 'io' : t.lane,
		name: inputOf(t),
		state,
		stage,
		progress: 0,
		priority: 9,
		queued: t.at * 1000,
		started: null,
		ended: FINISHED.includes(state) || state === 'held' ? t.at * 1000 : null,
		error: t.error,
		job: null,
		task: t,
		open: state === 'failed' || state === 'held',
		again: state === 'failed' || state === 'held'
	});

	/** What runs and waits: the Mac's jobs, then the tasks it has none of yet; the running first, each lane's queue in its order. */
	const nowRows = $derived.by(() => {
		const doing = new Set(active.map((j) => j.subject));
		const s = now / 1000;
		const waiting = tasks
			.filter((t) => !doing.has(`aven:${t.entry}`) && (t.status === 'queued' || t.status === 'claimed'))
			.map((t) =>
				t.status === 'claimed' && t.lease_until >= s
					? fromTask(t, 'running', mine.has(t.worker) ? 'on this Mac' : `on ${short(t.worker)}`)
					: fromTask(t, 'queued', t.status === 'claimed' ? 'its worker went quiet' : '')
			);
		const run = (/** @type {Row} */ r) => (r.state === 'running' || r.state === 'waiting' ? 0 : 1);
		return [...active.map(fromJob), ...waiting].sort((a, b) => run(a) - run(b) || a.priority - b.priority || a.queued - b.queued);
	});

	/**
	 * What ran: the Mac's history, each job beside its task, the newest of a task's showing where the task stands now
	 * (failed, or held, with Again); then the tasks done, failed or held the Mac has no job of; the newest first.
	 */
	const pastRows = $derived.by(() => {
		const rows = history.map(fromJob).sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0));
		const seen = new Set();
		for (const r of rows) {
			if (!r.task) {
				r.open = r.state === 'failed';
				r.again = !!r.job && (r.state === 'failed' || r.state === 'cancelled') && retriable(r.job);
				continue;
			}
			if (seen.has(r.task.entry)) continue;
			seen.add(r.task.entry);
			if (r.task.status === 'failed' || r.task.status === 'held') {
				r.state = r.task.status;
				r.error = r.task.error || r.error;
				r.open = r.again = true;
			}
		}
		for (const t of tasks) {
			if (seen.has(t.entry) || !['done', 'failed', 'held'].includes(t.status)) continue;
			rows.push(fromTask(t, t.status, t.status === 'done' ? made(t) : ''));
		}
		return rows.sort((a, b) => (b.ended ?? 0) - (a.ended ?? 0));
	});

	/** What each rule's (or kind's) jobs are doing: running, waiting, failed and not made good. */
	const counts = $derived.by(() => {
		/** @type {Map<string, { run: number, next: number, bad: number }>} */
		const out = new Map();
		const of = (/** @type {string} */ k) => out.get(k) ?? (out.set(k, { run: 0, next: 0, bad: 0 }), /** @type {any} */ (out.get(k)));
		for (const r of nowRows) {
			if (r.state === 'running' || r.state === 'waiting') of(r.rule).run++;
			else of(r.rule).next++;
		}
		for (const r of pastRows) if (r.open) of(r.rule).bad++;
		return out;
	});
	const NONE = { run: 0, next: 0, bad: 0 };
	/** @param {string} k */
	const countOf = (k) => counts.get(k) ?? NONE;

	/** The kinds of the Mac's jobs no rule starts, those it has run or holds now. */
	const others = $derived(Object.keys(OTHER).filter((k) => [...active, ...history].some((j) => j.kind === k)));
	const byItself = BUILT_IN.filter((r) => r.when);
	const whenAsked = BUILT_IN.filter((r) => !r.when);

	/** @param {Row} r */
	const shownRow = (r) => picked === null || r.rule === picked;
	const nowShown = $derived(nowRows.filter(shownRow));
	const pastShown = $derived(pastRows.filter((r) => shownRow(r) && (stateFilter === 'all' || (stateFilter === 'failed' ? r.open : r.state === 'done'))));
	const failedShown = $derived(pastRows.filter((r) => shownRow(r) && r.open).length);

	/** The jobs done today of what is picked, and how long they took on average. */
	const today = $derived.by(() => {
		const day = new Date(now).toDateString();
		const d = pastRows.filter((r) => shownRow(r) && r.state === 'done' && r.ended && new Date(r.ended).toDateString() === day);
		const ts = d.flatMap((r) => (r.started && r.ended ? [(r.ended - r.started) / 1000] : []));
		return { n: d.length, avg: ts.length ? ts.reduce((a, b) => a + b, 0) / ts.length : null };
	});

	/** The rule picked, if a rule is picked. */
	const rule = $derived(BUILT_IN.find((r) => r.key === picked) ?? null);

	/** Each lane's running line, and how many wait for it. */
	const lanes = $derived(
		LANES.map((l) => {
			const rows = nowRows.filter((r) => r.lane === l.id);
			return { ...l, run: rows.find((r) => r.state === 'running' || r.state === 'waiting') ?? null, next: rows.filter((r) => r.state === 'queued').length };
		})
	);

	/** The vaults this Mac works for, in one line, the rest in its tooltip. */
	const worksFor = $derived.by(() => {
		const all = vaults.map((v) => v.name);
		const line = all.length > 3 ? `${all.slice(0, 2).join(', ')} and ${all.length - 2} more` : list(all);
		const each = vaults.map((v) => `${v.name}: ${v.worker ? 'this Mac is its studio worker' : v.yours ? 'not its worker yet' : 'as you, through this Mac'}`);
		return { line, title: each.join('\n') };
	});

	/** @param {number} s */
	const clock = (s) => {
		s = Math.max(0, Math.round(s));
		const h = Math.floor(s / 3600),
			m = Math.floor((s % 3600) / 60),
			r = s % 60;
		return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
	};
	/** @param {number | null} t milliseconds since 1970 */
	const since = (t) => (t ? (now - t) / 1000 : 0);
	/** Time left, from how fast it has gone so far. @param {Row} r */
	const left = (r) => {
		const t = since(r.started);
		return r.progress > 0.02 && r.progress < 1 && t > 3 ? (t / r.progress) * (1 - r.progress) : null;
	};
	/** @param {Row} r */
	const took = (r) => (r.started && r.ended ? (r.ended - r.started) / 1000 : null);
	/** @param {number} t milliseconds since 1970 */
	const when = (t) => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	/** A line's kind, as its chip names it. @param {string} k */
	const kindName = (k) => RULE_NAMES[k] ?? OTHER[k]?.name ?? k;
	/** What a past line says beside its state. @param {Row} r */
	const pastWhy = (r) => {
		if (r.state === 'done') {
			const t = took(r);
			return t !== null ? `in ${clock(t)}` : r.stage;
		}
		if (r.state === 'failed' && r.task?.status === 'failed') return `${r.error} · tries again (${r.task.attempts} of ${TRIES})`;
		return r.error || r.stage;
	};
	/** What a rule makes, in a few words. @param {import('./rules.js').Rule} r */
	const makes = (r) => r.makes.map((m) => ('value' in m ? `its ${m.value}, on the task` : `a file tagged ${m.tags.join(', ')}`)).join('; ');
	/** What a rule waits for: the rules whose work it reads. @param {import('./rules.js').Rule} r */
	const after = (r) =>
		Object.values(r.inputs)
			.flatMap((i) => (typeof i === 'object' ? [`${RULE_NAMES[i.made] ?? i.made}${i.optional ? ' (if there is one)' : ''}`] : []))
			.join(', ');
	/** Vault `v`'s name, as this Mac works for it. @param {string} v */
	const vaultName = (v) => vaults.find((x) => x.vault === v)?.name ?? short(v);
	/** @param {string} h */
	const holdWords = (h) => (h === 'ingest' ? 'Waiting for the ingest to finish' : h === 'memory' ? 'Waiting for memory' : `Uploads paused: ${h}`);
</script>

<div class="sj">
	<div class="top">
		{#if !ready}
			<span class="dim">Looking for this Mac's avenDB device…</span>
		{:else if !worker}
			<span class="dim">avenDB isn't open on this Mac yet. Open avenDB once, and its tasks show here.</span>
		{:else if vaults.length}
			<span class="dim works" title={worksFor.title}>Works for {worksFor.line}</span>
		{/if}
		{#each holds as h (h)}<span class="hold">{holdWords(h)}</span>{/each}
		{#if worker}<button class="ghost small test" disabled={adding} onclick={test}>{adding ? 'Adding…' : 'Checksum test'}</button>{/if}
	</div>
	{#if hiring}
		<p class="note dim">Making this Mac the studio worker of {vaultName(hiring)}…</p>
	{/if}
	{#if failures.length && !hiring}
		{@const same = failures.every(([, w]) => w === failures[0][1])}
		<p class="note">
			<span class="bad">
				This Mac couldn't become the worker of {same
					? `${list(failures.map(([v]) => vaultName(v)))}: ${failures[0][1]}`
					: failures.map(([v, w]) => `${vaultName(v)} (${w})`).join(', ')}
			</span>
			<button class="ghost small" onclick={() => hireAll(true)}>Try again</button>
		</p>
	{/if}
	{#if error}<p class="note bad">{error}</p>{/if}

	<div class="grid">
		<aside class="rules">
			<button class="rule" class:on={picked === null} onclick={() => (picked = null)}>
				<span class="dot all"></span><span class="nm">All jobs</span>
				<span class="ct">{#if nowRows.length}<b class="run">{nowRows.length}</b>{/if}</span>
			</button>
			{#each [{ cap: 'By themselves', rules: byItself }, { cap: 'When asked', rules: whenAsked }] as g (g.cap)}
				<p class="cap">{g.cap}</p>
				{#each g.rules as r (r.key)}
					{@const c = countOf(r.key)}
					{@const off = offIn(r.key)}
					<button class="rule" class:on={picked === r.key} class:off={off === 'all'} title={r.about} onclick={() => (picked = picked === r.key ? null : r.key)}>
						<span class="dot {r.lane}" class:live={c.run > 0}></span><span class="nm">{r.name}</span>
						<span class="ct">
							{#if off !== 'none'}<i class="offtag">{off === 'all' ? 'Off' : 'Off in some'}</i>{/if}
							{#if c.run}<b class="run">{c.run}</b>{/if}
							{#if c.next}<b>{c.next}</b>{/if}
							{#if c.bad}<b class="bad">{c.bad}</b>{/if}
						</span>
					</button>
				{/each}
			{/each}
			{#if others.length}
				<p class="cap">Other jobs</p>
				{#each others as k (k)}
					{@const c = countOf(k)}
					<button class="rule" class:on={picked === k} title={OTHER[k].about} onclick={() => (picked = picked === k ? null : k)}>
						<span class="dot {OTHER[k].lane}" class:live={c.run > 0}></span><span class="nm">{OTHER[k].name}</span>
						<span class="ct">
							{#if c.run}<b class="run">{c.run}</b>{/if}
							{#if c.next}<b>{c.next}</b>{/if}
							{#if c.bad}<b class="bad">{c.bad}</b>{/if}
						</span>
					</button>
				{/each}
			{/if}
		</aside>

		<div class="main">
			<article class="detail">
				{#if picked !== null}
					{@const c = countOf(picked)}
					{@const o = OTHER[picked]}
					<div class="dhead">
						<span class="dot {rule?.lane ?? o?.lane ?? 'all'}"></span>
						<h3>{kindName(picked)}</h3>
						<span class="kind">{LANE_NAMES[rule?.lane ?? o?.lane ?? ''] ?? ''} lane</span>
						{#if rule}<span class="kind">v{rule.version}</span>{/if}
						<span class="grow"></span>
						{#if rule && vaults.length}
							{@const off = offIn(rule.key)}
							<button
								class="switch"
								role="switch"
								aria-checked={off === 'none' ? 'true' : off === 'all' ? 'false' : 'mixed'}
								disabled={switching !== null}
								title={off === 'none' ? 'Turn it off in every vault this Mac works for' : 'Turn it on in every vault this Mac works for'}
								onclick={() => flip(rule.key)}
							>
								<i></i><span>{switching === rule.key ? '…' : off === 'none' ? 'On' : off === 'all' ? 'Off' : 'Off in some'}</span>
							</button>
						{/if}
						<button class="ghost small x" onclick={() => (picked = null)} title="Every job">×</button>
					</div>
					{#if rule}
						{@const a = after(rule)}
						<dl>
							<dt>Makes</dt><dd>{rule.about} <span class="dim">({makes(rule)})</span></dd>
							<dt>When</dt><dd>{rule.when ? 'By itself: for each entry it picks, as soon as the worker sees it' : 'When asked: by a button, an agent or a cut'}</dd>
							{#if a}<dt>After</dt><dd>{a}</dd>{/if}
							{#if offIn(rule.key) === 'some'}
								<dt>Off in</dt><dd>{list(vaults.filter((v) => v.rules[rule.key]?.rule.off).map((v) => v.name))}</dd>
							{/if}
						</dl>
					{:else if o}
						<p class="dim small">{o.about} No rule starts these: the Mac does them as they come.</p>
					{/if}
					<div class="stats">
						<span><b>{c.run}</b> running</span>
						<span><b>{c.next}</b> waiting</span>
						<span><b>{today.n}</b> done today{today.avg !== null ? ` · ${clock(today.avg)} each` : ''}</span>
						<span class:bad={c.bad > 0}><b>{c.bad}</b> failed</span>
					</div>
				{:else}
					{@const on = BUILT_IN.filter((r) => offIn(r.key) !== 'all').length}
					<div class="dhead"><span class="dot all"></span><h3>All jobs</h3></div>
					<p class="dim small">Everything this Mac works on for the vaults it works for, one job at a time in each lane: what the studio's rules want made of each vault's footage and cuts, and the files brought in. Pick a rule to see what it makes, and to turn it off.</p>
					<div class="stats">
						<span><b>{nowRows.filter((r) => r.state === 'running' || r.state === 'waiting').length}</b> running</span>
						<span><b>{nowRows.filter((r) => r.state === 'queued').length}</b> waiting</span>
						<span><b>{today.n}</b> done today</span>
						<span class:bad={failedShown > 0}><b>{failedShown}</b> failed</span>
						<span><b>{on}</b> of {BUILT_IN.length} rules on</span>
					</div>
				{/if}
			</article>

			<div class="lanes">
				{#each lanes as l (l.id)}
					{@const j = l.run}
					<div class="lane" class:busy={!!j} title={l.what}>
						<span class="dot {l.id}" class:live={!!j}></span>
						<span class="ln">{l.label}</span>
						{#if j}
							<span class="jn" class:wait={j.state === 'waiting'} title="{kindName(j.rule)} · {j.name} · {j.stage}">{j.name}</span>
							{#if j.job}<span class="pct">{Math.round(j.progress * 100)}%</span>{/if}
						{:else}<span class="jn dim">idle</span>{/if}
						{#if l.next}<span class="nx">+{l.next}</span>{/if}
						{#if j?.job}<i class="bar" style:width="{j.progress * 100}%"></i>{/if}
					</div>
				{/each}
			</div>

			{#if nowShown.length}
				<div class="block">
					<p class="cap">Now and next</p>
					<table>
						<tbody>
							{#each nowShown.slice(0, 40) as r (r.id)}
								{@const eta = left(r)}
								<tr class={r.state}>
									<td class="when">{LANE_NAMES[r.lane] ?? r.lane}</td>
									<td><span class="kind">{kindName(r.rule)}</span></td>
									<td class="name" title={r.name}><span>{r.name}</span></td>
									<td class="st">{r.state === 'queued' ? `waits ${clock(since(r.queued))}` : r.job ? `${Math.round(r.progress * 100)}%` : 'running'}</td>
									<td class="why">
										{#if r.state === 'queued'}{r.job ? '' : r.stage || 'for its worker'}{:else if r.job}{r.stage} · {clock(since(r.started ?? r.queued))}{eta !== null ? ` · ${clock(eta)} left` : ''}{:else}{r.stage}{/if}
									</td>
									<td class="acts">
										{#if r.job && r.state === 'queued'}
											<button class="ghost small" onclick={() => r.job && bump(r.job.id)} title="Run it next">↑</button>
											<button class="ghost small" onclick={() => r.job && cancel(r.job.id)} title="Take it off the queue">×</button>
										{/if}
									</td>
								</tr>
							{/each}
							{#if nowShown.length > 40}<tr><td class="dim" colspan="6">and {nowShown.length - 40} more</td></tr>{/if}
						</tbody>
					</table>
				</div>
			{/if}

			<div class="block">
				<div class="hhead">
					<p class="cap">History</p>
					<div class="filters">
						<button class:on={stateFilter === 'all'} onclick={() => (stateFilter = 'all')}>All</button>
						<button class:on={stateFilter === 'failed'} onclick={() => (stateFilter = 'failed')}>Failed{failedShown ? ` (${failedShown})` : ''}</button>
						<button class:on={stateFilter === 'done'} onclick={() => (stateFilter = 'done')}>Done</button>
					</div>
				</div>
				<table>
					<tbody>
						{#each pastShown.slice(0, 150) as r (r.id)}
							<tr class={r.state} class:mended={r.state === 'failed' && !r.open}>
								<td class="when">{r.ended ? when(r.ended) : ''}</td>
								<td><span class="kind">{kindName(r.rule)}</span></td>
								<td class="name" title={r.name}><span>{r.name}</span></td>
								<td class="st">{r.state}</td>
								<td class="why" title={r.error || r.task?.result || ''}>{pastWhy(r)}</td>
								<td class="acts">{#if r.again}<button class="ghost small" onclick={() => redo(r)}>Again</button>{/if}</td>
							</tr>
						{:else}
							<tr><td class="dim" colspan="6">Nothing yet.</td></tr>
						{/each}
						{#if pastShown.length > 150}<tr><td class="dim" colspan="6">and {pastShown.length - 150} more</td></tr>{/if}
					</tbody>
				</table>
				{#if log.length}<p class="log" title={log.slice(0, 10).join('\n')}>{log[0]}</p>{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.sj {
		container-type: inline-size;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		font-size: 0.8rem;
	}

	/* ── what this Mac works for, what holds it, the test ── */
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}

	.works {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		cursor: default;
	}

	.top .test {
		margin-left: auto;
	}

	.hold {
		padding: 0.1rem 0.55rem;
		border: 1px solid color-mix(in srgb, var(--warn, #9a6a14) 35%, transparent);
		border-radius: 999px;
		background: color-mix(in srgb, var(--warn, #9a6a14) 10%, transparent);
		font-size: 0.7rem;
		color: var(--warn, #9a6a14);
	}

	.note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		font-size: 0.76rem;
	}

	.grid {
		display: grid;
		grid-template-columns: 13rem minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}

	/* ── the rules: a line each ── */
	.rules {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0.4rem;
		border-radius: 12px;
		background: var(--card);
	}

	.cap {
		margin: 0.55rem 0 0.2rem;
		padding: 0 0.45rem;
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.rule {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		height: 1.75rem;
		padding: 0 0.45rem;
		border: 0;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 0.78rem;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.rule:hover {
		background: var(--hover);
	}

	.rule.on {
		background: var(--hover);
		box-shadow: inset 2px 0 0 var(--accent);
		font-weight: 600;
	}

	.rule.off .nm {
		color: var(--dim);
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
		align-items: center;
		gap: 0.2rem;
	}

	.ct b {
		min-width: 1.1rem;
		padding: 0 0.3rem;
		border-radius: 999px;
		background: var(--hover);
		font-size: 0.64rem;
		font-weight: 600;
		text-align: center;
		color: var(--soft);
	}

	.ct b.run {
		background: var(--accent);
		color: #fff;
	}

	.ct b.bad {
		color: var(--bad);
	}

	.offtag {
		font-size: 0.64rem;
		font-style: normal;
		font-weight: 400;
		color: var(--dim);
	}

	/* a lane's colour, on its rules and in the strip */
	.dot {
		flex: none;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--dim);
		opacity: 0.6;
	}

	.dot.gpu { background: #3f78cf; }
	.dot.speech { background: #8458d0; }
	.dot.ai { background: #c98a16; }
	.dot.io { background: #23906c; }
	.dot.net { background: #c2507a; }
	.dot.all { background: var(--soft); }

	.dot.live {
		opacity: 1;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
	}

	/* ── the main column ── */
	.main {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		min-width: 0;
	}

	/* the rule picked, described */
	.detail {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0.75rem 0.9rem;
		border-radius: 12px;
		background: var(--card);
	}

	.dhead {
		display: flex;
		flex-wrap: wrap;
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
		font-size: 0.95rem !important;
		font-weight: 600;
		letter-spacing: 0 !important;
		text-transform: none;
		color: inherit;
	}

	.grow {
		flex: 1;
	}

	/* one switch for every vault this Mac works for */
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.74rem;
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
		background: var(--ok);
	}

	.switch[aria-checked='true'] i::after {
		transform: translateX(0.8rem);
	}

	.switch[aria-checked='mixed'] i {
		background: color-mix(in srgb, var(--ok) 45%, rgb(0 0 0 / 0.18));
	}

	.switch[aria-checked='mixed'] i::after {
		transform: translateX(0.4rem);
	}

	.switch:disabled {
		cursor: default;
		opacity: 0.6;
	}

	dl {
		display: grid;
		grid-template-columns: 3.6rem 1fr;
		gap: 0.25rem 0.8rem;
		margin: 0;
	}

	dt {
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		line-height: 1.7;
		text-transform: uppercase;
		color: var(--dim);
	}

	dd {
		margin: 0;
		line-height: 1.45;
	}

	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.2rem;
		padding-top: 0.45rem;
		border-top: 1px solid var(--edge);
		color: var(--soft);
	}

	.stats b {
		font-variant-numeric: tabular-nums;
		color: #1f2a23;
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
		border-radius: 8px;
		background: var(--card);
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
		color: var(--soft);
	}

	.jn.wait {
		color: var(--warn, #9a6a14);
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

	.block > .cap,
	.hhead .cap {
		margin: 0 0 0.3rem;
		padding: 0;
	}

	.hhead {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.filters {
		display: flex;
		gap: 0.25rem;
		margin-bottom: 0.3rem;
	}

	.filters button {
		padding: 0.05rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: var(--card);
		font: inherit;
		font-size: 0.7rem;
		color: var(--soft);
		cursor: pointer;
	}

	.filters button.on {
		border-color: var(--accent);
		color: inherit;
		font-weight: 600;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		border-radius: 12px;
		background: var(--card);
		overflow: hidden;
		font-size: 0.76rem;
	}

	td {
		padding: 0.3rem 0.5rem;
		border-top: 1px solid var(--edge);
		vertical-align: middle;
	}

	tr:first-child td {
		border-top: 0;
	}

	td.when {
		width: 6.5rem;
		white-space: nowrap;
		color: var(--dim);
	}

	td.name {
		font-weight: 500;
	}

	td.name span {
		display: block;
		max-width: 16rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	td.st {
		white-space: nowrap;
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

	td.acts {
		width: 4rem;
		text-align: right;
		white-space: nowrap;
	}

	.kind {
		flex: none;
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		background: var(--hover);
		font-size: 0.66rem;
		white-space: nowrap;
		color: var(--soft);
	}

	tr.done .st {
		color: var(--ok);
	}

	tr.running .st {
		color: var(--accent);
	}

	tr.waiting .st,
	tr.waiting .why {
		color: var(--warn, #9a6a14);
	}

	tr.failed .st,
	tr.failed .why,
	tr.held .st,
	tr.held .why {
		color: var(--bad);
	}

	/* a failure made good since: the task ran again */
	tr.mended td {
		opacity: 0.55;
	}

	tr.mended .st,
	tr.mended .why,
	tr.cancelled .st,
	tr.queued .st {
		color: var(--dim);
	}

	.dim,
	.log {
		color: var(--dim);
	}

	.bad {
		color: var(--bad);
	}

	.small {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.45;
	}

	.log {
		margin: 0.4rem 0 0;
		font-size: 0.7rem;
	}

	/* narrow: the rules above, two to a row, the lanes two by two */
	@container (max-width: 720px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}

		.rules {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		}

		.rules .cap {
			grid-column: 1 / -1;
		}

		.lanes {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		td.name span {
			max-width: 9rem;
		}
	}

	@container (max-width: 520px) {
		td.when,
		td.why {
			display: none;
		}
	}
</style>
