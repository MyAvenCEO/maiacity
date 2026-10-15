<!--
	A vault's settings, as its aside lists them: About (what it is, who approves a change to it and how many of its
	owners, how this browser acts for it), Owners and devices (who owns it, what it owns, the devices that act for it,
	and for the person's own vault what each of their devices keeps, a full copy or a light one, this browser's name,
	linking the next device and forgetting this one), and Sharing, the one place that says who has the vault: each vault
	it is shared with, and Everyone where it is public, one line each, with its shares (level · what, and what each
	reaches now; shares on chosen entries folded into one line a level) and the devices of theirs it is on, each opening
	it or only keeping an encrypted copy; the one Share form; and what others share with the vault. All of it is the
	device's: its world (avendb-browser's `World`) and its list of the shares over the vault (the `shares` op), which
	says too whether the acting vault may revoke each; every other button shows only where the device answers a dry run
	of it (`may`), and every change goes out as one op, acting for the acting vault, which the rules check against what
	is shared with it.
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
		nameOf,
		roleGroup,
		rowLevel,
		rowWhat,
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
	/** in the Mac app, the harness whose agent device the page shows how to run, and that, as the device says */
	let harness = $state('claude');
	let running = $state(/** @type {{ device: string, command: string, claude: string | null } | null} */ (null));
	let copied = $state(false);
	$effect(() => {
		const h = harness.trim();
		if (!/^[A-Za-z0-9_-]+$/.test(h)) return void (running = null);
		api.agentCommand?.(h).then((/** @type {typeof running} */ r) => (running = r), () => (running = null));
	});
	/** Copies the line that runs the harness's agent device. */
	async function copyRunning() {
		await navigator.clipboard.writeText(running?.claude ?? running?.command ?? '');
		copied = true;
		setTimeout(() => (copied = false), 1400);
	}

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
	const held = $derived(world.shares.filter((c) => c.who === vault && c.over !== vault));
	/** A row's who: a vault's id, a signer's, a device's, or `"everyone"`. @param {ShareRow} r */
	const whoOf = (r) =>
		r.who === EVERYONE ? EVERYONE : 'vault' in r.who ? r.who.vault : 'signer' in r.who ? r.who.signer : r.who.device;
	/** The entries a share on chosen entries picks, or none for any other share. @param {ShareRow} r */
	const entriesOf = (r) => {
		const w = /** @type {any} */ (r.what);
		const one = w && typeof w === 'object' && Array.isArray(w.entry) && Object.keys(w).length === 1;
		return one ? /** @type {string[]} */ (w.entry) : [];
	};
	/**
	 * Who has the vault, one each: the vault itself and the vaults that own it, which hold all of it, then each vault
	 * and Everyone a share in force goes to, with its shares. Its shares on chosen entries fold into one line a level,
	 * so entries shared one by one don't fill the page.
	 * @typedef {{ id: string, owner: string, grants: ShareRow[], chosen: Map<string, ShareRow[]> }} Person
	 */
	const people = $derived.by(() => {
		/** @type {Map<string, Person>} */
		const by = new Map();
		for (const o of owners)
			by.set(o.id, { id: o.id, owner: o.id === vault ? 'the vault itself' : 'owns it', grants: [], chosen: new Map() });
		for (const r of given) {
			const id = whoOf(r);
			/** @type {Person} */
			const p = by.get(id) ?? { id, owner: '', grants: [], chosen: new Map() };
			if (entriesOf(r).length) {
				const level = rowLevel(r, world);
				p.chosen.set(level, [...(p.chosen.get(level) ?? []), r]);
			} else p.grants.push(r);
			by.set(id, p);
		}
		return [...by.values()];
	});
	/**
	 * The devices that get some of the vault, by the vault they get it through, as the device's world says: whether
	 * each opens what it gets, or only keeps an encrypted copy.
	 */
	const getters = $derived.by(() => {
		/** @type {Map<string, Map<string, import('./vaults.js').Syncing>>} */
		const by = new Map();
		for (const x of world.audiences.filter((x) => x.vault === vault))
			for (const d of x.syncs) {
				const of = by.get(d.through) ?? new Map();
				const had = of.get(d.device);
				of.set(d.device, had ? { ...had, opens: had.opens || d.opens } : d);
				by.set(d.through, of);
			}
		return by;
	});
	/**
	 * What a device does with the entries it gets: opens them, or, where it doesn't, keeps an encrypted copy (Backup) or
	 * only connects (Relay), by the role the device's world names; else only that it opens none of them.
	 * @param {import('./vaults.js').Syncing} d
	 */
	const gets = (d) => (d.opens ? 'opens it' : ((d.level && KEEPS[d.level]) ?? 'opens none of it'));

	/** whether the Share form is open on the Sharing page */
	let adding = $state(false);
	let renaming = $state(/** @type {string | null} */ (null));
	let naming = $state(/** @type {string | null} */ (null));
	/** how many of its owners a change needs, as the person picks it */
	let threshold = $state(0);
	/** the vault picked to become an owner too: a human or coop vault this device knows that doesn't own it yet */
	let newOwner = $state('');
	const ownable = $derived(
		world.vaults.filter(
			(x) => x.id !== vault && x.kind !== 'aven' && !v.owners.some((o) => 'vault' in o && o.vault === x.id)
		)
	);
	/** Makes vault `id` an owner of this one too, as its owners approve. @param {string} id */
	const addOwner = (id) =>
		api.run(`Making ${nameOf(byId.get(id))} an owner`, {
			op: 'share',
			over: vault,
			who: { vault: id },
			level: 'Owner',
			what: 'everything',
			as: actor
		});
	const needs = $derived(v.threshold);
	$effect.pre(() => {
		threshold = needs;
	});
	/** Whether avenDB's server backs up the person's vault (true), only relays for it (false), or holds no cap (null). */
	const backs = $derived(world.backsUp);

	/**
	 * What the device would make, as it answers a dry run of each (`may`): the vault's name (`profile`), how many owners
	 * a change needs (`threshold`), the master recovery key as an owner (`recovery`), backups on or off (`backUp`), and
	 * what a device of the vault keeps (`copy`): `true`, `{ approve }` where the vault's owners approve it, or why not.
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
		const other = v.devices.find((d) => !d.me) ?? v.devices[0];
		if (vault === world.mine && other) asks.copy = { op: 'copy', device: other.id, full: other.copy !== 'full' };
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
	/** How this browser acts for the vault. */
	const actsFor = $derived.by(() => {
		if (!v.via) return 'It doesn’t act for it: it only knows it from what it syncs.';
		if (!v.via.length) return 'It is one of its devices, and acts for it directly.';
		const chain = v.via.map((o) => nameOf(byId.get(o)));
		return `It acts for it through ${list(chain)}, which ${v.via.length === 1 ? 'owns it' : 'own it in turn'}.`;
	});

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

	/**
	 * Sets what device `d` keeps of every vault it syncs: a full copy, or a light one (`copy`).
	 * @param {import('./vaults.js').DeviceView} d @param {boolean} full
	 */
	const keepCopy = (d, full) =>
		api.run(full ? 'Keeping a full copy' : 'Keeping a light copy', { op: 'copy', device: d.id, full });
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
				Every edit carries an SLH-DSA signature, and only that signature counts: a passkey's WebAuthn assertion beside
				it only shows a person was there. Keys are sealed with X-Wing and Classic McEliece, every connection agrees its
				keys with X25519MLKEM768, and every id is a BLAKE3 hash.
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
			{#if v.kind !== 'human' && actor === vault && ownable.length}
				<div class="add-owner">
					<select class="field" bind:value={newOwner} aria-label="A vault to make an owner too">
						<option value="">A vault to make an owner too…</option>
						{#each ownable as x (x.id)}<option value={x.id}>{nameOf(x)} · {KINDS[x.kind]}</option>{/each}
					</select>
					<button class="btn" disabled={busy || !newOwner} onclick={() => addOwner(newOwner).then(() => (newOwner = ''))}
						>Add as owner</button
					>
				</div>
				<p class="soft">
					A new owner acts for it as you do. To hand it over, add the new owner first, then remove the old one.
				</p>
			{/if}
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
							{#if vault === world.mine}
								<span class="copy" role="group" aria-label="What it keeps">
									<button
										class="btn quiet"
										class:on={d.copy === 'full'}
										aria-pressed={d.copy === 'full'}
										disabled={busy || !lets('copy') || d.copy === 'full'}
										onclick={() => keepCopy(d, true)}>Full copy</button
									>
									<button
										class="btn quiet"
										class:on={d.copy !== 'full'}
										aria-pressed={d.copy !== 'full'}
										disabled={busy || !lets('copy') || d.copy === 'light'}
										onclick={() => keepCopy(d, false)}>Light</button
									>
								</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
			{#if vault === world.mine && v.devices.length}
				<p class="soft">
					A full copy keeps every entry and every file of every vault the device syncs, so it works offline and is one
					more backup. A light one keeps every entry, and a file only once it is opened there.
				</p>
			{/if}
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
			{#if sockets}
				<article class="card">
					<h3>Agents on {here}</h3>
					<p class="soft">
						An aven is an identity your vault owns; agent harnesses control it, each as an agent device with a key of its
						own: Claude Code as agentClaude, Codex as agentCodex, and so on. Once a harness runs its device, this page asks
						you which aven it joins and which vaults that aven may work in. It reads your files from this Mac's one
						store, so nothing is kept twice.
					</p>
					<label class="harness">
						<span>Harness</span>
						<input class="field" bind:value={harness} aria-label="The harness's name" placeholder="claude" />
					</label>
					{#if running}
						<p class="soft">
							{running.claude
								? `Run this line once in a terminal: Claude Code then starts ${running.device} in every folder.`
								: `Give this command to the harness's MCP settings, as the server it starts: ${running.device}.`}
						</p>
						<input
							class="field code"
							readonly
							value={running.claude ?? running.command}
							onfocus={(e) => e.currentTarget.select()}
						/>
						<button class="btn quiet" onclick={copyRunning}>{copied ? 'Copied' : 'Copy the line'}</button>
					{/if}
				</article>
			{/if}
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
			<div class="row top">
				<h3>Who has {nameOf(v)}</h3>
				{#if sharesOn}
					<button class="btn" class:primary={!adding} onclick={() => (adding = !adding)}>
						{adding ? 'Close' : 'Share'}
					</button>
				{/if}
			</div>
			<p class="soft">
				Each vault it is shared with, and Everyone where it is public: at what level, on what, and on which of their
				devices it is. A share on a type or a tag reaches what matches it now and later. A note or a todo shares the
				same way, from its own Share button.{sharesOn
					? ''
					: ` Only ${nameOf(v)} itself, or a vault it shares some of it with as Owner, shares it on.`}
			</p>
			{#if adding}
				<div class="adding"><Share {world} {actor} {api} {busy} {vault} ondone={() => (adding = false)} /></div>
			{/if}
			<ul class="list people">
				{#each people as p (p.id)}
					{@const pv = p.id === EVERYONE ? undefined : byId.get(p.id)}
					{@const on = [...(getters.get(p.id)?.values() ?? [])]}
					<li>
						{#if p.id === EVERYONE}<span class="chip">Public</span>{:else}<Mark vault={pv} size={28} />{/if}
						<div class="person">
							<span>
								<b class:mine={p.id === actor}>{p.id === EVERYONE ? 'Everyone' : nameOf(pv)}</b>
								{#if p.owner}<small class="soft">· {p.owner}</small>{/if}
							</span>
							<ul class="theirs">
								{#if p.owner}<li><span>{roleGroup(world, 'owner')} · Everything</span></li>{/if}
								{#each p.grants as r (r.id)}
									{@const hint = world.groups.find((g) => g.name === r.group)?.hint}
									<li>
										<span class="held">
											<span>
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
										{#if allowed(r.revoke)}
											<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}>Revoke</button>
										{/if}
									</li>
								{/each}
								{#each [...p.chosen] as [level, rs] (level)}
									<li>
										<details class="chosen">
											<summary>{level} · {count(rs.length, 'chosen entry', 'chosen entries')}</summary>
											<ul>
												{#each rs as r (r.id)}
													<li>
														<span>{list(entriesOf(r).map((e) => titleOf(world, e)))}</span>
														{#if allowed(r.revoke)}
															<button class="btn quiet danger" disabled={busy} onclick={() => revoke(r)}>Revoke</button>
														{/if}
													</li>
												{/each}
											</ul>
										</details>
									</li>
								{/each}
							</ul>
							{#if on.length}
								<span class="on">
									<small class="soft">On</small>
									{#each on as d (d.device)}
										<span class="chip" class:ok={d.opens} title={gets(d)}>{deviceName(d.device)}</span>
									{/each}
								</span>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		</article>

		<article class="card wide">
			<h3>What others share with {nameOf(v)}</h3>
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

	.add-owner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}

	.add-owner .field {
		flex: 1 1 14rem;
		min-width: 0;
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

	.grants li {
		justify-content: space-between;
	}

	.top {
		justify-content: space-between;
	}

	.adding {
		margin: 0.6rem 0 0.8rem;
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fbfaf7;
	}

	.people > li {
		align-items: flex-start;
	}

	.person {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	/* a person's shares, under their name */
	.theirs {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
	}

	.theirs > li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.2rem 0;
	}

	.chosen summary {
		cursor: pointer;
	}

	.chosen ul {
		margin: 0.3rem 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.chosen li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.15rem 0;
	}

	.on {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}

	/* what a device keeps: a full copy or a light one */
	.harness {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.6rem;
	}

	.copy {
		display: inline-flex;
		margin-left: auto;
		border: 1px solid var(--edge);
		border-radius: 999px;
		overflow: hidden;
	}

	.copy .btn {
		border-radius: 0;
		font-size: 0.82rem;
	}

	.copy .btn.on {
		background: var(--accent);
		color: #fff;
		opacity: 1;
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

	.key {
		display: inline-grid;
		place-items: center;
		width: 28px;
		height: 28px;
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
</style>
