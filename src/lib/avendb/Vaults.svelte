<!--
	Vaults: every vault avenDB's server, avenMAIA's device, knows and syncs, with its kind, and the one place where Maia
	City's admins say who holds which of its cap groups (Samuel 2026-10-20: "the SSOT truth UI" for invites, cancelling
	them, and moving travelers to citizens and back). In the layout every avenDB view has (./Frame.svelte): on the left
	the kinds of vault, each with how many the server knows, and the invites; in the middle the vaults of the kind
	picked, each with its role in Maia City, or the invites still open with a new one made there; on the right the vault
	picked, what the server keeps of it, and for a human vault its role, Traveler or Citizen, changed with one button.

	The server lists its vaults to an admin of Maia City alone, by a pass this device signs for that listing (the
	`api_pass` op, `POST /feed/vaults`, avendb/spec/AvenDB/Gate.lean G4), never by a key of the page's. The roles are
	the shares over Maia City that name a cap group, as the device's world shows them (./capgroups.js `groupHolders`;
	the `shares` op dry-runs a revocation of every row, too slow over a vault Maia City's size), changed as Maia City
	itself, through the person's vault that owns it: a share of the new group first, then the old one revoked
	(`moveOps`), so nobody stands with neither. An invite is a share to a one-time key ($lib/app/access.svelte.js
	`makeInvite`), cancelled by revoking it. The admin's own vault, Maia City's owners and every Admin holder keep their
	roles as they are: the app never changes them.
