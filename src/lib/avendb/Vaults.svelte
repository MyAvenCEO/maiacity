<!--
	Vaults: every vault the device knows, as its own view has it, by its kind. A vault is an identity, like a smart
	account: a human vault is a person's, owned by their passkeys (its root and any backup), the only vault a signer
	ever owns, with its devices; a coop vault is owned by human and coop vaults and acts through their devices; an aven
	vault, an agent's such as avenCEO, is owned the same way, and its devices, its servers, act for it but never
	govern it. Each signer with a fingerprint to compare on two screens; each vault with its key's epoch and whether
	this device holds it, and the passkeys that sign a change to it. Where the device acts for a vault, it can change
	it: add or remove a device, add a backup passkey, invite or remove an owner vault, change the threshold, leave; and
	it can create a coop vault.
-->
<script>
	import { count } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   ask: (title: string, vaults: string[], action: Record<string, unknown>, extra?: string) => void,
	 *   signers: { id: string, name: string, kind: string, fingerprint: string }[]
	 * }}
	 */
	let { world, device, rev, act, ask, signers } = $props();

	/** @type {any} */
	let data = $state(null);
	let error = $state('');
	let newDevice = $state('');
	let coopName = $state('');
	/** @type {string[]} */
	let coopOwners = $state([]);
	let coopThreshold = $state(1);
	/** @type {Record<string, string>} */
	let inviting = $state({});
	/** @type {Record<string, number>} */
	let thresholds = $state({});

	$effect(() => {
		void rev;
		world.view({ view: 'vaults', on: device }).then(
			(v) => ([data, error] = [v, '']),
			(e) => (error = e.message)
		);
	});

	const vaults = $derived(/** @type {any[]} */ (data?.vaults ?? []));
	// the device's own human vault first
	const humans = $derived(vaults.filter((v) => v.kind === 'human').sort((a, b) => Number(b.mine) - Number(a.mine)));
	const coops = $derived(vaults.filter((v) => v.kind === 'coop'));
	const avens = $derived(vaults.filter((v) => v.kind === 'aven'));
	// what may own a coop or an aven vault: human and coop vaults, never an aven vault
	const owning = $derived(vaults.filter((v) => v.kind !== 'aven'));
	const mine = $derived(vaults.find((v) => v.id === data?.me));
	/** @param {string} id */
	const print = (id) => signers.find((s) => s.id === id)?.fingerprint ?? '';
	/** @param {string} id */
	const named = (id) => vaults.find((v) => v.id === id)?.name ?? 'a vault';
	/** @param {string} id */
	const kindOf = (id) => {
		const kind = vaults.find((v) => v.id === id)?.kind;
		return kind ? `${kind} vault` : 'a vault';
	};

	$effect(() => {
		// a coop starts with the device's own person among its owners
		if (mine && !coopOwners.length) coopOwners = [mine.id];
	});

	/** The owner of `coop` this device acts for: whoever leaves when it leaves. @param {any} coop */
	const myOwner = (coop) => coop.owners.find((/** @type {any} */ o) => o.kind === 'vault' && vaults.find((v) => v.id === o.id)?.mine);

	function addDevice() {
		const name = newDevice.trim();
		if (!name || !mine) return;
		ask(`Add “${name}” to ${mine.name}'s vault`, [mine.id], { do: 'add_device', name }, 'The new device derives its keys from the passkey, and countersigns.');
		newDevice = '';
	}

	function createCoop() {
		const name = coopName.trim();
		if (!name || !coopOwners.length) return;
		const threshold = Math.min(coopThreshold, coopOwners.length);
		ask(`Create the coop vault “${name}”`, coopOwners, { do: 'create_coop', name, owners: coopOwners, threshold }, `Each first owner vault consents: ${coopOwners.map(named).join(', ')}.`);
		coopName = '';
	}

	/** @param {string} id */
	const toggleOwner = (id) => (coopOwners = coopOwners.includes(id) ? coopOwners.filter((o) => o !== id) : [...coopOwners, id]);
</script>

