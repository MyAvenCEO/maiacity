<script>
	// avenOS, the shell: a dashboard of apps, and the account switcher, which picks the person you act as. An address
	// names both, and what the app shows: #/<vault>/<app>/<target>. An address naming anyone you may not act as, Aven
	// included, lands on your own dashboard. The host decides whom you may act as: a Peer-Light's origin from the cast is
	// that device, localhost is the box's own view, which holds every test key, and any other host is a visitor.
	import Avatar from './Avatar.svelte';
	import Dashboard from './Dashboard.svelte';
	import Chat from './apps/Chat.svelte';
	import ControlRoom from './apps/ControlRoom.svelte';
	import Invite from './apps/Invite.svelte';
	import Vault from './apps/Vault.svelte';
	import { ownerName, owners, ready, tree, vaultName } from './id.svelte.js';
	import { mayInvite } from './invites.js';

	// `config`: the host's network (network.svelte.js), on an Aven Peer's host without a cast
	let { cast, device, config = null } = $props();

	// whom this host may act as, as its Peer-Light's views say; a visitor's host has none and may act as no one
	const viewed = $derived(Boolean(device) || location.hostname === 'localhost');
	const mine = $derived(viewed ? tree.accounts() : []);
	// Invite is for the admin coop's people only: a person whose passkey governs the coop that owns Aven
	const apps = $derived([
		{ id: 'vault', name: 'Vault', what: 'Who owns it and all it governs', component: Vault },
		{ id: 'control-room', name: 'Control Room', what: 'Every peer it governs, side by side', component: ControlRoom },
		{ id: 'chat', name: 'Chat', what: "The network's room, live", component: Chat },
		...(mayInvite(account, config?.network) ? [{ id: 'invite', name: 'Invite', what: 'Let someone into the network', component: Invite }] : []),
	]);

	const read = () => location.hash.replace(/^#\/?/, '').split('/');
	let route = $state(read());
	$effect(() => {
		const follow = () => (route = read());
		addEventListener('hashchange', follow);
		return () => removeEventListener('hashchange', follow);
	});

	const named = $derived(mine.includes(route[0]));
	const account = $derived(named ? route[0] : mine[0]);
	const open = $derived(named && apps.find((app) => app.id === route[1]));
	const where = $derived(device ? `on ${cast.peers[device].name}` : account ? 'avenSANDBOX' : '');

	let menu = $state();
	const describe = (id) =>
		`${tree.kind(id)} · owned by ${owners(id)
			.map((owner) => ownerName(owner))
			.join(', ')}`;
</script>

<header>
	<nav>
		<a class="home" href={account ? `#/${account}` : '#/'}>avenOS</a>
		{#if open}<span class="crumb">/ {open.name}</span>{/if}
	</nav>
	<div class="me">
		{#if where}<span class="where" data-testid="where">{where}</span>{/if}
		{#if account}
			<button class="pill" popovertarget="accounts" data-testid="account" aria-label="Switch vault">
				<Avatar id={account} size={22} />
				<span class="name">{vaultName(account)}</span>
				<svg class="icon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
			</button>
			<div id="accounts" popover bind:this={menu}>
				<p class="hint">
					{device ? `${cast.peers[device].name} can act as` : 'The box holds every test key. Act as'}
				</p>
				{#each mine as id (id)}
					<a
						href={`#/${id}${open ? `/${open.id}` : ''}`}
						data-account={id}
						aria-current={id === account ? 'true' : undefined}
						onclick={() => menu.hidePopover()}
					>
						<Avatar {id} size={28} />
						<span><strong>{vaultName(id)}</strong><small>{describe(id)}</small></span>
						{#if id === account}<svg class="tick icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</header>

{#if viewed && !ready()}
	<main data-view="starting"><p class="hint">Starting this device's Peer-Light…</p></main>
{:else if open}
	{@const App = open.component}
	<App {cast} {account} {device} {config} target={route[2]} />
{:else}
	<Dashboard {cast} {device} {account} {apps} />
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 64px;
		padding: 10px 16px;
		background: var(--bg);
		border-bottom: 1px solid var(--line);
	}

	nav,
	.me {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.home {
		color: var(--accent);
		font-family: var(--font-display);
		font-size: 21px;
		font-weight: 500;
		letter-spacing: -0.01em;
		text-decoration: none;
	}

	.crumb,
	.where,
	.hint,
	small {
		color: var(--muted);
		font-size: 13px;
	}

	.crumb {
		font-size: 15px;
		white-space: nowrap;
	}

	.where {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding: 4px 12px 4px 4px;
		color: var(--text);
		font-size: 14px;
		font-weight: 400;
		background: var(--surface);
		border: 1px solid var(--line);
		box-shadow: var(--shadow-soft);
	}

	.pill:hover:not(:disabled) {
		background: var(--raised);
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}


	[popover] {
		inset: 60px 16px auto auto;
		width: min(340px, calc(100vw - 32px));
		margin: 0;
		padding: 8px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-lift);
	}

	.hint {
		margin: 4px 8px 6px;
	}

	[popover] a {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px;
		color: inherit;
		text-decoration: none;
		border-radius: var(--radius-inner);
	}

	[popover] a:hover {
		background: var(--sage);
	}

	[popover] a[aria-current] {
		background: var(--accent-soft);
	}

	[popover] a > span:not(.tick) {
		display: grid;
		flex: 1;
		min-width: 0;
	}

	[data-view='starting'] {
		padding: 64px 16px;
		text-align: center;
	}

	.tick {
		color: var(--accent);
		stroke-width: 2;
	}
</style>
