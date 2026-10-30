// The timeline's lines as a person reads them (SANDBOX.md, "The Control Room"):
// `20:14:03.120  Alice Peer → Aven Peer  connected, direct (UDP)`.
const backends = { s3: 'S3', fs: 'a folder', opfs: 'OPFS', memory: 'memory' };
const how = (path) => (path === 'direct' ? 'direct (UDP)' : path === 'relay' ? 'through the relay' : 'no path yet');

export function read(cast, line) {
	const name = (id) => cast.peers[id]?.name ?? id;
	const at = new Date(line.t);
	const time = `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, '0')}`;
	const who = name(line.peer);
	const what = {
		started: () => [who, 'started'],
		relay: () => [who, `relay on ${line.listen}`],
		connected: () => [`${who} → ${name(line.to)}`, `connected, ${how(line.path)}`],
		path: () => [`${who} → ${name(line.to)}`, `now ${how(line.path)}`],
		lost: () => [`${who} → ${name(line.to)}`, `lost: ${line.why}`],
		joined: () => [`${who} ← ${name(line.from)}`, `joined, ${how(line.path)}`],
		left: () => [`${who} ← ${name(line.from)}`, 'left'],
		status: () => [who, `${line.phase}${line.phase === 'live' ? ` · ${line.peers} peers` : ''}`],
		stored: () => [who, `${line.kept ? 'found its record' : 'wrote its first record'} in ${backends[line.store] ?? line.store}, blob ${line.blob.slice(0, 8)}…`],
		stopped: () => [who, 'stopped'],
		failed: () => [who, `failed: ${line.why}`],
		refused: () => [who, `refused a key not in the cast`],
	}[line.event] ?? (() => [who, line.event]);
	const [between, said] = what();
	return { time, between, said };
}
