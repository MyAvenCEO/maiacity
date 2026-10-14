<!--
	A vault's settings, as its aside lists them: About (what it is, who approves a change to it and how many of its
	owners, how this browser acts for it), Owners and devices (who owns it, what it owns, the devices that act for it,
	and for the person's own vault this browser's name, linking the next device and forgetting this one), and Sharing
	(who it is shared with: its owners, then every share in force over it, each who · level · what, with what it
	reaches now; sharing some of it as the acting vault; what each of the person's devices keeps of it; what is shared
	with it elsewhere; and its entries by who they are shared with, each with the devices that get them and whether
	each opens them or only keeps an encrypted copy). All of it is the device's: its world (avendb-browser's `World`)
	and its list of the shares over the vault (the `shares` op), which says too whether the acting vault may revoke
	each; every other button shows only where the device answers a dry run of it (`may`), and every change goes out as
	one op, acting for the acting vault, which the rules check against what is shared with it.
-->
<script>
	import { native } from '$lib/native';
	import Mark from './Mark.svelte';
	import { allowed, may, read } from './ops.js';
	import Ops from './Ops.svelte';
	import Share from './Share.svelte';
	import {
		acting,
		count,
		EVERYONE,
		groupOf,
		KEEPS,
		KIND_HINTS,
		KINDS,
		levelName,
		list,
		MODES,
		nameOf,
		reads,
		roleGroup,
		rowLevel,
		rowWhat,
		sharedThrough,
		sharedWords,
		shareWhat,
		short,
		signerName,
		titleOf,
		why
	} from './vaults.js';

	/** @typedef {import('./vaults.js').ShareRow} ShareRow */
	/** @typedef {import('./vaults.js').Verdict} Verdict */

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
	const mine = $derived(byId.get(world.mine));
	const owned = $derived(world.vaults.filter((x) => x.owners.some((o) => 'vault' in o && o.vault === vault)));
	/** the person's own vault lacks the master recovery key this device adds */
	const recoveryMissing = $derived(
		vault === world.mine && !!world.recovery && !v.owners.some((o) => 'signer' in o && o.signer === world.recovery)
	);
	/** whether the vault has the master recovery key among its owners */
	const recovers = $derived(v.owners.some((o) => 'signer' in o && o.recovery));
	/** A signer owner, as the owners list labels it. @param {{ signer: string, recovery: boolean }} o */
	const ownerLabel = (o) => (o.recovery ? 'Master recovery key' : o.signer === v.root ? 'Root passkey' : 'Passkey');
	/** the vault itself and the vaults that own it: each holds all of it */
	const owners = $derived(
		[v, ...v.owners.flatMap((o) => ('vault' in o ? [byId.get(o.vault)] : []))].filter((x) => !!x)
	);

	/** every share over the vault, owners, devices and keep shares among them, as the device lists them for the acting
	 *  vault (the `shares` op), with whether it may revoke each: the last list, until the next one comes */
	let listed = $state.raw(/** @type {import('./vaults.js').Shares | null} */ (null));
	$effect(() => {
		const op = { op: 'shares', over: vault, as: actor };
		void world;
		let gone = false;
		read(api, op, null).then((/** @type {import('./vaults.js').Shares | null} */ s) => !gone && (listed = s));
		return () => {
			gone = true;
		};
	});
	const rows = $derived(listed?.over === vault ? listed.rows : []);
	/** every share in force over the vault, the strongest first, as the device orders them */
	const given = $derived(rows.filter((r) => r.kind === 'grant'));
	/** whether the acting vault may share some of the vault on, as the device says */
	const sharesOn = $derived(listed?.over === vault ? allowed(listed.share) : acting(world, vault).shares);
	/** The device's row of owner `o`, and whether it may be removed. @param {{ vault: string } | { signer: string }} o */
	const ownerRow = (o) =>
		rows.find(
			(r) =>
				r.kind === 'owner' &&
				r.who !== EVERYONE &&
				('vault' in o ? 'vault' in r.who && r.who.vault === o.vault : 'signer' in r.who && r.who.signer === o.signer)
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
	/** how many of its owners a change needs, as the person picks it */
	let threshold = $state(0);
	const needs = $derived(v.threshold);
	$effect.pre(() => {
		threshold = needs;
	});
	/** Whether avenDB's server backs up the person's vault (true), only relays for it (false), or holds no cap (null). */
	const backs = $derived(world.backsUp);

	/** the keep share being set up for one of the person's devices: which, its mode, and what it keeps */
	let keeping = $state(/** @type {{ device: string, mode: string, types: string, tag: string } | null} */ (null));
	/** What the keep share keeps: everything, or entries of a type, tagged one way. */
	const keepWhat = $derived.by(() => {
		if (!keeping || !keeping.types) return 'everything';
		/** @type {import('./vaults.js').Atom[]} */
		const tests = [{ type: keeping.types.split(',') }];
		const tag = keeping.tag.trim().replace(/^#/, '');
		if (tag) tests.push({ tag });
		return tests.length === 1 ? tests[0] : { all: tests };
	});
	const keepOp = $derived(
		keeping && { op: 'keep', over: vault, mode: keeping.mode, what: keepWhat, device: keeping.device, as: world.mine }
	);

	/**
	 * What the device would make, as it answers a dry run of each (`may`): the vault's name (`profile`), how many owners
	 * a change needs (`threshold`), the master recovery key as an owner (`recovery`), backups on or off (`backUp`), and
	 * the keep share being set up (`keep`): `true`, `{ approve }` where the vault's owners approve it, or why not.
	 */
	let can = $state(/** @type {Record<string, Verdict>} */ ({}));
	$effect(() => {
		void world;
		/** @type {Record<string, object>} */
		const asks = { profile: { op: 'profile', vault, name: naming?.trim() || nameOf(v) } };
		if (threshold !== v.threshold) asks.threshold = { op: 'settings', vault, threshold };
		if (recoveryMissing && world.recovery)
			asks.recovery = { op: 'share', over: vault, who: { signer: world.recovery }, level: 'Owner', what: 'everything' };
		if (vault === world.mine && backs != null) asks.backUp = { op: 'back_up', on: !backs };
		if (keepOp) asks.keep = $state.snapshot(keepOp);
		const names = Object.keys(asks);
		let gone = false;
		may(api, actor, Object.values(asks)).then((answers) => {
			if (!gone) can = Object.fromEntries(names.map((n, i) => [n, answers[i]]));
		});
		return () => {
			gone = true;
		};
	});
	/** Whether the device would make `what` (`can`). @param {string} what */
	const lets = (what) => allowed(can[what]);
	/** Why the device won't make `what`: '' where it would, or hasn't said. @param {string} what */
	const barred = (what) => (can[what] && !allowed(can[what]) ? why(/** @type {any} */ (can[what])) : '');

	/** A device's name, to start a line: its card's, or what it is. @param {string} id */
	const deviceName = (id) => signerName(world, id, true);
	/** The keep shares over the vault that name device `id`. @param {string} id */
	const keepsOf = (id) =>
		rows.filter((r) => r.kind === 'keep' && r.who !== EVERYONE && 'device' in r.who && r.who.device === id);

	/** How this browser acts for the vault. */
	const actsFor = $derived.by(() => {
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

	/** Revokes share row `r`: a keep share as its issuer, any other as the acting vault. @param {ShareRow} r */
	const revoke = (r) =>
		api.run('Revoking', { op: 'revoke', share: r.id, as: r.kind === 'keep' ? (r.issuer ?? world.mine) : actor });

	/** @param {{ vault: string } | { signer: string }} o */
	const removeOwner = (o) =>
		api.run('Removing an owner', {
			op: 'revoke',
			vault,
			owner: 'vault' in o ? { vault: o.vault } : { signer: o.signer }
		});

	async function keep() {
		if (keepOp && (await api.run('Keeping', $state.snapshot(keepOp)))) keeping = null;
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
							disabled={busy || !naming.trim() || !lets('profile')}
							title={barred('profile') || undefined}
							onclick={async () =>
								(await api.run('Renaming', { op: 'profile', vault, name: naming?.trim() })) && (naming = null)}
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
					{#if v.via && v.owners.length > 1}
						{v.root ? 'its root, or ' : ''}
						<select class="field count" bind:value={threshold} aria-label="How many of its owners approve a change">
							{#each v.owners.map((_, i) => i + 1) as n (n)}<option value={n}>{n}</option>{/each}
						</select>
						of its {count(v.owners.length, 'owner')} to approve.
						{#if threshold !== v.threshold}
							<span class="row">
								<button
									class="btn primary"
									disabled={busy || !lets('threshold')}
									onclick={() => api.run('Changing who decides', { op: 'settings', vault, threshold })}>Save</button
								>
								<button class="btn quiet" onclick={() => (threshold = v.threshold)}>Cancel</button>
							</span>
							{#if barred('threshold')}<small class="soft">It can’t: {barred('threshold')}.</small>{/if}
						{/if}
					{:else}
						{v.root ? 'its root, or ' : ''}{v.threshold} of its {count(v.owners.length, 'owner')} to approve.
					{/if}
				</dd>
				<dt>{Here}</dt>
				<dd>{actsFor}</dd>
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
				<button
					class="btn"
					disabled={busy || !lets('backUp')}
					title={barred('backUp') || undefined}
					onclick={() => api.run(backs ? 'Turning backups off' : 'Turning backups on', { op: 'back_up', on: !backs })}
				>
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
					{@const row = ownerRow(o)}
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
						{#if row && allowed(row.revoke)}
							<button class="btn quiet danger" disabled={busy} onclick={() => removeOwner(o)}>Remove</button>
						{/if}
					</li>
				{/each}
			</ul>
			<p class="soft">{v.threshold} of {count(v.owners.length, 'owner')} approve{v.owners.length === 1 ? 's' : ''} a change.</p>
			{#if recoveryMissing && lets('recovery')}
				<p class="soft">
					The master recovery key is avenDB's way back into a vault whose passkeys are all lost, while avenDB
					is young. Your vault doesn't have it.
				</p>
				<button
					class="btn"
					disabled={busy}
					onclick={() =>
						api.run('Adding the master recovery key', {
							op: 'share',
							over: vault,
							who: { signer: world.recovery },
							level: 'Owner',
							what: 'everything'
						})}>Add the master recovery key</button
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
				{#each given as r (r.id)}
					{@const to = r.who !== EVERYONE && 'vault' in r.who ? r.who.vault : null}
					{@const name = r.who === EVERYONE ? 'Everyone' : nameOf(to ? byId.get(to) : undefined)}
					{@const hint = world.groups.find((g) => g.name === r.group)?.hint}
					<li>
						<span class="cap">
							{#if r.who === EVERYONE}
								<span class="chip">Public</span>
							{:else}
								<Mark vault={to ? byId.get(to) : undefined} size={28} />
							{/if}
							<span class="held">
								<span>
									<b class:mine={to === actor}>{name}</b> ·
									<span title={hint}>{rowLevel(r, world)}</span> · {rowWhat(r, world)}
									<small class="soft">
										{KEEPS[r.level] ? `· ${KEEPS[r.level]} ` : ''}· reaches
										{count(r.reaches, 'entry', 'entries')} now{r.issuer
											? ` · given by ${nameOf(byId.get(r.issuer))}`
											: ''}{r.parent ? ', through its own Owner share, which narrows it too' : ''}
									</small>
								</span>
								{#if r.what === null}
									<small class="soft">What it picks and allows is sealed from {here}.</small>
								{:else if !r.group && r.ops}
									<Ops ops={r.ops} />
								{/if}
							</span>
						</span>
						{#if allowed(r.revoke)}
							<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}>Revoke</button>
						{/if}
					</li>
				{/each}
			</ul>
		</article>

		<article class="card">
			<h3>Share some of it as {nameOf(as)}</h3>
			{#if sharesOn}
				<Share {world} {actor} {api} {busy} {vault} />
			{:else}
				<p class="soft">
					Nothing of {nameOf(v)} is shared with {nameOf(as)} as Owner: only the vault itself, or a vault it shares
					some of it with as Owner, shares it on.
				</p>
			{/if}
		</article>

		{#if mine?.devices.length}
			<article class="card">
				<h3>Kept on your devices</h3>
				<p class="soft">
					What each of your devices keeps of {nameOf(v)}: {roleGroup(world, 'keepWhole')} {KEEPS.keepWhole};
					{roleGroup(world, 'keepOpened')} {KEEPS.keepOpened}; {roleGroup(world, 'keepNever')} {KEEPS.keepNever}. A
					keep share grants nothing: it only says what one of your devices keeps.
				</p>
				<ul class="list keeps">
					{#each mine.devices as d (d.id)}
						<li>
							<span class="held">
								<span>
									<b>{d.me ? (d.name ?? thisName) : deviceName(d.id)}</b>
									{#if d.me}<span class="chip accent">{here}</span>{/if}
								</span>
								{#each keepsOf(d.id) as r (r.id)}
									<span class="kept">
										<span>{rowLevel(r, world)} · {rowWhat(r, world)}</span>
										{#if allowed(r.revoke)}
											<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}>Revoke</button>
										{/if}
									</span>
								{:else}
									<small class="soft">Nothing set: it syncs everything it gets.</small>
								{/each}
							</span>
							{#if keeping?.device !== d.id}
								<button
									class="btn quiet"
									disabled={busy}
									onclick={() => (keeping = { device: d.id, mode: 'whole', types: '', tag: '' })}>Set</button
								>
							{/if}
						</li>
						{#if keeping?.device === d.id}
							<li class="keep-form">
								<select class="field" bind:value={keeping.mode} aria-label="What it keeps">
									{#each MODES as [mode, level] (mode)}<option value={mode}>{roleGroup(world, level)}</option>{/each}
								</select>
								<select class="field" bind:value={keeping.types} aria-label="Of what">
									<option value="">everything</option>
									<option value="note">notes</option>
									<option value="todo">todos</option>
									<option value="file">files</option>
								</select>
								{#if keeping.types}
									<input class="field tag" placeholder="tagged (any)" bind:value={keeping.tag} aria-label="Tagged" />
								{/if}
								<button class="btn primary" disabled={busy || !lets('keep')} onclick={keep}>Keep</button>
								<button class="btn quiet" onclick={() => (keeping = null)}>Cancel</button>
								{#if barred('keep')}<small class="soft">It can’t: {barred('keep')}.</small>{/if}
							</li>
						{/if}
					{/each}
				</ul>
			</article>
		{/if}

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

	dd .row {
		margin-top: 0.35rem;
	}

	select.count {
		width: auto;
		padding: 0.1rem 0.3rem;
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

	.grants li,
	.keeps li {
		justify-content: space-between;
	}

	.keeps .kept {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.88rem;
	}

	.keeps .keep-form {
		justify-content: flex-start;
	}

	.keeps .tag {
		width: 8rem;
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
