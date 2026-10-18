<!--
	What a spark's canvas (./SparkCanvas.svelte) can take, in the left side of its page (Note, ./Frame.svelte): every
	artifact of its vault (./artifacts.js), the newest first, and its other sparks, found by their words or, in the rows
	over them, by what they are. Each is dragged onto the canvas, to land where it is let go, or put on it under the rest
	with its own button, where the hand has no pointer to drag with. What the canvas holds already is left out. Each is
	one op on the canvas's line, for the acting vault, as the device allows it (`may`).
-->
<script>
	import { entryOf, fromWords, isArtifact, LOOK_NAME, LOOKS, lookOf, youtubePicture } from './artifacts.js';
	import Icon from './Icon.svelte';
	import { allowed, may } from './ops.js';
	import { isSpark, itemsFor, PIECE, pictureOf, pieces, textItem } from './sparks.js';
	import { count, reads } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string,
	 *   vault: string, line: string | null, record: any, writes: boolean }}
	 */
	let { world, actor, api, busy, entry, vault, line, record, writes } = $props();

	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const items = $derived(/** @type {any[]} */ (record?.items ?? []));
	const onIt = $derived(new Set(items.map((it) => entryOf(it.ref)).filter(Boolean)));

	/** what it can take: the vault's artifacts and its other sparks it doesn't hold yet, the newest first */
	const all = $derived(
		world.entries
			.filter(
				(e) =>
					e.vault === vault &&
					!e.deleted &&
					reads(e, actor) &&
					e.entry !== entry &&
					!onIt.has(e.entry) &&
					(isArtifact(e) || (isSpark(e) && e.type === 'spark'))
			)
			.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
	);

	/** which it shows: every artifact, those of one look, or the sparks */
	let only = $state(/** @type {string} */ ('artifacts'));
	let find = $state('');
	const kinds = $derived([
		['artifacts', 'All', all.filter(isArtifact).length],
		...LOOKS.map(([look, name]) => [look, name, all.filter((e) => isArtifact(e) && lookOf(e) === look).length]).filter(([, , n]) => n),
		['sparks', 'Sparks', all.filter((e) => !isArtifact(e)).length]
	]);
	const shown = $derived.by(() => {
		const q = find.trim().toLowerCase();
		return all.filter(
			(e) =>
				(only === 'artifacts' ? isArtifact(e) : only === 'sparks' ? !isArtifact(e) : isArtifact(e) && lookOf(e) === only) &&
				(!q || `${e.title ?? ''} ${e.text ?? ''} ${/** @type {any} */ (e.record)?.url ?? ''}`.toLowerCase().includes(q))
		);
	});
	/** how many it lists at once, more on asking */
	let room = $state(60);

	/** whether the acting vault's ops let it change the canvas on the line, as the device says */
	let changes = $state(false);
	$effect(() => {
		void world;
		let gone = false;
		const probe = { op: 'insert', entry, line, path: ['items'], value: textItem(items, '') };
		if (writes) may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		else changes = false;
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	/** What piece `e` is on a canvas. @param {any} e */
	const whatOf = (e) => /** @type {'artifact' | 'spark'} */ (isArtifact(e) ? 'artifact' : 'spark');

	/** Puts piece `e` on the canvas, under the rest. @param {any} e */
	function put(e) {
		const [value] = itemsFor(items, [{ vault: e.vault, entry: e.entry, what: whatOf(e) }]);
		api.run(`Putting “${e.title || 'it'}” on the canvas`, { op: 'insert', entry, line, path: ['items'], value, as: actor });
	}

	/** Hands piece `e` to the canvas it is dragged onto. @param {DragEvent} ev @param {any} e */
	function lift(ev, e) {
		if (!ev.dataTransfer) return;
		ev.dataTransfer.setData(PIECE, JSON.stringify({ vault: e.vault, entry: e.entry, what: whatOf(e) }));
		ev.dataTransfer.effectAllowed = 'copy';
	}

	/** the picture of each artifact listed, by its entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const a of shown.slice(0, room)) {
			if (!isArtifact(a) || pics[a.entry]) continue;
			const r = /** @type {any} */ (a.record);
			const yt = youtubePicture(r);
			if (yt) {
				pics = { ...pics, [a.entry]: yt };
				continue;
			}
			const file = byId.get(entryOf(r?.files?.[0]));
			if (file) pictureOf(api, file).then((u) => !gone && u && (pics = { ...pics, [a.entry]: u }));
		}
		return () => {
			gone = true;
		};
	});

	/** Look `l`'s icon. @param {string} l */
	const iconOf = (l) => LOOKS.find(([k]) => k === l)?.[2] ?? 'artifact';
	/** The icon of what it shows, `k`: the sparks, else every artifact or those of one look. @param {string} k */
	const kindIcon = (k) => (k === 'sparks' ? 'spark' : iconOf(k));
