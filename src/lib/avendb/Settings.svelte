<!--
	A vault's settings, as its aside lists them: About (what it is, who approves a change to it, how this browser acts
	for it), Owners and devices (who owns it, what it owns, the devices that act for it, and for the person's own vault
	this browser's name, linking the next device and forgetting this one), and Sharing (who it is shared with: its
	owners, then every share in force over it, each who · level · what, with what it reaches now and who may revoke
	it; sharing some of it as the acting vault; what is shared with it elsewhere; and its entries by who they are
	shared with, each with the devices that get them and whether each opens them or only keeps an encrypted copy). All
	of it is the device's world (avendb-browser's `World`); sharing and revoking go out acting for the acting vault, and
	the rules check them against what is shared with it.
-->
<script>
	import { native } from '$lib/native';
	import Mark from './Mark.svelte';
	import Ops from './Ops.svelte';
	import Share from './Share.svelte';
	import {
		count,
		EVERYONE,
		granteeOf,
		groupOf,
		KEEPS,
		KIND_HINTS,
		KINDS,
		levelName,
		list,
		nameOf,
		reads,
		roleGroup,
		sharedThrough,
		sharedWords,
		shareWhat,
		short,
		shares,
		signerName,
		STRONGEST,
		titleOf
	} from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   tab: 'about' | 'members' | 'sharing', thisName: string, link: string, qr: string, sockets?: string[] | null }}
	 */
	let { world, vault, actor, api, busy, tab, thisName, link, qr, sockets = null } = $props();

	/** This device, as the person sees it: in the Mac app, the Mac. */
	const [here, Here] = native() ? ['this Mac', 'This Mac'] : ['this browser', 'This browser'];

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const v = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(vault)));
	const as = $derived(byId.get(actor));
	const owned = $derived(world.vaults.filter((x) => x.owners.some((o) => 'vault' in o && o.vault === vault)));
	/** the person's own vault lacks the master recovery key this device adds */
	const recoveryMissing = $derived(
		vault === world.mine && !!world.recovery && !v.owners.some((o) => 'signer' in o && o.signer === world.recovery)
	);
	/** whether the vault has the master recovery key among its owners */
	const recovers = $derived(v.owners.some((o) => 'signer' in o && o.recovery));
	/** A signer owner, as the owners list labels it. @param {{ signer: string, recovery: boolean }} o */
	const ownerLabel = (o) => (o.recovery ? 'Master recovery key' : o.signer === v.root ? 'Root passkey' : 'Passkey');
	/**
	 * An owner the person's passkey may remove: of their own vault or one it acts for, never the last nor the root.
	 * @param {{ vault: string } | { signer: string }} o
	 */
	const removable = (o) =>
		v.owners.length > 1 && (vault === world.mine || v.via !== null) && !('signer' in o && o.signer === v.root);
	/** the vault itself and the vaults that own it: each holds all of it */
	const owners = $derived(
		[v, ...v.owners.flatMap((o) => ('vault' in o ? [byId.get(o.vault)] : []))].filter((x) => !!x)
	);
	/** every share in force over the vault, the strongest first, then by who holds it */
	const given = $derived(
		world.caps
			.filter((c) => c.over === vault)
			.sort(
				(a, b) =>
					STRONGEST.indexOf(a.role) - STRONGEST.indexOf(b.role) ||
					granteeOf(a, world).localeCompare(granteeOf(b, world))
			)
	);
	/** what is shared with the vault in other vaults */
	const held = $derived(world.caps.filter((c) => c.grantee === vault && c.over !== vault));
	/**
	 * its entries by who they are shared with, those the same shares reach (each of the core's cells) together where
	 * who they are shared with reads the same: each with its entries and the devices that get them, the fewest first
	 */
	const audiences = $derived.by(() => {
		/** @typedef {{ n: number, entries: string[], syncs: Map<string, import('./vaults.js').Syncing> }} Audience */
		/** @type {Map<string, Audience>} */
		const by = new Map();
		for (const x of world.cells.filter((x) => x.vault === vault)) {
			const shared = sharedThrough(world, vault, x.caps);
			const words = sharedWords(shared);
			/** @type {Audience} */
			const a = by.get(words) ?? { n: shared.who.length + shared.gone, entries: [], syncs: new Map() };
			a.entries.push(...x.entries);
			for (const d of x.syncs) {
				const had = a.syncs.get(d.device);
				a.syncs.set(d.device, had ? { ...had, opens: had.opens || d.opens } : d);
			}
			by.set(words, a);
		}
		return [...by].sort(([, a], [, b]) => a.n - b.n);
	});
	/** every device this browser knows, by its id: its name and the vault it is a device of */
	const devices = $derived(
		new Map(world.vaults.flatMap((x) => x.devices.map((d) => [d.id, { ...d, vault: x }])))
	);
	/**
	 * What a device does with the entries it gets: opens them, or, where it doesn't, keeps an encrypted copy (Backup) or
	 * only connects (Relay), by the role the device's world names; else only that it opens none of them.
	 * @param {import('./vaults.js').Syncing} d
	 */
	const gets = (d) => (d.opens ? 'opens it' : ((d.role && KEEPS[d.role]) ?? 'opens none of it'));

	let renaming = $state(/** @type {string | null} */ (null));
	let naming = $state(/** @type {string | null} */ (null));
	/** Whether avenDB's server backs up the person's vault (true), only relays for it (false), or holds no cap (null). */
	let backs = $state(/** @type {boolean | null | undefined} */ (undefined));
	$effect(() => {
		if (vault !== world.mine) return;
		void world;
		api.backsUp().then((/** @type {boolean | null} */ b) => (backs = b), () => (backs = null));
	});

	/** A device's name, to start a line: its card's, or what it is. @param {string} id */
	const deviceName = (id) => signerName(world, id, true);

	/** How this browser acts for the vault. */
	const acting = $derived.by(() => {
		if (!v.via) return 'It doesn’t act for it: it only knows it from what it syncs.';
		if (!v.via.length) return 'It is one of its devices, and acts for it directly.';
		const chain = v.via.map((o) => nameOf(byId.get(o)));
		return `It acts for it through ${list(chain)}, which ${v.via.length === 1 ? 'owns it' : 'own it in turn'}.`;
	});

	/** Entries, as a person reads them: titled where the acting vault reads them. @param {string[]} es */
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
					<dd>
						Passkey <span class="mono">{short(v.root)}</span>: it approves every change alone{recovers
							? '; the master recovery key can also recover it while avenDB is young'
							: ''}.
					</dd>
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
			<p><span class="chip ok">Post-quantum only</span></p>
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
			<ul class="list grants">
				{#each v.owners as o (('vault' in o ? o.vault : o.signer))}
					<li>
						<span class="cap">
							{#if 'vault' in o}
								<Mark vault={byId.get(o.vault)} size={28} />
								<b>{nameOf(byId.get(o.vault))}</b>
								<span class="soft">{KINDS[byId.get(o.vault)?.kind ?? 'human']}</span>
							{:else}
								<span class="key">{o.recovery ? '🛟' : '🔑'}</span>
								<b>{ownerLabel(o)}</b>
								<span class="soft mono">{short(o.signer)}</span>
							{/if}
						</span>
						{#if removable(o)}
							<button class="btn quiet danger" disabled={busy} onclick={() => api.removeOwner(vault, o)}
								>Remove</button
							>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="soft">{v.threshold} of {count(v.owners.length, 'owner')} approve{v.owners.length === 1 ? 's' : ''} a change.</p>
			{#if recoveryMissing}
				<p class="soft">
					The master recovery key is avenDB's way back into a vault whose passkeys are all lost, while avenDB
					is young. Your vault doesn't have it.
				</p>
				<button class="btn" disabled={busy} onclick={() => api.addRecovery()}
					>Add the master recovery key</button
				>
			{/if}
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
						)} of its own, through avenDB's connection server only where your network leaves no other way, and keeps
						your vault in a folder on this Mac.
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
{:else if tab === 'sharing'}
	<div class="cards">
		<article class="card wide">
			<h3>Who {nameOf(v)} is shared with</h3>
			<p class="soft">
				Each share is who, at what level, on what: everything, its entries of a type or with some tags, or chosen
				entries. A share on a type or a tag reaches what matches it now and later. {nameOf(v)} and the vaults that
				own it hold all of it.
			</p>
			<ul class="list grants">
				{#each owners as o (o.id)}
					<li>
						<span class="cap">
							<Mark vault={o} size={28} />
							<span>
								<b class:mine={o.id === actor}>{nameOf(o)}</b> · {roleGroup(world, 'owner')} · Everything
								<small class="soft">· {o.id === vault ? 'the vault itself' : 'owns it'}</small>
							</span>
						</span>
					</li>
				{/each}
				{#each given as c (c.id)}
					{@const group = groupOf(c, world)}
					<li>
						<span class="cap">
							{#if c.grantee === EVERYONE}
								<span class="chip">Public</span>
							{:else}
								<Mark vault={byId.get(c.grantee)} size={28} />
							{/if}
							<span class="held">
								<span>
									<b class:mine={c.grantee === actor}>{granteeOf(c, world)}</b> ·
									<span title={group ? group.hint : undefined}>{levelName(c, world)}</span> · {shareWhat(c, world)}
									<small class="soft">
										{KEEPS[c.role] ? `· ${KEEPS[c.role]} ` : ''}· reaches
										{count(c.entries.length, 'entry', 'entries')} now · given by {nameOf(byId.get(c.issuer))}{c.parent
											? ', through its own Owner share, which narrows it too'
											: ''}
									</small>
								</span>
								{#if !c.slice}
									<small class="soft">What it picks and allows is sealed from {here}.</small>
								{:else if !group}
									<Ops ops={c.slice.ops} />
								{/if}
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
		</article>

		<article class="card">
			<h3>Share some of it as {nameOf(as)}</h3>
			{#if shares(world, vault, actor)}
				<Share {world} {actor} {api} {busy} {vault} />
			{:else}
				<p class="soft">
					Nothing of {nameOf(v)} is shared with {nameOf(as)} as Owner: only the vault itself, or a vault it shares
					some of it with as Owner, shares it on.
				</p>
			{/if}
		</article>

		<article class="card">
			<h3>Shared with {nameOf(v)} elsewhere</h3>
			<ul class="list">
				{#each held as c (c.id)}
					<li>
						<Mark vault={byId.get(c.over)} size={28} />
						<span class="held">
							<span>
								<b>{levelName(c, world)}</b> · {shareWhat(c, world)} · of <b>{nameOf(byId.get(c.over))}</b>
							</span>
							{#if c.slice && !groupOf(c, world)}<Ops ops={c.slice.ops} />{/if}
						</span>
					</li>
				{:else}
					<li class="soft">Nothing in another vault.</li>
				{/each}
			</ul>
		</article>
	</div>

	<h3 class="who-gets">Who gets what</h3>
	<p class="lead-in soft">
		{nameOf(v)}'s entries, by who they are shared with, and the devices that get them: those of {nameOf(v)} and of each
		vault they are shared with, and no one else. A tag that takes an entry into a share, or out of it, changes who gets
		it. A device that only keeps an encrypted copy opens none of it.
	</p>
	{#each audiences as [words, a] (words)}
		<section class="audience">
			<h2>Shared with {words}</h2>
			<p class="soft">{count(a.entries.length, 'entry', 'entries')}: {titles(a.entries)}</p>
			<ul class="card list">
				{#each [...a.syncs.values()] as d (d.device)}
					{@const of = devices.get(d.device)?.vault}
					<li>
						<b>{deviceName(d.device)}</b>
						<span class="soft">of {nameOf(of)}{of?.id !== d.through ? `, as ${nameOf(byId.get(d.through))}` : ''}</span>
						<span class="chip" class:ok={d.opens}>{gets(d)}</span>
					</li>
				{:else}
					<li class="soft">No device gets it.</li>
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

	.who-gets {
		margin: 2rem 0 0.4rem;
	}

	.audience {
		margin-bottom: 1.8rem;
	}

	.audience > p {
		margin: 0 0 0.6rem;
		font-size: 0.84rem;
		line-height: 1.5;
	}

	.audience h2 {
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
