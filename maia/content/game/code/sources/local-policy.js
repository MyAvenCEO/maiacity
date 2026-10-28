/** Every frontend file read is local. Only explicit sync operations contact peers.
 * Keep this policy shared by the native and browser device adapters.
 * @param {any} op
 */
export const localOperation = (op) => op?.op === 'read_file' ? { ...op, local: true } : op;
