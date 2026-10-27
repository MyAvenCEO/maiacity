// Bounded local diagnostics, never an authority or unlock mechanism.
/** @typedef {{ documents: number, phase: string, visibility: string, exit: string, workerFailures: number }} LifecycleState */
const KEY = 'avendb:lifecycle:v1';
const JOURNAL_KEY = 'avendb:lifecycle-events:v1';
const LIMIT = 64;
const LANDMARKS = new Set(['document-start','unlocking','passkey-finished','open','locked','worker-failed','app-reload-request','pagehide']);
const EVENTS = new Set(['navigation-navigate', 'navigation-reload', 'navigation-back_forward', 'navigation-prerender', 'navigation-unknown', 'document-start', 'starting', 'unlocking', 'open', 'locked', 'worker-start', 'worker-failed', 'worker-message-error',
 'passkey-start', 'passkey-finished', 'device-open-start', 'unlock-failed', 'session-lock-request', 'app-reload-request',
 'route-navigation', 'app-navigation-unload', 'visibility-visible', 'visibility-hidden', 'visibility-unknown',
 'pagehide', 'pagehide-persisted', 'pageshow', 'pageshow-persisted', 'beforeunload', 'history-pop', 'hash-change',
 'page-error', 'unhandled-rejection', 'sw-controlled', 'sw-uncontrolled', 'sw-controller-change', 'sw-update-found',
 'sw-installing', 'sw-installed', 'sw-activating', 'sw-activated', 'sw-redundant']);
/** @typedef {{document: number, ms: number, event: string, phase: string, visibility: string}} LifecycleEvent */
/** @param {any} value @returns {LifecycleEvent | null} */
const cleanEvent = (value) => value && EVENTS.has(value.event) && Number.isSafeInteger(value.document) && value.document > 0 && value.document <= 9999
 && Number.isSafeInteger(value.ms) && value.ms >= 0 && value.ms <= 86400000
 ? {document: value.document, ms: value.ms, event: value.event, phase: one(value.phase, PHASES, 'starting'), visibility: one(value.visibility, VISIBILITY, 'unknown')} : null;
const PHASES = ['starting', 'unlocking', 'open', 'locked'];
const VISIBILITY = ['visible', 'hidden', 'unknown'];
const EXITS = ['none', 'pagehide', 'pagehide-persisted'];
const NAVIGATIONS = ['navigate', 'reload', 'back_forward', 'prerender'];
/** @param {number} n */
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? Math.min(n, 9999) : 0;
/** @param {unknown} value @param {string[]} allowed @param {string} fallback */
const one = (value, allowed, fallback) => typeof value === 'string' && allowed.includes(value) ? value : fallback;
/** @param {any} value @returns {LifecycleState | null} */
const clean = (value) => value && typeof value === 'object' ? {
 documents: count(value.documents), phase: one(value.phase, PHASES, 'starting'),
 visibility: one(value.visibility, VISIBILITY, 'unknown'), exit: one(value.exit, EXITS, 'none'),
 workerFailures: count(value.workerFailures)
} : null;

/** Injected browser boundary for tests. A new instance represents a new document;
 * start() is idempotent for client-side route changes. Storage contains no route,
 * account, document content, IDs, error text, credentials, wall-clock timestamps or unlock material.
 * A separate durable ring records only enumerated events and elapsed document milliseconds.
 * @param {{storage: () => Pick<Storage, "getItem" | "setItem">, page: EventTarget, doc: EventTarget & {visibilityState: string}, navigation?: () => unknown, journalStorage?: () => Pick<Storage, "getItem" | "setItem">, now?: () => number, serviceWorker?: ServiceWorkerContainer}} environment */
