<!--
	A vault's settings, as its aside lists them: About (what it is, who approves a change to it, how this browser acts
	for it), Owners and devices (who owns it, what it owns, the devices that act for it, and for the person's own vault
	this browser's name, linking the next device and forgetting this one), Access (every cap in force over it, each a
	named group of ops on a slice of it, clustered by its group: the group's name and ops as chips, then who holds it on
	what, what it reaches now and who may revoke it; sharing a slice of it as the acting vault; and the caps it holds in
	other vaults), and Sync (its cells, the entries the same caps reach under one key,
	each with the devices that receive its edits and whether each opens them or only relays their ciphertext). All of it
	is the device's world (avendb-browser's `World`); sharing and revoking go out acting for the acting vault, and the
	rules check them against its caps.
-->
<script>
	import { native } from '$lib/native';
	import Mark from './Mark.svelte';
	import Ops from './Ops.svelte';
	import Share from './Share.svelte';
	import {
		capName,
		cellWords,
		count,
		EVERYONE,
		granteeOf,
		KIND_HINTS,
		KINDS,
		list,
		nameOf,
		reads,
		short,
		shares,
		STRONGEST,
		titleOf,
		whereWords
	} from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   tab: 'about' | 'members' | 'access' | 'sync', thisName: string, link: string, qr: string,
	 *   sockets?: string[] | null }}
	 */
	let { world, vault, actor, api, busy, tab, thisName, link, qr, sockets = null } = $props();

	/** This device, as the person sees it: in the Mac app, the Mac. */
	const [here, Here] = native() ? ['this Mac', 'This Mac'] : ['this browser', 'This browser'];

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const v = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(vault)));
	const as = $derived(byId.get(actor));
	const owned = $derived(world.vaults.filter((x) => x.owners.some((o) => 'vault' in o && o.vault === vault)));
	/**
	 * the caps in force over the vault by their group, a name and its ops, the strongest first (a cap whose slice this
	 * device doesn't read alone in its own); and those it holds in other vaults
	 */
	const groups = $derived.by(() => {
		/**
		 * @type {Map<string, { name: string, ops: import('./vaults.js').Op[] | null, role: string,
		 *   caps: typeof world.caps }>}
		 */
		const by = new Map();
		for (const c of world.caps.filter((c) => c.over === vault)) {
			const key = c.slice ? JSON.stringify([c.slice.name, c.slice.ops]) : c.id;
			const g = by.get(key);
			if (g) g.caps.push(c);
			else by.set(key, { name: capName(c), ops: c.slice?.ops ?? null, role: c.role, caps: [c] });
		}
		const rank = (/** @type {{ role: string }} */ g) => STRONGEST.indexOf(/** @type {any} */ (g.role));
		return [...by].sort(([, a], [, b]) => rank(a) - rank(b) || a.name.localeCompare(b.name));
	});
	const held = $derived(world.caps.filter((c) => c.grantee === vault && c.over !== vault));
	/** its cells, the entries the same caps reach, its own first */
	const cells = $derived(world.cells.filter((x) => x.vault === vault).sort((a, b) => a.caps.length - b.caps.length));
	/** every device this browser knows, by its id: its name and the vault it is a device of */
	const devices = $derived(
		new Map(world.vaults.flatMap((x) => x.devices.map((d) => [d.id, { ...d, vault: x }])))
	);

	let renaming = $state(/** @type {string | null} */ (null));
	let naming = $state(/** @type {string | null} */ (null));
	/** Whether avenDB's server backs up the person's vault (true), only relays for it (false), or holds no cap (null). */
	let backs = $state(/** @type {boolean | null | undefined} */ (undefined));
	$effect(() => {
		if (vault !== world.mine) return;
		void world;
		api.backsUp().then((/** @type {boolean | null} */ b) => (backs = b), () => (backs = null));
	});

	/** A device's name: its card's, or what it is. @param {string} id */
	function deviceName(id) {
		const d = devices.get(id);
		if (!d) return `A device ${short(id)}`;
		if (d.name) return d.name;
		return d.vault.kind === 'aven' ? `${nameOf(d.vault)}'s server` : `A device ${short(id)}`;
	}

	/** How this browser acts for the vault. */
	const acting = $derived.by(() => {
		if (!v.via) return 'It doesn’t act for it: it only knows it from what it syncs.';
		if (!v.via.length) return 'It is one of its devices, and acts for it directly.';
		const chain = v.via.map((o) => nameOf(byId.get(o)));
		return `It acts for it through ${list(chain)}, which ${v.via.length === 1 ? 'owns it' : 'own it in turn'}.`;
	});

	/** The entries a cell holds, as a person reads them: titled where the acting vault reads them. @param {string[]} es */
	function titles(es) {
		const known = es.map((e) => world.entries.find((x) => x.entry === e)).filter((x) => !!x);
		const named = known.filter((x) => reads(x, actor) && x.title).map((x) => titleOf(world, x.entry));
		const sealed = es.length - named.length;
		const more = named.length > 5 ? [`${named.length - 5} more`] : [];
		return list([...named.slice(0, 5), ...more, ...(sealed ? [`${sealed} sealed for ${nameOf(as)}`] : [])]);
	}
