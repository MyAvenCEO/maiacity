/*
 * SANDBOX 8'S GAME, BROUGHT FROM AVENDB — the one build of Constructible City this app runs (./build.mjs), pinned by
 * the BLAKE3 hash of its bytes (./build.json): a file entry of the Maia City vault tagged `blake3:<that hash>`
 * (scripts/propose-code.mjs proposes it, its package `sandbox-8`), read off the person's own avenDB device, never off a
 * server, and run only when its bytes hash to the pin. Anything else is refused, saying why.
 */
import { hashBytes } from '../../../game/hash.js';
import { MAIA_CITY } from '../../../game/code/sources/feed.js';
import { deviceFile, deviceOf } from '../../../game/code/sources/device.js';
import { localDevice } from '$lib/avendb/local.js';
import PIN from './build.json';

/** How long the page waits for its device to read the build, which is about 6 MB. */
const WAIT = 60_000;

/** the tag the vault's file entry of the pinned build carries */
export const PIN_TAG = `blake3:${PIN.file.blake3}`;

/**
 * The newest file the Maia City entry tagged with the pin brings, as the device's entry views list them; undefined
 * where the device holds none (yet).
 * @param {{ ok?: { rows?: any[] } } | null | undefined} out what the device answered `entry_views`
 * @returns {{ root: string, size: number, len: number } | undefined}
 */
export function pinnedFile(out) {
	const rows = out?.ok?.rows ?? [];
	const entry = rows.find((e) => e?.vault === MAIA_CITY && e.type === 'file' && !e.deleted && (e.tags ?? []).includes(PIN_TAG) && !(e.tags ?? []).includes('avendb:deleted'));
	return entry?.files?.at(-1);
}

/**
 * The pinned build's bytes, from this page's avenDB device: refused where no device is open, it holds no entry of the
 * build yet, can't read its file, or the bytes are not the pinned ones.
 * @returns {Promise<Uint8Array>}
 */
export async function pinnedBytes() {
	const d = deviceOf() ?? (await localDevice());
	if (!d) throw new Error('Sandbox 8 comes from avenDB: sign in, or open it in theOS, so this page has a device to bring it from');
	const file = pinnedFile(await d.run({ op: 'entry_views', vault: MAIA_CITY, types: ['file'] }));
	if (!file) throw new Error(`this device holds no Maia City file entry of Sandbox 8's build yet (${PIN.file.name}, ${PIN_TAG})`);
	if (file.len !== PIN.file.size) throw new Error(`the vault's file of Sandbox 8's build is ${file.len ?? 'not yet readable'} bytes, the pin says ${PIN.file.size}`);
	const bytes = await deviceFile(file, { wait: WAIT });
	if (!bytes) throw new Error(`this device couldn't read Sandbox 8's build (${PIN.file.name}) in ${WAIT / 1000} s`);
	if (hashBytes(bytes) !== PIN.file.blake3) throw new Error(`the vault's file of Sandbox 8's build doesn't hash to its pin (${PIN_TAG}): it doesn't run`);
	return bytes;
}

/**
 * The pinned build as a module (`mountCity(root, host)`), from its checked bytes.
 * @returns {Promise<{ mountCity: (root: HTMLElement, host: object) => () => void }>}
 */
export async function pinnedCity() {
	const url = URL.createObjectURL(new Blob([/** @type {BlobPart} */ (await pinnedBytes())], { type: 'text/javascript' }));
	try {
		return await import(/* @vite-ignore */ url);
	} finally {
		URL.revokeObjectURL(url);
	}
}
