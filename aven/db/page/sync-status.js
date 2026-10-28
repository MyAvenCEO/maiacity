/** Peer-frontier observations, not a disk-save or file-download progress meter.
 * @typedef {{ peers: number, logs: number, behind: number, pulling: number, pages: number }} PeerCounts
 * @typedef {PeerCounts & { known: boolean, since: number, at: number, paged: number }} SyncState
 */
/** @param {unknown} value */
const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
/** @param {number} value */
const n = (value) => value.toLocaleString('en');

/** A new view/device starts its own observation window; native cumulative counters may already be large. */
export const emptySync = () => ({ known: false, peers: 0, logs: 0, behind: 0, pulling: 0, pages: 0, since: 0, at: 0, paged: 0 });

/** @param {SyncState} previous @param {Partial<PeerCounts>} report @param {number} at */
export function observeSync(previous, report, at) {
	const next = { peers: count(report.peers), logs: count(report.logs), behind: count(report.behind), pulling: count(report.pulling), pages: count(report.pages) };
	const reset = !previous.known || next.pages < previous.pages;
	const paged = !reset && next.pages > previous.pages;
	const moved = reset || paged || next.behind !== previous.behind || next.logs !== previous.logs;
	return { ...next, known: true, at, since: moved ? at : previous.since, paged: paged ? at : reset ? 0 : previous.paged };
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

/** @param {number} ms */
const ago = (ms) => ms < 2000 ? 'just now' : ms < 120000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60000)} min ago`;
