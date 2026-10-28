/**
 * @typedef {{entry: string, deleted?: boolean, files?: {root: string}[], [key: string]: unknown}} FileEntry
 * @typedef {{run: (operation: Record<string, unknown>) => Promise<{ok?: {vaults?: {id: string}[], rows?: FileEntry[], entriesComplete?: boolean}}>}} FileDevice
 */
// Local file inventory only: never project unrelated note/chat/game bodies.
// Completion here means enumeration of held local files, not peer/history coverage.
/** @param {FileDevice} device
 * @param {{vaults?: string[], signal?: AbortSignal}} options
 * @returns {Promise<FileEntry[]>}
 */
export async function localFileEntries(device, { vaults, signal } = {}) {
 const check = () => signal?.throwIfAborted();
 check();
 if (!vaults || vaults.some(v => !v)) {
  const summary = (await device.run({ op: 'world_summary' }))?.ok;
  check();
  if (!Array.isArray(summary?.vaults)) throw new Error('Local vault inventory unavailable');
  vaults = summary.vaults.map(v => v.id);
 }
 if (vaults.some(v => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) throw new Error('Invalid local vault inventory');
 const entries = new Map();
 for (const vault of new Set(vaults)) {
  check();
  const result = (await device.run({ op: 'entry_views', vault, types: ['file'] }))?.ok;
  check();
  if (!Array.isArray(result?.rows) || result.entriesComplete === false) throw new Error('Local file inventory unavailable');
  for (const entry of result.rows) entries.set(entry.entry, entry);
 }
 return [...entries.values()];
}

/**
 * The file entries `ids` names, by the engine's index of entries by id: what a page that knows its files' entries
 * reads, at the cost of those entries alone. An entry this device doesn't hold yet is left out (the page's Interest
 * asks for it).
 * @param {FileDevice} device @param {string[]} ids @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<FileEntry[]>}
 */
export async function pinnedEntries(device, ids, { signal } = {}) {
 signal?.throwIfAborted();
 const entries = [...new Set(ids)].filter(id => /^[a-f0-9]{64}$/.test(id));
 if (!entries.length) return [];
 const rows = [];
 // the engine reads at most 512 entries a call
 for (let at = 0; at < entries.length; at += 512) {
  const result = (await device.run({ op: 'entry_views', entries: entries.slice(at, at + 512), types: ['file'] }))?.ok;
  signal?.throwIfAborted();
  if (!Array.isArray(result?.rows)) throw new Error('Local file entries unavailable');
  rows.push(...result.rows);
 }
 return rows;
}
