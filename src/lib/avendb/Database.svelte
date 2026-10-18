<!--
	A vault's database studio, as this browser holds it and the acting vault opens it (db.js `studio`), each page its
	own item in the vault's list and each in the layout every avenDB view has (./Frame.svelte): the query console (any
	op of the ops engine), the table editor (its entries as tables, by schema, of all of them or of those shared with
	the same vaults alike), its schemas, its lenses, and the database's history, every signed edit. This only picks the
	page; each lays out its own sides, and while the database is read, or if reading it fails, that shows in a plain
	frame. Who a vault is shared with is the vault's Sharing page, the one place for it. The table editor shows the
	studio's internals, what this browser holds, keys' ids and generations, documents' sizes and the mark of an entry
	to run now, only once the person asks. It reads the database again whenever what the device holds changes (the
	`database` op), and the history only while it shows (`log`). What the acting vault doesn't open shows sealed. Who
	the table editor's entries are shared with, whether it shows the internals and the lens picked stay while the person
	moves between the pages.
-->
<script>
	import Frame from './Frame.svelte';
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
	/** the lens the Lenses page shows, by its id: '' for the first */
	let lens = $state('');

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

	/** Show lens `id` on the Lenses page. @param {string} id */
	function toLens(id) {
		lens = id;
		onview('lenses');
	}
</script>

{#if view === 'query'}
	<Query {world} {vault} {actor} {api} {onopen} />
{:else if failed}
	<Frame><p class="error">Reading the database failed: {failed}</p></Frame>
{:else if !db || db.vault !== vault}
	<Frame><p class="soft">Reading the database…</p></Frame>
{:else if view === 'tables'}
	<TableEditor {s} {db} bind:cell={() => shown, (v) => (cell = v)} bind:internals {actor} {api} {onopen} />
{:else if view === 'schemas'}
	<Schemas {s} {api} {vault} {actor} onlens={toLens} />
{:else if view === 'lenses'}
	<Lenses {s} bind:picked={lens} />
{:else}
	<History {s} {log} failed={logFailed} {vault} />
{/if}
