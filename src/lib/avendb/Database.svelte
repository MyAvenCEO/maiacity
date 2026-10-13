<!--
	A vault's database studio, as this browser holds it and the acting vault opens it (db.js `studio`), each page its
	own item in the vault's list: the query console (any op of the ops engine), the table editor (its entries as tables,
	by type), its shares (its entries by who they are shared with), its schemas, its lenses, and the database's
	history, every signed edit. The table editor and the shares show the studio's internals, keys' ids and generations
	and documents' sizes, only once the person asks. It reads the database again whenever what the device holds
	changes, and the history only while it shows. What the acting vault doesn't open shows sealed.
-->
<script>
	import History from './History.svelte';
	import Lenses from './Lenses.svelte';
	import Query from './Query.svelte';
	import Schemas from './Schemas.svelte';
	import Cells from './Cells.svelte';
	import TableEditor from './TableEditor.svelte';
	import { studio } from './db.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any,
	 *   view: 'query' | 'tables' | 'shares' | 'schemas' | 'lenses' | 'history', onopen: (entry: string) => void,
	 *   onview: (view: string) => void }}
	 */
	let { world, vault, actor, api, view, onopen, onview } = $props();

	let db = $state(/** @type {import('./db.js').Db | null} */ (null));
	let failed = $state('');
	let log = $state(/** @type {{ edits: import('./db.js').SignedEdit[] } | null} */ (null));
	let logFailed = $state('');
	/** the cell the table editor shows, the entries shared with the same vaults alike: '' for all of them */
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
		api.history().then(
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
	// a cell of another vault leaves the table editor on all of this one's
	const shown = $derived(s.cells.some((x) => x.id === cell) ? cell : '');
</script>

<div class="db">
	{#if view === 'query'}
		<Query {world} {vault} {actor} {api} {onopen} />
	{:else if failed}
		<p class="error">Reading the database failed: {failed}</p>
	{:else if !db || db.vault !== vault}
		<p class="soft">Reading the database…</p>
	{:else if view === 'tables' || view === 'shares'}
		<label class="internals soft">
			<input type="checkbox" bind:checked={internals} /> Show the internals: key ids and generations, document sizes
		</label>
		{#if view === 'tables'}
			<TableEditor {s} bind:cell={() => shown, (v) => (cell = v)} {actor} {internals} {onopen} />
		{:else}
			<Cells {s} {db} {internals} onpick={(id) => ((cell = id), onview('tables'))} />
		{/if}
	{:else if view === 'schemas'}
		<Schemas {s} onlens={() => onview('lenses')} />
	{:else if view === 'lenses'}
		<Lenses {s} />
	{:else}
		<History {s} {log} failed={logFailed} {vault} pqOnly={world.pqOnly} />
	{/if}
</div>

<style>
	.internals {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.8rem;
		font-size: 0.78rem;
		cursor: pointer;
	}
</style>
