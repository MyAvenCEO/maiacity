import { localFile } from '../../../maia/site/lib/media/local-file.js';

/** Resolve only complete local collections. undefined means not enumerated;
 * null means a complete local collection has no such entry. A pinned request (`pin`, its file's entry) is that entry
 * or nothing: one the device doesn't hold yet is not a deletion.
 * @param {any} world @param {{vault:string,name:string,pin?:string}} request */
export function mediaEntry(world, request) {
 if (!world || world.entriesComplete === false) return undefined;
 if (request.pin) return world.entries?.find((/** @type {any} */ e) => e.entry === request.pin && !e.deleted) ?? undefined;
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
