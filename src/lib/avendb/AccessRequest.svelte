<!--
	avenDB's consent screen, in the Mac app: each access request an agent device on this Mac left (avendb-device's
	`agent`), as a harness such as Claude Code or Codex starts its own device (agentClaude, agentCodex). It says who
	asks, by its device's name and key, what it asks for and why. The person picks the aven it joins, an aven their vault
	owns or a new one they name, as the aven is the identity and each harness one of its devices; then every vault they
	own or only some, a level each, Viewer, Suggester or Editor, which the aven gets as any share is given; and approves
	or denies. Approving a device that is no aven's yet takes one touch of their passkey; a share needs none. Access is
	the aven's, so every harness of it acts with it, and each vault's Sharing page shows it and takes it back.

	It rises as a sheet from the foot of the page, as the passkey's does (./Signing.svelte), one request at a time, with
	pills to pick from rather than the browser's own selects and radios. "Later" puts it away until the page is opened
	again; the request stays until it is answered.
-->
<script>
	import { fade, fly } from 'svelte/transition';
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

	/** the requests put away for later, by their key, until the page opens again */
	let later = $state(/** @type {string[]} */ ([]));
	/** the requests to answer now, the first of them shown */
	const open = $derived(requests.filter((r) => !later.includes(key(r)) && answers[key(r)]));
	const r = $derived(open[0]);
	const a = $derived(r && answers[key(r)]);
	const member = $derived(r && joined(r));
	/** the levels a vault's pills offer: none, then each level */
	const PICKS = /** @type {const} */ (['', ...LEVELS]);
</script>

