<!--
	The studio's table editor: a vault's entries as tables, as a database studio shows Postgres's: who they are shared
	with to pick, or all of them, and its tables on the left, each entry in the one of its type (notes, todos, devices'
	cards, vaults' profiles, other records, and what the acting vault doesn't open, sealed); the table picked as a grid,
	its columns the fields of its schema, newest version first, each with its type, then what avenDB keeps of each row
	(who it is shared with, the devices it is synced to, the tags shares select it by, which its record's own fields
	don't hold, its schemas, edits, proposals and who wrote it first, and with the studio's internals shown its key's
	generation and size); sorted by a column, searched, and each row opened in a drawer, its record field by field, a
	list of records' rows each opened in turn, at any depth, and each link followed to the record or row it leads to,
	a level at a time, as the device's query follows it (./RecordView.svelte), and with the internals shown, its mark to
	run now (the `mark` op). Files are entries too: the files table is the vault's
	file entries, shared, synced and searched as every table's rows are, with the file each brings beside its fields (its
	root, its length, its sealed size and its pieces).
-->
<script>
	import Icon from './Icon.svelte';
	import Panel from './Panel.svelte';
	import RecordView from './RecordView.svelte';
	import { isLink, isLinks, isRows, valueWords } from './paths.js';
	import { cell, families, familyOf, hint, parsed, pgType, tables, typeOf } from './db.js';
	import { allowed, may } from './ops.js';
	import { count, nameOf, sharerWords, short, size, syncedWords } from './vaults.js';

	/**
	 * @typedef {import('./db.js').RowView} Row
	 * @typedef {{ name: string, type: string, hint: string, pk?: boolean, sys?: boolean, get: (r: Row) => unknown }} Column
	 */

	/**
	 * @type {{ s: import('./db.js').Studio, cell: string, actor: string, api: any, internals: boolean,
	 *   onopen: (entry: string) => void }}
	 */
	let { s, cell: within = $bindable(''), actor, api, internals, onopen } = $props();

	let picked = $state('notes');
	let query = $state('');
	/** the column the rows are sorted by, and which way: none at first, in the order the vault holds them */
	let sort = $state({ by: '', down: false });
	/** the row whose drawer is open */
	let open = $state('');
	/** where in its record the drawer is: each list's field and a row of it, each link followed (./RecordView.svelte) */
	let trail = $state(/** @type {(string | number | { id: number } | { to: true })[]} */ ([]));

	// another row's drawer opens at its record
	$effect.pre(() => {
		void open;
		trail = [];
	});

	const all = $derived(tables(s, within));
	const table = $derived(all.find((t) => t.id === picked) ?? all[0]);

	/** Where entry `id` is synced to, in words, as the device's world says: `null` for none. @param {string} id */
	const synced = (id) => syncedWords(s.known.get(id)?.syncedTo, s.signer);

	/** The file row `r` brings, as the device's world says, if it brings one. @param {Row} r */
	const fileOf = (r) => s.known.get(r.entry)?.files?.[0];

	const family = $derived(table?.family ? familyOf(families(s.schemas, s.lenses), table.family) : undefined);

	/** The table's columns: its key, its schema's fields, newest version first, then what avenDB keeps of each row. */
	const columns = $derived.by(() => {
		if (!table) return [];
		/** @type {Column[]} */
		const cols = [{ name: 'entry', type: 'bytea', hint: 'Its id, 32 bytes: the primary key', pk: true, get: (r) => short(r.entry) }];
		const sealed = table.id === 'sealed';
		if (!sealed) {
			const seen = new Set();
			const versions = [...(family?.schemas ?? [])].reverse();
			for (const sc of versions) {
				const json = parsed(sc.json);
				const required = new Set(json?.required ?? []);
				for (const [name, p] of Object.entries(json?.properties ?? {})) {
					if (seen.has(name)) continue;
					// an older version's field shows where a row still holds it
					if (sc !== versions[0] && !table.rows.some((r) => r.record && name in r.record)) continue;
					seen.add(name);
					const notes = [hint(p), required.has(name) ? 'not null' : '', `in ${sc.title}`].filter(Boolean);
					cols.push({ name, type: pgType(p), hint: notes.join('; '), get: (r) => r.record?.[name] });
				}
			}
			for (const r of table.rows)
				for (const [name, v] of Object.entries(r.record ?? {}))
					if (!seen.has(name)) {
						seen.add(name);
						cols.push({ name, type: typeOf(v), hint: 'A field no schema here names', get: (x) => x.record?.[name] });
					}
		}
		if (table.id === 'files') {
			cols.push(
				{ name: 'file_root', type: 'bytea', hint: 'The root of the file it brings: the hash its pieces are checked by', get: (r) => short(fileOf(r)?.root ?? '') || null },
				{ name: 'bytes', type: 'int8', hint: 'The file’s length, where this browser opens it', get: (r) => fileOf(r)?.len ?? null },
				{ name: 'sealed_bytes', type: 'int8', hint: 'The file’s sealed size', get: (r) => fileOf(r)?.size ?? null },
				{ name: 'pieces', type: 'int4', hint: 'How many pieces it is sealed in, of up to a GiB each', get: (r) => fileOf(r)?.pieces ?? null }
			);
		}
		/** @type {Column[]} */
		const kept = [
			{ name: 'shared_with', type: 'text', hint: 'Who it is shared with, and at what level', get: (/** @type {Row} */ r) => s.shared(r.entry) },
			{
				name: 'synced_to',
				type: 'text',
				hint: 'The devices that hold it, and how many of its edits where only some, as this browser last heard',
				get: (/** @type {Row} */ r) => synced(r.entry)
			},
			...(sealed
				? []
				: [{ name: 'entry_tags', type: 'text[]', hint: 'Its tags now, outside its record: what shares select it by', get: (/** @type {Row} */ r) => r.tags }]),
			...(sealed
				? []
				: [
						{ name: 'schemas', type: 'text[]', hint: 'The schemas its edits were written under', get: (/** @type {Row} */ r) => r.authored.map(s.schemaName).join(', ') }
					]),
			{ name: 'edits', type: 'int4', hint: sealed ? 'The edits of it this browser holds, sealed' : 'The edits of it this browser counts', get: (r) => (sealed ? r.held : r.edits) },
			...(sealed ? [] : [{ name: 'proposals', type: 'int4', hint: 'Its proposals: lines besides main', get: (/** @type {Row} */ r) => Math.max(0, r.lines - 1) }]),
			...(internals
				? [{ name: 'key_generation', type: 'int4', hint: 'Its key’s generation: it moves on when a reader may no longer read it', get: (/** @type {Row} */ r) => r.epoch }]
				: []),
			...(internals && !sealed ? [{ name: 'loro_bytes', type: 'int8', hint: 'The size of its Loro document', get: (/** @type {Row} */ r) => r.bytes }] : []),
			{ name: 'first_by', type: 'text', hint: 'The device and the vault of its first edit', get: first }
		];
		return [...cols, ...kept.map((c) => ({ ...c, sys: true }))];
	});

	/** The rows as shown: searched, then sorted. */
	const rows = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const text = (/** @type {Row} */ r) => columns.map((c) => cell(c.get(r)).text).join(' ').toLowerCase() + r.entry;
		const found = (table?.rows ?? []).filter((r) => !q || text(r).includes(q));
		const by = columns.find((c) => c.name === sort.by);
		if (!by) return found;
		/** @param {unknown} v */
		const rank = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
		const sorted = [...found].sort((a, b) => {
			const [x, y] = [rank(by.get(a)), rank(by.get(b))];
			return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
		});
		return sort.down ? sorted.reverse() : sorted;
	});
	const row = $derived(table?.rows.find((r) => r.entry === open));

	/** Who wrote row `r` first: its device by name, and the vault it acted for. @param {Row} r */
	function first(r) {
		if (!r.author) return null;
		const device = s.signer(r.author);
		return `${device}, for ${s.vaultName(r.actor ?? '')}`;
	}

	/** whether the device would mark the open row now, as it answers a dry run of it, and what its mark did */
	let marks = $state(false);
	let marked = $state('');
	$effect(() => {
		const entry = open;
		[marks, marked] = [false, ''];
		if (!entry || !internals) return;
		let gone = false;
		may(api, actor, [{ op: 'mark', entry }]).then(([a]) => !gone && (marks = allowed(a)));
		return () => {
			gone = true;
		};
	});

	/** Runs the open row's mark now: its audience and the keep shares that want it, as its shares say. */
	async function mark() {
		const done = await api.run('Marking', { op: 'mark', entry: open });
		if (!done) return;
		marked = done.edit ? `Marked: edit ${short(done.edit)}.` : 'Its marks say what its shares say already.';
	}

	/** Sort by column `name`, then the other way, then not at all. @param {string} name */
	function sortBy(name) {
		sort = sort.by !== name ? { by: name, down: false } : sort.down ? { by: '', down: false } : { by: name, down: true };
	}
