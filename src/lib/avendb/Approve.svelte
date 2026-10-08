<!--
	A change to a vault, waiting for the passkeys that approve it: each signer that has to sign, those that have and
	those it still waits for. In the Lab every passkey is at hand, so each "signs" here; sending it with fewer than the
	vault needs shows the rules refusing it.
-->
<script>
	import { onMount } from 'svelte';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   title: string,
	 *   vaults: string[],
	 *   action: Record<string, unknown>,
	 *   extra?: string,
	 *   onclose: () => void
	 * }}
	 */
	let { world, device, act, title, vaults, action, extra, onclose } = $props();

	/** @type {{ id: string, name: string }[]} */
	let signers = $state([]);
	/** @type {string[]} */
	let signed = $state([]);
	let loading = $state(true);
	let error = $state('');
	let sending = $state(false);

	const waiting = $derived(signers.filter((s) => !signed.includes(s.id)));

	onMount(async () => {
		try {
			signers = await world.view({ view: 'approvers', on: device, vaults });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
		loading = false;
	});

	/** @param {string} id */
	const sign = (id) => (signed = signed.includes(id) ? signed.filter((s) => s !== id) : [...signed, id]);

	async function send() {
		sending = true;
		await act({ ...action, signers: signed.length ? signed : undefined });
		sending = false;
		onclose();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim">
	<div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
		<header>
			<small>Waiting for approval</small>
			<h2>{title}</h2>
			{#if extra}<p class="soft">{extra}</p>{/if}
		</header>
		{#if loading}
			<p class="soft">Finding who approves…</p>
		{:else if error}
			<p class="error">{error}</p>
		{:else if !signers.length}
			<p class="soft">No passkeys this device knows of reach the vault's threshold: the rules will refuse it.</p>
		{:else}
			<ul>
				{#each signers as s (s.id)}
					<li>
						<span class="who">{s.name}</span>
						{#if signed.includes(s.id)}
							<span class="chip ok">signed</span>
							<button class="btn quiet" onclick={() => sign(s.id)}>Undo</button>
						{:else}
							<span class="chip warn">yet to sign</span>
							<button class="btn" onclick={() => sign(s.id)}>Sign with this passkey</button>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="soft">
				{#if waiting.length}Still waiting for {waiting.map((s) => s.name).join(', ')}.{:else}Everyone has signed.{/if}
			</p>
		{/if}
		<footer class="row">
			<button class="btn primary" disabled={loading || sending || (!!signers.length && !signed.length)} onclick={send}>
				{waiting.length && signed.length ? `Send with ${signed.length} of ${signers.length}` : 'Send'}
			</button>
			<button class="btn quiet" onclick={onclose}>Cancel</button>
		</footer>
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: rgb(20 28 24 / 0.35);
	}

	.sheet {
		width: min(32rem, 100%);
		max-height: 90vh;
		overflow: auto;
		padding: 1.3rem 1.4rem 1.1rem;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 18px 50px rgb(0 0 0 / 0.25);
	}

	small {
		color: var(--accent);
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	h2 {
		margin: 0.25rem 0 0.4rem;
		font-size: 1.35rem;
	}

	ul {
		margin: 0.8rem 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.who {
		flex: 1;
		font-weight: 500;
	}

	footer {
		margin-top: 0.8rem;
	}
</style>
