/** Device-local, bounded timing evidence. Never stores operation arguments, IDs, keys or error text. */
const KEY = 'avendb:latency:v1';
export const TIMED_OPS = new Set(['status', 'world', 'entries', 'entry', 'entry_views', 'query', 'get', 'room', 'history', 'read_file', 'synced', 'cap_groups', 'bring', 'bring_entries', 'network', 'create', 'set', 'unset', 'insert', 'remove', 'move', 'tag', 'merge', 'review', 'put_file']);
const STAGES = new Set(['unlock.total', 'peer.transport-rtt', 'query.first-nonempty-emission', 'query.first-nonempty-emission.readonly', ...[...TIMED_OPS].map(op => `call.${op}`)]);
const LIMIT = 120;
const REASONS = new Set(['timeout', 'cancelled', 'locked', 'not-found', 'not-ready', 'not-allowed', 'refused', 'failed']);
/** @param {any} s */
const clean = s => ({ stage: s.stage, ms: s.ms, at: s.at, outcome: s.outcome, ...(REASONS.has(s.reason) ? {reason:s.reason} : {}) });
/** @typedef {{ stage: string, ms: number, at: number, outcome: 'ok' | 'refused' | 'failed', reason?: string }} Sample */
/** @param {unknown} value @returns {value is Sample} */
function valid(value) {
 const v = /** @type {any} */ (value);
 return !!v && STAGES.has(v.stage) && Number.isFinite(v.ms) && v.ms >= 0 && v.ms <= 86400000 && Number.isSafeInteger(v.at) && v.at >= 0 && ['ok', 'refused', 'failed'].includes(v.outcome);
}
/** @param {{storage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined, now?: () => number, schedule?: (f: () => void) => unknown}} [options] */
export function createLatencyJournal({ storage = () => undefined, now = Date.now, schedule = f => setTimeout(f, 2000) } = {}) {
 /** @type {Sample[]} */ let samples = [];
 /** @type {Sample[]} */ let milestones = [];
 let loaded = false, scheduled = false, available = true;
 function load() {
  if (loaded) return;
  loaded = true;
  try {
   const shelf = storage();
   if (!shelf) { available = false; return; }
   const text = shelf.getItem(KEY);
   if (!text || text.length > 32768) return;
   const saved = JSON.parse(text);
   if (saved?.version === 1 && Array.isArray(saved.samples)) samples = saved.samples.filter(valid).slice(-LIMIT).map((/** @type {Sample} */ s) => clean(s));
   milestones = (Array.isArray(saved?.milestones) ? saved.milestones : samples).filter((/** @type {any} */ s) => valid(s) && s.stage === 'unlock.total').slice(-8).map(clean);
  } catch { available = false; }
 }
 function flush() {
  scheduled = false;
  load();
  try { const shelf = storage(); if (!shelf) { available = false; return; } shelf.setItem(KEY, JSON.stringify({ version: 1, samples, milestones })); available = true; }
  catch { available = false; }
 }
 return {
  /** @param {string} stage @param {number} ms @param {'ok' | 'refused' | 'failed'} [outcome] @param {string | undefined} [reason] */
  record(stage, ms, outcome = 'ok', reason = undefined) {
   const sample = clean({ stage, ms, at: now(), outcome, reason });
   if (!valid(sample)) return;
   load(); samples.push(sample);
   if (stage === 'unlock.total') { milestones.push(sample); if(milestones.length > 8) milestones.splice(1,1); }
   if (samples.length > LIMIT) {
    // Keep the latest unlock boundary through high-frequency catch-up calls.
    // It is often the only evidence left after an abrupt mobile restart.
    const latestUnlock = samples.findLastIndex(s => s.stage === 'unlock.total');
    samples.splice(latestUnlock === 0 ? 1 : 0, 1);
   }
   if (!scheduled) { scheduled = true; schedule(flush); }
  },
  snapshot() { load(); return { version: 1, storageAvailable: available, samples: samples.map(s => ({ ...s })), milestones: milestones.map(s => ({...s})) }; },
  flush,
  clear() { load(); samples = []; milestones = []; flush(); }
 };
}
export const latencyJournal = createLatencyJournal({ storage: () => typeof window === 'undefined' ? undefined : window.localStorage });
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => latencyJournal.flush());

/** Summarize only measured times from authenticated peer connections; never copy peer IDs or addresses.
 * The engine's transport RTT is not an edit acceptance acknowledgement or remote-render time.
 * @param {any} network @param {ReturnType<typeof createLatencyJournal>} [journal] */
export function recordPeerTimings(network, journal = latencyJournal) {
 let paths = 0;
 for (const peer of Array.isArray(network?.peers) ? network.peers : []) {
  for (const path of Array.isArray(peer?.paths) ? peer.paths : []) {
   if (path.selected && Number.isFinite(path.rtt_ms) && path.rtt_ms > 0 && path.rtt_ms <= 86400000) { journal.record('peer.transport-rtt', path.rtt_ms); paths++; }
  }
 }
 return paths;
}

/** Time an actual operation with a monotonic clock; propagate its exact result or error.
 * @template T @param {string} stage @param {() => Promise<T>} work
 * @param {ReturnType<typeof createLatencyJournal>} [journal] @param {() => number} [now] */
export async function measureLatency(stage, work, journal = latencyJournal, now = () => performance.now()) {
 const start = now();
 /** @type {'ok' | 'failed'} */ let outcome = 'failed';
 try { const result = await work(); outcome = 'ok'; return result; }
 finally {
  journal.record(stage, Math.max(0, now() - start), outcome);
  // This boundary is rare and critical: iOS may reclaim the document immediately after unlock.
  // Do not leave its evidence waiting behind the ordinary two-second write coalescer.
  if (stage === 'unlock.total') journal.flush();
 }
}

/** Redacted snapshot of nonce-correlated engine policy observations, not transport RTT.
 * @param {any} network */
export function policyObservations(network, stage = 'local-completion-to-peer-policy-observation') {
 const observed = network?.policy_observations;
 if (!['local-completion-to-peer-policy-observation', 'local-completion-to-peer-reactive-consumer'].includes(stage) || observed?.stage !== stage) return null;
 /** @type {any[]} */
 const samples = Array.isArray(observed.samples) ? observed.samples : [];
 return { stage: observed.stage,
  samples: samples.slice(-64)
   .filter(s => s && Number.isFinite(s.ms) && s.ms >= 0 && s.ms < 30000 && ['standing', 'not-standing'].includes(s.outcome))
   .map(s => ({ ms: s.ms, outcome: s.outcome })) };
}
