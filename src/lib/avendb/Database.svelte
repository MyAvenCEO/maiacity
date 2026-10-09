<!--
	A vault's database as this browser holds it, as the acting vault opens it: each space the vault founded, with its
	key's epoch and the ops held on it by kind, and a table of its entries, each with its record, the schema it was
	written under, its writes, lines and branches, and who reads it. What the acting vault holds no cap to read shows as
	avenDB's server sees it, sealed: ids and counts. Then the schemas the app ships and the spaces publish, field by
	field, and the lenses that carry a record from one version of a schema to the next.
-->
<script>
	import { allows, count, nameOf, ROLES, short } from './vaults.js';

	/**
	 * @typedef {{ id: string, title: string, json: string }} SchemaView
	 * @typedef {{ id: string, title: string, from: string, to: string, json: string }} LensView
	 * @typedef {{ entry: string, kind: string, tag: 'card' | 'profile' | null, title: string | null, record: any,
	 *   authored: string[], writes: number, held: number, lines: number, branches: (string | null)[], epoch: number,
	 *   bytes: number, author: string | null, actor: string | null, public: boolean,
	 *   roles: Record<string, import('./vaults.js').Role> }} RowView
	 * @typedef {{ id: string, public: boolean, epoch: number, ops: Record<string, number>, schemas: SchemaView[],
	 *   lenses: LensView[], rows: RowView[] }} SpaceView
	 * @typedef {{ vault: string, held: { ops: number, keys: number },
	 *   builtIn: { schemas: SchemaView[], lenses: LensView[] }, spaces: SpaceView[] }} Db
	 * @typedef {{ name: string, type: string, fallback: string, required: boolean, fields: Field[] }} Field
	 */

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any,
	 *   onopen: (space: string, entry: string) => void, onact: (vault: string) => void }}
	 */
	let { world, vault, actor, api, onopen, onact } = $props();

	let db = $state(/** @type {Db | null} */ (null));
	let failed = $state('');
	/** the entry whose details show */
	let open = $state('');

	// what the device holds changed, or another vault is picked: read its database again
	$effect(() => {
		void world;
		const v = vault;
		let gone = false;
		api.database(v).then(
			(/** @type {Db} */ d) => {
				if (!gone) [db, failed] = [d, ''];
			},
			(/** @type {Error} */ e) => {
				if (!gone) failed = e.message ?? String(e);
			}
		);
		return () => {
			gone = true;
		};
	});

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const spaces = $derived(db?.vault === vault ? db.spaces : []);
	/** the devices this browser knows, by id: their name and their vault */
	const devices = $derived(new Map(world.vaults.flatMap((v) => v.devices.map((d) => [d.id, { name: d.name, vault: v }]))));
	/** whether the acting vault reads space `id`: the lane's schemas show only to who reads it */
	const readsSpace = (/** @type {string} */ id) => {
		const s = world.spaces.find((x) => x.id === id);
		return !!s && (s.public || allows(s.roles[actor], 'read'));
	};
	/** every schema and lens the tab shows, by id: the app's, then what the spaces the acting vault reads publish */
	const schemas = $derived(byIds([...(db?.builtIn.schemas ?? []), ...spaces.filter((s) => readsSpace(s.id)).flatMap((s) => s.schemas)]));
	const lenses = $derived(byIds([...(db?.builtIn.lenses ?? []), ...spaces.filter((s) => readsSpace(s.id)).flatMap((s) => s.lenses)]));
	/** the rows the acting vault opens, by the schemas they were written under */
	const uses = $derived.by(() => {
		/** @type {Map<string, number>} */
		const n = new Map();
		for (const r of spaces.flatMap((s) => s.rows).filter(opens)) for (const id of r.authored) n.set(id, (n.get(id) ?? 0) + 1);
		return n;
	});

	/** @template {{ id: string }} T @param {T[]} all @returns {Map<string, T>} */
	function byIds(all) {
		const map = new Map();
		for (const x of all) if (!map.has(x.id)) map.set(x.id, x);
		return map;
	}

	/** Whether the acting vault opens row `r`, and this browser holds its record. @param {RowView} r */
	const opens = (r) => (r.public || allows(r.roles[actor], 'read')) && r.record !== null;

	const KINDS = /** @type {Record<string, string>} */ ({
		document: 'Note',
		todo: 'Todo',
		card: 'Device card',
		profile: 'Vault profile',
		record: 'Record',
		sealed: 'Sealed'
	});
	/** What row `r` is, as the acting vault sees it. @param {RowView} r */
	const kindOf = (r) => (opens(r) ? (r.tag ?? r.kind) : 'sealed');

	/** A schema by its id: its title, or the start of its id. @param {string} id */
	const schemaName = (id) => schemas.get(id)?.title ?? `Schema ${short(id)}`;

	/** A size in bytes, as a person reads it. @param {number} n */
	const size = (n) => (n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1e3).toFixed(1)} kB` : `${(n / 1e6).toFixed(1)} MB`);

	/** Who wrote row `r` first: its device by name, and the vault it acted for. @param {RowView} r */
	function first(r) {
		if (!r.author) return 'nobody this browser knows';
		const d = devices.get(r.author);
		const device = d?.name ?? (d ? `a device of ${nameOf(d.vault)}` : 'a device this browser doesn’t know');
		return `${device}, for ${nameOf(byId.get(r.actor ?? ''))}`;
	}

	/** The vaults that hold a role on a row, the strongest first. @param {RowView} r */
	const holders = (r) =>
		Object.entries(r.roles)
			.map(([id, role]) => ({ id, role }))
			.sort((a, b) => ['owner', 'write', 'read', 'relay'].indexOf(a.role) - ['owner', 'write', 'read', 'relay'].indexOf(b.role));

	/** Space `s`'s name: the vault's home, or one of its spaces. @param {SpaceView} s @param {number} n */
	const spaceName = (s, n) => (s.id === here?.home ? 'Home' : `Space ${n + 1}`);

	/**
	 * A schema's fields, as the tab lists them: what each holds, its default, whether it's required, and an object's or
	 * a list of objects' own fields under it.
	 * @param {any} node
	 * @returns {Field[]}
	 */
	function fields(node) {
		const required = new Set(node?.required ?? []);
		return Object.entries(node?.properties ?? {}).map(([name, p]) => {
			const inner = p.type === 'object' ? p : p.type === 'array' && p.items?.type === 'object' ? p.items : null;
			const fallback = 'default' in p ? JSON.stringify(p.default) : '';
			return { name, type: holds(p), fallback, required: required.has(name), fields: inner ? fields(inner) : [] };
		});
	}

	/** What a field holds, in words. @param {any} p @returns {string} */
	function holds(p) {
		if ('const' in p) return `always ${JSON.stringify(p.const)}`;
		if (p.enum) return `one of ${p.enum.join(', ')}`;
		if (p['x-loro'] === 'text') return 'text, merged as people type (Loro text)';
		if (p.type === 'array') return p.items?.type === 'object' ? 'list of records' : `list of ${holds(p.items ?? {})}s`;
		if (p.format) return `${p.type}, a ${p.format}`;
		return `${p.type ?? 'anything'}${'minimum' in p ? `, at least ${p.minimum}` : ''}`;
	}

	/** A schema's or lens's JSON, parsed: `null` if it isn't. @param {string} json */
	function parsed(json) {
		try {
			return JSON.parse(json);
		} catch {
			return null;
		}
	}
</script>

{#snippet fieldRows(/** @type {Field[]} */ list, /** @type {number} */ depth)}
	{#each list as f (f.name)}
		<tr>
			<td style:padding-left="{0.5 + depth * 1.1}rem"><code>{f.name}</code>{#if f.required}<span class="req" title="Required">*</span>{/if}</td>
			<td>{f.type}</td>
			<td><code>{f.fallback}</code></td>
		</tr>
		{#if f.fields.length}{@render fieldRows(f.fields, depth + 1)}{/if}
	{/each}
{/snippet}

<div class="db">
	{#if failed}
		<p class="error">Reading the database failed: {failed}</p>
	{:else if !db || db.vault !== vault}
		<p class="soft">Reading the database…</p>
	{:else}
		<p class="lead">
			{nameOf(here)}’s database, as this browser holds it: {count(spaces.length, 'space')} with {count(
				spaces.reduce((n, s) => n + s.rows.length, 0),
				'entry',
				'entries'
			)}. In all, this browser holds {count(db.held.ops, 'signed op')} and {count(db.held.keys, 'McEliece key')}. As
			<b>{nameOf(as)}</b>: what its caps open shows; the rest shows sealed, as avenDB’s server holds it.
		</p>
		{#if here?.via && vault !== actor && spaces.some((s) => s.rows.length) && !spaces.some((s) => s.rows.some(opens))}
			<div class="empty act">
				<p>{nameOf(as)} holds no cap to open anything here; {nameOf(here)}’s own caps open all of it.</p>
				<button class="btn" onclick={() => onact(vault)}>Act as {nameOf(here)}</button>
			</div>
		{/if}

		{#each spaces as s, n (s.id)}
			<section class="space">
				<header class="space-head">
					<h3>{spaceName(s, n)} <small class="mono soft" title={s.id}>{short(s.id)}</small></h3>
					<span class="chip" title="Each rotation of its key, as owners revoke, starts a new epoch">key epoch {s.epoch}</span>
					<span class="chip">{count(s.ops.writes, 'write')}</span>
					{#if s.ops.checkpoints}<span class="chip">{count(s.ops.checkpoints, 'checkpoint')}</span>{/if}
					<span class="chip">{count(s.ops.keys, 'key op')}</span>
					<span class="chip">{count(s.ops.grants, 'grant')}{s.ops.revokes ? `, ${s.ops.revokes} revoked` : ''}</span>
					{#if s.ops.published}<span class="chip">{count(s.ops.published, 'schema or lens', 'schemas and lenses')} published</span>{/if}
					{#if s.public}<span class="chip ok">public</span>{/if}
				</header>

				{#if s.rows.length}
					<div class="table">
						<table>
							<thead>
								<tr>
									<th>Entry</th>
									<th>What</th>
									<th>Title</th>
									<th>Schema</th>
									<th class="num">Writes</th>
									<th>Lines</th>
									<th>Who holds a role</th>
								</tr>
							</thead>
							<tbody>
								{#each s.rows as r (r.entry)}
									{@const kind = kindOf(r)}
									{@const seen = opens(r)}
									<!-- the row opens its details on a click anywhere; its first cell's button takes the keyboard's -->
									<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
									<tr
										class="entry"
										class:sealed={!seen}
										class:on={open === r.entry}
										onclick={() => (open = open === r.entry ? '' : r.entry)}
									>
										<td>
											<button class="open mono" title={r.entry} aria-expanded={open === r.entry}>
												<span aria-hidden="true">{open === r.entry ? '▾' : '▸'}</span>
												{short(r.entry)}
											</button>
										</td>
										<td><span class="chip" class:accent={seen && !r.tag} class:warn={!seen}>{KINDS[kind] ?? kind}</span></td>
										<td class="title">{seen ? (r.title ?? '') : '…'}</td>
										<td>{seen ? r.authored.map(schemaName).join(', ') : ''}</td>
										<td class="num">{r.writes}</td>
										<td>{seen && r.lines > 1 ? `main + ${count(r.lines - 1, 'branch', 'branches')}` : r.lines > 1 ? count(r.lines, 'line') : 'main'}</td>
										<td>{count(Object.keys(r.roles).length, 'vault')}{r.public ? ', everyone reads' : ''}</td>
									</tr>
									{#if open === r.entry}
										<tr class="details">
											<td colspan="7">
												<dl>
													<dt>Entry</dt>
													<dd class="mono">{r.entry}</dd>
													<dt>Key epoch</dt>
													<dd>{r.epoch}</dd>
													<dt>Writes</dt>
													<dd>
														{count(r.writes, 'write')} counted{r.held !== r.writes ? `, ${r.held} held` : ''}{seen && r.bytes
															? `; its Loro document is ${size(r.bytes)}`
															: ''}
													</dd>
													<dt>First written by</dt>
													<dd>{first(r)}</dd>
													{#if seen && r.branches.length}
														<dt>Branches</dt>
														<dd>{r.branches.map((b) => b ?? 'one this browser can’t name').join(', ')}</dd>
													{/if}
													<dt>Roles</dt>
													<dd class="chips">
														{#each holders(r) as h (h.id)}
															<span class="chip" class:accent={h.id === actor}>{nameOf(byId.get(h.id))} {ROLES[h.role]}</span>
														{/each}
														{#if r.public}<span class="chip ok">everyone reads</span>{/if}
													</dd>
												</dl>
												{#if seen}
													{#if r.kind === 'document' && !r.tag}
														<button class="btn" onclick={() => onopen(s.id, r.entry)}>Open its history & branches</button>
													{/if}
													<p class="label">Its record, as {r.authored.map(schemaName).join(', ') || 'its schema'} reads it</p>
													<pre class="json">{JSON.stringify(r.record, null, 2)}</pre>
												{:else if r.record === null && (r.public || allows(r.roles[actor], 'read'))}
													<p class="soft">This browser holds no key to it yet: its writes are ciphertext here.</p>
												{:else}
													<p class="soft">
														Sealed for {nameOf(as)}: it holds no cap to read it. This browser keeps its writes as ciphertext, as
														avenDB’s server does.
													</p>
												{/if}
											</td>
										</tr>
									{/if}
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="empty">No entry yet.</p>
				{/if}
			</section>
		{:else}
			<div class="empty">{nameOf(here)} has founded no space yet.</div>
		{/each}

		<section class="schemas">
			<h3>Schemas</h3>
			<p class="soft">
				What a record holds, version by version. Every write names the schema it was written under; a lens carries a
				record between two versions, so an app on either reads the other's.
			</p>
			{#each [...schemas.values()] as sc (sc.id)}
				{@const json = parsed(sc.json)}
				<article class="card schema">
					<header>
						<b>{sc.title}</b>
						<span class="mono soft" title={sc.id}>{short(sc.id)}</span>
						<span class="chip">{count(uses.get(sc.id) ?? 0, 'record')} here</span>
					</header>
					{#if json}
						<div class="table">
							<table class="fields">
								<thead><tr><th>Field</th><th>Holds</th><th>Default</th></tr></thead>
								<tbody>{@render fieldRows(fields(json), 0)}</tbody>
							</table>
						</div>
					{/if}
					<details>
						<summary>JSON Schema</summary>
						<pre class="json">{sc.json}</pre>
					</details>
				</article>
			{/each}
		</section>

		<section class="lenses">
			<h3>Lenses</h3>
			{#each [...lenses.values()] as l (l.id)}
				{@const json = parsed(l.json)}
				<article class="card schema">
					<header>
						<b>{l.title}</b>
						<span class="mono soft" title={l.id}>{short(l.id)}</span>
					</header>
					<p class="soft">
						From {schemaName(l.from)} to {schemaName(l.to)}, and back{json?.steps ? `, in ${count(json.steps.length, 'step')}` : ''}.
					</p>
					<details>
						<summary>JSON</summary>
						<pre class="json">{l.json}</pre>
					</details>
				</article>
			{/each}
		</section>
	{/if}
</div>

<style>
	.db {
		max-width: 64rem;
	}

	.lead {
		margin: 0 0 1.3rem;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.space {
		margin-bottom: 1.8rem;
	}

	.act {
		margin-bottom: 1.3rem;
	}

	.act p {
		margin: 0 0 0.6rem;
	}

	.space-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.6rem;
	}

	.space-head h3,
	.schemas h3,
	.lenses h3 {
		margin: 0 0.3rem 0 0;
		font-size: 1.05rem;
	}

	.schemas h3,
	.lenses h3 {
		margin: 1.6rem 0 0.4rem;
	}

	.schemas > p {
		margin: 0 0 0.9rem;
		font-size: 0.88rem;
		line-height: 1.5;
	}

	.space-head small {
		font-weight: 400;
	}

	/* a table scrolls on its own, sideways, where it is wider than the column */
	.table {
		overflow-x: auto;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}

	th,
	td {
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		vertical-align: top;
	}

	th {
		color: var(--soft);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	.num {
		text-align: right;
	}

	.entry {
		cursor: pointer;
	}

	.entry:hover,
	.entry.on {
		background: #f6f3ec;
	}

	.entry.sealed td {
		color: var(--soft);
	}

	.open {
		display: inline-flex;
		gap: 0.35rem;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		white-space: nowrap;
		cursor: pointer;
	}

	.title {
		min-width: 8rem;
		font-weight: 500;
	}

	.details td {
		background: #fbfaf6;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 1rem;
		margin: 0.2rem 0 0.8rem;
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

	.label {
		margin: 0.8rem 0 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.json {
		max-height: 22rem;
		overflow: auto;
		margin: 0;
		padding: 0.7rem 0.8rem;
		border-radius: 10px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.76rem;
		line-height: 1.5;
	}

	.schema {
		margin-bottom: 0.8rem;
	}

	.schema header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
	}

	.schema p {
		margin: 0 0 0.5rem;
		font-size: 0.86rem;
	}

	.fields td:first-child {
		white-space: nowrap;
	}

	.req {
		margin-left: 0.15rem;
		color: var(--bad);
	}

	details {
		margin-top: 0.6rem;
	}

	summary {
		color: var(--accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	details .json {
		margin-top: 0.4rem;
	}
</style>
