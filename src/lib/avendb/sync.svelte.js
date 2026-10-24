// @ts-nocheck — plain JS, kept loose on purpose
/**
 * HOW FAR avenDB HAS SYNCED (Samuel 2026-10-20), for every app page: what the device the page holds open said last of
 * the logs its live peers hold (avendb's `synced` op: `{ peers, logs, behind, pulling, pages }`), asked again each time the
 * device says what it shows changed (./stirs.js), never on a timer, by the app's status pill ($lib/app/StatusPill.svelte) while avenDB is
 * open. Games, sandboxes and the asset viewers read their code off this device once it holds Maia City
 * (game/code/sources/device.js), so this is what such a page waits for, and the pill says so.
 */
import { session } from './session.svelte.js';
import { onStir } from './stirs.svelte.js';
import { emptySync, observeSync, missingUpdates, peerCoverage } from './sync-status.js';

/**
 * What the device said last: `known` once it answered (a device too old for the op never does), the counts, since
 * when they stand (`since`, ms) as of its last answer (`at`), and when its last page of edits came (`paged`, ms; 0
 * for none since the page watched). A log counts only once whole, and a page brings edits of many, so on a big vault
 * the logs stand still for minutes while the pages show the pull moving (Samuel's iPhone 2026-10-21, "it says it
 * syncs but somehow it doesn't").
 */
export const sync = $state(emptySync());

/** Missing peer updates remain missing while requests wait or stop. */
export const syncing = () => missingUpdates(sync);

/** Relative coverage of announced peer logs only; unknown is never a claim of completion. */
export const share = () => peerCoverage(sync) ?? 0;

/**
 * Asks the device the page holds open how far it synced, and again as that changes, until the function returned stops it.
 * Unknown again while avenDB is closed, or for a device whose avenDB knows no `synced`.
 */
export function watchSync() {
	Object.assign(sync, emptySync());
	let stop = false;
	const ask = async (signal) => {
		const got = session.phase === 'open' ? await session.ask({ op: 'synced' }).catch(() => null) : null;
		if (stop || signal.aborted) return;
		if (!got?.ok) return void (sync.known = false);
		Object.assign(sync, observeSync(sync, got.ok, Date.now()));
	};
	const unwatch = onStir(ask);
	return () => {
		stop = true;
		unwatch();
		Object.assign(sync, emptySync());
	};
}
