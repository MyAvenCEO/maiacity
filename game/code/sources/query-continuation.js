// @ts-nocheck — shared browser/native JS
/** Finish bounded local query work without treating a provisional count as final.
 * Retained node materialization is the cursor; never concatenate provisional pages.
 * Only explicit deferred work is retried, not missing remote dependencies.
 * @template T
 * @param {() => Promise<T>} run
 * @param {{signal?:AbortSignal, progress?:(answer:T)=>void, pause?:(delay:number, signal?:AbortSignal)=>Promise<void>}} options
 * @returns {Promise<T>}
 */
export async function completeQuery(run, {signal, progress = () => {}, pause = yieldQuery} = {}) {
 let previous = Infinity, delay = 8;
 for (;;) {
  signal?.throwIfAborted();
  const answer = await run();
  signal?.throwIfAborted();
  progress(answer);
  const remaining = answer?.ok?.readiness?.deferredCandidates;
  if (!Number.isSafeInteger(remaining) || remaining <= 0) return answer;
  // A changing revision may hold progress steady. Back off instead of spinning;
  // retain the same operation/window until cancelled or its exact result arrives.
  delay = remaining < previous ? 8 : Math.min(250, delay * 2);
  previous = remaining;
  await pause(delay, signal);
 }
}
function yieldQuery(delay, signal) {
 return new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason ?? new DOMException('Aborted','AbortError')); };
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delay);
  signal?.addEventListener('abort', abort, {once:true});
  if (signal?.aborted) abort();
 });
}
