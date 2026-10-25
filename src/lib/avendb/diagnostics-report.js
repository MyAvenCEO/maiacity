// @ts-nocheck
import { policyObservations, TIMED_OPS } from './latency-journal.js';
const number = value => Number.isFinite(value) && value >= 0 ? value : null;
const unavailable = reason => ({ status: 'unavailable', reason });
/** Strict projection: never spread arbitrary engine responses into copied logs. */
export function peerDiagnostics(network, perf) {
 const peers = Array.isArray(network?.peers) ? network.peers.slice(0, 32) : [];
 return { transportRttMs: peers.flatMap(peer => (Array.isArray(peer.paths) ? peer.paths : []).slice(0, 8)
   .filter(path => path.selected && number(path.rtt_ms) !== null).map(path => path.rtt_ms)),
  policy: policyObservations(network), reactive: policyObservations({ policy_observations: network?.reactive_observations }, 'local-completion-to-peer-reactive-consumer'),
  receiveWork: receiveWork(perf) };
}
/** Existing sources already redact lifecycle and stage names; bound their final report too. */
export function diagnosticSnapshot({ phase, journal, lifecycle, calls = [], manifests, sync, playback, device, build }) {
 return { version: 2, kind: 'maia-unified-diagnostics', capturedAt: Date.now(),
  build: {frontend: /^[a-f0-9]{40}$/.test(build ?? '') ? build : 'unavailable', nativeEngine: 'unavailable'},
  device: ['iPhone', 'iPad', 'Mac', 'other'].includes(device) ? device : 'other',
  phase: ['open', 'locked', 'loading', 'new', 'error', 'unlocking'].includes(phase) ? phase : 'unknown',
  timings: journal ?? unavailable('no-retained-timing-journal'), lifecycle: lifecycle ?? unavailable('lifecycle-unavailable'),
  localCalls: calls.filter(row => TIMED_OPS.has(row.op)).slice(0, 40).map(row => ({ op: row.op, count: number(row.count), median: number(row.median), p95: number(row.p95), failed: number(row.failed), pending: number(row.pending), waiting: number(row.waiting) })),
  manifests: manifests ? { pending: number(manifests.pending), runs: manifests.runs.slice(-20).map(run => ({ ms: number(run.ms), requested: number(run.requested), state: ['scheduled', 'ready', 'done', 'complete', 'failed', 'cancelled'].includes(run.state) ? run.state : 'unknown' })) } : unavailable('manifest-observations-unavailable'),
  sync: sync?.known ? Object.fromEntries(['peers', 'logs', 'behind', 'pulling', 'pages'].map(key => [key, number(sync[key])])) : unavailable('peer-log-coverage-unavailable'),
  playback: playback ? Object.fromEntries(['frames','fps','renderP95','gapP95','cutP95','cuts','maxGap','maxCutGap','longGaps','failures'].map(key => [key, number(playback[key])])) : unavailable('no-playback-observation'),
  acceptance: { outgoingDurability: 'unmeasured', filesComplete: 'unmeasured', renderedRemoteLatency: 'unmeasured', completeFirstView: 'unmeasured', restartCause: 'unknown' },
  semantics: 'Unlock includes user authentication. Local calls include queue time, not paint or remote delivery. Consumer observations exclude paint/durable save; absent samples are unmeasured. Log coverage does not prove file or outgoing completeness. No account IDs, entry contents, peer addresses or error text are exported.' };
}
/** One bounded read at a time. A timed-out engine call cannot accumulate duplicate retries. */
export function createDiagnosticRunner({ ask, currentOwner, isOpen, snapshot, network, armReactive, now = () => performance.now(), onUpdate = () => {} }) {
 let active = null, engineBusy = false, captureTask = null;
 let report = null;
 async function engine(op, signal, owner) {
  if (signal.aborted || !isOpen() || owner !== currentOwner()) return unavailable('locked-or-session-changed');
  if (engineBusy) return unavailable('previous-read-still-pending');
  engineBusy = true;
  let timer, cancel;
  const call = Promise.resolve().then(() => ask({ op })).then(answer => ({ answer }), () => unavailable('engine-read-failed')).finally(() => { engineBusy = false; });
  const timeout = new Promise(resolve => {
   timer = setTimeout(() => resolve(unavailable('engine-read-timeout')), 5000);
   cancel = () => resolve(unavailable('cancelled'));
   signal.addEventListener('abort', cancel, { once: true });
  });
  try { const result = await Promise.race([call, timeout]); return owner === currentOwner() && isOpen() ? result : unavailable('locked-or-session-changed'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
 }
 return {
  snapshot() { return { ...snapshot(), run: report ?? unavailable('not-run') }; },
  cancel() { active?.abort(); },
  capture() {
   if(active || !isOpen()) return;
   const ctrl = new AbortController(), owner=currentOwner(); active=ctrl;
   captureTask = (async () => { try {
    const connections=await engine('network',ctrl.signal,owner);
    const work=await engine('perf',ctrl.signal,owner);
    report ??= {status:'snapshot-only'};
    report.engine=connections.answer?.ok ? {status:'captured',capturedAt:Date.now(),...peerDiagnostics(connections.answer.ok,work.answer?.ok)} : unavailable(connections.reason ?? 'network-state-unavailable');
   } finally {active=null;captureTask=null;onUpdate();} })();
   return captureTask;
  },
  async run() {
   if (active) { if (!captureTask) return; active.abort(); await captureTask; }
   const ctrl = new AbortController(), owner = currentOwner(); active = ctrl;
   report = { status: 'running', engine: unavailable(isOpen() ? 'collecting' : 'locked'), network: unavailable('collecting'), responsiveness: unavailable('collecting'), observations: unavailable('locked') };
   onUpdate();
   const gaps = []; let last = now();
   const sample = setInterval(() => { const at = now(); if (gaps.length < 450) gaps.push(Math.max(0, at - last - 100)); last = at; }, 100);
   const deadline = setTimeout(() => ctrl.abort(), 45000);
   try {
    if (isOpen()) {
     const policy = await engine('measure_peer_policy', ctrl.signal, owner);
     const reactive = await engine('measure_peer_visibility', ctrl.signal, owner);
     if (reactive.answer?.ok?.enabled && owner === currentOwner()) armReactive(owner);
     report.observations = { policy: policy.answer?.ok?.enabled ? 'armed-for-two-minutes' : 'unavailable', reactive: reactive.answer?.ok?.enabled ? 'armed-for-two-minutes' : 'unavailable', syntheticWrites: false };
     const start = now(), local = await engine('world_summary', ctrl.signal, owner);
     report.localRead = { status: local.answer?.ok ? 'measured' : 'unavailable', ms: local.answer?.ok ? now() - start : null, reason: local.reason ?? (local.answer?.refused ? 'refused' : null) };
    }
    onUpdate();
    report.network = await network(ctrl.signal).catch(() => unavailable('network-probe-failed'));
    if (isOpen() && owner === currentOwner()) {
     const connections = await engine('network', ctrl.signal, owner);
     const work = await engine('perf', ctrl.signal, owner);
     report.engine = connections.answer?.ok ? { status: 'captured', capturedAt:Date.now(), ...peerDiagnostics(connections.answer.ok, work.answer?.ok) } : unavailable(connections.reason ?? 'network-state-unavailable');
    }
   } finally {
    clearTimeout(deadline); clearInterval(sample);
    const sorted = gaps.sort((a,b) => a-b);
    report.responsiveness = { status: sorted.length ? 'measured' : 'unavailable', samples: sorted.length, eventLoopDelayP95Ms: sorted.length ? sorted[Math.ceil(sorted.length * .95)-1] : null, maxEventLoopDelayMs: sorted.at(-1) ?? null, semantics: 'Foreground page timer delay during this diagnostic run, not worker CPU time or rendered-frame latency.' };
    report.status = ctrl.signal.aborted ? 'cancelled-or-timed-out' : 'finished';
    active = null; onUpdate();
   }
  }
 };
}

function receiveWork(perf) {
 const finite = (/** @type {any} */ value) => Number.isFinite(value) && value >= 0;
 const names = ['receive: atomic checkpoint admission', 'receive: prepared chunk admission'];
 const timers = Object.fromEntries(names.flatMap(name => {
  const t = perf?.timers?.[name];
  return t && Number.isSafeInteger(t.count) && t.count >= 0 && [t.total_ms,t.mean_ms,t.max_ms].every(finite)
   ? [[name, {count:t.count,total_ms:t.total_ms,mean_ms:t.mean_ms,max_ms:t.max_ms}]] : [];
 }));
 const counts = Object.fromEntries(['receive: atomic checkpoint pages', 'receive: atomic checkpoint page edits'].flatMap(name => {
  const n = perf?.counts?.[name];
  return Number.isSafeInteger(n) && n >= 0 ? [[name,n]] : [];
 }));
 return {timers,counts};
}
