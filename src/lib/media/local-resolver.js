// The host installs its local avenDB resolver. Pure so recipe code can use media URLs too.
/** @type {(vault: string, name: string) => string} */
let resolve = () => '';
/** @param {(vault: string, name: string) => string} reader */
export const useLocalMedia = reader => { resolve = reader; };
/** @param {string} vault @param {string} name */
export const localMedia = (vault, name) => resolve(vault, name);
