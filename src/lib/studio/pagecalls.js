/*
 * The app's page answering the MCP (plan J12, J13; vault/app/src/page.rs): what an agent asks of an avenDB cut that
 * the studio does in its page (a render, a hero frame, the tasks read back as jobs, a held task tried again), done here by the very functions
 * the studio's buttons call (./cuts.js), so there is one implementation. Only these calls; anything else is refused.
 */

/** The calls the MCP may make, by name. @type {Record<string, (a: any) => Promise<unknown>>} */
const CALLS = {
	renderCut: async (a) => (await import('./cuts.js')).renderCut(a.id, a.delivery ?? undefined),
	frameCut: async (a) => {
		if (typeof a.t !== 'number') throw new Error('a frame needs its time, t, in seconds');
		return (await import('./cuts.js')).frameCut(a.id, { t: a.t, shape: a.shape ?? '16:9' });
	},
	cutJobs: async (a) => (await import('./cuts.js')).cutJobs(a.id),
	retryTask: async (a) => {
		const { answer } = await import('$lib/avendb/ops.js');
		const { asIn, device, worldOf } = await import('./cuts.js');
		const { retrying, tasksOf } = await import('./jobs/tasks.js');
		const call = await device();
		if (!call) throw new Error('avenDB is not open in this app.');
		const world = await worldOf(call);
		const t = tasksOf(world).find((x) => x.entry === a.id.slice(5));
		if (!t) throw new Error('No such task on this Mac.');
		if (t.status !== 'held' && t.status !== 'failed') throw new Error(`The task is ${t.status}, not held: nothing to retry.`);
		answer(await call('run', retrying(t, asIn(world, t.vault))));
		(await import('./jobs/mac.js')).nudge();
		return { retried: a.id };
	}
};

/** What each call names: a cut, or a task. */
const NAMES = /** @type {Record<string, string>} */ ({ retryTask: 'task:' });

/** Whether call `name` is one the page answers. @param {string} name */
export const answers = (name) => Object.hasOwn(CALLS, name);

/**
 * Call `name` with `args`, its answer as page.rs takes it: `{ value }` or `{ error }`.
 * @param {string} name @param {any} args
 */
export async function answerOf(name, args) {
	if (!answers(name)) return { error: `the page answers no call named ${name}` };
	const prefix = NAMES[name] ?? 'cut:';
	if (typeof args?.id !== 'string' || !args.id.startsWith(prefix)) return { error: `name it as ${prefix}<entry>` };
	try {
		return { value: (await CALLS[name](args)) ?? null };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

/** Answers the MCP's calls while the page is open (the Mac app only); stops when the returned function is called. */
export async function servePageCalls() {
	const { listen } = await import('@tauri-apps/api/event');
	const { command } = await import('$lib/native');
	return listen('studio-page-call', async ({ payload }) => {
		const { id, name, args } = /** @type {{ id: string, name: string, args: any }} */ (payload);
		const out = await answerOf(name, args);
		await command('page_answer', { id, ...out }).catch(() => {});
	});
}