</script>

<div class="editor">
	<aside class="tables" aria-label="Tables">
		<label class="pick">
			<span>Shared with</span>
			<select class="field" bind:value={within} aria-label="Shared with">
				<option value="">Every entry</option>
				{#each s.byWho as g (g.words)}<option value={g.words}>{g.words}</option>{/each}
			</select>
		</label>
		<h4>Tables</h4>
		<ul>
			{#each all as t (t.id)}
				<li>
					<button
						class="t"
						class:on={t.id === table?.id}
						class:none={!t.rows.length}
						data-table={t.id}
						title={t.hint}
						onclick={() => ([picked, open, sort] = [t.id, '', { by: '', down: false }])}
					>
						<Icon name={t.id === 'sealed' ? 'lock' : 'table'} size={14} />
						<span class="mono">{t.label}</span>
						<small>{t.rows.length}</small>
					</button>
				</li>
			{/each}
		</ul>
	</aside>

	<section class="area">
		{#if table}
			<header class="bar">
				<h3 class="mono">{table.label}</h3>
				{#if family}<span class="chip accent" title="The schema family its rows are written under">{family.name}</span>{/if}
				<span class="soft hint">{table.hint}</span>
				<label class="search">
					<Icon name="search" size={14} />
					<input class="field" placeholder="Search rows" bind:value={query} aria-label="Search rows" />
				</label>
			</header>

			<div class="grid" role="region" aria-label="{table.label}’s rows" tabindex="-1">
				<table>
					<thead>
						<tr>
							{#each columns as c ((c.sys || c.pk ? 'avendb:' : '') + c.name)}
								<th class:pk={c.pk} class:sys={c.sys} title={c.hint} data-col={c.name} aria-sort={sort.by === c.name ? (sort.down ? 'descending' : 'ascending') : undefined}>
									<button onclick={() => sortBy(c.name)}>
										{#if c.pk}<Icon name="key" size={12} />{/if}
										<span class="name">{c.name}</span>
										<span class="type">{c.type}</span>
										{#if sort.by === c.name}<span aria-hidden="true">{sort.down ? '↓' : '↑'}</span>{/if}
									</button>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each rows as r (r.entry)}
							<!-- the row opens on a click anywhere; its key cell's button takes the keyboard's -->
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
							<tr class="rec" class:on={open === r.entry} onclick={() => (open = r.entry)}>
								{#each columns as c ((c.sys || c.pk ? 'avendb:' : '') + c.name)}
									{@const v = cell(c.get(r))}
									<td class={v.kind} class:pk={c.pk} class:sys={c.sys} data-col={c.name} title={c.pk ? r.entry : undefined}>
										{#if c.pk}<button class="open mono" aria-label="Open the row {short(r.entry)}">{v.text}</button>{:else}{v.text}{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
				{#if !rows.length}
					<p class="nothing">{query ? 'No row matches.' : 'No rows.'}</p>
				{/if}
			</div>
			<footer class="foot">
				<span>{count(rows.length, 'row')}{query ? ` of ${table.rows.length}` : ''}</span>
				<span class="soft">{within ? `Shared with ${within}` : 'Every entry'} · {nameOf(s.here)}</span>
				<span class="soft">As {nameOf(s.as)}: what is shared with it shows; the rest is in sealed.</span>
			</footer>
		{/if}
	</section>
</div>

{#if row && table}
	{@const opened = table.id !== 'sealed'}
	<Panel title="{table.label} · {short(row.entry)}" sub={row.entry} onclose={() => (open = '')}>
		{#if opened && trail.length}
			<RecordView {api} entry={row.entry} record={row.record} bind:trail />
		{:else if opened}
			<div class="fields">
				{#each columns.filter((c) => !c.pk && !c.sys) as c (c.name)}
					{@const v = c.get(row)}
					<div class="f" data-col={c.name}>
						<div class="fh"><code>{c.name}</code><span class="type">{c.type}</span></div>
						{#if v === null || v === undefined}
							<p class="null">NULL</p>
						{:else if isRows(v) && v.length}
							<p class="chips">
								{#each v as r (r.id)}
									<button class="btn quiet" onclick={() => (trail = [c.name, { id: r.id }])}>row {r.id}</button>
								{/each}
							</p>
						{:else if isLink(v)}
							<p class="val">
								{valueWords(v)}
								<button class="btn quiet" onclick={() => (trail = [c.name, { to: true }])}>Follow</button>
							</p>
						{:else if isLinks(v)}
							<p class="chips">
								{#each v as l, i (i)}
									<button class="btn quiet" title={valueWords(l)} onclick={() => (trail = [c.name, i, { to: true }])}
										>Follow {i + 1}</button
									>
								{/each}
							</p>
						{:else if typeof v === 'object'}
							<pre class="json">{JSON.stringify(v, null, 2)}</pre>
						{:else}
							<p class="val">{String(v) || 'EMPTY'}</p>
						{/if}
					</div>
				{/each}
			</div>
			{#if row.type === 'note'}
				<button class="btn primary" onclick={() => onopen(row.entry)}>Open the note</button>
			{/if}
		{:else if row.record === null && (row.public || s.readable(row.entry))}
			<p class="soft">This browser holds no key to it yet: its edits are ciphertext here.</p>
		{:else}
			<p class="soft">
				Sealed for {nameOf(s.as)}: no share it holds opens it. This browser keeps its edits encrypted, and opens none
				of them.
			</p>
		{/if}

		<h4 class="kept">What avenDB keeps of it</h4>
		<dl>
			<dt>Entry</dt>
			<dd class="mono">{row.entry}</dd>
			<dt>Shared with</dt>
			<dd class="chips">
				{#each s.sharers(row.entry).who as x (x.id)}
					<span class="chip" class:accent={x.id === actor}>{sharerWords(x)}</span>
				{/each}
				{#if row.public}<span class="chip ok">Public</span>{/if}
			</dd>
			<dt>Synced to</dt>
			<dd>{synced(row.entry) ?? 'no device this browser has heard of'}</dd>
			{#if row.type !== null}
				<dt>Type</dt>
				<dd>{row.type}</dd>
				<dt>Tags</dt>
				<dd class="chips">
					{#each row.tags ?? [] as t (t)}<span class="chip">#{t}</span>{:else}none{/each}
				</dd>
			{/if}
			{#if opened}
				<dt>Schemas</dt>
				<dd>{row.authored.map(s.schemaName).join(', ') || 'none named'}</dd>
			{/if}
			<dt>Edits</dt>
			<dd>{count(row.edits, 'edit')} counted{row.held !== row.edits ? `, ${row.held} held` : ''}</dd>
			{#if opened && row.lines > 1}
				<dt>Proposals</dt>
				<dd>{row.proposals.map((b) => b ?? 'one this browser can’t name').join(', ')}</dd>
			{/if}
			{#if internals}
				<dt>Key generation</dt>
				<dd>{row.epoch}</dd>
				{#if opened && row.bytes}
					<dt>Its Loro document</dt>
					<dd>{size(row.bytes)}</dd>
				{/if}
			{/if}
			<dt>First written by</dt>
			<dd>{first(row) ?? 'nobody this browser knows'}</dd>
		</dl>
		{#if internals && marks}
			<p class="row">
				<button
					class="btn"
					title="Its audience and the keep shares that want it, as its shares say now"
					onclick={mark}>Mark it now</button
				>
				{#if marked}<small class="soft">{marked}</small>{/if}
			</p>
		{/if}
		{#if opened}
			<details>
				<summary>Its record as JSON</summary>
				<pre class="json">{JSON.stringify(row.record, null, 2)}</pre>
			</details>
		{/if}
	</Panel>
{/if}

<style>
	.editor {
		display: grid;
		grid-template-columns: 12.5rem minmax(0, 1fr);
		gap: 1.2rem;
	}

	.tables .pick {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 1rem;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--soft);
	}

	.tables select {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
		color: #1f2a23;
	}

	h4 {
		margin: 0 0 0.4rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.tables ul {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.t {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.38rem 0.5rem;
		border: 0;
		border-radius: 7px;
		background: none;
		font: inherit;
		font-size: 0.86rem;
		text-align: left;
		color: inherit;
		cursor: pointer;
	}

	.t .mono {
		flex: 1;
		font-size: 0.82rem;
	}

	.t small {
		color: var(--soft);
		font-size: 0.72rem;
	}

	.t:hover {
		background: rgb(0 0 0 / 0.05);
	}

	.t.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
		font-weight: 600;
	}

	.t.none {
		color: var(--soft);
	}

	.area {
		min-width: 0;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem 0.7rem;
		margin-bottom: 0.6rem;
	}

	.bar h3 {
		margin: 0;
		font-size: 1rem;
	}

	.bar .hint {
		flex: 1 1 12rem;
		font-size: 0.78rem;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--soft);
	}

	.search input {
		width: 11rem;
		padding: 0.3rem 0.5rem;
		font-size: 0.82rem;
	}

	/* the grid: a header that stays, a key column that stays, every cell on one line */
	.grid {
		position: relative;
		max-height: max(16rem, calc(100dvh - 20rem));
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
		padding: 0 0.6rem;
		height: 2.1rem;
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
		z-index: 2;
		padding: 0;
		background: #f6f5f1;
		font-weight: 500;
	}

	th button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		height: 100%;
		padding: 0 0.6rem;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	th .name {
		font-weight: 600;
	}

	th .type,
	.fh .type {
		color: var(--soft);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
	}

	th.sys {
		background: #f0efea;
	}

	th.sys .name {
		font-weight: 500;
		font-style: italic;
	}

	.pk {
		position: sticky;
		left: 0;
		z-index: 1;
		background: #fff;
	}

	th.pk {
		z-index: 3;
		background: #f6f5f1;
	}

	.rec {
		cursor: pointer;
	}

	.rec:hover td,
	.rec.on td {
		background: #f4f8f6;
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
		color: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.nothing {
		margin: 0;
		padding: 1.4rem;
		color: var(--soft);
		text-align: center;
	}

	.foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
	}

	/* the drawer */
	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-bottom: 1rem;
	}

	.fh {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.fh code {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.val {
		margin: 0;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	p.null {
		margin: 0;
		color: rgb(0 0 0 / 0.35);
		font-size: 0.75rem;
	}

	pre.json {
		max-height: 20rem;
		overflow: auto;
		margin: 0;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.74rem;
		line-height: 1.5;
	}

	.kept {
		margin: 1.3rem 0 0.5rem;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.35rem 1rem;
		margin: 0 0 1rem;
		font-size: 0.86rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	summary {
		color: var(--accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	details .json {
		margin-top: 0.4rem;
	}

	@media (max-width: 1000px) {
		.editor {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.6rem;
		}

		.tables {
			display: flex;
			flex-wrap: wrap;
			align-items: flex-end;
			gap: 0.4rem 0.8rem;
		}

		/* as wide as the screen at most, however long the names of who a cell is shared with */
		.tables .pick {
			margin: 0;
			max-width: 100%;
		}

		.tables h4 {
			display: none;
		}

		.tables ul {
			flex-direction: row;
			flex-wrap: nowrap;
			max-width: 100%;
			overflow-x: auto;
		}

		.t {
			width: auto;
			white-space: nowrap;
		}
	}
</style>
