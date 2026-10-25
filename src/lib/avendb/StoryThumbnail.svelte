<!--
	A story's Thumbnail tab (./Story.svelte): its cards, one entry of avenDB's `artwork` schema each (./artworks.js), a
	chip for each above, by shape (16:9, 9:16, 1:1, 4:5, 5:2), an A/B card beside its first. The card picked is designed
	in layers as the old board's thumbnail was (src/lib/stories/Card.svelte): large on the left, a layer picked there or
	in the list on the right and moved by dragging it, sized by its corner, turned by its handle; the card stays in view
	while the list scrolls. Over the list a 16:9 card shows small as it is being laid out, as YouTube lists it beside its
	title; under the list what the picked layer is made of: its picture (a Library file: one the story's sparks show,
	any of the vault's, or one uploaded here), its words (empty: the hook the card carries), colour, place and size. A
	card with no layers starts with the usual four, as the old board's did: a picture, a cut-out, the hook, the day
	badge. "Render the card" draws it at full size (src/lib/stories/card.js) into the Library, a file tagged with its role
	and shape, which the card links. A story with no cards makes one per shape its format goes out in, its first picture
	and its hook on each. Every change is one op on the card, as the device allows it; a slider or a word field writes
	once it is let go of.
-->
<script>
	import { libraryFilesQuery } from './library-query.js';
	import { entryCollection } from './entry-collection.svelte.js';
	import { entryReferenceClosure } from './entry-reference-closure.svelte.js';
	import { hookArtworkQuery } from './story-hook-query.js';
	import { reads } from './vaults.js';
	import Card from '$lib/stories/Card.svelte';
	import { renderCard } from '$lib/stories/card.js';
	import { entryOf } from './artifacts.js';
	import {
		addingArtwork,
		ARTWORK,
		artworksOf,
		cardRecord,
		cardWords,
		isPictureFile,
		LAYER_KINDS,
		layerOf,
		pixelsOf,
		SHAPE_USE,
		SHAPES,
		shapeOf,
		shapesFor,
		storyPictures
	} from './artworks.js';
	import { mediaOf } from './files.js';
	import Icon from './Icon.svelte';
	import { allowed, creatable, may } from './ops.js';
	import { newId, pictureOf } from './sparks.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean,
	 *   item: import('./vaults.js').EntryView, writes: boolean }}
	 */
	let { world: baseWorld, actor, api, busy, item, writes } = $props();
	const artwork = entryCollection(() => api, () => hookArtworkQuery(actor));
	const relevant = $derived(artworksOf({ ...baseWorld, entries: artwork.rows.filter(e=>reads(e,actor)) }, item.entry));
	const references = entryReferenceClosure(() => api, () => [...relevant.map(e=>e.entry), ...(/** @type {any} */ (item.record)?.sparks ?? [])], () => actor);
	const inventory = entryCollection(() => api, () => picking ? libraryFilesQuery(item.vault, actor) : {op:'entry_views', entries:[], as:actor});
	const world = $derived({ ...baseWorld, entries: [...new Map([...relevant, ...references.rows, ...inventory.rows.filter(e=>reads(e,actor))].map(e=>[e.entry,e])).values()], entriesComplete:false });

	const story = $derived(/** @type {any} */ (item.record) ?? {});
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const cards = $derived(artworksOf(world, item.entry));
	let chosenId = $state('');
	const card = $derived(cards.find((c) => c.entry === chosenId) ?? cards[0] ?? null);
	const record = $derived(/** @type {any} */ (card?.record) ?? {});
	const shape = $derived(shapeOf(record.shape));
	/** each card's name on its chip: its shape, and B, C… after its first */
	const names = $derived.by(() => {
		/** @type {Record<string, number>} */
		const seen = {};
		return Object.fromEntries(
			cards.map((c) => {
				const s = shapeOf(/** @type {any} */ (c.record)?.shape);
				const n = (seen[s.key] = (seen[s.key] ?? 0) + 1);
				return [c.entry, n > 1 ? `${s.name} · ${String.fromCharCode(64 + n)}` : s.name];
			})
		);
	});
	const missing = $derived(SHAPES.filter(([k]) => !cards.some((c) => /** @type {any} */ (c.record)?.shape === k)));

	/** the layers as the card holds them, with what a slider or a field is changing laid over, until it is let go of */
	let draft = $state(/** @type {Record<number, Record<string, any>>} */ ({}));
	const layers = $derived(/** @type {any[]} */ (record.layers ?? []).map((l) => ({ ...l, ...(draft[l.id] ?? {}) })));
	/** the layers as the card component draws them: its ids as text */
	const drawn = $derived(layers.map((l) => ({ ...l, id: String(l.id) })));
	let pickedId = $state(/** @type {number | null} */ (null));
	const picked = $derived(layers.find((l) => l.id === pickedId) ?? null);
	const words = $derived(cardWords(story, record));
	/** what goes out as its title beside it: the hook it carries, else the story's chosen one, else its working name */
	const title = $derived(
		/** @type {any[]} */ (story.hooks ?? []).find((h) => h.id === (record.hook ?? story.hook))?.text?.trim() || story.title || 'Untitled'
	);
	/** the story's hooks a card can carry: those written */
	const hookRows = $derived(/** @type {any[]} */ (story.hooks ?? []).filter((h) => h.text?.trim()));

	// what the acting vault may do here, as the device answers: make cards, change this one, add Library files
	let makes = $state(/** @type {string[] | null} */ (null));
	let files = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		let gone = false;
		const [vault, as] = [item.vault, actor];
		if (!writes) [makes, files] = [null, null];
		else
			Promise.all([creatable(api, as, vault, ARTWORK), creatable(api, as, vault, 'file')]).then(([a, f]) => {
				if (!gone) [makes, files] = [a, f];
			});
		return () => {
			gone = true;
		};
	});
	let changes = $state(false);
	$effect(() => {
		void world;
		let gone = false;
		const entry = card?.entry;
		const probe = { op: 'insert', entry, path: ['layers'], value: layerOf('text', shape.key, newId(layers)) };
		if (entry && writes) may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		else changes = false;
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	// the pictures, read whole once each: those the layers show, the render, and those the picker offers when open
	let picking = $state(false);
	const offered = $derived.by(() => {
		if (!picking) return [];
		const own = storyPictures(world, item);
		const rest = world.entries
			.filter((e) => e.vault === item.vault && !e.deleted && isPictureFile(e) && !own.includes(e) && !e.tags?.includes('role:still'))
			.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
			.slice(0, 48);
		return [...own, ...rest];
	});
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		const wanted = [...layers.map((l) => entryOf(l.file)), entryOf(record.render), ...offered.map((f) => f.entry)];
		const retained = Object.entries(pics).filter(([id]) => wanted.includes(id) && byId.has(id));
		if (retained.length !== Object.keys(pics).length) pics = Object.fromEntries(retained);
		for (const id of new Set(wanted.filter(Boolean))) {
			const f = byId.get(id);
			if (!f || pics[id]) continue;
			pictureOf(api, f).then((u) => !gone && u && (pics = { ...pics, [id]: u })).catch(() => {});
		}
		return () => {
			gone = true;
		};
	});
	/** The picture layer `l` shows, as the card draws it. @param {any} l */
	const src = (l) => pics[entryOf(l.file)] ?? null;

	/** Runs change `op` on the card as `what`. @param {string} what @param {object} op */
	const change = (what, op) => card && api.run(what, { ...op, entry: card.entry, as: actor });

	/**
	 * Changes layer `id` by `patch`, in one write: each field set, or unset where it is `undefined` or empty.
	 * @param {number} id @param {Record<string, any>} patch
	 */
	async function edit(id, patch) {
		const was = /** @type {any[]} */ (record.layers ?? []).find((l) => l.id === id);
		if (!card || !was) return;
		const ops = Object.entries(patch)
			.filter(([k, v]) => JSON.stringify(was[k]) !== JSON.stringify(v))
			.filter(([k, v]) => !(v === undefined || v === '') || was[k] !== undefined)
			.map(([k, v]) =>
				v === undefined || v === ''
					? { op: 'unset', entry: card.entry, path: ['layers', { id }, k] }
					: { op: 'set', entry: card.entry, path: ['layers', { id }, k], value: v }
			);
		if (ops.length) await api.run('Changing the layer', { op: 'batch', as: actor, ops });
		const rest = { ...draft };
		delete rest[id];
		draft = rest;
	}
	/** Shows `patch` on layer `id` while a slider moves, not written yet. @param {number} id @param {Record<string, any>} patch */
	const preview = (id, patch) => (draft = { ...draft, [id]: { ...(draft[id] ?? {}), ...patch } });

	/** A new layer of kind `kind` on top; a picture shows the story's first one where the card has none yet. @param {string} kind */
	function add(kind) {
		const first = storyPictures(world, item)[0];
		const file = kind === 'image' && first && !layers.some((l) => l.kind === 'image') ? { file: { vault: first.vault, entry: first.entry } } : {};
		const value = layerOf(kind, shape.key, newId(layers), { name: LAYER_KINDS.find(([k]) => k === kind)?.[1], ...file });
		pickedId = value.id;
		change('Adding a layer', { op: 'insert', path: ['layers'], value });
	}

	/** The usual four, as the old board started a card, bottom to top: the picture, a cut-out over it, the hook, the day badge. */
	function start() {
		const first = storyPictures(world, item)[0];
		const file = first ? { file: { vault: first.vault, entry: first.entry } } : {};
		/** @type {any[]} */
		const made = [];
		for (const [kind, name] of [['image', 'Background'], ['cutout', 'Face'], ['text', 'Hook'], ['badge', 'Day']])
			made.push(layerOf(kind, shape.key, newId([...layers, ...made]), { name, ...(kind === 'image' ? file : {}) }));
		pickedId = made[2].id;
		const ops = made.map((value) => ({ op: 'insert', entry: card?.entry, path: ['layers'], value }));
		api.run('Laying out the usual four', { op: 'batch', as: actor, ops });
	}

	/** Takes layer `id` off the card. @param {number} id */
	function remove(id) {
		if (pickedId === id) pickedId = null;
		change('Taking the layer off', { op: 'remove', path: ['layers', { id }] });
	}

	/** Moves layer `id` up the stack (nearer the top, drawn later) or down. @param {number} id @param {-1 | 1} by */
	function shift(id, by) {
		const k = layers.findIndex((l) => l.id === id);
		if (k < 0 || k + by < 0 || k + by >= layers.length) return;
		change(by > 0 ? 'Bringing the layer up' : 'Sending the layer down', { op: 'move', path: ['layers', { id }], to: k + by });
	}

	/** Makes a card of each shape in `shapes`, its picture and its words the story's. @param {string[]} shapes */
	async function make(shapes) {
		if (artwork.phase !== 'ready') return;
		if (!makes) return;
		const first = storyPictures(world, item)[0];
		const ops = shapes.map((s) => ({ ...addingArtwork(item.vault, cardRecord(item, s, first), makes ?? []), as: actor }));
		const made = await api.runAll(shapes.length > 1 ? 'Making the cards' : 'Making the card', ops);
		if (made?.[0]?.entry) chosenId = made[0].entry;
	}

	/** The shapes ticked to make the first cards with: those the story's format goes out in. */
	let ticked = $state(/** @type {string[]} */ ([]));
	$effect(() => {
		if (!ticked.length) ticked = shapesFor(story.format);
	});

	/** An A/B card of this one: a copy of it as a card of its own (`fork`), to carry another hook. */
	async function variant() {
		if (!card) return;
		const made = await api.run('Making an A/B card', { op: 'fork', entry: card.entry, into: card.vault, as: actor });
		if (made?.entry) chosenId = made.entry;
	}

	/** The hook the card carries: a row's id, or none for the story's chosen one. @param {string} v */
	const carry = (v) => change('Changing the hook it carries', v ? { op: 'set', path: ['hook'], value: Number(v) } : { op: 'unset', path: ['hook'] });

	/** Puts picture `f` (a Library file's entry) on the picked layer. @param {any} f */
	function choosePicture(f) {
		if (picked) edit(picked.id, { file: { vault: f.vault, entry: f.entry } });
		picking = false;
	}

	/** Adds the picture chosen on this device to the Library and puts it on the picked layer. @param {Event} e */
	async function upload(e) {
		const input = /** @type {HTMLInputElement} */ (e.currentTarget);
		const file = input.files?.[0];
		input.value = '';
		if (!file || !files || !picked) return;
		const id = picked.id;
		const got = await api.putFile(actor, item.vault, file, mediaOf(file), files);
		if (got?.entry) await edit(id, { file: { vault: item.vault, entry: got.entry } });
		picking = false;
	}

	// the render: the layers drawn at full size, as a Library file the card links
	let rendering = $state(false);
	let renderNote = $state('');
	const cardId = $derived(card?.entry ?? '');
	$effect(() => {
		void cardId;
		renderNote = '';
	});
	async function render() {
		if (!card || !files) return;
		rendering = true;
		renderNote = '';
		try {
			const { width } = pixelsOf(shape.key);
			const blob = await renderCard(drawn, words, { width, ratio: shape.ratio, src });
			const name = `${(story.title || 'card').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()}-${shape.key}.jpg`;
			const file = new File([blob], name, { type: 'image/jpeg' });
			const tags = [...files, 'role:still', `shape:${shape.key}`];
			const got = await api.putFile(actor, item.vault, file, 'image/jpeg', tags);
			if (got?.entry) {
				await change('Filing the card', { op: 'set', path: ['render'], value: { vault: item.vault, entry: got.entry } });
				renderNote = `In the Library as ${name}.`;
			}
		} catch (e) {
			renderNote = e instanceof Error ? e.message : String(e);
		} finally {
			rendering = false;
		}
	}
	const rendered = $derived(byId.get(entryOf(record.render)) ?? null);

	/** A layer's name in the list. @param {any} l */
	const nameOf = (l) =>
		l.name ||
		(l.kind === 'text' ? (l.text || words).slice(0, 28) : l.kind === 'badge' ? l.text || 'DAY 1' : LAYER_KINDS.find(([k]) => k === l.kind)?.[1]);
	const kindName = (/** @type {string} */ k) => LAYER_KINDS.find(([x]) => x === k)?.[1] ?? k;
	const kindNote = (/** @type {string} */ k) => LAYER_KINDS.find(([x]) => x === k)?.[2] ?? '';

	/** the number fields the picked layer has, each with its range and its value when none is set */
	const NUMS = $derived(
		picked
			? /** @type {{ key: string, label: string, min: number, max: number, step: number, at: number, unit: string }[]} */ ([
					{ key: 'x', label: 'Left', min: -50, max: 100, step: 0.5, at: 0, unit: ' %' },
					{ key: 'y', label: 'Top', min: -50, max: 100, step: 0.5, at: 0, unit: ' %' },
					...(picked.kind === 'badge'
						? []
						: [{ key: 'w', label: picked.kind === 'text' ? 'Width at most' : 'Width', min: 5, max: 150, step: 0.5, at: 100, unit: ' %' }]),
					...(picked.kind === 'text' || picked.kind === 'badge'
						? [{ key: 'size', label: 'Size', min: 1, max: 24, step: 0.1, at: 6.2, unit: ' % of the width' }]
						: []),
					{ key: 'rot', label: 'Turned', min: -45, max: 45, step: 0.5, at: 0, unit: '°' }
				])
			: []
	);
	const COLORS = ['white', 'gold', 'ink'];
	const FILLS = ['gold', 'alert', 'ink', 'white'];
