<!--
	New vaults the person's vault founds and owns, each with its name, of the kinds the kind table lets it found here
	(the world's `kinds`): those its kind may own that hold no devices, a coop, and an aven while it owns fewer than one
	owner may, as a device vault comes with its device, an agent's on the consent screen. One ceremony of their passkey
	signs all their geneses (the `found` op, avendb-browser's `Device::found_vaults`); then this browser, acting for each
	through their vault, founds its home, lets avenCEO server relay it and writes its name there. It opens on one empty
	row: the person names every vault they found, as many as they like, and Create shows once the device answers a dry
	run of founding them (`may`).
-->
<script>
	import { allowed, may } from './ops.js';
	import { count, KINDS, kindRules, list, mayOwn, nameOf, ownedBy, why } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, api: any, busy: boolean, onclose: () => void }} */
	let { world, api, busy, onclose } = $props();

	const mine = $derived(world.vaults.find((v) => v.id === world.mine));

	/** the kinds the person's vault may found here, in the kind table's order: those it may own one more of that hold
	 *  no devices */
	const kinds = $derived(
		mine ? (world.kinds ?? []).filter((k) => !k.devices && mayOwn(world, mine, k.kind)).map((k) => k.kind) : []
	);
	/** the kinds their vault may own but owns as many of as one owner may, with those it owns: a second aven */
	const full = $derived.by(() => {
		if (!mine) return [];
		const owns = ownedBy(world, mine.id);
		/** @param {import('./vaults.js').KindRules} k */
		const held = (k) => !k.devices && k.ownedBy !== 'signers' && k.ownedBy.includes(mine.kind) && !kinds.includes(k.kind);
		return (world.kinds ?? [])
			.filter(held)
			.map((k) => ({ kind: k.kind, each: k.each ?? 0, owned: owns.filter((v) => v.kind === k.kind) }))
			.filter((k) => k.owned.length);
	});

	/** @typedef {{ name: string, kind: import('./vaults.js').Kind }} Row */
	/** How many more vaults of kind `kind` rows may found, beside row `row`: as many as one owner may own, less those
	 *  their vault owns and the other rows found. @param {string} kind @param {Row} [row] */
	function room(kind, row) {
		const each = kindRules(world, kind)?.each;
		if (each == null) return Infinity;
		const owned = mine ? ownedBy(world, mine.id).filter((v) => v.kind === kind).length : each;
		return each - owned - rows.filter((r) => r !== row && r.kind === kind).length;
	}
	/** a new row's kind: the first the person's vault may found one more of */
	const next = () => kinds.find((k) => room(k) > 0) ?? kinds[0];

	let rows = $state(/** @type {Row[]} */ ([]));
	// one empty row to start from, of the first kind it may found
	let started = false;
	$effect.pre(() => {
		if (started || !kinds.length) return;
		started = true;
		rows.push({ name: '', kind: kinds[0] });
	});
	const ready = $derived(rows.filter((r) => r.name.trim()));
	/** The op that founds them. */
	const op = $derived({ op: 'found', vaults: ready.map((r) => ({ name: r.name.trim(), kind: r.kind })) });

	/** why the device won't found them, as it answers a dry run of it: '' where it would */
	let unfounded = $state('');
	$effect(() => {
		const o = $state.snapshot(op);
		unfounded = '';
		if (!o.vaults.length) return;
		let gone = false;
		may(api, world.mine, [o]).then(([a]) => !gone && (unfounded = allowed(a) ? '' : why(/** @type {any} */ (a))));
		return () => {
			gone = true;
		};
	});

	async function create() {
		if (await api.run(`Creating ${count(ready.length, 'vault')}`, $state.snapshot(op))) onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="new-vaults">
		<h3 id="new-vaults">New vaults {nameOf(mine)} owns</h3>
		<p class="soft">
			Each is a real vault on avenDB's network, owned by your vault: this browser acts as it, and what is shared with it
			decides what it may read, write and share. A coop is a company or a group, acting through its owners; your aven is
			the one identity your agents act as, each agent a device vault under it that joins from the Mac app.
		</p>
		{#each full as k (k.kind)}
			<p class="soft">
				You own {list(k.owned.map(nameOf))} already, and a vault owns {k.each === 1 ? 'one' : k.each}
				{KINDS[k.kind].toLowerCase()}{k.each === 1 ? '' : 's'} at most.
			</p>
		{/each}
		{#each rows as row, i (i)}
			<div class="row line">
				<input class="field grow" placeholder="Its name" bind:value={row.name} aria-label="Vault {i + 1}'s name" />
				<select class="field" bind:value={row.kind} aria-label="Vault {i + 1}'s kind">
					{#each kinds as k (k)}
						<option value={k} disabled={k !== row.kind && room(k, row) <= 0}>{KINDS[k]}</option>
					{/each}
				</select>
				<button class="btn quiet" aria-label="Leave it out" onclick={() => rows.splice(i, 1)}>×</button>
			</div>
		{/each}
		{#if kinds.length}
			<button class="btn quiet" onclick={() => rows.push({ name: '', kind: next() })}>Add another</button>
		{/if}
		<div class="row actions">
			<button class="btn primary" disabled={busy || !ready.length || !!unfounded} onclick={create}>
				Create {count(ready.length, 'vault')}
			</button>
			<button class="btn quiet" onclick={onclose}>Cancel</button>
		</div>
		<p class="soft">{unfounded ? `It can’t: ${unfounded}.` : 'Your passkey confirms them all at once.'}</p>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgb(20 28 24 / 0.35);
	}

	.dialog {
		width: min(32rem, 100%);
		max-height: calc(100vh - 2rem);
		overflow: auto;
		box-shadow: 0 12px 40px rgb(0 0 0 / 0.2);
	}

	h3 {
		margin: 0 0 0.4rem;
	}

	p {
		line-height: 1.5;
	}

	.line {
		margin-bottom: 0.5rem;
	}

	.grow {
		flex: 1 1 12rem;
	}

	.actions {
		margin-top: 0.8rem;
	}
</style>
