<!--
	The studio's history: every signed edit this browser holds, the database's history, as a database studio lists its
	logs: those that concern the vault, or all of them, by kind (writes and moves, checkpoints, keys, caps, vaults and
	devices, schemas), newest first, each with its place in the order the browser took them, what it does in words, who
	signed it and how (a classical half, which counts for nothing once only post-quantum counts, and an SLH-DSA half),
	its causal depth and its size; each opens in a drawer, every field and signature, and the edits it builds on. What
	an edit seals, a write's body, a cap's slice or a key's boxes, shows by its size alone, as avenDB's server sees it;
	a cap's slice shows in words where this browser reads it.
-->
<script>
	import Panel from './Panel.svelte';
	import { describe, GROUPS, KIND_NAMES, size } from './db.js';
	import { count, list, short } from './vaults.js';

	/**
	 * @type {{ s: import('./db.js').Studio, log: { edits: import('./db.js').SignedEdit[] } | null, failed: string,
	 *   vault: string, pqOnly: boolean }}
	 */
	let { s, log, failed, vault, pqOnly } = $props();

	let scope = $state(/** @type {'vault' | 'all'} */ ('vault'));
	let group = $state('all');
	let query = $state('');
	let shown = $state(200);
	/** the edit whose drawer is open */
	let open = $state('');

	const edits = $derived(log?.edits ?? []);
	const byId = $derived(new Map(edits.map((e) => [e.id, e])));
	const scoped = $derived(scope === 'all' ? edits : edits.filter((e) => e.vaults.includes(vault)));
	const said = $derived(new Map(scoped.map((e) => [e.id, describe(e, s, (id) => byId.get(id))])));
	/** @param {string} id */
	const kindsOf = (id) => /** @type {readonly string[]} */ (GROUPS.find(([g]) => g === id)?.[2] ?? []);
	const counts = $derived(
		new Map(
			GROUPS.map(([id]) => {
				const kinds = kindsOf(id);
				return [id, kinds.length ? scoped.filter((e) => kinds.includes(e.kind)).length : scoped.length];
			})
		)
	);
	const found = $derived.by(() => {
		const kinds = kindsOf(group);
		const q = query.trim().toLowerCase();
		const hit = (/** @type {import('./db.js').SignedEdit} */ e) =>
			!q || `${said.get(e.id)} ${e.kind} ${KIND_NAMES[e.kind]} ${e.id} ${s.signer(e.author)}`.toLowerCase().includes(q);
		return scoped.filter((e) => (!kinds.length || kinds.includes(e.kind)) && hit(e)).reverse();
	});
	const page = $derived(found.slice(0, shown));
	const picked = $derived(open ? byId.get(open) : undefined);

	/** A signature's halves, as its chips name them. @param {import('./db.js').SigView} sig */
	const classical = (sig) => (sig.by === 'device' ? 'ed25519' : sig.batch ? `passkey P-256, one for ${sig.batch}` : 'passkey P-256');

	/** Who signed edit `e`: its author, then its cosigners. @param {import('./db.js').SignedEdit} e */
	const signers = (e) => list([e.author, ...e.cosigners].map(s.signer));
</script>

