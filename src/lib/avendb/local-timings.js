/** Bounded, in-memory timings. Records operation names only, never vault data or IDs. */
const OPS = new Set(['status', 'world', 'entries', 'entry', 'query', 'get', 'history', 'read_file', 'synced', 'cap_groups', 'bring', 'bring_entries']);
/** @param {() => number} [now] */
export function createLocalTimings(now = () => performance.now()) {
 /** @type {Map<string, { samples: number[], failed: number, pending: Map<number, number> }>} */
 const rows = new Map();
 let sequence = 0;
 return {
  /** @template T @param {string} op @param {() => Promise<T>} work @returns {Promise<T>} */
  async measure(op, work) {
   if (!OPS.has(op)) return work();
   let row = rows.get(op);
   if (!row) rows.set(op, row = { samples: [], failed: 0, pending: new Map() });
   const id = ++sequence, start = now();
   row.pending.set(id, start);
   try {
    const result = await work();
    if (result && typeof result === 'object' && 'refused' in result) row.failed++;
    return result;
   }
   catch (error) { row.failed++; throw error; }
   finally {
    row.pending.delete(id);
    row.samples.push(Math.max(0, now() - start));
    if (row.samples.length > 100) row.samples.shift();
   }
  },
  snapshot() {
   return [...rows].map(([op, row]) => {
    const sorted = [...row.samples].sort((a, b) => a - b);
    const percentile = (/** @type {number} */ p) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
    return { op, count: sorted.length, median: percentile(.5), p95: percentile(.95), failed: row.failed,
     pending: row.pending.size, waiting: row.pending.size ? Math.max(...[...row.pending.values()].map(start => now() - start)) : 0 };
   });
  }
 };
}
export const localTimings = createLocalTimings();
