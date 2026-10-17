<!--
	avenDB's consent screen: every access request a vault the person acts for was asked, one at a time, whoever asks,
	in one card layout and with the same Approve and Deny: a share, to co-own a vault, an invitation to co-own one, an
	agent wanting to work for them, and a new device asking to join their vault.

	A request is a record (the design's "one request, one consent screen"): the asking vault writes it in itself, of
	avenDB's `request` schema, and shares that one entry with the vault it asks, which may write its answer into it
	alone (the `ask` op); sync brings it here like any other record, in the browser and the Mac app alike (the
	`requests` op's `asked`). The sheet says who asks, by its vault's mark, name and kind, an agent as one of the
	person's aven; the vaults it asks for, the level and why. The person may give less than it asks, a level each or
	none, never more than the vault asked holds: all of itself and the vaults it owns, else what is shared with it,
	passed on to a vault it owns or from an Owner share. Approving shares each, acting for the vault asked, or for the
	vault itself where the asked vault owns it, then writes "granted" into the request; denying writes "denied". The
	asker sees the answer once the record syncs back. An agent asking its own aven for the person's vaults gets its
	share passed on by the aven, which gets one from that vault first where it holds none at that level, as the Mac's
	`pass_on` does (avendb-device's `agent`).

	A request may ask to co-own the vault asked ("owner", a person's vault asking a coop), or invite the vault asked to
	co-own the one asking ("invite", a coop asking a person). Either adds an owner, which takes two passkeys: the vault
	asked approves it with its passkey, which signs its part of the edit and writes it into the request with "granted"
	(a `share` of Owner naming the request), and the vault that asked finishes it with its own passkey once the answer
	syncs back, a next step this sheet shows from the requests its vaults made (the `requests` op's `made`). Neither
	adds anyone alone: the rules check the edit as every owner add, the vault's approval and the newcomer's consent.

	A new device, a browser opened on the link another of the person's devices shows (./Account.svelte's ?link=),
	belongs to no vault and reads none of this: its request is that link, the offer of the device that shows it, and
	approving it on this same sheet is the passkey's one touch that unlocks the new device and adds it to their vault
	(`joining`); denying puts the link away.

	In the Mac app, before an agent belongs to any vault, its request is a file it left on the Mac (avendb-device's
	`agent`), as a harness such as Claude Code or Codex starts its own device (agentClaude, agentCodex): it says who asks,
	by its device's name and key, what it asks for and why. An agent always joins the person's one aven, the aven vault
	their vault owns: as a device vault of its own under it, its device in it, which holds sub caps, shares that rest on
	the aven's own, so it never gets more than the aven holds. Where their vault owns no aven yet, the person names it,
	and approving founds it. Then they pick the vaults it works in, a level each, Viewer, Suggester or Editor: every
	vault they own, or only some, never an aven or a device vault, which act for their one owner alone (the kind table's
	`most`); and each vault that shared with the aven, as a coop that hired it, up to the aven's own level there.
	Approving an agent that has no device vault yet takes one touch of their passkey; a share needs none. A Suggester
	gets an AIP author's share beside each Suggester's, on that vault's AIPs alone (./vaults.js `aipAuthorOps`,
	avendb-device's `pass_on_aips`), so it opens AIPs over its proposal lines for the person to review, as the sheet
	says. "All my vaults,
	now and later" is a standing grant (avendb's `world::STANDING`): their vault gives the aven one, which the aven
	passes on to the agent, every vault they own follows it now, and every vault they found later follows it as it
	follows their server setting, the aven's share first and the agent's resting on it. Each vault's Sharing page shows
	what the agent holds and takes it back, a standing grant for every vault it reached, and revoking the aven's share
	ends the agent's too.

	It rises as a sheet from the foot of the page, as the passkey's does (./Signing.svelte), one request at a time, the
	agents' files first, with pills to pick from rather than the browser's own selects and radios. "Later" puts it away
	until the page is opened again; the request stays until it is answered.
-->
<script>
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import {
		ago,
		aipAuthorOps,
		avenOf,
		KINDS,
		list,
		nameOf,
		oneOwner,
		order,
		owns,
		short as shortId,
		standingOps,
		SUGGESTS
	} from './vaults.js';

	/**
	 * @typedef {import('./vaults.js').AccessRequestView} Request
	 * @typedef {import('./vaults.js').RequestRow} Asked
	 * @typedef {import('./vaults.js').CapView} CapView
	 * @typedef {{ over: string, level: string }} Grant
	 * @typedef {{ naming: string, all: boolean, level: string, levels: Record<string, string> }} Answer
	 */
	/**
	 * @typedef {{ name: string, ready: boolean, rename: (name: string) => void, onjoin: () => unknown,
	 *   ondeny: () => void }} Joining a new device asking to join the person's vault, by the link it opened
	 */
	/**
	 * @type {{ world: import('./vaults.js').WorldView | null, requests?: Request[], asked?: Asked[], made?: Asked[],
	 *   joining?: Joining | null, api: any, busy: boolean,
	 *   ongrant?: (name: string, device: string, shares: Grant[], avenName: string, standing: string) => void,
	 *   ondeny?: (name: string, device: string) => void }}
	 */
	let {
		world: shown,
		requests = [],
		asked = [],
		made = [],
		joining = null,
		api,
		busy,
		ongrant = () => {},
		ondeny = () => {}
	} = $props();
	/** what the device shows of its world; nothing yet on a new device that belongs to no vault */
	const NOWORLD = /** @type {import('./vaults.js').WorldView} */ (
		/** @type {unknown} */ ({ mine: '', vaults: [], shares: [], groups: [], kinds: [] })
	);
	const world = $derived(shown ?? NOWORLD);

	/** The levels the page gives, the weakest first, and what each lets the vault given it do in a vault. */
	const LEVELS = /** @type {const} */ (['Viewer', 'Suggester', 'Editor']);
	const DOES = /** @type {Record<string, string>} */ ({
		Viewer: 'reads it',
		Suggester: 'reads it, and writes only on proposals you merge',
		Editor: 'reads and changes it'
	});

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const mine = $derived(byId.get(world.mine));
	/** the person's one aven, which every agent joins: none until their first agent founds it */
	const aven = $derived(avenOf(world));
	/** the vaults the person may give access to: their own, and those their vault owns, none that acts for its one
	 *  owner alone */
	const ownable = $derived(
		world.vaults.filter((v) => (v.id === world.mine || v.via?.length) && !oneOwner(world, v.kind))
	);
	/** The levels a share allows passing on: up to its built-in group where it is one of `LEVELS`, else up to its
	 *  level. @param {CapView} c @returns {string[]} */
	function upTo(c) {
		const at = LEVELS.indexOf(/** @type {any} */ (c.group));
		if (at >= 0) return LEVELS.slice(0, at + 1);
		const levelOf = (/** @type {string} */ l) => world.groups.find((g) => g.name === l && !g.everyone)?.level;
		return LEVELS.filter((l) => order(levelOf(l) ?? '') >= order(c.level));
	}
	/**
	 * The vaults that shared with the aven, as a coop that hired it, besides the person's own: each with the levels the
	 * agent may get there, those the aven's own shares there allow.
	 */
	const hired = $derived.by(() => {
		if (!aven) return [];
		/** @type {Map<string, Set<string>>} */
		const by = new Map();
		for (const c of world.shares) {
			if (c.who !== aven.id || !c.reads || c.over === aven.id || ownable.some((v) => v.id === c.over)) continue;
			by.set(c.over, new Set([...(by.get(c.over) ?? []), ...upTo(c)]));
		}
		/** @type {{ v: import('./vaults.js').VaultView, levels: string[] }[]} */
		const out = [];
		for (const [id, up] of by) {
			const v = byId.get(id);
			const levels = LEVELS.filter((l) => up.has(l));
			if (v && levels.length) out.push({ v, levels });
		}
		return out;
	});

	/** each agent request's answer as the person sets it, by the request */
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

	/** each record request's answer as the person sets it, by its entry: a level for each vault it asks for */
	let picks = $state(/** @type {Record<string, Record<string, string>>} */ ({}));
	/** for an agent's record asking its aven, whether the person gives it all their vaults, now and later, and at which
	 *  level, by its entry */
	let alls = $state(/** @type {Record<string, { all: boolean, level: string }>} */ ({}));
	/** The vaults request `q` asks a level on: those it names, else the vault it asks. @param {Asked} q */
	const over = (q) => (q.vaults.length ? q.vaults : [q.to]);
	/** Vault `b` is owned by vault `a` directly. @param {string} a @param {string} b */
	const ownsDirectly = (a, b) => !!byId.get(b)?.owners.some((o) => 'vault' in o && o.vault === a);
	/** Request `q` is an agent's of the person's aven, asking it: from a device vault the aven owns. @param {Asked} q */
	const agentAsks = (q) => !!aven && q.to === aven.id && ownsDirectly(aven.id, q.from);
	/** Vault `x` is the person's own, or one their vault owns. @param {string} x */
	const theirs = (x) => x === world.mine || owns(world, world.mine, x);
	/**
	 * The levels the vault `q` asks can give on vault `x`, at most the one `q` asks for: any where it is `x` or owns it,
	 * or where `q` is its agent's and `x` the person's; else those it may pass on of the shares it holds over `x`, from
	 * an Owner share, or any to a vault it owns.
	 * @param {Asked} q @param {string} x
	 */
	function givable(q, x) {
		const asks = LEVELS.slice(0, Math.max(0, LEVELS.indexOf(/** @type {any} */ (q.level))) + 1);
		if (x === q.to || owns(world, q.to, x) || (agentAsks(q) && theirs(x))) return asks;
		const passes = (/** @type {CapView} */ c) => c.level === 'owner' || ownsDirectly(q.to, q.from);
		const held = world.shares.filter((c) => c.who === q.to && c.over === x && c.reads && passes(c));
		const can = new Set(held.flatMap(upTo));
		return asks.filter((l) => can.has(l));
	}
	/**
	 * The ops that give `q`'s asker `level` on vault `x` (`sharing`), and for an agent of the person's aven asking it to
	 * be a Suggester, an AIP author's share beside it, on `x`'s AIPs alone, as the Mac's grant gives one
	 * (./vaults.js `aipAuthorOps`).
	 * @param {Asked} q @param {string} x @param {string} level
	 */
	const giving = (q, x, level) => [
		...sharing(q, x, level),
		...(agentAsks(q) && level === SUGGESTS ? aipAuthorOps(world, x, q.to, q.from) : [])
	];
	/**
	 * The ops that give `q`'s asker `level` on vault `x`: a share as `x` itself where the vault asked is `x` or owns it;
	 * for an agent asking its aven for the person's vault, the aven's share first where it holds none at `level` on
	 * the whole of it, then the aven's to the agent; else the asked vault's, on the part of `x` its own share gives
	 * where that isn't all of it.
	 * @param {Asked} q @param {string} x @param {string} level
	 */
	function sharing(q, x, level) {
		/** @param {string} who @param {string} as @param {import('./vaults.js').Where} [what] */
		const share = (who, as, what) => ({ op: 'share', over: x, who: { vault: who }, level, as, ...(what ? { what } : {}) });
		if (x === q.to || owns(world, q.to, x)) return [share(q.from, x)];
		const held = world.shares.filter((c) => c.who === q.to && c.over === x && c.reads && upTo(c).includes(level));
		if (agentAsks(q) && theirs(x)) {
			return [...(held.some((c) => c.wide) ? [] : [share(q.to, x)]), share(q.from, q.to)];
		}
		const parent = held.find((c) => c.wide) ?? held[0];
		return [share(q.from, q.to, parent && !parent.wide ? parent.slice?.where : undefined)];
	}
	/** A request's answer to start from: each vault it asks for at the level it asks, or the most the vault asked can
	 *  give there. @param {Asked} q @returns {Record<string, string>} */
	const pick = (q) =>
		Object.fromEntries(
			over(q).map((x) => {
				const can = givable(q, x);
				return [x, can.includes(/** @type {any} */ (q.level)) ? q.level : (can.at(-1) ?? '')];
			})
		);

	// each new request, answered as it asks until the person changes it
	$effect(() => {
		for (const r of requests) if (!answers[key(r)]) answers[key(r)] = start(r);
		for (const q of asked) if (!picks[q.entry]) picks[q.entry] = pick(q);
		for (const q of asked) {
			const level = LEVELS.includes(/** @type {any} */ (q.level)) ? q.level : 'Viewer';
			if (!alls[q.entry]) alls[q.entry] = { all: false, level };
		}
	});

	/** What answer `a` gives vault by vault: a share of each vault picked at its level, but for "All my vaults, now and
	 *  later", a standing grant instead (`standing`); and those of the vaults that hired the aven. @param {Answer} a
	 *  @returns {Grant[]} */
	const shares = (a) => [
		...(a.all ? [] : ownable.filter((v) => a.levels[v.id]).map((v) => ({ over: v.id, level: a.levels[v.id] }))),
		...hired.filter((h) => a.levels[h.v.id]).map((h) => ({ over: h.v.id, level: a.levels[h.v.id] }))
	];
	/** The level of the standing grant answer `a` gives, "All my vaults, now and later", or '' for none.
	 *  @param {Answer} a */
	const standing = (a) => (a.all ? a.level : '');

	/** Whether answer `a` makes its agent a Suggester anywhere, which opens AIPs there too. @param {Answer} a */
	const suggests = (a) => (a.all && a.level === SUGGESTS) || shares(a).some((g) => g.level === SUGGESTS);

	/** The aven answer `a` joins, by its name: the person's one, else the new one they name. @param {Answer} a */
	const avenName = (a) => (aven ? nameOf(aven) : a.naming.trim());
	/** A vault by its name, or by the start of its id where this device doesn't know it. @param {string} id */
	const vaultName = (id) => (byId.has(id) ? nameOf(byId.get(id)) : `Vault ${shortId(id)}`);

	/** What shares give, level by level, in words: "Viewer on Samuel: it reads it", … @param {Grant[]} given */
	const giveWords = (given) =>
		LEVELS.filter((l) => given.some((g) => g.level === l)).map((level) => {
			const names = given.filter((g) => g.level === level).map((g) => vaultName(g.over));
			return `${level} on ${list(names)}: it ${DOES[level]}`;
		});
	/** Who gets what, in words: "agentClaude gets Viewer on every vault of yours, now and later: it reads it; Editor
	 *  on Maia City: …", a standing grant at `all` first, if any. @param {string} who @param {Grant[]} given
	 *  @param {string} [all] */
	function gets(who, given, all = '') {
		const later = all ? [`${all} on every vault of yours, now and later: it ${DOES[all]}`] : [];
		const parts = [...later, ...giveWords(given)];
		return parts.length ? `${who} gets ${parts.join('; ')}` : `${who} gets no vault: it sees only itself.`;
	}

	/** What request `r` gets by answer `a`, in words. @param {Request} r @param {Answer} a */
	function says(r, a) {
		const words = gets(r.name, shares(a), standing(a));
		return shares(a).length || a.all ? `${words}, each resting on ${avenName(a) || 'your aven'}’s own share.` : words;
	}

	/** @param {Request} r */
	function approve(r) {
		const a = answers[key(r)];
		ongrant(r.name, r.device, shares(a), avenName(a), standing(a));
	}

	/** Who asks `q`, in words: an agent of the person's aven, else its vault's kind; and the vault it asks, where that
	 *  isn't the person's own. @param {Asked} q */
	function whoAsks(q) {
		const from = byId.get(q.from);
		const who = agentAsks(q) && aven ? `An agent of your aven ${nameOf(aven)}` : from ? KINDS[from.kind] : 'A vault this device doesn’t know yet';
		const asks = q.to === world.mine || agentAsks(q) ? '' : ` · asks ${vaultName(q.to)}`;
		return `${who}${asks}${q.created ? ` · ${ago(q.created)}` : ''}`;
	}
	/** Whether the person gives `q`'s asker, their aven's agent, all their vaults, now and later. @param {Asked} q */
	const allOf = (q) => agentAsks(q) && !!alls[q.entry]?.all;
	/** The vaults `q`'s pills offer: those it asks for, but the person's own where it gets all of them.
	 *  @param {Asked} q */
	const offered = (q) => over(q).filter((x) => !(allOf(q) && theirs(x)));
	/** The shares answer `p` gives `q`'s asker, vault by vault. @param {Asked} q @param {Record<string, string>} p
	 *  @returns {Grant[]} */
	const given = (q, p) => offered(q).filter((x) => p[x]).map((x) => ({ over: x, level: p[x] }));
	/** Whether answer `p` makes `q`'s asker, an agent of the person's aven, a Suggester anywhere, which opens AIPs
	 *  there too. @param {Asked} q @param {Record<string, string>} p */
	const suggestsTo = (q, p) =>
		agentAsks(q) &&
		((allOf(q) && alls[q.entry]?.level === SUGGESTS) || given(q, p).some((g) => g.level === SUGGESTS));

	/** Request `q` asks for an owner add: to co-own the vault asked, or an invitation to co-own the one asking.
	 *  @param {Asked} q */
	const owning = (q) => q.asks === 'owner' || q.asks === 'invite';
	/** The owner add `q` asks for: the vault that takes an owner, and the vault that becomes one. @param {Asked} q */
	const adds = (q) => (q.asks === 'invite' ? { vault: q.from, owner: q.to } : { vault: q.to, owner: q.from });
	/** The op that signs the person's part of `q`'s owner add, or finishes it, acting for `as`: a share of Owner that
	 *  names the request. @param {Asked} q @param {string} as */
	const owner = (q, as) => {
		const { vault, owner } = adds(q);
		return { op: 'share', over: vault, who: { vault: owner }, level: 'Owner', request: q.entry, as };
	};

	/** the record requests answered here, until the device's list leaves them out */
	let answered = $state(/** @type {string[]} */ ([]));
	/** Gives `q`'s asker the shares answer `p` picks, then writes "granted" into it, acting for the vault asked.
	 *  @param {Asked} q @param {Record<string, string>} p */
	async function give(q, p) {
		const all = allOf(q) ? standingOps(world, q.to, q.from, alls[q.entry].level) : [];
		const ops = [...all, ...given(q, p).flatMap((g) => giving(q, g.over, g.level)), answering(q, 'granted')];
		if (await api.runAll(`Granting ${vaultName(q.from)} access`, ops)) answered = [...answered, q.entry];
	}
	/** Grants `q`'s owner add, acting for the vault asked: its passkey's part, and "granted". @param {Asked} q */
	async function cosign(q) {
		const words = q.asks === 'invite' ? `Accepting ${vaultName(q.from)}’s invitation` : `Approving ${vaultName(q.from)}`;
		if (await api.run(words, owner(q, q.to))) answered = [...answered, q.entry];
	}
	/** Finishes `f`'s owner add, granted, acting for the vault that asked: its passkey signs the rest, and the edit is
	 *  made. @param {Asked} f */
	async function finish(f) {
		const { vault, owner: who } = adds(f);
		if (await api.run(`Adding ${vaultName(who)} as an owner of ${vaultName(vault)}`, owner(f, f.from)))
			answered = [...answered, f.entry];
	}
	/** Writes "denied" into `q`, acting for the vault asked. @param {Asked} q */
	async function refuse(q) {
		if (await api.run(`Denying ${vaultName(q.from)}`, answering(q, 'denied'))) answered = [...answered, q.entry];
	}
	/** The op that writes answer `answer` into `q`. @param {Asked} q @param {'granted' | 'denied'} answer */
	const answering = (q, answer) => ({ op: 'set', entry: q.entry, path: ['answer'], value: answer, as: q.to });

	const short = (/** @type {string} */ id) => `${id.slice(0, 4)}…${id.slice(-4)}`;

	/** the requests put away for later, by their key, until the page opens again */
	let later = $state(/** @type {string[]} */ ([]));
	/** the owner adds the person's vaults asked for, granted, that wait on their passkey to finish them */
	const finishing = $derived(
		made.filter((m) => owning(m) && m.answer === 'granted' && m.part && !m.done && !answered.includes(m.entry))
	);
	/** what this sheet's queue holds: a new device's join, an agent's file, a request asked, an owner add to finish
	 *  @typedef {{ key: string, j?: Joining, r?: Request, q?: Asked, f?: Asked }} Item */
	/** the requests to answer now, a new device first, the agents' on this Mac next, then those as records, then the
	 *  owner adds to finish: the first of them shown */
	const queue = $derived(
		/** @type {Item[]} */ ([
			...(joining && !later.includes('join') ? [{ key: 'join', j: joining }] : []),
			...requests.filter((r) => !later.includes(key(r)) && answers[key(r)]).map((r) => ({ key: key(r), r })),
			...asked
				.filter((q) => !later.includes(q.entry) && !answered.includes(q.entry) && picks[q.entry])
				.map((q) => ({ key: q.entry, q })),
			...finishing.filter((f) => !later.includes(`finish ${f.entry}`)).map((f) => ({ key: `finish ${f.entry}`, f }))
		])
	);
	const j = $derived(queue[0]?.j);
	const r = $derived(queue[0]?.r);
	const a = $derived(r && answers[key(r)]);
	const member = $derived(r && joined(r));
	const q = $derived(queue[0]?.q);
	const p = $derived(q && picks[q.entry]);
	const f = $derived(queue[0]?.f);
	/** "· 1 of n" where more wait */
	const more = $derived(queue.length > 1 ? ` · 1 of ${queue.length}` : '');
	/** the levels a vault's pills offer: none, then each level */
	const PICKS = /** @type {const} */ (['', ...LEVELS]);
</script>

<!-- vault `id`'s level in `chosen`, as pills: none, then each of `levels` -->
{#snippet pills(
	/** @type {Record<string, string>} */ chosen,
	/** @type {string} */ id,
	/** @type {readonly string[]} */ levels
)}
	<div class="vault">
		<span>{vaultName(id)}</span>
		<div class="levels" role="radiogroup" aria-label="{vaultName(id)}'s level">
			{#each levels as l (l)}
				<button
					role="radio"
					aria-checked={(chosen[id] ?? '') === l}
					class:on={(chosen[id] ?? '') === l}
					class:none={l === ''}
					onclick={() => (chosen[id] = l)}>{l || 'None'}</button
				>
			{/each}
		</div>
	</div>
{/snippet}

{#if j}
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
			<span class="badge" aria-hidden="true"><Icon name="link" size={18} /></span>
			<div>
				<h2 id="request-title">{j.name || 'This device'} asks to join your vault</h2>
				<p class="soft">A new device · through the link your other device shows{more}</p>
			</div>
			<span class="state">New device</span>
		</header>

		<p class="soft">
			It asks to act for your vault as one of your devices: it reads and changes what your vault holds, and keeps
			it in sync with your other devices.
		</p>
		<section>
			<h3>Its name</h3>
			<input
				class="name"
				value={j.name}
				oninput={(e) => j.rename(e.currentTarget.value)}
				aria-label="This device's name"
				placeholder="Its name, which your other devices show it by"
			/>
		</section>

		<p class="says">
			One touch of your passkey adds it: the touch unlocks it and signs the edit that adds it to your vault. Your other
			devices list it under Owners & devices, and remove it there as they would a lost one.
		</p>
		<div class="actions">
			<button class="btn quiet danger" disabled={busy} onclick={() => j.ondeny()}>Deny</button>
			<button class="btn primary" disabled={busy || !j.ready || !j.name.trim()} onclick={() => j.onjoin()}
				>Approve</button
			>
		</div>
	</div>
{:else if r && a}
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
					An agent device on this Mac · its key <span class="mono">{short(r.device)}</span>{more}
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
				<button role="radio" aria-checked={a.all} class:on={a.all} onclick={() => (a.all = true)}
					>All my vaults, now and later</button
				>
				<button role="radio" aria-checked={!a.all} class:on={!a.all} onclick={() => (a.all = false)}
					>Only some</button
				>
			</div>
			{#if a.all}
				<div class="vault">
					<span>Every vault, and each you found later</span>
					<div class="levels" role="radiogroup" aria-label="Every vault's level">
						{#each LEVELS as l (l)}
							<button role="radio" aria-checked={a.level === l} class:on={a.level === l} onclick={() => (a.level = l)}
								>{l}</button
							>
						{/each}
					</div>
				</div>
			{:else}
				{#each ownable as v (v.id)}{@render pills(a.levels, v.id, PICKS)}{/each}
			{/if}
		</section>

		{#if aven && hired.length}
			<section>
				<h3>Shared with {nameOf(aven)}</h3>
				<p class="soft">Vaults that hired {nameOf(aven)}: {r.name} gets at most what {nameOf(aven)} holds there.</p>
				{#each hired as h (h.v.id)}{@render pills(a.levels, h.v.id, ['', ...h.levels])}{/each}
			</section>
		{/if}

		{#if suggests(a)}
			<p class="soft">As a Suggester, {r.name} can also open AIPs, bundles of its proposals, for you to review.</p>
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
{:else if q && owning(q)}
	{@const from = vaultName(q.from)}
	{@const to = vaultName(q.to)}
	{@const invite = q.asks === 'invite'}
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
			<Mark vault={byId.get(q.from)} size={36} />
			<div>
				<h2 id="request-title">
					{invite ? `${from} invites ${q.to === world.mine ? 'you' : to} to co-own it` : `${from} asks to co-own ${to}`}
				</h2>
				<p class="soft">{whoAsks(q)}{more}</p>
			</div>
		</header>

		{#if q.why}<blockquote>“{q.why}”</blockquote>{/if}
		<p class="soft">
			{#if invite}
				Accepting makes {q.to === world.mine ? 'you' : to} an owner of {from}: {q.to === world.mine ? 'you act' : 'it acts'}
				for it as its owners do, add and remove its owners and devices, and may close it.
			{:else}
				Approving makes {from} an owner of {to}: it acts for {to} as its owners do, adds and removes its owners and
				devices, and may close it.
			{/if}
		</p>
		<p class="says">
			One touch of your passkey signs your part. Then {byId.get(q.from)?.kind === 'human'
				? `${from} finishes it with their own passkey`
				: `${from}’s owners finish it with their passkey`}, once your answer reaches them: an owner is added only with
			both. Owners & devices lists the new owner, and removes it there.
		</p>
		<div class="actions">
			<button class="btn quiet" disabled={busy} onclick={() => (later = [...later, q.entry])}>Later</button>
			<button class="btn quiet danger" disabled={busy} onclick={() => refuse(q)}>Deny</button>
			<button class="btn primary" disabled={busy} onclick={() => cosign(q)}>{invite ? 'Accept' : 'Approve'}</button>
		</div>
	</div>
{:else if q && p}
	{@const from = vaultName(q.from)}
	{@const to = vaultName(q.to)}
	{@const grants = given(q, p)}
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
			<Mark vault={byId.get(q.from)} size={36} />
			<div>
				<h2 id="request-title">{from} asks for access</h2>
				<p class="soft">{whoAsks(q)}{more}</p>
			</div>
		</header>

		{#if q.why}<blockquote>“{q.why}”</blockquote>{/if}
		<p class="soft">
			It asks {q.to === world.mine ? 'you' : to} for <b>{q.level}</b> on {list(over(q).map(vaultName))}: it
			{DOES[q.level] ?? 'works in it'}.
		</p>

		{#if agentAsks(q) && alls[q.entry]}
			{@const al = alls[q.entry]}
			<section>
				<h3>Which vaults</h3>
				<div class="switch" role="radiogroup" aria-label="Which vaults">
					<button role="radio" aria-checked={al.all} class:on={al.all} onclick={() => (al.all = true)}
						>All my vaults, now and later</button
					>
					<button role="radio" aria-checked={!al.all} class:on={!al.all} onclick={() => (al.all = false)}
						>Only those it names</button
					>
				</div>
				{#if al.all}
					<div class="vault">
						<span>Every vault, and each you found later</span>
						<div class="levels" role="radiogroup" aria-label="Every vault's level">
							{#each LEVELS as l (l)}
								<button role="radio" aria-checked={al.level === l} class:on={al.level === l} onclick={() => (al.level = l)}
									>{l}</button
								>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		{/if}

		{#if offered(q).length}
			<section>
				<h3>{allOf(q) ? 'Besides' : 'What it gets'}</h3>
				{#each offered(q) as x (x)}
					{@const can = givable(q, x)}
					{#if can.length}
						{@render pills(p, x, ['', ...can])}
					{:else}
						<div class="vault">
							<span>{vaultName(x)}</span>
							<small class="soft">{to} holds nothing here to give</small>
						</div>
					{/if}
				{/each}
			</section>
		{/if}

		{#if suggestsTo(q, p)}
			<p class="soft">As a Suggester, {from} can also open AIPs, bundles of its proposals, for you to review.</p>
		{/if}
		<p class="says">
			{grants.length || allOf(q)
				? `${gets(from, grants, allOf(q) ? alls[q.entry].level : '')}.`
				: `${from} gets nothing: pick a level, or deny it.`}
			Approving shares it as {to} and writes your answer into the request, which {from} sees once it syncs. Each
			vault's Sharing page shows it and takes it back.
		</p>
		<div class="actions">
			<button class="btn quiet" disabled={busy} onclick={() => (later = [...later, q.entry])}>Later</button>
			<button class="btn quiet danger" disabled={busy} onclick={() => refuse(q)}>Deny</button>
			<button class="btn primary" disabled={busy || (!grants.length && !allOf(q))} onclick={() => give(q, p)}
				>Approve</button
			>
		</div>
	</div>
{:else if f}
	{@const { vault, owner: newcomer } = adds(f)}
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
			<Mark vault={byId.get(vault)} size={36} />
			<div>
				<h2 id="request-title">
					{f.asks === 'invite'
						? `${vaultName(f.to)} accepted: add it as an owner of ${vaultName(vault)}`
						: `${vaultName(f.to)} said yes: co-own it`}
				</h2>
				<p class="soft">
					Your next step · {f.asks === 'invite' ? `your invitation, as ${vaultName(f.from)}` : `your request, as ${vaultName(f.from)}`}{f.created
						? ` · ${ago(f.created)}`
						: ''}{more}
				</p>
			</div>
		</header>

		{#if f.why}<blockquote>“{f.why}”</blockquote>{/if}
		<p class="soft">
			{vaultName(f.to)} signed its part with its passkey. One touch of yours finishes it: {vaultName(newcomer)} becomes an
			owner of {vaultName(vault)}, and acts for it as its owners do.
		</p>
		<div class="actions">
			<button class="btn quiet" disabled={busy} onclick={() => (later = [...later, `finish ${f.entry}`])}>Later</button>
			<button class="btn primary" disabled={busy} onclick={() => finish(f)}>Finish</button>
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
