import { observedRevisions } from './observed-revisions.js';

/** Opt-in, memory-only consumer observation. Bounded to one operation in flight
 * plus 64 coalesced rows; no plaintext contents, wall clocks or persistent IDs.
 * The node validates current main heads and peer disclosure independently. */
export function createReactiveObservation({ now = () => performance.now() } = {}) {
 /** @typedef {{owner: any, send: (op: any) => Promise<any>, until: number, pending: Map<string, any>, running: boolean}} Scope */
 /** @type {Scope | null} */ let active = null;
 const valid = (/** @type {any} */ owner) => active && active.owner === owner && now() < active.until;
 async function drain(/** @type {Scope} */ scope) {
  if (scope.running) return;
  scope.running = true;
  try {
   while (active === scope && now() < scope.until && scope.pending.size) {
    const rows = [...scope.pending.values()]; scope.pending.clear();
    await scope.send({op:'observe_query_emission',rows});
   }
  } catch { scope.pending.clear(); }
  finally { scope.running = false; }
 }
 return {
  arm(/** @type {any} */ owner, /** @type {(op: any) => Promise<any>} */ send) { active = {owner,send,until:now()+120000,pending:new Map(),running:false}; },
  stop() { active = null; },
  query(/** @type {any} */ owner, /** @type {any} */ query) { return valid(owner) && query?.op === 'query' ? {...query,observeRevision:true} : query; },
  emitted(/** @type {any} */ owner, /** @type {any} */ answer) {
   if (!valid(owner) || !active) return;
   const scope=active;
   for(const row of observedRevisions(answer)) {
    if(row.kind !== 'main-heads' || !row.frontierComplete || row.readOnly) continue;
    if(scope.pending.size < 64 || scope.pending.has(row.entry)) scope.pending.set(row.entry,row);
   }
   void drain(scope);
  }
 };
}
export const reactiveObservation = createReactiveObservation();
