// The host installs its local avenDB resolver. Pure so recipe code can use media URLs too.
/** @type {(vault: string, name: string, entry?: string) => string} */
let resolve = () => '';
/** @param {(vault: string, name: string, entry?: string) => string} reader */
export const useLocalMedia = reader => { resolve = reader; };
/** File `name` of vault `vault`; `entry`, its entry where the caller knows it, reads it by that alone.
 * @param {string} vault @param {string} name @param {string} [entry] */
export const localMedia = (vault, name, entry) => resolve(vault, name, entry);
