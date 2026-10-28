/** Peer-frontier observations, not a disk-save or file-download progress meter.
 * @typedef {{ since: number, stage: string, took: number }} Pull
 * @typedef {{ device: string, name: string | null, pulling: Pull | null, pages: number, edits: number, last: number, askings: number, failed: number }} From
 * @typedef {{ log: unknown, held: unknown, lacked_heads: unknown, waiting: unknown }} LackedLog
 * @typedef {{ device: unknown, lacks: unknown, by_stub: unknown, stubs: unknown, sample: LackedLog[] }} Lacked
 * @typedef {{ peers: number, logs: number, behind: number, pulling: number, pages: number, edits: number, from: From[], lacked: Lacked[] }} PeerCounts
 * @typedef {PeerCounts & { known: boolean, since: number, at: number, paged: number, base: number }} SyncState
 */
/** @param {unknown} value */
const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
/** @param {number} value */
const n = (value) => value.toLocaleString('en');

/** One peer as the device tells it (avendb's `synced` op, `from`): whether a pull of it runs, what it does, the edits
 * it took, and when its last page came (ms since 1970, the device's clock as `Date.now()`). @param {any} p @returns {From} */
const peer = (p) => ({
	device: typeof p?.device === 'string' ? p.device : '', name: typeof p?.name === 'string' && p.name ? p.name : null,
	pulling: p?.pulling && typeof p.pulling === 'object'
		? { since: count(p.pulling.since), stage: typeof p.pulling.stage === 'string' ? p.pulling.stage : '', took: count(p.pulling.took) } : null,
	pages: count(p?.pages), edits: count(p?.edits), last: count(p?.last), askings: count(p?.askings), failed: count(p?.failed)
});
/** What of the pulls running moves without a log or a page: their stage and the edits they took. A failed asking is
 * no movement. @param {From[]} from */
const pulls = (from) => from.map((p) => p.pulling ? `${p.device}:${p.pulling.stage}:${p.pulling.took}` : '').join('|');

/** A pull is a transfer while it brings pages: its last page, or its start before any came, within `STALL` of `now`.
 * One that runs on and brings nothing, its askings failing or coming back empty, is stalled, not a transfer.
 * @param {From} p @param {number} now */
export const taking = (p, now) => !!p.pulling && now - Math.max(p.last, p.pulling.since) < STALL;

/** A new view/device starts its own observation window; native cumulative counters may already be large. */
export const emptySync = () => ({ known: false, peers: 0, logs: 0, behind: 0, pulling: 0, pages: 0, edits: 0, from: [], lacked: [], since: 0, at: 0, paged: 0, base: 0 });

/** @param {SyncState} previous @param {Partial<PeerCounts>} report @param {number} at */
export function observeSync(previous, report, at) {
	const next = {
		peers: count(report.peers), logs: count(report.logs), behind: count(report.behind), pulling: count(report.pulling), pages: count(report.pages),
		edits: count(report.edits), from: Array.isArray(report.from) ? report.from.map(peer) : [],
		/** what the device says it lacks of each peer, as it said it, for the diagnostics report to project
		 * (`diagnosticSnapshot`); the pill reads none of it */
		lacked: Array.isArray(report.lacked) ? report.lacked : []
	};
	const reset = !previous.known || next.pages < previous.pages || next.edits < previous.edits;
	const paged = !reset && next.pages > previous.pages;
	const moved = reset || paged || next.edits !== previous.edits || next.behind !== previous.behind || next.logs !== previous.logs
		|| pulls(next.from) !== pulls(previous.from);
	return {
		...next, known: true, at, since: moved ? at : previous.since, paged: paged ? at : reset ? 0 : previous.paged,
		base: reset ? next.edits : previous.base
	};
}

/** Unknown, disconnected, empty and inconsistent snapshots cannot establish complete coverage.
 * @param {SyncState} sync */
export function peerCoverage(sync) {
	if (!sync.known || sync.peers <= 0 || sync.logs <= 0 || sync.behind > sync.logs) return null;
	return (sync.logs - sync.behind) / sync.logs;
}

/** Missing work remains missing when requests stop or time passes. @param {SyncState} sync */
export const missingUpdates = (sync) => sync.known && sync.behind > 0;