</script>

<section class="shelf" aria-label="Artifacts and sparks to put on the canvas">
	<input class="nav-search" type="search" bind:value={find} placeholder="Find an artifact or a spark" aria-label="Find an artifact or a spark" />
	<h3 class="nav-group">Show</h3>
	<div role="group" aria-label="Which to show">
		{#each kinds as [k, name, n] (k)}
			<button class="nav-item" class:on={only === k} aria-pressed={only === k} onclick={() => ((only = String(k)), (room = 60))}
				><Icon name={kindIcon(String(k))} size={16} /><span>{name}</span><small>{n}</small></button
			>
		{/each}
	</div>
	<h3 class="nav-group">Not on the canvas yet</h3>
	{#if edits}
		<p class="hint soft">Drag one onto the canvas, or put it there with +.</p>
	{/if}

	{#if shown.length}
		<ul>
			{#each shown.slice(0, room) as e (e.entry)}
				{@const art = isArtifact(e)}
				{@const look = lookOf(e)}
				<li class="piece" class:lifts={edits} draggable={edits ? 'true' : 'false'} ondragstart={(ev) => lift(ev, e)}>
					<span class="thumb {art ? look : 'spark'}" aria-hidden="true">
						{#if pics[e.entry]}<img src={pics[e.entry]} alt="" draggable="false" />{:else}<Icon
								name={art ? iconOf(look) : 'spark'}
								size={16}
							/>{/if}
					</span>
					<a class="words" href={art ? `#artifacts/${e.entry}` : `#notes/${e.entry}`} draggable="false">
						<b>{e.title || 'Untitled'}</b>
						<small class="soft">
							{#if art}{LOOK_NAME[look]}{fromWords(e.record) ? ` · ${fromWords(e.record)}` : ''}{:else}Spark · {count(
									pieces(world, e).artifacts.length,
									'artifact'
								)}{/if}
						</small>
					</a>
					{#if edits}
						<button class="add" title="Put it on the canvas" aria-label="Put “{e.title || 'it'}” on the canvas" onclick={() => put(e)}
							><Icon name="plus" size={14} /></button
						>
					{/if}
				</li>
			{/each}
		</ul>
		{#if shown.length > room}
			<button class="btn quiet more" onclick={() => (room += 60)}>Show {count(Math.min(60, shown.length - room), 'more', 'more')}</button>
		{/if}
	{:else}
		<p class="hint soft">
			{find.trim()
				? 'Nothing matches.'
				: only === 'sparks'
					? 'Every other spark of this vault is on the canvas, or there are none yet.'
					: all.length || onIt.size
						? 'Every artifact of this kind is on the canvas.'
						: 'No artifacts in this vault yet. Paste a link or drop a file on the canvas to make one.'}
		</p>
	{/if}
</section>

<style>
	.hint {
		margin: 0 0.6rem 0.5rem;
		font-size: 0.78rem;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.piece {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.35rem 0.4rem;
		border: 1px solid transparent;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 1px 3px rgb(38 56 44 / 0.08);
	}

	.piece.lifts {
		cursor: grab;
	}

	.piece.lifts:hover {
		border-color: var(--edge);
	}

	.piece.lifts:active {
		cursor: grabbing;
	}

	.thumb {
		display: grid;
		flex: none;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		overflow: hidden;
		border-radius: 8px;
		background: #e3eaf3;
		color: #2b3f63;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.thumb.video,
	.thumb.youtube {
		background: #2a2f2c;
		color: #fff;
	}

	.thumb.image {
		background: #e2ece7;
		color: var(--accent);
	}

	.thumb.spark {
		background: #f1ede4;
		color: #8a6a2f;
	}

	.words {
		display: flex;
		flex: 1 1 auto;
		flex-direction: column;
		min-width: 0;
		color: inherit;
		text-decoration: none;
	}

	.words b,
	.words small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.words b {
		font-size: 0.84rem;
		font-weight: 600;
	}

	.words small {
		font-size: 0.72rem;
	}

	.words:hover b {
		text-decoration: underline;
	}

	.add {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.8rem;
		height: 1.8rem;
		padding: 0;
		border: 1px solid var(--edge);
		border-radius: 50%;
		background: #fff;
		color: inherit;
		cursor: pointer;
	}

	.add:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.more {
		margin-top: 0.5rem;
	}
</style>
