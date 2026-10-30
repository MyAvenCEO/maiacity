<script>
	// avenOS on an Aven Peer's host without a cast (PRODUCTION.md, "What a person sees"). Unclaimed, one screen: Sign
	// up, which asks for the person's name, then makes a passkey (Part C); the first signup claims the network. Claimed, this browser opens avenOS's dashboard as the admin's
	// vault once it is one of the network's devices; any other browser sees "invite only, coming soon", and anyone whose
	// vault the network holds, the admin or a member, signs in there with their passkey, which makes it a device of
	// their vault too (Aven.ID.SignIn). A passkey that owns no vault here is refused with a word to ask for an invite. `#/claim` shows the signup screen whatever the
	// network says: a second signup is the Aven Peer's to refuse, and it does.
	//
	// Offline first (README rule 3): a returning browser opens on the tree its Peer-Light keeps, before any link, and a
	// browser that can't reach the network is told so plainly, with the reason in the timeline. Sign in shows while
	// connecting too: the passkey's ceremony is local, and the statement it signs waits in the Peer-Light's store until
	// the network takes it, so the person taps once and this browser joins by itself when it is back.
	import App from './App.svelte';
	import Join from './Join.svelte';
	import Phase from './Phase.svelte';
	import { at, tree } from './id.svelte.js';
	import { readLink } from './invites.js';
	import { castOf, claim, net, signIn } from './network.svelte.js';
	import Offline from './Offline.svelte';
	import { describe, live } from './peers.svelte.js';

	let { config } = $props();

	const read = () => location.hash.replace(/^#\/?/, '').split('/')[0];
	let route = $state(read());
	// an invite's link, `#/join/<invite>.<secret>` (Join.svelte)
	let link = $state(readLink(location.hash));
	$effect(() => {
		const follow = () => ((route = read()), (link = readLink(location.hash)));
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});

	// a device of the network once the Peer-Light's views of its tree have this browser in them
	const member = $derived(Boolean(net.me && tree.has(net.me)));
	let busy = $state(false);
	let name = $state('');
	let failed = $state('');
	const why = $derived(failed || net.refused);

	async function run(ceremony) {
		busy = true;
		failed = '';
		try {
			await ceremony();
		} catch (error) {
			failed = error?.message ?? String(error);
		} finally {
			busy = false;
		}
	}

	// the network's devices for avenOS's apps, new with each snapshot of the views
	const cast = $derived(member && at() ? castOf(net.me) : null);
	const stamp = $derived(cast ? at() : null);
	// whether the network is claimed: as the Aven Peer says, or, once the relay keeps this browser out, claimed (after
	// the claim only members get in, MILESTONE2.md)
	const claimed = $derived(net.claimed ?? (net.door === false ? true : null));
</script>

{#if net.storage}
	<main data-view="no-storage">
		<h1>avenOS</h1>
		<p class="card" data-testid="no-storage">
			This browser doesn't allow avenOS to store data for {location.hostname}. In Firefox, check that cookies and site data are allowed for
			this site and that 'Always use private browsing mode' is off, or open {link ? 'the link' : 'avenOS'} in another browser.
		</p>
		<p class="muted" data-testid="no-storage-why">{net.storage}</p>
	</main>
{:else if member && route !== 'claim'}
	{#key stamp}
		<App {cast} device={net.me} {config} />
	{/key}
{:else if link && claimed}
	<Join {config} {link} />
{:else}
	<main data-view={claimed === null ? 'connecting' : !claimed || route === 'claim' ? 'claim' : 'invite-only'}>
		<h1>avenOS</h1>
		{#if claimed === null}
			<p class="muted">Connecting to the network…</p>
			{@render signingIn()}
		{:else if !claimed || route === 'claim'}
			<form onsubmit={(event) => (event.preventDefault(), run(() => claim(config, { name, deliberate: route === 'claim' })))}>
				<h2>Sign up</h2>
				{#if claimed}
					<p class="muted" data-testid="claimed-note">This network is claimed already: the Aven Peer will refuse this signup, and the passkey it makes owns nothing.</p>
				{:else}
					<p class="muted">The first to sign up owns this network's admin coop. Your name, then a passkey on this device.</p>
				{/if}
				<label>
					Your name
					<input data-testid="name" bind:value={name} required maxlength="48" autocomplete="name" placeholder="Ada" />
				</label>
				<button data-testid="claim" disabled={busy || !net.key || !name.trim()}>Sign up with a passkey</button>
			</form>
		{:else}
			{#if net.reset}
				<p class="card" data-testid="reset">This browser's local data was from an older avenOS and was reset. Sign in with your passkey.</p>
			{/if}
			<p class="soon card" data-testid="invite-only">avenOS · invite only, coming soon</p>
			{@render signingIn()}
		{/if}
		{#if why}<p class="refused" data-testid="refused">{why}</p>{/if}
		<p class="status"><Phase phase={live.own?.phase} text={describe(live.own)} testid="status" /></p>
		<Offline />
		{#if net.trouble && live.own?.phase !== 'live'}<p class="refused" data-testid="trouble">{net.trouble}</p>{/if}
	</main>
{/if}

{#snippet signingIn()}
	{#if net.pending}
		<p class="card" data-testid="signed-in-pending">
			Signed in with your passkey. This browser joins your vault as soon as it reaches the network.
		</p>
	{:else}
		<button data-testid="sign-in" disabled={busy || !net.key} onclick={() => run(() => signIn(config))}>
			Sign in with your passkey
		</button>
	{/if}
{/snippet}

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

	.muted,
	.soon {
		margin: 0;
		color: var(--muted);
	}

	.card {
		margin: 0;
	}

	.soon {
		color: var(--text);
		font-family: var(--font-display);
		font-size: 20px;
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
