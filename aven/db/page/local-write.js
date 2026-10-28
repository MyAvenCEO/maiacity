/**
 * Only a change explicitly conditioned on displayed heads waits for entry freshness.
 * Ordinary local edits run on the authorized local state even while peers catch up.
 * This is a scheduling gate, never an authorization check or a write acknowledgement.
 * The engine still validates the operation and its heads at execution time.
 * @param {any} op
 * @param {{ behind: boolean, bring: (entry: string) => Promise<any>, refresh: () => Promise<any>,
 *   waiting?: (on: boolean) => void, timeoutMs?: number }} options
 */
export async function beforeLocalWrite(op, { behind, bring, refresh, waiting = () => {}, timeoutMs = 8000 }) {
	const entry = typeof op?.entry === 'string' && /^[0-9a-f]{64}$/i.test(op.entry) ? op.entry : null;
	if (!entry || !op.heads || !behind) return;
	let timer;
	let brought;
	waiting(true);
	try {
		brought = await Promise.race([
			bring(entry),
			new Promise((done) => { timer = setTimeout(() => done(null), timeoutMs); })
		]);
	} finally {
		clearTimeout(timer);
		waiting(false);
	}
	if (brought?.ok?.new) {
		await refresh();
		throw new Error('It changed on your other devices while this one was still syncing. Here it is as it is now: look at it again, then answer.');
	}
}
