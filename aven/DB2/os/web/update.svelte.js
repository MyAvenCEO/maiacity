// Upgrades are a clean refusal (PEERS.md §7): a peer of another wire version answers this tab's Peer-Light `update`,
// and the one behind follows (`Aven.DB.Wire.follows`). A tab that is behind switches at once: its draft is kept in OPFS
// first (room.svelte.js), then it reloads, and the Service Worker's network-first page brings the newer release. Until
// then the page shows "Updating…" and nothing else. A tab ahead of the peer that refused it waits for that peer instead.
// A host that still serves the older release would refuse the reloaded tab again: it then waits a minute before the next
// reload (`aven.update` in this tab's session), so it never reloads in a loop.
import { keepDraft } from './room.svelte.js';

export const update = $state({ now: false, wire: null });

const key = 'aven.update';
const pause = 60_000;
const session = {
	get() {
		try {
			return JSON.parse(sessionStorage.getItem(key) ?? 'null');
		} catch {
			return null;
		}
	},
	set(value) {
		try {
			sessionStorage.setItem(key, JSON.stringify(value));
		} catch {}
	},
};

// a timeline line from this tab's Peer-Light
export function hearUpdate(line) {
	if (line.event !== 'update' || !line.follows || update.now) return;
	follow(line.theirs);
}

async function follow(wire) {
	update.now = true;
	update.wire = wire;
	await keepDraft(true);
	const last = session.get();
	const wait = last?.wire === wire ? Math.max(0, last.at + pause - Date.now()) : 0;
	setTimeout(() => {
		session.set({ wire, at: Date.now() });
		location.reload();
	}, wait);
}
