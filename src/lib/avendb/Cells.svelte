<!--
	The studio's spaces: what this browser holds in all, then each space the vault founded, as a database studio lists
	its schemas (Postgres's namespaces): its key's epoch, whether everyone reads it, its entries, and the edits held on
	it by kind. A click opens its tables.
-->
<script>
	import { count, nameOf, short } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio, db: import('./db.js').Db, onpick: (space: string) => void }} */
	let { s, db, onpick } = $props();

	const entries = $derived(s.spaces.reduce((n, sp) => n + sp.rows.length, 0));
</script>

<div class="stats">
	<div class="stat"><b>{s.spaces.length}</b><span>{s.spaces.length === 1 ? 'space' : 'spaces'}</span></div>
	<div class="stat"><b>{entries}</b><span>{entries === 1 ? 'entry' : 'entries'}</span></div>
	<div class="stat" title="Every signed edit this browser holds, of every vault it knows">
		<b>{db.held.edits}</b><span>signed edits held</span>
	</div>
	<div class="stat" title="The McEliece keys this browser holds, to open what is sealed to it">
		<b>{db.held.keys}</b><span>McEliece keys held</span>
	</div>
</div>

<div class="grid">
	<table>
		<thead>
			<tr>
				<th>Space</th>
				<th>Id</th>
				<th>Read by</th>
				<th class="num">Key epoch</th>
				<th class="num">Entries</th>
				<th class="num">Writes</th>
				<th class="num">Checkpoints</th>
				<th class="num">Key edits</th>
				<th class="num">Grants</th>
				<th class="num">Published</th>
			</tr>
		</thead>
		<tbody>
			{#each s.spaces as sp (sp.id)}
				<!-- the row opens on a click anywhere; its first cell's button takes the keyboard's -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<tr class="rec" onclick={() => onpick(sp.id)}>
					<td><button class="open" onclick={(e) => (e.stopPropagation(), onpick(sp.id))}>{s.space(sp.id)}</button></td>
					<td class="mono" title={sp.id}>{short(sp.id)}</td>
					<td>{#if sp.public}<span class="chip ok">everyone</span>{:else}<span class="chip">its caps’ holders</span>{/if}</td>
					<td class="num">{sp.epoch}</td>
					<td class="num">{sp.rows.length}</td>
					<td class="num">{sp.edits.writes}</td>
					<td class="num">{sp.edits.checkpoints}</td>
					<td class="num">{sp.edits.keys}</td>
					<td class="num">{sp.edits.grants}{sp.edits.revokes ? ` (${sp.edits.revokes} revoked)` : ''}</td>
					<td class="num">{sp.edits.published}</td>
				</tr>
			{:else}
				<tr><td colspan="10" class="soft">{nameOf(s.here)} has founded no space yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="soft note">
	A space is a namespace with a key of its own: its entries are sealed to whoever holds a cap on it, and each rotation
	of its key, as owners revoke, starts a new epoch. {count(s.spaces.length, 'space')} of {nameOf(s.here)}.
</p>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
		gap: 0.7rem;
		margin-bottom: 1.2rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	.stat b {
		font-size: 1.5rem;
		font-variant-numeric: tabular-nums;
	}

	.stat span {
		color: var(--soft);
		font-size: 0.78rem;
	}

	.grid {
		overflow-x: auto;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	table {
		min-width: 100%;
		border-collapse: collapse;
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
	}

	th,
	td {
		padding: 0.5rem 0.7rem;
		border-bottom: 1px solid #ecebe6;
		text-align: left;
		white-space: nowrap;
	}

	th {
		background: #f6f5f1;
		color: var(--soft);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	.num {
		text-align: right;
	}

	.rec {
		cursor: pointer;
	}

	.rec:hover td {
		background: #f4f8f6;
	}

	.open {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.note {
		max-width: 44rem;
		margin: 0.8rem 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
	}
</style>
