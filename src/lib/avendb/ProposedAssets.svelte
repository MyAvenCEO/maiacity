<!--
	The assets an AIP proposes, in 3D, before its vault answers it: its `recipe` lines (a new version of an asset, or a
	new asset), each read on its own line with `get` (its record and the files the line brings), read as the vault's own
	assets are (./assets.js `proposedSource`) and built from the newest file on its line, held to its hash, as avenDB's
	Assets builds one ($lib/assets/VaultAsset.svelte); a tab for each where it proposes several. What none of its lines
	lets through is said, and nothing stands in for it. The HITL card shows it `compact` (./Hitl.svelte), the Proposals
	app whole ($lib/proposals/AvendbAip.svelte).
-->
<script>
	import { untrack } from 'svelte';
	import { proposedSource } from './assets.js';

	/**
	 * @type {{ lines: { entry: string, line: string, type: string | null }[], ask: (op: any) => Promise<any>,
	 *   read: import('./files.js').Read, key: string, compact?: boolean }}
	 *   `lines` the AIP's lines, `ask` the device's read (`api.ask`), `read` its file reader (`api.readFile`), `key` the AIP
	 *   and the version of its lines, read again when it changes
	 */
	let { lines, ask, read, key, compact = false } = $props();

	/** the viewer, with three.js and the asset stage, loaded once there is an asset to show */
	let viewer = $state(/** @type {Promise<any> | null} */ (null));

	/** what an asset's card is called: its kind, and its variant where that is a name of its own (`Ant · Wood ant`) */
	const nameOf = (/** @type {any} */ card) => {
		const [kind, variant] = String(card.label ?? card.id).split(': ');
		return variant && variant !== kind ? `${kind} · ${variant}` : kind;
	};

	/** @typedef {{ key: string, source: any, shown: { hash: string, title: string, note: string }[], why: string }} Proposed */
	/** the assets proposed, by the key they were read for: the ones that check to show (`shown`), else why none does */
	let proposed = $state.raw(/** @type {Proposed | null} */ (null));
	let pick = $state(0);
	$effect(() => {
		const at = key;
		const recipes = untrack(() => lines).filter((l) => l.type === 'recipe');
		[proposed, pick] = [null, 0];
		if (!recipes.length) return;
		let gone = false;
		Promise.all(recipes.map((l) => ask({ op: 'get', entry: l.entry, line: l.line }))).then(
			(/** @type {any[]} */ got) => {
				if (gone) return;
				const rows = got.map((g) => g?.ok).filter(Boolean);
				const source = proposedSource(rows, read);
				const cards = rows.map((r) => r.record?.card).filter((c) => c?.recipe && Object.hasOwn(source.index.recipes, c.recipe));
				const shown = cards.map((c) => ({ hash: c.recipe, title: `${nameOf(c)} v${c.version}`, note: c.note ?? '' }));
				if (shown.length) viewer ??= import('$lib/assets/VaultAsset.svelte');
				proposed = { key: at, source, shown, why: source.refused.join('; ') || 'this device holds none of its lines' };
			},
			(/** @type {Error} */ e) => {
				if (!gone) proposed = { key: at, source: null, shown: [], why: e?.message ?? String(e) };
			}
		);
		return () => {
			gone = true;
		};
	});
	const shown = $derived(proposed?.key === key ? proposed.shown[pick] : undefined);
</script>

{#if proposed?.key === key}
	<div class="proposed" class:compact>
		{#if proposed.shown.length > 1}
			<p class="picks">
				{#each proposed.shown as p, i (p.hash)}
					<button class="pick" class:on={i === pick} onclick={() => (pick = i)}>{p.title}</button>
				{/each}
			</p>
		{/if}
		{#if shown && viewer}
			{#await viewer then { default: VaultAsset }}
				<VaultAsset source={proposed.source} hash={shown.hash} title={shown.title} note={shown.note} {compact} />
			{/await}
		{:else if !shown}
			<p class="why">The asset it proposes is not shown: {proposed.why}</p>
		{/if}
	</div>
{/if}

<style>
	.proposed {
		margin: 0 0 0.9rem;
	}

	.proposed.compact {
		margin: 0 0 0.6rem;
	}

	.picks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 0.4rem;
	}

	.pick {
		padding: 0.15rem 0.6rem;
		border: 1px solid var(--edge, rgb(0 0 0 / 0.1));
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		background: #fff;
		color: inherit;
		cursor: pointer;
	}

	.pick.on {
		border-color: var(--accent, #2f6d62);
		background: color-mix(in srgb, var(--accent, #2f6d62) 12%, transparent);
		color: var(--accent, #2f6d62);
	}

	.why {
		margin: 0;
		font-size: 0.84rem;
		color: #8a3a2a;
	}
</style>
