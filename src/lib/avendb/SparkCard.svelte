<!--
	One spark as a card: what it shows by its look (./sparks.js), its picture, its link's host, its quote, its words, or
	for a mood board the first four of the sparks it gathers; under it its title, whose it is, and how many stories and
	mood boards grow from it. A click opens it as a note opens; where the page picks sparks, a box in its corner picks
	it too, and where it lists a story's sparks, a button takes it out.
-->
<script>
	import Icon from './Icon.svelte';
	import { byWords, grownFrom, hostOf, LOOK_NAME, LOOKS, lookOf, pictureOf } from './sparks.js';
	import { count } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, item: import('./vaults.js').EntryView,
	 *   picked?: boolean, picking?: boolean, onpick?: (on: boolean) => void, onremove?: () => void,
	 *   removeLabel?: string, small?: boolean }}
	 */
	let { world, api, item, picked = false, picking = false, onpick, onremove, removeLabel = 'Take it out', small = false } =
		$props();

	const record = $derived(/** @type {any} */ (item.record) ?? {});
	const look = $derived(lookOf(item));
	const icon = $derived(LOOKS.find(([l]) => l === look)?.[2] ?? 'spark');
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	/** the sparks it shows a picture or a title of: a mood board's first four, else itself, its own first file */
	const members = $derived(
		look === 'moodboard'
			? /** @type {string[]} */ (record.sparks ?? []).flatMap((s) => byId.get(s) ?? []).slice(0, 4)
			: []
	);
	const shows = $derived(members.length ? members : [item]);
	/** where it grows into, in words: the stories and the mood boards that name it among their sparks */
	const grows = $derived.by(() => {
		const all = grownFrom(world, item.entry);
		const stories = all.filter((e) => e.type === 'story').length;
		const boards = all.length - stories;
		return [stories ? `in ${count(stories, 'story', 'stories')}` : '', boards ? `on ${count(boards, 'mood board')}` : '']
			.filter(Boolean)
			.join(', ');
	});
	const by = $derived(byWords(record.by));

	/** the picture of each spark it shows, by entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const s of shows) {
			const sr = /** @type {any} */ (s?.record);
			const file = byId.get(sr?.files?.[0] ?? '');
			if (!file || pics[s.entry]) continue;
			pictureOf(api, file).then((url) => !gone && url && (pics = { ...pics, [s.entry]: url }));
		}
		return () => {
			gone = true;
		};
	});
	const own = $derived(pics[item.entry]);
</script>

