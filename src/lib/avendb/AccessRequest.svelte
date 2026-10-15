<!--
	avenDB's consent screen, in the Mac app: each access request an agent device on this Mac left (avendb-device's
	`agent`), as a harness such as Claude Code or Codex starts its own device (agentClaude, agentCodex). It says who
	asks, by its device's name and key, what it asks for and why. The person picks the aven it joins, an aven their vault
	owns or a new one they name, as the aven is the identity and each harness one of its devices; then every vault they
	own or only some, a level each, Viewer, Suggester or Editor, which the aven gets as any share is given; and approves
	or denies. Approving a device that is no aven's yet takes one touch of their passkey; a share needs none. Access is
	the aven's, so every harness of it acts with it, and each vault's Sharing page shows it and takes it back.
-->
<script>
	import Icon from './Icon.svelte';
	import { list, nameOf } from './vaults.js';

	/**
	 * @typedef {import('./vaults.js').AccessRequestView} Request
	 * @typedef {{ over: string, level: string }} Grant
	 * @typedef {{ aven: string, naming: string, all: boolean, level: string, levels: Record<string, string> }} Answer
	 */
	/**
	 * @type {{ world: import('./vaults.js').WorldView, requests: Request[], busy: boolean,
	 *   ongrant: (name: string, device: string, aven: { id: string } | { name: string }, shares: Grant[]) => void,
	 *   ondeny: (name: string, device: string) => void }}
	 */
	let { world, requests, busy, ongrant, ondeny } = $props();

	/** The levels the page gives an aven, the weakest first, and what each lets it do in a vault. */
	const LEVELS = /** @type {const} */ (['Viewer', 'Suggester', 'Editor']);
	const DOES = /** @type {Record<string, string>} */ ({
		Viewer: 'reads it',
		Suggester: 'reads it, and writes only on proposals you merge',
		Editor: 'reads and changes it'
	});
	/** the picker's value for a new aven */
	const NEW = 'new';

	/** the vaults the person may give access to: their own, and those their vault owns */
	const ownable = $derived(
		world.vaults.filter((v) => v.kind !== 'aven' && (v.id === world.mine || v.via?.length))
	);
	/** the avens their vault owns, which a device may join */
	const avens = $derived(
		world.vaults.filter((v) => v.kind === 'aven' && v.owners.some((o) => 'vault' in o && o.vault === world.mine))
	);

	/** each request's answer as the person sets it, by the request */
	let answers = $state(/** @type {Record<string, Answer>} */ ({}));
	const key = (/** @type {Request} */ r) => `${r.device} ${r.level} ${r.why}`;
	/** the aven a device is one of the devices of already, if any @param {Request} r */
	const joined = (r) => avens.find((v) => v.devices.some((d) => d.id === r.device));

	/** A request's answer to start from: the aven it names, else the first the person's vault owns, else a new one
	 *  named after them; only the vaults it names, at the level it asks for. @param {Request} r @returns {Answer} */
	function start(r) {
		const named = avens.find((v) => nameOf(v) === r.aven);
		const mine = world.vaults.find((v) => v.id === world.mine);
		const naming = r.aven ?? `aven${nameOf(mine).replace(/\s+/g, '')}`;
		const aven = joined(r)?.id ?? named?.id ?? (r.aven ? NEW : (avens[0]?.id ?? NEW));
		const levels = Object.fromEntries(ownable.map((v) => [v.id, r.vaults.includes(v.id) ? r.level : '']));
		return { aven, naming, all: false, level: r.level, levels };
	}

	// each new request, answered as it asks until the person changes it
	$effect(() => {
		for (const r of requests) if (!answers[key(r)]) answers[key(r)] = start(r);
	});

	/** What answer `a` gives: a share of each vault picked at its level. @param {Answer} a @returns {Grant[]} */
	const shares = (a) =>
		a.all
			? ownable.map((v) => ({ over: v.id, level: a.level }))
			: ownable.filter((v) => a.levels[v.id]).map((v) => ({ over: v.id, level: a.levels[v.id] }));

	/** The aven answer `a` names, by its name. @param {Answer} a */
	const avenName = (a) => (a.aven === NEW ? a.naming.trim() : nameOf(avens.find((v) => v.id === a.aven)));

	/** What answer `a` gives, in words. @param {Answer} a */
	function says(a) {
		const given = shares(a);
		if (!given.length) return `${avenName(a) || 'The aven'} gets no vault: it sees only itself.`;
		const parts = LEVELS.filter((l) => given.some((g) => g.level === l)).map((level) => {
			const names = given.filter((g) => g.level === level).map((g) => nameOf(ownable.find((v) => v.id === g.over)));
			return `${level} on ${list(names)}: it ${DOES[level]}`;
		});
		return `${avenName(a) || 'The aven'} gets ${parts.join('; ')}.`;
	}

	/** @param {Request} r */
	function approve(r) {
		const a = answers[key(r)];
		ongrant(r.name, r.device, a.aven === NEW ? { name: a.naming.trim() } : { id: a.aven }, shares(a));
	}

	const short = (/** @type {string} */ id) => `${id.slice(0, 4)}…${id.slice(-4)}`;
