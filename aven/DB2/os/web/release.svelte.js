// A newer release, switched to at a safe point (PEERS.md §7). The Service Worker (public/files-sw.js) checks for a
// newer release record when the app opens and every hour, downloads the release in the background and has this
// origin's Peer-Light check it (`Aven.ID.Release.check`), then tells every tab it is ready. A tab switches only at a
// safe point: the one writer has flushed (its draft is on disk, no line it said is still on its way into the store), no
// post is half written (no file still going into the store), and the tab is hidden or has been idle a minute. Then the
// Service Worker keeps the checked release as the shell, and the tab shows "Updating…" and reloads. A tab refused with
// `update` doesn't wait for any of this (update.svelte.js).
// `release`: the newest word from the Service Worker, for avenOS and the box's check: `ready` (a version, signed or not),
// `refused` (why), `running` (the counter of the release this origin runs)
import { keepDraft, room } from './room.svelte.js';
import { update } from './update.svelte.js';

export const release = $state({ ready: null, refused: null, running: null });

const idle = 60_000;
const hour = 60 * 60_000;
let touched = Date.now();
const safe = () =>
	room.sharing.length === 0 && room.writing.length === 0 && (document.visibilityState === 'hidden' || Date.now() - touched >= idle);

async function switchNow(worker) {
	if (update.now) return;
	update.now = true;
	const why = await keepDraft(true);
	// a draft that couldn't be kept is a reason to wait, not to lose it
	if (why) {
		update.now = false;
		return;
	}
	worker.postMessage({ release: 'switch', counter: release.ready.counter });
}

export function followReleases() {
	const sw = navigator.serviceWorker;
	if (!sw) return;
	for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(event, () => (touched = Date.now()), { passive: true });
	sw.addEventListener('message', ({ data }) => {
		if (data?.release === 'ready') release.ready = { version: data.version, counter: data.counter, signed: data.signed };
		if (data?.release === 'refused') release.refused = data.why;
		if (data?.release === 'running') release.running = data.counter;
		// switched by this tab or another: this one reloads too, at its own safe point
		if (data?.release === 'switched') release.ready = { ...release.ready, counter: data.counter, switched: true };
		if (data?.release === 'reload') location.reload();
		globalThis.__avenRelease = $state.snapshot(release);
	});
	const ask = () => sw.controller?.postMessage({ release: 'check' });
	sw.ready.then(ask);
	sw.addEventListener('controllerchange', ask);
	setInterval(ask, hour);
	// at a safe point, the tab switches: asked again every second and whenever it is hidden
	const tryNow = () => {
		if (!release.ready || update.now || !safe()) return;
		sw.ready.then((r) => r.active && switchNow(r.active));
	};
	setInterval(tryNow, 1_000);
	document.addEventListener('visibilitychange', tryNow);
}
