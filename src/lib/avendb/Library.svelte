<!--
	A vault's Library: every file of the vault the acting vault reads, as a media app lists them, in the layout every
	avenDB view has (./Frame.svelte): on the left what narrows them, by kind (films, images, SVGs, PDFs, audio, other)
	or a tag, each with how many there are, the deleted ones apart; in the middle each a tile with a preview where it
	is a picture or a film the Mac made a still of (the `still` rule's preview, $lib/studio/jobs/rules.js), its size, its
	kind and its tags, or the same as a table (Samuel 2026-10-18), with every vault whose devices hold its bytes, and
	right under each file what the Mac's rules made of it (its proxy, grading still, preview), as the old studio's
	ingest table kept them (./made.js); where a rule's step stands is the Jobs app's. A click opens it in the middle, to save or delete there, its
	details on the right (its kind, size, who added it and when, its tags, where it is synced to, who it is shared
	with and its hash): a film or a song plays as the browser's player asks for it, a range at a time, streamed from
	the device through a service worker (./files.js), or read whole where none runs; a picture, an SVG or a PDF shows
	whole; any file saves. Files dropped on the page, or picked, go into the vault one
	by one: each sealed under a key of its own on this device as it is read, a megabyte at a time, then an entry that
	brings it, which syncs as any edit does, so the person's other devices and avenDB's server fetch its sealed bytes and
	open them with the key in the edit. A vault other than this one adds a file only through a cap with write on a
	slice that holds it, tagged as its slice asks (`creatable`), and where the ops of that cap allow it (`may`). An SVG
	shows as a data URL, never as a page of this site, so its scripts never run here; and what is neither a picture, a
	PDF, a film nor a song only saves.
-->
<script>
	import { onDestroy } from 'svelte';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import SiteMedia from './SiteMedia.svelte';
	import { address, dataUrl, kindOf, KINDS, mediaOf, serve, whole, WHOLE } from './files.js';
	import { familyOf } from './made.js';
	import { allowed, creatable, deleting, may } from './ops.js';
	import {
		count,
		heldWords,
		list,
		nameOf,
		reads,
		sharedWith,
		sharedWords,
		signerName,
		size,
		syncedWords,
		tagsIn,
		tagsOf,
		why,
		authorsLine
	} from './vaults.js';

	/** the tag of footage, which the studio's rules make proxies, stills and words of */
	const FOOTAGE = 'media:original';

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

	/** what the Mac's rules made of each file (./made.js) */
	const family = $derived(familyOf(world));
	/** each made file's role (`Proxy · ACEScct` …), by its entry */
	const roles = $derived(new Map([...family.made.values()].flat().map((m) => [m.entry.entry, m.role])));

	/**
	 * Each file's preview, by its entry: the JPEG the Mac's `still` rule made of it at its hero frame
	 * ($lib/studio/jobs/rules.js, vault/app/src/aven.rs), or of its original, for a file made of one; where this device
	 * can open it.
	 */
	const previewOf = $derived.by(() => {
		/** @type {Map<string, EntryView>} */
		const out = new Map();
		for (const [from, made] of family.made) {
			const p = made.find((m) => m.rule === 'still' && m.entry.tags?.includes('media:preview'))?.entry;
			if (!p || p.files?.[0]?.len == null) continue;
			out.set(from, p);
			for (const m of made) if (m.entry !== p) out.set(m.entry.entry, p);
		}
		return out;
	});

	/**
	 * @typedef {{ e: EntryView, of?: EntryView, role?: string }} Row a file, and its original if it is one a rule made
	 *   of it
	 */
	/**
	 * The table's rows: each file, then right under it the files the rules made of it; a made file whose original
	 * isn't listed stands alone.
	 */
	const rows = $derived.by(() => {
		const listed = new Set(shown.map((e) => e.entry));
		/** @type {Row[]} */
		const out = [];
		for (const e of shown) {
			const of = family.of.get(e.entry);
			if (of && listed.has(of)) continue;
			out.push({ e, role: roles.get(e.entry) });
			if (binned) continue;
			for (const m of family.made.get(e.entry) ?? []) if (reads(m.entry, actor)) out.push({ e: m.entry, of: e, role: m.role });
		}
		return out;
	});

	/** Entry `e`'s kind of file. @param {EntryView} e */
	const kind = (e) => kindOf(e.media, e.title ?? '');
	/** Entry `e`'s file: the first its edits bring. @param {EntryView} e */
	const fileOf = (e) => e.files?.[0];
	const kinds = $derived(KINDS.map(([k, label, icon]) => ({ k, label, icon, n: live.filter((e) => kind(e) === k).length })));
	/** the tags of its files, the auto tags `sparks` and `stories` (./artifacts.js) among them, flow stages left out */
	const tags = $derived(tagsOf(live).filter((t) => !t.tag.includes(':')));
	/** the kind the files are narrowed to, or a tag (`#` and it): '' for all of them */
	let only = $state(/** @type {string} */ (''));
	/** the deleted files shown instead of the others */
	let bin = $state(false);
	const binned = $derived(bin && deleted.length > 0);
	const shown = $derived(
		binned
			? deleted
			: only.startsWith('#')
				? live.filter((e) => e.tags?.includes(only.slice(1)))
				: only
					? live.filter((e) => kind(e) === only)
					: live
	);

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
	const sharedOf = (e) => `${sharedWords(sharedWith(world, vault, e.entry))}${e.public ? ', and everyone: Public' : ''}`;
	/** When entry `e` was added, as a person reads it. @param {EntryView} e */
	const added = (e) =>
		e.created
			? new Date(e.created * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
			: 'unknown';

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

	/**
	 * Files `picked`, into the vault one by one. A film or a sound is footage (`media:original`), the studio's way in
	 * (Samuel 2026-10-18): the Mac's rules make its proxy, its still and its words ($lib/studio/jobs/rules.js).
	 * @param {FileList | File[] | null | undefined} picked
	 */
	async function add(picked) {
		const all = [...(picked ?? [])];
		if (!adds || !all.length) return;
		const tags = [...typed, ...(asked ?? [])];
		for (const f of all) {
			const media = mediaOf(f);
			const footage = /^(video|audio)\//.test(media) && !tags.includes(FOOTAGE) ? [FOOTAGE] : [];
			if (!(await api.putFile(actor, vault, f, media, [...tags, ...footage]))) return;
		}
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

	/** Entry `e`'s preview as a URL: its picture, or of a film the JPEG still `still` the Mac made of it. @param {EntryView} e @param {EntryView} [still] */
	async function thumbnail(e, still) {
		const file = still && fileOf(still);
		if (!file) return picture(e);
		return urlOf(await whole(read, file, still.media ?? 'image/jpeg'));
	}

	/**
	 * Previews entry `e` once its tile or row shows: a picture of its own, or a film's still (`still`), which may come
	 * in later, as the Mac makes it. @param {HTMLElement} node @param {[EntryView, EntryView | undefined]} of
	 */
	function previews(node, of) {
		/** @type {IntersectionObserver | null} */
		let seen = null;
		const watch = (/** @type {[EntryView, EntryView | undefined]} */ [e, still]) => {
			seen?.disconnect();
			const file = fileOf(e);
			if (!file || file.len === null || thumbing.has(file.root)) return;
			const own = (kind(e) === 'image' || kind(e) === 'svg') && file.len <= THUMB;
			if (!own && !still) return;
			seen = new IntersectionObserver(([x]) => {
				if (!x.isIntersecting || thumbing.has(file.root)) return;
				seen?.disconnect();
				thumbing.add(file.root);
				thumbnail(e, own ? undefined : still)
					.then((url) => (thumbs = { ...thumbs, [file.root]: url }))
					.catch(() => thumbing.delete(file.root));
			});
			seen.observe(node);
		};
		watch(of);
		return { update: watch, destroy: () => seen?.disconnect() };
	}

	/** how the files are laid out, remembered on this device: tiles, or a table */
	const LAYOUT = 'avendb:library:layout';
	let layout = $state(/** @type {'grid' | 'table'} */ ('grid'));
	try {
		if (localStorage.getItem(LAYOUT) === 'table') layout = 'table';
	} catch {}
	/** @param {'grid' | 'table'} to */
	function lay(to) {
		layout = to;
		try {
			localStorage.setItem(LAYOUT, to);
		} catch {}
	}

	/**
	 * The vaults whose devices hold file `file`'s bytes, each once, with the names of those devices (Samuel 2026-10-18:
	 * the vault and its devices, "Samuel: Mac app, Safari on iPhone") and, in words, how much each holds and when it
	 * last said so; a device of no vault this device knows stands by its own name.
	 * @param {import('./files.js').FileView | undefined} file
	 */
	function heldBy(file) {
		/** @type {Map<string, { name: string, devices: string[], words: string[] }>} */
		const out = new Map();
		for (const h of file?.syncedTo ?? []) {
			const v = world.vaults.find((x) => x.devices.some((d) => d.id === h.device));
			const held = heldWords(h);
			const at = out.get(v?.id ?? h.device) ?? { name: v ? nameOf(v) : signerName(world, h.device), devices: [], words: [] };
			if (v) at.devices.push(v.devices.find((d) => d.id === h.device)?.name ?? (v.kind === 'device' && v.name ? v.name : 'a device'));
			at.words.push(`${signerName(world, h.device)}${held ? ` (${held})` : ''}`);
			out.set(v?.id ?? h.device, at);
		}
		return [...out.values()];
	}

	/** When entry `e` was added, short: the year only when it is not this one. @param {EntryView} e */
	const day = (e) => {
		if (!e.created) return '';
		const d = new Date(e.created * 1000);
		return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
	};

	/** the entry open in the main area */
	let open = $state('');
	const viewing = $derived(files.find((e) => e.entry === open));
	/** what the viewer shows it from, how much of it it read, and why it can't */
	let src = $state('');
	let loading = $state(-1);
	let failed = $state('');
	/** the viewer's opening, so that a slower one, of a file since closed, shows nothing */
	let opening = 0;

	/** Opens entry `e` in the main area. @param {EntryView} e */
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

	/** Narrows the files to `to` (a kind, `#` and a tag, or '' for all of them), or shows the deleted ones instead,
	 *  leaving the file open for them. @param {string} to @param {boolean} deleted */
	function narrow(to, deleted) {
		[only, bin] = [to, deleted];
		if (open) close();
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

<!-- the left side: what narrows the files, by kind or tag, or the deleted ones instead -->
{#snippet kindsNav()}
	<h3 class="nav-group">Files</h3>
	<button class="nav-item" class:on={!only && !binned} aria-pressed={!only && !binned} data-pick onclick={() => narrow('', false)}
		><Icon name="library" size={16} /><span>All</span><small>{live.length}</small></button
	>
	{#each kinds.filter((k) => k.n) as k (k.k)}
		{@const on = only === k.k && !binned}
		<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => narrow(on && !viewing ? '' : k.k, false)}
			><Icon name={k.icon} size={16} /><span>{k.label}</span><small>{k.n}</small></button
		>
	{/each}
	{#if deleted.length}
		<button class="nav-item" class:on={binned} aria-pressed={binned} data-pick onclick={() => narrow(only, !binned || !!viewing)}
			><Icon name="trash" size={16} /><span>Deleted</span><small>{deleted.length}</small></button
		>
	{/if}
	{#if tags.length}
		<h3 class="nav-group">Tags</h3>
		{#each tags as t (t.tag)}
			{@const on = only === `#${t.tag}` && !binned}
			<button class="nav-item" class:on aria-pressed={on} data-pick onclick={() => narrow(on && !viewing ? '' : `#${t.tag}`, false)}
				><Icon name="tag" size={16} /><span>{t.tag}</span><small>{t.uses}</small></button
			>
		{/each}
	{/if}
{/snippet}

<!-- on the right, the one place for the file open: what it is, who added it, where it is synced to, who it is shared with -->
{#snippet about()}
	{#if viewing}
		{@const k = kind(viewing)}
		{@const file = fileOf(viewing)}
		<header class="about-head">
			<small>{KINDS.find(([x]) => x === k)?.[1]}</small>
			<h3>{viewing.title}</h3>
		</header>
		<dl>
			<dt>Kind</dt>
			<dd>{KINDS.find(([x]) => x === k)?.[1]} · {viewing.media ?? 'file'}</dd>
			<dt>Size</dt>
			<dd>{file?.len != null ? size(file.len) : 'sealed: this device can’t open it yet'}</dd>
			<dt>Added</dt>
			<dd>{added(viewing)}, by {authorsLine(world, viewing.authors, nameOf(byId.get(viewing.by)))}</dd>
			{#if viewing.tags?.length}
				<dt>Tags</dt>
				<dd class="tags">{#each viewing.tags as t (t)}<span class="chip tag">#{t}</span>{/each}</dd>
			{/if}
			<dt>Synced to</dt>
			<dd>{syncedWords(file?.syncedTo, (d) => signerName(world, d)) ?? 'nowhere yet'}</dd>
			<dt>Shared with</dt>
			<dd>{sharedOf(viewing)}. <button class="link" onclick={onaccess}>Sharing</button></dd>
			{#if file}
				<dt>Hash</dt>
				<dd><code>{file.root}</code></dd>
			{/if}
			{#if viewing.deleted}
				<dt>Deleted</dt>
				<dd>It keeps its bytes: bring it back to list it again.</dd>
			{/if}
		</dl>
	{/if}
{/snippet}

<Frame
	nav={files.length ? kindsNav : undefined}
	aside={viewing ? about : undefined}
	navLabel="Narrow the files"
	asideLabel="About {viewing?.title ?? 'the file'}"
	navIcon="library"
	asideIcon="info"
>
	{#if !viewing}
		<SiteMedia {world} {vault} {actor} {api} {busy} />
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
				<div class="layout" role="group" aria-label="Lay the files out">
					<button aria-pressed={layout === 'grid'} onclick={() => lay('grid')}><Icon name="apps" /> Grid</button>
					<button aria-pressed={layout === 'table'} onclick={() => lay('table')}><Icon name="table" /> Table</button>
				</div>
				{#if layout === 'table'}
					<div class="rows">
						<table>
							<thead>
								<tr><th><span class="hide">Preview</span></th><th>Name</th><th>Kind</th><th class="num">Size</th><th>Added</th><th>Tags</th><th>Synced to</th></tr>
							</thead>
							<tbody>
								{#each rows as r (r.e.entry)}
										{@const e = r.e}
										{@const k = kind(e)}
										{@const file = fileOf(e)}
										{@const thumb = file ? thumbs[file.root] : undefined}
										{@const own = r.of ? [] : (e.tags ?? []).filter((t) => !t.includes(':'))}
										<tr class:deleted={e.deleted} class:made={!!r.of}>
											<td class="mini">
												<span class="thumb {k}" use:previews={[e, previewOf.get(e.entry)]}>
													{#if thumb}
														<img src={thumb} alt="" loading="lazy" />
													{:else}
														<Icon name={k === 'film' ? 'play' : (KINDS.find(([x]) => x === k)?.[2] ?? 'file')} size={16} />
													{/if}
												</span>
											</td>
											<td class="name"
												><button class="open" class:sub={!!r.of} title={e.title} onclick={() => show(e)}>{r.of ? '↳ ' : ''}{e.title}</button></td
											>
											<td class="when">
												{#if r.role}
													{@const [what, colour] = r.role.split(' · ')}
													{what}{#if colour}<small class="colour">{colour}</small>{/if}
												{:else}
													{KINDS.find(([x]) => x === k)?.[1]}
												{/if}
											</td>
											<td class="num">{file?.len != null ? size(file.len) : 'sealed'}</td>
											<td class="soft when">{day(e)}{e.by !== vault ? `, by ${nameOf(byId.get(e.by))}` : ''}</td>
											<td>
												{#if own.length}<span class="tags">{#each own as t (t)}<span class="chip tag">#{t}</span>{/each}</span>{/if}
											</td>
											<td>
												<span class="held">
													{#each heldBy(file) as h (h.name)}
														<span title={h.words.join(', ')}><b>{h.name}</b>{#if h.devices.length}<small>{h.devices.join(', ')}</small>{/if}</span>
													{:else}
														<span class="soft">nowhere yet</span>
													{/each}
												</span>
											</td>
										</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
				<div class="grid">
					{#each shown as e (e.entry)}
						{@const k = kind(e)}
						{@const file = fileOf(e)}
						{@const thumb = file ? thumbs[file.root] : undefined}
						<button class="tile" class:deleted={e.deleted} onclick={() => show(e)} aria-label="Open {e.title}">
							<span class="thumb {k}" use:previews={[e, previewOf.get(e.entry)]}>
								{#if thumb}
									<img src={thumb} alt="" loading="lazy" />
									{#if k === 'film'}<span class="play"><Icon name="play" size={22} /></span>{/if}
								{:else}
									<Icon name={k === 'film' ? 'play' : (KINDS.find(([x]) => x === k)?.[2] ?? 'file')} size={k === 'film' ? 28 : 34} />
								{/if}
							</span>
							<span class="info">
								<b>{e.title}</b>
								<small class="soft">
									{file?.len != null ? size(file.len) : 'sealed'} · {KINDS.find(([x]) => x === k)?.[1]}{e.authors?.length || e.by !== vault
										? ` · by ${authorsLine(world, e.authors, nameOf(byId.get(e.by)))}`
										: ''}
								</small>
								{#if e.tags?.length}
									<span class="tags">{#each e.tags as t (t)}<span class="chip tag">#{t}</span>{/each}</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
				{/if}
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
	{:else}
		{@const k = kind(viewing)}
		{@const file = fileOf(viewing)}
		<div class="viewer" role="region" aria-label={viewing.title}>
			<div class="bar">
				<button class="btn quiet" onclick={close}><Icon name="back" /> All files</button>
				<b>{viewing.title}</b>
				<button class="btn" disabled={busy || !file || file.len === null || loading >= 0} onclick={() => save(viewing)}
					><Icon name="download" /> Save</button
				>
				{#if tosses}
					<button class="btn danger" disabled={busy} onclick={() => toss(viewing)}
						><Icon name="trash" /> {viewing.deleted ? 'Bring back' : 'Delete'}</button
					>
				{/if}
			</div>
			<div class="stage">
				{#if failed}
					<p class="note">{failed}</p>
				{:else if loading >= 0}
					<p class="note">Opening it: {Math.floor(loading * 100)} %</p>
				{:else if k === 'film' && src}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video src={src} poster={file ? thumbs[file.root] : undefined} controls autoplay playsinline></video>
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
</Frame>

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

	.binned {
		margin: 0 0 1rem;
		font-size: 0.82rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 11.5rem), 1fr));
		gap: 1rem;
	}

	.layout {
		display: flex;
		width: fit-content;
		margin: 0 0 0.8rem auto;
		padding: 2px;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.layout button {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		border: 0;
		border-radius: 6px;
		background: none;
		font: inherit;
		font-size: 0.8rem;
		color: rgb(0 0 0 / 0.6);
		cursor: pointer;
	}

	.layout button[aria-pressed='true'] {
		background: #e9e4d9;
		color: inherit;
		font-weight: 600;
	}

	.held {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.held > span:not(.soft) {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: #e9e4d9;
		font-size: 0.74rem;
		white-space: nowrap;
	}

	.held b {
		font-weight: 600;
	}

	.held small {
		margin-left: 0.3rem;
		font-size: 0.7rem;
		color: rgb(0 0 0 / 0.55);
	}

	.rows .held {
		max-width: 24rem;
	}

	.rows {
		overflow-x: auto;
		border: 1px solid var(--edge);
		border-radius: 10px;
		background: #fff;
	}

	.rows table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.84rem;
	}

	.rows th {
		padding: 0.5rem 0.65rem;
		font-size: 0.72rem;
		font-weight: 600;
		text-align: left;
		color: rgb(0 0 0 / 0.55);
		white-space: nowrap;
	}

	.rows td {
		padding: 0.4rem 0.65rem;
		border-top: 1px solid var(--edge);
		vertical-align: middle;
	}

	.rows tbody tr:hover td {
		background: rgb(0 0 0 / 0.03);
	}

	.rows tr.deleted td {
		opacity: 0.55;
	}

	.rows .num {
		text-align: right;
		white-space: nowrap;
	}

	.rows .name {
		max-width: 20rem;
	}

	.rows .open {
		display: block;
		overflow: hidden;
		max-width: 100%;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-weight: 600;
		color: inherit;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}

	.rows .open:hover,
	.rows .open:focus-visible {
		color: var(--accent);
	}

	.rows .mini {
		width: 4.2rem;
	}

	.rows tr.made td {
		border-top: 1px dashed var(--edge);
		background: #faf8f4;
	}

	.rows .when {
		white-space: nowrap;
	}

	.rows .colour {
		display: block;
		font-size: 0.72rem;
		color: rgb(0 0 0 / 0.5);
	}

	.rows tr.made .mini .thumb {
		width: 3.2rem;
		height: 1.8rem;
		margin-left: 1rem;
	}

	.rows .sub {
		padding-left: 0.6rem;
		font-weight: 400;
		color: rgb(0 0 0 / 0.7);
	}

	.rows .mini .thumb {
		width: 4.2rem;
		height: 2.4rem;
		border: 0;
		border-radius: 5px;
	}

	.rows .tags {
		margin: 0;
	}

	.rows .tags .chip,
	.rows .held .soft {
		white-space: nowrap;
	}

	.hide {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}

	.thumb .play {
		position: absolute;
		inset: 0;
		margin: auto;
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 50%;
		background: rgb(0 0 0 / 0.45);
		color: #fff;
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
		position: relative;
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

	/* the file open in the middle: a row to go back, save or delete it, then the file, as large as the column allows */
	.viewer {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		height: calc(100dvh - 11rem - var(--nav-room, 5rem));
		min-height: 22rem;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.bar b {
		flex: 1 1 8rem;
		min-width: 0;
		overflow: hidden;
		font-size: 0.92rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.viewer .stage {
		flex: 1;
	}

	@media (max-width: 760px) {
		.viewer {
			height: auto;
		}

		.viewer .stage {
			flex: none;
			height: 60dvh;
		}
	}

	/* on the right: the file's details */
	.about-head small {
		color: var(--accent);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.about-head h3 {
		margin: 0.15rem 0 0.4rem;
		font-size: 1.05rem;
		overflow-wrap: anywhere;
	}

	dl {
		display: grid;
		gap: 0.15rem;
		margin: 0;
		font-size: 0.84rem;
	}

	dt {
		margin-top: 0.45rem;
		color: var(--soft);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	dd {
		margin: 0;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	dd code {
		font-size: 0.72rem;
	}

	.stage {
		display: grid;
		place-items: center;
		min-height: 0;
		overflow: hidden;
		padding: 1rem;
		border-radius: 12px;
		background: #111613;
		color: #f4f1eb;
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
