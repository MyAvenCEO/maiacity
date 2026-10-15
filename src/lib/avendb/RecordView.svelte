<!--
	A record opened down its rows and through its links, as the studio's table opens a row of it (./TableEditor.svelte):
	the place it is at (`trail`: each list's field and a row of it by its id, each link followed), in words, and what is
	there, field by field. A list of records shows its rows, each to open in turn; a link shows what it leads to, a
	level at a time, as the device's `query` follows it (`follow`, avendb/docs/ARCHITECTURE.md §8): the record or the
	row of another entry, at its newest or at the version it is pinned at, or why it opens nothing there (an entry the
	acting device doesn't read, another vault's, a version or a row it doesn't hold, or deeper than a query reads). The
	device opens only what it reads: the page asks it for every hop.
-->
<script>
	// @ts-nocheck — plain JS
	import { read } from './ops.js';
	import { at, isLink, isLinks, isRows, pathWords, trailQuery, valueWords } from './paths.js';
	import { count, short } from './vaults.js';

	/** @typedef {string | number | { id: number } | { to: true }} Hop */

	/** @type {{ api: any, entry: string, record: Record<string, unknown> | null, trail: Hop[] }} */
	let { api, entry, record, trail = $bindable([]) } = $props();

	/** Whether step `s` follows a link. @param {Hop} s @returns {s is { to: true }} */
	const hop = (s) => typeof s === 'object' && 'to' in s;

	/** the query that shows the trail's end: the links it follows, and how many levels down it reads */
	const asked = $derived(trailQuery(trail));

	/** the record with every link the trail follows followed, as the device answers its query; null while it hasn't */
	let followed = $state(/** @type {Record<string, unknown> | null} */ (null));
	$effect(() => {
		const [e, { follow, depth }] = [entry, $state.snapshot(asked)];
		followed = null;
		if (!follow.length) return;
		let gone = false;
		read(api, { op: 'query', where: { entry: [e] }, follow, depth }, null).then((/** @type {any} */ out) => {
			if (!gone) followed = out?.rows?.[0]?.record ?? {};
		});
		return () => {
			gone = true;
		};
	});

	const shown = $derived(asked.follow.length ? followed : record);
	/** what is at the trail's end: a record or a row, or a link the trail followed */
	const here = $derived(shown ? at(shown, /** @type {any} */ (trail)) : undefined);
	/** the link the trail's last hop followed, where its last step is one */
	const link = $derived.by(() => {
		if (!shown || !trail.length || !hop(trail[trail.length - 1])) return undefined;
		const l = at(shown, /** @type {any} */ (trail.slice(0, -1)));
		return isLink(l) ? l : undefined;
	});

	/** The trail, a place at a time, in words: each list's rows and each hop, to go back to. */
	const crumbs = $derived.by(() => {
		/** @type {{ words: string, upto: number }[]} */
		const out = [];
		/** @type {unknown[]} */
		let from = [];
		trail.forEach((s, i) => {
			if (hop(s)) {
				const l = shown ? at(shown, /** @type {any} */ (trail.slice(0, i))) : undefined;
				const to = isLink(l) ? `entry ${short(l.entry)}` : 'its link';
				out.push({ words: `${pathWords(/** @type {any} */ (from))} → ${to}`, upto: i + 1 });
				from = [];
			} else {
				from.push(s);
				if (typeof s === 'object') out.push({ words: pathWords(/** @type {any} */ (from)), upto: i + 1 });
			}
		});
		return out;
	});

	/** Opens the steps `more`, from the place it is at. @param {Hop[]} more */
	const go = (...more) => (trail = [...trail, ...more]);

	/** A row's fields that aren't lists, the first few, for its line. @param {Record<string, unknown>} r */
	const line = (r) =>
		Object.entries(r)
			.filter(([k, v]) => k !== 'id' && !isRows(v) && !isLink(v))
			.slice(0, 3)
			.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
			.join(' · ');
</script>

<div class="record">
	<nav class="crumbs" aria-label="Where in the record">
		<button class="btn quiet" onclick={() => (trail = [])}>The record</button>
		{#each crumbs as c (c.upto)}
			<span aria-hidden="true">›</span>
			<button class="btn quiet" disabled={c.upto === trail.length} onclick={() => (trail = trail.slice(0, c.upto))}
				>{c.words}</button
			>
		{/each}
	</nav>

	{#if asked.follow.length && followed === null}
		<p class="soft">Following…</p>
	{:else if link?.empty}
		<p class="empty">
			<b>It opens nothing there</b> ({link.empty}): {link.why ?? 'the device says no more'}.
		</p>
	{:else if here === undefined || here === null || typeof here !== 'object' || Array.isArray(here)}
		<p class="soft">Nothing there now: {here === undefined ? 'the record holds no such place' : valueWords(here)}.</p>
	{:else}
		{#if link}
			<p class="soft">
				{link.row?.length ? `${pathWords(/** @type {any} */ (link.row))} of entry` : 'Entry'}
				<span class="mono">{short(link.entry)}</span>{link.at ? ', at the version it is pinned at' : ', at its newest'}.
			</p>
		{/if}
		<div class="fields">
			{#each Object.entries(here) as [name, v] (name)}
				<div class="f" data-col={name}>
					<div class="fh"><code>{name}</code></div>
					{#if isRows(v)}
						{#if v.length}
							<ul class="rows">
								{#each v as r (r.id)}
									<li>
										<button class="btn quiet" onclick={() => go(name, { id: r.id })}>row {r.id}</button>
										<small class="soft">{line(r)}</small>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="null">no rows</p>
						{/if}
					{:else if isLink(v)}
						<p class="val">
							{valueWords(v)}
							<button class="btn quiet" onclick={() => go(name, { to: true })}>Follow</button>
						</p>
					{:else if isLinks(v)}
						<ul class="rows">
							{#each v as l, i (i)}
								<li>
									<button class="btn quiet" onclick={() => go(name, i, { to: true })}>Follow</button>
									<small class="soft">{valueWords(l)}</small>
								</li>
							{/each}
						</ul>
					{:else if v === null || v === undefined}
						<p class="null">NULL</p>
					{:else if typeof v === 'object'}
						<pre class="json">{JSON.stringify(v, null, 2)}</pre>
					{:else}
						<p class="val">{String(v) || 'EMPTY'}</p>
					{/if}
				</div>
			{/each}
		</div>
		<p class="soft hint">{count(Object.keys(here).length, 'field')} here.</p>
	{/if}
</div>

<style>
	.record {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		margin-bottom: 1rem;
	}

	.crumbs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.8rem;
	}

	.crumbs .btn {
		padding: 0.15rem 0.4rem;
		font-size: 0.8rem;
	}

	.fields {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.fh code {
		font-size: 0.8rem;
		font-weight: 600;
	}

	.val {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.45rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rows li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		overflow-wrap: anywhere;
	}

	.null {
		margin: 0;
		color: rgb(0 0 0 / 0.35);
		font-size: 0.75rem;
	}

	.empty {
		margin: 0;
		padding: 0.5rem 0.7rem;
		border-left: 3px solid #c99a3a;
		background: #fbf6ea;
		font-size: 0.85rem;
	}

	pre.json {
		max-height: 20rem;
		overflow: auto;
		margin: 0;
		padding: 0.6rem 0.7rem;
		border-radius: 8px;
		background: #23302a;
		color: #e8efe6;
		font-size: 0.74rem;
	}

	.hint {
		margin: 0;
		font-size: 0.78rem;
	}
</style>
