<!--
	A story's Idea tab: the sparks it grows from (its `sparks`, ./sparks.js), as a list, each to open or take out; the
	sparks of its vault to add, as many as the person picks, or a new one written here; and its sources, the artifacts
	(./artifacts.js) on their canvases and on the canvases of the sparks they hold, each with where it is from and its
	link. Each change is one op on the story's main line, for the acting vault, as the device allows it (`may`).
-->
<script>
	import Icon from './Icon.svelte';
	import { linkHref } from '$lib/markdown/index.js';
	import { allowed, creatable, may } from './ops.js';
	import { addingArtifact, ARTIFACT, entryOf, fromLink, fromWords, isArtifact } from './artifacts.js';
	import SparkRow from './SparkRow.svelte';
	import { addingSpark, fromLine, hostOf, isSpark, itemsOf, linkIn, placing, SPARK, sparkRecord } from './sparks.js';
	import { count, nameOf, reads } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world, actor, api, busy, item, writes } = $props();

	const entry = $derived(item.entry);
	const as = $derived(world.vaults.find((v) => v.id === actor));
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const linked = $derived(/** @type {string[]} */ (/** @type {any} */ (item.record)?.sparks ?? []));
	/** the sparks it names that this browser holds, and how many it doesn't */
	const sparks = $derived(linked.flatMap((s) => byId.get(s) ?? []));
	const missing = $derived(linked.length - sparks.length);
	/** its sources: the artifacts on the canvases of the sparks it grows from, and of the sparks those hold, in turn */
	const sources = $derived.by(() => {
		const seen = new Set();
		const out = new Map();
		const stack = [...linked];
		while (stack.length) {
			const s = stack.pop() ?? '';
			if (seen.has(s)) continue;
			seen.add(s);
			for (const it of itemsOf(byId.get(s))) {
				const e = byId.get(entryOf(it.ref));
				if (it.what === 'spark') stack.push(entryOf(it.ref));
				else if (it.what === 'artifact' && e && isArtifact(e) && !e.deleted) out.set(e.entry, e);
			}
		}
		return [...out.values()];
	});
	/** the sparks of its vault it doesn't grow from yet */
	const others = $derived(
		world.entries
			.filter((e) => e.vault === item.vault && isSpark(e) && !e.deleted && reads(e, actor) && !linked.includes(e.entry))
			.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
	);

	/** whether the acting vault's ops let it add and take out sparks, and add a new spark, as the device says */
	let links = $state(false);
	let asked = $state(/** @type {string[] | null} */ (null));
	let askedArtifact = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		const probe = others[0]?.entry ?? linked[0] ?? entry;
		if (writes) may(api, actor, [{ op: 'insert', entry, path: ['sparks'], value: probe }]).then(([a]) => !gone && (links = allowed(a)));
		else links = false;
		creatable(api, actor, item.vault, SPARK).then((t) => !gone && (asked = t));
		creatable(api, actor, item.vault, ARTIFACT).then((t) => !gone && (askedArtifact = t));
		return () => {
			gone = true;
		};
	});

	let adding = $state(false);
	let filter = $state('');
	let chosen = $state(/** @type {string[]} */ ([]));
	const listed = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		return q ? others.filter((o) => `${o.title ?? ''} ${o.text ?? ''}`.toLowerCase().includes(q)) : others;
	});

	/** Adds the sparks chosen, in one write. */
	async function add() {
		if (!chosen.length) return;
		const ops = chosen.map((s) => ({ op: 'insert', entry, path: ['sparks'], value: s }));
		const what = chosen.length === 1 ? 'Adding the spark' : `Adding ${count(chosen.length, 'spark')}`;
		if (await api.run(what, { op: 'batch', as: actor, ops })) [chosen, adding, filter] = [[], false, ''];
	}

	/** Takes spark `s` out of the sparks it grows from. @param {string} s */
	const takeOut = (s) => api.run('Taking the spark out', { op: 'remove', as: actor, entry, path: ['sparks'], value: s });

	let line = $state('');

	/** A new spark of the line typed, a link or a thought, in its vault, that the story grows from at once. */
	async function write() {
		const t = line.trim();
		if (!t || !asked) return;
		const u = linkIn(t);
		const at = { ...placing([], 1)[0], id: 1 };
		const ops =
			u && askedArtifact !== null
				? [
						{ ...addingArtifact(item.vault, fromLink(u), askedArtifact), as: actor },
						{ ...addingSpark(item.vault, sparkRecord(fromLink(u).title, '', [{ ...at, what: 'artifact', ref: { vault: item.vault, entry: '$0' } }]), asked), as: actor },
						{ op: 'insert', as: actor, entry, path: ['sparks'], value: '$1' }
					]
				: [
						{ ...addingSpark(item.vault, fromLine(t), asked), as: actor },
						{ op: 'insert', as: actor, entry, path: ['sparks'], value: '$0' }
					];
		if (await api.runAll('Adding the spark', ops)) line = '';
	}
