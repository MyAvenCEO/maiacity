<!--
	An article of avenDB as the journal lays out every article on the site ($lib/blog/PostLayout.svelte): its cover
	edge to edge, its stage as the eyebrow, its title and subtitle, the vault that wrote it with its mark, when, and how
	long it takes to read, its tags, then its words, its pictures read from the vault's Library by their content hashes
	(./article.js). Its Markdown holds all of it: the subtitle is the emphasised paragraph it opens with, the cover the
	picture alone that opens it or follows the subtitle.

	Editing changes nothing of the layout: the title and the subtitle are fields set in their own type, and each block
	of the words opens where it stands as its Markdown, to change, as a click on it; a blank one goes, and one more can
	be added at the end. The cover is picked from the vault's pictures. What the person writes comes back through
	`title` and `text`, as the editor's line holds them; `onretitle` as the title is left, `onsave` on Ctrl+S or ⌘S.
	The title is a field only where the person may also rename it (`renames`).
-->
<script>
	import Cover from '$lib/blog/Cover.svelte';
	import PostLayout from '$lib/blog/PostLayout.svelte';
	import {
		blocks,
		fileNamed,
		laidOut,
		PICTURE,
		pictures,
		readingMinutes,
		render,
		withBlock,
		withNewBlock
	} from './article.js';
	import { mediaOf, whole } from './files.js';
	import Mark from './Mark.svelte';
	import { KINDS, nameOf, short } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, item: import('./vaults.js').EntryView,
	 *   title?: string, text?: string, editable?: boolean, renames?: boolean, eyebrow?: string,
	 *   back?: import('svelte').Snippet,
	 *   onretitle?: () => void, onsave?: () => void }}
	 */
	let {
		world,
		api,
		item,
		title = $bindable(''),
		text = $bindable(''),
		editable = false,
		renames = false,
		eyebrow = '',
		back,
		onretitle = () => {},
		onsave = () => {}
	} = $props();

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const author = $derived(byId.get(item.by ?? item.vault));
	const parts = $derived(laidOut(text));

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	/** the article's pictures as blob URLs, by their names, once read */
	let urls = $state(/** @type {Record<string, string>} */ ({}));
	const reading = new Set();
	$effect(() => {
		for (const name of pictures(text)) {
			const file = reading.has(name) ? undefined : fileNamed(world, item.vault, name)?.files?.[0];
			if (!file || file.len === null) continue;
			reading.add(name);
			whole(read, file, mediaOf({ name, type: '' }))
				.then((blob) => (urls = { ...urls, [name]: URL.createObjectURL(blob) }))
				.catch(() => reading.delete(name));
		}
	});
	$effect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)));
	/** @param {string} name */
	const src = (name) => urls[name] ?? '';

	/** its words after the subtitle and the cover, as one text */
	const body = $derived(parts.blocks.slice(parts.body).map((b) => b.md + b.gap).join(''));
	const html = $derived(render(body, src));
	const missing = $derived(pictures(text).filter((n) => !fileNamed(world, item.vault, n)).length);
	const date = $derived(
		item.created
			? new Date(item.created * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
			: ''
	);
	const meta = $derived(
		[author ? KINDS[author.kind] : '', date, `${readingMinutes(text)} min read`].filter(Boolean).join(' · ')
	);
	/** its own tags: not a flow's stage, nor avenDB's marks */
	const tags = $derived((item.tags ?? []).filter((t) => !t.includes(':')).map((t) => ({ id: t, label: t })));

	/** the vault's pictures, for its cover */
	const covers = $derived(
		world.entries.filter((e) => e.vault === item.vault && e.type === 'file' && !e.deleted && PICTURE.test(e.title ?? ''))
	);

	/** the block open to edit, and what it reads as the person writes; past the last block, a new one */
	let open = $state(-1);
	let draft = $state('');

	/** Open block `i` to edit, putting back the one open before. @param {number} i */
	function edit(i) {
		if (!editable) return;
		done();
		[open, draft] = [i, parts.blocks[i]?.md ?? ''];
	}

	/** Put the block open back into the text: taken out where it was left blank, added where it is new. */
	function done() {
		if (open < 0) return;
		const [i, md] = [open, draft];
		open = -1;
		if (md !== (parts.blocks[i]?.md ?? '')) text = withBlock(blocks(text), i, md);
	}

	/** The subtitle as `v`: a new block where it had none, gone where it is left blank. @param {string} v */
	function subtitled(v) {
		const md = v.trim() ? `*${v.trim()}*` : '';
		text = parts.subtitle >= 0 ? withBlock(blocks(text), parts.subtitle, md) : withNewBlock(blocks(text), 0, md);
	}

	/** The cover as picture `name`, none where it is blank. @param {string} name */
	function covered(name) {
		const md = name ? `![${parts.coverAlt}](${name})` : '';
		const b = blocks(text);
		text = parts.cover >= 0 ? withBlock(b, parts.cover, md) : withNewBlock(b, parts.subtitle + 1, md);
	}

	/** Ctrl+S or ⌘S saves, Escape leaves the block. @param {KeyboardEvent} e */
	function keys(e) {
		if ((e.metaKey || e.ctrlKey) && e.key === 's') {
			e.preventDefault();
			done();
			onsave();
		} else if (e.key === 'Escape') {
			/** @type {HTMLElement} */ (e.currentTarget).blur();
		}
	}

	/** What a block is, for the type its Markdown is set in while it is edited. @param {string} md */
	const kind = (md) =>
		/^#{1,2}\s/.test(md)
			? 'h2'
			: /^#{3,}\s/.test(md)
				? 'h3'
				: /^>/.test(md)
					? 'quote'
					: /^(```|~~~)/.test(md)
						? 'code'
						: /^!\[/.test(md)
							? 'pic'
							: 'p';

	/**
	 * Fit a field to its text, as the page it stands in grows; and put the caret in it as it opens, where `focus`.
	 * @param {HTMLTextAreaElement} el @param {{ text: string, focus?: boolean }} o
	 */
	function grow(el, o) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight}px`;
		};
		fit();
		if (o.focus) el.focus();
		el.addEventListener('input', fit);
		const resized = new ResizeObserver(fit);
		resized.observe(el);
		return {
			update: () => requestAnimationFrame(fit),
			destroy: () => {
				el.removeEventListener('input', fit);
				resized.disconnect();
			}
		};
	}
