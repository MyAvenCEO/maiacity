<script>
	// avenOS on an Aven Peer's host without a cast (PRODUCTION.md, "What a person sees"). Unclaimed, one screen: Sign
	// up, which asks for the person's name, then makes a passkey (Part C); the first signup claims the network. Claimed, this browser opens avenOS's dashboard as the admin's
	// vault once it is one of the network's devices; any other browser sees "invite only, coming soon", and the admin
	// signs in there with the passkey, which makes it a device too. `#/claim` shows the signup screen whatever the
	// network says: a second signup is the Aven Peer's to refuse, and it does.
	import App from './App.svelte';
	import Join from './Join.svelte';
	import Phase from './Phase.svelte';
	import { useTree } from './id.js';
	import { readLink } from './invites.js';
	import { castOf, claim, net, signIn } from './network.svelte.js';
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

	const member = $derived(Boolean(net.tree && net.me && JSON.parse(net.tree).vaults[net.me]));
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

	// the network's tree for avenOS's apps, swapped in before they read it: a prop is read only when used
	const cast = $derived.by(() => {
		if (!member) return null;
		const cast = castOf(net.tree, net.me);
		useTree(JSON.stringify(cast));
		return cast;
	});
	// whether the network is claimed: as the Aven Peer says, or, once the relay keeps this browser out, claimed (after
	// the claim only members get in, MILESTONE2.md)
	const claimed = $derived(net.claimed ?? (net.door === false ? true : null));
</script>

{#if member && route !== 'claim'}
	{#key cast}
		<App {cast} device={net.me} {config} />
	{/key}
{:else if link && claimed}
	<Join {config} {link} />
{:else}
	<main data-view={claimed === null ? 'connecting' : !claimed || route === 'claim' ? 'claim' : 'invite-only'}>
		<h1>avenOS</h1>
		{#if claimed === null}
			<p class="muted">Connecting to the network…</p>
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
			<p class="soon" data-testid="invite-only">avenOS · invite only, coming soon</p>
			<button data-testid="sign-in" disabled={busy || !net.key} onclick={() => run(() => signIn(config))}>
				Sign in with your passkey
			</button>
		{/if}
		{#if why}<p class="refused" data-testid="refused">{why}</p>{/if}
		<p class="status"><Phase phase={live.own?.phase} text={describe(live.own)} testid="status" /></p>
		{#if net.trouble && live.own?.phase !== 'live'}<p class="refused" data-testid="trouble">{net.trouble}</p>{/if}
	</main>
{/if}

<style>
	main {
		display: grid;
		gap: 16px;
		max-width: 420px;
		margin: 12vh auto 0;
		padding: 0 16px;
	}

	h1 {
		margin: 0;
		font-size: 22px;
	}

	h2 {
		margin: 0;
		font-size: 18px;
	}

	form {
		display: grid;
		gap: 12px;
		padding: 16px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
	}

	label {
		display: grid;
		gap: 6px;
		color: var(--muted);
	}

	input {
		padding: 8px 10px;
		color: var(--text);
		font: inherit;
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 8px;
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

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.muted,
	.soon {
		margin: 0;
		color: var(--muted);
	}

	.refused {
		margin: 0;
		color: var(--pending);
	}
</style>