</script>
{#if artwork.phase !== 'ready' || references.phase !== 'ready'}<p class="soft">Reading locally available cards and their picture references…</p>{/if}
{#if references.limited}<p class="soft">This card’s reference graph is larger than this bounded view. Open its linked source to continue.</p>{/if}
<p class="soft">Cards and pictures shown here are locally available; missing entries may arrive later.</p>

<div class="art">
	{#if cards.length}
		<nav class="shapes" aria-label="Its cards">
			{#each cards as c (c.entry)}
				<button class="chip" class:on={card?.entry === c.entry} aria-pressed={card?.entry === c.entry} onclick={() => ((chosenId = c.entry), (pickedId = null))}
					>{names[c.entry]}{#if /** @type {any} */ (c.record)?.render}<Icon name="check" size={11} />{/if}</button
				>
			{/each}
			{#if makes && !busy}
				{#each missing as [k, name] (k)}
					<button class="chip add" title="Make a {name} card: {SHAPE_USE[k]}" onclick={() => make([k])}>+ {name}</button>
				{/each}
			{/if}
		</nav>
	{:else}
		<div class="blank">
			<p><b>No cards yet.</b> One per shape the story goes out in, its first picture and its hook on each.</p>
			{#if makes}
				<div class="ticks" role="group" aria-label="Which shapes">
					{#each SHAPES as [k, name] (k)}
						<label class="tick">
							<input
								type="checkbox"
								checked={ticked.includes(k)}
								onchange={(e) => (ticked = e.currentTarget.checked ? [...ticked, k] : ticked.filter((t) => t !== k))}
							/>
							<b>{name}</b> <small class="soft">{SHAPE_USE[k]}</small>
						</label>
					{/each}
				</div>
				<button class="btn primary" disabled={busy || !ticked.length} onclick={() => make(SHAPES.map(([k]) => k).filter((k) => ticked.includes(k)))}
					>Make the cards</button
				>
			{:else}
				<p class="soft">Its share doesn’t let {writes ? 'it' : 'you'} add cards to this vault.</p>
			{/if}
		</div>
	{/if}

	{#if card}
		<div class="work">
			<div class="stage" style:--w={shape.ratio[0]} style:--h={shape.ratio[1]}>
				<Card
					layers={drawn}
					hook={words}
					ratio="{shape.ratio[0]} / {shape.ratio[1]}"
					{src}
					editable={edits}
					selected={pickedId === null ? null : String(pickedId)}
					onselect={(id) => (pickedId = Number(id))}
					onmove={(id, x, y) => edit(Number(id), { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })}
					onresize={(id, patch) => edit(Number(id), patch)}
				/>
				<p class="soft under">{shape.name} · {SHAPE_USE[/** @type {import('./artworks.js').Shape} */ (shape.key)]} · {pixelsOf(shape.key).width} × {pixelsOf(shape.key).height}</p>
			</div>

			<aside class="panel" aria-label="The card's layers">
				{#if shape.key === '16x9'}
					<!-- how it looks small, as it is being laid out: a YouTube list entry (dark, the card wide, the title beside it) -->
					<div class="small" aria-label="How it looks on YouTube">
						<div class="mini">
							<span class="new">New</span>
							<span class="length">0:15</span>
							<Card layers={drawn} hook={words} {src} />
						</div>
						<div class="minitext">
							<b>{title}</b>
							<small>maiaCITY <i class="verified" title="Verified">✓</i></small>
							<small>▷ 1.2K · 1d ago</small>
						</div>
					</div>
				{/if}
				<div class="filing">
					{#if rendered && pics[rendered.entry]}<img class="still" src={pics[rendered.entry]} alt="The card as rendered" />{/if}
					<div>
						{#if files && edits}
							<button class="btn primary" disabled={rendering || busy} onclick={render}>{rendering ? 'Drawing…' : rendered ? 'Render it again' : 'Render the card'}</button>
						{/if}
						<small class="soft">{renderNote || (rendered ? `Rendered: ${rendered.title}, in the Library.` : 'Not rendered yet.')}</small>
					</div>
				</div>

				<label class="f">
					<span>Carries <small>the hook its empty words read</small></span>
					<select class="field" value={record.hook === undefined ? '' : String(record.hook)} disabled={!edits} onchange={(e) => carry(e.currentTarget.value)}>
						<option value="">The story’s chosen hook</option>
						{#each hookRows as h, k (h.id)}
							<option value={String(h.id)}>{k + 1}. {h.text}</option>
						{/each}
					</select>
				</label>
				{#if edits}<button class="btn quiet ab" onclick={variant}>Make an A/B card of it</button>{/if}

				<div class="head">
					<span>Layers <small>{layers.length}</small></span>
					{#if edits}
						<span class="adds">
							{#each LAYER_KINDS as [k, name, note] (k)}<button class="add" title={note} onclick={() => add(k)}>+ {name}</button>{/each}
						</span>
					{/if}
				</div>
				{#if layers.length}
					<ol class="list">
						{#each [...layers].reverse() as l (l.id)}
							<li class:picked={pickedId === l.id} class:off={l.on === false}>
								<button class="row" aria-pressed={pickedId === l.id} onclick={() => (pickedId = l.id)}>
									<span class="kind">{kindName(l.kind)}</span>
									<b>{nameOf(l)}</b>
								</button>
								{#if edits}
									<label class="eye" title={l.on === false ? 'Hidden: show it' : 'Shown: hide it'}>
										<input type="checkbox" checked={l.on !== false} onchange={(e) => edit(l.id, { on: e.currentTarget.checked })} />
										<Icon name={l.on === false ? 'eye-off' : 'eye'} size={14} />
									</label>
								{/if}
							</li>
						{/each}
					</ol>
				{:else if edits}
					<div class="usual">
						<button class="btn primary" onclick={start}>Start with the usual four</button>
						<small class="soft">A picture · a cut-out · the hook · the day badge. Or add one layer at a time above.</small>
					</div>
				{:else}
					<p class="soft empty">No layers yet.</p>
				{/if}

				{#if picked}
					<div class="inspector">
						<p class="what"><b>{kindName(picked.kind)}</b> <span class="soft">{kindNote(picked.kind)}</span></p>
						<label class="f"
							><span>Name</span><input
								class="field"
								maxlength="60"
								value={picked.name ?? ''}
								disabled={!edits}
								placeholder={kindName(picked.kind)}
								onchange={(e) => edit(picked.id, { name: e.currentTarget.value.trim() })}
							/></label
						>
						{#if picked.kind === 'image' || picked.kind === 'cutout'}
							<div class="f">
								<span>Picture <small>{byId.get(entryOf(picked.file))?.title ?? 'none yet'}</small></span>
								{#if edits}
									<span class="acts">
										<button class="btn" onclick={() => (picking = !picking)}>{picking ? 'Close' : 'Choose a picture'}</button>
										{#if files}
											<label class="btn">Upload one<input type="file" accept="image/*" hidden onchange={upload} /></label>
										{/if}
									</span>
								{/if}
								{#if picking}
									{#if offered.length}
										<div class="pictures">
											{#each offered as f (f.entry)}
												<button
													class="picture"
													class:chosen={entryOf(picked.file) === f.entry}
													title={f.title}
													onclick={() => choosePicture(f)}
												>
													{#if pics[f.entry]}<img src={pics[f.entry]} alt="" />{:else}<Icon name="image" size={16} />{/if}
												</button>
											{/each}
										</div>
									{:else}
										<p class="soft empty">No pictures in this vault’s Library yet: upload one.</p>
									{/if}
								{/if}
							</div>
							{#if picked.kind === 'image'}
								<label class="f">
									<span>Fit</span>
									<select class="field" value={picked.fit ?? 'cover'} disabled={!edits} onchange={(e) => edit(picked.id, { fit: e.currentTarget.value })}>
										<option value="cover">Cover: fills its box, cropped</option>
										<option value="contain">Contain: whole, with margins</option>
									</select>
								</label>
							{/if}
						{:else}
							<label class="f">
								<span>Words {#if picked.kind === 'text'}<small>empty: the hook it carries</small>{/if}</span>
								<textarea
									class="field"
									rows="3"
									maxlength="300"
									value={picked.text ?? ''}
									disabled={!edits}
									placeholder={picked.kind === 'text' ? words : 'DAY 1'}
									onchange={(e) => edit(picked.id, { text: e.currentTarget.value })}
								></textarea>
							</label>
							<div class="f">
								<span>{picked.kind === 'badge' ? 'Fill' : 'Colour'}</span>
								<span class="swatches">
									{#each picked.kind === 'badge' ? FILLS : COLORS as c (c)}
										<button
											class="swatch {c}"
											class:chosen={(picked.color ?? (picked.kind === 'badge' ? 'gold' : 'white')) === c}
											title={c}
											aria-label={c}
											disabled={!edits}
											onclick={() => edit(picked.id, { color: c })}
										></button>
									{/each}
								</span>
							</div>
							{#if picked.kind === 'text'}
								<label class="f">
									<span>Aligned</span>
									<select class="field" value={picked.align ?? 'left'} disabled={!edits} onchange={(e) => edit(picked.id, { align: e.currentTarget.value })}>
										<option value="left">left</option><option value="center">centre</option><option value="right">right</option>
									</select>
								</label>
							{/if}
						{/if}
						{#each NUMS as n (n.key)}
							<label class="f num">
								<span>{n.label} <small>{picked[n.key] ?? n.at}{n.unit}</small></span>
								<input
									type="range"
									min={n.min}
									max={n.max}
									step={n.step}
									value={picked[n.key] ?? n.at}
									disabled={!edits}
									oninput={(e) => preview(picked.id, { [n.key]: Number(e.currentTarget.value) })}
									onchange={(e) => edit(picked.id, { [n.key]: Number(e.currentTarget.value) })}
								/>
							</label>
						{/each}
						{#if edits}
							<div class="acts">
								<button class="btn" onclick={() => shift(picked.id, 1)} disabled={layers.indexOf(picked) === layers.length - 1}>Up</button>
								<button class="btn" onclick={() => shift(picked.id, -1)} disabled={layers.indexOf(picked) === 0}>Down</button>
								<button class="btn quiet" onclick={() => remove(picked.id)}>Take it off</button>
							</div>
						{/if}
					</div>
				{:else if layers.length}
					<p class="soft empty">Pick a layer, in the list or on the card.</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<style>
	.art {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 0.8rem;
		container-type: inline-size;
	}

	.shapes {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid var(--edge);
		color: inherit;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.chip.on {
		border-color: var(--accent);
		background: #d6e8e4;
		color: #1f4f47;
	}

	.chip.add {
		border-style: dashed;
		background: transparent;
		color: var(--soft);
	}

	.blank {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.7rem;
		padding: 1rem 1.1rem;
		border: 1px dashed var(--edge);
		border-radius: 12px;
	}

	.blank p {
		margin: 0;
	}

	.ticks {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.tick {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.86rem;
	}

	.work {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 19rem);
		align-items: start;
		gap: 1.4rem;
	}

	.stage {
		/* a tall card is as high as the window lets it be, a wide one as wide as its column; it stays in view while the
		   layers beside it scroll */
		position: sticky;
		top: 0.6rem;
		width: min(100%, calc(70vh * var(--w) / var(--h)));
		margin: 0 auto;
	}

	/* ── how it looks small: YouTube's list entry, dark, the card about 55% wide, the words beside it in its own sans ── */
	.small {
		display: flex;
		gap: 0.55rem;
		padding: 0.6rem 0.6rem 0.7rem;
		border-radius: 12px;
		background: #0f0f0f;
		color: #f1f1f1;
		font-family: Roboto, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
	}

	.mini {
		position: relative;
		flex: none;
		width: 55%;
		overflow: hidden;
		border-radius: 8px;
	}

	.mini .new,
	.mini .length {
		position: absolute;
		z-index: 1;
		padding: 0.1rem 0.3rem;
		border-radius: 4px;
		font-size: 0.62rem;
		font-weight: 600;
		line-height: 1.2;
	}

	.mini .new {
		top: 0.3rem;
		left: 0.3rem;
		background: #fff;
		color: #0f0f0f;
	}

	.mini .length {
		right: 0.3rem;
		bottom: 0.3rem;
		background: rgb(0 0 0 / 0.8);
		color: #fff;
	}

	.minitext {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.minitext b {
		display: -webkit-box;
		overflow: hidden;
		color: #f1f1f1;
		font-size: 0.78rem;
		font-weight: 500;
		line-height: 1.3;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	.minitext small {
		color: #aaa;
		font-size: 0.66rem;
	}

	.minitext .verified {
		font-size: 0.6rem;
		font-style: normal;
	}

	.usual {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
	}

	.usual small {
		font-size: 0.76rem;
	}

	.under {
		margin: 0.4rem 0 0;
		font-size: 0.74rem;
		text-align: center;
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}

	.filing {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.filing > div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.3rem;
	}

	.filing small {
		font-size: 0.74rem;
	}

	.still {
		width: 4.5rem;
		max-height: 4.5rem;
		object-fit: contain;
		border-radius: 6px;
		background: #111;
	}

	.ab {
		align-self: flex-start;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.4rem;
		color: var(--soft);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.head small {
		letter-spacing: 0;
	}

	.adds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.add {
		padding: 0.15rem 0.45rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		color: inherit;
		font: inherit;
		font-size: 0.72rem;
		letter-spacing: 0;
		text-transform: none;
		cursor: pointer;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: center;
		border: 1px solid var(--edge);
		border-radius: 9px;
		background: #fff;
	}

	.list li.picked {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px rgb(47 107 95 / 0.18);
	}

	.list li.off {
		opacity: 0.55;
	}

	.row {
		display: flex;
		flex: 1 1 auto;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.4rem 0.6rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.row .kind {
		flex: none;
		color: var(--soft);
		font-size: 0.68rem;
	}

	.row b {
		overflow: hidden;
		font-size: 0.84rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.eye {
		display: grid;
		place-items: center;
		padding: 0 0.55rem;
		color: var(--soft);
		cursor: pointer;
	}

	.eye input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}

	.inspector {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fbfaf6;
	}

	.what {
		margin: 0;
		font-size: 0.82rem;
	}

	.f {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.f small {
		color: var(--soft);
		font-weight: 400;
	}

	.f .field {
		box-sizing: border-box;
		width: 100%;
		font: inherit;
		font-weight: 400;
	}

	.f.num input {
		width: 100%;
		accent-color: var(--accent);
	}

	.acts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.acts label.btn {
		cursor: pointer;
	}

	.pictures {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(3.6rem, 1fr));
		gap: 0.3rem;
		max-height: 14rem;
		overflow: auto;
	}

	.picture {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: 0;
		overflow: hidden;
		border: 2px solid transparent;
		border-radius: 8px;
		background: #e3eaf3;
		color: #2b3f63;
		cursor: pointer;
	}

	.picture.chosen {
		border-color: var(--accent);
	}

	.picture img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.swatches {
		display: flex;
		gap: 0.35rem;
	}

	.swatch {
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: 2px solid var(--edge);
		border-radius: 50%;
		cursor: pointer;
	}

	.swatch.chosen {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px rgb(47 107 95 / 0.25);
	}

	.swatch.white {
		background: #fff;
	}

	.swatch.gold {
		background: #f6c75a;
	}

	.swatch.ink {
		background: #1d2b22;
	}

	.swatch.alert {
		background: #e0352b;
	}

	.empty {
		margin: 0;
		font-size: 0.8rem;
	}

	@container (max-width: 720px) {
		.work {
			grid-template-columns: minmax(0, 1fr);
		}

		/* one column: the card scrolls away with the rest, over nothing */
		.stage {
			position: static;
		}
	}
</style>