export function createLifecycle({ storage, page, doc, navigation = () => 'navigate', journalStorage = storage, now = () => performance.now(), serviceWorker }) {
 /** @type {LifecycleState | null} */ let current = null;
 /** @type {LifecycleState | null} */ let previous = null;
 let available = true, journalAvailable = true, kind = 'navigate', began = 0;
 /** @type {LifecycleEvent[]} */ let events = [];
 /** @type {LifecycleEvent[]} */ let landmarks = [];
 let documentNumber = 1, hiddenMs = 0;
 /** @type {number | null} */ let hiddenSince = null;
 const event = (/** @type {string} */ name) => {
  if (!current || !EVENTS.has(name)) return;
  let elapsed = 0; try { elapsed = Math.floor(now() - began); } catch {}
  events.push({document: documentNumber, ms: Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, 86400000)) : 0, event: name, phase: current.phase, visibility: current.visibility});
  if(LANDMARKS.has(name)) { landmarks.push(events[events.length-1]); if(landmarks.length > 24) landmarks.splice(1,1); }
  events = events.slice(-LIMIT);
  try { journalStorage().setItem(JOURNAL_KEY, JSON.stringify({version: 1, events, landmarks})); } catch { journalAvailable = false; }
 };
 const visibility = () => one(doc.visibilityState, VISIBILITY, 'unknown');
 const save = () => {
  try { storage().setItem(KEY, JSON.stringify(current)); }
  catch { available = false; }
 };
 function start() {
  if (current) return;
  try { previous = clean(JSON.parse(storage().getItem(KEY) ?? 'null')); }
  catch { available = false; }
  try { kind = one(navigation(), NAVIGATIONS, 'unknown'); }
  catch { kind = 'unknown'; }
  try {
   const text = journalStorage().getItem(JOURNAL_KEY);
   const saved = text && text.length <= 16384 ? JSON.parse(text) : null;
   if (saved?.version === 1 && Array.isArray(saved.events)) events = saved.events.slice(-LIMIT).map(cleanEvent).filter(Boolean);
   landmarks = (Array.isArray(saved?.landmarks) ? saved.landmarks : events).map(cleanEvent).filter((/** @type {LifecycleEvent | null} */ e) => e && LANDMARKS.has(e.event)).slice(-24);
  } catch { journalAvailable = false; }
  documentNumber = Math.min((events.at(-1)?.document ?? 0) + 1, 9999);
  try { began = now(); } catch { began = 0; }
  current = { documents: Math.min((previous?.documents ?? 0) + 1, 9999), phase: 'starting',
   visibility: visibility(), exit: 'none', workerFailures: 0 };
  hiddenSince = current.visibility === 'hidden' ? began : null;
  doc.addEventListener('visibilitychange', () => { if (current) {
   const at = now(), next = visibility();
   if (next === 'hidden' && hiddenSince === null) hiddenSince = at;
   if (next !== 'hidden' && hiddenSince !== null) { hiddenMs += Math.max(0, at-hiddenSince); hiddenSince=null; }
   current.visibility = next; save(); event(`visibility-${current.visibility}`); } });
  page.addEventListener('pagehide', (hidden) => {
   if (!current) return;
   current.visibility = visibility(); current.exit = /** @type {PageTransitionEvent} */ (hidden).persisted ? 'pagehide-persisted' : 'pagehide'; save(); event(current.exit);
  });
  page.addEventListener('pageshow', (shown) => { if (!current) return; current.exit = 'none'; current.visibility = visibility(); save(); event(/** @type {PageTransitionEvent} */ (shown).persisted ? 'pageshow-persisted' : 'pageshow'); });
  for (const [source, name] of [['beforeunload', 'beforeunload'], ['popstate', 'history-pop'], ['hashchange', 'hash-change'], ['error', 'page-error'], ['unhandledrejection', 'unhandled-rejection']]) page.addEventListener(source, () => event(name));
  if (serviceWorker) {
   event(serviceWorker.controller ? 'sw-controlled' : 'sw-uncontrolled');
   serviceWorker.addEventListener('controllerchange', () => event('sw-controller-change'));
   const watched = new WeakSet();
   const watch = (/** @type {ServiceWorker | null} */ worker) => {
    if (!worker || watched.has(worker)) return;
    watched.add(worker);
    const changed = () => event(`sw-${worker.state}`);
    changed(); worker.addEventListener('statechange', changed);
   };
   void Promise.resolve().then(() => serviceWorker.getRegistrations()).then(registrations => {
    for (const registration of registrations) {
     watch(registration.installing); watch(registration.waiting); watch(registration.active);
     registration.addEventListener('updatefound', () => { event('sw-update-found'); watch(registration.installing); });
    }
   }).catch(() => {});
  }
  save(); event('document-start'); event(`navigation-${kind}`);
 }
 const recordEvent = event;
 return {
  start,
  /** @param {string} event */
  note(event) {
   start();
   if (!current) return;
   if (PHASES.includes(event)) current.phase = event;
   else if (event === 'worker-failed') current.workerFailures = Math.min(current.workerFailures + 1, 9999);
   else if (!EVENTS.has(event)) return;
   save();
   recordEvent(event);
  },
  timingContext() { start(); const at=now(); return {document:documentNumber, sessionDocument:current?.documents ?? 0, elapsedMs:Math.max(0,at-began), hiddenTotalMs:hiddenMs+(hiddenSince===null?0:Math.max(0,at-hiddenSince)), visibility:current?.visibility ?? 'unknown'}; },
  snapshot() { start(); return { document:documentNumber, sessionDocuments:current?.documents ?? 0, numbering:'document is this retained journal sequence; sessionDocuments/current.documents count this sessionStorage lifetime, not total restarts', storageAvailable: available, navigation: kind, current: { .../** @type {LifecycleState} */ (current) }, previous: previous && { ...previous }, journalAvailable, events: events.map(e => ({ ...e })), landmarks: landmarks.map(e=>({...e})) }; }
 };
}

/** @type {ReturnType<typeof createLifecycle> | undefined} */
let active;
export function lifecycle() {
 if (typeof window === 'undefined') return null;
 return active ??= createLifecycle({ storage: () => sessionStorage, journalStorage: () => localStorage, page: window, doc: document, serviceWorker: navigator.serviceWorker,
  navigation: () => /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0])?.type });
}
/** @param {string} event */
export const noteLifecycle = (event) => lifecycle()?.note(event);