{#if error}<p class="error">{error}</p>{/if}

{#if data}
	<h2 class="part">Human vaults</h2>
	<div class="cards">
		{#each humans as v (v.id)}
			<article class="card vault" class:me={v.mine}>
				<header class="row">
					<h3>{v.name}</h3>
					<span class="chip">human vault</span>
					{#if v.mine}<span class="chip accent">this device acts for it</span>{/if}
				</header>
				<dl>
					{#if v.root}
						<dt>Root</dt>
						<dd>{v.root.name}<small class="mono soft print">{print(v.root.id)}</small></dd>
					{/if}
					<dt>Owners</dt>
					<dd>
						{#each v.owners as o (o.id)}
							<div class="line">
								<span>{o.name}<small class="mono soft print">{print(o.id)}</small></span>
								{#if v.mine && v.owners.length > 1 && o.id !== v.root?.id}
									<button class="btn quiet danger" onclick={() => ask(`Remove ${o.name} from ${v.name}'s vault`, [v.id], { do: 'remove_owner', vault: v.id, owner: o.id })}>Remove</button>
								{/if}
							</div>
						{/each}
					</dd>
					<dt>Devices</dt>
					<dd>
						{#each v.devices as d (d.id)}
							<div class="line">
								<span><span class:here={d.id === device}>{d.name}</span><small class="mono soft print">{print(d.id)}</small></span>
								{#if v.mine}
									<button class="btn quiet danger" onclick={() => ask(`Remove ${d.name} from ${v.name}'s vault`, [v.id], { do: 'remove_device', device: d.id }, 'Its keys rotate, so it reads nothing written afterwards.')}>Remove</button>
								{/if}
							</div>
						{:else}
							<span class="soft">none</span>
						{/each}
					</dd>
					<dt>Key</dt>
					<dd>
						epoch {v.epoch}
						{#if v.holdsKey}<span class="chip ok">held here</span>{:else}<span class="chip">not held here</span>{/if}
					</dd>
					<dt>Signs changes</dt>
					<dd>{v.approvers.map((/** @type {any} */ s) => s.name).join(', ') || 'nobody this device knows'}</dd>
				</dl>
				{#if v.mine}
					<footer class="row">
						<input class="field" placeholder="A new device's name" bind:value={newDevice} onkeydown={(e) => e.key === 'Enter' && addDevice()} />
						<button class="btn" disabled={!newDevice.trim()} onclick={addDevice}>Add a device</button>
						<button class="btn" onclick={() => ask(`Add a backup passkey to ${v.name}'s vault`, [v.id], { do: 'add_passkey' }, 'A second owner of the vault, never its root: if the passkey is lost too, it adds a new one. It signs too, to consent.')}>Add a backup passkey</button>
					</footer>
				{/if}
			</article>
		{/each}
	</div>

	<h2 class="part">Coop vaults</h2>
	<div class="cards">
		{#each coops as v (v.id)}
			{@render governed(v)}
		{:else}
			<p class="empty">This device knows no coop vault.</p>
		{/each}

		<article class="card new">
			<h3>Create a coop vault</h3>
			<p class="soft">A coop vault is owned by vaults, human or coop, never by a passkey, and acts through their devices.</p>
			<input class="field" placeholder="The coop's name" bind:value={coopName} />
			<div class="owners">
				{#each owning as x (x.id)}
					<label><input type="checkbox" checked={coopOwners.includes(x.id)} onchange={() => toggleOwner(x.id)} /> {x.name} <span class="soft">{x.kind} vault</span></label>
				{/each}
			</div>
			<div class="row">
				<span class="soft">Approve with</span>
				<select class="field" bind:value={coopThreshold}>
					{#each coopOwners as _, i (i)}<option value={i + 1}>{i + 1}</option>{/each}
				</select>
				<span class="soft">of {count(coopOwners.length, 'owner')}</span>
				<button class="btn primary" disabled={!coopName.trim() || !coopOwners.length} onclick={createCoop}>Create</button>
			</div>
		</article>
	</div>

	<h2 class="part">Aven vaults</h2>
	<div class="cards">
		{#each avens as v (v.id)}
			{@render governed(v)}
		{:else}
			<p class="empty">This device knows no aven vault: nobody has claimed the server yet.</p>
		{/each}
	</div>
{/if}

<!-- a coop or an aven vault: the vaults that own it and how many must approve, and an aven vault's servers -->
{#snippet governed(/** @type {any} */ v)}
	<article class="card vault" class:me={v.mine}>
		<header class="row">
			<h3>{v.name}</h3>
			<span class="chip">{v.kind} vault</span>
			{#if v.mine}<span class="chip accent">this device acts for it</span>{/if}
		</header>
		<dl>
			<dt>Owners</dt>
			<dd>
				{#each v.owners as o (o.id)}
					<div class="line">
						<span>{o.name} <span class="soft">{kindOf(o.id)}</span></span>
						{#if v.mine && v.owners.length > 1}
							<button class="btn quiet danger" onclick={() => ask(`Remove ${o.name} from ${v.name}`, [v.id], { do: 'remove_owner', vault: v.id, owner: o.id }, `${v.name} rotates its keys, so the old owner reads nothing written afterwards.`)}>Remove</button>
						{/if}
					</div>
				{/each}
			</dd>
			<dt>Approve</dt>
			<dd>
				{v.threshold} of {count(v.owners.length, 'owner')}
				{#if v.mine && v.owners.length > 1}
					<span class="row inline">
						<select class="field" value={thresholds[v.id] ?? v.threshold} onchange={(e) => (thresholds[v.id] = Number(e.currentTarget.value))}>
							{#each v.owners as _, i (i)}<option value={i + 1}>{i + 1}</option>{/each}
						</select>
						<button class="btn" disabled={(thresholds[v.id] ?? v.threshold) === v.threshold} onclick={() => ask(`Make ${v.name} need ${thresholds[v.id]} of ${v.owners.length}`, [v.id], { do: 'set_threshold', vault: v.id, threshold: thresholds[v.id] })}>Change</button>
					</span>
				{/if}
			</dd>
			{#if v.kind === 'aven'}
				<dt>Servers</dt>
				<dd>
					{#each v.devices as d (d.id)}
						<div class="line">
							<span>{d.name}<small class="mono soft print">{print(d.id)}</small></span>
							{#if v.mine}
								<button class="btn quiet danger" onclick={() => ask(`Remove ${d.name} from ${v.name}`, [v.id], { do: 'remove_device', device: d.id }, 'Its keys rotate, so it reads nothing written afterwards.')}>Remove</button>
							{/if}
						</div>
					{:else}
						<span class="soft">none</span>
					{/each}
					<small class="soft">They act for it, and never govern it.</small>
				</dd>
			{/if}
			<dt>Key</dt>
			<dd>
				epoch {v.epoch}
				{#if v.holdsKey}<span class="chip ok">held here</span>{:else}<span class="chip">not held here</span>{/if}
			</dd>
			<dt>Signs changes</dt>
			<dd>{v.approvers.map((/** @type {any} */ s) => s.name).join(', ') || 'nobody this device knows'}</dd>
		</dl>
		{#if v.mine}
			<footer class="row">
				<select class="field" bind:value={inviting[v.id]}>
					<option value={undefined}>Invite an owner vault…</option>
					{#each owning.filter((x) => x.id !== v.id && !v.owners.some((/** @type {any} */ o) => o.id === x.id)) as x (x.id)}
						<option value={x.id}>{x.name} ({x.kind} vault)</option>
					{/each}
				</select>
				<button class="btn" disabled={!inviting[v.id]} onclick={() => ask(`Invite ${named(inviting[v.id])} to own ${v.name}`, [v.id, inviting[v.id]], { do: 'add_owner', vault: v.id, owner: inviting[v.id] }, `${v.name} approves, and the vault that joins consents.`)}>Invite</button>
				{#if myOwner(v)}
					<button class="btn danger" onclick={() => ask(`${myOwner(v).name} leaves ${v.name}`, [myOwner(v).id], { do: 'leave', vault: v.id }, 'An owner vault leaves on its own: its own passkeys approve.')}>Leave</button>
				{/if}
			</footer>
		{/if}
	</article>
{/snippet}

<style>
	h3 {
		margin: 0;
		font-size: 1.15rem;
	}

	.vault header {
		margin-bottom: 0.6rem;
	}

	.vault.me {
		border-color: var(--accent);
	}

	dl {
		display: grid;
		grid-template-columns: 6.8rem minmax(0, 1fr);
		gap: 0.35rem 0.6rem;
		margin: 0;
		font-size: 0.88rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
	}

	/* a name with its fingerprint beneath, and what can be done to it at the right */
	.line {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.line + .line {
		margin-top: 0.4rem;
	}

	.line .btn {
		padding: 0.1rem 0.5rem;
		font-size: 0.75rem;
	}

	.print {
		display: block;
		font-size: 0.72rem;
	}

	.here {
		font-weight: 600;
	}

	.inline {
		display: inline-flex;
		margin-left: 0.4rem;
	}

	footer {
		margin-top: 0.9rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--edge);
	}

	.new {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		border-style: dashed;
	}

	.new p {
		margin: 0;
		font-size: 0.86rem;
	}

	.owners {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 0.9rem;
		font-size: 0.86rem;
	}
</style>
