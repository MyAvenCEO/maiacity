<!--
	One spark as a row of a list (./Sparks.svelte): a small square of the first picture on its canvas, else a spark's
	icon (a note's, for a note written before sparks); its title, and under it what its canvas holds, its artifacts,
	notes and sparks, and how many stories and sparks grow from it. A tap opens it as a note opens; where the page
	picks sparks, the round box at its end picks it, and where it lists a story's sparks, a button takes it out.
-->
<script>
	import { entryOf } from './artifacts.js';
	import Icon from './Icon.svelte';
	import { grownFrom, isOldNote, pictureOf, pieces } from './sparks.js';
	import { count } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, item: import('./vaults.js').EntryView,
	 *   picked?: boolean, onpick?: (on: boolean) => void, onremove?: () => void, removeLabel?: string }}
	 */
	let { world, api, item, picked = false, onpick, onremove, removeLabel = 'Take it out' } = $props();

	const old = $derived(isOldNote(item));
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const held = $derived(pieces(world, item));
	/** what its canvas holds, in words, else its first words */
	const about = $derived(
		[
			held.artifacts.length ? count(held.artifacts.length, 'artifact') : '',
			held.notes.length ? count(held.notes.length, 'note') : '',
			held.sparks.length ? count(held.sparks.length, 'spark') : ''
		]
			.filter(Boolean)
			.join(' · ') || (item.text ?? '')
	);
	/** where it grows into: the stories that name it among their sparks, and the sparks that hold it */
	const grows = $derived.by(() => {
		const all = grownFrom(world, item.entry);
		const stories = all.filter((e) => e.type === 'story').length;
		const sparks = all.length - stories;
		return [stories ? `in ${count(stories, 'story', 'stories')}` : '', sparks ? `on ${count(sparks, 'spark')}` : '']
			.filter(Boolean)
			.join(' · ');
	});

	/** the first picture on its canvas, once read */
	let pic = $state('');
	$effect(() => {
		const files = held.artifacts.flatMap((a) => /** @type {any} */ (a.record)?.files ?? []);
		const file = files.map((f) => byId.get(entryOf(f))).find(Boolean);
		if (!file) return;
		let gone = false;
		pictureOf(api, file).then((url) => !gone && url && (pic = url));
		return () => {
			gone = true;
		};
	});
</script>

<li class="row" class:picked class:deleted={item.deleted}>
	<a class="open" href="#notes/{item.entry}" aria-label="{old ? 'Note' : 'Spark'}: {item.title || 'untitled'}">
		<span class="thumb" class:old aria-hidden="true">
			{#if pic}<img src={pic} alt="" />{:else}<Icon name={old ? 'note' : 'spark'} size={18} />{/if}
		</span>
		<span class="words">
			<b>{item.title || 'Untitled'}</b>
			<small>
				<span class="kind">{old ? 'Note' : 'Spark'}</span>
				{#if grows}<span class="grows">· {grows}</span>{/if}
				{#if about}<span class="about">· {about}</span>{/if}
			</small>
		</span>
		{#if item.tags?.length}
			<span class="tags">{#each item.tags.filter((t) => !t.includes(':')).slice(0, 3) as t (t)}<span class="chip tag">#{t}</span>{/each}</span>
		{/if}
	</a>
	{#if onremove}
		<button class="pick remove" title={removeLabel} aria-label="{removeLabel}: “{item.title}”" onclick={onremove}
			><Icon name="close" size={14} /></button
		>
	{/if}
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

	.thumb.old {
		background: #e3eaf3;
		color: #2b3f63;
	}

	.tags {
		display: none;
		flex: none;
		gap: 0.2rem;
		margin-left: auto;
	}

	.tags .chip {
		background: #e4e9f3;
		color: #2b3f63;
		font-size: 0.7rem;
	}

	@media (min-width: 761px) {
		.tags {
			display: flex;
		}
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

	.remove {
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--soft);
	}

	.remove:hover {
		background: rgb(0 0 0 / 0.05);
		color: inherit;
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
