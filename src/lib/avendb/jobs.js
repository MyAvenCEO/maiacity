/*
 * The one shape of a job (Samuel 2026-10-19: one jobs interface, under the hood and on the page). Whatever does the
 * work, the Jobs view (./Jobs.svelte) reads a `Job`:
 *
 * - a sync of this device: a file brought in or kept whole, edits taken from a peer (avendb-net's `jobs`);
 * - a task of a studio rule, as the vault holds it (../studio/jobs/tasks.js): the task is the truth of where it
 *   stands, the Mac's lane only how far a running one has got (vault/app/src/jobs.rs, subject `aven:<task>`);
 * - a job of the Mac's that no rule starts: a card brought in, a file kept on this Mac.
 *
 * Everything here is pure: the view, its tests and an agent read the same.
 */

import { BUILT_IN } from '../studio/jobs/rules.js';
import { TRIES } from '../studio/jobs/tasks.js';

/** @typedef {import('../studio/jobs/tasks.js').Task} Task */
/**
 * A job as avenDB's device tells it: `done` of `total` `unit`s (`total` 0 while it doesn't know), `vaults` and
 * `entries` what it is about, each with how many of its units are theirs; times in milliseconds.
 * @typedef {{ id: string, kind: 'bring' | 'keep' | 'pull', subject: string, name: string,
 *   state: 'running' | 'done' | 'failed', stage: string, done: number, total: number, unit: string,
 *   started: number, ended: number | null, error: string | null, vaults?: Record<string, number>,
 *   entries?: Record<string, number> }} SyncJob
 */
/**
 * A job as the Mac's lanes tell it (jobs.rs `Job`), times as ISO strings.
 * @typedef {{ id: string, kind: string, lane: string, subject: string, name: string,
 *   state: 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled', stage: string, progress: number,
 *   priority: number, queued: string, started: string | null, ended: string | null, error: string | null }} MacJob
 */
/**
 * Where a job is: waiting its turn, running, done, failed (a task tries again by itself), or held for a person.
 * @typedef {'queued' | 'running' | 'done' | 'failed' | 'held'} State
 */
/**
 * One job. `kind` names what it is (`KINDS`, or a studio rule's key); `vault` the vault it is about (`null`: this
 * Mac's own); `progress` 0 to 1, `null` while it doesn't know; `amount` how much it moved, in words; times in
 * milliseconds; `again` whether a person may ask it again, `stop` and `front` whether its lane lets it be stopped or
 * moved to the front.
 * @typedef {{ id: string, kind: string, lane: string, name: string, vault: string | null, state: State, stage: string,
 *   progress: number | null, amount: string, queued: number, started: number | null, ended: number | null,
 *   error: string, again: boolean, stop: boolean, front: boolean, subject: string,
 *   sync: SyncJob | null, task: Task | null, mac: MacJob | null }} Job
 */

/** The lanes jobs run in, one job at a time in each of the Mac's; syncing beside them. */
export const LANES = /** @type {const} */ ([
	{ id: 'gpu', label: 'GPU', what: 'proxies, stills, world proxies, renders' },
	{ id: 'speech', label: 'Speech', what: 'transcripts' },
	{ id: 'ai', label: 'AI', what: 'shot analyses and hero frames' },
	{ id: 'io', label: 'Disk & line', what: 'probes, imports, files kept, pages from the web' },
	{ id: 'sync', label: 'Sync', what: 'files brought in and kept whole, edits from your other devices' }
]);

/**
 * Every kind of job that is not a studio rule, by its key: its name, its group in the list of kinds, and what it is.
 * @type {Record<string, { name: string, group: string, about: string }>}
 */
export const KINDS = {
	bring: { name: 'Bringing in', group: 'Sync', about: 'Files brought into this device’s store, sealed as their bytes come.' },
	keep: { name: 'Keeping', group: 'Sync', about: 'Files kept whole on this device, their pieces fetched from the peers that hold them.' },
	pull: { name: 'Taking', group: 'Sync', about: 'Edits a peer holds for this device, asked for page by page and taken.' },
	'mac:ingest': { name: 'Imports', group: 'This Mac', about: 'Files brought into avenDB: dropped on the app, from a card or a drive.' },
	'mac:keep': { name: 'Keeping on this Mac', group: 'This Mac', about: 'Files this Mac or a drive keeps, fetched and pinned, or let go of.' }
};

/** The studio rule each kind of the Mac's jobs does, as aven.rs `studio_job` maps them. */
const MAC_RULE = /** @type {Record<string, string>} */ ({ sound: 'probe', proxy: 'proxy', still: 'still', transcript: 'transcript', analysis: 'analysis', render: 'render', frame: 'frame', 'world-proxy': 'world-proxy', fetch: 'youtube' });

/** The name of kind `kind`: a studio rule's, or one of `KINDS`. @param {string} kind */
export const kindName = (kind) => BUILT_IN.find((r) => r.key === kind)?.name ?? KINDS[kind]?.name ?? kind;

/** @param {string | null | undefined} iso */
const ms = (iso) => (iso ? Date.parse(iso) : null);

/**
 * A sync of this device as a job, about vault `vault`; `amount` says what it moved.
 * @param {SyncJob} j @param {string} vault @param {(j: SyncJob, n: number) => string} amount
 * @returns {Job}
 */
