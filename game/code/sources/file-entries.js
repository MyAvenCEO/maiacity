// Local file inventory only: never project unrelated note/chat/game bodies.
// Completion here means enumeration of held local files, not peer/history coverage.
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
