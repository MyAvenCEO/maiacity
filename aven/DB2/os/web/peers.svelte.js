// What avenOS knows of the peers, pushed and never re-queried (README, rule 8). The box's timeline arrives as
// server-sent events, a backlog and then each new line; a Peer-Light's own lines come straight from its worker. Each
// peer's status is its newest status line, and its record (the first start it keeps through its store) its newest
// stored line.
import { askThrough, hearViews } from './id.svelte.js';
import { openWorker } from './peer/open.js';
import { hear, speakThrough } from './room.svelte.js';

export const live = $state({ timeline: [], status: {}, paths: {}, stored: {}, own: null, ownStored: null });

const keep = 300;
// whether the box's timeline is this page's: not on an Aven Peer's host without a cast, whose peers aren't the box's
export const timeline = { box: true };

export function take(line) {
	live.timeline.push(line);
	if (live.timeline.length > keep) live.timeline.splice(0, live.timeline.length - keep);
	if (line.event === 'status') live.status[line.peer] = line;
	if (line.event === 'stored') live.stored[line.peer] = line;
	if (line.event === 'stopped' || line.event === 'failed') live.status[line.peer] = { ...line, phase: 'offline', peers: 0 };
	// the paths the Aven Peer sees its peers on, for "relays N"
	if (line.peer === 'aven-peer' && line.event === 'joined') live.paths[line.from] = line.path;
	if (line.peer === 'aven-peer' && line.event === 'left') delete live.paths[line.from];
}

let following = false;
// The whole timeline, for the Control Room.
export function follow() {
	if (following || !timeline.box) return;
	following = true;
	new EventSource('/events').onmessage = ({ data }) => take(JSON.parse(data));
}

// The box's configuration for a Peer-Light of the cast: its test signer's seed, sha256("avenSANDBOX test signer: <id>"),
// public on purpose and valid only inside the box, the Aven Peer's key, the cast's members, and the cast's tree, whose
// views the Peer-Light pushes (id.svelte.js).
async function configure(cast, me) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`avenSANDBOX test signer: ${me}`));
	const secret = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	// the door's members are the cast's (MILESTONE2.md), as the Peers are given them
	const members = Object.keys(cast.peers).map((id) => `${id}=${cast.keys[id]}`).join(',');
	return { name: me, secret, avenKey: cast.keys['aven-peer'], avenName: 'aven-peer', members, cast: JSON.stringify(cast) };
}

// Runs this origin's Peer-Light: one shared worker per origin, whatever the tabs and frames.
export async function runLight(cast, me) {
	const { port } = openWorker(me);
	let start;
	port.onmessage = ({ data }) => {
		const line = JSON.parse(data);
		hearViews(line);
		if (line.event === 'start?' && start) port.postMessage({ start });
		if (line.event === 'status' || line.event === 'failed') live.own = line.event === 'failed' ? { ...line, phase: 'offline', peers: 0 } : line;
		if (line.event === 'stored') live.ownStored = line;
		hear(line);
	};
	start = await configure(cast, me);
	speakThrough(port, start);
	askThrough(port, start);
	port.start?.();
	port.postMessage({ start });
}

// The box's own view (localhost) serves no vault and runs no peer, but its views come from the Peer-Light all the
// same: its worker loads the core and pushes every view of the cast's tree as the box sees it, acting as every person.
export function runBox(cast) {
	const { port } = openWorker('box');
	const box = { cast: JSON.stringify(cast) };
	// a worker nobody started asks for its start: here, the box's views
	port.onmessage = ({ data }) => {
		const line = JSON.parse(data);
		if (line.event === 'start?') port.postMessage({ box });
		hearViews(line);
	};
	askThrough(port);
	port.start?.();
	port.postMessage({ box });
}

// "first started 20:14:03 · kept": a record's line, as a person reads it
export const record = (stored) =>
	stored ? `first started ${new Date(stored.first).toLocaleTimeString('en-GB')}${stored.kept ? ' · kept' : ' · new'}` : 'no record yet';

// "● live · 4 peers"
export const describe = (status) =>
	status ? `${status.phase}${status.phase === 'live' ? ` · ${status.peers} peer${status.peers === 1 ? '' : 's'}` : ''}` : 'starting';
