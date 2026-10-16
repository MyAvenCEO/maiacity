<!--
	One artifact as a row of a list (./Artifacts.svelte): a small square of its picture, else its look's icon on its
	look's colour (./artifacts.js); its title, and under it what it is, where it is from and how many sparks hold it;
	its tags at its end, the auto tags `sparks` and `stories` among them. A tap opens it; where the page picks
	artifacts, the round box at its end picks it.
-->
<script>
	import { entryOf, fromWords, IN_SPARKS, IN_STORIES, LOOK_NAME, LOOKS, lookOf, sparksHolding } from './artifacts.js';
	import Icon from './Icon.svelte';
	import { pictureOf } from './sparks.js';
	import { count } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, item: import('./vaults.js').EntryView,
	 *   picked?: boolean, onpick?: (on: boolean) => void }}
	 */
	let { world, api, item, picked = false, onpick } = $props();

	const record = $derived(/** @type {any} */ (item.record) ?? {});
	const look = $derived(lookOf(item));
	const icon = $derived(LOOKS.find(([l]) => l === look)?.[2] ?? 'artifact');
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const from = $derived(fromWords(record));
	const held = $derived(sparksHolding(world, item.entry).length);
	/** its tags, the auto tags first, flow stages left out */
	const tags = $derived(
		[...(item.tags ?? [])].filter((t) => !t.includes(':')).sort((a, b) => Number(auto(b)) - Number(auto(a)))
	);
	/** whether tag `t` is one avenDB's pages keep. @param {string} t */
	const auto = (t) => t === IN_SPARKS || t === IN_STORIES;

	/** its picture, once read */
	let pic = $state('');
	$effect(() => {
		const file = byId.get(entryOf(record.files?.[0]));
		if (!file) return;
		let gone = false;
		pictureOf(api, file).then((url) => !gone && url && (pic = url));
		return () => {
			gone = true;
		};
	});
</script>

<li class="row" class:picked class:deleted={item.deleted}>
	<a class="open" href="#artifacts/{item.entry}" aria-label="{LOOK_NAME[look]}: {item.title || 'untitled'}">
		<span class="thumb {look}" aria-hidden="true">
			{#if pic}<img src={pic} alt="" />{:else}<Icon name={icon} size={18} />{/if}
		</span>
		<span class="words">
			<b>{item.title || 'Untitled'}</b>
			<small>
				<span class="kind">{LOOK_NAME[look]}</span>
				{#if held}<span class="grows">· on {count(held, 'spark')}</span>{/if}
				{#if from}<span class="about">· {from}</span>{/if}
			</small>
		</span>
		{#if tags.length}
			<span class="tags">{#each tags.slice(0, 3) as t (t)}<span class="chip tag" class:auto={auto(t)}>#{t}</span>{/each}</span>
		{/if}
	</a>
	{#if onpick}
		<label class="pick" title={picked ? 'Picked' : 'Pick it'}>
			<input type="checkbox" checked={picked} onchange={(e) => onpick(e.currentTarget.checked)} aria-label="Pick “{item.title}”" />
			<span class="box" aria-hidden="true">{#if picked}<Icon name="check" size={12} />{/if}</span>
		</label>
	{/if}
</li>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--edge);
	}

	.row:last-child {
		border-bottom: 0;
	}

	.row.deleted {
		opacity: 0.6;
	}

	.open {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		padding: 0.6rem 0.4rem;
		border-radius: 10px;
		color: inherit;
		text-decoration: none;
	}

	.open:hover {
		background: rgb(0 0 0 / 0.04);
	}

	.thumb {
		display: grid;
		flex: none;
		place-items: center;
		overflow: hidden;
		width: 2.6rem;
		height: 2.6rem;
		border-radius: 10px;
		background: #f1ede4;
		color: #8a6a2f;
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.thumb.link {
		background: #e3eaf3;
		color: #2b3f63;
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

	.tags .chip.auto {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.tags {
		display: flex;
		flex: none;
		gap: 0.2rem;
		margin-left: auto;
	}

	.tags .chip {
		background: #e4e9f3;
		color: #2b3f63;
		font-size: 0.7rem;
	}

	.words {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		min-width: 0;
	}

	.words b,
	.words small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.words b {
		font-size: 0.95rem;
		font-weight: 600;
	}

	.words small {
		color: var(--soft);
		font-size: 0.78rem;
	}

	.kind {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.7rem;
	}

	.grows {
		color: var(--accent);
	}

	/* the round box at its end */
	.pick {
		position: relative;
		display: grid;
		flex: none;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		cursor: pointer;
	}

	.pick input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.box {
		display: grid;
		place-items: center;
		width: 1.25rem;
		height: 1.25rem;
		box-sizing: border-box;
		border: 1.5px solid rgb(0 0 0 / 0.25);
		border-radius: 50%;
		background: #fff;
		color: #fff;
	}

	.picked .box {
		border-color: var(--accent);
		background: var(--accent);
	}

	.pick input:focus-visible + .box {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