{#if r && a}
	<div class="scrim" transition:fade={{ duration: 180 }}></div>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-labelledby="request-title"
		transition:fly={{ y: 640, duration: 280, opacity: 1 }}
	>
		<div class="grip" aria-hidden="true"></div>
		<header>
			<span class="badge" aria-hidden="true"><Icon name="key" size={18} /></span>
			<div>
				<h2 id="request-title">
					{r.name}
					{member ? `asks for more access for ${nameOf(member)}` : 'wants to control an aven of yours'}
				</h2>
				<p class="soft">
					An agent device on this Mac · its key <span class="mono">{short(r.device)}</span>
					{#if open.length > 1}· 1 of {open.length}{/if}
				</p>
			</div>
			<span class="state" class:on={member || r.online}>{member || r.online ? 'Running' : 'Not running'}</span>
		</header>

		{#if r.why}<blockquote>“{r.why}”</blockquote>{/if}
		<p class="soft">It asks for <b>{r.level}</b>: it {DOES[r.level]}.</p>

		{#if !member}
			<section>
				<h3>As a device of</h3>
				<div class="pills" role="radiogroup" aria-label="The aven it joins">
					{#each avens as v (v.id)}
						<button role="radio" aria-checked={a.aven === v.id} class:on={a.aven === v.id} onclick={() => (a.aven = v.id)}
							>{nameOf(v)}</button
						>
					{/each}
					<button role="radio" aria-checked={a.aven === NEW} class:on={a.aven === NEW} onclick={() => (a.aven = NEW)}
						><Icon name="plus" size={13} /> A new aven</button
					>
				</div>
				{#if a.aven === NEW}
					<input class="name" bind:value={a.naming} aria-label="The new aven's name" placeholder="Its name" />
				{/if}
			</section>
		{/if}

		<section>
			<h3>Which vaults</h3>
			<div class="switch" role="radiogroup" aria-label="Which vaults">
				<button role="radio" aria-checked={a.all} class:on={a.all} onclick={() => (a.all = true)}>All my vaults</button>
				<button role="radio" aria-checked={!a.all} class:on={!a.all} onclick={() => (a.all = false)}
					>Only some</button
				>
			</div>
			{#if a.all}
				<div class="vault">
					<span>Every vault</span>
					<div class="levels" role="radiogroup" aria-label="Every vault's level">
						{#each LEVELS as l (l)}
							<button role="radio" aria-checked={a.level === l} class:on={a.level === l} onclick={() => (a.level = l)}
								>{l}</button
							>
						{/each}
					</div>
				</div>
			{:else}
				{#each ownable as v (v.id)}
					<div class="vault">
						<span>{nameOf(v)}</span>
						<div class="levels" role="radiogroup" aria-label="{nameOf(v)}'s level">
							{#each PICKS as l (l)}
								<button
									role="radio"
									aria-checked={(a.levels[v.id] ?? '') === l}
									class:on={(a.levels[v.id] ?? '') === l}
									class:none={l === ''}
									onclick={() => (a.levels[v.id] = l)}>{l || 'None'}</button
								>
							{/each}
						</div>
					</div>
				{/each}
			{/if}
		</section>

		<p class="says">
			{says(a)}
			{#if !member}One touch of your passkey adds this device to {avenName(a) || 'the aven'}.{/if}
			Each vault's Sharing page shows it and takes it back.
		</p>
		{#if !member && !r.online}
			<p class="offline">
				{r.name} isn't running right now. Joining an aven takes its own device, which signs it too: open a Claude Code
				session (or the harness it belongs to), and Approve turns on.
			</p>
		{/if}
		<div class="actions">
			<button class="btn quiet" disabled={busy} onclick={() => (later = [...later, key(r)])}>Later</button>
			<button class="btn quiet danger" disabled={busy} onclick={() => ondeny(r.name, r.device)}>Deny</button>
			<button
				class="btn primary"
				disabled={busy || (a.aven === NEW && !a.naming.trim()) || (!member && !r.online)}
				onclick={() => approve(r)}>Approve</button
			>
		</div>
	</div>
{/if}

<style>
	/* under the passkey's own sheet, which rises over it as Approve asks for the passkey */
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgb(20 28 24 / 0.32);
	}

	.sheet {
		position: fixed;
		left: 50%;
		bottom: var(--nav-room, 0.5rem);
		z-index: 61;
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		box-sizing: border-box;
		width: min(36rem, calc(100% - 1rem));
		max-height: min(46rem, calc(100vh - var(--nav-room, 0.5rem) - 1rem));
		overflow-y: auto;
		transform: translateX(-50%);
		padding: 0.6rem 1.2rem 1.2rem;
		border-radius: 1.1rem;
		background: var(--card, #fff);
		box-shadow: 0 -12px 40px rgb(0 0 0 / 0.18);
		font-size: 0.9rem;
	}

	.grip {
		width: 2.6rem;
		height: 0.28rem;
		margin: 0 auto -0.2rem;
		border-radius: 999px;
		background: var(--edge);
	}

	header {
		display: flex;
		gap: 0.75rem;
		align-items: flex-start;
	}

	header > div {
		flex: 1;
		min-width: 0;
	}

	.badge {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}

	/* the title in the site's display face, as the passkey's sheet has it */
	h2 {
		margin: 0;
		font-size: 1.25rem;
		letter-spacing: -0.01em;
		line-height: 1.2;
	}

	/* the labels in the page's own type */
	h3 {
		margin: 0 0 0.45rem;
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--soft);
	}

	p {
		margin: 0;
	}

	header p {
		margin-top: 0.15rem;
		font-size: 0.82rem;
	}

	.soft {
		color: var(--soft);
	}

	.mono {
		font-family: ui-monospace, monospace;
	}

	.state {
		flex: none;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.78rem;
		background: #f6efe0;
		color: #8a6a2f;
	}

	.state.on {
		background: color-mix(in srgb, var(--ok) 14%, transparent);
		color: var(--ok);
	}

	blockquote {
		margin: 0;
		padding: 0.55rem 0.8rem;
		border-radius: 10px;
		background: #f7f5f0;
		font-style: italic;
	}

	/* choices as pills: the chosen one filled */
	.pills,
	.switch,
	.levels {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.switch,
	.levels {
		flex-wrap: nowrap;
		gap: 0;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #f4f1eb;
	}

	.switch {
		display: inline-flex;
	}

	.pills button,
	.switch button,
	.levels button {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 0;
		background: transparent;
		font: inherit;
		font-weight: 500;
		color: var(--soft);
		white-space: nowrap;
		cursor: pointer;
	}

	.pills button {
		padding: 0.38rem 0.85rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		color: inherit;
	}

	.switch button {
		padding: 0.3rem 0.9rem;
		border-radius: 999px;
		font-size: 0.85rem;
	}

	.levels button {
		padding: 0.24rem 0.65rem;
		border-radius: 999px;
		font-size: 0.78rem;
	}

	.pills button:hover,
	.switch button:hover,
	.levels button:hover {
		color: var(--accent);
	}

	.pills button.on,
	.switch button.on,
	.levels button.on {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.levels button.none.on {
		border-color: transparent;
		background: #fff;
		color: inherit;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
	}

	.name {
		box-sizing: border-box;
		width: 100%;
		margin-top: 0.5rem;
		padding: 0.55rem 0.85rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		outline: none;
	}

	.name:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
	}

	.vault {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.vault:last-child {
		border-bottom: 0;
	}

	.switch + .vault,
	.switch + .vault ~ .vault {
		margin-top: 0;
	}

	section .switch {
		margin-bottom: 0.35rem;
	}

	.vault > span {
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 500;
	}

	.says {
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: color-mix(in srgb, var(--accent) 7%, transparent);
		line-height: 1.45;
	}

	.offline {
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: #f6efe0;
		line-height: 1.45;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	@media (max-width: 520px) {
		.vault {
			flex-direction: column;
			align-items: flex-start;
			gap: 0.35rem;
		}
	}
</style>
