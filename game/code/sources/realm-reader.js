// A same-origin frame borrows a local transport, not the parent realm's objects.
// Clone at this boundary, just as IPC/postMessage does, before any local schema checks.
/** @typedef {{run: (op: object) => Promise<any>, read: (root: string, size: number, from: number, to: number) => Promise<Uint8Array>}} Reader */
/** @type {WeakMap<Reader, Reader>} */
const readers = new WeakMap();
/** @param {Reader | null} device @returns {Reader | null} */
export function realmReader(device) {
 if (!device) return null;
 let reader = readers.get(device);
 if (!reader) {
  reader = {
   run: async (op) => structuredClone(await device.run(op)),
   read: async (...args) => structuredClone(await device.read(...args))
  };
  readers.set(device, reader);
 }
 return reader;
}