</script>

<section class="idea" aria-label="The sparks it grows from">
	<header>
		<h3>The sparks it grows from <small class="soft">{linked.length || ''}</small></h3>
		{#if links}
			<button class="btn" class:primary={!adding} onclick={() => (adding = !adding)}>
				<Icon name={adding ? 'close' : 'plus'} size={14} />
				{adding ? 'Done' : 'Add sparks'}
			</button>
		{/if}
	</header>

	{#if sparks.length}
		<ul class="linked">
			{#each sparks as s (s.entry)}
				<SparkRow {world} {api} item={s} onremove={links && !busy ? () => takeOut(s.entry) : undefined} />
			{/each}
		</ul>
	{:else}
		<p class="soft">
			None yet. A story grows from its sparks, each a canvas of artifacts and notes.
			{links ? 'Add some of the vault’s, or write a new one below.' : ''}
		</p>
	{/if}
	{#if missing}<p class="soft">{count(missing, 'more spark')} it names this browser doesn’t hold.</p>{/if}

	{#if adding}
		<div class="adding">
			<input class="field" bind:value={filter} placeholder="Find a spark" aria-label="Find a spark" />
			{#if listed.length}
				<ul class="choose">
					{#each listed as o (o.entry)}
						{@const on = chosen.includes(o.entry)}
						<li>
							<label class:on>
								<input
									type="checkbox"
									checked={on}
									onchange={(e) =>
										(chosen = e.currentTarget.checked ? [...chosen, o.entry] : chosen.filter((c) => c !== o.entry))}
								/>
								<span><b>{o.title || 'Untitled'}</b>{#if o.text}<small class="soft">{o.text}</small>{/if}</span>
							</label>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="soft">{others.length ? 'No spark matches.' : 'Every spark of this vault is in it already.'}</p>
			{/if}
			<button class="btn primary" disabled={busy || !chosen.length} onclick={add}
				>Add {chosen.length ? count(chosen.length, 'spark') : 'them'}</button
			>
		</div>
	{/if}

	{#if links && asked}
		<form class="new" onsubmit={(e) => (e.preventDefault(), write())}>
			<input class="field" bind:value={line} placeholder="A new spark for it: paste a link or write a line" aria-label="A new spark" />
			<button class="btn" disabled={busy || !line.trim()}>Add</button>
		</form>
	{/if}

	{#if writes && !links}
		<p class="soft">{nameOf(as)}’s share doesn’t let it change the sparks it grows from.</p>
	{/if}

	<h3>Sources</h3>
	{#if sources.length}
		<ol class="sources">
			{#each sources as s (s.entry)}
				{@const r = /** @type {any} */ (s.record) ?? {}}
				<li>
					<a href="#artifacts/{s.entry}">{s.title || 'Untitled'}</a>
					{#if fromWords(r)}<span class="soft"> · {fromWords(r)}</span>{/if}
					{#if r.url}
						<a class="out" href={linkHref(r.url)} target="_blank" rel="noopener noreferrer">{hostOf(r.url)} <Icon name="out" size={12} /></a>
					{/if}
				</li>
			{/each}
		</ol>
	{:else}
		<p class="soft">The artifacts on its sparks’ canvases are listed here, as the sources it cites.</p>
	{/if}
</section>

<style>
	.idea {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-top: 1rem;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h3 {
		margin: 0.4rem 0 0;
		font-size: 0.92rem;
	}

	header h3 {
		margin: 0;
	}

	h3 small {
		font-weight: 400;
	}

	header .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.linked {
		margin: 0;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		list-style: none;
	}

	p {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.adding {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fbfaf7;
	}

	.adding .btn {
		align-self: flex-start;
	}

	.choose {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 16rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.choose label {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 0.84rem;
		cursor: pointer;
	}

	.choose label.on {
		border-color: var(--accent);
		background: #eef6f4;
	}

	.choose span {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.choose small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.new {
		display: flex;
		gap: 0.4rem;
	}

	.new .field {
		flex: 1;
		min-width: 0;
	}

	.sources {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding-left: 1.3rem;
		font-size: 0.86rem;
		line-height: 1.45;
	}

	.sources a {
		color: inherit;
	}

	.out {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		margin-left: 0.4rem;
		color: var(--accent) !important;
		font-size: 0.8rem;
	}
</style>