<div class="spark" class:picked class:picking class:small class:deleted={item.deleted}>
	<a class="open" href="#notes/{item.entry}" aria-label="{LOOK_NAME[look]}: {item.title || 'untitled'}">
		<span class="face {look}" aria-hidden="true">
			{#if look === 'moodboard'}
				<span class="board" class:one={shows.length < 2}>
					{#each shows as s (s.entry)}
						{#if pics[s.entry]}
							<img src={pics[s.entry]} alt="" />
						{:else if s === item}
							<span class="tile"><Icon name="board" size={26} /></span>
						{:else}
							<span class="tile"><b>{s.title}</b></span>
						{/if}
					{/each}
				</span>
			{:else if own}
				<img class="pic" src={own} alt="" />
			{:else if look === 'video'}
				<span class="video"><Icon name="play" size={30} /><small>{record.by?.platform || hostOf(record.url ?? '') || 'Video'}</small></span>
			{:else if look === 'link' || look === 'post'}
				<span class="linkish">
					<Icon name={icon} size={22} />
					<b>{hostOf(record.url ?? '') || 'A link'}</b>
					{#if item.text}<span>{item.text}</span>{/if}
				</span>
			{:else if look === 'quote'}
				<span class="said"><Icon name="quote" size={18} /><span>{item.text || item.title}</span></span>
			{:else}
				<span class="page"><b>{item.title}</b><span>{item.text}</span></span>
			{/if}
		</span>
		<span class="info">
			<span class="kind"><Icon name={icon} size={12} /> {LOOK_NAME[look]}</span>
			<b>{item.title || 'Untitled'}</b>
			{#if by}<small class="soft">{by}</small>{/if}
			{#if grows && !small}<small class="grows">{grows[0].toUpperCase()}{grows.slice(1)}</small>{/if}
		</span>
	</a>
	{#if onpick}
		<label class="pick" title={picked ? 'Picked' : 'Pick it'}>
			<input type="checkbox" checked={picked} onchange={(e) => onpick(e.currentTarget.checked)} aria-label="Pick “{item.title}”" />
		</label>
	{/if}
	{#if onremove}
		<button class="remove" title={removeLabel} aria-label="{removeLabel}: “{item.title}”" onclick={onremove}>
			<Icon name="close" size={14} />
		</button>
	{/if}
</div>

<style>
	.spark {
		position: relative;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--edge);
		border-radius: 12px;
		background: #fff;
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.spark:hover,
	.spark:focus-within {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.08);
	}

	.spark.picked {
		border-color: var(--accent);
		box-shadow: 0 0 0 2px var(--accent);
	}

	.spark.deleted {
		opacity: 0.55;
	}

	.open {
		display: flex;
		flex-direction: column;
		color: inherit;
		text-decoration: none;
	}

	.face {
		display: grid;
		height: 9rem;
		overflow: hidden;
		border-bottom: 1px solid var(--edge);
		background: #f1efe9;
	}

	.small .face {
		height: 5.5rem;
	}

	.face.thought {
		background: #f6f0dc;
	}

	.face.quote {
		background: #ece6f4;
	}

	.face.link,
	.face.post {
		background: #e4ecf3;
	}

	.face.video {
		background: #23262b;
		color: #f4f1ea;
	}

	.pic {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.board {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 2px;
		height: 100%;
	}

	.board.one {
		grid-template-columns: 1fr;
	}

	.board img,
	.board .tile {
		width: 100%;
		height: 100%;
		min-height: 0;
		object-fit: cover;
	}

	.tile {
		display: grid;
		place-items: center;
		padding: 0.3rem;
		box-sizing: border-box;
		overflow: hidden;
		background: #e6e1d6;
		color: #5b5446;
		font-size: 0.62rem;
		text-align: center;
	}

	.video {
		display: grid;
		place-items: center;
		align-content: center;
		gap: 0.3rem;
	}

	.video small {
		font-size: 0.7rem;
		opacity: 0.75;
	}

	.linkish,
	.said,
	.page {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding: 0.85rem 0.95rem;
		overflow: hidden;
		overflow-wrap: anywhere;
		font-size: 0.74rem;
		line-height: 1.45;
	}

	.linkish {
		color: #2b3f63;
	}

	.said {
		color: #4b3a6a;
		font-family: Georgia, 'Times New Roman', serif;
		font-size: 0.9rem;
		font-style: italic;
	}

	.page {
		margin: 0.7rem 0.9rem 0;
		padding: 0.7rem 0.75rem;
		background: #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
		font-size: 0.58rem;
		white-space: pre-wrap;
	}

	.page b {
		font-size: 0.72rem;
	}

	.info {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.55rem 0.75rem 0.65rem;
		min-width: 0;
	}

	.info > b {
		overflow: hidden;
		font-size: 0.88rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.info small {
		overflow: hidden;
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.kind {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--soft);
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.grows {
		color: #1f4f47;
	}

	/* the box that picks it: in a corner, faint until the card is pointed at or it is picked, always on a touch screen */
	.pick {
		position: absolute;
		top: 0.45rem;
		right: 0.45rem;
		opacity: 0;
		transition: opacity 0.15s ease;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 6px;
		background: rgb(255 255 255 / 0.92);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
		cursor: pointer;
	}

	.spark:hover .pick,
	.spark:focus-within .pick,
	.picked .pick,
	.picking .pick {
		opacity: 1;
	}

	@media (hover: none) {
		.pick {
			opacity: 1;
		}
	}

	.pick input {
		width: 1rem;
		height: 1rem;
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}

	.remove {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.92);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
		color: inherit;
		cursor: pointer;
	}

	.remove:hover {
		color: #9a3324;
	}
</style>
