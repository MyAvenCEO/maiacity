// @ts-nocheck — plain JS
/**
 * What a page says of a read's freshness (avendb/spec/AvenDB/Freshness.lean, game/code/sources/coverage.js
 * `freshnessOf`), and what an action (approve, accept, decline, delete) may do with it: one wording and one guard for
 * every page, query, schema and type. Shown by ./Fresh.svelte (the badge) and ./ActGuard.svelte (the guard's line).
 */
import { actOf, opensOn, showsFinal } from '../../../game/code/sources/coverage.js';

export { actOf, opensOn, showsFinal };

const n = (x) => x.toLocaleString('en');
const at = (ms) => {
	const d = new Date(ms);
	const today = new Date().toDateString() === d.toDateString();
	return today
		? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
		: d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** The badge's words: nothing while current. @param {ReturnType<import('../../../game/code/sources/coverage.js').freshnessOf>} f */
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

/** What an action says beside its buttons: why it waits, or that it acts on data as of then.
 * @param {ReturnType<import('../../../game/code/sources/coverage.js').freshnessOf>} f */
export function actionLine(f) {
	const a = actOf(f);
	if (a === 'wait') return 'This device is catching up on this. Answering waits until it holds the latest.';
	if (a === 'confirm') return f.asOf
		? `This device is offline. You would act on what it held as of ${at(f.asOf)}.`
		: 'This device is offline and has not synced with a peer yet. You would act on what it holds.';
	return '';
}

/** Whether an action may run now: on current data, or offline once the person said they act on data as of then.
 * @param {ReturnType<import('../../../game/code/sources/coverage.js').freshnessOf>} f @param {boolean} confirmed */
export const mayAct = (f, confirmed) => opensOn(f, confirmed);

const RANK = { current: 0, offline: 1, behind: 2 };
/** The freshness of what several reads show together: behind if any is, offline if any is, else current. */
export const worst = (...fs) => fs.filter(Boolean).reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a), { state: 'current', asOf: 0, logs: 0, waits: 0, unheard: 0 });
