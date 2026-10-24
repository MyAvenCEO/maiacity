import { localFile } from '../media/local-file.js';

/** Resolve only complete local collections. undefined means not enumerated;
 * null means a complete local collection has no such entry.
 * @param {any} world @param {{vault:string,name:string}} request */
export function mediaEntry(world, request) {
 if (!world || world.entriesComplete === false) return undefined;
 return localFile(world.entries ?? [], request.vault, request.name) ?? null;
}

/** @param {Record<string,string>} urls @param {string} key @param {any} request
 * @param {(url:string)=>void} revoke */
export function forgetMedia(urls, key, request, revoke) {
 if (urls[key]?.startsWith('blob:')) revoke(urls[key]);
 delete urls[key]; delete request.root; delete request.entry;
}

/** Device replacement invalidates even URLs whose old snapshot was incomplete.
 * @param {Record<string,string>} urls @param {Map<string,any>} wanted
 * @param {(url:string)=>void} revoke */
export function resetMedia(urls, wanted, revoke) {
 for (const key of Object.keys(urls)) forgetMedia(urls,key,wanted.get(key) ?? {},revoke);
 for (const request of wanted.values()) { delete request.root; delete request.entry; }
}