/** @param {SyncState} sync */
export function peerStatus(sync) {
	const fraction = peerCoverage(sync);
	if (!sync.known) return {
		active: sync.at > 0 && (sync.behind > 0 || sync.pulling > 0), fraction: null,
		label: 'Peer status unavailable',
		details: [sync.at > 0 && sync.behind > 0
			? `Last report: ${n(sync.behind)} logs needed updates; current peer status is unavailable.`
			: 'Peer update status is not available yet.']
	};
	const requests = `${n(sync.pulling)} active sync ${sync.pulling === 1 ? 'request' : 'requests'}`;
	const peers = `${n(sync.peers)} connected ${sync.peers === 1 ? 'peer' : 'peers'}`;
	const label = sync.behind > 0
		? `${sync.pulling > 0 ? 'Syncing' : 'Waiting for peers'} · receiving ${n(sync.behind)} ${sync.behind === 1 ? 'log' : 'logs'}`
		: sync.pulling > 0 ? 'Checking peer updates'
			: sync.peers === 0 ? 'Peer status unknown · offline'
				: sync.logs === 0 ? 'Waiting for peer announcements' : 'Incoming logs current · sharing unverified';
	const details = [sync.behind > 0
		? `${n(sync.behind)} announced ${sync.behind === 1 ? 'log needs' : 'logs need'} updates; ${requests}.`
		: sync.pulling > 0 ? `${requests}; checking for peer updates.` : label + '.'];
	if (fraction !== null) details.push(`${n(sync.logs - sync.behind)} of ${n(sync.logs)} announced peer logs currently covered (${Math.floor(100 * fraction)}%) across ${peers}.`);
	else if (sync.peers > 0) details.push(`Comparing announcements from ${peers}.`);
	if (sync.behind > 0 || sync.pulling > 0) details.push(sync.paged
		? `Last new transfer page observed ${ago(Math.max(0, sync.at - sync.paged))}.`
		: 'No new transfer page observed since this view started watching.');
	details.push('Outgoing entries: acknowledgment unavailable. Required files: completeness unavailable.');
	details.push('Peer log coverage does not measure local disk saves or file downloads. New announcements may change coverage without deleting local data.');
	return { active: sync.behind > 0 || sync.pulling > 0, fraction, label, details };
}

/** How long nothing may move before the pill says what it waits on (ms). */
export const STALL = 5000;

/** A peer by its name, or its device's first eight hex. @param {From} p */
const named = (p) => p.name ?? (p.device.slice(0, 8) || 'a peer');

/**
 * What the pill says while a sync runs, as of `now` (ms), ticking with it (Samuel 2026-10-28: "with zero visible
 * feedback the syncing UI doesn't reflect what is actually happening in real time"): a log counts only once whole, so
 * on a big vault the logs stand still for minutes while edits come in. So it tells the edits taken since this view
 * watched, from which peer, when the last page came, and, once nothing moved for `STALL`, which peer it waits on and
 * for how long. A pull counts as a transfer only while it brings pages (`taking`), and the askings whose pages never
 * came are counted apart. Null while no sync runs.
 * @param {SyncState} sync @param {number} now
 * @returns {null | { line: string, stalled: boolean, who: string, wait: number, last: number, taken: number, moving: number, failed: number, rows: [string, string][] }}
 */
export function liveSync(sync, now) {
	if (!sync.known || (sync.behind <= 0 && sync.pulling <= 0)) return null;
	const running = sync.from.filter((p) => p.pulling);
	/** the peers it waits on: those it pulls from, else every peer it hears */
	const on = running.length ? running : sync.from;
	const who = on.length ? on.map(named).join(', ') : 'peers';
	const last = Math.max(sync.paged, ...sync.from.map((p) => p.last));
	const moved = Math.max(sync.since, last);
	/** since when it waits: a running pull's last page or its start, the latest of them; else the last thing that moved */
	const from = running.length ? Math.max(...running.map((p) => Math.max(p.last, p.pulling?.since ?? 0))) : moved;
	const stalled = moved > 0 && now - moved >= STALL;
	const wait = Math.max(0, now - (stalled ? from : moved));
	const taken = Math.max(0, sync.edits - sync.base);
	const moving = running.filter((p) => taking(p, now)).length;
	const failed = sync.from.reduce((sum, p) => sum + p.failed, 0);
	const covered = Math.max(0, sync.logs - sync.behind);
	const line = stalled ? `Waiting on ${who} · ${long(wait)}`
		: `Syncing${sync.behind > 0 ? ` ${n(covered)}/${n(sync.logs)}` : ''}${taken > 0 ? ` · +${n(taken)} edits` : ''}`;
	/** @type {[string, string][]} */
	const rows = running.map((p) => [named(p), [taking(p, now) ? p.pulling?.stage || 'pulling' : 'stalled', `${n(p.pulling?.took ?? 0)} edits`,
		p.last ? `page ${ago(Math.max(0, now - p.last))}` : 'no page yet', ...(p.failed ? [`${n(p.failed)} failed`] : [])].join(' · ')]);
	if (running.length) rows.unshift(['Transfers', `${n(moving)} taking${running.length > moving ? ` · ${n(running.length - moving)} stalled` : ''}`]);
	if (failed) rows.push(['Failed askings', `${n(failed)} of ${n(sync.from.reduce((sum, p) => sum + p.askings, 0))}`]);
	rows.push(['Edits taken', taken > 0 ? `${n(sync.edits)} (+${n(taken)} now)` : n(sync.edits)]);
	rows.push(['Last page', last > 0 ? ago(Math.max(0, now - last)) : 'none yet']);
	if (stalled) rows.push(['Waiting on', `${who} for ${long(wait)}`]);
	return { line, stalled, who, wait, last, taken, moving, failed, rows };
}

/** @param {number} ms */
const long = (ms) => ms < 60000 ? `${Math.floor(ms / 1000)} s` : ms < 7200000 ? `${Math.floor(ms / 60000)} min` : `${Math.floor(ms / 3600000)} h`;

/** @param {number} ms */
const ago = (ms) => ms < 2000 ? 'just now' : ms < 120000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`;
