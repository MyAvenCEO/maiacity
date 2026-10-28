<!--
	A spark's canvas, filling its page (Note), on the line shown (./sparks.js): an open board where its
	items sit wherever they were put, artifacts (./artifacts.js) as cards with their picture, text notes to write in
	place, and other sparks; each dragged by hand to a new place, taken off, or added: a note, artifacts and sparks of
	its vault dragged in from beside it (./SparkShelf.svelte), a link pasted or files dropped onto the board, each a new
	artifact where it lands, each file into the Library first. Then the stories that grow from it, and a story to start from it. Each change
	is one op on that line, for the acting vault, as the device allows it (`may`). A spark's own words, as sparks were
	written before their canvas held notes (its text, the paragraph after its heading), are a note on the canvas too:
	moved there once where the acting vault may, shown there until then.
-->
<script>
	import { untrack } from 'svelte';
	import {
		addingArtifact,
		ARTIFACT,
		clock,
		entryOf,
		fromFile,
		fromLink,
		fromWords,
		LOOK_NAME,
		LOOKS,
		lookOf,
		youtubePicture
	} from './artifacts.js';
	import { mediaOf } from './files.js';
	import Icon from './Icon.svelte';
	import { linkHref } from '$lib/markdown/index.js';
	import { allowed, creatable, may } from './ops.js';
	import { addingStory, CARD, grownFrom, itemsFor, linkIn, newId, PIECE, pictureOf, pieces, placing, textItem } from './sparks.js';
	import { count, nameOf } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string,
	 *   vault: string, line: string | null, record: any, writes: boolean, words?: string }}
	 */
	let { world, actor, api, busy, entry, vault, line, record, writes, words = '' } = $props();

	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const as = $derived(world.vaults.find((v) => v.id === actor));
	const items = $derived(/** @type {any[]} */ (record?.items ?? []));
	const stories = $derived(grownFrom(world, entry).filter((e) => e.type === 'story'));

	/** whether the acting vault's ops let it change the canvas on the line, as the device says */
	let changes = $state(false);
	/** the tags a new artifact, file and story must carry: `null` where nothing lets it add one */
	let askedArtifact = $state(/** @type {string[] | null} */ (null));
	let askedFile = $state(/** @type {string[] | null} */ (null));
	let askedStory = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		let gone = false;
		const probe = { op: 'insert', entry, line, path: ['items'], value: textItem(items, '') };
		if (writes) may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		else changes = false;
		creatable(api, actor, vault, ARTIFACT).then((t) => !gone && (askedArtifact = t));
		creatable(api, actor, vault, 'file').then((t) => !gone && (askedFile = t));
		creatable(api, actor, vault, 'story').then((t) => !gone && (askedStory = t));
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	// its words, where it still has them beside its canvas: a note on it, where it would go, until they are moved there
	const said = $derived(words.trim());
	const saidAt = $derived(placing(items, 1)[0]);
	/** as wide as two cards where its words are more than a line or two */
	const saidW = $derived(said.length > 80 ? CARD.w * 2 + CARD.gap : CARD.w);
	let moved = '';
	$effect(() => {
		const text = said;
		if (!text || !writes || busy) return;
		const key = `${line}:${text}`;
		if (key === moved) return;
		moved = key;
		const ops = [
			{ op: 'insert', entry, line, path: ['items'], value: { ...textItem(untrack(() => items), text), w: saidW } },
			{ op: 'remove', entry, line, path: ['blocks', { id: 2 }] }
		];
		may(api, actor, ops).then((v) => {
			if (v.every(allowed)) api.run('Putting its words on the canvas as a note', { op: 'batch', as: actor, ops });
		});
	});

	/** Runs change `op` on the line as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry, line, as: actor });
	/** Runs the changes `ops` on the line as `what`, in one write. @param {string} what @param {object[]} ops */
	const changeAll = (what, ops) => api.run(what, { op: 'batch', as: actor, ops: ops.map((op) => ({ ...op, entry, line })) });

	// where each item is shown: where it was put, or where it is being dragged to, until the record says so too
	let pos = $state(/** @type {Record<number, { x: number, y: number }>} */ ({}));
	$effect(() => {
		const now = items;
		untrack(() => {
			const kept = Object.fromEntries(
				Object.entries(pos).filter(([id, p]) => {
					const it = now.find((i) => i.id === Number(id));
					return it && (it.x !== p.x || it.y !== p.y);
				})
			);
			if (Object.keys(kept).length !== Object.keys(pos).length) pos = kept;
		});
	});
	/** Where item `it` is shown. @param {any} it */
	const at = (it) => pos[it.id] ?? { x: it.x ?? 0, y: it.y ?? 0 };

	/** the board's size: room round every item, at least a screen's */
	const room = $derived.by(() => {
		let [w, h] = [960, 560];
		for (const it of items) {
			const p = at(it);
			w = Math.max(w, p.x + (it.w ?? CARD.w) + 240);
			h = Math.max(h, p.y + (it.h ?? CARD.h) + 240);
		}
		return { w, h };
	});

	/** the item being dragged: where the pointer took it, and whether it has moved yet */
	let drag = $state(/** @type {{ id: number, ox: number, oy: number, sx: number, sy: number, moved: boolean } | null} */ (null));

	/** Takes item `it` to drag it, unless the pointer is on what it holds to use. @param {PointerEvent} e @param {any} it */
	function down(e, it) {
		if (!edits || e.button !== 0) return;
		if (/** @type {HTMLElement} */ (e.target).closest('textarea, a, button, input')) return;
		const p = at(it);
		drag = { id: it.id, ox: e.clientX - p.x, oy: e.clientY - p.y, sx: e.clientX, sy: e.clientY, moved: false };
		/** @type {HTMLElement} */ (e.currentTarget).setPointerCapture(e.pointerId);
	}

	/** @param {PointerEvent} e */
	function moving(e) {
		if (!drag) return;
		if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
		if (!drag.moved) return;
		const x = Math.max(0, Math.round(e.clientX - drag.ox));
		const y = Math.max(0, Math.round(e.clientY - drag.oy));
		pos = { ...pos, [drag.id]: { x, y } };
	}

	/** Puts the item dragged where it was let go: its place, one write. */
	async function up() {
		const d = drag;
		drag = null;
		if (!d?.moved) return;
		const p = pos[d.id];
		const path = (/** @type {string} */ f) => ['items', { id: d.id }, f];
		const done = await changeAll('Moving it', [
			{ op: 'set', path: path('x'), value: p.x },
			{ op: 'set', path: path('y'), value: p.y }
		]);
		if (!done) {
			const { [d.id]: _, ...rest } = pos;
			pos = rest;
		}
	}

	/** the text notes as the person writes them, by item, while they write */
	let drafts = $state(/** @type {Record<number, string>} */ ({}));

	/** Saves the words written in text note `it`. @param {any} it */
	async function keep(it) {
		const t = drafts[it.id];
		if (t === undefined) return;
		if (t !== (it.text ?? '')) await change('Saving the note', { op: 'set', path: ['items', { id: it.id }, 'text'], value: t });
		const { [it.id]: _, ...rest } = drafts;
		drafts = rest;
	}

	/** Takes item `it` off the canvas: the artifact or spark it shows stays as it is. @param {any} it */
	const takeOff = (it) => change(it.what === 'text' ? 'Taking the note off' : 'Taking it off the canvas', { op: 'remove', path: ['items', { id: it.id }] });

	/** A new text note, under the rest. */
	const note = () => change('Adding a note', { op: 'insert', path: ['items'], value: textItem(items, '') });

	/**
	 * New artifacts on the canvas from point `where` on, each in its vault and then on the canvas, in order: the links
	 * `urls`, and the files `dropped`, each into the Library first.
	 * @param {URL[]} urls @param {File[]} dropped @param {{ x: number, y: number }} [where]
	 */
	async function sources(urls, dropped, where) {
		const tags = askedArtifact;
		if (tags === null || !(urls.length + dropped.length)) return;
		const ops = urls.map((u) => ({ ...addingArtifact(vault, fromLink(u), tags), as: actor }));
		for (const f of dropped) {
			const media = mediaOf(f);
			const putIt = await api.putFile(actor, vault, f, media, askedFile ?? []);
			if (!putIt) return;
			ops.push({ ...addingArtifact(vault, fromFile(vault, putIt.entry, media, f.name), tags), as: actor });
		}
		const n = ops.length;
		/** @type {any[]} */
		const rows = [];
		placing(items, n, where).forEach((p, i) => rows.push({ id: newId([...items, ...rows]), what: 'artifact', ref: { vault, entry: `$${i}` }, ...p }));
		const insert = { op: 'batch', as: actor, ops: rows.map((value) => ({ op: 'insert', entry, line, path: ['items'], value })) };
		await api.runAll(`Adding ${count(n, 'artifact')} to the canvas`, [...ops, insert]);
	}

	// one line to add from: a link a new artifact, anything else a note
	let typed = $state('');
	async function quick() {
		const t = typed.trim();
		if (!t) return;
		const urls = t.split(/\s+/).map(linkIn).filter((u) => u !== null);
		if (urls.length) await sources(urls, []);
		else await change('Adding a note', { op: 'insert', path: ['items'], value: textItem(items, t) });
		typed = '';
	}

	/** the board's surface, to place what is dropped where it lands */
	let surface = $state(/** @type {HTMLElement | null} */ (null));
	let over = $state(false);

	/** Takes what is dropped onto the board: files and links, each a new artifact where it lands. @param {DragEvent} e */
	function dropped(e) {
		e.preventDefault();
		over = false;
		if (!edits || !surface) return;
		const r = surface.getBoundingClientRect();
		const where = { x: Math.max(0, Math.round(e.clientX - r.left - CARD.w / 2)), y: Math.max(0, Math.round(e.clientY - r.top - 20)) };
		const dt = e.dataTransfer;
		const piece = dt?.getData(PIECE);
		if (piece) return land(piece, where);
		const files = [...(dt?.files ?? [])];
		const text = dt?.getData('text/uri-list') || dt?.getData('text/plain') || '';
		const urls = files.length ? [] : text.split(/\s+/).map(linkIn).filter((u) => u !== null);
		sources(urls, files, where);
	}

	/**
	 * Puts the piece dragged in from beside the canvas (./SparkShelf.svelte) where it was let go, unless it is on the
	 * canvas already. @param {string} piece its vault, entry and what it is, as JSON @param {{ x: number, y: number }} where
	 */
	function land(piece, where) {
		/** @type {{ vault: string, entry: string, what: 'artifact' | 'spark' }} */
		let p;
		try {
			p = JSON.parse(piece);
		} catch {
			return;
		}
		if (!p?.entry || p.entry === entry || items.some((it) => entryOf(it.ref) === p.entry)) return;
		const [value] = itemsFor(items, [{ vault: p.vault, entry: p.entry, what: p.what === 'spark' ? 'spark' : 'artifact' }], where);
		change(`Putting “${byId.get(p.entry)?.title || 'it'}” on the canvas`, { op: 'insert', path: ['items'], value });
	}

	/** A story that grows from it, opened at once. */
	async function story() {
		if (!askedStory) return;
		const title = record?.title || 'A new story';
		const made = await api.run(`Starting “${title}”`, { ...addingStory(world, vault, title, [entry], askedStory), as: actor });
		if (made) location.hash = `stories/${made.entry}`;
	}

	/** the picture of each artifact on it, by the artifact's entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const it of items) {
			const a = byId.get(entryOf(it.ref));
			if (it.what !== 'artifact' || !a || pics[a.entry]) continue;
			const yt = youtubePicture(a.record);
			if (yt) {
				pics = { ...pics, [a.entry]: yt };
				continue;
			}
			const file = byId.get(entryOf(/** @type {any} */ (a.record)?.files?.[0]));
			if (file) pictureOf(api, file).then((u) => !gone && u && (pics = { ...pics, [a.entry]: u }));
		}
		return () => {
			gone = true;
		};
	});

	/** Look `l`'s icon. @param {string} l */
	const iconOf = (l) => LOOKS.find(([k]) => k === l)?.[2] ?? 'artifact';