export function syncJob(j, vault, amount) {
	const moved = j.kind === 'pull' ? amount(j, j.vaults?.[vault] ?? 0) : j.total > 0 ? `${amount(j, j.done)} of ${amount(j, j.total)}` : amount(j, j.done);
	return {
		id: `sync:${j.id}`,
		kind: j.kind,
		lane: 'sync',
		name: j.name,
		vault,
		state: j.state,
		stage: j.stage,
		progress: j.total > 0 ? Math.min(1, j.done / j.total) : null,
		amount: moved,
		queued: j.started,
		started: j.started,
		ended: j.ended,
		error: j.error ?? '',
		again: false,
		stop: false,
		front: false,
		subject: j.subject,
		sync: j,
		task: null,
		mac: null
	};
}

/**
 * The studio's jobs: every task (the truth of where it stands), with the Mac's lane job that runs it, if one does;
 * then the Mac's jobs that no task asked for. `now` in milliseconds; `named` an entry's title; `on` where a device
 * runs a task ("on this Mac", "on Samuel’s MacBook").
 * @param {Task[]} tasks @param {MacJob[]} active @param {MacJob[]} history @param {number} now
 * @param {(entry: string) => string} named @param {(device: string) => string} on
 * @returns {Job[]}
 */
export function studioJobs(tasks, active, history, now, named, on) {
	/** @type {Map<string, MacJob>} the lane job running each task, by task */
	const running = new Map(active.filter((j) => j.subject.startsWith('aven:')).map((j) => [j.subject.slice(5), j]));
	const s = now / 1000;
	/** @type {Job[]} */
	const out = tasks.map((t) => {
		const mac = running.get(t.entry) ?? null;
		const claimed = t.status === 'claimed' && t.lease_until >= s;
		/** @type {State} */
		let state = t.status === 'done' ? 'done' : t.status === 'held' ? 'held' : t.status === 'failed' ? 'failed' : claimed || mac?.state === 'running' ? 'running' : 'queued';
		let stage = '';
		if (mac) stage = mac.stage;
		else if (claimed) stage = on(t.worker);
		else if (t.status === 'claimed') stage = 'its last run stopped answering: next in line again';
		else if (t.status === 'failed') stage = `tries again (${t.attempts} of ${TRIES})`;
		if (mac?.state === 'waiting') state = 'queued';
		const at = t.at * 1000;
		return {
			id: `task:${t.entry}`,
			kind: t.rule,
			lane: t.lane === 'net' ? 'io' : t.lane,
			name: named(t.inputs[0]?.entry ?? '') || t.inputs[0]?.entry.slice(0, 12) || t.entry.slice(0, 12),
			vault: t.vault,
			state,
			stage,
			progress: mac ? mac.progress : null,
			amount: t.status === 'done' ? made(t) : '',
			queued: ms(mac?.queued) ?? at,
			started: ms(mac?.started) ?? (claimed ? at : null),
			ended: state === 'done' || state === 'failed' || state === 'held' ? at : null,
			error: t.error,
			again: t.status === 'failed' || t.status === 'held',
			stop: false,
			front: !!mac && mac.state !== 'running',
			subject: t.entry,
			sync: null,
			task: t,
			mac
		};
	});
	// the Mac's own jobs no task asked for (a card brought in, a file kept): its lanes are their truth
	const seen = new Set();
	for (const j of [...active, ...history]) {
		if (j.subject.startsWith('aven:') || seen.has(j.id + (j.ended ?? ''))) continue;
		seen.add(j.id + (j.ended ?? ''));
		const finished = ['done', 'failed', 'cancelled'].includes(j.state);
		/** @type {State} */
		const state = j.state === 'cancelled' ? 'failed' : j.state === 'waiting' ? 'queued' : /** @type {State} */ (j.state);
		out.push({
			id: `mac:${j.id}${j.ended ?? ''}`,
			kind: MAC_RULE[j.kind] ?? `mac:${j.kind}`,
			lane: j.lane,
			name: j.name || j.subject.slice(0, 12),
			vault: null,
			state,
			stage: j.stage,
			progress: finished ? null : j.progress,
			amount: '',
			queued: ms(j.queued) ?? 0,
			started: ms(j.started),
			ended: ms(j.ended),
			error: j.state === 'cancelled' ? 'Stopped' : (j.error ?? ''),
			again: finished && j.state !== 'done' && !['render', 'frame', 'ingest', 'fetch'].includes(j.kind),
			stop: !finished,
			front: j.state === 'queued' || j.state === 'waiting',
			subject: j.subject,
			sync: null,
			task: null,
			mac: j
		});
	}
	return out;
}

/** What a done task made, in a few words. @param {Task} t */
function made(t) {
	try {
		const r = JSON.parse(t.result || 'null');
		if (r?.blake3) return Object.values(r.blake3).map((h) => String(h).slice(0, 16)).join(' ');
	} catch {}
	return t.outputs.length ? `${t.outputs.length} made` : 'done';
}

/** Whether job `j` still runs or waits. @param {Job} j */
export const live = (j) => j.state === 'running' || j.state === 'queued';
/** Whether job `j` needs a person: failed for good or held. @param {Job} j */
export const stuck = (j) => j.state === 'held' || (j.state === 'failed' && !j.task);

/**
 * The jobs in the order they are shown: what runs, then what waits (each lane's most urgent, then the oldest), then
 * what ended, the newest first.
 * @param {Job[]} jobs
 */
export function ordered(jobs) {
	const rank = (/** @type {Job} */ j) => (j.state === 'running' ? 0 : j.state === 'queued' ? 1 : 2);
	return [...jobs].sort((a, b) => rank(a) - rank(b) || (rank(a) < 2 ? a.queued - b.queued : (b.ended ?? 0) - (a.ended ?? 0)));
}
