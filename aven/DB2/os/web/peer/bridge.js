// The Service Worker's way to the Peer-Light (store/README.md, the opfs driver, 5): it can't hold the leader's worker,
// so it asks over the same BroadcastChannel every tab uses, `aven-peer-light:<name>`. `read(name, file, start, end)`
// resolves to `{ size, type, bytes }` (at most 1 MiB from `start`; `size` is the whole file's, for Content-Range) or
// rejects with the leader's reason ("not found" for a file nobody has). A read unanswered for 2 s is sent again, so a
// takeover in between loses nothing; after 20 s it gives up.
const channels = new Map();
let n = 0;
const prefix = `sw-${crypto.randomUUID()}-`;

export function read(name, file, start, end) {
	const key = `aven-peer-light:${name}`;
	let channel = channels.get(key);
	if (!channel) channels.set(key, (channel = new BroadcastChannel(key)));
	const id = `${prefix}${n++}`;
	return new Promise((resolve, reject) => {
		const ask = () => channel.postMessage({ id, read: { file, start, end } });
		const again = setInterval(ask, 2_000);
		const gaveUp = setTimeout(() => done(() => reject(new Error('the Peer-Light did not answer in 20 s'))), 20_000);
		const done = (settle) => {
			clearInterval(again);
			clearTimeout(gaveUp);
			channel.removeEventListener('message', hear);
			settle();
		};
		const hear = ({ data }) => {
			if (data?.id !== id || data.read) return;
			done(() => (data.error === undefined ? resolve({ size: data.size, type: data.type, bytes: data.bytes }) : reject(new Error(data.error))));
		};
		channel.addEventListener('message', hear);
		ask();
	});
}
