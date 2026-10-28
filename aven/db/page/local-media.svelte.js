// @ts-nocheck
// One local media resolver for profiles, posts and legacy content hashes. No HTTP fallback.
import { localFileEntries, pinnedEntries } from '../../../maia/content/game/code/sources/file-entries.js';
import { deviceOf, wantNow } from '../../../maia/content/game/code/sources/device.js';
import { mediaEntry, forgetMedia, resetMedia } from './local-media-state.js';
import { useLocalMedia } from '$lib/media/local-resolver.js';
import { localDevice } from './local.js';
import { native } from '$lib/native';
import { avenRef, avenUrl } from '$lib/media/ref.js';
import { whole, mediaOf, serve, address } from './files.js';
const urls = $state({});
const wanted = new Map();
let loading;
let timer;
let owner;
let streaming;
let snapshot;
let snapshotDevice;
function useMediaDevice(device) {
    if (device === owner) return;
    resetMedia(urls, wanted, url => URL.revokeObjectURL(url));
    streaming?.stop(); streaming = null; owner = device;
}
// Reuse the session's world snapshot; no separate metadata fetch on every profile render.
export function localMediaWorld(world) {
	snapshot = world;
	snapshotDevice = deviceOf();
    useMediaDevice(snapshotDevice);
	void refreshLocalMedia();
}

/** The URL of file `name` of vault `vault` this device holds, '' until it is read. A file the caller knows by its entry
 *  (`entry`, as the media manifest pins Maia City's public files) is read by that entry alone, never by listing the
 *  vault's files to find its name. */
export function localMedia(vault, name, entry) {
	if (typeof window === 'undefined' || !name) return '';
    useMediaDevice(deviceOf());
	const key = `${vault || ''}/${name}`;
	if (!wanted.has(key)) {
		const pin = typeof entry === 'string' && /^[0-9a-f]{64}$/.test(entry) ? entry : undefined;
		wanted.set(key, { vault, name, pin });
		// what the screen shows now: its entry before anything else this page wants
		if (pin) wantNow([pin]);
		queueMicrotask(refreshLocalMedia);
	}
	return urls[key] || '';
}

export function refreshLocalMedia() {
	if (loading) return loading;
	loading = (async () => {
		const d = await localDevice();
        if (d !== deviceOf()) return;
        useMediaDevice(d);
		if (!d || !wanted.size) return;
        // Freeze demand across awaits: a newly requested vault is not an empty result.
        const requests = [...wanted];
        let world = snapshotDevice === d && snapshot;
        if (!world || world.entriesComplete === false) {
            // Pinned files by their entries (the engine's index of entries by id), the rest by their vault's files:
            // a view costs what it shows, never a scan of Maia City's thousands of files for six covers.
            const pins = requests.map(([, request]) => request.pin).filter(Boolean);
            const named = requests.filter(([, request]) => !request.pin).map(([, request]) => request.vault);
            world = { entries: [
                ...(pins.length ? await pinnedEntries(d, pins) : []),
                ...(named.length ? await localFileEntries(d, { vaults: named }) : [])
            ] };
        }
		if (d !== deviceOf()) return;
		for (const [key, request] of requests) {
			const entry = mediaEntry(world, request);
            if (entry === undefined) continue; // an incomplete summary is not a deletion
			if (entry && request.entry !== entry.entry) { wantNow([entry.entry]); request.entry = entry.entry; }
			const file = entry?.files?.[0];
			if (!file || file.len == null) {
				forgetMedia(urls, key, request, url => URL.revokeObjectURL(url));
				continue;
			}
			if (request.root === file.root) continue;
			try {
				const read = async (root, size, from, to) => {
					const answer = await d.run({ op: 'read_file', root, size, from, to, local: true });
					if (!answer?.bytes) throw new Error('Waiting for local file sync');
					return answer.bytes;
				};
				const mime = mediaOf({ name: entry.title, type: entry.media || '' });
				let url;
				if (mime.startsWith('image/')) url = URL.createObjectURL(await whole(read, file, mime));
				else if (native()) url = avenUrl(avenRef(file, mime));
				else {
					streaming ??= serve(read);
					if (await streaming.ready) url = address(file, mime);
					else url = URL.createObjectURL(await whole(read, file, mime));
				}
                if (d !== deviceOf()) {
                    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
                    return; // never publish a completed old-device read into its replacement
                }
				const old = urls[key];
				urls[key] = url;
				request.root = file.root;
				if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
			} catch { /* Retry after background sync; never fetch from a peer here. */ }
		}
	})().catch(() => {}).finally(() => {
		loading = null;
		// Only what isn't shown yet is asked again; what changes later comes with the session's next world
		// (localMediaWorld), so a shown picture costs nothing more.
		const waiting = [...wanted.keys()].some((key) => !urls[key]);
		if (!timer && waiting) timer = setTimeout(() => { timer = null; void refreshLocalMedia(); }, snapshot ? 15000 : 5000);
	});
	return loading;
}

useLocalMedia(localMedia);
