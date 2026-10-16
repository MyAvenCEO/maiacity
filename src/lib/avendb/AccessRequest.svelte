<!--
	avenDB's consent screen, in the Mac app: each access request an agent device on this Mac left (avendb-device's
	`agent`), as a harness such as Claude Code or Codex starts its own device (agentClaude, agentCodex). It says who
	asks, by its device's name and key, what it asks for and why. An agent always joins the person's one aven, the aven
	vault their vault owns: as a device vault of its own under it, its device in it, which holds sub caps, shares that
	rest on the aven's own, so it never gets more than the aven holds. Where their vault owns no aven yet, the person
	names it, and approving founds it. Then they pick the vaults it works in, a level each, Viewer, Suggester or Editor:
	every vault they own, or only some, never an aven or a device vault, which act for their one owner alone (the kind
	table's `most`); and each vault that shared with the aven, as a coop that hired it, up to the aven's own level there.
	They approve or deny. Approving an agent that has no device vault yet takes one touch of their passkey; a share
	needs none. Each vault's Sharing page shows what the agent holds and takes it back, and revoking the aven's share
	ends the agent's too.

	It rises as a sheet from the foot of the page, as the passkey's does (./Signing.svelte), one request at a time, with
	pills to pick from rather than the browser's own selects and radios. "Later" puts it away until the page is opened
	again; the request stays until it is answered.
-->
<script>
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { avenOf, list, nameOf, oneOwner, order } from './vaults.js';

	/**
	 * @typedef {import('./vaults.js').AccessRequestView} Request
	 * @typedef {{ over: string, level: string }} Grant
	 * @typedef {{ naming: string, all: boolean, level: string, levels: Record<string, string> }} Answer
	 */
	/**
	 * @type {{ world: import('./vaults.js').WorldView, requests: Request[], busy: boolean,
	 *   ongrant: (name: string, device: string, shares: Grant[], avenName: string) => void,
	 *   ondeny: (name: string, device: string) => void }}
	 */
	let { world, requests, busy, ongrant, ondeny } = $props();

	/** The levels the page gives an agent, the weakest first, and what each lets it do in a vault. */
	const LEVELS = /** @type {const} */ (['Viewer', 'Suggester', 'Editor']);
	const DOES = /** @type {Record<string, string>} */ ({
		Viewer: 'reads it',
		Suggester: 'reads it, and writes only on proposals you merge',
		Editor: 'reads and changes it'
	});

	const mine = $derived(world.vaults.find((v) => v.id === world.mine));
	/** the person's one aven, which every agent joins: none until their first agent founds it */
	const aven = $derived(avenOf(world));
	/** the vaults the person may give access to: their own, and those their vault owns, none that acts for its one
	 *  owner alone */
	const ownable = $derived(
		world.vaults.filter((v) => (v.id === world.mine || v.via?.length) && !oneOwner(world, v.kind))
	);
	/**
	 * The vaults that shared with the aven, as a coop that hired it, besides the person's own: each with the levels the
	 * agent may get there, those the aven's own shares there allow: up to its built-in group where it is one of
	 * `LEVELS`, else up to its level.
	 */
	const hired = $derived.by(() => {
		if (!aven) return [];
		/** @type {Map<string, Set<string>>} */
		const by = new Map();
		const levelOf = (/** @type {string} */ l) => world.groups.find((g) => g.name === l && !g.everyone)?.level;
		for (const c of world.shares) {
			if (c.who !== aven.id || !c.reads || c.over === aven.id || ownable.some((v) => v.id === c.over)) continue;
			const at = LEVELS.indexOf(/** @type {any} */ (c.group));
			const up = at >= 0 ? LEVELS.slice(0, at + 1) : LEVELS.filter((l) => order(levelOf(l) ?? '') >= order(c.level));
			by.set(c.over, new Set([...(by.get(c.over) ?? []), ...up]));
		}
		/** @type {{ v: import('./vaults.js').VaultView, levels: string[] }[]} */
		const out = [];
		for (const [id, up] of by) {
			const v = world.vaults.find((x) => x.id === id);
			const levels = LEVELS.filter((l) => up.has(l));
			if (v && levels.length) out.push({ v, levels });
		}
		return out;
	});

	/** each request's answer as the person sets it, by the request */
	let answers = $state(/** @type {Record<string, Answer>} */ ({}));
	const key = (/** @type {Request} */ r) => `${r.device} ${r.level} ${r.why}`;
	/** the agent's device vault, where its device is one already @param {Request} r */
	const joined = (r) => world.vaults.find((v) => v.id !== world.mine && v.devices.some((d) => d.id === r.device));

	/** A request's answer to start from: a new aven named after the person, where they have none; only the vaults it
	 *  names, at the level it asks for, or in a vault that hired the aven at most the aven's own. @param {Request} r
	 *  @returns {Answer} */
	function start(r) {
		const naming = `aven${nameOf(mine).replace(/\s+/g, '')}`;
		const levels = Object.fromEntries(ownable.map((v) => [v.id, r.vaults.includes(v.id) ? r.level : '']));
		for (const h of hired) {
			const asked = r.vaults.includes(h.v.id);
			levels[h.v.id] = !asked ? '' : h.levels.includes(r.level) ? r.level : (h.levels.at(-1) ?? '');
		}
		return { naming, all: false, level: r.level, levels };
	}

	// each new request, answered as it asks until the person changes it
	$effect(() => {
		for (const r of requests) if (!answers[key(r)]) answers[key(r)] = start(r);
	});

	/** What answer `a` gives: a share of each vault picked at its level, those of the vaults that hired the aven
	 *  besides "All my vaults". @param {Answer} a @returns {Grant[]} */
	const shares = (a) => [
		...(a.all
			? ownable.map((v) => ({ over: v.id, level: a.level }))
			: ownable.filter((v) => a.levels[v.id]).map((v) => ({ over: v.id, level: a.levels[v.id] }))),
		...hired.filter((h) => a.levels[h.v.id]).map((h) => ({ over: h.v.id, level: a.levels[h.v.id] }))
	];

	/** The aven answer `a` joins, by its name: the person's one, else the new one they name. @param {Answer} a */
	const avenName = (a) => (aven ? nameOf(aven) : a.naming.trim());

	/** What request `r` gets by answer `a`, in words. @param {Request} r @param {Answer} a */
	function says(r, a) {
		const given = shares(a);
		if (!given.length) return `${r.name} gets no vault: it sees only itself.`;
		const named = (/** @type {string} */ id) => nameOf(world.vaults.find((v) => v.id === id));
		const parts = LEVELS.filter((l) => given.some((g) => g.level === l)).map((level) => {
			const names = given.filter((g) => g.level === level).map((g) => named(g.over));
			return `${level} on ${list(names)}: it ${DOES[level]}`;
		});
		return `${r.name} gets ${parts.join('; ')}, each resting on ${avenName(a) || 'your aven'}’s own share.`;
	}

	/** @param {Request} r */
	function approve(r) {
		const a = answers[key(r)];
		ongrant(r.name, r.device, shares(a), avenName(a));
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

<!-- a vault's level in answer `ans`, as pills: none, then each of `levels` -->
{#snippet pills(
	/** @type {Answer} */ ans,
	/** @type {import('./vaults.js').VaultView} */ v,
	/** @type {readonly string[]} */ levels
)}
	<div class="vault">
		<span>{nameOf(v)}</span>
		<div class="levels" role="radiogroup" aria-label="{nameOf(v)}'s level">
			{#each levels as l (l)}
				<button
					role="radio"
					aria-checked={(ans.levels[v.id] ?? '') === l}
					class:on={(ans.levels[v.id] ?? '') === l}
					class:none={l === ''}
					onclick={() => (ans.levels[v.id] = l)}>{l || 'None'}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

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
					{member ? 'asks for more access' : 'wants to work for you'}
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

		{#if aven}
			<p class="joins">
				{member ? 'An agent of' : 'Joins'} your aven <b>{nameOf(aven)}</b>, as a device vault of its own under it, with
				only what {nameOf(aven)} holds.
			</p>
		{:else}
			<section>
				<h3>Your aven</h3>
				<p class="soft">
					Your one AI identity, which every agent of yours joins and coops hire. You have none yet: approving founds it.
				</p>
				<input class="name" bind:value={a.naming} aria-label="Your aven's name" placeholder="Its name" />
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
				{#each ownable as v (v.id)}{@render pills(a, v, PICKS)}{/each}
			{/if}
		</section>

		{#if aven && hired.length}
			<section>
				<h3>Shared with {nameOf(aven)}</h3>
				<p class="soft">Vaults that hired {nameOf(aven)}: {r.name} gets at most what {nameOf(aven)} holds there.</p>
				{#each hired as h (h.v.id)}{@render pills(a, h.v, ['', ...h.levels])}{/each}
			</section>
		{/if}

		<p class="says">
			{says(r, a)}
			{#if !member}
				One touch of your passkey adds {r.name}{aven ? '' : `, founding ${avenName(a) || 'your aven'} first`}.
			{/if}
			Each vault's Sharing page shows it and takes it back.
		</p>
		{#if !member && !r.online}
			<p class="offline">
				{r.name} isn't running right now. Joining takes its own device, which signs it too: open a Claude Code session (or
				the harness it belongs to), and Approve turns on.
			</p>
		{/if}
		<div class="actions">
			<button class="btn quiet" disabled={busy} onclick={() => (later = [...later, key(r)])}>Later</button>
			<button class="btn quiet danger" disabled={busy} onclick={() => ondeny(r.name, r.device)}>Deny</button>
			<button
				class="btn primary"
				disabled={busy || !avenName(a) || (!member && !r.online)}
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

	.switch button:hover,
	.levels button:hover {
		color: var(--accent);
	}

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

	.joins {
		line-height: 1.45;
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
