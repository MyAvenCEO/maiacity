// @ts-nocheck
// One local media resolver for profiles, posts and legacy content hashes. No HTTP fallback.
import { deviceOf, learn } from '../../../game/code/sources/device.js';
import { localFile } from '$lib/media/local-file.js';
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
// Reuse the session's world snapshot; no separate metadata fetch on every profile render.
export function localMediaWorld(world) {
	snapshot = world;
	snapshotDevice = deviceOf();
	void refreshLocalMedia();
}

export function localMedia(vault, name) {
	if (typeof window === 'undefined' || !name) return '';
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
		if (d !== owner) {
			for (const key of Object.keys(urls)) { if (urls[key]?.startsWith('blob:')) URL.revokeObjectURL(urls[key]); delete urls[key]; }
			for (const item of wanted.values()) { delete item.root; delete item.entry; }
			streaming?.stop(); streaming = null; owner = d;
		}
		if (!d) return;
		const world = (snapshotDevice === d && snapshot) || (await d.run({ op: 'world' }))?.ok;
		const entries = world?.entries || [];
		for (const [key, request] of wanted) {
			const entry = localFile(entries, request.vault, request.name);
			if (entry && request.entry !== entry.entry) { learn([entry.entry]); request.entry = entry.entry; }
			const file = entry?.files?.[0];
			if (!file || file.len == null) {
				if (urls[key]?.startsWith('blob:')) URL.revokeObjectURL(urls[key]);
				delete urls[key]; delete request.root;
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
