// @ts-nocheck — plain JS
/**
 * What a page says of a read's freshness (aven/db/spec/AvenDB/Freshness.lean, maia/content/game/code/sources/coverage.js
 * `freshnessOf`), and what an action (approve, accept, decline, delete) says beside it: one wording for every page,
 * query, schema and type. Shown by the app's one sync pill (maia/site/lib/app/StatusPill.svelte) and ./AsOf.svelte (an
 * action's line). Never a gate: an
 * action goes on what the device holds (local first).
 */
import { opensOn, showsFinal } from '../../../maia/content/game/code/sources/coverage.js';

export { opensOn, showsFinal };

const n = (x) => x.toLocaleString('en');
const at = (ms) => {
	const d = new Date(ms);
	const today = new Date().toDateString() === d.toDateString();
	return today
		? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
		: d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** The view's freshness in words, the sync pill's "This view" row: nothing while current. @param {ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf>} f */
export function freshLine(f) {
	if (f.reading) return f.state === 'offline'
		? `Offline · reading this view’s entries on this device${f.asOf ? `, as of ${at(f.asOf)}` : ''}`
		: 'Catching up · reading this view’s entries on this device';
	if (f.state === 'offline') return f.asOf ? `Offline · as of ${at(f.asOf)}` : 'Offline · not synced with a peer yet';
	if (f.state !== 'behind') return '';
	if (f.logs) return `Catching up · ${n(f.logs)} ${f.logs === 1 ? 'log' : 'logs'} left for this view`;
	if (f.waits) return `Catching up · ${n(f.waits)} still arriving`;
	return 'Catching up · waiting to hear from a peer';
}

/** The sync pill's short line for the view on screen (maia/site/lib/app/StatusPill.svelte, the page's one sync UI):
 * what it still lacks, while it does; nothing while current or offline, which the pill says of the device.
 * @param {ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf> | null} f */
export function viewPill(f) {
	if (!f || f.state === 'offline') return '';
	if (f.reading) return 'Reading this view on this device';
	if (f.state !== 'behind') return '';
	if (f.logs) return `This view · ${n(f.logs)} ${f.logs === 1 ? 'log' : 'logs'} left`;
	if (f.waits) return `This view · ${n(f.waits)} still arriving`;
	return 'This view · waiting to hear from a peer';
}

/** What an action says beside its buttons: what it acts on, as of when; nothing on current data. It never waits.
 * @param {ReturnType<import('../../../maia/content/game/code/sources/coverage.js').freshnessOf>} f */
export function actionLine(f) {
	if (f.state === 'behind') return 'This device is still catching up on this: an answer goes on what it holds now and syncs on.';
	if (f.state === 'offline') return f.asOf
		? `This device is offline: an answer goes on what it held as of ${at(f.asOf)} and syncs once a peer is back.`
		: 'This device is offline and has not synced with a peer yet: an answer goes on what it holds.';
	return '';
}

const RANK = { current: 0, offline: 1, behind: 2 };
/** The freshness of what several reads show together: behind if any is, offline if any is, else current. */
export const worst = (...fs) => fs.filter(Boolean).reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a), { state: 'current', asOf: 0, logs: 0, waits: 0, unheard: 0 });
