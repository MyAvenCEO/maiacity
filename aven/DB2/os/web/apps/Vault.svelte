<script>
	// avenOS's Vault: the vault you act as, who owns it, and everything below it as a tree. A vault governs what it owns
	// and all that owns in turn; the tree is all it may see.
	import Avatar from '../Avatar.svelte';
	import { chain, governs, key, owned, ownerName, owners, vaultName } from '../cast.js';

	let { cast, account } = $props();

	const vault = $derived(cast.vaults[account]);
	const above = $derived(chain(cast, account));
	const below = $derived(governs(cast, account).length);
</script>

<main data-view="vault" data-account={account}>
	<section class="card">
		<div class="head">
			<Avatar {cast} id={account} size={40} />
			<div>
				<h1>{vault.name}</h1>
				<small>{vault.kind} vault</small>
			</div>
		</div>
		<dl>
			<dt>owned by</dt>
			<dd>{owners(cast, account).map((owner) => ownerName(cast, owner)).join(', ')}</dd>
			<dt>governed by</dt>
			<dd>
				{above.length ? above.map((id) => vaultName(cast, id)).join(' → ') : 'its owner key alone: nothing is above it'}
			</dd>
			<dt>governs</dt>
			<dd>{below === 1 ? 'one vault' : `${below} vaults`}, in the tree below</dd>
		</dl>
	</section>

	<section class="card">
		<h2>Vaults own vaults</h2>
		{#snippet node(id)}
			{@const children = owned(cast, id)}
			<li data-vault={id}>
				<span class="row">
					<Avatar {cast} {id} size={22} />
					<strong>{vaultName(cast, id)}</strong>
					<small>
						{cast.vaults[id].kind}{cast.vaults[id].kind === 'device' ? ` · key ${key(cast, id).slice(0, 8)}…` : ''}
					</small>
				</span>
				{#if children.length}
					<ul>
						{#each children as child (child)}{@render node(child)}{/each}
					</ul>
				{/if}
			</li>
		{/snippet}
		<ul class="tree">{@render node(account)}</ul>
	</section>
</main>

<style>
	main {
		display: grid;
		gap: 16px;
		padding: 20px 16px;
	}

	.card {
		padding: 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 10px;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 12px;
	}

	h1 {
		margin: 0;
		font-size: 20px;
		line-height: 1.2;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 15px;
	}

	small,
	dt {
		color: var(--muted);
		font-size: 13px;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 2px 14px;
		margin: 0;
		font-size: 14px;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul ul {
		margin-left: 10px;
		padding-left: 18px;
		border-left: 1px solid var(--line);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 0;
		font-size: 14px;
	}
</style>
