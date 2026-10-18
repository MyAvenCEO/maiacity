<!--
	The app's one dashboard and avenDB in it (Samuel 2026-10-18: no avenDB page of its own): the person's account
	($lib/avendb/Account.svelte), whose home is the dashboard ($lib/app/Dashboard.svelte), the games, the apps and the
	vault's pages, each of which opens right here (`#sparks`, `#library`, …) in the vault picked in the nav pill, a coop
	and a person's own alike. Mounted here, its upkeep (the repo seed, the access requests) runs wherever the app opens.
-->
<script>
	import Account from '$lib/avendb/Account.svelte';
</script>

<svelte:head>
	<title>Dashboard · maiaCITY</title>
</svelte:head>

<main class="avendb">
	<Account />
</main>

<style>
	.avendb {
		min-height: 100vh;
		background: #f4f1eb;
		color: #1f2a23;
		--ok: #3f7a4f;
		--bad: #b5523a;
		--soft: rgb(0 0 0 / 0.55);
		--edge: rgb(0 0 0 / 0.1);
		--card: #fff;
		--accent: #2f6d62;
	}

	/* what the screens share */
	.avendb :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.38rem 0.8rem;
		border: 1px solid rgb(0 0 0 / 0.14);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		color: inherit;
		cursor: pointer;
		white-space: nowrap;
	}

	.avendb :global(.btn:hover:not(:disabled)) {
		border-color: var(--accent);
		color: var(--accent);
	}

	.avendb :global(.btn:disabled) {
		opacity: 0.5;
		cursor: default;
	}

	.avendb :global(.btn.primary) {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.avendb :global(.btn.primary:hover:not(:disabled)) {
		color: #fff;
		filter: brightness(1.08);
	}

	.avendb :global(.btn.quiet) {
		border-color: transparent;
		background: transparent;
	}

	.avendb :global(.btn.danger:hover:not(:disabled)) {
		border-color: var(--bad);
		color: var(--bad);
	}

	/* a card's heading in the body's face: the display face, cut for titles, runs its words together this small */
	.avendb :global(h3) {
		font-family: var(--font-body);
		font-size: 1rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
		line-height: 1.3;
	}

	.avendb :global(.card) {
		padding: 1rem 1.1rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: var(--card);
	}

	.avendb :global(.cards) {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 21rem), 1fr));
		gap: 0.9rem;
	}

	.avendb :global(.chip) {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.08rem 0.55rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.06);
		font-size: 0.74rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.avendb :global(.chip.ok) {
		background: #dcebd9;
		color: #2b5a37;
	}

	.avendb :global(.chip.bad) {
		background: #f3d6cc;
		color: #7a2f1c;
	}

	.avendb :global(.chip.warn) {
		background: #efe3c8;
		color: #6a4b12;
	}

	.avendb :global(.chip.accent) {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.avendb :global(.mono) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8em;
	}

	.avendb :global(.soft) {
		color: var(--soft);
	}

	.avendb :global(.row) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.45rem;
	}

	.avendb :global(.field) {
		padding: 0.38rem 0.6rem;
		border: 1px solid rgb(0 0 0 / 0.15);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.86rem;
		color: inherit;
	}

	.avendb :global(.empty) {
		padding: 1rem;
		border: 1px dashed rgb(0 0 0 / 0.15);
		border-radius: 12px;
		color: var(--soft);
		font-size: 0.9rem;
	}

	.avendb :global(.error) {
		color: var(--bad);
		font-size: 0.9rem;
	}
</style>
