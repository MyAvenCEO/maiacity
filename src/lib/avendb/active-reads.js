/** Counts only mounted read windows. Responses are not proof of peer discovery.
 * No entry IDs, data, owners or query contents are retained. */
const windows = new Map();
const listeners = new Set();
const snapshot = () => ({ total: windows.size, pending: [...windows.values()].filter(v => v === 'pending').length, local: [...windows.values()].filter(v => v === 'local').length });
const emit = () => { const value = snapshot(); for (const listener of listeners) listener(value); };
export function activeRead() {
 const token = {};
 return {
  set(state) { windows.set(token, state); emit(); },
  clear() { if (windows.delete(token)) emit(); }
 };
}
export function watchActiveReads(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); }