{#if failed}
	<p class="error">Reading the history failed: {failed}</p>
{:else if !log}
	<p class="soft">Reading the history…</p>
{:else}
	<div class="toolbar">
		<div class="seg" role="group" aria-label="Which edits">
			<button class:on={scope === 'vault'} aria-pressed={scope === 'vault'} onclick={() => ([scope, shown] = ['vault', 200])}>
				{s.vaultName(vault)}’s
			</button>
			<button class:on={scope === 'all'} aria-pressed={scope === 'all'} onclick={() => ([scope, shown] = ['all', 200])}>
				All this browser holds
			</button>
		</div>
		<input class="field search" placeholder="Search edits" bind:value={query} aria-label="Search edits" />
	</div>
	<div class="kinds" role="group" aria-label="Kinds">
		{#each GROUPS as [id, label] (id)}
			<button class="kind" class:on={group === id} aria-pressed={group === id} onclick={() => ([group, shown] = [id, 200])}>
				{label} <small>{counts.get(id)}</small>
			</button>
		{/each}
	</div>

	<div class="grid" role="region" aria-label="Edits" tabindex="-1">
		<table>
			<thead>
				<tr>
					<th class="num">#</th>
					<th>Edit</th>
					<th>Kind</th>
					<th>What it does</th>
					<th>Signed by</th>
					<th>Signatures</th>
					<th class="num">Depth</th>
					<th class="num">Size</th>
				</tr>
			</thead>
			<tbody>
				{#each page as e (e.id)}
					<!-- the row opens on a click anywhere; its id's button takes the keyboard's -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<tr class="rec {e.kind}" class:on={open === e.id} onclick={() => (open = e.id)}>
						<td class="num soft">{e.n}</td>
						<td><button class="open mono" title={e.id}>{short(e.id)}</button></td>
						<td><span class="chip k">{KIND_NAMES[e.kind] ?? e.kind}</span></td>
						<td class="what">
							{said.get(e.id)}
							{#if e.counted === false}<span class="chip warn" title="No checkpoint of its author covers it yet">not counted</span>{/if}
						</td>
						<td>{signers(e)}</td>
						<td><span class="sigs">
							{#each e.sigs as sig, i (i)}
								<span class="chip classical" class:off={pqOnly} title={pqOnly ? 'Counts for nothing: only post-quantum counts' : ''}
									>{classical(sig)}</span
								>
								{#if sig.pq}<span class="chip ok" title="SLH-DSA: post-quantum">SLH-DSA {size(sig.pq)}</span>{/if}
							{/each}
							{#if e.counted && !e.sigs.some((g) => g.pq)}
								<span class="chip ok" title="An SLH-DSA checkpoint of its author covers it">SLH-DSA by checkpoint</span>
							{/if}
						</span></td>
						<td class="num">{e.depth}</td>
						<td class="num">{size(e.bytes)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if !page.length}<p class="nothing">No edit {query ? 'matches' : 'here'}.</p>{/if}
	</div>
	<footer class="foot">
		<span>{page.length < found.length ? `${page.length} of ${count(found.length, 'edit')}` : count(found.length, 'edit')}, newest first</span>
		{#if page.length < found.length}<button class="btn" onclick={() => (shown += 200)}>Show 200 more</button>{/if}
		<span class="soft">{count(edits.length, 'signed edit')} held in all; what each seals shows by its size alone.</span>
	</footer>
{/if}

{#if picked}
	<Panel title="{KIND_NAMES[picked.kind] ?? picked.kind} · #{picked.n}" sub={picked.id} onclose={() => (open = '')}>
		<p class="said">{said.get(picked.id) ?? describe(picked, s, (id) => byId.get(id))}</p>
		<dl>
			<dt>Edit</dt>
			<dd class="mono">{picked.id}</dd>
			<dt>Signed by</dt>
			<dd>{signers(picked)}</dd>
			<dt>Depth</dt>
			<dd>{picked.depth}, after {count(picked.parents.length, 'edit')} of its log</dd>
			<dt>Size</dt>
			<dd>{size(picked.bytes)} on the wire</dd>
			<dt>Concerns</dt>
			<dd>{list(picked.vaults.map(s.vaultName)) || 'no vault this browser knows'}</dd>
			{#if picked.counted !== null}
				<dt>Counted</dt>
				<dd>{picked.counted ? 'Yes: a checkpoint of its author covers it' : 'Not yet: no checkpoint of its author covers it'}</dd>
			{/if}
		</dl>
		<h4 class="kept">Signatures</h4>
		<ul class="sig-list">
			{#each picked.sigs as sig, i (i)}
				<li>
					<b>{s.signer(sig.signer)}</b>, its {sig.by}:
					<span class="chip classical" class:off={pqOnly}>{classical(sig)}</span>
					{#if sig.pq}<span class="chip ok">SLH-DSA, {size(sig.pq)}</span>{:else if picked.counted}<span class="chip ok"
							>no post-quantum half: an SLH-DSA checkpoint covers it</span
						>{:else}<span class="chip warn">no post-quantum half</span>{/if}
				</li>
			{/each}
		</ul>
		{#if picked.parents.length}
			<h4 class="kept">Builds on</h4>
			<div class="parents">
				{#each picked.parents as p (p)}
					{@const parent = byId.get(p)}
					<button class="btn quiet" disabled={!parent} onclick={() => (open = p)}>
						<span class="mono">{short(p)}</span>{parent ? ` · ${KIND_NAMES[parent.kind] ?? parent.kind} #${parent.n}` : ''}
					</button>
				{/each}
			</div>
		{/if}
		<details open>
			<summary>Its fields</summary>
			<pre class="json">{JSON.stringify(picked.fields, null, 2)}</pre>
		</details>
	</Panel>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem;
		margin-bottom: 0.6rem;
	}

	.seg {
		display: inline-flex;
		padding: 0.15rem;
		border-radius: 9px;
		background: rgb(0 0 0 / 0.06);
	}

	.seg button {
		padding: 0.3rem 0.75rem;
		border: 0;
		border-radius: 7px;
		background: none;
		font: inherit;
		font-size: 0.82rem;
		color: inherit;
		cursor: pointer;
	}

	.seg button.on {
		background: #fff;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.1);
		font-weight: 600;
	}

	.search {
		width: min(100%, 15rem);
		padding: 0.3rem 0.55rem;
		font-size: 0.82rem;
	}

	.kinds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 0.7rem;
	}

	.kind {
		padding: 0.2rem 0.65rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.kind small {
		color: var(--soft);
	}

	.kind.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
	}

	.grid {
		max-height: max(16rem, calc(100dvh - 22rem));
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
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid #ecebe6;
		text-align: left;
		white-space: nowrap;
	}

	th {
		position: sticky;
		top: 0;
		z-index: 1;
		background: #f6f5f1;
		color: var(--soft);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.num {
		text-align: right;
	}

	.what {
		min-width: 16rem;
		white-space: normal;
	}

	.rec {
		cursor: pointer;
	}

	.rec:hover td,
	.rec.on td {
		background: #f4f8f6;
	}

	.open {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}

	.k {
		background: #eceae4;
	}

	.write .k,
	.move .k {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.keys .k,
	.checkpoint .k {
		background: #efe3c8;
		color: #6a4b12;
	}

	.cap .k {
		background: #dcebd9;
		color: #2b5a37;
	}

	.revoke .k {
		background: #f3d6cc;
		color: #7a2f1c;
	}

	.sigs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.classical.off {
		opacity: 0.55;
		text-decoration: line-through;
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
		align-items: center;
		gap: 0.4rem 1rem;
		margin-top: 0.5rem;
		font-size: 0.78rem;
	}

	.said {
		margin: 0 0 1rem;
		font-size: 0.95rem;
		line-height: 1.5;
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

	.kept {
		margin: 1.2rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.sig-list {
		margin: 0;
		padding-left: 1.1rem;
		font-size: 0.84rem;
		line-height: 1.9;
	}

	.parents {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	summary {
		margin-top: 1rem;
		color: var(--accent);
		font-size: 0.82rem;
		cursor: pointer;
	}

	.json {
		max-height: 22rem;
		overflow: auto;
		margin: 0.4rem 0 0;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		background: #23302a;
		color: #e8efe6;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
		line-height: 1.5;
	}
</style>
