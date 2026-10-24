// @ts-nocheck
// One local media resolver for profiles, posts and legacy content hashes. No HTTP fallback.
import { localFileEntries } from '../../../game/code/sources/file-entries.js';
import { deviceOf, learn } from '../../../game/code/sources/device.js';
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

export function localMedia(vault, name) {
	if (typeof window === 'undefined' || !name) return '';
    useMediaDevice(deviceOf());
	const key = `${vault || ''}/${name}`;
	if (!wanted.has(key)) {
		wanted.set(key, { vault, name });
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
            world = { entries: await localFileEntries(d, { vaults: requests.map(([, request]) => request.vault) }) };
        }
		if (d !== deviceOf()) return;
		for (const [key, request] of requests) {
			const entry = mediaEntry(world, request);
            if (entry === undefined) continue; // an incomplete summary is not a deletion
			if (entry && request.entry !== entry.entry) { learn([entry.entry]); request.entry = entry.entry; }
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
		if (!timer && wanted.size) timer = setTimeout(() => { timer = null; void refreshLocalMedia(); }, snapshot ? 15000 : 5000);
	});
	return loading;
}

useLocalMedia(localMedia);
