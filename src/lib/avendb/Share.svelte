<!--
	Share a slice of a vault on, as the acting vault: one entry, or a rule, every note or todo, or those tagged one way
	and not another, or the whole vault; with another vault this browser knows, which then relays, backs up, reads, writes
	or owns it, or with everyone, who may only read. It starts at the least: the one entry it opens on, or else the vault's
	todos, to read. A rule is a cap on whatever matches it, now and later, never a list: an entry tagged to match it
	later is shared then, one untagged leaves it, and the vault's devices move each into the cell the caps that hold it
	share, under that cell's key (avendb-browser's `Device::share`, a slice as its `words` read it). A cap that writes
	may carry rules, the ops its grantee's writes may make: only suggest changes on proposals, change only some fields,
	set one field to some values, or rules written as JSON (avendb/docs/OPS.md); the fields are those of the newest
	schema of what it shares. The preview says what it reaches now, of what the acting vault reads, and what its rules
	allow. Making a vault an owner needs the acting vault's passkey; the rest none. A vault that isn't the one shared
	from shares only through an owner cap of its own, and reaches no further than it, nor beyond its rules.
-->
<script>
	import {
		allows,
		attrsOf,
		capWords,
		count,
		fieldsOf,
		list,
		matches,
		MAY,
		nameOf,
		reads,
		ROLE_HINTS,
		rulesWords,
		sliceWords,
		SUGGEST,
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
	/** what a cap that writes lets its grantee change (`MAY`), and the fields, the field and values, or the JSON */
	let may = $state(/** @type {keyof typeof MAY} */ ('any'));
	let picked = $state(/** @type {string[]} */ ([]));
	let field = $state('');
	let values = $state(/** @type {unknown[]} */ ([]));
	let json = $state('');
	let adds = $state(false);
	/** the schemas and lenses the vault's entries are read through (the `schemas` op), for the fields rules name */
	let lane = $state(/** @type {any} */ (null));

	// the one entry it opens on, by default: the least
	$effect.pre(() => {
		if (entry) what = 'entry';
	});

	$effect(() => {
		const v = vault;
		api.ask({ op: 'schemas', vault: v }).then((/** @type {any} */ out) => v === vault && (lane = out?.ok ?? null));
	});

	const to = $derived(grantee || others[0]?.id || 'public');
	const given = $derived(to === 'public' ? 'read' : role);

	/** the fields of what it shares, each once, with the values each takes where it takes only some */
	const fields = $derived.by(() => {
		const of = what === 'entry' && one?.type ? [one.type] : what === 'all' ? ['note', 'todo'] : types.split(',');
		const all = of.flatMap((t) => fieldsOf(lane, t));
		return all.filter((f, i) => all.findIndex((g) => g.name === f.name) === i);
	});
	const valued = $derived(fields.filter((f) => f.values));
	const theField = $derived(valued.find((f) => f.name === field) ?? valued[0]);

	/**
	 * The rules the cap carries, as the device takes them: none for a cap that doesn't write or makes any change,
	 * `null` while the JSON doesn't read as a list.
	 * @type {import('./vaults.js').Rule[] | null | undefined}
	 */
	const rules = $derived.by(() => {
		if (!allows(given, 'write') || may === 'any') return undefined;
		/** @type {any} */
		let rs = [];
		if (may === 'suggest') {
			rs = SUGGEST;
		} else if (may === 'fields') {
			rs = picked.filter((f) => fields.some((g) => g.name === f)).map((f) => ({ op: 'set', path: [f] }));
		} else if (may === 'values' && theField) {
			const to = values.filter((x) => theField.values?.includes(/** @type {any} */ (x)));
			rs = [{ op: 'set', path: [theField.name], to }];
		} else if (may === 'json') {
			try {
				rs = JSON.parse(json);
			} catch {
				return null;
			}
			if (!Array.isArray(rs)) return null;
		}
		return adds ? [...rs, { op: 'create' }] : rs;
	});

	/** The slice as the device takes it (`{select, relabel, rules?}`). @returns {import('./vaults.js').Slice} */
	const slice = $derived.by(() => {
		const asks = allows(given, 'write') ? tagsIn(relabel) : [];
		const ruled = rules ? { rules } : {};
		if (what === 'entry' && entry) return { select: [[{ entry: [entry] }]], relabel: asks, ...ruled };
		if (what === 'all') return { select: /** @type {'all'} */ ('all'), relabel: asks, ...ruled };
		/** @type {import('./vaults.js').Atom[]} */
		const tests = [{ type: types.split(',') }];
		for (const tag of tagsIn(tagged)) tests.push({ tag });
		const not = tagsIn(untagged);
		if (not.length) tests.push({ noTag: not });
		return { select: [tests], relabel: asks, ...ruled };
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
			[may, picked, values, json, adds] = ['any', [], [], '', false];
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
				<option value="relay">to relay (connects only, keeps nothing)</option>
				<option value="backup">to back up (ciphertext only)</option>
				<option value="read">to read</option>
				<option value="write">to write</option>
				<option value="owner">to own (your passkey approves)</option>
			</select>
		{/if}
		{#if allows(given, 'write')}
			<input class="field tags" placeholder="tags it may ask for" bind:value={relabel} aria-label="Tags it may ask for" />
		{/if}
	</div>
	{#if allows(given, 'write')}
		<div class="row">
			<span class="lead">and</span>
			<select class="field" bind:value={may} aria-label="What it may change">
				{#each Object.entries(MAY) as [k, words] (k)}
					{#if k !== 'values' || valued.length}<option value={k}>{words}</option>{/if}
				{/each}
			</select>
			{#if may === 'fields'}
				{#each fields as f (f.name)}
					<label class="pick"><input type="checkbox" bind:group={picked} value={f.name} /> {f.name}</label>
				{/each}
			{:else if may === 'values' && theField}
				<select
					class="field"
					value={theField.name}
					onchange={(e) => (field = e.currentTarget.value)}
					aria-label="Which field"
				>
					{#each valued as f (f.name)}<option value={f.name}>{f.name}</option>{/each}
				</select>
				{#each theField.values ?? [] as x (String(x))}
					<label class="pick"><input type="checkbox" bind:group={values} value={x} /> {String(x)}</label>
				{/each}
			{/if}
			{#if may !== 'any'}
				<label class="pick"><input type="checkbox" bind:checked={adds} /> and add new entries</label>
			{/if}
		</div>
		{#if may === 'json'}
			<textarea
				class="field json"
				rows="3"
				bind:value={json}
				placeholder={'[{ "op": "set", "path": ["status"], "to": ["done"] }]'}
				aria-label="Its rules, as JSON"
			></textarea>
		{/if}
	{/if}
	<p class="soft preview">
		{ROLE_HINTS[given]}: {sliceWords(slice, world)}.
		{#if rules === null}
			Its rules are a JSON list of ops, as avenDB’s docs write them.
		{:else if rules}
			It {rulesWords(slice)}{rules.some((r) => r.op === 'create') ? '' : ', and adds no entry'}.
		{/if}
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
	<button class="btn primary" disabled={busy || (what === 'rule' && !types) || rules === null} onclick={give}>
		{entry ? 'Share it' : 'Share'}
	</button>
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

	.pick {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.82rem;
	}

	.json {
		width: min(100%, 36rem);
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
	}

	.preview {
		max-width: 60ch;
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
	}
</style>
