// The network's room (MILESTONE2.md, "What a person sees"): its chat lines and who is present, pushed by this origin's
// Peer-Light and never re-queried (README, rule 8). Each line arrives once; nothing is kept, so a reload empties it.
// The network's invites and their states come the same way, in its `network` lines.
export const room = $state({ lines: [], present: [], invites: null });

const keep = 500;
let port;

// the worker's port this page talks through, set by whoever runs the Peer-Light
export function speakThrough(worker) {
	port = worker;
}

// a line from the Peer-Light: a chat line, the room's presence (device names), or the network's invites
export function hear(line) {
	if (line.event === 'chat') {
		room.lines.push({ from: line.from, vault: line.vault, text: line.text, at: line.at });
		if (room.lines.length > keep) room.lines.splice(0, room.lines.length - keep);
	}
	if (line.event === 'room') room.present = line.present;
	if (line.event === 'network' && 'invites' in line) room.invites = line.invites ?? null;
}

// a line written here: the Peer-Light signs it with this device's key and gossips it; it comes back as a chat line
export function say(text) {
	const line = text.trim();
	if (line && port) port.postMessage({ say: line });
}
