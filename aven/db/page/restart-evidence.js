/** Describe observed lifecycle boundaries, never infer an operating-system kill
 * or a memory-pressure cause from missing events. The input is the sanitized,
 * bounded local journal; no additional data is collected.
 * @param {{events: {event:string, phase:string}[], previous?: unknown}} report */
export function restartEvidence(report) {
 const events = report.events;
 const starts = events.flatMap((e, i) => e.event === 'document-start' ? [i] : []);
 const last = starts.at(-1) ?? 0;
 const current = events.slice(last);
 const opened = current.findLastIndex(e => e.event === 'open');
 if (opened >= 0 && current.slice(opened + 1).some(e => e.event === 'locked')) {
  return {kind: 'session-lock', text: 'The session locked within the same document. No new page load is recorded for that transition.'};
 }
 if (starts.length < 2 && !report.previous) {
  return {kind: 'insufficient', text: 'No earlier document boundary is retained. The cause cannot be determined from this record.'};
 }
 // Use explicit boundaries, not the saturating document counter. The journal
 // can retain only a suffix of the preceding document after a long session.
 const preceding = events.slice(starts.at(-2) ?? 0, last);
 if (preceding.some(e => e.event === 'app-reload-request')) {
  return {kind: 'app-reload', text: 'The preceding document recorded an explicit app reload request.'};
 }
 if (preceding.some(e => e.event === 'app-navigation-unload')) {
  return {kind: 'app-navigation', text: 'The preceding document recorded an app navigation that unloads the page.'};
 }
 const exited = preceding.some(e => ['pagehide', 'pagehide-persisted', 'beforeunload'].includes(e.event));
 return exited
  ? {kind: 'document-navigation', text: 'A new document loaded after a recorded page-exit event. This does not identify what initiated it.'}
  : {kind: 'unexplained-restart', text: 'A new document loaded without a retained app reload, navigation or exit event. Browser/process termination, memory pressure and other causes cannot be distinguished from this evidence.'};
}