</script>

{#each requests as r (key(r))}
	{@const a = answers[key(r)]}
	{@const member = joined(r)}
	{#if a}
		<section class="request" aria-label="{r.name} asks for access">
			<header>
				<Icon name="key" size={18} />
				<div>
					<b>{r.name} {member ? `asks for more access for ${nameOf(member)}` : 'wants to control an aven of yours'}</b>
					<small class="soft">An agent device on this Mac · its key <span class="mono">{short(r.device)}</span></small>
				</div>
			</header>
			{#if r.why}<blockquote>“{r.why}”</blockquote>{/if}
			<p class="soft">It asks for <b>{r.level}</b>: it {DOES[r.level]}.</p>

			{#if !member}
				<label class="row">
					<span>As a device of</span>
					<select class="field" bind:value={a.aven}>
						{#each avens as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
						<option value={NEW}>A new aven…</option>
					</select>
					{#if a.aven === NEW}
						<input class="field" bind:value={a.naming} aria-label="The new aven's name" placeholder="Its name" />
					{/if}
				</label>
			{/if}

			<fieldset>
				<legend>Which vaults</legend>
				<label><input type="radio" bind:group={a.all} value={true} /> All my vaults</label>
				<label><input type="radio" bind:group={a.all} value={false} /> Only select vaults</label>
			</fieldset>
			{#if a.all}
				<label class="row">
					<span>Every vault, at</span>
					<select class="field" bind:value={a.level}>
						{#each LEVELS as l (l)}<option value={l}>{l}</option>{/each}
					</select>
				</label>
			{:else}
				<ul>
					{#each ownable as v (v.id)}
						<li>
							<span>{nameOf(v)}</span>
							<select class="field" bind:value={a.levels[v.id]} aria-label="{nameOf(v)}'s level">
								<option value="">No access</option>
								{#each LEVELS as l (l)}<option value={l}>{l}</option>{/each}
							</select>
						</li>
					{/each}
				</ul>
			{/if}
			<p class="soft">
				{says(a)}
				{#if !member}One touch of your passkey adds this device to {avenName(a) || 'the aven'}.{/if}
				Each vault's Sharing page shows it and takes it back.
			</p>
			<div class="actions">
				<button
					class="btn primary"
					disabled={busy || (a.aven === NEW && !a.naming.trim())}
					onclick={() => approve(r)}>Approve</button
				>
				<button class="btn quiet" disabled={busy} onclick={() => ondeny(r.name, r.device)}>Deny</button>
			</div>
		</section>
	{/if}
{/each}

<style>
	.request {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0 0 1rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--accent);
		border-radius: 12px;
		background: #fff;
		font-size: 0.9rem;
	}

	.request header {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.request header div {
		display: flex;
		flex-direction: column;
	}

	.request p,
	.request blockquote {
		margin: 0;
	}

	.request blockquote {
		padding-left: 0.7rem;
		border-left: 3px solid var(--accent);
	}

	.request fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem 1.2rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.request legend {
		margin-bottom: 0.3rem;
		font-weight: 600;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.request ul {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.request li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
	}

	.mono {
		font-family: ui-monospace, monospace;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}
</style>