</script>

{#snippet hero()}
	{#if src(parts.coverName)}
		<Cover src={src(parts.coverName)} alt={parts.coverAlt || title} />
	{/if}
{/snippet}

{#snippet heading()}
	<textarea
		class="post-title field"
		rows="1"
		placeholder="Its title"
		aria-label="The article’s title"
		use:grow={{ text: title }}
		bind:value={title}
		onchange={onretitle}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.currentTarget.blur();
			} else keys(e);
		}}
	></textarea>
{/snippet}

{#snippet sub()}
	<textarea
		class="post-subtitle field"
		rows="1"
		placeholder="A subtitle"
		aria-label="The article’s subtitle"
		use:grow={{ text: parts.subtitleText }}
		value={parts.subtitleText}
		onchange={(e) => subtitled(e.currentTarget.value)}
		onkeydown={(e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.currentTarget.blur();
			} else keys(e);
		}}
	></textarea>
{/snippet}

{#snippet avatar()}
	{#if author}<span class="avatar"><Mark vault={author} size={48} /></span>{/if}
{/snippet}

{#snippet cover()}
	<label class="pick">
		<span>Cover</span>
		<select value={parts.coverName} onchange={(e) => covered(e.currentTarget.value)}>
			<option value="">None</option>
			{#each covers as f (f.entry)}
				<option value={f.title}>{short(f.title ?? '')}…{(f.title ?? '').split('.').pop()}</option>
			{/each}
		</select>
	</label>
{/snippet}

{#snippet words()}
	{#each parts.blocks as b, i (i)}
		{#if i >= parts.body}
			{#if open === i}
				<textarea
					class="field block-edit {kind(draft)}"
					aria-label="A block of its words, as Markdown"
					use:grow={{ text: draft, focus: true }}
					bind:value={draft}
					onblur={done}
					onkeydown={keys}
				></textarea>
			{:else}
				<!-- a block of the article's own words, its HTML shown as text (./article.js) -->
				<div
					class="block"
					role="button"
					tabindex="0"
					title="Edit this block"
					onclick={() => edit(i)}
					onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), edit(i))}
				>
					{@html render(b.md, src)}
				</div>
			{/if}
		{/if}
	{/each}
	{#if open >= parts.blocks.length}
		<textarea
			class="field block-edit p"
			placeholder="Write on"
			aria-label="A new block of its words, as Markdown"
			use:grow={{ text: draft, focus: true }}
			bind:value={draft}
			onblur={done}
			onkeydown={keys}
		></textarea>
	{:else}
		<button class="more" onclick={() => edit(parts.blocks.length)}>+ Write on</button>
	{/if}
{/snippet}

<div class="article-view" class:editing={editable}>
	{#if missing}
		<p class="missing">
			{missing === 1 ? 'A picture it names isn’t' : `${missing} pictures it names aren’t`} in the Library this device
			reads.
		</p>
	{/if}
	<PostLayout
		hero={parts.cover >= 0 && fileNamed(world, item.vault, parts.coverName) ? hero : undefined}
		back={editable ? cover : back}
		{eyebrow}
		{title}
		heading={editable && renames ? heading : undefined}
		subtitle={parts.subtitleText}
		sub={editable ? sub : undefined}
		{avatar}
		author={nameOf(author)}
		{meta}
		{tags}
		{html}
		body={editable ? words : undefined}
	/>
</div>

<style>
	/* the page an article lays out on: as wide as its column, the journal's paper behind it */
	.article-view {
		--page: 100cqw;
		container: page / inline-size;
		min-height: 100%;
		background: var(--cream);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: 17px;
		line-height: 1.55;
	}

	.missing {
		margin: 0;
		padding: 0.5rem 1.5rem;
		background: #f7ecd2;
		font-size: 0.85rem;
	}

	/* fields that read as the text they edit: the type is the title's, the subtitle's or the block's */
	.field {
		display: block;
		width: 100%;
		box-sizing: border-box;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		resize: none;
		overflow: hidden;
		outline: none;
	}

	.field::placeholder {
		color: var(--muted);
	}

	.editing :global(.post-title.field),
	.editing :global(.post-subtitle.field) {
		border-radius: 8px;
		box-shadow: 0 0 0 6px transparent;
		transition: box-shadow 0.15s;
	}

	.editing :global(.post-title.field:hover),
	.editing :global(.post-subtitle.field:hover),
	.editing :global(.post-title.field:focus),
	.editing :global(.post-subtitle.field:focus) {
		background: rgb(255 255 255 / 0.55);
		box-shadow: 0 0 0 6px rgb(255 255 255 / 0.55);
	}

	/* a block to edit: marked as the pointer finds it */
	.block {
		border-radius: 8px;
		cursor: text;
		transition: box-shadow 0.15s;
	}

	.block:hover,
	.block:focus-visible {
		outline: none;
		box-shadow: 0 0 0 0.5rem rgb(255 255 255 / 0.55);
		background: rgb(255 255 255 / 0.55);
	}

	.block-edit {
		margin: 0 0 1em;
		padding: 0.5rem 0.6rem;
		margin-inline: -0.6rem;
		width: calc(100% + 1.2rem);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 0 0 1px var(--line);
		font: inherit;
		white-space: pre-wrap;
	}

	.block-edit.h2 {
		margin-block: 2.75rem 1rem;
		font-family: var(--font-display);
		font-size: clamp(1.8rem, 3.5vw, 2.4rem);
		line-height: 1.15;
		letter-spacing: -0.03em;
	}

	.block-edit.h3 {
		margin-block: 2rem 0.75rem;
		font-family: var(--font-display);
		font-size: 1.35rem;
	}

	.block-edit.quote {
		margin-block: 2rem;
		font-family: var(--font-display);
		font-size: 1.35rem;
		line-height: 1.45;
	}

	.block-edit.code,
	.block-edit.pic {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.9rem;
	}

	.more {
		margin-top: 0.5rem;
		padding: 0.35rem 0.8rem;
		border: 1px dashed var(--line);
		border-radius: 999px;
		background: none;
		color: var(--muted);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.more:hover {
		color: var(--ink);
		border-color: var(--ink-soft);
	}

	.pick {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 2rem;
		font-size: 0.85rem;
		color: var(--ink-soft);
	}

	.pick select {
		max-width: 16rem;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
	}
</style>
