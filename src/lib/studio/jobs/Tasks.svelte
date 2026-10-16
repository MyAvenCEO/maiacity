<!--
	avenDB tasks (plan J0e): the work studio 2.0's rules want, as this Mac's device holds it: each task's rule, what it
	works on, where it stands, and for a held one, Again. The worker on this Mac (./mac.js) starts with it. "Checksum
	test" adds a small file tagged jobs:test to the person's vault, which the test rule picks up (J0f).
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { answer } from '$lib/avendb/ops.js';
	import { BUILT_IN } from './rules.js';
	import { retrying, tasksOf } from './tasks.js';
	import { lines, macWorker, nudge } from './mac.js';

	/** @type {import('./worker.js').Worker | null} */
	let worker = $state(null);
	let ready = $state(false);
	/** @type {import('./tasks.js').Task[]} */
	let tasks = $state([]);
	/** @type {Record<string, string>} each entry's title, by its id */
	let names = $state({});
	let log = $state(/** @type {string[]} */ ([]));
	let error = $state('');
	let adding = $state(false);

	const RULE_NAMES = Object.fromEntries(BUILT_IN.map((r) => [r.key, r.name]));
	const ORDER = { claimed: 0, queued: 1, failed: 2, held: 3, done: 4 };

	async function load() {
		if (!worker) return;
		try {
			const world = await worker.world();
			tasks = tasksOf(world).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.at - a.at);
			names = Object.fromEntries(world.entries.map((/** @type {any} */ e) => [e.entry, e.title || e.record?.title || '']));
			log = [...lines];
			error = '';
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	/** @param {import('./tasks.js').Task} t */
	async function again(t) {
		if (!worker) return;
		answer(await worker.send(retrying(t, t.vault)));
		nudge();
		await load();
	}

	/** A 3 MB file of known bytes, tagged jobs:test, into the person's own vault. */
	async function test() {
		if (!worker) return;
		adding = true;
		try {
			const world = await worker.world();
			const bytes = new Uint8Array(3 << 20).map((_, i) => (i * 31 + 7) % 251);
			const { NativeDevice } = await import('$lib/avendb/native.js');
			const op = { op: 'put_file', vault: world.mine, name: `checksum test ${new Date().toISOString()}.bin`, media: 'application/octet-stream', tags: ['jobs:test'], len: bytes.length };
			answer(await new NativeDevice(/** @type {any} */ ({})).putFile(op, async (at, n) => bytes.subarray(at, at + n)));
			nudge();
			setTimeout(load, 1500);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			adding = false;
		}
	}

	/** @param {number} s seconds since 1970 */
	const when = (s) => new Date(s * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	/** @param {import('./tasks.js').Task} t */
	const what = (t) => {
		if (t.status === 'done') {
			try {
				const r = JSON.parse(t.result || 'null');
				if (r?.blake3) return Object.values(r.blake3).map((h) => String(h).slice(0, 16)).join(' ');
			} catch {}
			return t.outputs.length ? `${t.outputs.length} made` : 'done';
		}
		if (t.status === 'claimed') return `on ${t.worker.slice(0, 8)}`;
		return t.error || (t.attempts ? `tried ${t.attempts}×` : '');
	};

	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null;
	onMount(async () => {
		worker = await macWorker();
		ready = true;
		await load();
		timer = setInterval(load, 4000);
	});
	onDestroy(() => timer && clearInterval(timer));
</script>

<div class="block tasks">
	<div class="hhead">
		<p class="cap">avenDB tasks</p>
		{#if worker}<button class="ghost small" disabled={adding} onclick={test}>{adding ? 'Adding…' : 'Checksum test'}</button>{/if}
	</div>
	{#if !ready}
		<p class="dim">Looking for this Mac's avenDB device…</p>
	{:else if !worker}
		<p class="dim">avenDB isn't open on this Mac yet. Open avenDB once, and its tasks show here.</p>
	{:else}
		{#if error}<p class="bad">{error}</p>{/if}
		<table>
			<tbody>
				{#each tasks.slice(0, 60) as t (t.entry)}
					<tr class={t.status}>
						<td class="when">{when(t.at)}</td>
						<td><span class="kind">{RULE_NAMES[t.rule] ?? t.rule}</span></td>
						<td class="name" title={t.inputs[0]?.entry}>{names[t.inputs[0]?.entry ?? ''] || t.inputs[0]?.entry.slice(0, 12)}</td>
						<td class="st">{t.status}</td>
						<td class="why" title={t.error || t.result}>{what(t)}</td>
						<td class="acts">{#if t.status === 'held' || t.status === 'failed'}<button class="ghost small" onclick={() => again(t)}>Again</button>{/if}</td>
					</tr>
				{:else}
					<tr><td class="dim" colspan="6">No tasks yet.</td></tr>
				{/each}
			</tbody>
		</table>
		{#if log.length}<p class="log">{log[0]}</p>{/if}
	{/if}
</div>

<style>
	.hhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-bottom: 0.35rem;
	}

	.cap {
		margin: 0;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.78rem;
	}

	td {
		padding: 0.35rem 0.45rem;
		border-bottom: 1px solid var(--edge);
		white-space: nowrap;
	}

	.when,
	.dim,
	.log {
		color: var(--dim);
	}

	.kind {
		padding: 0.05rem 0.4rem;
		border-radius: 4px;
		background: var(--hover);
		font-size: 0.7rem;
	}

	.name,
	.why {
		overflow: hidden;
		max-width: 18rem;
		text-overflow: ellipsis;
	}

	.why {
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
	}

	.done .st {
		color: var(--ok);
	}

	.claimed .st {
		color: var(--accent);
	}

	.failed .st,
	.held .st,
	.bad {
		color: var(--bad);
	}

	.acts {
		text-align: right;
	}

	.log {
		margin: 0.4rem 0 0;
		font-size: 0.7rem;
	}
</style>
