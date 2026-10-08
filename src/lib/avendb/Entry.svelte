<!--
	One entry, as the picked device holds it, in five tabs. Read: the document or the todo as an app shows it, and its
	editor where the app may write. JSON: the raw Loro value, what the app reads of it, and the schemas each commit was
	written under. History: every commit, any version opened read-only, two compared, the latest reverted or an earlier
	one restored. Branches: a branch from any version, edited, compared with main, merged or promoted, or forked into
	another space. Access: who may read, write or own it and why, grants and revocations, and who holds each key.
	Opened as the v2 app or the v1 app, on main or any branch.
-->
<script>
	import Access from './Access.svelte';
	import Branches from './Branches.svelte';
	import Doc from './Doc.svelte';
	import History from './History.svelte';
	import Todo from './Todo.svelte';
	import { count, pretty, rank, short, size } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   ask: (title: string, vaults: string[], action: Record<string, unknown>, extra?: string) => void,
	 *   open: (space: string, entry: string) => void,
	 *   space: string,
	 *   entry: string
	 * }}
	 */
	let { world, device, rev, act, ask, open, space, entry } = $props();

	const TABS = /** @type {const} */ ([
		['read', 'Read'],
		['json', 'JSON'],
		['history', 'History'],
		['branches', 'Branches'],
		['access', 'Access']
	]);

	/** @type {'read' | 'json' | 'history' | 'branches' | 'access'} */
	let tab = $state('read');
	/** @type {string | null} the branch it is opened on: null for main */
	let line = $state(null);
	let app = $state('v2');
	/** @type {any} */
	let data = $state(null);
	let error = $state('');
	/** @type {Record<string, string>} each schema's title by its hash, as the space's lane and the apps name them */
	let titles = $state({});

	$effect(() => {
		void rev;
		const q = { view: 'entry', on: device, space, entry, line, app };
		world.view(q).then(
			(v) => {
				// a branch this device doesn't hold: back to main (asked of the view that answers for it, as a branch
				// just started is in no view from before it)
				if (q.line && !v.lines.some((/** @type {any} */ l) => l.id === q.line)) return void (line = null);
				[data, error] = [v, ''];
			},
			(e) => ([data, error] = [null, e.message])
		);
	});

	$effect(() => {
		void rev;
		world.view({ view: 'schemas', on: device, space }).then(
			(s) => {
				/** @type {Record<string, string>} */
				const t = {};
				for (const x of [...s.apps, ...s.schemas]) t[x.id] = x.title;
				titles = t;
			},
			() => {}
		);
	});

	const lineName = $derived(data?.lines.find((/** @type {any} */ l) => l.id === line)?.name ?? (line ? `branch ${short(line)}` : 'main'));
	const editable = $derived(!!data?.opens && !data.readOnly && rank(data.role) >= rank('write'));

	/** @param {any} value */
	async function save(value) {
		const done = await act({ do: 'put', space, entry, line, app, value });
		return !!done?.ok;
	}

	/** @param {string | null} l */
	function editOn(l) {
		line = l;
		tab = 'read';
	}

	/** @param {string} id */
	const titled = (id) => titles[id] ?? `schema ${short(id)}`;
</script>

