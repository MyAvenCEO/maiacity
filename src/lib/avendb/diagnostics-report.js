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
/** A walk of a view's manifests as a report carries it: counts and times, and the ids of the manifests it matched
 *  (`kernel`, `chat`: the app's names, never a route, vault or entry). */
const manifestRun = run => ({ ms: number(run.ms), requested: number(run.requested), catalog: ['local','refused','unavailable'].includes(run.catalog) ? run.catalog : 'unavailable',
 ...Object.fromEntries(['heldManifests','matchedLeaves','queryLeaves','typeDiscoveryHints','localRows','now','next','later','idle','firstMs','readMs','vaultManifests','builtInManifests'].map(key => [key, number(run[key])])),
 matched: (Array.isArray(run.matched) ? run.matched : []).filter(id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id) && !/[0-9a-f]{16}/.test(id)).slice(0, 16),
 state: ['scheduled', 'ready', 'done', 'complete', 'failed', 'cancelled', 'running'].includes(run.state) ? run.state : 'unknown' });
const HEX8 = /^[0-9a-f]{8}/;
/** A device, an edit or a log as a report names it: its first eight hex, never more. */
const short = value => typeof value === 'string' && HEX8.test(value) ? value.slice(0, 8) : null;
/** A log as the engine prints it (`Entry(EntryId(ab12cd34…))`): its kind and the first eight hex of each id in it. */
const logRef = value => {
 const text = typeof value === 'string' ? value.slice(0, 200) : '';
 const kind = /^(Vault|Share|Audience|Entry)\(/.exec(text)?.[1] ?? 'unknown';
 return { kind, ids: (text.match(/[0-9a-f]{8}/g) ?? []).slice(0, 2) };
};
/** A pull's stage is the engine's own few words; anything else is not copied. */
const stage = value => typeof value === 'string' && /^[a-z][a-z ,]{0,47}$/.test(value) ? value : 'other';
/** How far a sync is, as a report carries it: the counts, per peer the pull and its edits and pages (`from`), and what
 *  the device lacks of each peer (`lacked`, Fix D): numbers and 8-hex ids only, never a name, an address or contents. */
const syncReport = sync => ({
 ...Object.fromEntries(['peers', 'reconnecting', 'logs', 'behind', 'pulling', 'pages', 'edits', 'base', 'since', 'paged', 'at'].map(key => [key, number(sync[key])])),
 from: (Array.isArray(sync.from) ? sync.from : []).slice(0, 32).map(p => ({ device: short(p?.device), reconnecting: p?.reconnecting === true,
  pulling: p?.pulling ? { since: number(p.pulling.since), stage: stage(p.pulling.stage), took: number(p.pulling.took) } : null,
  pages: number(p?.pages), edits: number(p?.edits), last: number(p?.last), askings: number(p?.askings), failed: number(p?.failed) })),
 lacked: (Array.isArray(sync.lacked) ? sync.lacked : []).slice(0, 32).map(p => ({ device: short(p?.device),
  lacks: number(p?.lacks), byStub: number(p?.by_stub), stubs: number(p?.stubs),
  sample: (Array.isArray(p?.sample) ? p.sample : []).slice(0, 5).map(l => ({ log: logRef(l?.log), held: l?.held === true,
   lackedHeads: (Array.isArray(l?.lacked_heads) ? l.lacked_heads : []).slice(0, 8).map(short).filter(Boolean), waiting: number(l?.waiting) })) }))
});
/** A step's note as a report carries it: the device's own words and numbers for its person (`Progress::note`), cut
 *  short, any run of 16 hex or more cut out. */
const note = value => typeof value === 'string' ? value.slice(0, 600).replace(/[0-9a-f]{16,}/gi, '…') : null;
/** This tab's last unlock as a report carries it (session.svelte.js `lastUnlock`): when it began, and each step of
 *  the device's, by its name, when it began and how long it took (ms since the unlock began) and its note, so that a
 *  slow unlock says which step took the time and how it went (2026-10-28: an iPhone's 97.5 s "Taking back your edits"
 *  that no report told of). */
export function unlockReport(unlock) {
 if (!unlock || !Array.isArray(unlock.steps)) return unavailable('no-unlock-in-this-tab');
 const from = number(unlock.from) ?? 0;
 return { began: number(unlock.began), over: unlock.over === true, deviceFrom: from,
  steps: unlock.steps.slice(0, 24).filter(s => typeof s?.step === 'string' && /^[a-z][a-zA-Z]{0,15}$/.test(s.step))
   .map(s => ({ step: s.step, at: number(s.at) === null ? null : from + s.at, took: number(s.took), note: note(s.note) })) };
}
/** Existing sources already redact lifecycle and stage names; bound their final report too.
 * @param {{phase: string, journal: any, lifecycle: any, calls?: any[], manifests: any, sync: any, playback: any, device: string, build?: string, unlock?: any}} options */
export function diagnosticSnapshot({ phase, journal, lifecycle, calls = [], manifests, sync, playback, device, build, unlock = null }) {
 return { version: 2, kind: 'maia-unified-diagnostics', capturedAt: Date.now(),
  build: {frontend: /^[a-f0-9]{40}$/.test(build ?? '') ? build : 'unavailable', nativeEngine: 'unavailable'},
  device: ['iPhone', 'iPad', 'Mac', 'other'].includes(device) ? device : 'other',
  phase: ['open', 'locked', 'loading', 'new', 'error', 'unlocking'].includes(phase) ? phase : 'unknown',
  timings: journal ?? unavailable('no-retained-timing-journal'), unlock: unlockReport(unlock), lifecycle: lifecycle ?? unavailable('lifecycle-unavailable'),
  localCalls: calls.filter(row => TIMED_OPS.has(row.op)).slice(0, 40).map(row => ({ op: row.op, count: number(row.count), median: number(row.median), p95: number(row.p95), failed: number(row.failed), pending: number(row.pending), waiting: number(row.waiting) })),
  manifests: manifests ? { pending: number(manifests.pending), running: (Array.isArray(manifests.running) ? manifests.running : []).slice(0, 4).map(manifestRun), runs: manifests.runs.slice(-20).map(manifestRun) } : unavailable('manifest-observations-unavailable'),
  sync: sync?.known ? syncReport(sync) : unavailable('peer-log-coverage-unavailable'),
  playback: playback ? Object.fromEntries(['frames','fps','renderP95','gapP95','cutP95','cuts','maxGap','maxCutGap','longGaps','failures'].map(key => [key, number(playback[key])])) : unavailable('no-playback-observation'),
  acceptance: { outgoingDurability: 'unmeasured', filesComplete: 'unmeasured', renderedRemoteLatency: 'unmeasured', completeFirstView: 'unmeasured', restartCause: 'unknown' },
  semantics: 'Unlock includes user authentication. Local calls include queue time, not paint or remote delivery. Call context separates observed hidden elapsed from visible elapsed; visible elapsed is not CPU time. Old samples without context cannot separate suspension. Consumer observations exclude paint/durable save; absent samples are unmeasured. Log coverage does not prove file or outgoing completeness. No account IDs, entry contents, peer addresses or error text are exported.' };
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