-->
<script>
	import { onMount } from 'svelte';
	import { access, invites as mayInvite, makeInvite, readAccess } from '$lib/app/access.svelte.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { ADMIN, CITIZEN, TRAVELER, groupHolders, moveOps } from './capgroups.js';
	import { feed } from './server.js';
	import { session } from './session.svelte.js';
	import { KINDS, nameOf, short } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, api: any, busy: boolean }} */
	let { world, api, busy } = $props();

	/** the service the device's pass names to list the server's vaults (avendb's `world::VAULTS_AUDIENCE`) */
	const AUDIENCE = 'avenDB vaults';
	/** the kinds, in the order the left side lists them */
	const ORDER = /** @type {const} */ (['human', 'coop', 'aven', 'device']);
	/** what the server keeps of a vault, as a person reads it */
	const KEEPS = /** @type {Record<string, [string, string]>} */ ({
		backup: ['Backed up', 'The server keeps an encrypted copy of the whole vault.'],
		relay: ['Relayed', 'The server passes the vault’s edits on to its devices.'],
		known: ['Known', 'The server knows the vault from another vault’s edits alone.']
	});

	/**
	 * A vault as the server lists it (`world::kept_vaults`).
	 * @typedef {{ id: string, kind: keyof typeof KINDS, name: string | null, owners: ({ vault: string } | { signer: string })[],
	 *   devices: number, entries: number, keeps: string }} Kept
	 */
	let kept = $state(/** @type {Kept[] | null} */ (null));
	let why = $state('');
	/** what the page waits on now, as the person reads it, '' for nothing */
	let step = $state('');
	/** How long the page waits on the device's pass, and on the server's answer, before it says which didn't answer (ms). */
	const WAIT = 20000;

	/** what the left side picked: a kind, every kind (''), or the invites */
	let view = $state(/** @type {'' | 'invites' | 'retired' | (typeof ORDER)[number]} */ (''));
	let query = $state('');
	/** the vault picked, by its id */
	let picked = $state('');
	/** the invite link made last, to hand one person */
	let invited = $state('');
	let copied = $state(false);

	const city = $derived(access.city);
	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const keptById = $derived(new Map((kept ?? []).map((v) => [v.id, v])));
	/** a vault's id, by what this device or the server knows: any other share's grantee is an invite's key */
	const known = $derived(new Set([...byId.keys(), ...keptById.keys()]));
	const holders = $derived(groupHolders(world.shares, city, access.list, (id) => known.has(id)));
	/** the vaults whose roles stay as they are: the person's own, Maia City, and the vaults that own it */
	const ours = $derived(
		new Set([world.mine, city, ...(byId.get(city)?.owners ?? []).flatMap((o) => ('vault' in o ? [o.vault] : []))])
	);

	/** A vault's name: as this device knows it, else as the server reads it, else its kind and id. @param {string} id */
	function name(id) {
		const v = byId.get(id);
		if (v?.name) return v.name;
		const k = keptById.get(id);
		return k?.name ?? (k ? `${KINDS[k.kind]} ${short(id)}` : nameOf(v));
	}

	/** The groups of Maia City vault `id` holds, by name. @param {string} id */
	const groupsOf = (id) => (holders.held.get(id) ?? []).map((h) => h.name);

	/** What vault `id` is in Maia City, as a person reads it: its owner, an admin, a citizen, a traveler, or nothing.
	 *  @param {string} id */
	function role(id) {
		if (id === city) return 'Maia City';
		if (ours.has(id)) return 'Owner';
		const g = groupsOf(id);
		return g.includes(ADMIN) ? ADMIN : g.includes(CITIZEN) ? CITIZEN : g.includes(TRAVELER) ? TRAVELER : '';
	}

	/** The vaults the server knows, or, until it says, those this device knows. */
	const all = $derived(
		/** @type {Kept[]} */ (
			kept ??
				world.vaults.map((v) => ({ id: v.id, kind: v.kind, name: v.name, owners: v.owners, devices: v.devices.length, entries: -1, keeps: '' }))
		)
	);
	/** A device vault no device acts for any more, as the studio's old workers once their devices were taken out
	 *  (#1010): avenDB never deletes a vault, so the server still knows it, but it syncs and acts no more. Listed apart.
	 *  @param {Kept} v */
	const retired = (v) => v.kind === 'device' && v.devices === 0;
	const live = $derived(all.filter((v) => !retired(v)));
	const gone = $derived(all.filter(retired));
	const count = $derived(Object.fromEntries(ORDER.map((k) => [k, live.filter((v) => v.kind === k).length])));
	const shown = $derived(
		(view === 'retired' ? gone : live).filter(
			(v) =>
				(!view || view === 'retired' || v.kind === view) &&
				(!query || `${name(v.id)} ${v.id}`.toLowerCase().includes(query.toLowerCase()))
		)
	);
	const vault = $derived(all.find((v) => v.id === picked));

	/** `promise`, or after `WAIT` an error saying that `who` didn't answer. @template T
	 *  @param {string} who @param {Promise<T>} promise @returns {Promise<T>} */
	function within(who, promise) {
		/** @type {ReturnType<typeof setTimeout> | undefined} */
		let timer;
		const late = new Promise((_, no) => {
			timer = setTimeout(() => no(new Error(`${who} didn’t answer in ${WAIT / 1000} seconds.`)), WAIT);
		});
		return /** @type {Promise<T>} */ (Promise.race([promise, late])).finally(() => clearTimeout(timer));
	}

	/** Reads the server's vaults with a pass this device signs for it, each step given `WAIT` to answer. */
	async function load() {
		if (session.phase !== 'open' || step) return;
		why = '';
		try {
			step = 'Asking this device for a pass';
			const got = await within('This device', session.ask({ op: 'api_pass', audience: AUDIENCE }));
			if (!got?.ok?.pass) throw new Error(got?.why || 'This device made no pass.');
			step = 'Asking the server for its vaults';
			const r = await within(
				'avenDB’s server',
				fetch(`${feed()}/vaults`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ pass: got.ok.pass })
				})
			);
			const body = await r.json().catch(() => ({}));
			if (r.status === 403) throw new Error('The server lists its vaults to an admin of Maia City alone.');
			if (!r.ok || !Array.isArray(body.vaults)) throw new Error(body.error || `The server answered ${r.status}.`);
			kept = body.vaults;
		} catch (e) {
			why = `${/** @type {Error} */ (e).message} Below are the vaults this device knows.`;
		} finally {
			step = '';
		}
	}

	/** Makes human vault `id` a `to` of Maia City, Traveler or Citizen. @param {string} id @param {'Traveler' | 'Citizen'} to */
	async function move(id, to) {
		const ops = moveOps(city, id, to, access.list, holders.held.get(id) ?? []);
		if (!ops.length) return;
		await api.runAll(`Making ${name(id)} a ${to.toLowerCase()}`, ops);
	}

	/** Makes an invite for one new human, a traveler of Maia City, its link copied to hand them. */
	async function invite() {
		[invited, copied] = ['', false];
		try {
			invited = await makeInvite(TRAVELER);
			copied = await navigator.clipboard?.writeText(invited).then(() => true, () => false);
		} catch (e) {
			session.error = /** @type {Error} */ (e).message;
		}
	}

	/** Cancels the invite of share `share`: revoked, its link opens nothing. @param {string} share */
	async function cancel(share) {
		await api.run('Cancelling the invite', { op: 'revoke', share, as: city });
	}

	onMount(() => {
		readAccess();
	});
	// once avenDB is open: the roles and invites are the device's world's own shares, read as it changes
	let read = false;
	$effect(() => {
		if (session.phase !== 'open' || read) return;
		read = true;
		load();
	});
