// Bounded local diagnostics, never an authority or unlock mechanism.
/** @typedef {{ documents: number, phase: string, visibility: string, exit: string, workerFailures: number }} LifecycleState */
const KEY = 'avendb:lifecycle:v1';
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
 * account, document content, IDs, errors, credentials, timestamps or unlock material.
 * @param {{storage: () => Pick<Storage, "getItem" | "setItem">, page: EventTarget, doc: EventTarget & {visibilityState: string}, navigation?: () => unknown}} environment */
export function createLifecycle({ storage, page, doc, navigation = () => 'navigate' }) {
 /** @type {LifecycleState | null} */ let current = null;
 /** @type {LifecycleState | null} */ let previous = null;
 let available = true, kind = 'navigate';
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
  current = { documents: Math.min((previous?.documents ?? 0) + 1, 9999), phase: 'starting',
   visibility: visibility(), exit: 'none', workerFailures: 0 };
  doc.addEventListener('visibilitychange', () => { if (current) { current.visibility = visibility(); save(); } });
  page.addEventListener('pagehide', (event) => {
   if (!current) return;
   current.visibility = visibility(); current.exit = /** @type {PageTransitionEvent} */ (event).persisted ? 'pagehide-persisted' : 'pagehide'; save();
  });
  page.addEventListener('pageshow', () => { if (!current) return; current.exit = 'none'; current.visibility = visibility(); save(); });
  save();
 }
 return {
  start,
  /** @param {string} event */
  note(event) {
   start();
   if (!current) return;
   if (PHASES.includes(event)) current.phase = event;
   else if (event === 'worker-failed') current.workerFailures = Math.min(current.workerFailures + 1, 9999);
   else return;
   save();
  },
  snapshot() { start(); return { storageAvailable: available, navigation: kind, current: { .../** @type {LifecycleState} */ (current) }, previous: previous && { ...previous } }; }
 };
}

/** @type {ReturnType<typeof createLifecycle> | undefined} */
let active;
export function lifecycle() {
 if (typeof window === 'undefined') return null;
 return active ??= createLifecycle({ storage: () => sessionStorage, page: window, doc: document,
  navigation: () => /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0])?.type });
}
/** @param {string} event */
export const noteLifecycle = (event) => lifecycle()?.note(event);