</script>

{#if tab === 'about'}
	<div class="cards">
		<article class="card">
			<div class="row head">
				<Mark vault={v} size={52} />
				<div>
					<h3>{nameOf(v)}</h3>
					<span class="chip accent">{KINDS[v.kind]}</span>
				</div>
			</div>
			<p class="soft">{KIND_HINTS[v.kind]}</p>
			{#if v.via}
				{#if naming === null}
					<button class="btn" disabled={busy} onclick={() => (naming = v.name ?? '')}>Rename</button>
				{:else}
					<div class="row">
						<input class="field" bind:value={naming} aria-label="Its name" />
						<button
							class="btn primary"
							disabled={busy || !naming.trim()}
							onclick={async () => (await api.profile(vault, naming?.trim())) && (naming = null)}
						>
							Save
						</button>
						<button class="btn quiet" onclick={() => (naming = null)}>Cancel</button>
					</div>
					<p class="soft">Its name is its profile, an entry of it, end-to-end encrypted like the others.</p>
				{/if}
			{/if}
		</article>
		<article class="card">
			<h3>Who decides</h3>
			<dl>
				<dt>Its id</dt>
				<dd class="mono" title={v.id}>{short(v.id)}</dd>
				{#if v.root}
					<dt>Its root</dt>
					<dd>Passkey <span class="mono">{short(v.root)}</span>: it approves every change alone, and is its only recovery.</dd>
				{/if}
				<dt>A change needs</dt>
				<dd>
					{v.root ? 'its root, or ' : ''}{v.threshold} of its {count(v.owners.length, 'owner')} to approve.
				</dd>
				<dt>{Here}</dt>
				<dd>{acting}</dd>
			</dl>
		</article>
		<article class="card">
			<h3>Quantum-proof</h3>
			{#if world.pqOnly}<p><span class="chip ok">Post-quantum only</span></p>{/if}
			<p class="soft">
				No device trusts the elliptic curves alone: a write counts only once its author's SLH-DSA checkpoint covers it,
				every other edit carries an SLH-DSA signature, keys are sealed with X-Wing and Classic McEliece, every connection
				agrees its keys with X25519MLKEM768, and every hash is SHA-3.
			</p>
		</article>
		{#if vault === world.mine && backs != null}
			<article class="card">
				<h3>Backup</h3>
				<p>
					<span class="chip" class:ok={backs}>{backs ? 'Backed up' : 'Relay only'}</span>
				</p>
				<p class="soft">
					{backs
						? "avenDB's server keeps your vault encrypted, which it can never open, so your passkey alone brings it back with every device lost."
						: "avenDB's server only helps your devices find and reach each other and keeps nothing: your vault lives on your devices alone, so losing them all loses it."}
				</p>
				<p class="soft">Turning it off keeps what the server holds already; it just stops taking more.</p>
				<button class="btn" disabled={busy} onclick={() => api.backUp(!backs)}>
					{backs ? 'Turn backups off' : 'Turn backups on'}
				</button>
			</article>
		{/if}
	</div>
{:else if tab === 'members'}
	<div class="cards">
		<article class="card">
			<h3>Owners</h3>
			<ul class="list">
				{#each v.owners as o (('vault' in o ? o.vault : o.signer))}
					<li>
						{#if 'vault' in o}
							<Mark vault={byId.get(o.vault)} size={28} />
							<b>{nameOf(byId.get(o.vault))}</b>
							<span class="soft">{KINDS[byId.get(o.vault)?.kind ?? 'human']}</span>
						{:else}
							<span class="key">🔑</span>
							<b>{o.signer === v.root ? 'Root passkey' : 'Passkey'}</b>
							<span class="soft mono">{short(o.signer)}</span>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="soft">{v.threshold} of {count(v.owners.length, 'owner')} approve{v.owners.length === 1 ? 's' : ''} a change.</p>
		</article>

		{#if owned.length}
			<article class="card">
				<h3>It owns</h3>
				<ul class="list">
					{#each owned as x (x.id)}
						<li><Mark vault={x} size={28} /><b>{nameOf(x)}</b><span class="soft">{KINDS[x.kind]}</span></li>
					{/each}
				</ul>
			</article>
		{/if}

		<article class="card">
			<h3>Devices</h3>
			{#if v.kind === 'coop'}
				<p class="soft">A coop has no devices: it acts only through its owners' devices.</p>
			{:else if !v.devices.length}
				<p class="soft">
					No device of its own yet: {v.via ? `${here} acts for it through its owners` : 'its owners act for it'}.
				</p>
			{/if}
			<ul class="list">
				{#each v.devices as d (d.id)}
					<li>
						{#if d.me && renaming !== null}
							<input class="field" bind:value={renaming} aria-label={`${Here}'s name`} />
							<button
								class="btn primary"
								disabled={busy || !renaming.trim()}
								onclick={async () => (await api.rename(renaming?.trim())) && (renaming = null)}
							>
								Save
							</button>
							<button class="btn quiet" onclick={() => (renaming = null)}>Cancel</button>
						{:else}
							<b>{d.me ? (d.name ?? thisName) : deviceName(d.id)}</b>
							{#if d.me}
								<span class="chip accent">{here}</span>
								<button class="btn quiet" disabled={busy} onclick={() => (renaming = d.name ?? thisName)}>Rename</button>
							{:else}
								<span class="soft mono">{short(d.id)}</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</article>

		{#if vault === world.mine}
			<article class="card">
				<h3>Link another device</h3>
				<p class="soft">
					Open this link on your other device, or scan it with its camera. It joins your vault once you confirm with your
					passkey there. Or sign in there with your passkey alone.
				</p>
				<!-- the SVG is the device's own, made by qrSvg from the link -->
				<div class="qr">{@html qr}</div>
				<input class="field code" readonly value={link} onfocus={(e) => e.currentTarget.select()} />
			</article>
			<article class="card">
				<h3>{Here}</h3>
				{#if sockets}
					<p>
						<span class="chip ok">Native</span>
						avenDB runs beside the app, not in this page: it reaches your other devices directly, over {count(
							sockets.length,
							'UDP socket'
						)} of its own, through avenDB's relay only where your network leaves no other way, and keeps your vault in a
						folder on this Mac.
					</p>
				{/if}
				<p class="soft">
					Forgetting your account here leaves your vault and everything in it with your other devices and avenDB's server:
					sign in again with your passkey.
				</p>
				<button class="btn danger" disabled={busy} onclick={api.forget}>Forget my account on {here}</button>
			</article>
		{/if}
	</div>
{:else if tab === 'access'}
	<div class="cards">
		<article class="card wide">
			<h3>Caps over {nameOf(v)}</h3>
			<p class="soft">
				Each cap is a named group of ops, what its holder may do, on a slice of it: a rule over its entries'
				types and tags, or chosen entries. What it reaches changes as entries are written and tagged.
				{nameOf(v)} itself holds every right over all of it.
			</p>
			{#each groups as [key, g] (key)}
				<section class="group">
					<div class="group-head">
						<b>{g.name}</b>
						{#if g.ops}
							<Ops ops={g.ops} />
						{:else}
							<span class="soft">its ops are sealed from {here}</span>
						{/if}
					</div>
					<ul class="list grants">
						{#each g.caps as c (c.id)}
							<li>
								<span class="cap">
									{#if c.grantee === EVERYONE}
										<span class="chip">Everyone</span>
									{:else}
										<Mark vault={byId.get(c.grantee)} size={28} />
									{/if}
									<span>
										<b class:mine={c.grantee === actor}>{granteeOf(c, world)}</b>
										on {whereWords(c.slice?.where, world)}
										<small class="soft">
											· reaches {count(c.entries.length, 'entry', 'entries')} now · given by
											{nameOf(byId.get(c.issuer))}{c.parent
												? ', through an owner cap of its own, whose ops narrow it too'
												: ''}
										</small>
									</span>
								</span>
								{#if c.revokers.includes(actor)}
									<button
										class="btn quiet danger"
										disabled={busy}
										onclick={() => api.revoke(actor, c.id, c.role)}>Revoke</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="soft">No cap: only {nameOf(v)} itself holds anything in it.</p>
			{/each}
		</article>

		<article class="card">
			<h3>Share some of it as {nameOf(as)}</h3>
			{#if shares(world, vault, actor)}
				<Share {world} {actor} {api} {busy} {vault} />
			{:else}
				<p class="soft">
					{nameOf(as)} holds no owner cap over {nameOf(v)}: only the vault itself, or a vault it lets own some of it, shares it
					on.
				</p>
			{/if}
		</article>

		<article class="card">
			<h3>What {nameOf(v)} holds elsewhere</h3>
			<ul class="list">
				{#each held as c (c.id)}
					<li>
						<Mark vault={byId.get(c.over)} size={28} />
						<span class="held">
							<span>
								<b>{capName(c)}</b> on {whereWords(c.slice?.where, world)} of
								<b>{nameOf(byId.get(c.over))}</b>
							</span>
							{#if c.slice}<Ops ops={c.slice.ops} />{/if}
						</span>
					</li>
				{:else}
					<li class="soft">No cap in another vault.</li>
				{/each}
			</ul>
		</article>
	</div>
{:else if tab === 'sync'}
	<p class="lead-in soft">
		{nameOf(v)}'s entries sync by cells: the entries the same caps reach share one key, and go to the devices of {nameOf(v)}
		and of each vault those caps name, and to no one else. A tag that takes an entry into a cap's slice, or out of it, moves
		it to another cell. A device whose vault only relays a cell keeps and forwards its ciphertext, and opens none of it.
	</p>
	{#each cells as x (x.id)}
		<section class="cell">
			<h2>{cellWords(x, world)}</h2>
			<p class="soft">
				{count(x.entries.length, 'entry', 'entries')}: {titles(x.entries)} · key generation {x.generation}{x.public
					? ' · everyone reads it'
					: ''}
			</p>
			<ul class="card list">
				{#each x.syncs as d (d.device)}
					<li>
						<b>{deviceName(d.device)}</b>
						<span class="soft">of {nameOf(devices.get(d.device)?.vault)}, through {nameOf(byId.get(d.through))}</span>
						{#if d.opens}
							<span class="chip ok">opens it</span>
						{:else}
							<span class="chip">relays its ciphertext only</span>
						{/if}
					</li>
				{:else}
					<li class="soft">No device receives it.</li>
				{/each}
			</ul>
		</section>
	{:else}
		<div class="empty">{nameOf(v)} holds no entry yet.</div>
	{/each}
{/if}

<style>
	h3 {
		margin: 0 0 0.4rem;
	}

	.head {
		gap: 0.8rem;
		margin-bottom: 0.6rem;
	}

	.head h3 {
		margin: 0 0 0.2rem;
		font-size: 1.15rem;
	}

	.card p {
		line-height: 1.5;
	}

	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 0.9rem;
		margin: 0;
		font-size: 0.9rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.list li:last-child {
		border-bottom: 0;
	}

	.grants li {
		justify-content: space-between;
	}

	.group + .group {
		margin-top: 0.9rem;
	}

	.group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding-bottom: 0.35rem;
		border-bottom: 1px solid var(--edge);
	}

	.mine {
		color: var(--accent);
	}

	.held {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.cap {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		line-height: 1.5;
	}

	.wide {
		grid-column: 1 / -1;
	}

	.list li input.field {
		flex: 1 1 10rem;
	}

	ul.card.list {
		padding: 0.3rem 1rem;
	}

	.key {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
	}

	.cell {
		margin-bottom: 1.8rem;
	}

	.cell > p {
		margin: 0 0 0.6rem;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.cell h2 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		font-variation-settings: normal;
		letter-spacing: 0;
	}

	.qr :global(svg) {
		width: 220px;
		max-width: 100%;
		height: auto;
		background: #fff;
	}

	.code {
		display: block;
		width: 100%;
		box-sizing: border-box;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
	}

	.lead-in {
		max-width: 70ch;
		margin: 0 0 1rem;
		line-height: 1.5;
	}
</style>
