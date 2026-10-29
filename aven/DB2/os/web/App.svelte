<script>
	// avenOS, the shell: a dashboard of apps, and the account switcher, which picks the person you act as. An address
	// names both, and what the app shows: #/<vault>/<app>/<target>. An address naming anyone you may not act as, Aven
	// included, lands on your own dashboard. The host decides whom you may act as: a Peer-Light's origin from the cast is
	// that device, localhost is the box's own view, which holds every test key, and any other host is a visitor.
	import Avatar from './Avatar.svelte';
	import Dashboard from './Dashboard.svelte';
	import ControlRoom from './apps/ControlRoom.svelte';
	import Vault from './apps/Vault.svelte';
	import { accounts, ownerName, owners, vaultName } from './cast.js';

	let { cast, device } = $props();

	const mine = $derived(device ? accounts(cast, device) : location.hostname === 'localhost' ? accounts(cast) : []);
	const apps = [
		{ id: 'vault', name: 'Vault', what: 'Who owns it and all it governs', component: Vault },
		{ id: 'control-room', name: 'Control Room', what: 'Every peer it governs, side by side', component: ControlRoom },
	];

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
		`${cast.vaults[id].kind} · owned by ${owners(cast, id)
			.map((owner) => ownerName(cast, owner))
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
				<Avatar {cast} id={account} size={22} />
				<span class="name">{vaultName(cast, account)}</span>
				<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
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
						<Avatar {cast} {id} size={28} />
						<span><strong>{vaultName(cast, id)}</strong><small>{describe(id)}</small></span>
						{#if id === account}<span class="tick" aria-hidden="true">✓</span>{/if}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</header>

{#if open}
	{@const App = open.component}
	<App {cast} {account} {device} target={route[2]} />
{:else}
	<Dashboard {cast} {device} {account} {apps} />
{/if}

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 56px;
		padding: 8px 16px;
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
		color: var(--text);
		font-size: 18px;
		font-weight: 600;
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
		padding: 4px 10px 4px 4px;
		color: var(--text);
		font: inherit;
		font-size: 14px;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 999px;
		cursor: pointer;
	}

	.pill:hover {
		border-color: var(--muted);
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.6;
	}

	[popover] {
		inset: 60px 16px auto auto;
		width: min(320px, calc(100vw - 32px));
		margin: 0;
		padding: 6px;
		color: var(--text);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
	}

	.hint {
		margin: 4px 8px 6px;
	}

	[popover] a {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
		color: inherit;
		text-decoration: none;
		border-radius: 8px;
	}

	[popover] a:hover,
	[popover] a[aria-current] {
		background: var(--bg);
	}

	[popover] a > span:not(.tick) {
		display: grid;
		flex: 1;
		min-width: 0;
	}

	.tick {
		color: var(--live);
	}
</style>