</script>

<section class="spark" aria-label="The spark’s canvas">
	<div class="bar">
		{#if edits}
			<button class="btn" onclick={note}><Icon name="text" size={14} /> Note</button>
			<form class="quick" onsubmit={(e) => (e.preventDefault(), quick())}>
				<input class="field" bind:value={typed} placeholder="Paste a link or write a note" aria-label="A link or a note" />
			</form>
		{:else if writes}
			<span class="soft">{nameOf(as)}’s share doesn’t let it change this canvas.</span>
		{/if}
		<span class="soft count">{count(items.length, 'piece')}</span>
	</div>

	<div
		class="board"
		class:over
		role="region"
		aria-label="The canvas"
		ondragover={(e) => (e.preventDefault(), edits && (over = true))}
		ondragleave={() => (over = false)}
		ondrop={dropped}
	>
		<div class="surface" bind:this={surface} style:width="{room.w}px" style:height="{room.h}px">
			{#each items as it (it.id)}
				{@const p = at(it)}
				{@const e = byId.get(entryOf(it.ref))}
				<div
					class="item {it.what}"
					class:dragging={drag?.id === it.id && !!drag?.moved}
					class:movable={edits}
					style:left="{p.x}px"
					style:top="{p.y}px"
					style:width="{it.w ?? CARD.w}px"
					style:height={it.h ? `${it.h}px` : undefined}
					role="group"
					aria-label={it.what === 'text' ? 'A note' : (e?.title ?? 'A piece')}
					onpointerdown={(ev) => down(ev, it)}
					onpointermove={moving}
					onpointerup={up}
					onpointercancel={() => (drag = null)}
				>
					{#if it.what === 'text'}
						{#if edits}
							<textarea
								value={drafts[it.id] ?? it.text ?? ''}
								oninput={(ev) => (drafts = { ...drafts, [it.id]: ev.currentTarget.value })}
								onblur={() => keep(it)}
								placeholder="A note"
								aria-label="The note’s words"
							></textarea>
						{:else}
							<p class="words">{it.text || '…'}</p>
						{/if}
					{:else if !e}
						<p class="missing soft">
							<Icon name={it.what === 'spark' ? 'spark' : 'artifact'} size={16} />
							{it.what === 'spark' ? 'A spark' : 'An artifact'} this browser doesn’t hold
						</p>
					{:else if it.what === 'artifact'}
						{@const r = /** @type {any} */ (e.record) ?? {}}
						{@const look = lookOf(e)}
						<div class="face {look}">
							{#if pics[e.entry]}
								<img src={pics[e.entry]} alt="" draggable="false" />
							{:else}
								<Icon name={iconOf(look)} size={26} />
								{#if r.duration}<small>{clock(r.duration)}</small>{/if}
							{/if}
						</div>
						<div class="about">
							<a href="#artifacts/{e.entry}" class="title">{e.title || 'Untitled'}</a>
							<small class="soft">{LOOK_NAME[look]}{fromWords(r) ? ` · ${fromWords(r)}` : ''}</small>
						</div>
						{#if r.url}
							<a class="out" href={linkHref(r.url)} target="_blank" rel="noopener noreferrer" title="Open the link" aria-label="Open the link"
								><Icon name="out" size={13} /></a
							>
						{/if}
					{:else}
						{@const held = pieces(world, e)}
						<div class="face sparkish"><Icon name="spark" size={24} /></div>
						<div class="about">
							<a href="#notes/{e.entry}" class="title">{e.title || 'Untitled'}</a>
							<small class="soft"
								>Spark · {count(held.artifacts.length, 'artifact')}{held.notes.length ? ` · ${count(held.notes.length, 'note')}` : ''}</small
							>
						</div>
					{/if}
					{#if edits}
						<button class="x" title="Take it off" aria-label="Take it off the canvas" onclick={() => takeOff(it)}
							><Icon name="close" size={12} /></button
						>
					{/if}
				</div>
			{/each}
			{#if said}
				<div class="item text" style:left="{saidAt.x}px" style:top="{saidAt.y}px" style:width="{saidW}px" role="group" aria-label="Its words">
					<p class="words">{said}</p>
				</div>
			{/if}
			{#if !items.length && !said}
				<p class="empty soft">
					An empty canvas. {edits ? 'Add a note, drag artifacts and sparks in from the side, or drop pictures and links here.' : ''}
				</p>
			{/if}
		</div>
	</div>

	<div class="grows">
		{#if stories.length}
			<span class="soft">Grows into</span>
			{#each stories as s (s.entry)}<a class="chip" href="#stories/{s.entry}"><Icon name="story" size={12} /> {s.title || 'A story'}</a>{/each}
		{/if}
		{#if askedStory !== null && writes}
			<button class="btn quiet" disabled={busy} onclick={story}><Icon name="story" size={14} /> Make a story from it</button>
		{/if}
	</div>
</section>

<style>
	.spark {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		gap: 0.6rem;
		min-height: 0;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.bar .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.quick {
		flex: 1 1 12rem;
		min-width: 0;
	}

	.quick .field {
		width: 100%;
		box-sizing: border-box;
	}

	.count {
		margin-left: auto;
		font-size: 0.78rem;
	}

	/* the board: a dotted sheet that scrolls both ways, its items placed on it */
	.board {
		position: relative;
		flex: 1 1 auto;
		overflow: auto;
		min-height: max(20rem, calc(100dvh - 16rem));
		border: 1px solid var(--edge);
		border-radius: 14px;
		background-color: #fbfaf6;
		background-image: radial-gradient(rgb(0 0 0 / 0.09) 1px, transparent 1px);
		background-size: 22px 22px;
		touch-action: pan-x pan-y;
	}

	.board.over {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
	}

	.surface {
		position: relative;
	}

	.empty {
		position: absolute;
		top: 2rem;
		left: 2rem;
		max-width: 24rem;
		margin: 0;
	}

	.item {
		position: absolute;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 2px 8px rgb(38 56 44 / 0.08);
		user-select: none;
	}

	.item.movable {
		cursor: grab;
		touch-action: none;
	}

	.item.dragging {
		z-index: 5;
		cursor: grabbing;
		box-shadow: 0 12px 28px rgb(38 56 44 / 0.22);
	}

	.item.text {
		background: #fff8d9;
		border-color: #eadfa6;
	}

	.item textarea,
	.item .words {
		box-sizing: border-box;
		width: 100%;
		min-height: 6.5rem;
		margin: 0;
		padding: 0.7rem 1.6rem 0.7rem 0.75rem;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		line-height: 1.4;
		white-space: pre-wrap;
		resize: vertical;
		outline: none;
		user-select: text;
	}

	.face {
		display: grid;
		place-items: center;
		height: 7.5rem;
		overflow: hidden;
		background: #e3eaf3;
		color: #2b3f63;
	}

	.face img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.face.video,
	.face.youtube {
		background: #2a2f2c;
		color: #fff;
	}

	.face.image {
		background: #e2ece7;
		color: var(--accent);
	}

	.face.sparkish {
		height: 4rem;
		background: #f1ede4;
		color: #8a6a2f;
	}

	.face small {
		margin-top: -2.2rem;
		font-size: 0.75rem;
	}

	.about {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.5rem 0.65rem 0.6rem;
		min-width: 0;
	}

	.about .title {
		overflow: hidden;
		color: inherit;
		font-size: 0.88rem;
		font-weight: 600;
		text-decoration: none;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.about .title:hover {
		text-decoration: underline;
	}

	.about small {
		overflow: hidden;
		font-size: 0.74rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.missing {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		padding: 0.8rem;
		font-size: 0.82rem;
	}

	.x,
	.out {
		position: absolute;
		top: 0.35rem;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.9);
		color: #333;
		cursor: pointer;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.15);
	}

	.x {
		right: 0.35rem;
		opacity: 0;
	}

	.out {
		right: 2.1rem;
	}

	.item:hover .x,
	.item:focus-within .x {
		opacity: 1;
	}

	@media (hover: none) {
		.x {
			opacity: 1;
		}
	}

	.grows {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
	}

	.grows .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: inherit;
		text-decoration: none;
	}

	.grows .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
</style>
