<!--
	The studio's query console, as a database studio's SQL editor: any op of avenDB's ops engine as JSON (./ops.js,
	avendb/docs/OPS.md), run on what this device holds, whatever the schema of the records it reads or changes. A query
	shows its rows as a table, with the selector its labels picked them by before any entry was opened: a cap's
	selector, the very one a cap on those entries would hold. A change acts as the acting vault, unless the op names
	another (`as`), and the rules judge it as they judge any peer's edit. The examples fill it in for the vault looked
	at.
-->
<script>
	import { cell } from './db.js';
	import { reads } from './ops.js';
	import { count, nameOf, short, whereWords } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any,
	 *   onopen: (entry: string) => void }}
	 */
	let { world, vault, actor, api, onopen } = $props();

	const as = $derived(world.vaults.find((v) => v.id === actor));
	const notes = $derived(world.entries.filter((e) => e.vault === vault && e.kind === 'note'));

	/** @typedef {{ name: string, op: object, change?: boolean }} Example */
	/** The examples, for the vault looked at: each a name, its op, and whether it changes anything. */
	const examples = $derived(/** @type {Example[]} */ ([
		{
			name: 'Notes',
			op: {
				op: 'query',
				vault,
				where: { type: ['note'] },
				select: ['title'],
				order: [['created', 'desc']],
				limit: 20
			}
		},
		{
			name: 'Notes that say “plan”',
			op: {
				op: 'query',
				vault,
				where: { all: [{ type: ['note'] }, { path: ['blocks', '*', 'text'], contains: 'plan' }] },
				select: ['title']
			}
		},
		{
			name: 'Todos left',
			op: {
				op: 'query',
				vault,
				where: { all: [{ type: ['todo'] }, { path: ['status'], ne: 'done' }] },
				select: ['title', 'status'],
				order: [[['title'], 'asc']]
			}
		},
		...notes.slice(0, 1).map((n) => ({
			name: 'A note’s history',
			op: { op: 'history', entry: n.entry, limit: 5 }
		})),
		{ name: 'Schemas', op: { op: 'schemas', vault } },
		{
			name: 'Add a todo',
			change: true,
			op: { op: 'create', vault, type: 'todo', value: { kind: 'todo', title: 'Written from the console' } }
		}
	]));

	let text = $state('');
	let running = $state(false);
	/** what the last op answered, and how long it took */
	let out = $state(/** @type {any} */ (null));
	let ms = $state(0);
	let bad = $state('');

	// a fresh console starts on the vault's notes
	let filled = false;
	$effect(() => {
		if (filled) return;
		filled = true;
		text = JSON.stringify(examples[0].op, null, 2);
	});

	/** @param {object} op */
	const fill = (op) => ([text, out, bad] = [JSON.stringify(op, null, 2), null, '']);

	async function run() {
		/** @type {any} */
		let op;
		try {
			op = JSON.parse(text);
		} catch (e) {
			return void (bad = `That isn’t JSON: ${/** @type {Error} */ (e).message}`);
		}
		// a change acts as the acting vault, as every screen's does, unless it names another
		if (op && typeof op === 'object' && !reads(op) && !('as' in op)) op = { ...op, as: actor };
		[running, bad] = [true, ''];
		const start = performance.now();
		try {
			out = await api.ask(op);
		} catch (e) {
			out = { refused: 'Error', why: /** @type {Error} */ (e).message ?? String(e) };
		} finally {
			[ms, running] = [Math.round(performance.now() - start), false];
		}
	}

	/** Where a batch stopped, and what stands of it. @param {any} out */
	const batch = (out) =>
		typeof out.at === 'number'
			? ` (op ${out.at + 1} of the batch; the ${count(out.done.length, 'step')} before it stand)`
			: '';

	/** A cell's value whole, as its tooltip shows it. @param {unknown} v */
	const whole = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

	/** Run on Ctrl+Enter or ⌘Enter, as a studio's editor does. @param {KeyboardEvent} e */
	const keys = (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && (e.preventDefault(), run());

	const rows = $derived(/** @type {any[] | null} */ (Array.isArray(out?.ok?.rows) ? out.ok.rows : null));
	/** the rows' record fields, in the order they first show */
	const fields = $derived([...new Set((rows ?? []).flatMap((r) => Object.keys(r.record ?? {})))]);
</script>

<p class="lead soft">
	Every read and change of avenDB is one op, whatever the schema of the records it touches: the same JSON this page
	and the Mac app send. Reads run on what this device holds; a change acts as <b>{nameOf(as)}</b>, unless it names
	another vault (<code>as</code>), and the rules judge it as they judge any device's.
</p>

<div class="examples row" aria-label="Examples">
	{#each examples as x (x.name)}
		<button class="chip pick" class:change={x.change} onclick={() => fill(x.op)}>
			{x.name}{x.change ? ' · a change' : ''}
		</button>
	{/each}
</div>

<div class="editor">
	<textarea bind:value={text} onkeydown={keys} spellcheck="false" aria-label="The op, as JSON" rows="12"></textarea>
	<div class="row">
		<button class="btn primary" disabled={running} onclick={run}>{running ? 'Running…' : 'Run'}</button>
		<small class="soft">Ctrl+Enter or ⌘Enter</small>
		{#if out && !running}<small class="soft took">{ms} ms</small>{/if}
	</div>
</div>

{#if bad}
	<p class="error">{bad}</p>
{:else if out && 'refused' in out}
	<div class="refused">
		<span class="chip bad">{out.refused}</span>
		<span>{out.why}{batch(out)}</span>
	</div>
{:else if rows}
	<p class="picked soft">
		{count(out.ok.count, 'row')}{out.ok.count > rows.length ? `, ${rows.length} shown` : ''}. Picked by its labels
		before any entry was opened, as a cap selects: <b>{whereWords(out.ok.plan, world)}</b>
		<code>{JSON.stringify(out.ok.plan)}</code>
	</p>
	{#if rows.length}
		<div class="grid">
			<table>
				<thead>
					<tr>
						<th>entry</th>
						<th>type</th>
						<th>tags</th>
						{#each fields as f (f)}<th>{f}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.entry)}
						<tr>
							<td class="sys mono" title={r.entry}>
								{#if r.type === 'note'}
									<button class="open" onclick={() => onopen(r.entry)}>{short(r.entry)}</button>
								{:else}{short(r.entry)}{/if}
							</td>
							<td class="sys">{r.type}</td>
							<td class="sys">{r.tags.join(', ')}</td>
							{#each fields as f (f)}
								{@const v = cell(r.record?.[f])}
								<td class={v.kind} title={whole(r.record?.[f])}>{v.text}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{:else if out}
	<pre class="json">{JSON.stringify(out.ok, null, 2)}</pre>
{/if}

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 0.9rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.examples {
		margin-bottom: 0.7rem;
	}

	.pick {
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.pick:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.pick.change {
		background: #efe3c8;
	}

	.editor {
		display: grid;
		gap: 0.55rem;
		margin-bottom: 1rem;
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: 12rem;
		padding: 0.75rem 0.85rem;
		border: 1px solid rgb(0 0 0 / 0.2);
		border-radius: 10px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		line-height: 1.5;
		resize: vertical;
	}

	.took {
		margin-left: auto;
	}

	.refused {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid #f0c9bb;
		border-radius: 10px;
		background: #fbefea;
		font-size: 0.86rem;
	}

	.picked {
		margin: 0 0 0.6rem;
		font-size: 0.82rem;
		line-height: 1.5;
	}

	.picked code {
		margin-left: 0.3rem;
		font-size: 0.72rem;
	}

	.grid {
		max-height: max(16rem, calc(100dvh - 26rem));
		overflow: auto;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	table {
		min-width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		max-width: 18rem;
		height: 2.1rem;
		padding: 0 0.6rem;
		border-right: 1px solid #ecebe6;
		border-bottom: 1px solid #ecebe6;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		background: #f6f5f1;
		font-weight: 600;
	}

	td.null,
	td.empty {
		color: rgb(0 0 0 / 0.32);
		font-size: 0.72rem;
		letter-spacing: 0.04em;
	}

	td.num {
		text-align: right;
	}

	td.json,
	td.bool {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.74rem;
	}

	td.sys {
		color: #45524a;
	}

	.open {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--accent);
		cursor: pointer;
	}

	.json {
		max-height: max(16rem, calc(100dvh - 26rem));
		overflow: auto;
		margin: 0;
		padding: 0.75rem 0.85rem;
		border-radius: 10px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.74rem;
		line-height: 1.5;
	}
</style>
