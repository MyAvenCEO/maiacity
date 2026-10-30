<script>
	// avenOS's Invite (MILESTONE2.md, thread B), for the admin's owners only: make an invite, shown once as its link
	// and a QR code, see the open ones, withdraw one. Each act is signed with this browser's passkey (invites.js); the
	// open invites are the Aven Peer's word, pushed to the admin's owners' devices (room.svelte.js), never re-queried.
	import { renderSVG } from 'uqr';
	import { invite, withdraw } from '../invites.js';
	import { net } from '../network.svelte.js';
	import { room } from '../room.svelte.js';

	let { account, config } = $props();

	let link = $state('');
	let busy = $state(false);
	let failed = $state('');
	let copied = $state(false);
	const why = $derived(failed || net.refused);
	const qr = $derived(link ? renderSVG(link, { border: 2, whiteColor: '#ffffff', blackColor: '#1d1d1b' }) : '');
	const open = $derived(room.invites ?? []);
	const made = (ms) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

	async function run(act) {
		busy = true;
		failed = '';
		try {
			await act();
		} catch (error) {
			failed = error?.message ?? String(error);
		} finally {
			busy = false;
		}
	}

	const make = () => run(async () => ((copied = false), (link = await invite(config))));
	const take = (id) => run(() => withdraw(config, id));

	async function copy() {
		await navigator.clipboard?.writeText(link).catch(() => {});
		copied = true;
	}
</script>

<main data-view="invite" data-account={account}>
	<section class="make">
		<h1>Invite someone</h1>
		<p class="muted">An invite lets one person in, once. Send its link however you like; it carries a secret.</p>
		<button data-testid="make-invite" disabled={busy || !config} onclick={make}>Make an invite</button>
		{#if link}
			<div class="made" data-testid="invite-made">
				<!-- the QR code is uqr's SVG of the link, made here -->
				<div class="qr" data-testid="invite-qr">{@html qr}</div>
				<div class="link">
					<code data-testid="invite-link">{link}</code>
					<button class="quiet" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
					<small>Shown once: the link is not kept anywhere.</small>
				</div>
			</div>
		{/if}
		{#if why}<p class="refused" data-testid="refused">{why}</p>{/if}
	</section>

	<section aria-label="Open invites">
		<h2>Open invites <small data-testid="open-count">{open.length}</small></h2>
		{#if room.invites === null}
			<p class="muted">Waiting for the Aven Peer…</p>
		{:else if !open.length}
			<p class="muted">None open.</p>
		{/if}
		<ul data-testid="open-invites">
			{#each open as item (item.id)}
				<li data-invite={item.id}>
					<code>{item.id}</code>
					<small>made {made(item.made)}</small>
					<button class="quiet" data-testid="withdraw" disabled={busy} onclick={() => take(item.id)}>Withdraw</button>
				</li>
			{/each}
		</ul>
	</section>
</main>

<style>
	main {
		display: grid;
		gap: 20px;
		max-width: 720px;
		padding: 20px 16px;
	}

	section {
		display: grid;
		gap: 10px;
		padding: 16px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
	}

	h1,
	h2 {
		margin: 0;
		font-size: 18px;
	}

	h2 {
		font-size: 15px;
	}

	.muted,
	small {
		margin: 0;
		color: var(--muted);
		font-size: 13px;
	}

	button {
		justify-self: start;
		padding: 8px 14px;
		color: var(--surface);
		font: inherit;
		background: var(--text);
		border: 0;
		border-radius: 999px;
		cursor: pointer;
	}

	button.quiet {
		padding: 4px 10px;
		color: var(--text);
		font-size: 13px;
		background: transparent;
		border: 1px solid var(--line);
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.made {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: start;
	}

	.qr {
		width: 180px;
		line-height: 0;
	}

	.qr :global(svg) {
		width: 100%;
		height: auto;
	}

	.link {
		display: grid;
		flex: 1;
		gap: 8px;
		min-width: 200px;
	}

	code {
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}

	li button {
		margin-left: auto;
	}

	.refused {
		margin: 0;
		color: var(--pending);
	}
</style>
