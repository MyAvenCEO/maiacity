<!--
	A vault's Library: every file of the vault the acting vault reads, as a media app lists them, by kind (films,
	images, SVGs, PDFs, audio, other), the deleted ones apart; each a tile with a preview where it is a picture, its
	size, who added it and who it is shared with. A click opens it on the whole screen: a film or a song plays as the
	browser's player asks for it, a range at a time, streamed from the device through a service worker (./files.js), or
	read whole where none runs;
	a picture, an SVG or a PDF shows whole; any file saves. Files dropped on the page, or picked, go into the vault one
	by one: each sealed under a key of its own on this device as it is read, a megabyte at a time, then an entry that
	brings it, which syncs as any edit does, so the person's other devices and avenDB's server fetch its sealed bytes and
	open them with the key in the edit. A vault other than this one adds a file only through a cap with write on a
	slice that holds it, tagged as its slice asks (`creatable`), and where the ops of that cap allow it (`may`). An SVG
	shows as a data URL, never as a page of this site, so its scripts never run here; and what is neither a picture, a
	PDF, a film nor a song only saves.
-->
<script>
	import { onDestroy } from 'svelte';
	import Icon from './Icon.svelte';
	import { address, dataUrl, kindOf, KINDS, mediaOf, serve, whole, WHOLE } from './files.js';
	import { allowed, creatable, deleting, may } from './ops.js';
	import { count, list, nameOf, reads, sharedWith, sharedWords, size, tagsIn, why } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean,
	 *   onaccess: () => void }}
	 */
	let { world, vault, actor, api, busy, onaccess } = $props();

	/** @typedef {import('./vaults.js').EntryView} EntryView */
	/** @typedef {import('./files.js').Kind} Kind */

	/** The largest picture a tile previews. */
	const THUMB = 16 << 20;
	/** The image types a page shows as pictures. */
	const PICTURE = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/;

	const byId = $derived(new Map(world.vaults.map((v) => [v.id, v])));
	const here = $derived(byId.get(vault));
	const as = $derived(byId.get(actor));
	const entries = $derived(world.entries.filter((e) => e.vault === vault));
	const seen = $derived(entries.filter((e) => reads(e, actor)));
	const files = $derived(seen.filter((e) => e.kind === 'file'));
	const live = $derived(files.filter((e) => !e.deleted));
	/** the files deleted: listed apart, each to open and bring back */
	const deleted = $derived(files.filter((e) => e.deleted));
	const hidden = $derived(entries.length - seen.length);

	/** Entry `e`'s kind of file. @param {EntryView} e */
	const kind = (e) => kindOf(e.media, e.title ?? '');
	/** Entry `e`'s file: the first its edits bring. @param {EntryView} e */
	const fileOf = (e) => e.files?.[0];
	const kinds = $derived(KINDS.map(([k, label, icon]) => ({ k, label, icon, n: live.filter((e) => kind(e) === k).length })));
	/** the kind the files are narrowed to: '' for all of them */
	let only = $state(/** @type {Kind | ''} */ (''));
	/** the deleted files shown instead of the others */
	let bin = $state(false);
	const binned = $derived(bin && deleted.length > 0);
	const shown = $derived(binned ? deleted : only ? live.filter((e) => kind(e) === only) : live);

	/** the new files' tags, as the person types them, and those the acting vault's cap asks for besides */
	let tagging = $state('');
	const typed = $derived(tagsIn(tagging));
	/** those tags besides, as the device says: `null` while nothing shared with the acting vault lets it add a file */
	let asked = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		creatable(api, actor, vault, 'file', typed).then((t) => !gone && (asked = t));
		return () => {
			gone = true;
		};
	});
	const tagsWords = $derived(asked?.length ? `, tagged ${list(asked.map((t) => `“${t}”`))} as its share asks` : '');
	/** Who entry `e` is shared with, in words. @param {EntryView} e */
	const sharedOf = (e) => `Shared with ${sharedWords(sharedWith(world, vault, e.entry))}${e.public ? ' · Public' : ''}`;

	/** why the device won't add a file for the acting vault, as it answers a dry run of adding an empty one: '' */
	let unadded = $state('');
	$effect(() => {
		if (!asked) return;
		const tags = [...typed, ...asked];
		const op = { op: 'put_file', vault, name: 'file', media: 'application/octet-stream', tags, len: 0 };
		let gone = false;
		may(api, actor, [op]).then(([a]) => {
			if (!gone) unadded = allowed(a) ? '' : why(/** @type {any} */ (a));
		});
		return () => {
			gone = true;
		};
	});
	const adds = $derived(!!asked && !unadded);

	/** Files `picked`, into the vault one by one. @param {FileList | File[] | null | undefined} picked */
	async function add(picked) {
		const all = [...(picked ?? [])];
		if (!adds || !all.length) return;
		const tags = [...typed, ...(asked ?? [])];
		for (const f of all) if (!(await api.putFile(actor, vault, f, mediaOf(f), tags))) return;
		tagging = '';
	}

	/** @type {HTMLInputElement | undefined} */
	let picker = $state();
	/** files dragged over the page */
	let dropping = $state(false);

	/** @param {DragEvent} e */
	function over(e) {
		if (!adds || !e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dropping = true;
	}

	/** @param {DragEvent} e */
	function drop(e) {
		if (!dropping) return;
		e.preventDefault();
		dropping = false;
		add(e.dataTransfer?.files);
	}

	/** Bytes `from` to `to` of a file, as the device reads them. @type {import('./files.js').Read} */
	const read = (root, size, from, to) => api.readFile(root, size, from, to);

	// films and songs stream through the service worker where one serves this page; else they open whole
	const worker = serve(read);
	let streams = $state(false);
	worker.ready.then((ok) => (streams = ok));

	/** the pictures' previews, by their file's root: blob URLs, and data URLs for SVGs */
	let thumbs = $state(/** @type {Record<string, string>} */ ({}));
	const thumbing = new Set();
	/** the blob URLs the page made, to let go of */
	const made = new Set();

	/** A URL for `blob`, let go of with the page. @param {Blob} blob */
	const urlOf = (blob) => {
		const url = URL.createObjectURL(blob);
		made.add(url);
		return url;
	};

	/** Entry `e`'s file as a picture's or a PDF's URL: an SVG as a data URL. @param {EntryView} e */
	async function picture(e, /** @type {(done: number) => void} */ progress = () => {}) {
		const file = fileOf(e);
		if (!file) throw new Error('it brings no file');
		const k = kind(e);
		const type = k === 'svg' ? 'image/svg+xml' : k === 'pdf' ? 'application/pdf' : PICTURE.test(e.media ?? '') ? (e.media ?? '') : '';
		if (!type) throw new Error('it is no picture this page shows');
		const blob = await whole(read, file, type, progress);
		return k === 'svg' ? dataUrl(blob) : urlOf(blob);
	}

	/** Previews entry `e`'s picture once its tile shows. @param {HTMLElement} node @param {EntryView} e */
	function previews(node, e) {
		const file = fileOf(e);
		if (!file || file.len === null || file.len > THUMB || (kind(e) !== 'image' && kind(e) !== 'svg')) return;
		const seen = new IntersectionObserver(([x]) => {
			if (!x.isIntersecting || thumbing.has(file.root)) return;
			seen.disconnect();
			thumbing.add(file.root);
			picture(e)
				.then((url) => (thumbs = { ...thumbs, [file.root]: url }))
				.catch(() => {});
		});
		seen.observe(node);
		return { destroy: () => seen.disconnect() };
	}

	/** the entry open on the whole screen */
	let open = $state('');
	const viewing = $derived(files.find((e) => e.entry === open));
	/** what the viewer shows it from, how much of it it read, and why it can't */
	let src = $state('');
	let loading = $state(-1);
	let failed = $state('');
	/** the viewer's opening, so that a slower one, of a file since closed, shows nothing */
	let opening = 0;

	/** Opens entry `e` on the whole screen. @param {EntryView} e */
	async function show(e) {
		const at = ++opening;
		[open, src, loading, failed] = [e.entry, '', -1, ''];
		const file = fileOf(e);
		const k = kind(e);
		if (!file || file.len === null) return void (failed = 'This device can’t open it yet: its key hasn’t come in.');
		if (k === 'other') return;
		try {
			if ((k === 'film' || k === 'audio') && streams) src = address(file, e.media ?? '');
			else if (k === 'film' || k === 'audio') {
				loading = 0;
				const blob = await whole(read, file, e.media ?? '', (d) => at === opening && (loading = d));
				if (at === opening) src = urlOf(blob);
			} else {
				const thumb = thumbs[file.root];
				if (thumb) src = thumb;
				else {
					loading = 0;
					const url = await picture(e, (d) => at === opening && (loading = d));
					if (at === opening) src = url;
				}
			}
		} catch (err) {
			if (at === opening) failed = `It doesn’t open here: ${/** @type {Error} */ (err).message}.`;
		} finally {
			if (at === opening) loading = -1;
		}
	}

	function close() {
		opening++;
		[open, src, loading, failed] = ['', '', -1, ''];
	}

	/** Saves entry `e`'s file, under its name. @param {EntryView} e */
	async function save(e) {
		const file = fileOf(e);
		if (!file || file.len === null) return;
		const a = document.createElement('a');
		a.download = e.title ?? 'file';
		if (file.len > WHOLE && streams) a.href = address(file, 'application/octet-stream');
		else {
			const at = opening;
			try {
				loading = 0;
				a.href = urlOf(await whole(read, file, 'application/octet-stream', (d) => at === opening && (loading = d)));
			} catch (err) {
				failed = `It doesn’t save here: ${/** @type {Error} */ (err).message}.`;
				return;
			} finally {
				if (at === opening) loading = -1;
			}
		}
		a.click();
	}

	/** whether the acting vault may delete the open file, or bring it back, as the device answers a dry run of it */
	let tosses = $state(false);
	$effect(() => {
		const e = viewing;
		tosses = false;
		if (!e) return;
		let gone = false;
		may(api, actor, [{ ...deleting(e.entry, e.deleted), as: actor }]).then(([a]) => !gone && (tosses = allowed(a)));
		return () => {
			gone = true;
		};
	});

	/** Deletes entry `e`, or brings it back. @param {EntryView} e */
	async function toss(e) {
		const back = e.deleted;
		const done = await api.run(back ? 'Bringing it back' : 'Deleting', { ...deleting(e.entry, back), as: actor });
		if (done && !back) close();
	}

	onDestroy(() => {
		worker.stop();
		for (const url of made) URL.revokeObjectURL(url);
	});
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && open && close()} />

