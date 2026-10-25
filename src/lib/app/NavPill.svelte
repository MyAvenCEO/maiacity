<!--
	The app's one way round, a pill floating at the foot of every page of the app, the full-screen worlds and sandboxes
	too, on a phone and a desktop alike: back ($lib/app/back.svelte.js: out of what a page has open over itself, else up
	a place), home to the dashboard, and you (who is signed in, your name, the public site, signing out). No page has a
	bar or a back button of its own, and everything else — the games, the worlds, the admin's tools — is a tile on the
	dashboard. You is the person's vault switcher too (Samuel 2026-10-18): their avenDB vaults, their own first, which
	is their profile (their name lives there alone), and the one picked shown on the item, with how many changes wait
	in the others; then the public site and signing out. Invites live in avenDB's Vaults app alone ($lib/avendb/Vaults.svelte,
	Samuel 2026-10-20), beside the roles they give. A page may add a
	green "+" between Home and You that opens its main sheet, and the accounts it can be looked at as, listed in the You
	menu ($lib/app/pill.svelte.js: MaiaCity V1's wallet and its COOPs).

	Where it floats and the room it takes are said once, in src/app.css (--nav-foot, --nav-height, --nav-room): full-screen
	pages keep what they show at their foot above it with --nav-room.
-->
<script>
	import { foot, FOOT } from './foot.js';
	import { tick } from 'svelte';
	import { localMedia } from '$lib/avendb/local-media.svelte.js';
	import { base } from '$app/paths';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import { back, onDashboard, upFrom } from './back.svelte.js';
	import { pill } from './pill.svelte.js';
	import { shaped } from './shapes.js';

	/** @type {{ founder: import('$lib/auth/client').Founder | null, name?: string, onsignout?: () => void }} the person's
	 *  name from their avenDB human vault's profile, '' until avenDB shows it; no "Sign out" without `onsignout`, as in
	 *  theOS, whose avenDB runs while the app does */
	let { founder, name = '', onsignout } = $props();

	const home = `${base}/app/`;
	let open = $state(false);
	const menuId = $props.id();
	/** @type {HTMLButtonElement | undefined} */
	let trigger = $state();
	/** @type {HTMLDivElement | undefined} */
	let menu = $state();
	/** the vault picked, as the You item shows it: the person's own until they pick another */
	const here = $derived(pill.context ? (pill.context.list.find((a) => a.id === pill.context?.current) ?? null) : null);
	/** what waits in the context's other entries (avenDB: the changes waiting for each other vault's yes) */
	const elsewhere = $derived(
		pill.context?.list.reduce((n, a) => n + (a.id === pill.context?.current ? 0 : (a.badge ?? 0)), 0) ?? 0
	);
	const path = $derived(page.url.pathname);
	// the dashboard's address names avenDB's view on it in its hash (`/app/#sparks`), which a link sets with no
	// navigation of the router's: read after each of either
	let hash = $state(typeof location === 'undefined' ? '' : location.hash);
	afterNavigate(() => (hash = location.hash));
	const up = $derived(upFrom(path.slice(base.length), hash));
	/** on the dashboard itself, not on one of avenDB's views on it */
	const atHome = $derived(path === home && onDashboard(hash));
	const initials = $derived(name ? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '·');
	const who = $derived(name || 'You');
	// looking at another account than one's own (a COOP's wallet): the avatar and accessible name say whose
	const acting = $derived(pill.accounts ? pill.accounts.list.find((a) => a.id === pill.accounts?.current && a !== pill.accounts.list[0]) : null);
	const identityLabel = $derived(acting ? `${who}, as ${acting.label}` : here ? `${who}: ${here.label}` : who);

	function close(restoreFocus = false) {
		open = false;
		if (restoreFocus) trigger?.focus();
	}

	/** @param {Event} event */
	function outside(event) {
		if (!open) return;
		const path = event.composedPath();
		if ((!trigger || !path.includes(trigger)) && (!menu || !path.includes(menu))) close();
	}

	/** @param {MouseEvent} event */
	async function toggle(event) {
		open = !open;
		if (open && event.detail === 0) {
			await tick();
			if (!open) return;
			const first = /** @type {HTMLElement | null | undefined} */ (menu?.querySelector('button, a'));
			first?.focus();
		}
	}

	$effect(() => {
		void path;
		open = false;
	});

	$effect(() => {
		if (!open) return;
		// Capture also sees clicks on world controls that stop pointer events from bubbling.
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('focusin', outside, true);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('focusin', outside, true);
		};
	});
</script>

<svelte:window
	onkeydown={(e) => { if (open && e.key === 'Escape') { e.preventDefault(); close(true); } }}
	onhashchange={() => (hash = location.hash)}
/>

