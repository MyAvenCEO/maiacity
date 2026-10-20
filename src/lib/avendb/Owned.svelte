<!--
	The vaults a vault owns, one component for every parent, as Owners & devices shows them ($lib/avendb/Settings.svelte):
	first those wholly its own, of a kind that takes one owner alone (the kind table's `most`), each with its devices
	and the shares it holds, by name, over which vault and at what level, and under it the vaults it owns in turn that
	hold devices; then, in one line, the other vaults it owns. So it is "Agents" on an aven, whose agents are devices
	of it beside its server; "Its aven" on the seed's coop, Maia City, which owns avenMAIA (vaults.js's `seeded`); and
	"It owns" anywhere else. A legacy studio worker, a device vault the studio hired before the Mac worked straight in
	the vaults (#1010), shows only while it holds a device or a share, so that its Revoke stays at hand (`retired`).
	Remove and Revoke are the settings' own (`onremove`, `onrevoke`), and each shows only where the device answers a dry
	run of it (`may`): a device taken out of its vault as a lost one is, and a share given up by the vault that holds
	it, which ends every share resting on it. A standing grant, "all my vaults, now and later" (avendb's `world::STANDING`), shows as one
	line however many vaults it reached, and Revoke ends it for each of them (the `revoke` op's `standing`), so no vault
	founded later follows it. Its title, or none where it shows nothing, is `ownedTitle`, which the settings' left side
	lists it by.
-->
<script module>
	import { ownedBy, seeded } from './vaults.js';

	/**
	 * What Owners & devices calls the vaults vault `vault` owns: '' where it shows none, as on a vault that owns none,
	 * unless it is the person's own or an aven.
	 * @param {import('./vaults.js').WorldView} world @param {string} vault
	 */
	export function ownedTitle(world, vault) {
		const v = world.vaults.find((x) => x.id === vault);
		if (!v || (vault !== world.mine && v.kind !== 'aven' && !ownedBy(world, vault).length)) return '';
		if (vault === world.mine) return 'It owns';
		if (v.kind === 'aven') return 'Agents';
		return vault === seeded(world)[0]?.[0].id ? 'Its aven' : 'It owns';
	}
</script>

<script>
	import Mark from './Mark.svelte';
	import { allowed, may } from './ops.js';
	import {
		count,
		isStanding,
		KINDS,
		kindRules,
		levelName,
		nameOf,
		oneOwner,
		order,
		plainName,
		roleGroup,
		shareWhat,
		short
	} from './vaults.js';

	/** @typedef {import('./vaults.js').VaultView} VaultView */
	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, api: any, busy: boolean,
	 *   onrevoke: (share: string, as: string, standing?: boolean) => unknown,
	 *   onremove: (device: string, name: string, of: string) => unknown }}
	 */
	let { world, vault, api, busy, onrevoke, onremove } = $props();

	const byId = $derived(new Map(world.vaults.map((x) => [x.id, x])));
	const v = $derived(/** @type {VaultView} */ (byId.get(vault)));
	/** where each kind comes in the kind table, which orders them: an aven before the device vaults */
	const rank = (/** @type {string} */ kind) => (world.kinds ?? []).findIndex((k) => k.kind === kind);
	const owns = $derived(ownedBy(world, vault).sort((a, b) => rank(a.kind) - rank(b.kind)));
	/** the vaults wholly its own, which act for it alone, and the others it owns */
	const own = $derived(owns.filter((x) => oneOwner(world, x.kind) && !retired(x)));
	const others = $derived(owns.filter((x) => !oneOwner(world, x.kind)));
	/** The vaults vault `x` owns in turn that hold devices. @param {VaultView} x */
	const under = (x) => ownedBy(world, x.id).filter((y) => kindRules(world, y.kind)?.devices);
	/** The shares vault `x` holds in other vaults, the strongest first: those of a standing grant apart.
	 *  @param {VaultView} x */
	const held = (x) =>
		world.shares
			.filter((c) => c.who === x.id && c.over !== x.id && !isStanding(c.slice?.name))
			.sort((a, b) => order(a.level) - order(b.level));
	/**
	 * The standing grants vault `x` holds, "all my vaults, now and later", one each however many vaults it reached: by
	 * its name and whether each vault gives it itself or a vault passes it on, the share over the person's own vault
	 * first, the one Revoke names, and how many vaults it reached.
	 * @param {VaultView} x @returns {{ share: import('./vaults.js').CapView, level: string, reached: number }[]}
	 */
	const standing = (x) => {
		/** @type {Map<string, import('./vaults.js').CapView[]>} */
		const by = new Map();
		for (const c of world.shares.filter((c) => c.who === x.id && isStanding(c.slice?.name))) {
			const k = `${c.slice?.name} ${c.issuer === c.over ? '' : c.issuer}`;
			by.set(k, [...(by.get(k) ?? []), c]);
		}
		return [...by.values()].map((cs) => {
			const share = cs.find((c) => c.over === world.mine) ?? cs[0];
			return { share, level: share.group ?? plainName(share.slice?.name) ?? '', reached: cs.length };
		});
	};

	/** The name the studio's workers went by, each a device vault, before the Mac worked straight in the vaults
	 *  (#1010; studio/jobs/mac.js took their devices out). */
	const LEGACY_WORKER = 'Studio worker';
	/** A legacy studio worker, @param {VaultView} x */
	const legacy = (x) => x.kind === 'device' && x.name === LEGACY_WORKER;
	/** one with nothing left, no device and no share, which it leaves out @param {VaultView} x */
	const retired = (x) => legacy(x) && !x.devices.length && !held(x).length && !standing(x).length;

	/** an aven's agents, the seed coop's aven, what any other vault owns, or '' */
	const title = $derived(ownedTitle(world, vault));
	const lead = $derived(
		v.kind === 'aven'
			? `Each agent you approve on your Mac joins ${nameOf(v)} as a device beside its server, with a key of its own, and acts with ${nameOf(v)}’s rights. Remove one in its devices to end it.`
			: ''
	);

	/** every vault it shows with its devices and shares: those wholly its own, and those they own that hold devices */
	const listed = $derived(own.flatMap((x) => [x, ...under(x)]));
	/** Remove and Revoke as the device answers a dry run of each, by `device <vault> <id>` and `share <id>` */
	let can = $state(/** @type {Record<string, import('./vaults.js').Verdict>} */ ({}));
	$effect(() => {
		/** @type {[string, object][]} */
		const asks = listed.flatMap((x) => [
			...x.devices.map((d) => /** @type {[string, object]} */ ([`device ${x.id} ${d.id}`, { op: 'revoke', vault: x.id, device: d.id }])),
			...held(x).map((c) => /** @type {[string, object]} */ ([`share ${c.id}`, { op: 'revoke', share: c.id, as: x.id }])),
			...standing(x).map(
				({ share: c }) =>
					/** @type {[string, object]} */ ([`standing ${c.id}`, { op: 'revoke', share: c.id, standing: true }])
			)
		]);
		let gone = false;
		may(api, world.mine, asks.map(([, op]) => op)).then((answers) => {
			if (!gone) can = Object.fromEntries(asks.map(([k], i) => [k, answers[i]]));
		});
		return () => {
			gone = true;
		};
	});
	const lets = (/** @type {string} */ what) => allowed(can[what]);
</script>

<!-- a vault it owns: its mark, name and kind, its devices, and the shares it holds -->
{#snippet item(/** @type {VaultView} */ x)}
	<div class="head">
		<Mark vault={x} size={28} />
		<b>{nameOf(x)}</b>
		<span class="soft">{KINDS[x.kind] ?? x.kind}</span>
	</div>
	{#if legacy(x)}
		<p class="soft">Legacy: the studio no longer uses it, as the Mac runs its jobs as you. Revoke its shares and it leaves this list.</p>
	{/if}
	<ul class="rows">
		{#each x.devices.filter((d) => !d.next) as d (d.id)}
			{@const name = d.name ?? `${nameOf(x)}’s device`}
			<li>
				<span><span class="chip">Device</span> {name} <span class="soft mono">{short(d.id)}</span></span>
				{#if lets(`device ${x.id} ${d.id}`)}
					<button class="btn quiet danger" disabled={busy} onclick={() => onremove(d.id, name, x.id)}>Remove</button>
				{/if}
			</li>
		{/each}
		{#each standing(x) as g (g.share.id)}
			<li>
				<span>
					<b>{g.level}</b> · all your vaults, now and later
					<small class="soft"
						>· {count(g.reached, 'vault')} now{g.share.issuer !== g.share.over
							? ` · passed on by ${nameOf(byId.get(g.share.issuer))}`
							: ''}</small
					>
				</span>
				{#if lets(`standing ${g.share.id}`)}
					<button
						class="btn quiet danger"
						disabled={busy}
						title="Ends it for every vault it reached, and for every vault founded later"
						onclick={() => onrevoke(g.share.id, x.id, true)}>Revoke</button
					>
				{/if}
			</li>
		{/each}
		{#each held(x) as c (c.id)}
			{@const level = levelName(c, world)}
			{@const role = roleGroup(world, c.level)}
			<li>
				<span>
					<b>{level}</b>{c.group || level === role ? '' : ` (${role})`} · {shareWhat(c, world)} · of
					<b>{nameOf(byId.get(c.over))}</b>
					{#if c.parent && c.issuer !== c.over}<small class="soft">· passed on by {nameOf(byId.get(c.issuer))}</small>{/if}
				</span>
				{#if lets(`share ${c.id}`)}
					<button class="btn quiet danger" disabled={busy} onclick={() => onrevoke(c.id, x.id)}>Revoke</button>
				{/if}
			</li>
		{:else}
			{#if !standing(x).length}<li class="soft">No share in another vault: it sees only itself.</li>{/if}
		{/each}
	</ul>
{/snippet}

{#if title}
	<article class="card">
		<h3>{title}</h3>
		{#if lead}<p class="soft">{lead}</p>{/if}
		{#if own.length}
			<ul class="owned">
				{#each own as x (x.id)}
					{@const ys = under(x)}
					<li>
						{@render item(x)}
						{#if ys.length}
							<ul class="owned under" aria-label="{nameOf(x)}'s device vaults">
								{#each ys as y (y.id)}<li>{@render item(y)}</li>{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if others.length}
			<p class="others">
				{#if own.length}<small class="soft">It also owns</small>{/if}
				{#each others as x (x.id)}
					<span class="other"><Mark vault={x} size={22} /><b>{nameOf(x)}</b><small class="soft">{KINDS[x.kind]}</small></span>
				{/each}
			</p>
		{/if}
	</article>
{/if}

<style>
	h3 {
		margin: 0 0 0.4rem;
	}

	.card p {
		line-height: 1.5;
	}

	.owned {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.owned > li {
		padding: 0.5rem 0;
		border-bottom: 1px solid var(--edge);
	}

	.owned > li:last-child {
		border-bottom: 0;
	}

	/* an aven's agents, under it */
	.under {
		margin: 0.35rem 0 0 0.9rem;
		padding-left: 0.7rem;
		border-left: 2px solid var(--edge);
	}

	.under > li {
		padding: 0.35rem 0;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.head b {
		overflow-wrap: anywhere;
	}

	/* its devices and shares, under its name, each with what to do with it */
	.rows {
		margin: 0.25rem 0 0 calc(28px + 0.5rem);
		padding: 0;
		list-style: none;
		font-size: 0.86rem;
	}

	.rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.2rem 0.5rem;
		padding: 0.15rem 0;
	}

	.rows li > span {
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.others {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.8rem;
		margin: 0.5rem 0 0;
	}

	.other {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}

	@media (max-width: 520px) {
		.rows {
			margin-left: 0;
		}
	}
</style>
