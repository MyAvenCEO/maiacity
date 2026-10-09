<!--
	avenDB: the user-owned, end-to-end encrypted database (avendb/), with every device of the plan's people in one page
	over a simulated network: the Lab, run as WebAssembly in the browser's workers ($lib/avendb). Pick the device to act
	on: its Vaults, Spaces, Todos and Schemas are what it holds and opens, and an action its own view refuses comes back
	with the rule's reason. The Lab puts every device side by side, with the plan's scenarios to run. An admin's.
-->
<script>
	import { onDestroy, onMount } from 'svelte';
	import { wayBack } from '$lib/app/back.svelte.js';
	import { openWorld, TileError } from '$lib/avendb/tile.js';
	import Approve from '$lib/avendb/Approve.svelte';
	import Browser from '$lib/avendb/Browser.svelte';
	import Entry from '$lib/avendb/Entry.svelte';
	import Lab from '$lib/avendb/Lab.svelte';
	import Schemas from '$lib/avendb/Schemas.svelte';
	import Spaces from '$lib/avendb/Spaces.svelte';
	import Todos from '$lib/avendb/Todos.svelte';
	import Vaults from '$lib/avendb/Vaults.svelte';
	import { count } from '$lib/avendb/ui.js';

	/** @typedef {import('$lib/avendb/tile.js').World} World */
	/** @typedef {'vaults' | 'spaces' | 'entry' | 'todos' | 'schemas' | 'lab' | 'browser'} Screen */

	/** @type {World | null} */
	let world = $state(null);
	/** @type {'starting' | 'making' | 'ready' | 'dead'} */
	let phase = $state('starting');
	let steps = $state(8);
	let step = $state(0);
	let made = $state('');
	let workers = $state(0);
	let pairs = $state({ made: 0, wanted: 0 });
	let tookMs = $state(0);
	let stopped = $state('');
	/** @type {any} */
	let overview = $state(null);
	let device = $state('');
	/** @type {Screen} */
	let screen = $state('spaces');
	/** @type {{ space: string, entry: string } | null} */
	let opened = $state(null);
	/** counts every change to the world: each screen reads its view again */
	let rev = $state(0);
	let busy = $state(false);
	/** @type {{ ok: boolean, text: string } | null} */
	let note = $state(null);
	/** @type {{ title: string, vaults: string[], action: Record<string, unknown>, extra?: string } | null} */
	let asking = $state(null);

	const SCREENS = /** @type {const} */ ([
		['vaults', 'Vaults', 'Who owns what: human vaults with their passkeys and devices, coop vaults, and aven vaults with their servers'],
		['spaces', 'Spaces', 'Where entries live, grouped by the vault that founded them'],
		['todos', 'Todos', 'Every todo this device opens, and those shared with it'],
		['schemas', 'Schemas', "Each space's schemas and lenses, by hash"],
		['lab', 'Lab', 'Every device side by side, the network, and the scenarios'],
		['browser', 'This browser', 'This browser as a device of yours: your passkey, your vault, your notes, linked to your other devices']
	]);

	const devices = $derived(/** @type {any[]} */ (overview?.devices ?? []));
	const me = $derived(devices.find((d) => d.id === device));
	/** the devices by the vault they are devices of: each human vault's, avenCEO's server, then the stranger's, of none */
	const groups = $derived.by(() => {
		/** @type {Map<string, any[]>} */
		const by = new Map();
		for (const d of devices) {
			const key = d.vault ?? '';
			by.set(key, [...(by.get(key) ?? []), d]);
		}
		const vaults = [...by.entries()].filter(([v]) => v);
		return [...vaults, ['', by.get('') ?? []]].filter(([, list]) => list.length);
	});

	onMount(() => {
		// a link another device shows opens this browser's screen, to link it
		if (new URLSearchParams(location.search).has('link')) screen = 'browser';
		start();
	});
	onDestroy(() => world?.close());

	$effect(() => {
		if (screen !== 'entry' || !opened) return;
		return wayBack('Back to the spaces', () => (screen = 'spaces'));
	});

	async function start() {
		world?.close();
		phase = 'starting';
		[step, made, pairs, stopped, tookMs] = [0, '', { made: 0, wanted: 0 }, '', 0];
		const w = openWorld((p) => {
			if (p.step) [step, made] = [p.step.step, p.step.made];
			if (p.pairs) pairs = { ...p.pairs };
		});
		world = w;
		try {
			const s = await w.start();
			[steps, workers, phase] = [s.steps, s.workers, 'making'];
			tookMs = (await w.build()).ms;
			await ready(w);
		} catch (e) {
			fail(e);
		}
	}

	/** Make the world again from the start: in the same workers, whose pairs are made already, unless the tile stopped. */
	async function startOver() {
		if (!world || phase === 'dead') return start();
		[phase, step, made, note, opened, screen] = ['making', 0, '', null, null, 'spaces'];
		try {
			tookMs = (await world.reset()).ms;
			await ready(world);
		} catch (e) {
			fail(e);
		}
	}

	/** @param {World} w */
	async function ready(w) {
		overview = await w.view({ view: 'overview' });
		if (!devices.some((d) => d.id === device)) device = overview.start.device;
		phase = 'ready';
		rev++;
	}

	// a note fades: what was done after five seconds, a refusal after twelve
	$effect(() => {
		if (!note) return;
		const t = setTimeout(() => (note = null), note.ok ? 5000 : 12000);
		return () => clearTimeout(t);
	});

	/** @param {unknown} e */
	function fail(e) {
		const text = e instanceof Error ? e.message : String(e);
		if (e instanceof TileError && e.dead) [phase, stopped] = ['dead', text];
		else note = { ok: false, text };
	}

	/**
	 * Do `a` on the device picked (unless it names its own), then read the world again.
	 * @param {Record<string, unknown>} a
	 * @returns {Promise<any>}
	 */
	async function act(a) {
		if (!world || phase !== 'ready') return null;
		busy = true;
		try {
			const done = await world.act({ on: device, ...a });
			const on = me?.name ?? 'this device';
			if (done.ok) {
				const signed = done.made?.signed;
				// as on the network, the devices online sync at once
				const synced = done.synced ? ` Synced at once: ${count(done.synced, 'op')} to the devices online.` : '';
				note = { ok: true, text: `Done on ${on}${signed?.length ? `, signed by ${list(signed)}` : ''}.${synced}` };
			} else note = { ok: false, text: done.refused ? `Refused on ${on}: ${done.why}` : done.error };
			overview = await world.view({ view: 'overview' });
			rev++;
			return done;
		} catch (e) {
			fail(e);
			return null;
		} finally {
			busy = false;
		}
	}

	/**
	 * A change to a vault: the passkeys that approve for `vaults` sign it first (the Approve card).
	 * @param {string} title @param {string[]} vaults @param {Record<string, unknown>} action @param {string} [extra]
	 */
	const ask = (title, vaults, action, extra) => (asking = { title, vaults, action, extra });

	/** @param {string} space @param {string} entry */
	function open(space, entry) {
		opened = { space, entry };
		screen = 'entry';
	}

	/** @param {string[]} names */
	const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

	/** @param {string} id */
	const pick = (id) => {
		device = id;
		note = null;
	};