{#if error}
	<div class="empty">
		{error}
		{#if /doesn't know/.test(error)}This device holds nothing of that space: it was never shared with it, or nothing of it has reached it yet.{/if}
	</div>
{:else if data}
	<header class="head">
		<small>{data.space.name}</small>
		<h2>{data.opens ? data.title || 'Untitled' : 'A sealed entry'}</h2>
		<div class="row">
			{#if data.kind}<span class="chip">{data.kind}</span>{/if}
			{#if data.role}
				<span class="chip accent">{data.role}{data.through ? ` through ${data.through.name}` : ''}</span>
			{:else}
				<span class="chip">no role here</span>
			{/if}
			<span class="chip">{count(data.held, 'write')} held · {size(data.bytes)} of ciphertext</span>
			{#if data.opens && data.readOnly}<span class="chip warn">read-only in the {app} app</span>{/if}
		</div>
		<div class="row controls">
			<label class="soft">On
				<select class="field" bind:value={line}>
					{#each data.lines as l (l.id ?? 'main')}<option value={l.id}>{l.name ?? `branch ${short(l.id)}`}</option>{/each}
				</select>
			</label>
			<label class="soft">As the
				<select class="field" bind:value={app}>
					<option value="v2">v2 app</option>
					<option value="v1">v1 app</option>
				</select>
			</label>
		</div>
	</header>

	<nav class="tabs" aria-label="The entry">
		{#each TABS as [id, label] (id)}
			<button class:on={tab === id} onclick={() => (tab = id)}>{label}</button>
		{/each}
	</nav>

	{#if tab === 'read'}
		{#if !data.opens}
			<div class="sealed">
				<span class="lock">🔒</span>
				<div>
					<b>This device can't open it.</b>
					<p class="soft">
						It holds {count(data.held, 'write')}, {size(data.bytes)} of ciphertext, but no key that opens them: no vault it acts for
						was given read on this entry or its space.
					</p>
				</div>
			</div>
		{:else}
			{#if data.readOnly}
				<p class="warnline">
					The {app} app opens it read-only: it was written under a schema this app's lens doesn't reach, so it shows what it can and
					writes nothing.
				</p>
			{/if}
			{#if line}<p class="soft">On the branch <b>{lineName}</b>: edits stay on it until it is merged or promoted.</p>{/if}
			{#key `${entry}:${line}:${app}:${rev}`}
				{#if data.kind === 'todo'}
					<Todo value={data.value ?? data.record} {app} {editable} onsave={save} />
				{:else}
					<Doc value={data.value ?? data.record} {app} {editable} onsave={save} />
				{/if}
			{/key}
			{#if !editable && !data.readOnly}
				<p class="soft small">This device acts for no vault with write here, so it only reads.</p>
			{/if}
		{/if}
	{:else if tab === 'json'}
		<div class="two">
			<section>
				<h3>The raw value</h3>
				<p class="soft small">The Loro document's value as it stands on {lineName}, every field any app has written.</p>
				<pre class="json">{pretty(data.record)}</pre>
			</section>
			<section>
				<h3>What the {app} app reads</h3>
				<p class="soft small">Through {data.schema ? titled(data.schema) : 'no schema'}{data.readOnly ? ', read-only' : ''}.</p>
				<pre class="json">{pretty(data.value)}</pre>
			</section>
		</div>
		<h3>Written under</h3>
		<div class="row">
			{#each data.authored as s (s)}<span class="chip accent" title={s}>{titled(s)}</span>{:else}<span class="soft">nothing this device opens</span>{/each}
		</div>
		<table>
			<thead><tr><th>Commit</th><th>What</th><th>By</th><th>Under</th></tr></thead>
			<tbody>
				{#each data.commits as c (c.op)}
					<tr>
						<td class="mono">{short(c.op)}</td>
						<td>{c.kind}</td>
						<td>{c.author.name}</td>
						<td>{#each c.schemas as s (s)}<span class="chip" title={s}>{titled(s)}</span> {:else}<span class="soft">—</span>{/each}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if tab === 'history'}
		<History {world} {device} {act} {space} {entry} {line} {app} {data} {titled} />
	{:else if tab === 'branches'}
		<Branches {world} {device} {rev} {act} {open} {space} {entry} {line} {app} {data} oneditline={editOn} />
	{:else if tab === 'access'}
		<Access {world} {device} {rev} {act} {ask} {space} {entry} />
	{/if}
{/if}

<style>
	.head small {
		color: var(--soft);
		font-size: 0.8rem;
	}

	.head h2 {
		margin: 0.15rem 0 0.5rem;
		font-size: 1.5rem;
	}

	.controls {
		margin-top: 0.6rem;
		gap: 1rem;
	}

	.controls label {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.84rem;
	}

	.tabs {
		margin-top: 1rem;
	}

	.sealed {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		max-width: 40rem;
		padding: 1rem 1.2rem;
		border: 1px dashed rgb(0 0 0 / 0.2);
		border-radius: 14px;
		background: rgb(255 255 255 / 0.5);
	}

	.lock {
		font-size: 1.8rem;
	}

	.sealed p {
		margin: 0.3rem 0 0;
		font-size: 0.9rem;
	}

	.warnline {
		max-width: 60rem;
		padding: 0.6rem 0.9rem;
		border-left: 3px solid #c99a2e;
		border-radius: 0 10px 10px 0;
		background: #f6eedb;
		font-size: 0.88rem;
	}

	.small {
		font-size: 0.82rem;
	}

	.two {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
	}

	h3 {
		margin: 1.2rem 0 0.3rem;
		font-size: 1.05rem;
	}

	.two h3 {
		margin-top: 0;
	}

	.two p {
		margin: 0 0 0.5rem;
	}

	table {
		width: 100%;
		max-width: 60rem;
		margin-top: 1rem;
		border-collapse: collapse;
		font-size: 0.85rem;
	}

	th,
	td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		vertical-align: top;
	}

	th {
		font-weight: 500;
		color: var(--soft);
	}
</style>
