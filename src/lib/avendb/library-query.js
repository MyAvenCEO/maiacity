/** Preserve Library's semantic file kind, including custom schemas readable as files.
 * Do not narrow this to type=file: that would omit valid existing Library rows.
 * @param {string} vault @param {string} actor */
export const libraryFilesQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, kind: 'file' });
/** Derived previews and outputs come from completed task records in this vault.
 * @param {string} vault @param {string} actor */
export const libraryTasksQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, types: ['task'] });
/** Explicit related file dependencies, bounded by entry_views' request limit.
 * The read still checks current acting-vault access, including cross-vault files.
 * @param {import('./vaults.js').EntryView[]} rows @param {string} actor */
export function libraryRelatedQuery(rows, actor) {
 const ids = new Set();
 for (const row of rows) {
  const task = /** @type {any} */ (row.record);
  if (row.type !== 'task' || task?.status !== 'done') continue;
  const outputs = Array.isArray(task.outputs) ? task.outputs : [];
  const inputs = Array.isArray(task.inputs) ? task.inputs : [];
  for (const id of [...outputs, ...inputs.map((/** @type {any} */ input) => input?.entry)])
   if (typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)) ids.add(id);
 }
 return { op: 'entry_views', entries: [...ids].sort().slice(0, 512), as: actor, kind: 'file' };
}
