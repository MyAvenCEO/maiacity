import { answer } from './ops.js';

// Leave scope capacity for the rest of the app and bound retained observers.
export const MAX_ENTRY_PAGES = 8;

/** Progressively mount bounded local reads. Keep each mounted page reactive so
 * revocation or a removed row replaces that page, rather than retaining stale data.
 * Only one new page starts per browser turn, after its predecessor first settles.
 * @param {(query: () => any, take: (out: any) => void, failed: (error: Error) => void) => () => void} observe
 * @param {object[]} queries
 * @param {(state: {rows: any[], phase: 'loading'|'ready'|'error', error: string}) => void} update
 */
export function observeEntryPages(observe, queries, update) {
 let live = true, next = 0;
 /** @type {ReturnType<typeof setTimeout> | undefined} */
 let timer;
 /** @type {(() => void)[]} */
 const stops = [];
 /** @type {Map<number, any[]>} */
 const pages = new Map();
 /** @type {Map<number, string>} */
 const errors = new Map();
 if (queries.length > MAX_ENTRY_PAGES) errors.set(-1, 'Related-file discovery is incomplete: only 4096 dependency IDs are active. Open an original file to prioritize its family.');
 const active = queries.slice(0, MAX_ENTRY_PAGES);
 const settled = new Set();
 const publish = () => {
  if (!live) return;
  update({ rows: [...pages].sort(([a], [b]) => a - b).flatMap(([, rows]) => rows),
   phase: errors.size ? 'error' : settled.size < active.length ? 'loading' : 'ready',
   error: [...errors.values()].join('; ') });
 };
 const advance = () => {
  if (!live || timer !== undefined || next >= active.length) return;
  timer = setTimeout(() => { timer = undefined; start(); }, 0);
 };
 /** @param {number} index */
 const finish = index => {
  if (!live) return;
  const first = !settled.has(index);
  settled.add(index); publish();
  if (first) advance();
 };
 const start = () => {
  if (!live || next >= active.length) return;
  const index = next++;
  /** @param {Error} error */
  const failed = error => {
   if (!live) return;
   pages.delete(index); errors.set(index, error.message); finish(index);
  };
  try {
   const stop = observe(() => active[index], out => {
    if (!live) return;
    try {
     const got = answer(out);
     if (!got) { pages.delete(index); settled.delete(index); publish(); return; }
     if (!Array.isArray(got.rows)) throw new Error('Entry page did not return rows');
     pages.set(index, got.rows); errors.delete(index); finish(index);
    } catch (error) { failed(error instanceof Error ? error : new Error(String(error))); }
   }, failed);
   if (live) stops.push(stop); else stop();
  } catch (error) { failed(error instanceof Error ? error : new Error(String(error))); }
 };
 publish(); start();
 return () => {
  live = false;
  if (timer !== undefined) clearTimeout(timer);
  for (const stop of stops) stop();
  pages.clear(); errors.clear();
 };
}
