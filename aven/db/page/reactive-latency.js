import { latencyJournal } from './latency-journal.js';

/** One local subscription clock, spanning empty/refused replies and revisions.
 * Records after the consumer callback returns, not after paint. No query, entry,
 * payload, route or peer identity is retained. Read-only rows may be useful but
 * do not prove bootstrap origin, write authority or query completeness.
 * @param {any} query
 * @param {{now?: () => number, journal?: Pick<typeof latencyJournal, 'record'>}} [options]
 */
export function beginReactiveTiming(query, { now = () => performance.now(), journal = latencyJournal } = {}) {
 const eligible = query?.op === 'query';
 const start = now();
 let measured = false;
 return (/** @type {any} */ answer) => {
  const rows = answer?.ok?.rows;
  if (!eligible || measured || !Array.isArray(rows) || !rows.length) return;
  measured = true;
  const elapsed = Math.max(0, now() - start);
  journal.record('query.first-nonempty-emission', elapsed);
  if (rows.some(row => row?.readOnly === true)) journal.record('query.first-nonempty-emission.readonly', elapsed);
 };
}
