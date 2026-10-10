<!--
	Share a slice of a vault on, as the acting vault, as a cap: a name, what it picks and the JSON ops its grantee may
	make there (avendb-browser's `Device::share`, `{name, where, ops}` as its `words` read it; avendb/docs/OPS.md). What
	it picks is one entry, every note or todo, or those tagged one way and not another, or the whole vault: a rule,
	never a list, so an entry tagged to match it later is shared then, one untagged leaves it, and the vault's devices
	move each into the cell the caps that hold it share, under that cell's key. Its ops are a group: a built-in one
	(Owner, Editor, Suggester, Viewer, Backup, Relay, the core's `groups`), or one of its own, named, built op by op or
	written as JSON, the fields those of the newest schema of what it shares; with everyone, the Public group alone,
	which only reads. It starts at the least: the one entry it opens on, or else the vault's todos, for a Viewer. The
	preview says what it reaches now, of what the acting vault reads. A cap whose ops share it on needs the acting
	vault's passkey; the rest none. A vault that isn't the one shared from shares only through an owner cap of its own,
	and reaches no further than it, nor beyond its ops.
-->
<script>
	import Ops from './Ops.svelte';
	import {
		attrsOf,
		capWords,
		count,
		EVERYONE,
		fieldsOf,
		levelOf,
		list,
		matches,
		nameOf,
		opsWords,
		reads,
		tagsIn,
		titleOf,
		whereWords
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

	/** Ops as a group of its own writes them: one a line. @param {import('./vaults.js').Op[]} ops */
	const lines = (ops) => `[\n${ops.map((o) => `  ${JSON.stringify(o)}`).join(',\n')}\n]`;

	let what = $state(/** @type {'entry' | 'rule' | 'all'} */ ('rule'));
	let types = $state('todo');
	let tagged = $state('');
	let untagged = $state('');
	let grantee = $state('');
	/** the built-in group it gives, by name, or `''` for a group of its own */
	let group = $state('Viewer');
	let name = $state('');
	/** a group of its own's ops, as JSON: what the builder adds to and takes from, and what a person may write */
	let json = $state(lines([{ op: 'read' }]));
	/** the op the builder adds next, and the field, the values and the tags it names */
	let adding = $state('set');
	let field = $state('');
	let values = $state(/** @type {unknown[]} */ ([]));
	let asks = $state('');
	/** the schemas and lenses the vault's entries are read through (the `schemas` op), for the fields ops name */
	let lane = $state(/** @type {any} */ (null));

	// the one entry it opens on, by default: the least
	$effect.pre(() => {
		if (entry) what = 'entry';
	});

	$effect(() => {
		const v = vault;
		api.ask({ op: 'schemas', vault: v }).then((/** @type {any} */ out) => v === vault && (lane = out?.ok ?? null));
	});

	const to = $derived(grantee || others[0]?.id || EVERYONE);
	/** the groups it may give: Public alone to everyone, every other one to a vault */
	const groups = $derived(world.groups.filter((g) => g.everyone === (to === EVERYONE)));
	/** the group it gives, or none for a group of its own, which only a vault takes */
	const theGroup = $derived(
		group || to === EVERYONE
			? (groups.find((g) => g.name === group) ?? groups.find((g) => g.name === 'Viewer') ?? groups[0])
			: undefined
	);

	/** The ops it gives: the group's, or those its JSON lists, `null` while that isn't a list of ops. */
	const ops = $derived.by(() => {
		if (theGroup) return theGroup.ops;
		try {
			const xs = JSON.parse(json);
			return Array.isArray(xs) && xs.every((x) => typeof x?.op === 'string') ? xs : null;
		} catch {
			return null;
		}
	});

	/** What it picks, as a query's `where` of labels. @returns {import('./vaults.js').Where} */
	const where = $derived.by(() => {
		if (what === 'entry' && entry) return { entry: [entry] };
		if (what === 'all') return { all: [] };
		/** @type {import('./vaults.js').Atom[]} */
		const tests = [{ type: types.split(',') }];
		for (const tag of tagsIn(tagged)) tests.push({ tag });
		const not = tagsIn(untagged);
		if (not.length) tests.push({ noTag: not });
		return tests.length === 1 ? tests[0] : { all: tests };
	});

	/** The cap as the device takes it: `{name, where, ops}`, named by its group, or by hand for a group of its own. */
	const spec = $derived(ops && { name: theGroup?.name ?? name.trim(), where, ops });

	/** the fields of what it shares, each once, with the values each takes where it takes only some */
	const fields = $derived.by(() => {
		const of = what === 'entry' && one?.type ? [one.type] : what === 'all' ? ['note', 'todo'] : types.split(',');
		const all = of.flatMap((t) => fieldsOf(lane, t));
		return all.filter((f, i) => all.findIndex((g) => g.name === f.name) === i);
	});
	const valued = $derived(fields.filter((f) => f.values));
	const theField = $derived.by(() => {
		const of = adding === 'values' ? valued : fields;
		return of.find((f) => f.name === field) ?? of[0];
	});

	/** The ops the builder adds, as a person picks one; a field's only where what it shares has fields. */
	const ADD = $derived({
		set: 'change anything',
		...(fields.length ? { field: 'change one field' } : {}),
		...(valued.length ? { values: 'set one field to some values' } : {}),
		create: 'add new entries',
		tag: 'ask for tags',
		propose: 'start proposals',
		proposals: 'change anything on a proposal',
		merge: 'merge proposals into the main line',
		share: 'share it on'
	});

	/** The op the builder adds, or `null` while it names nothing. @returns {import('./vaults.js').Op | null} */
	const next = $derived.by(() => {
		if (adding === 'set') return { op: 'set' };
		if (adding === 'field') return theField ? { op: 'set', path: [theField.name] } : null;
		if (adding === 'values') {
			const to = /** @type {any[]} */ (values.filter((x) => theField?.values?.includes(/** @type {any} */ (x))));
			return theField && to.length ? { op: 'set', path: [theField.name], to } : null;
		}
		if (adding === 'tag') return tagsIn(asks).length ? { op: 'tag', tags: tagsIn(asks) } : { op: 'tag' };
		if (adding === 'proposals') return { op: 'set', on: 'proposals' };
		if (adding === 'merge') return { op: 'merge', on: 'main' };
		return /** @type {import('./vaults.js').Op} */ ({ op: adding });
	});

	function add() {
		if (!ops || !next || ops.some((o) => JSON.stringify(o) === JSON.stringify(next))) return;
		json = lines([...ops, next]);
		[values, asks] = [[], ''];
	}

	/** @param {number} i */
	const drop = (i) => ops && (json = lines(ops.filter((_, j) => j !== i)));

	/** What it reaches now, of the vault's entries the acting vault reads; and how many it can't tell. */
	const reach = $derived.by(() => {
		const of = world.entries.filter((e) => e.vault === vault);
		const known = of.filter((e) => reads(e, actor) && attrsOf(e));
		const hits = known.filter((e) => matches(where, /** @type {import('./vaults.js').Attrs} */ (attrsOf(e))));
		return { hits, unknown: of.length - known.length };
	});

	/** The cap as JSON, an op a line. */
	const shown = $derived.by(() => {
		if (!spec) return null;
		const [name, where] = [JSON.stringify(spec.name), JSON.stringify(spec.where)];
		return `{\n "name": ${name},\n "where": ${where},\n "ops": ${lines(spec.ops).replaceAll('\n', '\n ')}\n}`;
	});

	async function give() {
		if (spec && (await api.share(actor, vault, $state.snapshot(spec), to))) {
			// back to the least for the next share
			[tagged, untagged, grantee, group, name, json] = ['', '', '', 'Viewer', '', lines([{ op: 'read' }])];
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
			<option value={EVERYONE}>Everyone</option>
		</select>
	</div>
	<div class="row" role="radiogroup" aria-label="Its group of ops">
		<span class="lead">as</span>
		{#each groups as g (g.name)}
			<button
				class="btn group"
				class:on={theGroup?.name === g.name}
				role="radio"
				aria-checked={theGroup?.name === g.name}
				title={g.hint}
				onclick={() => (group = g.name)}>{g.name}</button
			>
		{/each}
		{#if to !== EVERYONE}
			<button
				class="btn group"
				class:on={!theGroup}
				role="radio"
				aria-checked={!theGroup}
				onclick={() => (group = '')}>A group of its own</button
			>
		{/if}
	</div>
	{#if !theGroup}
		<div class="row">
			<span class="lead">named</span>
			<input class="field" maxlength="64" placeholder="Tick todos done" bind:value={name} aria-label="Its name" />
		</div>
		<div class="row">
			<span class="lead">may</span>
			<select class="field" bind:value={adding} aria-label="An op to add">
				{#each Object.entries(ADD) as [k, words] (k)}<option value={k}>{words}</option>{/each}
			</select>
			{#if (adding === 'field' || adding === 'values') && theField}
				<select
					class="field"
					value={theField.name}
					onchange={(e) => (field = e.currentTarget.value)}
					aria-label="Which field"
				>
					{#each adding === 'values' ? valued : fields as f (f.name)}
						<option value={f.name}>{f.name}</option>
					{/each}
				</select>
			{/if}
			{#if adding === 'values'}
				{#each theField?.values ?? [] as x (String(x))}
					<label class="pick"><input type="checkbox" bind:group={values} value={x} /> {String(x)}</label>
				{/each}
			{:else if adding === 'tag'}
				<input class="field tags" placeholder="which (any)" bind:value={asks} aria-label="Tags to ask for" />
			{/if}
			<button class="btn" disabled={!ops || !next} onclick={add}>Add</button>
		</div>
	{/if}
	<Ops ops={ops ?? []} ondrop={theGroup ? undefined : drop} />
	{#if !theGroup}
		<textarea class="field json" rows="4" bind:value={json} aria-label="Its ops, as JSON"></textarea>
	{/if}
	<p class="soft preview">
		{spec?.name || 'Its group'} on {whereWords(where, world)}: {theGroup
			? theGroup.hint.replace(/^\w/, (c) => c.toLowerCase())
			: `it may ${ops ? opsWords(ops) : '…'}`}.
		{#if !ops}
			Its ops are a JSON list, as avenDB’s docs write them.
		{:else if levelOf(ops) === 'owner'}
			Your passkey approves it, as it lets them share it on.
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
	{#if shown}
		<details class="as-json">
			<summary class="soft">The cap, as JSON</summary>
			<pre class="mono">{shown}</pre>
		</details>
	{/if}
	<button
		class="btn primary"
		disabled={busy || !spec?.name || !spec.ops.length || (what === 'rule' && !types)}
		onclick={give}
	>
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
		min-width: 3.2rem;
		font-size: 0.86rem;
		font-weight: 600;
	}

	.tags {
		width: 9.5rem;
	}

	/* .btn.group, to outweigh the page's `.avendb .btn` */
	.btn.group {
		padding: 0.28rem 0.7rem;
	}

	.btn.group.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
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

	.as-json summary {
		font-size: 0.8rem;
		cursor: pointer;
	}

	.as-json pre {
		margin: 0.3rem 0 0;
		padding: 0.5rem 0.65rem;
		border-radius: 8px;
		background: rgb(0 0 0 / 0.04);
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
