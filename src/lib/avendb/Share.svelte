<!--
	Share a slice of a vault on, as the acting vault: one entry, or a rule, every note or todo, or those tagged one way
	and not another, or the whole vault; with another vault this browser knows, which then relays, reads, writes or owns
	it, or with everyone, who may only read. It starts at the least: the one entry it opens on, or else the vault's
	todos, to read. A rule is a cap on whatever matches it, now and later, never a list: an entry tagged to match it
	later is shared then, one untagged leaves it, and the vault's devices move each into the cell the caps that hold it
	share, under that cell's key (avendb-browser's `Device::share`, a slice as its `words` read it). The preview says
	what it reaches now, of what the acting vault reads. Making a vault an owner needs the acting vault's passkey; the
	rest none. A vault that isn't the one shared from shares only through an owner cap of its own, and reaches no
	further than it.
-->
<script>
	import {
		allows,
		attrsOf,
		capWords,
		count,
		list,
		matches,
		nameOf,
		reads,
		ROLE_HINTS,
		sliceWords,
		tagsIn,
		titleOf
	} from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, vault: string,
	 *   entry?: string, ondone?: () => void }}
	 */
	let { world, actor, api, busy, vault, entry = '', ondone = () => {} } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	/** the owner caps the acting vault shares through, where it isn't the vault: the new cap rests on one of them */
	const through = $derived(world.caps.filter((c) => c.over === vault && c.grantee === actor && c.role === 'owner'));
	/** the whole vault only from the vault itself or through an owner cap on all of it */
	const whole = $derived(vault === actor || through.some((c) => c.wide));
	/** the vaults it may share with: any other this browser knows, but the vault itself, which holds all of it */
	const others = $derived(world.vaults.filter((v) => v.id !== vault && v.id !== actor));
	const one = $derived(world.entries.find((e) => e.entry === entry));

	let what = $state(/** @type {'entry' | 'rule' | 'all'} */ ('rule'));
	let types = $state('todo');
	let tagged = $state('');
	let untagged = $state('');
	let grantee = $state('');
	let role = $state(/** @type {import('./vaults.js').Role} */ ('read'));
	let relabel = $state('');

	// the one entry it opens on, by default: the least
	$effect.pre(() => {
		if (entry) what = 'entry';
	});

	const to = $derived(grantee || others[0]?.id || 'public');
	const given = $derived(to === 'public' ? 'read' : role);

	/** The slice as the device takes it (`{select, relabel}`). @returns {import('./vaults.js').Slice} */
	const slice = $derived.by(() => {
		const asks = allows(given, 'write') ? tagsIn(relabel) : [];
		if (what === 'entry' && entry) return { select: [[{ entry: [entry] }]], relabel: asks };
		if (what === 'all') return { select: /** @type {'all'} */ ('all'), relabel: asks };
		/** @type {import('./vaults.js').Atom[]} */
		const tests = [{ type: types.split(',') }];
		for (const tag of tagsIn(tagged)) tests.push({ tag });
		const not = tagsIn(untagged);
		if (not.length) tests.push({ noTag: not });
		return { select: [tests], relabel: asks };
	});

	/** What it reaches now, of the vault's entries the acting vault reads; and how many it can't tell. */
	const reach = $derived.by(() => {
		const of = world.entries.filter((e) => e.vault === vault);
		const known = of.filter((e) => reads(e, actor) && attrsOf(e));
		const hits = known.filter((e) => matches(slice.select, /** @type {import('./vaults.js').Attrs} */ (attrsOf(e))));
		return { hits, unknown: of.length - known.length };
	});

	async function give() {
		if (await api.share(actor, vault, $state.snapshot(slice), given, to)) {
			// back to the least for the next share
			[tagged, untagged, relabel, role] = ['', '', '', 'read'];
			what = entry ? 'entry' : 'rule';
			ondone();
		}
	}
</script>

<div class="share">
	<div class="row">
		<span class="lead">Share</span>
		<select class="field" bind:value={what} aria-label="What">
			{#if entry}<option value="entry">this {one?.type === 'todo' ? 'todo' : one?.type === 'note' ? 'note' : 'entry'} alone</option>{/if}
			<option value="rule">every</option>
			{#if whole}<option value="all">the whole vault</option>{/if}
		</select>
		{#if what === 'rule'}
			<select class="field" bind:value={types} aria-label="Type">
				<option value="todo">todo</option>
				<option value="note">note</option>
				<option value="note,todo">note and todo</option>
			</select>
			<input class="field tags" placeholder="tagged (any)" bind:value={tagged} aria-label="Tagged" />
			<input class="field tags" placeholder="but not tagged" bind:value={untagged} aria-label="Not tagged" />
		{/if}
	</div>
	<div class="row">
		<span class="lead">with</span>
		<select class="field" value={to} onchange={(e) => (grantee = e.currentTarget.value)} aria-label="Share with">
			{#each others as v (v.id)}<option value={v.id}>{nameOf(v)}</option>{/each}
			<option value="public">Everyone (public)</option>
		</select>
		{#if to !== 'public'}
			<select class="field" bind:value={role} aria-label="Role">
				<option value="relay">to relay (ciphertext only)</option>
				<option value="read">to read</option>
				<option value="write">to write</option>
				<option value="owner">to own (your passkey approves)</option>
			</select>
		{/if}
		{#if allows(given, 'write')}
			<input class="field tags" placeholder="tags it may ask for" bind:value={relabel} aria-label="Tags it may ask for" />
		{/if}
	</div>
	<p class="soft preview">
		{ROLE_HINTS[given]}: {sliceWords(slice, world)}.
		{#if what === 'entry'}
			Only {titleOf(world, entry)}, nothing else of {nameOf(byId.get(vault))}.
		{:else if what === 'all'}
			Everything in {nameOf(byId.get(vault))}, now and later.
		{:else}
			It reaches {reach.hits.length ? `${count(reach.hits.length, 'entry', 'entries')} now (${list(reach.hits.slice(0, 4).map((e) => titleOf(world, e.entry)))}${reach.hits.length > 4 ? ', …' : ''})` : 'no entry yet'}{reach.unknown
				? `, of what ${nameOf(byId.get(actor))} reads`
				: ''}, and every one that matches later.
		{/if}
		{#if vault !== actor && through.length}
			It reaches no further than {nameOf(byId.get(actor))}’s own cap: {list(through.map((c) => capWords(c, world)), 'or')}.
		{/if}
	</p>
	<button class="btn primary" disabled={busy || (what === 'rule' && !types)} onclick={give}>{entry ? 'Share it' : 'Share'}</button>
</div>

<style>
	.share {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.45rem;
	}

	.lead {
		min-width: 2.6rem;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.tags {
		width: 9.5rem;
	}

	.preview {
		max-width: 60ch;
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
	}
</style>
