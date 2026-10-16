<!--
	The app's one way round, a pill floating at the foot of every page of the app, the full-screen worlds and sandboxes
	too, on a phone and a desktop alike: back ($lib/app/back.svelte.js: out of what a page has open over itself, else up
	a place), home to the dashboard, and you (who is signed in, your name, the public site, signing out). No page has a
	bar or a back button of its own, and everything else — the games, the worlds, the admin's tools — is a tile on the
	dashboard. A page may add a green "+" between Home and You that opens its main sheet, and the accounts it can be
	looked at as, listed in the You menu ($lib/app/pill.svelte.js: MaiaCity V1's wallet and its COOPs), and a context of
	its own beside You, with a menu of its own (avenDB's vaults), kept apart from the account signed in.

	Where it floats and the room it takes are said once, in src/app.css (--nav-foot, --nav-height, --nav-room): full-screen
	pages keep what they show at their foot above it with --nav-room.
-->
<script>
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { back, upFrom } from './back.svelte.js';
	import { pill } from './pill.svelte.js';

	/** @type {{ founder: import('$lib/auth/client').Founder, onsignout: () => void }} */
	let { founder, onsignout } = $props();

	const home = `${base}/app/`;
	let open = $state(false);
	/** whether the page's context menu (avenDB's vaults) is open, apart from the You menu */
	let ctx = $state(false);
	const here = $derived(pill.context ? (pill.context.list.find((a) => a.id === pill.context?.current) ?? null) : null);
	const path = $derived(page.url.pathname);
	const up = $derived(upFrom(path.slice(base.length)));
	const initials = $derived(founder.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase());
	// looking at another account than one's own (a COOP's wallet): the avatar and the word say whose
	const acting = $derived(pill.accounts ? pill.accounts.list.find((a) => a.id === pill.accounts?.current && a !== pill.accounts.list[0]) : null);
	$effect(() => {
		void path;
		open = false;
		ctx = false;
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && ((open = false), (ctx = false))} />

<nav class="pill" aria-label="App">
	{#if back.open}
		<button class="item" onclick={() => back.open?.go()} title={back.open.label} aria-label={back.open.label}>
			<Icon name="back" /><span>Back</span>
		</button>
	{:else if up}
		<a class="item" href={up.href} title={up.label} aria-label={up.label}><Icon name="back" /><span>Back</span></a>
	{/if}
	<a class="item" href={home} aria-current={path === home ? 'page' : undefined} title="Dashboard">
		<Icon name="home" /><span>Home</span>
	</a>
	{#if pill.center}
		<button class="item plus" class:on={pill.center.on} onclick={() => pill.center?.go()} title={pill.center.label} aria-label={pill.center.label} aria-expanded={pill.center.on}>
			<span class="ring"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span><span>{pill.center.label}</span>
		</button>
	{/if}
	<button class="item" class:on={open} onclick={() => ((open = !open), (ctx = false))} aria-expanded={open} aria-haspopup="true" title={acting ? `${founder.name}, as ${acting.label}` : founder.name}>
		{#if acting}<span class="avatar {acting.shape ?? 'human'}" style="background:{acting.colour}; color:#fff">{acting.text}</span><span>{acting.label.replace(/ COOP$/, '')}</span>
		{:else}<span class="avatar">{initials}</span><span>You</span>{/if}
	</button>
	{#if pill.context && here}
		<button class="item" class:on={ctx} onclick={() => ((ctx = !ctx), (open = false))} aria-expanded={ctx} aria-haspopup="true" title="{pill.context.title}: {here.label}">
			<span class="avatar {here.shape ?? 'human'}" style="background:{here.colour}; color:#fff">{here.text}</span><span class="ctx-name">{here.label}</span>
		</button>
	{/if}
	{#if ctx && pill.context}
		<div class="account" role="menu">
			<p class="group">{pill.context.title}</p>
			{#each pill.context.list as a (a.id)}
				<button role="menuitemradio" class="acct" aria-checked={a.id === pill.context.current} onclick={() => (pill.context?.pick(a.id), (ctx = false))}>
					<span class="avatar {a.shape ?? 'human'}" style="background:{a.colour}; color:#fff">{a.text}</span>
					<span class="acct-name">{a.label}{#if a.sub}<small>{a.sub}</small>{/if}</span>
					{#if a.id === pill.context.current}<span class="tick" aria-hidden="true">✓</span>{/if}
				</button>
			{/each}
			{#if pill.context.add}
				<hr />
				<button role="menuitem" onclick={() => (pill.context?.add?.go(), (ctx = false))}>{pill.context.add.label}</button>
			{/if}
		</div>
	{/if}
	{#if open}
		<div class="account" role="menu">
			<p class="who"><b>{founder.name}</b><span>Founder {String(founder.number).padStart(3, '0')}</span></p>
			{#if pill.accounts}
				<p class="group">{pill.accounts.title}</p>
				{#each pill.accounts.list as a (a.id)}
					<button role="menuitemradio" class="acct" aria-checked={a.id === pill.accounts.current} onclick={() => (pill.accounts?.pick(a.id), (open = false))}>
						<span class="avatar {a.shape ?? 'human'}" style="background:{a.colour}; color:#fff">{a.text}</span>
						<span class="acct-name">{a.label}{#if a.sub}<small>{a.sub}</small>{/if}</span>
						{#if a.id === pill.accounts.current}<span class="tick" aria-hidden="true">✓</span>{/if}
					</button>
				{/each}
				<hr />
			{/if}
			<a role="menuitem" href="{base}/join/">Your name</a>
			{#if founder.caps?.includes('media:admin')}<a role="menuitem" href="{base}/join/#terminal">Sign a terminal in</a>{/if}
			<a role="menuitem" href="{base}/">The public site</a>
			<button role="menuitem" class="out" onclick={onsignout}>Sign out</button>
		</div>
	{/if}
</nav>

<style>
	/* centred, as wide as its items, never wider than the screen (clear of its edges and the notch), at --nav-foot */
	.pill {
		position: fixed;
		bottom: var(--nav-foot);
		left: max(8px, env(safe-area-inset-left, 0px));
		right: max(8px, env(safe-area-inset-right, 0px));
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 2px;
		width: max-content;
		max-width: calc(100% - max(8px, env(safe-area-inset-left, 0px)) - max(8px, env(safe-area-inset-right, 0px)));
		margin: 0 auto;
		padding: 5px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: rgb(250 248 242 / 0.94);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
		backdrop-filter: blur(10px);
	}

	.item {
		display: flex;
		flex: 0 1 auto;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		min-width: 3.4rem;
		padding: 0.35rem 0.6rem 0.3rem;
		border: 0;
		border-radius: 999px;
		background: none;
		color: var(--ink-soft);
		font: inherit;
		font-size: 0.66rem;
		letter-spacing: 0.04em;
		text-decoration: none;
		cursor: pointer;
	}

	.item:hover {
		color: var(--ink);
		background: rgb(38 56 44 / 0.06);
	}

	.item[aria-current='page'],
	.item.on {
		color: var(--paper);
		background: var(--ink);
	}

	/* the page's "+": a round, brand green button in the middle of the pill */
	.plus .ring {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--brand-green);
		color: #fff;
		box-shadow: 0 2px 8px rgb(36 69 47 / 0.35);
	}
	.plus.on {
		color: var(--ink);
		background: rgb(36 69 47 / 0.1);
	}
	.plus.on .ring {
		transform: rotate(45deg);
	}
	.plus .ring {
		transition: transform 160ms ease;
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--mustard);
		color: var(--ink);
		font-size: 0.66rem;
		font-weight: 700;
	}

	.account {
		position: absolute;
		right: 0;
		bottom: calc(100% + 10px);
		display: flex;
		flex-direction: column;
		min-width: 13rem;
		max-height: calc(100dvh - var(--nav-room) - 8px);
		overflow-y: auto;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
	}

	.avatar.coop {
		border-radius: 7px;
	}

	/* the context's name under its mark, cut to the item's width */
	.ctx-name {
		max-width: 4.5rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.avatar.aven {
		border-radius: 4px;
		font-size: 0.5rem;
	}

	.group {
		margin: 0.2rem 0.6rem 0.2rem;
		font-size: 0.66rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.account .acct {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.acct-name {
		display: flex;
		flex: 1;
		flex-direction: column;
		line-height: 1.25;
	}
	.acct-name small {
		font-size: 0.72rem;
		color: var(--muted);
	}
	.tick {
		color: var(--brand-green);
		font-weight: 700;
	}
	.account hr {
		width: 100%;
		margin: 0.3rem 0;
		border: 0;
		border-top: 1px solid var(--line);
	}

	.who {
		display: flex;
		flex-direction: column;
		margin: 0 0 0.3rem;
		padding: 0.4rem 0.6rem 0.5rem;
		border-bottom: 1px solid var(--line);
		line-height: 1.3;
	}

	.who span {
		font-size: 0.78rem;
		color: var(--muted);
	}

	.account a,
	.account button {
		padding: 0.45rem 0.6rem;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--ink);
		font: inherit;
		font-size: 0.9rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}

	.account a:hover,
	.account button:hover {
		background: rgb(38 56 44 / 0.06);
	}

	.out {
		color: var(--terracotta) !important;
	}

	/* a phone, upright or on its side, and a narrow window: icons only, each as wide as a finger, the pill 52px tall
	   (--nav-height, src/app.css) */
	@media (max-width: 760px), (max-height: 500px) {
		.pill {
			gap: 0;
			padding: 4px;
		}
		.item span:not(.avatar, .ring) {
			display: none;
		}
		.item {
			width: 2.8rem;
			min-width: 0;
			padding: 0.55rem 0;
		}
		.item.plus {
			padding: 0.2rem 0;
		}
		.plus .ring {
			width: 36px;
			height: 36px;
		}
	}
</style>
