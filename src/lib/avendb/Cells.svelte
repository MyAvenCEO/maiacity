<!--
	The studio's shares: what this browser holds of the vault, then its entries by who they are shared with, as a
	database studio lists its partitions: each row the entries the same shares reach, named by who they are shared
	with. A share on a type or a tag reaches what matches it now and later, so a row grows and shrinks as entries are
	written and tagged. Each row is one key of the core's (a cell); its id and its key's generation, which moves on when
	a reader may no longer read it, show with the studio's internals, with how much this browser holds in all. A click
	opens its tables.
-->
<script>
	import { count, nameOf, short } from './vaults.js';

	/**
	 * @type {{ s: import('./db.js').Studio, db: import('./db.js').Db, internals: boolean,
	 *   onpick: (cell: string) => void }}
	 */
	let { s, db, internals, onpick } = $props();

	/** the entries by who they are shared with, the vault's own alone first, then by how many shares reach them */
	const cells = $derived([...s.cells].sort((a, b) => a.caps.length - b.caps.length));
</script>

<div class="stats">
	<div class="stat"><b>{s.rows.length}</b><span>{s.rows.length === 1 ? 'entry' : 'entries'}</span></div>
	<div class="stat" title="Writes of its entries">
		<b>{db.edits.writes}</b><span>writes</span>
	</div>
	<div class="stat" title="Shares given over it, and how many of those were revoked">
		<b>{db.edits.caps}</b><span>shares, {db.edits.revokes} revoked</span>
	</div>
	{#if internals}
		<div class="stat" title="The keys of its entries: one for the entries the same shares reach">
			<b>{cells.length}</b>
			<span>{cells.length === 1 ? 'key' : 'keys'}, {count(db.edits.moves, 'move')} between them</span>
		</div>
		<div class="stat" title="Every signed edit this browser holds, of every vault it knows">
			<b>{db.held.edits}</b><span>signed edits held</span>
		</div>
		<div class="stat" title="The McEliece keys this browser holds, to open what is sealed to it">
			<b>{db.held.keys}</b><span>McEliece keys held</span>
		</div>
	{/if}
</div>

<div class="grid">
	<table>
		<thead>
			<tr>
				<th>Shared with</th>
				<th class="num">Entries</th>
				{#if internals}
					<th>Key id</th>
					<th class="num">Key generation</th>
				{/if}
			</tr>
		</thead>
		<tbody>
			{#each cells as x (x.id)}
				<!-- the row opens on a click anywhere; its first cell's button takes the keyboard's -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<tr class="rec" onclick={() => onpick(x.id)}>
					<td class="reach">
						<button class="open" onclick={(e) => (e.stopPropagation(), onpick(x.id))}>
							{s.sharedIn(x.id) ?? short(x.id)}
						</button>
					</td>
					<td class="num">{x.entries}</td>
					{#if internals}
						<td class="mono" title={x.id}>{short(x.id)}</td>
						<td class="num">{x.generation}</td>
					{/if}
				</tr>
			{:else}
				<tr><td colspan={internals ? 4 : 2} class="soft">{nameOf(s.here)} holds no entry yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="soft note">
	Each row is the entries of {nameOf(s.here)} the same shares reach. A share on a type or a tag reaches every entry that
	matches it, now and later, so a row grows and shrinks as entries are written and tagged, and each device gets exactly
	what is shared with its vault.{internals
		? ` Each row has one key, whose generation moves on when a reader may no longer read it; the vault's seed is at` +
			` generation ${db.seed}.`
		: ''}
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
