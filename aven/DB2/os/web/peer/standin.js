// A STAND-IN for thread A's messages (sandbox/standin.mjs), used by the worker only while the Peer-Light has no `say`:
// the page's chat lines, invites, withdrawals and joins go to the box's stand-in instead of the Peer-Light, the real
// Aven Peer's `network` lines go there too, and what the stand-in says comes back to the pages as the Peer-Light's
// lines would. It goes once thread A lands.
const ours = new Set(['invite', 'withdraw', 'join']);
let device;

export const standing = (light) => typeof light?.say !== 'function';

// the Peer-Light's line, before the pages see it: false when the stand-in takes it instead
export function before(line, toPages) {
	const parsed = JSON.parse(line);
	if (parsed.event === 'started' && !device && /^device-/.test(parsed.peer)) {
		device = parsed.peer;
		new EventSource(`/standin?device=${device}`).onmessage = ({ data }) => toPages(data);
	}
	if (parsed.event !== 'network' || !device) return true;
	post({ network: { claimed: parsed.claimed, tree: parsed.tree } });
	return false;
}

// a page's message the stand-in answers, or false
export function take(data) {
	if (!device) return false;
	if (data?.say) return post({ say: data.say }), true;
	const frame = data?.send && JSON.parse(data.send);
	if (frame && ours.has(frame.frame)) return post({ frame }), true;
	return false;
}

function post(body) {
	fetch('/standin', { method: 'POST', body: JSON.stringify({ device, ...body }) }).catch(() => {});
}