</script>

<svelte:head>
	<title>avenDB · maiaCITY</title>
</svelte:head>

<main class="avendb">
	<nav class="rail" aria-label="avenDB">
		<div class="brand">
			<b>avenDB</b>
			<span>the user-owned database · the Lab</span>
			{#if phase === 'ready' && tookMs}<span>its world made in {(tookMs / 1000).toFixed(1)} s</span>{/if}
		</div>

		{#if phase === 'ready'}
			<h2>Acting on</h2>
			{#each groups as [vault, list] (vault)}
				<div class="vault">
					{#if vault}<small>{vault}</small>{:else}<small>No vault</small>{/if}
					{#each list as d (d.id)}
						<button class="device" class:on={d.id === device} onclick={() => pick(d.id)} title={d.locked ? 'Locked' : d.online ? 'Online' : 'Offline'}>
							<i class="dot" class:off={!d.online}></i>
							<span>{d.name}</span>
							{#if d.locked}<em class="lock" aria-label="locked">locked</em>{/if}
							{#if d.forks}<em class="fork">{d.forks} fork{d.forks === 1 ? '' : 's'}</em>{/if}
						</button>
					{/each}
				</div>
			{/each}

			<h2>Screens</h2>
			{#each SCREENS as [id, label] (id)}
				<button class="screen" class:on={screen === id || (id === 'spaces' && screen === 'entry')} onclick={() => (screen = id)}>{label}</button>
				{#if id === 'spaces' && opened}
					<button class="sub" class:on={screen === 'entry'} onclick={() => (screen = 'entry')}>The open entry</button>
				{/if}
			{/each}

			<div class="global">
				<label class="toggle" title="The devices no longer trust the elliptic curves: only the post-quantum halves of every signature and key count">
					<input type="checkbox" checked={!!overview?.pqOnly} disabled={busy} onchange={(e) => act({ do: 'pq_only', value: e.currentTarget.checked })} />
					Post-quantum only
				</label>
				<button class="btn quiet" disabled={busy} onclick={startOver}>Start over</button>
			</div>
		{/if}
	</nav>

	<section class="page">
		{#if phase === 'starting' || phase === 'making'}
			<header class="lead">
				<h1>Making the world</h1>
				<p>
					Samuel, Bob, Carol and Dave with their passkeys and devices, the server, a stranger, and Maia Coop with its spaces: every
					device runs here, each with its own keys and its own copy of what it holds. Each key's Classic McEliece pair takes most
					of a second, so {workers || 'a few'} workers make them side by side.
				</p>
			</header>
			<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={steps} aria-valuenow={step}>
				<div style="width: {(100 * step) / steps}%"></div>
			</div>
			<p class="muted">
				{#if phase === 'starting'}Starting the WebAssembly…{:else}Step {step} of {steps}{made ? `: ${made}` : ''}{/if}
				{#if pairs.wanted}<br />Key pairs: {pairs.made} of {pairs.wanted} made{/if}
			</p>
		{:else if phase === 'dead'}
			<header class="lead">
				<h1>The tile stopped</h1>
				<p>The database hit a bug and can't go on: <code>{stopped}</code></p>
			</header>
			<button class="btn primary" onclick={start}>Start over</button>
		{:else}
			<header class="lead">
				<small>as {me?.name ?? 'no device'}{me && !me.online ? ' · offline' : ''}{me?.locked ? ' · locked' : ''}</small>
				<h1>{screen === 'entry' ? 'Entry' : SCREENS.find(([id]) => id === screen)?.[1]}</h1>
				{#if screen !== 'entry'}<p>{SCREENS.find(([id]) => id === screen)?.[2]}.</p>{/if}
			</header>
			{#if world}
				{#if screen === 'vaults'}
					<Vaults {world} {device} {rev} {act} {ask} signers={overview.signers} />
				{:else if screen === 'spaces'}
					<Spaces {world} {device} {rev} {act} {open} />
				{:else if screen === 'entry' && opened}
					{#key opened.entry}
						<Entry {world} {device} {rev} {act} {ask} {open} space={opened.space} entry={opened.entry} />
					{/key}
				{:else if screen === 'todos'}
					<Todos {world} {device} {rev} {act} {open} />
				{:else if screen === 'schemas'}
					<Schemas {world} {device} {rev} {act} start={overview.start} />
				{:else if screen === 'lab'}
					<Lab {world} {rev} {act} {open} {devices} start={overview.start} />
				{:else if screen === 'browser'}
					<Browser />
				{/if}
			{/if}
		{/if}
	</section>

	{#if note}
		<div class="note" class:bad={!note.ok} role="status">
			<span>{note.text}</span>
			<button aria-label="Dismiss" onclick={() => (note = null)}>×</button>
		</div>
	{/if}

	{#if asking && world}
		<Approve {world} {device} {act} {...asking} onclose={() => (asking = null)} />
	{/if}
</main>

<style>
	.avendb {
		display: grid;
		grid-template-columns: 16.5rem minmax(0, 1fr);
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

	.rail {
		position: sticky;
		top: 0;
		align-self: start;
		max-height: 100vh;
		overflow: auto;
		padding: 1.2rem 0.8rem 6rem;
		border-right: 1px solid var(--edge);
	}

	.brand {
		display: flex;
		flex-direction: column;
		padding: 0.3rem 0.6rem 0.6rem;
	}

	.brand b {
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 400;
		letter-spacing: -0.02em;
	}

	.brand span {
		font-size: 0.75rem;
		color: var(--soft);
	}

	.rail h2 {
		margin: 1rem 0.6rem 0.3rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.vault small {
		display: block;
		margin: 0.4rem 0.6rem 0.1rem;
		font-size: 0.72rem;
		color: var(--soft);
	}

	button {
		font: inherit;
		color: inherit;
		background: none;
		border: 0;
		cursor: pointer;
		text-align: left;
	}

	.device,
	.screen,
	.sub {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		width: 100%;
		padding: 0.3rem 0.6rem;
		border-radius: 8px;
		font-size: 0.88rem;
	}

	.sub {
		padding-left: 1.4rem;
		font-size: 0.8rem;
		color: var(--soft);
	}

	.device.on,
	.screen.on,
	.sub.on {
		background: #fff;
		box-shadow: 0 1px 0 rgb(0 0 0 / 0.06);
		font-weight: 600;
		color: inherit;
	}

	.dot {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ok);
	}

	.dot.off {
		background: #b9b3a6;
	}

	.device em {
		margin-left: auto;
		padding: 0 0.4rem;
		border-radius: 999px;
		font-size: 0.68rem;
		font-style: normal;
		font-weight: 500;
	}

	.lock {
		background: #efe3c8;
	}

	.fork {
		background: #f3d6cc;
	}

	.global {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-top: 1.2rem;
		padding: 0 0.4rem;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.82rem;
	}

	.page {
		min-width: 0;
		padding: 1.6rem clamp(1rem, 3.5vw, 2.6rem) 7rem;
	}

	.lead small {
		color: var(--accent);
		font-size: 0.78rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.lead h1 {
		margin: 0.3rem 0 0.5rem;
		font-size: clamp(1.6rem, 3vw, 2.2rem);
		line-height: 1.15;
	}

	.lead p {
		max-width: 72ch;
		margin: 0 0 1.2rem;
		line-height: 1.55;
		color: var(--soft);
	}

	.progress {
		max-width: 36rem;
		height: 0.6rem;
		margin: 1rem 0 0.6rem;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.08);
		overflow: hidden;
	}

	.progress div {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s ease;
	}

	.muted {
		color: var(--soft);
		font-size: 0.9rem;
	}

	.note {
		position: fixed;
		left: 50%;
		bottom: calc(var(--nav-room) + 0.8rem);
		z-index: 20;
		display: flex;
		gap: 0.8rem;
		align-items: center;
		max-width: min(46rem, calc(100vw - 2rem));
		padding: 0.6rem 0.6rem 0.6rem 1rem;
		border-radius: 12px;
		background: #23302a;
		color: #eef0e8;
		font-size: 0.9rem;
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
		transform: translateX(-50%);
	}

	.note.bad {
		background: #6b2c1c;
	}

	.note button {
		padding: 0 0.4rem;
		font-size: 1.2rem;
		line-height: 1;
		color: inherit;
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

	.avendb :global(.tabs) {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0.2rem 0 1.1rem;
	}

	.avendb :global(.tabs button) {
		padding: 0.32rem 0.8rem;
		border: 1px solid rgb(0 0 0 / 0.12);
		border-radius: 999px;
		background: rgb(255 255 255 / 0.5);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.avendb :global(.tabs button.on) {
		border-color: var(--accent);
		background: #fff;
		color: var(--accent);
		font-weight: 600;
	}

	.avendb :global(pre.json) {
		max-height: 30rem;
		overflow: auto;
		margin: 0;
		padding: 0.8rem 1rem;
		border-radius: 10px;
		background: #23302a;
		color: #eef0e8;
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.avendb :global(.diff) {
		max-height: 30rem;
		overflow: auto;
		margin: 0;
		padding: 0.6rem 0;
		border-radius: 10px;
		background: #fff;
		border: 1px solid var(--edge);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.76rem;
		line-height: 1.5;
	}

	.avendb :global(.diff div) {
		padding: 0 0.8rem;
		white-space: pre-wrap;
	}

	.avendb :global(.diff .add) {
		background: #e3f1df;
	}

	.avendb :global(.diff .del) {
		background: #f7e1da;
		text-decoration: line-through;
		text-decoration-color: rgb(0 0 0 / 0.25);
	}

	.avendb :global(h2.part) {
		margin: 1.6rem 0 0.6rem;
		font-size: 1.15rem;
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

	@media (max-width: 820px) {
		.avendb {
			grid-template-columns: 1fr;
		}

		.rail {
			position: static;
			max-height: none;
			padding-bottom: 1rem;
			border-right: 0;
			border-bottom: 1px solid var(--edge);
		}
	}
</style>
