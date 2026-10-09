<!--
	New vaults the person's vault founds and owns: aven vaults, an agent's or a server's own, and coop vaults, each with
	its name. One ceremony of their passkey signs all their geneses (avendb-browser's `Device::found_vaults`); then this
	browser, acting for each through their vault, founds its home, lets avenCEO relay it and writes its name there. It
	opens on one empty row: the person names every vault they found, as many as they like.
-->
<script>
	import { count, nameOf } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, api: any, busy: boolean, onclose: () => void }} */
	let { world, api, busy, onclose } = $props();

	const mine = $derived(world.vaults.find((v) => v.id === world.mine));

	/** @typedef {{ name: string, kind: 'aven' | 'coop' }} Row */
	/** @type {Row[]} */
	let rows = $state([{ name: '', kind: 'aven' }]);
	const ready = $derived(rows.filter((r) => r.name.trim()));

	async function create() {
		if (await api.foundVaults(ready.map((r) => ({ name: r.name.trim(), kind: r.kind })))) onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
	<div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="new-vaults">
		<h3 id="new-vaults">New vaults {nameOf(mine)} owns</h3>
		<p class="soft">
			Each is a real vault on avenDB's network, owned by your vault: this browser acts as it, and its own caps decide what
			it may read, write and share. An aven is an agent's or a server's vault; a coop has no devices and acts through its
			owners.
		</p>
		{#each rows as row, i (i)}
			<div class="row line">
				<input class="field grow" placeholder="Its name" bind:value={row.name} aria-label="Vault {i + 1}'s name" />
				<select class="field" bind:value={row.kind} aria-label="Vault {i + 1}'s kind">
					<option value="aven">Aven</option>
					<option value="coop">Coop</option>
				</select>
				<button class="btn quiet" aria-label="Leave it out" onclick={() => rows.splice(i, 1)}>×</button>
			</div>
		{/each}
		<button class="btn quiet" onclick={() => rows.push({ name: '', kind: 'aven' })}>Add another</button>
		<div class="row actions">
			<button class="btn primary" disabled={busy || !ready.length} onclick={create}>
				Create {count(ready.length, 'vault')}
			</button>
			<button class="btn quiet" onclick={onclose}>Cancel</button>
		</div>
		<p class="soft">Your browser asks for your passkey once, for all of them.</p>
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
