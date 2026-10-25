/** Explicit limits of a successful local read. These are diagnostic/readiness
 * facts, never authority. No row count, demand acceptance or log coverage proves
 * discovery complete or files available. Preserve phase='ready' compatibility:
 * it means a local response, not that every dependency is here.
 * @param {any} answer */
export function readCompleteness(answer) {
 const value = answer?.ok;
 const present = value !== null && typeof value === 'object';
 const rows = present && Array.isArray(value.rows) ? value.rows : [];
 const checkpoint = value?.readiness?.checkpointPartial === true || value?.checkpoint?.partial === true || rows.some((/** @type {any} */ row) => row?.checkpoint?.partial === true);
 const partialFiles = value?.filesComplete === false || rows.some((/** @type {any} */ row) => row?.filesComplete === false);
 const count = (/** @type {unknown} */ n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 0;
 return {
  pendingJudgments: count(value?.readiness?.pendingJudgments),
  unresolvedCandidates: count(value?.readiness?.unresolvedCandidates),
  response: present ? 'local' : 'unavailable',
  discovery: 'unverified',
  history: checkpoint ? 'checkpoint-partial' : 'unverified',
  fileInventory: partialFiles ? 'partial' : 'unverified',
  fileBytes: 'unverified',
  authoritativeEmpty: false
 };
}