</script>

{#snippet shelf()}
	<input class="nav-search" type="search" placeholder="Find a vault" aria-label="Find a vault" bind:value={query} />
	<h3 class="nav-group">The server’s vaults</h3>
	<button class="nav-item" class:on={view === ''} aria-pressed={view === ''} data-pick onclick={() => (view = '')}
		><Icon name="vault" size={16} /><span>All vaults</span><small>{live.length}</small></button
	>
	{#each ORDER as k (k)}
		<button class="nav-item" class:on={view === k} aria-pressed={view === k} data-pick onclick={() => (view = k)}
			><Icon name={k === 'human' ? 'users' : k === 'device' ? 'key' : 'database'} size={16} /><span>{KINDS[k]}s</span><small
				>{count[k]}</small
			></button
		>
	{/each}
	{#if gone.length}
		<button class="nav-item" class:on={view === 'retired'} aria-pressed={view === 'retired'} data-pick onclick={() => (view = 'retired')}
			><Icon name="trash" size={16} /><span>Retired</span><small>{gone.length}</small></button
		>
	{/if}
	<h3 class="nav-group">Maia City</h3>
	<button class="nav-item" class:on={view === 'invites'} aria-pressed={view === 'invites'} data-pick onclick={() => (view = 'invites')}
		><Icon name="share" size={16} /><span>Open invites</span><small>{holders.invites.length}</small></button
	>
{/snippet}

{#snippet about()}
	{#if vault}
		{@const v = vault}
		{@const r = role(v.id)}
		<header class="about-head">
			<small>{KINDS[v.kind]}</small>
			<h3>{name(v.id)}</h3>
		</header>
		<h4 class="side-head">On the server</h4>
		<dl class="facts">
			<dt>Id</dt>
			<dd class="mono" title={v.id}>{short(v.id)}</dd>
			<dt>Kind</dt>
			<dd>{KINDS[v.kind]}</dd>
			{#if v.keeps}
				<dt>Kept</dt>
				<dd title={KEEPS[v.keeps]?.[1]}>{KEEPS[v.keeps]?.[0] ?? v.keeps}</dd>
			{/if}
			{#if v.entries >= 0}
				<dt>Entries</dt>
				<dd>{v.entries}</dd>
			{/if}
			<dt>Devices</dt>
			<dd>{v.devices}{#if retired(v)} <span class="soft">· retired: it syncs and acts no more, and avenDB keeps its history</span>{/if}</dd>
			<dt>Owners</dt>
			<dd>
				{#each v.owners as o, i ('vault' in o ? o.vault : o.signer)}
					{#if i}, {/if}{'vault' in o ? name(o.vault) : 'A key'}
				{:else}
					None
				{/each}
			</dd>
		</dl>
		{#if v.kind === 'human' && city}
			<h4 class="side-head">Role in Maia City</h4>
			<p class="now">{r ? `${r}` : 'No role yet'}</p>
			{#if ours.has(v.id)}
				<p class="soft note">{v.id === world.mine ? 'Your own' : 'An owner’s'} roles stay as they are.</p>
			{:else if r === ADMIN}
				<p class="soft note">An admin’s roles stay as they are here.</p>
			{:else if !mayInvite()}
				<p class="soft note">Only Maia City’s own devices change roles.</p>
			{:else}
				<div class="row">
					{#if r !== CITIZEN}
						<button class="btn primary" disabled={busy} onclick={() => move(v.id, CITIZEN)}>Make citizen</button>
					{/if}
					{#if r !== TRAVELER}
						<button class="btn" disabled={busy} onclick={() => move(v.id, TRAVELER)}>Make traveler</button>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}
{/snippet}

<Frame nav={shelf} aside={vault ? about : undefined} navLabel="The server’s vaults" asideLabel="The vault’s details" navIcon="vault" asideIcon="info">
	{#if view === 'invites'}
		<p class="lead soft">
			An invite makes one new human a traveler of Maia City. Its link holds a one-time key their vault claims as they sign
			up. Cancel one, and its link opens nothing.
		</p>
		{#if mayInvite()}
			<div class="row make">
				<button class="btn primary" disabled={busy} onclick={invite}><Icon name="plus" size={14} /> New traveler invite</button>
				
			</div>
			{#if invited}
				<label class="link">
					<span class="soft">{copied ? 'Copied. Hand it to one person:' : 'Hand this link to one person:'}</span>
					<input class="field invited" readonly value={invited} onfocus={(e) => e.currentTarget.select()} />
				</label>
			{/if}
		{:else}
			<p class="empty">Only Maia City’s own devices make and cancel invites.</p>
		{/if}
		{#if holders.invites.length}
			<table class="list">
				<thead><tr><th>Invite</th><th>Makes them</th><th>Made by</th><th></th></tr></thead>
				<tbody>
					{#each holders.invites as i (i.share)}
						<tr>
							<td class="mono" title={i.share}>{short(i.share)}</td>
							<td>{i.name}</td>
							<td>{i.issuer ? name(i.issuer) : ''}</td>
							<td class="end">
								{#if mayInvite()}<button class="btn quiet danger" disabled={busy} onclick={() => cancel(i.share)}>Cancel</button>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="empty">No invite is open: every one was claimed or cancelled.</p>
		{/if}
	{:else}
		<p class="lead soft">
			Every vault avenDB’s server knows and syncs, with its kind and its role in Maia City. Pick a human vault to make
			them a citizen or a traveler.
		</p>
		{#if why}<p class="error" role="alert">{why}</p>{/if}
		{#if step}<p class="soft">{step}…</p>{:else if why}<button class="btn quiet" onclick={load}>Ask the server again</button>{/if}
		{#if shown.length}
			<table class="list">
				<thead><tr><th>Vault</th><th>Kind</th><th>Role</th><th class="wide">Kept</th><th class="wide">Entries</th></tr></thead>
				<tbody>
					{#each shown as v (v.id)}
						{@const r = role(v.id)}
						<tr class:on={picked === v.id}>
							<td>
								<button class="pick" aria-pressed={picked === v.id} onclick={() => (picked = v.id)}>{name(v.id)}</button>
								<span class="mono soft">{short(v.id)}</span>
							</td>
							<td>{KINDS[v.kind]}</td>
							<td>{#if r}<span class="chip" class:ok={r === CITIZEN} class:accent={r === ADMIN || r === 'Owner'}>{r}</span>{/if}</td>
							<td class="wide">{KEEPS[v.keeps]?.[0] ?? ''}</td>
							<td class="wide">{v.entries >= 0 ? v.entries : ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if !step}
			<p class="empty">No vault of this kind{query ? ' by that name' : ''}.</p>
		{/if}
	{/if}
</Frame>

<style>
	.lead {
		max-width: 46rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.make {
		margin-bottom: 0.9rem;
	}

	.link {
		display: grid;
		gap: 0.3rem;
		max-width: 40rem;
		margin-bottom: 1.2rem;
		font-size: 0.8rem;
	}

	.list {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}

	.list th {
		padding: 0.4rem 0.6rem;
		border-bottom: 1px solid var(--edge);
		color: var(--soft);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-align: left;
		text-transform: uppercase;
	}

	.list td {
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid rgb(0 0 0 / 0.06);
		vertical-align: middle;
	}

	.list tbody tr:hover,
	.list tbody tr.on {
		background: rgb(0 0 0 / 0.035);
	}

	.list .end {
		text-align: right;
	}

	.pick {
		display: block;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0;
		font-size: 1.15rem;
		overflow-wrap: anywhere;
	}

	.side-head {
		margin: 1.3rem 0 0.5rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.3rem 0.8rem;
		margin: 0;
		font-size: 0.8rem;
	}

	.facts dt {
		opacity: 0.6;
	}

	.facts dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.now {
		margin: 0 0 0.5rem;
		font-weight: 600;
	}

	.note {
		margin: 0;
		font-size: 0.8rem;
	}

	@media (max-width: 640px) {
		.list .wide {
			display: none;
		}
	}
</style>
