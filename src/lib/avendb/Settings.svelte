<!--
	A vault's settings, as its aside lists them: About (what it is, who approves a change to it, how this browser acts
	for it), Owners and devices (who owns it, what it owns, the devices that act for it, and for the person's own vault
	this browser's name, linking the next device and forgetting this one), Access (which vault holds which role on each
	of its spaces, the grants in force, revoking them, and sharing a space as the acting vault), and Sync (the devices
	that receive each space's ops, and whether each opens them or only relays their ciphertext). All of it is the
	device's world (avendb-browser's `World`); sharing and revoking go out acting for the acting vault, and the rules
	check them against its caps.
-->
<script>
	import { untrack } from 'svelte';
	import Mark from './Mark.svelte';
	import { allows, count, KIND_HINTS, KINDS, list, nameOf, ROLE_HINTS, ROLES, short } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   tab: 'about' | 'members' | 'access' | 'sync', thisName: string, link: string, qr: string }}
	 */
	let { world, vault, actor, api, busy, tab, thisName, link, qr } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const v = $derived(/** @type {import('./vaults.js').VaultView} */ (byId.get(vault)));
	const as = $derived(byId.get(actor));
	const spaces = $derived(world.spaces.filter((s) => s.founder === vault));
	const owned = $derived(world.vaults.filter((x) => x.owners.some((o) => 'vault' in o && o.vault === vault)));
	const others = $derived(world.vaults.filter((x) => x.id !== actor));
	/** every device this browser knows, by its id: its name and the vault it is a device of */
	const devices = $derived(
		new Map(world.vaults.flatMap((x) => x.devices.map((d) => [d.id, { ...d, vault: x }])))
	);

	let renaming = $state(/** @type {string | null} */ (null));
	let naming = $state(/** @type {string | null} */ (null));
	/** @type {Record<string, { grantee: string, role: string }>} each space's share form */
	let forms = $state({});

	$effect(() => {
		const [now, to] = [spaces, others[0]?.id ?? ''];
		untrack(() => {
			for (const s of now) forms[s.id] ??= { grantee: to, role: 'read' };
		});
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

	/** The scope a grant covers, as a person reads it. @param {import('./vaults.js').SpaceView} s @param {import('./vaults.js').GrantView} g */
	function scope(s, g) {
		if (!g.entry) return 'the whole space';
		const it = s.items.find((i) => i.entry === g.entry);
		return it?.title ? `“${it.title}”` : 'one entry';
	}

	/** @param {import('./vaults.js').SpaceView} s */
	async function give(s) {
		const f = forms[s.id];
		const role = f.grantee === 'public' ? 'read' : f.role;
		await api.grant(actor, s.id, null, role, f.grantee);
	}

	const holders = (/** @type {Record<string, string>} */ roles) =>
		Object.entries(roles).sort(
			(a, b) => ['owner', 'write', 'read', 'relay'].indexOf(a[1]) - ['owner', 'write', 'read', 'relay'].indexOf(b[1])
		);
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
					<p class="soft">Its name is its profile, a note in its home, end-to-end encrypted like the others.</p>
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
				<dt>This browser</dt>
				<dd>{acting}</dd>
			</dl>
		</article>
		<article class="card">
			<h3>Quantum-proof</h3>
			{#if world.pqOnly}<p><span class="chip ok">Post-quantum only</span></p>{/if}
			<p class="soft">
				No device trusts the elliptic curves alone: a write counts only once its author's SLH-DSA checkpoint covers it,
				every other op carries an SLH-DSA signature, keys are sealed with X-Wing and Classic McEliece, every connection
				agrees its keys with X25519MLKEM768, and every hash is SHA-3.
			</p>
		</article>
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
					No device of its own yet: {v.via ? 'this browser acts for it through its owners' : 'its owners act for it'}.
				</p>
			{/if}
			<ul class="list">
				{#each v.devices as d (d.id)}
					<li>
						{#if d.me && renaming !== null}
							<input class="field" bind:value={renaming} aria-label="This browser's name" />
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
								<span class="chip accent">this browser</span>
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
				<h3>This browser</h3>
				<p class="soft">
					Forgetting your account here leaves your vault and everything in it with your other devices and avenDB's server:
					sign in again with your passkey.
				</p>
				<button class="btn danger" disabled={busy} onclick={api.forget}>Forget my account on this browser</button>
			</article>
		{/if}
	</div>
{:else if tab === 'access'}
	{#each spaces as s, n (s.id)}
		{@const f = forms[s.id]}
		{@const mayShare = allows(s.roles[actor], 'owner')}
		<section class="space">
			<h2>{s.id === v.home ? 'Home' : `Space ${n + 1}`}</h2>
			<div class="cards">
				<article class="card">
					<h3>Who holds what</h3>
					<ul class="list">
						{#each holders(s.roles) as [id, role] (id)}
							<li title={ROLE_HINTS[/** @type {import('./vaults.js').Role} */ (role)]}>
								<Mark vault={byId.get(id)} size={28} />
								<b>{nameOf(byId.get(id))}</b>
								<span class="chip" class:accent={id === actor}>{ROLES[/** @type {import('./vaults.js').Role} */ (role)]}</span>
								{#if id === s.founder}<span class="soft">founded it</span>{/if}
							</li>
						{/each}
						{#if s.public}<li><span class="chip">Everyone reads it</span></li>{/if}
					</ul>
					<p class="soft">On the whole space. A note shared on its own shows its own holders.</p>
				</article>

				<article class="card">
					<h3>Grants in force</h3>
					{#if !s.grants.length}<p class="soft">None: only its founder holds it.</p>{/if}
					<ul class="list grants">
						{#each s.grants as g (g.id)}
							<li>
								<span>
									<b>{nameOf(byId.get(g.issuer))}</b> gave
									<b>{g.grantee === 'public' ? 'everyone' : nameOf(byId.get(g.grantee))}</b>
									<span class="chip">{ROLES[g.role]}</span> on {scope(s, g)}
								</span>
								{#if g.revokers.includes(actor)}
									<button class="btn quiet danger" disabled={busy} onclick={() => api.revoke(actor, g.id, g.role)}>Revoke</button>
								{/if}
							</li>
						{/each}
					</ul>
				</article>

				<article class="card">
					<h3>Share the space as {nameOf(as)}</h3>
					{#if mayShare && f}
						<div class="row">
							<select class="field" bind:value={f.grantee} aria-label="Share with">
								{#each others as x (x.id)}<option value={x.id}>{nameOf(x)}</option>{/each}
								<option value="public">Everyone (public)</option>
							</select>
							{#if f.grantee !== 'public'}
								<select class="field" bind:value={f.role} aria-label="Role">
									<option value="relay">relays (ciphertext only)</option>
									<option value="read">reads</option>
									<option value="write">writes</option>
									<option value="owner">owns (your passkey approves)</option>
								</select>
							{/if}
							<button class="btn primary" disabled={busy || !f.grantee} onclick={() => give(s)}>Share</button>
						</div>
						<p class="soft">{ROLE_HINTS[/** @type {import('./vaults.js').Role} */ (f.grantee === 'public' ? 'read' : f.role)]}.</p>
					{:else}
						<p class="soft">
							{nameOf(as)} {s.roles[actor] ? `only ${ROLES[s.roles[actor]]} it` : 'holds no cap on it'}: only a vault that owns
							a space shares it on.
						</p>
					{/if}
				</article>
			</div>
		</section>
	{:else}
		<div class="empty">{nameOf(v)} has founded no space yet.</div>
	{/each}
{:else if tab === 'sync'}
	<p class="lead-in soft">
		A device receives a space's ops only if it acts for a vault holding a cap on it. A device whose vault only relays it
		keeps and forwards the ciphertext, and opens none of it.
	</p>
	{#each spaces as s, n (s.id)}
		<section class="space">
			<h2>{s.id === v.home ? 'Home' : `Space ${n + 1}`}</h2>
			<ul class="card list">
				{#each s.syncs as x (x.device)}
					<li>
						<b>{deviceName(x.device)}</b>
						<span class="soft">of {nameOf(devices.get(x.device)?.vault)}, through {nameOf(byId.get(x.through))}</span>
						{#if x.opens}
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
		<div class="empty">{nameOf(v)} has founded no space yet.</div>
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

	.space {
		margin-bottom: 1.8rem;
	}

	.space h2 {
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
