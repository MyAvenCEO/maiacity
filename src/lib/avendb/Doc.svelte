<!--
	A document as an app shows it: its blocks rendered (headings, paragraphs, items to check, code) and its tags; and,
	where the app may edit it, the block editor: add, edit, move, delete and change the type of each block, rename it,
	tag it. Either app's blocks: v1 names a block's kind (h1 to code), v2 its type and level, and v1 has no tags.
-->
<script>
	import { KIND_NAMES, KINDS, inline, kindOf, newId, withKind } from './ui.js';

	/** @typedef {import('./ui.js').Block} Block */

	/**
	 * @type {{
	 *   value: any,
	 *   app?: string,
	 *   editable?: boolean,
	 *   onsave?: (value: any) => Promise<boolean>
	 * }}
	 */
	let { value, app = 'v2', editable = false, onsave } = $props();

	let editing = $state(false);
	let saving = $state(false);
	/** @type {any} */
	let draft = $state(null);
	let tags = $state('');

	const blocks = $derived(/** @type {Block[]} */ (value?.blocks ?? []));

	function edit() {
		draft = JSON.parse(JSON.stringify(value ?? {}));
		draft.blocks ??= [];
		tags = (draft.tags ?? []).join(', ');
		editing = true;
	}

	async function save() {
		if (!onsave) return;
		const next = { ...draft };
		if (app !== 'v1') next.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
		saving = true;
		const ok = await onsave(next);
		saving = false;
		if (ok) editing = false;
	}

	/** @param {number} at @param {import('./ui.js').BlockKind} kind */
	function add(at, kind = 'p') {
		const block = withKind({ id: newId(draft.blocks), text: '' }, kind, app);
		draft.blocks.splice(at, 0, block);
	}

	/** @param {number} at @param {number} by */
	function move(at, by) {
		const to = at + by;
		if (to < 0 || to >= draft.blocks.length) return;
		const [b] = draft.blocks.splice(at, 1);
		draft.blocks.splice(to, 0, b);
	}

	/** @param {number} at @param {import('./ui.js').BlockKind} kind */
	const retype = (at, kind) => (draft.blocks[at] = withKind(draft.blocks[at], kind, app));
</script>

{#if editing && draft}
	<div class="editor">
		<input class="field title" bind:value={draft.title} placeholder="Title" />
		{#each draft.blocks as b, i (b.id)}
			<div class="block">
				<select class="field" value={kindOf(b)} onchange={(e) => retype(i, /** @type {any} */ (e.currentTarget.value))}>
					{#each KINDS as k (k)}<option value={k}>{KIND_NAMES[k]}</option>{/each}
				</select>
				{#if kindOf(b) === 'li' && app !== 'v1'}
					<input type="checkbox" bind:checked={b.checked} aria-label="Checked" />
				{/if}
				<textarea class="field" class:code={kindOf(b) === 'code'} rows={kindOf(b) === 'code' ? 3 : 1} bind:value={b.text}></textarea>
				<div class="tools">
					<button class="btn quiet" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Move up">↑</button>
					<button class="btn quiet" disabled={i === draft.blocks.length - 1} onclick={() => move(i, 1)} aria-label="Move down">↓</button>
					<button class="btn quiet" onclick={() => add(i + 1)} aria-label="Add a block below">+</button>
					<button class="btn quiet danger" onclick={() => draft.blocks.splice(i, 1)} aria-label="Delete">✕</button>
				</div>
			</div>
		{/each}
		<div class="row">
			<button class="btn" onclick={() => add(draft.blocks.length)}>Add a paragraph</button>
			<button class="btn" onclick={() => add(draft.blocks.length, 'h2')}>Add a heading</button>
			<button class="btn" onclick={() => add(draft.blocks.length, 'li')}>Add an item</button>
		</div>
		{#if app !== 'v1'}
			<label class="tags">Tags <input class="field" bind:value={tags} placeholder="greenhouse, spring" /></label>
		{/if}
		<div class="row">
			<button class="btn primary" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</button>
			<button class="btn quiet" onclick={() => (editing = false)}>Cancel</button>
		</div>
	</div>
{:else}
	<article class="doc">
		{#if value?.title}<p class="doc-title">{value.title}</p>{/if}
		{#each blocks as b (b.id)}
			{@const k = kindOf(b)}
			{#if k === 'h1'}
				<h2>{@html inline(b.text)}</h2>
			{:else if k === 'h2'}
				<h3>{@html inline(b.text)}</h3>
			{:else if k === 'h3'}
				<h4>{@html inline(b.text)}</h4>
			{:else if k === 'li'}
				<p class="item"><span class="box" class:checked={b.checked}>{b.checked ? '✓' : ''}</span>{@html inline(b.text)}</p>
			{:else if k === 'code'}
				<pre><code>{b.text}</code></pre>
			{:else}
				<p>{@html inline(b.text)}</p>
			{/if}
		{:else}
			<p class="soft">No blocks yet.</p>
		{/each}
		{#if value?.tags?.length}
			<div class="row">{#each value.tags as t (t)}<span class="chip">#{t}</span>{/each}</div>
		{/if}
	</article>
	{#if editable}
		<button class="btn" onclick={edit}>Edit</button>
	{/if}
{/if}

<style>
	.doc {
		max-width: 70ch;
		margin-bottom: 1rem;
		padding: 1.1rem 1.3rem;
		border: 1px solid var(--edge);
		border-radius: 14px;
		background: #fff;
		line-height: 1.6;
	}

	.doc-title {
		margin: 0 0 0.6rem;
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--soft);
	}

	.doc h2,
	.doc h3,
	.doc h4 {
		margin: 0.9rem 0 0.4rem;
	}

	.doc h2 {
		font-size: 1.6rem;
	}

	.doc h3 {
		font-size: 1.25rem;
	}

	.doc h4 {
		font-size: 1.05rem;
	}

	.doc p {
		margin: 0 0 0.6rem;
	}

	.doc :global(code) {
		padding: 0.05rem 0.3rem;
		border-radius: 5px;
		background: rgb(0 0 0 / 0.06);
		font-size: 0.86em;
	}

	.doc pre {
		overflow: auto;
		padding: 0.7rem 0.9rem;
		border-radius: 10px;
		background: #23302a;
		color: #eef0e8;
	}

	.doc pre code {
		background: none;
		padding: 0;
	}

	.item {
		display: flex;
		gap: 0.5rem;
		align-items: baseline;
	}

	.box {
		flex: none;
		display: inline-grid;
		place-items: center;
		width: 1rem;
		height: 1rem;
		border: 1.5px solid rgb(0 0 0 / 0.35);
		border-radius: 4px;
		font-size: 0.7rem;
		transform: translateY(0.12rem);
	}

	.box.checked {
		border-color: var(--ok);
		background: var(--ok);
		color: #fff;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: 52rem;
	}

	.title {
		font-size: 1.05rem;
		font-weight: 600;
	}

	.block {
		display: grid;
		grid-template-columns: 8.5rem auto minmax(0, 1fr) auto;
		gap: 0.4rem;
		align-items: start;
	}

	.block textarea {
		min-height: 2.2rem;
		resize: vertical;
		font-family: inherit;
	}

	.block textarea.code {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
	}

	.tools {
		display: flex;
	}

	.tools .btn {
		padding: 0.3rem 0.45rem;
	}

	.tags {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		font-size: 0.86rem;
	}

	.tags input {
		flex: 1;
	}

	@media (max-width: 700px) {
		.block {
			grid-template-columns: 1fr auto;
		}

		.block textarea {
			grid-column: 1 / -1;
		}
	}
</style>
