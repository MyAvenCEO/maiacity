<script>
	// The invite link's screen (MILESTONE2.md, "What a person sees"): `#/join/<invite>.<secret>` asks a name, makes a
	// passkey, and sends the join, signed by it and by the invite's one-time key (invites.js). Once the Aven Peer has
	// taken it, this browser is a device of the new member's vault and avenOS opens on its dashboard (Network.svelte).
	// The link works once: a used or withdrawn invite is the Aven Peer's to refuse, and the refusal shows here.
	import Phase from './Phase.svelte';
	import { join } from './invites.js';
	import { net } from './network.svelte.js';
	import { describe, live } from './peers.svelte.js';

	let { config, link } = $props();

	let name = $state('');
	let busy = $state(false);
	let failed = $state('');
	const why = $derived(failed || net.refused);

	async function submit(event) {
		event.preventDefault();
		busy = true;
		failed = '';
		try {
			await join(config, link, name.trim());
		} catch (error) {
			failed = error?.message ?? String(error);
		} finally {
			busy = false;
		}
	}
</script>

<main data-view="join">
	<h1>avenOS</h1>
	<form onsubmit={submit}>
		<h2>You're invited</h2>
		<p class="muted">Join the network with your name and a passkey on this device. The invite works once.</p>
		<label>
			Your name
			<input data-testid="name" bind:value={name} required maxlength="48" autocomplete="name" placeholder="Ada" />
		</label>
		<button data-testid="join" disabled={busy || !net.key || !name.trim()}>Join with a passkey</button>
	</form>
	{#if why}<p class="refused" data-testid="refused">{why}</p>{/if}
	<p class="status"><Phase phase={live.own?.phase} text={describe(live.own)} testid="status" /></p>
</main>

<style>
	main {
		display: grid;
		gap: 20px;
		max-width: 440px;
		margin: 10vh auto 0;
		padding: 0 16px 48px;
	}

	h1 {
		margin: 0;
		color: var(--accent);
		font-size: 30px;
	}

	h2 {
		margin: 0;
		font-size: 26px;
	}

	form {
		display: grid;
		gap: 16px;
		padding: 24px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-soft);
	}

	label {
		display: grid;
		gap: 8px;
		color: var(--muted);
		font-size: 13px;
	}

	button {
		justify-self: start;
	}

	.muted {
		margin: 0;
		color: var(--muted);
	}

	.refused {
		margin: 0;
		padding: 12px 16px;
		color: var(--down);
		font-size: 14px;
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--radius-inner);
	}

	.status {
		margin: 0;
	}
</style>
