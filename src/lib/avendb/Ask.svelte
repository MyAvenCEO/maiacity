<!--
	Asking for access: one small form where the person, acting for their aven by default or for any vault they act for,
	a coop of theirs say, asks a vault for a level, Viewer, Suggester or Editor, saying why (the `ask` op). The request
	is a record the asking vault writes in itself and shares, that entry alone, with the vault it asks, which may write
	its answer into it and nothing else; the asked vault's owners answer it on their consent screen
	(./AccessRequest.svelte), and the answer comes back as the record syncs. The vault to ask is the one the page shows
	where the person doesn't act for it (`to`), else one they pick of those this device knows, or any by its id. Ask
	shows once the device answers a dry run of it (`may`). Under the form, every request the person's vaults made, the
	newest first, pending, granted or denied (the `requests` op's `made`).
-->
<script>
	import Mark from './Mark.svelte';
	import { allowed, may } from './ops.js';
	import { ago, avenOf, kindRules, nameOf, short, why } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, busy: boolean,
	 *   made: import('./vaults.js').RequestRow[], to?: string, as?: string }}
	 */
	let { world, api, busy, made, to = '', as = '' } = $props();

	/** The levels one may ask for, the weakest first, and what each lets the asking vault do. */
	const LEVELS = /** @type {const} */ (['Viewer', 'Suggester', 'Editor']);
	const DOES = /** @type {Record<string, string>} */ ({
		Viewer: 'reads it',
		Suggester: 'reads it, and writes only on proposals its owners merge',
		Editor: 'reads and changes it'
	});
	/** the most a request's why holds, as avenDB's `request` schema says */
	const WHY = 500;
	/** the picker's value for a vault named by its id */
	const BY_ID = 'id';

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	/** A vault by its name, or by the start of its id where this device doesn't know it. @param {string} id */
	const vaultName = (id) => (byId.has(id) ? nameOf(byId.get(id)) : `Vault ${short(id)}`);
	/**
	 * The vaults the person may ask as: their own and those they act for, but a device vault, which acts only with what
	 * its owner passes on, and so asks its owner (the kind table: a kind owned by vaults that holds devices).
	 */
	const askers = $derived(
		world.vaults.filter((v) => {
			const r = kindRules(world, v.kind);
			return (v.id === world.mine || v.via?.length) && !(r?.devices && r.ownedBy !== 'signers');
		})
	);
	/** the vaults to ask, of those this device knows: those the person doesn't act for */
	const others = $derived(world.vaults.filter((v) => !v.via));

	/** the vault it asks as, as the person picks it: the one named, else their aven, else their own vault */
	let picked = $state('');
	const asker = $derived(
		[picked, as, avenOf(world)?.id ?? '', world.mine].find((id) => id && askers.some((v) => v.id === id)) ?? world.mine
	);
	/** the vault to ask, as the person picks it, and an id they type */
	let target = $state('');
	let typed = $state('');
	const asked = $derived((to || (target === BY_ID ? typed.trim().toLowerCase() : target)).trim());
	let level = $state(/** @type {string} */ ('Viewer'));
	let reason = $state('');

	/** whether it names a vault, by an id of 64 hex digits */
	const named = $derived(/^[0-9a-f]{64}$/.test(asked));
	/** the request as the `ask` op makes it, once it names a vault and says why */
	const op = $derived(
		named && reason.trim()
			? { op: 'ask', to: asked, level, why: reason.trim(), as: asker }
			: null
	);
	/** why the device won't make it, as it answers a dry run of it: '' where it would, or before it is whole */
	let barred = $state('');
	$effect(() => {
		const o = op;
		barred = '';
		if (!o) return;
		if (o.to === o.as) return void (barred = 'a vault asks another, never itself');
		let gone = false;
		may(api, o.as, [o]).then(([v]) => !gone && (barred = allowed(v) ? '' : why(/** @type {any} */ (v))));
		return () => {
			gone = true;
		};
	});
	/** the vault the last request went to, to say so */
	let sent = $state('');

	async function send() {
		if (!op) return;
		const name = vaultName(op.to);
		if (await api.run(`Asking ${name} for access`, op)) [reason, sent] = ['', name];
	}

	/** every request the person's vaults made, the newest first */
	const mine = $derived([...made].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)));
	/** a request's answer, as its chip says it */
	const ANSWER = /** @type {Record<string, [string, string]>} */ ({
		granted: ['Granted', 'ok'],
		denied: ['Denied', 'bad'],
		'': ['Pending', 'warn']
	});
