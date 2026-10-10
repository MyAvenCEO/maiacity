<!--
	The studio's cells: what this browser holds in all and of the vault, then each cell of its entries, as a database
	studio lists its partitions. A cell is a dynamic group: the entries of the vault the same caps reach, whatever their
	slices select, under one key of its own, which moves to its next generation when a reader may no longer read it. An
	entry tagged into a cap's slice, or out of it, moves to another cell. No cell is named by hand: each is the caps
	that reach it. A click opens its tables.
-->
<script>
	import { count, nameOf, short } from './vaults.js';

	/** @type {{ s: import('./db.js').Studio, db: import('./db.js').Db, onpick: (cell: string) => void }} */
	let { s, db, onpick } = $props();

	/** the cells, the vault's own first, then by how many caps reach them */
	const cells = $derived([...s.cells].sort((a, b) => a.caps.length - b.caps.length));
</script>

<div class="stats">
	<div class="stat"><b>{s.rows.length}</b><span>{s.rows.length === 1 ? 'entry' : 'entries'}</span></div>
	<div class="stat"><b>{cells.length}</b><span>{cells.length === 1 ? 'cell' : 'cells'}</span></div>
	<div class="stat" title="Writes of its entries, and moves of them from cell to cell">
		<b>{db.edits.writes}</b><span>writes, {count(db.edits.moves, 'move')}</span>
	</div>
	<div class="stat" title="Caps issued over it, and how many of those were revoked">
		<b>{db.edits.caps}</b><span>caps, {db.edits.revokes} revoked</span>
	</div>
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
				<th>Cell</th>
				<th>Id</th>
				<th>Reached by</th>
				<th class="num">Key generation</th>
				<th class="num">Entries</th>
			</tr>
		</thead>
		<tbody>
			{#each cells as x (x.id)}
				<!-- the row opens on a click anywhere; its first cell's button takes the keyboard's -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<tr class="rec" onclick={() => onpick(x.id)}>
					<td><button class="open" onclick={(e) => (e.stopPropagation(), onpick(x.id))}>{s.cellName(x.id)}</button></td>
					<td class="mono" title={x.id}>{short(x.id)}</td>
					<td class="reach">{x.caps.length ? s.cell(x.id).replace(/^Shared: /, '') : 'no cap but those on the whole vault'}</td>
					<td class="num">{x.generation}</td>
					<td class="num">{x.entries}</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="soft">{nameOf(s.here)} holds no entry yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="soft note">
	A cell is never named by hand: it is the entries the same caps reach, under one key. A cap on a type or a tag reaches
	every entry that matches it, now and later, so a cell grows and shrinks as entries are written and tagged, and each
	device receives exactly the cells its vaults' caps reach. {count(cells.length, 'cell')} of {nameOf(s.here)}; its seed is
	at generation {db.seed}.
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

	.reach {
		max-width: 28rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.note {
		max-width: 44rem;
		margin: 0.8rem 0 0;
		font-size: 0.82rem;
		line-height: 1.5;
	}
</style>
