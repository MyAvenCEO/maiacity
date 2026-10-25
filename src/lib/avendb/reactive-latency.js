import { latencyJournal } from './latency-journal.js';

/** One local subscription clock, spanning empty/refused replies and revisions.
 * Records first valid result (including empty) and first nonempty result separately,
 * after the consumer callback returns, not after paint. No query, entry,
 * payload, route or peer identity is retained. Read-only rows may be useful but
 * do not prove bootstrap origin, write authority or query completeness.
 * @param {any} query
 * @param {{now?: () => number, journal?: Pick<typeof latencyJournal, 'record'>}} [options]
 */
export function beginReactiveTiming(query, { now = () => performance.now(), journal = latencyJournal } = {}) {
 const kind = ['query', 'entry_views'].includes(query?.op) ? query.op : null;
 const start = now();
 let measured = false;
 let answered = false;
 return (/** @type {any} */ answer) => {
  const rows = answer?.ok?.rows;
  if (!kind || !Array.isArray(rows)) return;
  if (!answered) {
   answered = true;
   journal.record(`${kind}.first-result-emission`, Math.max(0, now() - start));
  }
  if (measured || !rows.length) return;
  measured = true;
  const elapsed = Math.max(0, now() - start);
  journal.record(`${kind}.first-nonempty-emission`, elapsed);
  if (rows.some(row => row?.readOnly === true)) journal.record(`${kind}.first-nonempty-emission.readonly`, elapsed);
 };
}
