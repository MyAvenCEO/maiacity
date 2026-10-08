<!--
	Who may read, write or own an entry, or its whole space, by the device's own view, and why: the vault that founded the
	space, or a grant, with the grants it rests on up to the founder's. Every grant there, each revocable by whoever may;
	a new grant to any vault the device knows, or read for everyone; and the key: its epochs (a revocation rotates it),
	which devices hold each, and what the current one is sealed to.
-->
<script>
	import { short, when } from './ui.js';

	/**
	 * @type {{
	 *   world: import('./tile.js').World,
	 *   device: string,
	 *   rev: number,
	 *   act: (a: Record<string, unknown>) => Promise<any>,
	 *   ask: (title: string, vaults: string[], action: Record<string, unknown>, extra?: string) => void,
	 *   space: string,
	 *   entry: string
	 * }}
	 */
	let { world, device, rev, act, ask, space, entry } = $props();

	/** @type {'entry' | 'space'} */
	let scope = $state('entry');
	/** @type {any} */
	let data = $state(null);
	let error = $state('');
	let to = $state('');
	let role = $state('read');

	$effect(() => {
		void rev;
		const q = { view: 'access', on: device, space, entry: scope === 'entry' ? entry : null };
		world.view(q).then(
			(v) => ([data, error] = [v, '']),
			(e) => ([data, error] = [null, e.message])
		);
	});

	$effect(() => {
		if (to === 'everyone') role = 'read';
	});

	const where = $derived(scope === 'entry' ? { space, entry } : { space });
	/** @param {string} id */
	const vaultName = (id) => (id === 'everyone' ? 'everyone' : (data?.vaults.find((/** @type {any} */ v) => v.id === id)?.name ?? 'a vault'));

	function grant() {
		if (!to) return;
		const action = { do: 'grant', ...where, role, to };
		if (role === 'owner' && data?.grantsAs)
			ask(`Make ${vaultName(to)} an owner here`, [data.grantsAs.id], action, `Making an owner is a change to who governs it: ${data.grantsAs.name} approves.`);
		else act(action);
	}

	/** @param {any} g */
	const grantText = (g) => `${g.role} from ${g.issuer.name}`;
</script>

<div class="tabs">
	<button class:on={scope === 'entry'} onclick={() => (scope = 'entry')}>This entry</button>
	<button class:on={scope === 'space'} onclick={() => (scope = 'space')}>The whole space</button>
</div>

{#if error}<p class="error">{error}</p>{/if}

{#if data}
	<p class="soft">
		{data.founder.name} founded the space{data.public ? ', and everyone may read this' : ''}.
		{#if data.grantsAs}This device grants here as {data.grantsAs.name}.{:else}This device may grant nothing here.{/if}
	</p>

	<h3>Who may do what</h3>
	<table>
		<thead><tr><th>Vault</th><th>Role</th><th>Why</th></tr></thead>
		<tbody>
			{#each data.holders as h (h.vault.id)}
				<tr>
					<td>
						<b>{h.vault.name}</b>
						<span class="soft small">{h.kind === 'coop' ? 'a coop' : h.kind === 'server' ? "the server's vault" : "a person's vault"}</span>
						{#if h.mine}<span class="chip accent">this device acts for it</span>{/if}
					</td>
					<td><span class="chip" class:ok={h.role === 'owner'} class:accent={h.role === 'write'}>{h.role}</span></td>
					<td>
						{#each h.why as w, i (i)}
							<div>
								{#if w.founded}
									founded the space
								{:else}
									a grant of {grantText(w)} <span class="mono soft">{short(w.id)}</span>
									{#if w.chain.length}
										<span class="soft">, resting on {w.chain.map((/** @type {any} */ c) => `${c.role} from ${c.issuer.name}`).join(', resting on ')}</span>
									{/if}
								{/if}
							</div>
						{/each}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if data.public}<p class="soft small">And everyone, read only: it is public.</p>{/if}

	<h3>Grants</h3>
	{#if data.grants.length}
		<table>
			<thead><tr><th>Grant</th><th>To</th><th>Role</th><th>By</th><th>On</th><th></th></tr></thead>
			<tbody>
				{#each data.grants as g (g.id)}
					<tr>
						<td class="mono soft">{short(g.id)}</td>
						<td>{g.to.name}</td>
						<td>{g.role}</td>
						<td>{g.issuer.name}{g.chain.length ? ` (through ${g.chain[0].issuer.name}'s grant)` : ''}</td>
						<td class="soft">{g.scope === 'space' ? 'the space' : 'this entry'}{g.when ? ` · ${when(g.when)}` : ''}</td>
						<td><button class="btn quiet danger" onclick={() => act({ do: 'revoke', grant: g.id })}>Revoke</button></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{:else}
		<p class="soft small">No grants: only the founder's vault holds it.</p>
	{/if}

	<div class="row grant">
		<span class="soft">Give</span>
		<select class="field" bind:value={to}>
			<option value="">a vault…</option>
			{#each data.vaults as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
			<option value="everyone">everyone (read only)</option>
		</select>
		<select class="field" bind:value={role} disabled={to === 'everyone'}>
			<option value="relay">relay: carries it, can't open it</option>
			<option value="read">read</option>
			<option value="write">write</option>
			<option value="owner">owner</option>
		</select>
		<span class="soft">on {scope === 'entry' ? 'this entry' : 'the whole space'}</span>
		<button class="btn primary" disabled={!to} onclick={grant}>Grant</button>
		{#if !data.public}
			<button class="btn" onclick={() => act({ do: 'grant', ...where, role: 'read', to: 'everyone' })}>Make it public</button>
		{/if}
	</div>

	<h3>The key</h3>
	<p class="soft small">
		Epoch {data.epoch}: each revocation rotates it, and the new key is sealed only to whoever may still read. Sealed now to
		{data.sealedTo.join(', ') || 'nobody'}.
	</p>
	<table>
		<thead><tr><th>Epoch</th><th>Held by</th></tr></thead>
		<tbody>
			{#each [...data.keys].reverse() as k (k.epoch)}
				<tr>
					<td>{k.epoch}{k.epoch === data.epoch ? ' (now)' : ''}</td>
					<td>
						<div class="row">
							{#each k.holders as d (d.id)}<span class="chip">{d.name}</span>{:else}<span class="soft">no device</span>{/each}
						</div>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	h3 {
		margin: 1.4rem 0 0.5rem;
		font-size: 1.05rem;
	}

	table {
		width: 100%;
		max-width: 70rem;
		border-collapse: collapse;
		font-size: 0.86rem;
	}

	th,
	td {
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
		vertical-align: top;
	}

	th {
		font-weight: 500;
		color: var(--soft);
	}

	td .btn {
		padding: 0.15rem 0.6rem;
		font-size: 0.78rem;
	}

	.grant {
		margin-top: 0.9rem;
	}

	.small {
		font-size: 0.82rem;
	}
</style>
