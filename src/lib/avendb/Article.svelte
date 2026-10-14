<!--
	One article to read, the whole screen, as a magazine prints a story: its title, the vault that wrote it, with its
	mark, and when, both from its first signed edit, whether everyone may read it, and its text as Markdown, its
	pictures read from the vault's Library by their content hashes (./article.js). Edit opens it as a note opens
	(Note), to edit, propose, merge, make a variant of and go back through its history; the text shown is its main
	line's.
-->
<script>
	import { fileNamed, pictures, render } from './article.js';
	import { mediaOf, whole } from './files.js';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { count, nameOf, sharedWith, sharedWords } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, entry: string }} */
	let { world, actor, api, entry } = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const item = $derived(world.entries.find((e) => e.entry === entry));
	const author = $derived(item && byId.get(item.by));
	/** whether the acting vault may change it: its own vault, or a cap that lets it write */
	const writes = $derived(!!item && (item.writers ?? []).includes(actor));

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	/** the article's pictures as blob URLs, by their names, once read; and why one wasn't */
	let urls = $state(/** @type {Record<string, string>} */ ({}));
	const reading = new Set();
	$effect(() => {
		if (!item) return;
		for (const name of pictures(item.text ?? '')) {
			const file = reading.has(name) ? undefined : fileNamed(world, item.vault, name)?.files?.[0];
			if (!file || file.len === null) continue;
			reading.add(name);
			whole(read, file, mediaOf({ name, type: '' }))
				.then((blob) => (urls = { ...urls, [name]: URL.createObjectURL(blob) }))
				.catch(() => reading.delete(name));
		}
	});
	$effect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)));

	const html = $derived(item ? render(item.text ?? '', (name) => urls[name] ?? '') : '');
	const missing = $derived(item ? pictures(item.text ?? '').filter((n) => !fileNamed(world, item.vault, n)).length : 0);

	/** When it was written, in words. @param {number | null | undefined} at */
	const when = (at) =>
		at ? new Date(at * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
</script>

<div class="doc">
	<header class="top">
		<a class="back" href="#articles" title="All articles" aria-label="All articles"><Icon name="back" size={20} /></a>
		<span class="docicon" aria-hidden="true"><Icon name="article" size={24} /></span>
		<p class="where">{item ? nameOf(byId.get(item.vault)) : ''}</p>
		<div class="tools">
			{#if item}
				<a class="btn primary" href="#articles/{entry}/edit">
					{writes ? 'Edit' : 'Its history'}{item.proposals ? ` · ${count(item.proposals, 'proposal')}` : ''}
				</a>
			{/if}
		</div>
	</header>

	<div class="scroll">
		{#if !item}
			<p class="soft page">This device holds no such article, or can’t read it.</p>
		{:else}
			<article class="page">
				<h1>{item.title}</h1>
				<p class="byline">
					{#if author}<Mark vault={author} size={30} />{/if}
					<span>
						By <b>{nameOf(author)}</b>{item.created ? `, ${when(item.created)}` : ''}
						<small class="soft">
							{count(item.edits ?? 0, 'edit')} · Shared with {sharedWords(sharedWith(world, item.vault, entry))}
						</small>
					</span>
					{#if item.public}<span class="chip">Public</span>{/if}
				</p>
				{#if missing}
					<p class="soft">
						{count(missing, 'picture')} it names {missing === 1 ? 'isn’t' : 'aren’t'} in the Library this device reads.
					</p>
				{/if}
				<!-- the article's own HTML is shown as text, its links and pictures only the safe ones (./article.js) -->
				<div class="text">{@html html}</div>
			</article>
		{/if}
	</div>
</div>

<style>
	.doc {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: #f6f3ec;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: calc(0.7rem + env(safe-area-inset-top, 0px)) 1rem 0.7rem;
		border-bottom: 1px solid var(--edge);
		background: #fff;
	}

	.back {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: inherit;
	}

	.back:hover {
		background: #efece4;
	}

	.docicon {
		color: var(--accent);
	}

	.where {
		flex: 1;
		margin: 0;
		font-size: 0.86rem;
		color: var(--soft);
	}

	.tools .btn {
		text-decoration: none;
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 2rem 1rem 8rem;
	}

	.page {
		max-width: 44rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0 0 1rem;
		font-size: clamp(1.6rem, 4vw, 2.3rem);
		line-height: 1.2;
	}

	.byline {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin: 0 0 1.6rem;
		font-size: 0.9rem;
	}

	.byline span {
		display: flex;
		flex-direction: column;
	}

	.byline small {
		font-size: 0.76rem;
	}

	.text {
		font-size: 1.04rem;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}

	.text :global(h2) {
		margin: 2rem 0 0.6rem;
		font-size: 1.35rem;
		line-height: 1.3;
	}

	.text :global(h3) {
		margin: 1.6rem 0 0.5rem;
		font-size: 1.1rem;
	}

	.text :global(p) {
		margin: 0 0 1rem;
	}

	.text :global(figure) {
		margin: 1.4rem 0;
	}

	.text :global(img) {
		display: block;
		width: 100%;
		min-height: 6rem;
		border-radius: 10px;
		background: #e9e4d9;
		object-fit: cover;
	}

	.text :global(figcaption) {
		margin-top: 0.45rem;
		font-size: 0.82rem;
		color: var(--soft);
	}

	.text :global(blockquote) {
		margin: 1rem 0;
		padding: 0.2rem 1rem;
		border-left: 3px solid var(--accent);
		color: #4a4a44;
	}

	.text :global(hr) {
		margin: 2rem 0;
		border: 0;
		border-top: 1px solid var(--edge);
	}

	.text :global(table) {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	.text :global(th),
	.text :global(td) {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--edge);
		text-align: left;
	}

	.text :global(.unshown) {
		font-style: italic;
		color: var(--soft);
	}
</style>
