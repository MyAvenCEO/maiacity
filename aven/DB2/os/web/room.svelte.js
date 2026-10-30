// The network's room, the city-dome (MILESTONE2.md, "What a person sees"; store/README.md): its chat lines and who is
// present, pushed by this origin's Peer-Light and never re-queried (README, rule 8). The lines are the chat's history,
// which the Peer-Light keeps in its store: after a reload it tells them again, and catches up on the rest. Each line
// has a name (its blob's hash) and shows once, ordered by time, then device. A line written here shows at once, local
// first, and says when it has gone out (`sent`). A file is a line that announces it; it shows from /files/<hash>.
// The network's invites and their states come the same way, in its `network` lines.
// `refused`: why the Peer-Light refused the last line written here; `sharing`: files on their way into the store
import { putChunk, shareFile } from './id.svelte.js';

export const room = $state({ lines: [], present: [], invites: null, refused: null, sent: {}, sharing: [] });

const chunk = 1 << 20;
const before = (a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : a.seq - b.seq);
let port;
let starting;

// the worker's port this page talks through, and the start it gives the Peer-Light, set by whoever runs it: the start
// goes with every line, for a worker nobody has started yet (peer/worker.js)
export function speakThrough(worker, start) {
	port = worker;
	starting = start;
}

// a line from the Peer-Light: a chat line, the room's presence (device names), or the network's invites
export function hear(line) {
	if (line.event === 'chat') {
		const said = { id: line.id, from: line.from, vault: line.vault, key: line.key, seq: line.seq, text: line.text, at: line.at, file: line.file ?? null };
		// a line is shown once, by its name; told again (its sender named now), it changes in place. A line without a name
		// (milestone 2's `say`) shows every time
		// a line written before this device knew its own head, chained now, takes its queued line's place
		if (line.replaces) room.lines = room.lines.filter((l) => l.id !== line.replaces);
		const shown = said.id ? room.lines.findIndex((l) => l.id === said.id) : -1;
		if (shown >= 0) return void (room.lines[shown] = said);
		let at = room.lines.length;
		while (at > 0 && before(room.lines[at - 1], said) > 0) at--;
		room.lines.splice(at, 0, said);
	}
	if (line.event === 'sent') for (const id of line.ids ?? []) room.sent[id] = true;
	if (line.event === 'room') room.present = line.present;
	if (line.event === 'network' && 'invites' in line) room.invites = line.invites ?? null;
	if (line.event === 'refused') room.refused = line.why;
}

// a line written here: the Peer-Light signs it with this device's key and gossips it; it comes back as a chat line
export function say(text) {
	const line = text.trim();
	if (!line || !port) return;
	room.refused = null;
	port.postMessage({ start: starting, say: line });
}

// A file dropped into the chat: read a chunk at a time into this origin's store, then shared as a line. It shows once
// its line is in the store, before any peer has it; `sharing` says how far it is until then.
export async function share(file) {
	if (!port) return;
	room.sharing.push({ name: file.name, size: file.size, done: 0 });
	const sharing = room.sharing.at(-1);
	room.refused = null;
	try {
		const chunks = [];
		for (let at = 0; at < file.size; at += chunk) {
			const bytes = new Uint8Array(await file.slice(at, at + chunk).arrayBuffer());
			chunks.push(await putChunk(bytes));
			sharing.done = Math.min(at + chunk, file.size);
		}
		await shareFile(file.name, file.type || 'application/octet-stream', file.size, JSON.stringify(chunks));
	} catch (error) {
		room.refused = `${file.name}: ${error.message}`;
	} finally {
		room.sharing = room.sharing.filter((s) => s !== sharing);
	}
}
