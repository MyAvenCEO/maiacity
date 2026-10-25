/** Read only one collection through the universal query engine. Metadata is
 * materialized in small batches, yielding between database turns. This returns
 * held local rows, not a claim that peer discovery is complete.
 * @param {(command: string, op: any) => Promise<any>} call
 * @param {string} type
 * @param {string | null} [vault]
 * @returns {Promise<any[]>}
 */
export async function collectionEntries(call, type, vault = null) {
 const entries = new Map();
 for (let offset = 0; ;) {
  const result = await call('run', {op:'query', where:{type:[type]}, select:[],
   limit:50, offset, ...(vault ? {vault} : {})});
  const page = result?.ok;
  if (!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.count) || page.count < 0)
   throw Error('Collection query did not complete');
  if (page.rows.length) {
   const result = await call('run', {op:'entry_views', entries:page.rows.map((/** @type {{entry: string}} */ row) => row.entry), types:[type]});
   if (!Array.isArray(result?.ok?.rows)) throw Error('Collection metadata did not complete');
   for (const row of result.ok.rows) if (row.type === type && (!vault || row.vault === vault)) entries.set(row.entry, row);
  }
  offset += page.rows.length;
  if (offset >= page.count) return [...entries.values()];
  if (!page.rows.length) throw Error('Collection changed during lookup; retry');
 }
}