</script>

<div class="ask">
	<div class="line">
		<span class="soft">Ask</span>
		{#if to}
			<span class="who"><Mark vault={byId.get(to)} size={22} /><b>{vaultName(to)}</b></span>
		{:else}
			<select class="field" bind:value={target} aria-label="The vault to ask">
				<option value="">A vault to ask…</option>
				{#each others as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
				<option value={BY_ID}>A vault by its id…</option>
			</select>
		{/if}
	</div>
	{#if !to && target === BY_ID}
		<input class="field" bind:value={typed} placeholder="Its id: 64 hex digits" aria-label="The vault's id" />
	{/if}
	<div class="line">
		<span class="soft">As</span>
		<select class="field" bind:value={() => asker, (id) => (picked = id)} aria-label="The vault that asks">
			{#each askers as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
		</select>
	</div>
	<div class="levels" role="radiogroup" aria-label="The level to ask for">
		{#each LEVELS as l (l)}
			<button role="radio" aria-checked={level === l} class:on={level === l} onclick={() => (level = l)}>{l}</button>
		{/each}
	</div>
	<p class="soft">
		{level}: {nameOf(byId.get(asker))} {DOES[level]}, once {named ? `${vaultName(asked)}’s` : 'its'} owners say yes.
	</p>
	<textarea
		class="field"
		rows="2"
		maxlength={WHY}
		bind:value={reason}
		placeholder="Why, in a few words: they read it before they answer"
		aria-label="Why you ask"
	></textarea>
	<div class="line end">
		<small class="soft">{reason.length}/{WHY}</small>
		<button class="btn primary" disabled={busy || !op || !!barred} onclick={send}>Ask</button>
	</div>
	{#if barred}
		<p class="soft">It can’t: {barred}.</p>
	{:else if sent}
		<p class="soft">Asked {sent}: its owners answer it on their consent screen.</p>
	{/if}
</div>

<h4>Your requests</h4>
<ul class="made">
	{#each mine as m (m.entry)}
		{@const [said, tone] = ANSWER[m.answer ?? ''] ?? ANSWER['']}
		<li>
			<Mark vault={byId.get(m.to)} size={24} />
			<div class="what">
				<span><b>{vaultName(m.to)}</b> · {m.level}</span>
				<small class="soft">as {vaultName(m.from)}{m.created ? ` · ${ago(m.created)}` : ''}</small>
				{#if m.why}<small class="soft why">“{m.why}”</small>{/if}
			</div>
			<span class="chip {tone}">{said}</span>
		</li>
	{:else}
		<li class="soft">None yet.</li>
	{/each}
</ul>

<style>
	.ask {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.line > .field {
		flex: 1;
		min-width: 0;
	}

	.line.end {
		justify-content: flex-end;
	}

	.who {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		resize: vertical;
	}

	p {
		margin: 0;
		line-height: 1.45;
	}

	/* the levels as pills: the chosen one filled */
	.levels {
		display: inline-flex;
		align-self: flex-start;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #f4f1eb;
	}

	.levels button {
		padding: 0.24rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font: inherit;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--soft);
		white-space: nowrap;
		cursor: pointer;
	}

	.levels button:hover {
		color: var(--accent);
	}

	.levels button.on {
		background: var(--accent);
		color: #fff;
	}

	h4 {
		margin: 1rem 0 0.3rem;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--soft);
	}

	.made {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.made li {
		display: flex;
		align-items: flex-start;
		gap: 0.55rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid var(--edge);
		font-size: 0.88rem;
	}

	.made li:last-child {
		border-bottom: 0;
	}

	.what {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.why {
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
</style>
