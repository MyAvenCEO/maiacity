<!--
	A vault's database studio, as this browser holds it and the acting vault opens it (db.js `studio`), each page its
	own item in the vault's list: the query console (any op of the ops engine), the table editor (its entries as tables,
	by type, of all of them or of those shared with the same vaults alike), its schemas, its lenses, and the database's
	history, every signed edit. Who a vault is shared with is the vault's Sharing page, the one place for it. The table
	editor shows the studio's internals, what this browser holds, keys' ids and generations, documents' sizes and the
	mark of an entry to run now, only once the person asks. It reads the database again whenever what the device holds
	changes (the `database` op), and the history only while it shows (`log`). What the acting vault doesn't open shows
	sealed.
-->
<script>
	import History from './History.svelte';
	import Lenses from './Lenses.svelte';
	import Query from './Query.svelte';
	import Schemas from './Schemas.svelte';
	import TableEditor from './TableEditor.svelte';
	import { studio } from './db.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any,
	 *   view: 'query' | 'tables' | 'schemas' | 'lenses' | 'history', onopen: (entry: string) => void,
	 *   onview: (view: string) => void }}
	 */
	let { world, vault, actor, api, view, onopen, onview } = $props();

	let db = $state(/** @type {import('./db.js').Db | null} */ (null));
	let failed = $state('');
	let log = $state(/** @type {{ edits: import('./db.js').SignedEdit[] } | null} */ (null));
	let logFailed = $state('');
	/** who the entries the table editor shows are shared with, in words (`s.byWho`): '' for all of them */
	let cell = $state('');
	/** whether the studio shows its internals */
	let internals = $state(false);

	// what the device holds changed, or another vault is picked: read its database again
	$effect(() => {
		void world;
		const v = vault;
		let gone = false;
		api.database(v).then(
			(/** @type {import('./db.js').Db} */ d) => {
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

	// and its history, while it shows
	$effect(() => {
		void world;
		if (view !== 'history') return;
		let gone = false;
		api.log().then(
			(/** @type {{ edits: import('./db.js').SignedEdit[] }} */ l) => {
				if (!gone) [log, logFailed] = [l, ''];
			},
			(/** @type {Error} */ e) => {
				if (!gone) logFailed = e.message ?? String(e);
			}
		);
		return () => {
			gone = true;
		};
	});

	const s = $derived(studio(world, db, vault, actor));
	// who another vault's entries were shared with leaves the table editor on all of this one's
	const shown = $derived(s.byWho.some((g) => g.words === cell) ? cell : '');
</script>

<div class="db">
	{#if view === 'query'}
		<Query {world} {vault} {actor} {api} {onopen} />
	{:else if failed}
		<p class="error">Reading the database failed: {failed}</p>
	{:else if !db || db.vault !== vault}
		<p class="soft">Reading the database…</p>
	{:else if view === 'tables'}
		<label class="internals soft">
			<input type="checkbox" bind:checked={internals} /> Show the internals: what this browser holds, key ids and
			generations, document sizes
		</label>
		{#if internals}
			<div class="stats">
				<div class="stat"><b>{s.rows.length}</b><span>{s.rows.length === 1 ? 'entry' : 'entries'}</span></div>
				<div class="stat" title="Writes of its entries"><b>{db.edits.writes}</b><span>writes</span></div>
				<div class="stat" title="Shares given over it, and how many of those were revoked">
					<b>{db.edits.shares}</b><span>shares, {db.edits.revokes} revoked</span>
				</div>
				<div class="stat" title="The keys of its entries: one for the entries the same shares reach">
					<b>{s.cells.length}</b><span>{s.cells.length === 1 ? 'key' : 'keys'}, its seed at generation {db.seed}</span>
				</div>
				<div class="stat" title="Every signed edit this browser holds, of every vault it knows">
					<b>{db.held.edits}</b><span>signed edits held</span>
				</div>
				<div class="stat" title="The McEliece keys this browser holds, to open what is sealed to it">
					<b>{db.held.keys}</b><span>McEliece keys held</span>
				</div>
			</div>
		{/if}
		<TableEditor {s} bind:cell={() => shown, (v) => (cell = v)} {actor} {api} {internals} {onopen} />
	{:else if view === 'schemas'}
		<Schemas {s} {api} {vault} {actor} onlens={() => onview('lenses')} />
	{:else if view === 'lenses'}
		<Lenses {s} />
	{:else}
		<History {s} {log} failed={logFailed} {vault} />
	{/if}
</div>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 10rem), 1fr));
		gap: 0.7rem;
		margin-bottom: 1rem;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	.stat b {
		font-size: 1.3rem;
		font-variant-numeric: tabular-nums;
	}

	.stat span {
		color: var(--soft);
		font-size: 0.78rem;
	}

	.internals {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.8rem;
		font-size: 0.78rem;
		cursor: pointer;
	}
</style>
