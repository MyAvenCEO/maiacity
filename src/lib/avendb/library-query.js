/** Preserve Library's semantic file kind, including custom schemas readable as files.
 * Do not narrow this to type=file: that would omit valid existing Library rows.
 * @param {string} vault @param {string} actor */
export const libraryFilesQuery = (vault, actor) => ({ op: 'entry_views', vault, as: actor, kind: 'file' });
/** Derived previews may be produced in any authorized vault. Preserve the old global task scope.
 * @param {string} vault @param {string} actor */
export const libraryTasksQuery = (vault, actor) => ({ op: 'entry_views', as: actor, types: ['task'] });
/** Explicit related file dependencies, bounded by entry_views' request limit.
 * The read still checks current acting-vault access, including cross-vault files.
 * @param {Pick<import('./vaults.js').EntryView, 'type'|'record'>[]} rows @param {string} actor @param {string} [selected] */
export function libraryRelatedQueries(rows, actor, selected = '') {
 const ids = new Set(), preferred = new Set(selected ? [selected] : []);
 for (const row of rows) {
  const task = /** @type {any} */ (row.record);
  if (row.type !== 'task' || task?.status !== 'done') continue;
  const outputs = Array.isArray(task.outputs) ? task.outputs : [];
  const inputs = Array.isArray(task.inputs) ? task.inputs : [];
  const related = [...outputs, ...inputs.map((/** @type {any} */ input) => input?.entry)];
  const chosen = selected && related.includes(selected);
  for (const id of related)
   if (typeof id === 'string' && /^[0-9a-f]{64}$/.test(id)) { ids.add(id); if (chosen) preferred.add(id); }
 }
 const ordered = [...ids].sort((a,b) => Number(b === selected) - Number(a === selected) || Number(preferred.has(b)) - Number(preferred.has(a)) || a.localeCompare(b)), queries = [];
 for (let offset = 0; offset < ordered.length; offset += 512)
  queries.push({ op: 'entry_views', entries: ordered.slice(offset, offset + 512), as: actor, kind: 'file' });
 return queries;
}
