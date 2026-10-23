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

/** how long a count that pulls from no peer may stand still and still count as syncing (ms) */
const STILL = 30000;

/**
 * What the device said last: `known` once it answered (a device too old for the op never does), the counts, since
 * when they stand (`since`, ms) as of its last answer (`at`), and when its last page of edits came (`paged`, ms; 0
 * for none since the page watched). A log counts only once whole, and a page brings edits of many, so on a big vault
 * the logs stand still for minutes while the pages show the pull moving (Samuel's iPhone 2026-10-21, "it says it
 * syncs but somehow it doesn't").
 */
export const sync = $state({ known: false, peers: 0, logs: 0, behind: 0, pulling: 0, pages: 0, since: 0, at: 0, paged: 0 });

/** Whether the device still brings what its peers hold: behind them, and pulling, or its count moved lately. */
export const syncing = () => sync.known && sync.behind > 0 && sync.logs > 0 && (sync.pulling > 0 || sync.at - sync.since < STILL);

/** How much of what its peers hold the device holds, from 0 to 1. */
export const share = () => (sync.logs > 0 ? Math.max(0, sync.logs - sync.behind) / sync.logs : 1);

/**
 * Asks the device the page holds open how far it synced, and again as that changes, until the function returned stops it.
 * Unknown again while avenDB is closed, or for a device whose avenDB knows no `synced`.
 */
export function watchSync() {
	let stop = false;
	const ask = async (signal) => {
		const got = session.phase === 'open' ? await session.ask({ op: 'synced' }).catch(() => null) : null;
		if (stop || signal.aborted) return;
		if (!got?.ok) return void (sync.known = false);
		const at = Date.now();
		const paged = sync.known && (got.ok.pages ?? 0) > sync.pages;
		const moved = !sync.known || paged || got.ok.behind !== sync.behind || got.ok.logs !== sync.logs;
		Object.assign(sync, { known: true, pages: 0, ...got.ok, at, since: moved ? at : sync.since, paged: paged ? at : sync.paged });
	};
	const unwatch = onStir(ask);
	return () => {
		stop = true;
		unwatch();
		Object.assign(sync, { known: false, paged: 0 });
	};
}
