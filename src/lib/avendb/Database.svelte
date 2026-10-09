<!--
	A vault's database studio, as this browser holds it and the acting vault opens it (db.js `studio`), each page its
	own item in the vault's list: the table editor (its entries as tables), its spaces, its schemas, its lenses, and
	the database's history, every signed edit. It reads the database again whenever what the device holds changes, and
	the history only while it shows. What the acting vault holds no cap to read shows sealed, as avenDB's server holds it.
-->
<script>
	import History from './History.svelte';
	import Lenses from './Lenses.svelte';
	import Schemas from './Schemas.svelte';
	import Spaces from './Spaces.svelte';
	import TableEditor from './TableEditor.svelte';
	import { studio } from './db.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any,
	 *   view: 'tables' | 'spaces' | 'schemas' | 'lenses' | 'history', onopen: (entry: string) => void,
	 *   onact: (vault: string) => void, onview: (view: string) => void }}
	 */
	let { world, vault, actor, api, view, onopen, onact, onview } = $props();

	let db = $state(/** @type {import('./db.js').Db | null} */ (null));
	let failed = $state('');
	let log = $state(/** @type {{ edits: import('./db.js').SignedEdit[] } | null} */ (null));
	let logFailed = $state('');
	/** the space the table editor shows: '' for all of them */
	let space = $state('');

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
	// a space of another vault leaves the table editor on all of this one's
	const shown = $derived(s.spaces.some((sp) => sp.id === space) ? space : '');
</script>

<div class="db">
	{#if failed}
		<p class="error">Reading the database failed: {failed}</p>
	{:else if !db || db.vault !== vault}
		<p class="soft">Reading the database…</p>
	{:else if view === 'tables'}
		<TableEditor {s} bind:space={() => shown, (v) => (space = v)} {vault} {actor} {onopen} {onact} />
	{:else if view === 'spaces'}
		<Spaces {s} {db} onpick={(id) => ((space = id), onview('tables'))} />
	{:else if view === 'schemas'}
		<Schemas {s} onlens={() => onview('lenses')} />
	{:else if view === 'lenses'}
		<Lenses {s} />
	{:else}
		<History {s} {log} failed={logFailed} {vault} pqOnly={world.pqOnly} />
	{/if}
</div>