<div
	class="library"
	class:dropping
	role="region"
	aria-label="{nameOf(here)}'s files"
	ondragover={over}
	ondragleave={(e) => e.currentTarget === e.target && (dropping = false)}
	ondrop={drop}
>
	{#if asked}
		<section class="start" aria-label="Add files">
			<button class="drop" disabled={busy || !adds} onclick={() => picker?.click()}>
				<span class="well"><Icon name="upload" size={30} /></span>
				<span class="label">Add files</span>
			</button>
			<div class="say">
				<p class="soft">
					{#if unadded}
						{nameOf(as)} can’t add a file here: {unadded}.
					{:else}
						Drop films, pictures, PDFs, SVGs or songs here, or pick them, into {nameOf(here)} as
						<b>{nameOf(as)}</b>{tagsWords}. Each is sealed with a key of its own on this device, then syncs like
						any edit.
					{/if}
				</p>
				<input class="field" placeholder="Tags for them (optional)" bind:value={tagging} aria-label="The new files’ tags" />
			</div>
			<input
				bind:this={picker}
				type="file"
				multiple
				hidden
				onchange={(e) => {
					const picked = [...(e.currentTarget.files ?? [])];
					e.currentTarget.value = '';
					add(picked);
				}}
			/>
		</section>
	{/if}

	{#if files.length}
		<nav class="filter" aria-label="Narrow by kind">
			<button class="chip" class:on={!only && !binned} aria-pressed={!only && !binned} onclick={() => ([only, bin] = ['', false])}
				>All <small>{live.length}</small></button
			>
			{#each kinds.filter((k) => k.n) as k (k.k)}
				{@const on = only === k.k && !binned}
				<button class="chip" class:on aria-pressed={on} onclick={() => ([only, bin] = [on ? '' : k.k, false])}
					><Icon name={k.icon} size={12} /> {k.label} <small>{k.n}</small></button
				>
			{/each}
			{#if deleted.length}
				<button class="chip" class:on={binned} aria-pressed={binned} onclick={() => (bin = !binned)}
					><Icon name="trash" size={12} /> Deleted <small>{deleted.length}</small></button
				>
			{/if}
		</nav>
	{/if}

	{#if binned}
		<p class="soft binned">Deleted files keep their bytes. Open one to bring it back.</p>
	{/if}

	{#if !seen.length && vault !== actor}
		<div class="empty">
			<p>
				{nameOf(as)} can't see {hidden ? `the ${count(hidden, 'entry', 'entries')}` : 'anything'} in {nameOf(here)}:
				none of it is shared with {nameOf(as)}. A vault that owns it can share some of it with {nameOf(as)} in
				<button class="link" onclick={onaccess}>Sharing</button>.
			</p>
		</div>
	{:else if shown.length}
		<div class="grid">
			{#each shown as e (e.entry)}
				{@const k = kind(e)}
				{@const file = fileOf(e)}
				{@const thumb = file ? thumbs[file.root] : undefined}
				<button class="tile" class:deleted={e.deleted} onclick={() => show(e)} aria-label="Open {e.title}">
					<span class="thumb {k}" use:previews={e}>
						{#if thumb}
							<img src={thumb} alt="" loading="lazy" />
						{:else}
							<Icon name={k === 'film' ? 'play' : (KINDS.find(([x]) => x === k)?.[2] ?? 'file')} size={k === 'film' ? 28 : 34} />
						{/if}
					</span>
					<span class="info">
						<b>{e.title}</b>
						<small class="soft">
							{file?.len != null ? size(file.len) : 'sealed'} · {KINDS.find(([x]) => x === k)?.[1]}{e.by !== vault
								? ` · by ${nameOf(byId.get(e.by))}`
								: ''}
						</small>
						{#if e.tags?.length}
							<span class="tags">{#each e.tags as t (t)}<span class="chip tag">#{t}</span>{/each}</span>
						{/if}
						<small class="soft shared">{sharedOf(e)}</small>
					</span>
				</button>
			{/each}
		</div>
	{:else}
		<p class="soft">{binned ? 'Nothing deleted.' : `No file here${asked ? ' yet: drop some on this page.' : '.'}`}</p>
	{/if}

	{#if hidden > 0 && seen.length}
		<p class="soft">{count(hidden, 'more entry', 'more entries')} here {nameOf(as)} can't read.</p>
	{/if}

	{#if dropping}
		<div class="dropzone" aria-hidden="true"><Icon name="upload" size={40} /><b>Drop to add to {nameOf(here)}</b></div>
	{/if}
</div>

{#if viewing}
	{@const k = kind(viewing)}
	{@const file = fileOf(viewing)}
	<div class="viewer" role="dialog" aria-modal="true" aria-label={viewing.title}>
		<header>
			<button class="btn quiet" onclick={close} aria-label="Close"><Icon name="back" /> Back</button>
			<div class="what">
				<b>{viewing.title}</b>
				<small>{viewing.media ?? 'file'}{file?.len != null ? ` · ${size(file.len)}` : ''}</small>
				<small>{sharedOf(viewing)}</small>
			</div>
			<div class="row">
				<button class="btn" disabled={busy || !file || file.len === null || loading >= 0} onclick={() => save(viewing)}
					><Icon name="download" /> Save</button
				>
				{#if tosses}
					<button class="btn danger" disabled={busy} onclick={() => toss(viewing)}
						><Icon name="trash" /> {viewing.deleted ? 'Bring back' : 'Delete'}</button
					>
				{/if}
			</div>
		</header>
		<div class="stage">
			{#if failed}
				<p class="note">{failed}</p>
			{:else if loading >= 0}
				<p class="note">Opening it: {Math.floor(loading * 100)} %</p>
			{:else if k === 'film' && src}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video src={src} controls autoplay playsinline></video>
			{:else if k === 'audio' && src}
				<div class="song"><Icon name="audio" size={64} /><audio src={src} controls autoplay></audio></div>
			{:else if (k === 'image' || k === 'svg') && src}
				<img src={src} alt={viewing.title} />
			{:else if k === 'pdf' && src}
				<iframe src={src} title={viewing.title ?? 'PDF'}></iframe>
			{:else if k === 'other'}
				<p class="note">No preview for this kind of file: save it to open it.</p>
			{/if}
		</div>
	</div>
{/if}

<style>
	.library {
		position: relative;
		min-height: 60vh;
	}

	.start {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1rem 1.4rem;
		margin: 0 0 1.8rem;
		padding: 1rem 1.2rem;
		border-radius: 14px;
		background: #e9e4d9;
	}

	.start p {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}

	.drop {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.45rem;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.drop .well {
		display: grid;
		place-items: center;
		width: 6.6rem;
		height: 5.4rem;
		border: 1.5px dashed rgb(0 0 0 / 0.25);
		border-radius: 10px;
		background: #fff;
		color: var(--accent);
		transition: border-color 0.15s ease;
	}

	.drop:hover:not(:disabled) .well {
		border-color: var(--accent);
	}

	.drop:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.drop .label {
		font-size: 0.84rem;
		font-weight: 600;
	}

	.say {
		display: flex;
		flex: 1 1 14rem;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.say .field {
		width: min(100%, 16rem);
	}

	.filter {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0 0 1rem;
	}

	.filter button {
		border: 1px solid transparent;
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		cursor: pointer;
	}

	.filter button small {
		color: var(--soft);
	}

	.filter button.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
	}

	.binned {
		margin: -0.4rem 0 1rem;
		font-size: 0.82rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 11.5rem), 1fr));
		gap: 1rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.tile:hover,
	.tile:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
	}

	.tile.deleted .thumb {
		opacity: 0.55;
	}

	.thumb {
		display: grid;
		place-items: center;
		height: 8.5rem;
		overflow: hidden;
		border-bottom: 1px solid var(--edge);
		background: #f1efe9;
		color: rgb(0 0 0 / 0.4);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb.svg {
		background:
			repeating-conic-gradient(#ebe7df 0% 25%, #f7f5f0 0% 50%) 50% / 16px 16px;
	}

	.thumb.svg img {
		object-fit: contain;
		padding: 0.8rem;
		box-sizing: border-box;
	}

	.thumb.film {
		background: #1f2a23;
		color: #fff;
	}

	.thumb.audio {
		background: linear-gradient(135deg, #2f6d62, #6a4b9a);
		color: #fff;
	}

	.thumb.pdf {
		background: #f6e3dd;
		color: #9a3b26;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.55rem 0.7rem 0.65rem;
		min-width: 0;
	}

	.info > b {
		overflow: hidden;
		font-size: 0.88rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.info small {
		font-size: 0.74rem;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-top: 0.2rem;
	}

	.tags .chip {
		font-size: 0.66rem;
	}

	.tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.empty p {
		margin: 0;
		line-height: 1.5;
	}

	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}

	.dropzone {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		border: 2px dashed var(--accent);
		border-radius: 14px;
		background: rgb(244 241 235 / 0.88);
		color: var(--accent);
		pointer-events: none;
	}

	/* on the whole screen, under the page's toasts and the app's nav pill, which float over its foot */
	.viewer {
		position: fixed;
		inset: 0;
		z-index: 44;
		display: flex;
		flex-direction: column;
		background: #111613;
		color: #f4f1eb;
	}

	.viewer header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		padding: 0.7rem 1rem;
		border-bottom: 1px solid rgb(255 255 255 / 0.1);
	}

	.viewer header .btn {
		border-color: rgb(255 255 255 / 0.2);
		background: transparent;
		color: inherit;
	}

	.viewer header .btn.quiet {
		border-color: transparent;
	}

	.what {
		display: flex;
		flex: 1 1 12rem;
		flex-direction: column;
		min-width: 0;
	}

	.what b {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.what small {
		color: rgb(255 255 255 / 0.6);
		font-size: 0.76rem;
	}

	.stage {
		display: grid;
		flex: 1;
		place-items: center;
		min-height: 0;
		padding: 1rem 1rem var(--nav-room, 5rem);
	}

	.stage video,
	.stage img {
		max-width: 100%;
		max-height: 100%;
		object-fit: contain;
	}

	.stage iframe {
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: 6px;
		background: #fff;
	}

	.song {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.2rem;
		color: rgb(255 255 255 / 0.7);
	}

	.note {
		max-width: 30rem;
		color: rgb(255 255 255 / 0.75);
		text-align: center;
	}
</style>
