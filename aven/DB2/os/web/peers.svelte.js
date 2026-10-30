// What avenOS knows of the peers, pushed and never re-queried (README, rule 8). The box's timeline arrives as
// server-sent events, a backlog and then each new line; a Peer-Light's own lines come straight from its worker. Each
// peer's status is its newest status line.
export const live = $state({ timeline: [], status: {}, paths: {}, own: null });

const keep = 300;

function take(line) {
	live.timeline.push(line);
	if (live.timeline.length > keep) live.timeline.splice(0, live.timeline.length - keep);
	if (line.event === 'status') live.status[line.peer] = line;
	if (line.event === 'stopped' || line.event === 'failed') live.status[line.peer] = { ...line, phase: 'offline', peers: 0 };
	// the paths the Aven Peer sees its peers on, for "relays N"
	if (line.peer === 'aven-peer' && line.event === 'joined') live.paths[line.from] = line.path;
	if (line.peer === 'aven-peer' && line.event === 'left') delete live.paths[line.from];
}

let following = false;
// The whole timeline, for the Control Room.
export function follow() {
	if (following) return;
	following = true;
	new EventSource('/events').onmessage = ({ data }) => take(JSON.parse(data));
}

// The box's configuration for a Peer-Light of the cast: its test signer's seed, sha256("avenSANDBOX test signer: <id>"),
// public on purpose and valid only inside the box, and the Aven Peer's key.
async function configure(cast, me) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`avenSANDBOX test signer: ${me}`));
	const secret = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	return { name: me, secret, avenKey: cast.keys['aven-peer'], avenName: 'aven-peer' };
}

// Runs this origin's Peer-Light: one shared worker per origin, whatever the tabs and frames.
export async function runLight(cast, me) {
	const url = new URL('./peer/worker.js', import.meta.url);
	const shared = typeof SharedWorker === 'function';
	const worker = shared ? new SharedWorker(url, { type: 'module', name: me }) : new Worker(url, { type: 'module' });
	const port = shared ? worker.port : worker;
	port.onmessage = ({ data }) => {
		const line = JSON.parse(data);
		if (line.event === 'status' || line.event === 'failed') live.own = line.event === 'failed' ? { ...line, phase: 'offline', peers: 0 } : line;
	};
	port.start?.();
	port.postMessage({ start: await configure(cast, me) });
}

// "● live · 4 peers"
export const describe = (status) =>
	status ? `${status.phase}${status.phase === 'live' ? ` · ${status.peers} peer${status.peers === 1 ? '' : 's'}` : ''}` : 'starting';
