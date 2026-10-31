<script>
	// The decision log (brain/DECISIONS.md) as a view of its own (A203): every row a card, its title the decision's bold
	// first sentence, the rest folded under it; what it supersedes and what supersedes it linked both ways; a search over
	// every row's text, filters by who decided and by the list an id is numbered in, and "only what still stands",
	// which hides a row a later one supersedes wholly. #/brain/decisions/<id> opens and marks one row. The rows are
	// brain.js's reading of markdown-runtime's checked tree of the file; nothing here parses Markdown.
	import Node from './Node.svelte';

	let { log, selected = null } = $props();

	let query = $state('');
	let by = $state('all');
	let list = $state('all');
	let standing = $state(false);

	const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
	const shown = $derived(
		log.rows.filter((r) => (by === 'all' || r.by === by) && (list === 'all' || r.list === list) && (!standing || r.stands) && words.every((w) => r.text.includes(w))),
	);
	const names = { A: 'A, the one sequence', rule: 'The index’s rules', 'caps D': 'caps D', 'caps E': 'caps E' };

	// a row asked for by its id: shown whatever the filters, opened, marked and scrolled to
	$effect(() => {
		if (!selected) return;
		const row = log.rows.find((r) => r.slug === selected);
		if (!row) return;
		if (!shown.includes(row)) {
			query = '';
			by = 'all';
			list = 'all';
			standing = false;
		}
		queueMicrotask(() => {
			const card = document.getElementById(`d-${row.slug}`);
			if (!card) return;
			card.open = true;
			card.scrollIntoView({ block: 'start' });
		});
	});
</script>

<div class="log" id="log" data-testid="decisions">
	<form class="find" role="search" onsubmit={(e) => e.preventDefault()}>
		<label class="search">
			<span>Search the decisions</span>
			<input type="search" bind:value={query} placeholder="A word, a name or an id: nulls, keyring, A192" data-testid="decisions-search" />
		</label>
		<div class="filters">
			<label>
				<span>Decided by</span>
				<select bind:value={by} data-testid="decisions-by">
					<option value="all">Anyone</option>
					<option value="Samuel">Samuel</option>
					<option value="avenMAIA">avenMAIA</option>
				</select>
			</label>
			<label>
				<span>List</span>
				<select bind:value={list} data-testid="decisions-list">
					<option value="all">Every list</option>
					{#each log.lists as l (l)}<option value={l}>{names[l] ?? l}</option>{/each}
				</select>
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={standing} data-testid="decisions-standing" />
				<span>Only what still stands</span>
			</label>
		</div>
		<p class="count" aria-live="polite" data-testid="decisions-count">{shown.length} of {log.rows.length} decisions</p>
	</form>

	<ol class="rows">
		{#each shown as row (row.id)}
			<li>
				<details class="card" id={`d-${row.slug}`} class:here={row.slug === selected} class:gone={!row.stands} data-testid="decision">
					<summary>
						<span class="id">{row.id}</span>
						<span class="title">{row.title}</span>
						<span class="meta">{row.when} · <span class={row.by === 'Samuel' ? 'samuel' : 'maia'}>{row.by}</span>{#if !row.stands} · superseded{/if}</span>
					</summary>
					<div class="body">
						<p>{#each row.decision as node, i (i)}<Node {node} />{/each}</p>
						{#if row.replaces.length}
							<p class="rel"><span class="label">Supersedes</span> {#each row.supersedes as node, i (i)}<Node {node} />{/each}</p>
						{:else if !/^—\s*$/.test(row.supersedes.map((n) => (typeof n === 'string' ? n : '')).join(''))}
							<p class="rel"><span class="label">Related</span> {#each row.supersedes as node, i (i)}<Node {node} />{/each}</p>
						{/if}
						{#if row.later.length}
							<p class="rel">
								<span class="label">Superseded by</span>
								{#each row.later as x, i (x.id)}{i ? ', ' : ''}<a href={`#/brain/decisions/${x.slug}`}>{x.id}</a>{x.partly ? ' (in part)' : ''}{/each}
							</p>
						{/if}
						<p class="rel"><a href={`#/brain/decisions/${row.slug}`}>Link to this decision</a></p>
					</div>
				</details>
			</li>
		{:else}
			<li class="none">No decision matches.</li>
		{/each}
	</ol>
</div>

<style>
	.log {
		margin-top: 28px;
	}

	.find {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		gap: 10px;
		padding: 14px 16px;
		background: var(--brain-card);
		border: 1px solid var(--brain-line);
		border-radius: var(--brain-radius);
	}

	.find label {
		display: grid;
		gap: 4px;
		font: 700 12px/1.3 var(--brain-sans);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.find input[type='search'],
	.find select {
		min-width: 0;
		padding: 8px 10px;
		color: var(--brain-navy);
		font: 400 16px/1.3 var(--brain-sans);
		letter-spacing: 0;
		text-transform: none;
		background: var(--brain-cream);
		border: 1px solid var(--brain-quiet);
		border-radius: 10px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 16px;
		align-items: end;
	}

	.filters label {
		flex: 1 1 140px;
	}

	.find .check {
		display: flex;
		gap: 8px;
		align-items: center;
		padding-bottom: 8px;
		text-transform: none;
		letter-spacing: 0;
		font-size: 15px;
	}

	.count {
		margin: 0;
		color: var(--brain-quiet);
		font-size: 14px;
	}

	.rows {
		display: grid;
		gap: 8px;
		margin: 16px 0 0;
		padding: 0;
		list-style: none;
	}

	.card {
		scroll-margin-top: 220px;
		background: var(--brain-card);
		border: 1px solid var(--brain-line);
		border-radius: 12px;
	}

	.card.here {
		box-shadow: inset 4px 0 0 var(--brain-ochre);
	}

	summary {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		padding: 10px 14px;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.id {
		grid-row: span 2;
		align-self: start;
		min-width: 3.6em;
		padding: 2px 8px;
		color: var(--brain-navy);
		font: 800 13px/1.5 var(--brain-sans);
		text-align: center;
		white-space: nowrap;
		background: var(--brain-line);
		border-radius: 8px;
	}

	.title {
		font: 700 15px/1.4 var(--brain-sans);
	}

	.meta {
		color: var(--brain-quiet);
		font-size: 13px;
	}

	.samuel {
		color: var(--brain-teal-ink);
		font-weight: 700;
	}

	.maia {
		color: var(--brain-ochre-ink);
		font-weight: 700;
	}

	.gone .title {
		color: var(--brain-quiet);
	}

	.body {
		padding: 0 14px 12px;
		font-size: 15px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}

	.body p {
		margin: 8px 0 0;
	}

	.rel {
		font-size: 14px;
	}

	.label {
		margin-right: 4px;
		font: 800 12px/1.3 var(--brain-sans);
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.body :global(a),
	.rel a {
		color: var(--brain-teal-ink);
		text-decoration-color: var(--brain-ochre);
		text-decoration-style: dotted;
		text-decoration-thickness: 2px;
		text-underline-offset: 3px;
	}

	.body :global(code) {
		padding: 1px 5px;
		font-size: 0.88em;
		background: var(--brain-line);
		border-radius: 4px;
	}

	.none {
		padding: 20px;
		color: var(--brain-quiet);
	}
</style>
