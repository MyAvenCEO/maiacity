<script>
	// avenOS's Vault: the person you act as, who owns their vault, and everything below it as a tree. A vault governs
	// what it owns and all that owns in turn; the tree is all it may see. Any vault in it opens here
	// (#/alice/vault/aven): Alice manages Aven as herself, never as Aven. A vault outside the tree doesn't open.
	import Avatar from '../Avatar.svelte';
	import { chain, governs, key, owned, ownerName, owners, vaultName } from '../cast.js';

	let { cast, account, target } = $props();

	const shown = $derived(governs(cast, account).includes(target) ? target : account);
	const vault = $derived(cast.vaults[shown]);
	const above = $derived(chain(cast, shown));
	const below = $derived(governs(cast, shown).length);
</script>

<main data-view="vault" data-account={account} data-shown={shown}>
	<section class="card">
		<div class="head">
			<Avatar {cast} id={shown} size={40} />
			<div>
				<h1>{vault.name}</h1>
				<small>{vault.kind} vault</small>
			</div>
		</div>
		<dl>
			<dt>owned by</dt>
			<dd>{owners(cast, shown).map((owner) => ownerName(cast, owner)).join(', ')}</dd>
			<dt>governed by</dt>
			<dd>
				{above.length ? above.map((id) => vaultName(cast, id)).join(' → ') : 'its owner key alone: nothing is above it'}
			</dd>
			<dt>governs</dt>
			<dd>{below === 1 ? 'one vault' : below ? `${below} vaults` : 'nothing'}{below ? ', in the tree below' : ''}</dd>
			{#if shown !== account}
				<dt>you act as</dt>
				<dd>{vaultName(cast, account)}, which governs it: nobody acts as {vault.name}</dd>
			{/if}
		</dl>
	</section>

	<section class="card">
		<h2>Vaults own vaults</h2>
		{#snippet node(id)}
			{@const children = owned(cast, id)}
			<li data-vault={id}>
				<a class="row" class:here={id === shown} href={`#/${account}/vault${id === account ? '' : `/${id}`}`}>
					<Avatar {cast} {id} size={22} />
					<strong>{vaultName(cast, id)}</strong>
					<small>
						{cast.vaults[id].kind}{cast.vaults[id].kind === 'device' ? ` · key ${key(cast, id).slice(0, 8)}…` : ''}
					</small>
				</a>
				{#if children.length}
					<ul>
						{#each children as child (child)}{@render node(child)}{/each}
					</ul>
				{/if}
			</li>
		{/snippet}
		<ul class="tree">{@render node(shown)}</ul>
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
		width: fit-content;
		padding: 4px 8px 4px 4px;
		color: inherit;
		font-size: 14px;
		text-decoration: none;
		border-radius: 8px;
	}

	.row:hover,
	.row.here {
		background: var(--bg);
	}
</style>