<nav class="pill" aria-label="App">
	{#if back.open}
		<button class="item" onclick={() => back.open?.go()} title={back.open.label} aria-label={back.open.label}>
			<Icon name="back" /><span>Back</span>
		</button>
	{:else if up}
		<a class="item" href={up.href} title={up.label} aria-label={up.label}><Icon name="back" /><span>Back</span></a>
	{/if}
	<a class="item" href={home} aria-current={atHome ? 'page' : undefined} title="Dashboard">
		<Icon name="home" /><span>Home</span>
	</a>
	{#if pill.center}
		<button class="item plus" class:on={pill.center.on} onclick={() => pill.center?.go()} title={pill.center.label} aria-label={pill.center.label} aria-expanded={pill.center.on}>
			<span class="ring"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></span><span>{pill.center.label}</span>
		</button>
	{/if}
	<button bind:this={trigger} class="item identity" class:on={open} onclick={toggle} aria-expanded={open} aria-haspopup="menu" aria-controls={menuId} aria-label={identityLabel + (elsewhere ? `, ${elsewhere} waiting in your other vaults` : '')} title={identityLabel}>
		{#if acting}<span class="avatar {acting.shape ?? 'human'}" aria-hidden="true" style="background:{acting.colour}; color:#fff; {shaped(acting.shape)}">{#if localMedia(acting.id, 'profile.jpg')}<img src={localMedia(acting.id, 'profile.jpg')} alt="" />{:else}{acting.text}{/if}</span>
		{:else if here}<span class="avatar {here.shape ?? 'human'}" aria-hidden="true" style="background:{here.colour}; color:#fff; {shaped(here.shape)}">{#if localMedia(here.id, 'profile.jpg')}<img src={localMedia(here.id, 'profile.jpg')} alt="" />{:else}{here.text}{/if}</span>
		{:else}<span class="avatar" aria-hidden="true">{initials}</span>{/if}
		{#if elsewhere}<span class="bubble" title="{elsewhere} waiting in your other vaults">{elsewhere}</span>{/if}
	</button>
	{#if open}
		<div bind:this={menu} id={menuId} class="account" use:foot={FOOT.menu} role="menu" aria-label="Profiles and accounts">
			<p class="who"><b>{who}</b>{#if founder}<span>Founder {String(founder.number).padStart(3, '0')}</span>{/if}</p>
			{#if pill.context}
				<p class="group">{pill.context.title}</p>
				{#each pill.context.list as a (a.id)}
					<button role="menuitemradio" class="acct" aria-checked={a.id === pill.context.current} onclick={() => (pill.context?.pick(a.id), close(true))}>
						<span class="avatar {a.shape ?? 'human'}" style="background:{a.colour}; color:#fff; {shaped(a.shape)}">{#if localMedia(a.id, 'profile.jpg')}<img src={localMedia(a.id, 'profile.jpg')} alt="" />{:else}{a.text}{/if}</span>
						<span class="acct-name">{a.label}{#if a.sub}<small>{a.sub}</small>{/if}</span>
						{#if a.badge}<span class="bubble" title="{a.badge} waiting">{a.badge}</span>{/if}
						{#if a.id === pill.context.current}<span class="tick" aria-hidden="true">✓</span>{/if}
					</button>
				{/each}
				{#if pill.context.add}
					<button role="menuitem" onclick={() => (pill.context?.add?.go(), (open = false))}>{pill.context.add.label}</button>
				{/if}
				<hr />
			{/if}
			{#if pill.accounts}
				<p class="group">{pill.accounts.title}</p>
				{#each pill.accounts.list as a (a.id)}
					<button role="menuitemradio" class="acct" aria-checked={a.id === pill.accounts.current} onclick={() => (pill.accounts?.pick(a.id), close(true))}>
						<span class="avatar {a.shape ?? 'human'}" style="background:{a.colour}; color:#fff; {shaped(a.shape)}">{#if localMedia(a.id, 'profile.jpg')}<img src={localMedia(a.id, 'profile.jpg')} alt="" />{:else}{a.text}{/if}</span>
						<span class="acct-name">{a.label}{#if a.sub}<small>{a.sub}</small>{/if}</span>
					{#if a.badge}<span class="bubble" title="{a.badge} waiting">{a.badge}</span>{/if}
						{#if a.id === pill.accounts.current}<span class="tick" aria-hidden="true">✓</span>{/if}
					</button>
				{/each}
				<hr />
			{/if}
			<a role="menuitem" href="{base}/">The public site</a>
			{#if onsignout}<button role="menuitem" class="out" onclick={onsignout}>Sign out</button>{/if}
		</div>
	{/if}
</nav>

<style>
	.avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
	/* centred, as wide as its items, never wider than the screen (clear of its edges and the notch), at --nav-foot */
	.pill {
		position: relative;
		flex-shrink: 0;
		pointer-events: auto;
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
		position: relative;
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
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 13rem;
		max-height: 50dvh;
		overflow-y: auto;
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: 16px;
		background: var(--paper);
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
	}

	/* how many wait in an entry of a menu, or in the context's other entries */
	.bubble {
		display: inline-grid;
		place-items: center;
		min-width: 1.1rem;
		height: 1.1rem;
		padding: 0 0.3rem;
		box-sizing: border-box;
		border-radius: 999px;
		background: #c2412d;
		color: #fff;
		font-size: 0.68rem;
		font-weight: 650;
		line-height: 1;
	}

	.item .bubble {
		position: absolute;
		top: 0.15rem;
		right: 0.35rem;
	}
	.avatar.aven,
	.avatar.device {
		font-size: 0.5rem;
	}

	/* The dock shows the current identity as a larger mark; names stay in its menu and accessible label. */
	.item.identity {
		padding: 0.1875rem 0.25rem;
	}
	.identity .avatar {
		width: 36px;
		height: 36px;
		font-size: 0.85rem;
	}
	.identity .avatar.aven,
	.identity .avatar.device {
		font-size: 0.7rem;
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
