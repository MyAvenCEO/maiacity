import { lifecycle } from './lifecycle.js';
import { latencyJournal, TIMED_OPS as OPS } from './latency-journal.js';
/** Bounded timings. Only allowlisted operation names and durations enter the durable journal. */
/** @param {() => number} [now] @param {(op: string, ms: number, outcome: 'ok' | 'refused' | 'failed', reason?: string, context?: any) => void} [record] @param {() => any} [context] */
export function createLocalTimings(now = () => performance.now(), record = () => {}, context = () => null) {
 /** @type {Map<string, { samples: number[], failed: number, pending: Map<number, number> }>} */
 const rows = new Map();
 let sequence = 0;
 return {
  /** @template T @param {string} op @param {() => Promise<T>} work @returns {Promise<T>} */
  async measure(op, work) {
   if (!OPS.has(op)) return work();
   let row = rows.get(op);
   if (!row) rows.set(op, row = { samples: [], failed: 0, pending: new Map() });
   const id = ++sequence, start = now(), before = context();
   row.pending.set(id, start);
   /** @type {'ok' | 'refused' | 'failed'} */ let outcome = 'ok';
   /** @type {string | undefined} */ let reason;
   try {
    const result = await work();
    if (result && typeof result === 'object' && 'refused' in result) { row.failed++; outcome = 'refused'; reason = failureClass(result.refused); }
    return result;
   }
   catch (error) { row.failed++; outcome = 'failed'; reason = failureClass(error); throw error; }
   finally {
    row.pending.delete(id);
    const ms = Math.max(0, now() - start);
    row.samples.push(ms);
    const after = context();
    const hidden = before && after && before.document===after.document ? Math.min(ms,Math.max(0,after.hiddenTotalMs-before.hiddenTotalMs)) : null;
    record(op, ms, outcome, reason, hidden===null ? undefined : {document:after.document,startMs:before.elapsedMs,endMs:after.elapsedMs,hiddenMs:hidden,visibleMs:ms-hidden});
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
export const localTimings = createLocalTimings(undefined, (op, ms, outcome, reason, context) => latencyJournal.record(`call.${op}`, ms, outcome, reason, context), () => lifecycle()?.timingContext());

/** Only fixed error tags leave the process; never retain error text. */
/** @param {any} value */
export function failureClass(value) {
 if(value?.worker === true)return 'worker-ended';
 const message=typeof value?.message === 'string' ? value.message : '';
 if(message === 'no file this device opens' || message.startsWith('no file this device opens:'))return 'file-not-open';
 if(message === 'incomplete local file index')return 'file-index-incomplete';
 const tag = typeof value === 'string' ? value : value?.name ?? value?.kind;
 return (/** @type {Record<string,string>} */ ({TimeoutError:'timeout',AbortError:'cancelled',Locked:'locked',NoEntry:'not-found',NotFound:'not-found',Materializing:'not-ready',NotAllowed:'not-allowed'}))[tag] ?? 'failed';
}
