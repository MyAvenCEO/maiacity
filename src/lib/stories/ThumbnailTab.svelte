<!--
	A story's thumbnail: the 16:9 title card, designed in layers like in an image editor — the card large in the
	middle, its layers listed on the right (top layer first, each shown or hidden, picked by a click here or on the
	card, moved by dragging it there), and under the list what the picked layer is made of: the picture (one of the
	story's files, by hash), how it fits, its place and size; a text's words (empty: the hook itself), colour and
	alignment; a badge's words. Under the card: the card rendered from these layers (scripts/film/thumbnail.mjs, or by
	hand on the Mac), by hash, once there is one — that is what goes out.
-->
<script>
	import { LAYER_KINDS, fileUrl } from '$lib/auth/client';
	import Card from './Card.svelte';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Layer} Layer */
	/** @typedef {import('$lib/auth/client').LayerKind} LayerKind */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	/** @type {Record<LayerKind, string>} */
	const KIND_LABEL = { image: 'Picture', cutout: 'Cut-out', text: 'Text', badge: 'Badge' };
	/** @type {Record<LayerKind, string>} */
	const KIND_NOTE = { image: 'a picture from the vault, the background usually', cutout: 'a transparent PNG laid over it: a face out of a frame', text: 'the hook, big (empty: the hook itself)', badge: 'the day, bottom right' };
	const COLORS = ['white', 'gold', 'ink'];

	const layers = $derived(item.thumbnail?.layers ?? []);
	const hook = $derived((item.hook ?? '').trim() || item.title);
	/** @type {string | null} the layer picked */
	let pickedId = $state(null);
	const picked = $derived(layers.find((l) => l.id === pickedId) ?? null);
	/** the files the story carries, newest last, plus every picture a layer names: what the picker offers */
	const files = $derived([...new Set([...(item.hashes ?? []), ...layers.flatMap((l) => (l.hash ? [l.hash] : []))])]);
	/** @type {Record<string, boolean>} a file that is not a picture (a film, a sound) is hidden from the picker */
	let broken = $state({});

	const newId = () => `l${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
	/** @param {Layer[]} next */
	const setLayers = (next) => onchange({ thumbnail: { ...(item.thumbnail ?? {}), layers: next } });
	/** @param {string} id @param {Partial<Layer>} patch */
	const edit = (id, patch) => setLayers(layers.map((l) => (l.id === id ? { ...l, ...patch } : l)));

	/** A new layer of that kind, on top, with a sensible place; a picture gets the first file the story has. @param {LayerKind} kind */
	function add(kind) {
		/** @type {Layer} */
		const l = { id: newId(), kind, on: true };
		if (kind === 'image') Object.assign(l, { x: 0, y: 0, w: 100, fit: 'cover', hash: layers.some((x) => x.kind === 'image') ? undefined : files[0] });
		if (kind === 'cutout') Object.assign(l, { x: -2, y: 8, w: 46 });
		if (kind === 'text') Object.assign(l, { x: 48, y: 14, w: 48, size: 6.2, color: 'white' });
		if (kind === 'badge') Object.assign(l, { x: 82, y: 85, size: 2.6, color: 'gold', text: 'DAY 1' });
		setLayers([...layers, l]);
		pickedId = l.id;
	}

	/** The usual four, bottom to top: the picture, the cut-out, the hook, the badge. */
	function start() {
		setLayers([
			{ id: 'bg', kind: 'image', name: 'Background', on: true, x: 0, y: 0, w: 100, fit: 'cover', hash: files[0] },
			{ id: 'face', kind: 'cutout', name: 'Face', on: true, x: -2, y: 8, w: 46 },
			{ id: 'hook', kind: 'text', name: 'Hook', on: true, x: 48, y: 14, w: 48, size: 6.2, color: 'white' },
			{ id: 'day', kind: 'badge', name: 'Day', on: true, x: 82, y: 85, size: 2.6, color: 'gold', text: 'DAY 1' }
		]);
		pickedId = 'hook';
	}

	function remove(/** @type {string} */ id) {
		setLayers(layers.filter((l) => l.id !== id));
		if (pickedId === id) pickedId = null;
	}

	/** Up or down the stack (up: nearer the top, drawn later). @param {string} id @param {-1 | 1} by */
	function shift(id, by) {
		const k = layers.findIndex((l) => l.id === id);
		const to = k + by;
		if (k < 0 || to < 0 || to >= layers.length) return;
		const next = [...layers];
		[next[k], next[to]] = [next[to], next[k]];
		setLayers(next);
	}

	/** @param {Layer} l */
	const nameOf = (l) => l.name || (l.kind === 'text' ? (l.text || hook).slice(0, 28) : l.kind === 'badge' ? l.text || 'DAY 1' : KIND_LABEL[l.kind]);

	/** the number fields a layer has, each with its range */
	const NUMS = $derived(
		picked
			? /** @type {{ key: 'x' | 'y' | 'w' | 'size', label: string, min: number, max: number, step: number }[]} */ ([
					{ key: 'x', label: 'Left', min: -50, max: 100, step: 0.5 },
					{ key: 'y', label: 'Top', min: -50, max: 100, step: 0.5 },
					...(picked.kind === 'badge' ? [] : [{ key: 'w', label: 'Width', min: 5, max: 150, step: 0.5 }]),
					...(picked.kind === 'text' || picked.kind === 'badge' ? [{ key: 'size', label: 'Size', min: 1, max: 20, step: 0.1 }] : [])
				])
			: []
	);
	/** the value a number field shows: the layer's, else the kind's default (the card's own) */
	const DEFAULT = { image: { x: 0, y: 0, w: 100, size: 0 }, cutout: { x: 0, y: 10, w: 45, size: 0 }, text: { x: 48, y: 16, w: 48, size: 6.2 }, badge: { x: 82, y: 86, w: 0, size: 2.4 } };
	const numOf = (/** @type {Layer} */ l, /** @type {'x' | 'y' | 'w' | 'size'} */ k) => l[k] ?? DEFAULT[l.kind][k];

	/** @param {string} v */
	function setCard(v) {
		const h = v.trim().toLowerCase();
		if (h && !/^[0-9a-f]{64}$/.test(h)) return;
		onchange({ thumbnail: { ...(item.thumbnail ?? {}), layers, card: h || null } });
	}
</script>

<div class="thumb">
	<!-- the card, large, in the middle -->
	<div class="stage">
		{#if layers.length}
			<Card {layers} {hook} selected={pickedId} editable onselect={(id) => (pickedId = id)} onmove={(id, x, y) => edit(id, { x, y })} />
			<p class="stagenote">Click a layer to pick it, drag it to move it. 16:9, every place in percent of the card.</p>
		{:else}
			<div class="blank">
				<p>No layers yet.</p>
				<button class="go" onclick={start}>Start with the usual four</button>
				<small>A picture · a cut-out · the hook · the day badge</small>
			</div>
		{/if}

		<section class="out" aria-label="The rendered card">
			<div class="outhead">
				<span>The card that goes out <small>rendered from these layers, by hash</small></span>
			</div>
			{#if item.thumbnail?.card}
				<img class="rendered" src={fileUrl(item.thumbnail.card)} alt="The 16:9 title card, rendered" />
			{/if}
			<label class="hashfield">
				<span>Its hash</span>
				<input value={item.thumbnail?.card ?? ''} maxlength="64" placeholder="64 hex characters, once it is rendered and in the vault" spellcheck="false" onchange={(e) => setCard(e.currentTarget.value)} />
			</label>
		</section>
	</div>

	<!-- the layers, top first; what the picked one is made of -->
	<aside class="layers" aria-label="The layers">
		<div class="head">
			<span>Layers <small>{layers.length}</small></span>
			<span class="adds">
				{#each LAYER_KINDS as k (k)}<button class="add" title={KIND_NOTE[k]} onclick={() => add(k)}>+ {KIND_LABEL[k]}</button>{/each}
			</span>
		</div>
		{#if layers.length}
			<ol class="list">
				{#each [...layers].reverse() as l (l.id)}
					<li class:picked={pickedId === l.id} class:off={l.on === false}>
						<button class="eye" aria-pressed={l.on !== false} title={l.on === false ? 'Show it' : 'Hide it'} onclick={() => edit(l.id, { on: l.on === false })}>{l.on === false ? '○' : '●'}</button>
						<button class="row" onclick={() => (pickedId = pickedId === l.id ? null : l.id)}>
							<span class="kind">{KIND_LABEL[l.kind]}</span>
							<b>{nameOf(l)}</b>
						</button>
					</li>
				{/each}
			</ol>
		{/if}

		{#if picked}
			<div class="inspector">
				<p class="what"><b>{KIND_LABEL[picked.kind]}</b> <span>{KIND_NOTE[picked.kind]}</span></p>
				<label class="field"><span>Name</span><input maxlength="60" value={picked.name ?? ''} placeholder={KIND_LABEL[picked.kind]} oninput={(e) => edit(picked.id, { name: e.currentTarget.value })} /></label>

				{#if picked.kind === 'image' || picked.kind === 'cutout'}
					<div class="field">
						<span>Picture <small>{files.length ? 'one of the story’s files' : 'the story carries no files yet'}</small></span>
						{#if files.length}
							<div class="files">
								{#each files as h (h)}
									{#if !broken[h]}
										<button class="file" class:chosen={picked.hash === h} title={h} onclick={() => edit(picked.id, { hash: h })}>
											<img src={fileUrl(h)} alt="" loading="lazy" onerror={() => (broken = { ...broken, [h]: true })} />
										</button>
									{/if}
								{/each}
							</div>
						{/if}
						<input class="hash" maxlength="64" value={picked.hash ?? ''} placeholder="or a vault file’s hash" spellcheck="false" onchange={(e) => /^[0-9a-f]{64}$/.test(e.currentTarget.value.trim()) && edit(picked.id, { hash: e.currentTarget.value.trim() })} />
					</div>
					{#if picked.kind === 'image'}
						<label class="field">
							<span>Fit</span>
							<select value={picked.fit ?? 'cover'} onchange={(e) => edit(picked.id, { fit: /** @type {'cover' | 'contain'} */ (e.currentTarget.value) })}>
								<option value="cover">Cover: fills its box, cropped</option>
								<option value="contain">Contain: whole, with margins</option>
							</select>
						</label>
					{/if}
				{:else}
					<label class="field">
						<span>Words {#if picked.kind === 'text'}<small>empty: the hook</small>{/if}</span>
						<textarea rows="3" maxlength="300" value={picked.text ?? ''} placeholder={picked.kind === 'text' ? hook : 'DAY 1'} oninput={(e) => edit(picked.id, { text: e.currentTarget.value })}></textarea>
					</label>
					<label class="field">
						<span>Colour</span>
						<select value={picked.color ?? (picked.kind === 'badge' ? 'gold' : 'white')} onchange={(e) => edit(picked.id, { color: e.currentTarget.value })}>
							{#each COLORS as c (c)}<option value={c}>{c}</option>{/each}
						</select>
					</label>
					{#if picked.kind === 'text'}
						<label class="field">
							<span>Aligned</span>
							<select value={picked.align ?? 'left'} onchange={(e) => edit(picked.id, { align: /** @type {'left' | 'center' | 'right'} */ (e.currentTarget.value) })}>
								<option value="left">left</option><option value="center">centre</option><option value="right">right</option>
							</select>
						</label>
					{/if}
				{/if}

				{#each NUMS as n (n.key)}
					<label class="field num">
						<span>{n.label} <small>{numOf(picked, n.key)}{n.key === 'size' ? ' · % of the width' : ' %'}</small></span>
						<input type="range" min={n.min} max={n.max} step={n.step} value={numOf(picked, n.key)} oninput={(e) => edit(picked.id, { [n.key]: Number(e.currentTarget.value) })} />
					</label>
				{/each}

				<div class="actions">
					<button onclick={() => shift(picked.id, 1)} disabled={layers.indexOf(picked) === layers.length - 1}>Up</button>
					<button onclick={() => shift(picked.id, -1)} disabled={layers.indexOf(picked) === 0}>Down</button>
					<button class="drop" onclick={() => remove(picked.id)}>Remove</button>
				</div>
			</div>
		{:else if layers.length}
			<p class="empty">Pick a layer, in the list or on the card.</p>
		{/if}
	</aside>
</div>

<style>
	.thumb {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 21rem);
		align-items: start;
		gap: 2rem;
	}

	/* ── the card ── */
	.stage {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}

	.stagenote {
		margin: 0;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		aspect-ratio: 16 / 9;
		border: 1px dashed var(--line);
		border-radius: 12px;
		background: #f2f0ea;
		color: var(--muted);
	}

	.blank p {
		margin: 0;
	}

	.go {
		padding: 0.45rem 1.1rem;
		border: 1px solid var(--ink);
		border-radius: 999px;
		background: var(--ink);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--paper);
		cursor: pointer;
	}

	.blank small {
		font-size: 0.72rem;
	}

	.out {
		margin-top: 1.2rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}

	.outhead {
		display: flex;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.outhead small {
		margin-left: 0.4rem;
		font-weight: 400;
		color: var(--muted);
	}

	.rendered {
		display: block;
		width: min(100%, 32rem);
		border-radius: 10px;
		box-shadow: 0 6px 24px rgb(38 56 44 / 0.15);
	}

	.hashfield {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-top: 0.6rem;
		font-size: 0.75rem;
		color: var(--muted);
	}

	.hashfield input {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-family: ui-monospace, monospace;
		font-size: 0.72rem;
	}

	/* ── the layers ── */
	.layers {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: calc(100vh - 8rem);
		overflow: auto;
		padding: 0.9rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: #fff;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.4rem;
		font-size: 0.82rem;
		font-weight: 600;
	}

	.head small {
		margin-left: 0.3rem;
		font-weight: 400;
		color: var(--muted);
	}

	.adds {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.add {
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.7rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		display: flex;
		align-items: stretch;
		gap: 0.2rem;
		border-radius: 8px;
	}

	.list li.picked {
		background: #fbf3dc;
		outline: 1px solid #f6c75a;
	}

	.list li.off {
		opacity: 0.5;
	}

	.list button {
		border: 0;
		background: none;
		font: inherit;
		cursor: pointer;
	}

	.eye {
		width: 1.8rem;
		font-size: 0.7rem;
		color: var(--ink-soft);
	}

	.row {
		display: flex;
		flex: 1;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.4rem 0.4rem 0.4rem 0;
		text-align: left;
	}

	.kind {
		flex: none;
		width: 3.6rem;
		font-size: 0.66rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.row b {
		overflow: hidden;
		font-size: 0.82rem;
		font-weight: 600;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.inspector {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}

	.what {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}

	.what b {
		color: var(--ink);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.72rem;
		color: var(--muted);
	}

	.field small {
		margin-left: 0.3rem;
	}

	.field input:not([type='range']),
	.field select,
	.field textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.35rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font: inherit;
		font-size: 0.82rem;
		color: var(--ink);
	}

	.field .hash {
		font-family: ui-monospace, monospace;
		font-size: 0.68rem;
	}

	.files {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.3rem;
		margin: 0.2rem 0;
	}

	.file {
		padding: 0;
		border: 2px solid transparent;
		border-radius: 6px;
		background: #111;
		overflow: hidden;
		cursor: pointer;
	}

	.file.chosen {
		border-color: #f6c75a;
	}

	.file img {
		display: block;
		aspect-ratio: 16 / 9;
		width: 100%;
		object-fit: cover;
	}

	.num input {
		width: 100%;
	}

	.actions {
		display: flex;
		gap: 0.3rem;
		margin-top: 0.2rem;
	}

	.actions button {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.74rem;
		color: var(--ink-soft);
		cursor: pointer;
	}

	.actions button:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.actions .drop {
		margin-left: auto;
		border-color: transparent;
		color: #9c3b26;
	}

	.empty {
		margin: 0;
		font-size: 0.78rem;
		color: var(--muted);
	}

	@media (max-width: 900px) {
		.thumb {
			grid-template-columns: minmax(0, 1fr);
		}

		.layers {
			position: static;
			max-height: none;
		}
	}
</style>
