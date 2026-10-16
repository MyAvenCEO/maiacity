<!--
	One spark as a row of a list (./Sparks.svelte): a small square of what it shows by its look (./sparks.js), its
	picture, else its look's icon on its look's colour; its title, and under it what it is, its link's host or whose it
	is, and how many stories and mood boards grow from it. A tap opens it as a note opens; where the page picks sparks,
	the round box at its end picks it.
-->
<script>
	import Icon from './Icon.svelte';
	import { byWords, grownFrom, hostOf, LOOK_NAME, LOOKS, lookOf, pictureOf } from './sparks.js';
	import { count } from './vaults.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, api: any, item: import('./vaults.js').EntryView,
	 *   picked?: boolean, onpick?: (on: boolean) => void }}
	 */
	let { world, api, item, picked = false, onpick } = $props();

	const record = $derived(/** @type {any} */ (item.record) ?? {});
	const look = $derived(lookOf(item));
	const icon = $derived(LOOKS.find(([l]) => l === look)?.[2] ?? 'spark');
	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	/** what it is besides its look: its link's host, whose it is, else its first words */
	const about = $derived(
		hostOf(record.url ?? '') || byWords(record.by) || (look === 'thought' || look === 'note' ? (item.text ?? '') : '')
	);
	/** where it grows into: the stories and the mood boards that name it among their sparks */
	const grows = $derived.by(() => {
		const all = grownFrom(world, item.entry);
		const stories = all.filter((e) => e.type === 'story').length;
		const boards = all.length - stories;
		return [stories ? `in ${count(stories, 'story', 'stories')}` : '', boards ? `on ${count(boards, 'board')}` : '']
			.filter(Boolean)
			.join(' · ');
	});

	/** its own picture, or a mood board's first, once read */
	let pic = $state('');
	$effect(() => {
		const first = look === 'moodboard' ? byId.get(record.sparks?.[0] ?? '') : item;
		const file = byId.get(/** @type {any} */ (first?.record)?.files?.[0] ?? '');
		if (!file) return;
		let gone = false;
		pictureOf(api, file).then((url) => !gone && url && (pic = url));
		return () => {
			gone = true;
		};
	});
</script>

<li class="row" class:picked class:deleted={item.deleted}>
	<a class="open" href="#notes/{item.entry}" aria-label="{LOOK_NAME[look]}: {item.title || 'untitled'}">
		<span class="thumb {look}" aria-hidden="true">
			{#if pic}<img src={pic} alt="" />{:else}<Icon name={icon} size={18} />{/if}
		</span>
		<span class="words">
			<b>{item.title || 'Untitled'}</b>
			<small>
				<span class="kind">{LOOK_NAME[look]}</span>
				{#if grows}<span class="grows">· {grows}</span>{/if}
				{#if about}<span class="about">· {about}</span>{/if}
			</small>
		</span>
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

	.thumb.link,
	.thumb.post {
		background: #e3eaf3;
		color: #2b3f63;
	}

	.thumb.video {
		background: #2a2f2c;
		color: #fff;
	}

	.thumb.quote {
		background: #efe6f3;
		color: #5e3d75;
	}

	.thumb.moodboard {
		background: #e2ece7;
		color: var(--accent);
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
