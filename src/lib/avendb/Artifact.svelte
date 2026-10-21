<!--
	One artifact on a page of its own (`#artifacts/` and its entry, ./artifacts.js), the whole screen, in the layout
	every avenDB view has (./Frame.svelte, bare: its head is its own): one source fact, standing on its own, to read. In
	the middle its title, its picture (a YouTube video's opens the video), our own words about it, the Library files it
	shows, a video's chapters and its transcript, each row from a second; on the right (narrower, sliding in from the
	round button at the bottom right), what it is, its link, the site it is on, whose it is where it isn't ours, when it
	was made, its language and length, who added it, its tags (the auto tags `sparks` and `stories` among them), and the
	sparks whose canvas holds it and the stories they grow into, with a new spark to put it on. It has nothing to pick
	from, so no left side. Nothing here is a field to type into: avens write artifacts (avendb_add_artifact), and the
	Mac fetches a YouTube video's words (./youtube.js). Each change it can make is one op on its main line, for the
	acting vault, as the device allows it (`may`).
-->
<script>
	import { untrack } from 'svelte';
	import {
		clock,
		entryOf,
		IN_SPARKS,
		IN_STORIES,
		LOOK_NAME,
		LOOKS,
		lookOf,
		sparksHolding,
		youtubeId,
		youtubePicture
	} from './artifacts.js';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { linkHref } from '$lib/markdown/index.js';
	import { allowed, creatable, DELETED, may } from './ops.js';
	import { addingSpark, grownFrom, itemsFor, pictureOf, SPARK, sparkRecord } from './sparks.js';
	import { authorsLine, count, signerName } from './vaults.js';
	import { filling, took, wordsOf, wordsRule, wordsTasks } from './youtube.js';
	import { nudge } from '$lib/studio/jobs/mac.js';
	import { lacking } from '$lib/studio/jobs/schemas.js';
	import { asking, retrying, TRIES } from '$lib/studio/jobs/tasks.js';

	/**
	 * @type {{ world: import('./vaults.js').WorldView, actor: string, api: any, busy: boolean, entry: string }}
	 */
	let { world, actor, api, busy, entry } = $props();

	const byId = $derived(new Map(world.entries.map((e) => [e.entry, e])));
	const item = $derived(byId.get(entry));
	const record = $derived(/** @type {any} */ (item?.record) ?? {});
	const look = $derived(lookOf(item));
	const files = $derived(/** @type {any[]} */ (record.files ?? []));
	const by = $derived(/** @type {{ name?: string, url?: string, platform?: string }} */ (record.by ?? {}));
	const holding = $derived(sparksHolding(world, entry));
	const stories = $derived([
		...new Map(holding.flatMap((s) => grownFrom(world, s.entry).filter((g) => g.type === 'story')).map((g) => [g.entry, g])).values()
	]);
	const tags = $derived((item?.tags ?? []).filter((t) => !t.includes(':')));
	/** whether tag `t` is one avenDB's pages keep. @param {string} t */
	const auto = (t) => t === IN_SPARKS || t === IN_STORIES;
	/** whether its words carry times: a transcript's do, a text copied in as paragraphs doesn't */
	const timed = $derived((record.transcript ?? []).some((/** @type {any} */ r) => r.t > 0));
	const yt = $derived(youtubeId(record.url ?? ''));

	/** whether the acting vault's ops let it change the artifact, as the device says */
	let changes = $state(false);
	let askedSpark = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		void world;
		if (!item) return;
		let gone = false;
		const probe = { op: 'set', entry, path: ['title'], value: item.title ?? '', as: actor };
		may(api, actor, [probe]).then(([a]) => !gone && (changes = allowed(a)));
		creatable(api, actor, item.vault, SPARK).then((t) => !gone && (askedSpark = t));
		return () => {
			gone = true;
		};
	});
	const edits = $derived(changes && !busy);

	/** Runs change `op` on it as `what`. @param {string} what @param {object} op */
	const change = (what, op) => api.run(what, { ...op, entry, as: actor });

	/** the pictures of its files, by entry, once read */
	let pics = $state(/** @type {Record<string, string>} */ ({}));
	$effect(() => {
		let gone = false;
		for (const l of files) {
			const id = entryOf(l);
			const file = byId.get(id);
			if (!file || pics[id]) continue;
			pictureOf(api, file).then((u) => !gone && u && (pics = { ...pics, [id]: u }));
		}
		return () => {
			gone = true;
		};
	});
	const cover = $derived(files.map((l) => pics[entryOf(l)]).find(Boolean) ?? youtubePicture(item?.record));

	/** A new spark that holds it on its canvas, opened at once. */
	async function spark() {
		if (!item || askedSpark === null) return;
		const title = item.title || 'A new spark';
		const items = itemsFor([], [{ vault: item.vault, entry, what: 'artifact' }]);
		const made = await api.run(`Making “${title}”`, { ...addingSpark(item.vault, sparkRecord(title, '', items), askedSpark), as: actor });
		if (made) location.hash = `notes/${made.entry}`;
	}

	/** Deletes it, or with `back`, brings it back: a tag in its record, so every edit stays. @param {boolean} back */
	const remove = (back) =>
		change(back ? 'Bringing it back' : 'Deleting it', { op: back ? 'remove' : 'insert', path: ['tags'], value: DELETED });

	// its words from YouTube (./youtube.js): the studio's `youtube` rule, done on the Mac, its newest task at this link,
	// and a done task's value, which the page copies into what is empty here once (./Shell.svelte)
	const rule = $derived(item && look === 'youtube' && yt ? wordsRule(world, item.vault) : null);
	const job = $derived(item && look === 'youtube' ? wordsTasks(world, item)[0] : undefined);
	let got = $state(/** @type {any} */ (null));
	$effect(() => {
		const t = job;
		if (t?.status !== 'done') return void (got = null);
		let gone = false;
		wordsOf(t, untrack(() => world), api).then((v) => !gone && (got = v));
		return () => {
			gone = true;
		};
	});
	const left = $derived(job ? TRIES - job.attempts : 0);

	/** Asks the Mac for its words: the jobs' schemas into its vault where it lacks them, then the task. */
	async function fetchWords() {
		if (!item || !rule) return;
		for (const op of lacking(world, item.vault, actor)) if (!(await api.run('Adding the studio’s job schemas', op))) return;
		const op = asking(rule, item, world, actor, actor, Math.floor(Date.now() / 1000));
		if (op && (await api.run('Asking the Mac for its words', op))) nudge();
	}
	/** Asks again for words three tries didn't fetch. */
	const again = async () => job && (await api.run('Asking the Mac again for its words', retrying(job, actor))) && nudge();
	/** Takes YouTube's words in again, into what is empty now. */
	const takeAgain = () => item && got && api.run('Taking YouTube’s words', { op: 'batch', as: actor, ops: filling(item, got) });
</script>

<!-- on the right, the one place for what it is: where it is from, whose, who added it, its tags and its sparks -->
{#snippet about()}
	{#if item}
		<div class="details">
			<h3>Details</h3>
			<dl>
				<dt>What it is</dt>
				<dd class="what"><Icon name={LOOKS.find(([l]) => l === look)?.[2] ?? 'artifact'} size={14} /> {LOOK_NAME[look]}</dd>
				{#if record.url}
					<dt>Link</dt>
					<dd><a href={linkHref(record.url)} target="_blank" rel="noopener noreferrer">{record.url}</a></dd>
				{/if}
				{#if record.site}
					<dt>Site</dt>
					<dd>{record.site}</dd>
				{/if}
				{#if by.name || by.platform || by.url}
					<dt>Whose it is</dt>
					<dd>
						{#if by.url}<a href={linkHref(by.url)} target="_blank" rel="noopener noreferrer">{by.name || by.url}</a>{:else}{by.name ?? ''}{/if}{by.platform
							? `${by.name || by.url ? ' · ' : ''}${by.platform}`
							: ''}
					</dd>
				{/if}
				{#if record.taken}
					<dt>Made or published</dt>
					<dd>{record.taken}</dd>
				{/if}
				{#if record.language}
					<dt>Language</dt>
					<dd>{record.language}</dd>
				{/if}
				{#if record.duration}
					<dt>Length</dt>
					<dd>{clock(record.duration)}</dd>
				{/if}
				<dt>Added by</dt>
				<dd>{authorsLine(world, item.authors, signerName(world, item.by))}</dd>
				<dt>Tags</dt>
				<dd>
					{#if tags.length}
						<span class="tags"
							>{#each tags as t (t)}<span
									class="chip tag"
									class:auto={auto(t)}
									title={auto(t) ? 'Kept by the page, from the sparks and stories that hold it' : undefined}>#{t}</span
								>{/each}</span
						>
					{:else}
						<span class="soft">None yet. It is tagged #{IN_SPARKS} once a spark holds it, #{IN_STORIES} once a story grows from it.</span>
					{/if}
				</dd>
				<dt>On sparks</dt>
				<dd>
					{#if holding.length}
						<span class="tags">
							{#each holding as s (s.entry)}<a class="chip" href="#notes/{s.entry}"><Icon name="spark" size={12} /> {s.title || 'Untitled'}</a>{/each}
							{#each stories as s (s.entry)}<a class="chip" href="#stories/{s.entry}"><Icon name="story" size={12} /> {s.title || 'A story'}</a>{/each}
						</span>
					{:else}
						<span class="soft">No spark holds it yet.</span>
					{/if}
				</dd>
			</dl>
			<div class="acts">
				{#if askedSpark !== null}
					<button class="btn" disabled={busy} onclick={spark}><Icon name="spark" size={14} /> Put it on a new spark</button>
				{/if}
				{#if edits && !item.deleted}
					<button class="btn quiet danger" onclick={() => remove(false)}><Icon name="trash" size={14} /> Delete it</button>
				{/if}
			</div>
		</div>
	{/if}
{/snippet}

<Frame bare aside={item ? about : undefined} asideLabel="About {item?.title || 'it'}" asideIcon="info">
	<div class="page">
		<a class="back" href="#artifacts"><Icon name="back" size={14} /> Artifacts</a>
		{#if !item}
			<p class="soft">This browser holds no such artifact, or can’t open it.</p>
		{:else}
			<header>
				<h1>{item.title || 'Untitled'}</h1>
				<p class="soft">
					{LOOK_NAME[look]}{by.name ? ` · ${by.name}` : ''}{record.duration ? ` · ${clock(record.duration)}` : ''}
				</p>
			</header>

			{#if item.deleted}
				<p class="banner">
					This artifact is deleted: Artifacts lists it under Deleted, and every edit of it stays.
					{#if edits}<button class="btn" onclick={() => remove(true)}>Bring it back</button>{/if}
				</p>
			{/if}

			{#if cover}
				{#if record.url && (look === 'youtube' || look === 'link')}
					<a class="cover" href={linkHref(record.url)} target="_blank" rel="noopener noreferrer" title="Open {record.site ?? 'the link'}">
						<img src={cover} alt={item.title ?? ''} />
						{#if look === 'youtube'}<span class="play" aria-hidden="true"><Icon name="play" size={26} /></span>{/if}
					</a>
				{:else}
					<span class="cover"><img src={cover} alt={item.title ?? ''} /></span>
				{/if}
			{/if}

			{#if record.note?.trim()}
				<section class="part">
					<h4>Our words about it</h4>
					<p class="note">{record.note}</p>
				</section>
			{/if}

			{#if files.length > 1 || (files.length && !pics[entryOf(files[0])])}
				<section class="part">
					<h4>Library files <small class="soft">{files.length}</small></h4>
					<div class="files">
						{#each files as l (entryOf(l))}
							{@const id = entryOf(l)}
							{@const file = byId.get(id)}
							<span class="file">
								{#if pics[id]}<img src={pics[id]} alt="" />{:else}<span class="blank"><Icon name="file" size={20} /></span>{/if}
								<small>{file?.title ?? 'A file this browser doesn’t hold'}</small>
							</span>
						{/each}
					</div>
				</section>
			{/if}

			{#if record.chapters?.length}
				<section class="part">
					<h4>Chapters <small class="soft">{record.chapters.length}</small></h4>
					<ol class="times">
						{#each record.chapters as c (c.id)}
							<li><span class="t">{clock(c.t)}</span><span>{c.title}</span></li>
						{/each}
					</ol>
				</section>
			{/if}

			{#if record.transcript?.length || look === 'youtube' || look === 'video'}
				<section class="part">
					<h4>
						{look === 'link' || look === 'image' ? 'Its words' : 'Transcript'}
						<small class="soft">{record.transcript?.length ? count(record.transcript.length, timed ? 'line' : 'paragraph') : ''}</small>
					</h4>
					{#if record.transcript?.length}
						<ol class="times transcript" class:untimed={!timed}>
							{#each record.transcript as r (r.id)}
								<li>{#if timed}<span class="t">{clock(r.t)}</span>{/if}<span>{r.text}</span></li>
							{/each}
						</ol>
					{:else if look === 'youtube' && yt}
						<div class="fetch">
							{#if job?.status === 'queued'}
								<p class="soft">Waiting for the Mac app to fetch its words from YouTube.</p>
							{:else if job?.status === 'claimed'}
								<p class="soft">The Mac app is fetching its words from YouTube…</p>
							{:else if job?.status === 'failed'}
								<p class="soft">
									Fetching its words failed: {job.error || 'no reason given'}. The Mac app tries again, {count(left, 'more time')}.
								</p>
							{:else if job?.status === 'held'}
								<p class="soft">Fetching its words failed {TRIES} times: {job.error || 'no reason given'}.</p>
								{#if edits}<button class="btn" onclick={again}>Try again</button>{/if}
							{:else if job?.status === 'done' && got?.transcript?.length && !took(item, job)}
								<p class="soft">YouTube’s words are here; they go in as soon as the acting vault may write them.</p>
							{:else if job?.status === 'done' && got?.transcript?.length}
								<p class="soft">Its words were taken out. YouTube’s are kept with the fetch.</p>
								{#if edits}<button class="btn" onclick={takeAgain}>Take YouTube’s words again</button>{/if}
							{:else if job?.status === 'done' && got?.needs_speech}
								<p class="soft">YouTube has no captions for it. Its words come once the Mac app hears it.</p>
							{:else if job?.status === 'done'}
								<p class="soft">YouTube gave no words for it.</p>
							{:else if rule && edits}
								<button class="btn" disabled={busy} onclick={fetchWords}><Icon name="download" size={14} /> Fetch its words from YouTube</button>
								<small class="soft">The Mac app fetches its title, channel, chapters and captions, and fills in what is empty here.</small>
							{:else}
								<p class="soft">No words yet. The Mac app fetches YouTube’s own.</p>
							{/if}
						</div>
					{:else}
						<p class="soft">No transcript yet.</p>
					{/if}
				</section>
			{/if}
		{/if}
	</div>
</Frame>

<style>
	/* the artifact in the middle, as it reads */
	.page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-width: 46rem;
		margin: 0 auto;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--soft);
		font-size: 0.85rem;
		text-decoration: none;
	}

	header h1 {
		margin: 0;
		font-family: var(--font-body);
		font-size: 1.45rem;
		font-weight: 700;
		letter-spacing: 0;
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	header p {
		margin: 0.25rem 0 0;
	}

	.cover {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: 14px;
		background: #f1ede4;
	}

	.cover img {
		display: block;
		width: 100%;
		max-height: 26rem;
		object-fit: contain;
	}

	.play {
		position: absolute;
		top: 50%;
		left: 50%;
		display: grid;
		place-items: center;
		width: 3.6rem;
		height: 3.6rem;
		border-radius: 50%;
		background: rgb(20 24 22 / 0.72);
		color: #fff;
		transform: translate(-50%, -50%);
	}

	.cover:hover .play {
		background: #c4302b;
	}

	.banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin: 0;
		padding: 0.6rem 0.8rem;
		border-radius: 10px;
		background: #fbeee6;
		font-size: 0.85rem;
	}

	.part {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	h4 {
		margin: 0.3rem 0 0;
		font-size: 0.9rem;
	}

	h4 small {
		font-weight: 400;
	}

	.note {
		font-size: 0.95rem;
		line-height: 1.55;
		white-space: pre-wrap;
	}

	.files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.file {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		width: 7rem;
		font-size: 0.72rem;
	}

	.file img,
	.blank {
		display: grid;
		place-items: center;
		width: 7rem;
		height: 5rem;
		border-radius: 10px;
		object-fit: cover;
		background: #f1ede4;
		color: #8a6a2f;
	}

	.file small {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.times {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.88rem;
	}

	.times li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}

	.times .t {
		flex: none;
		width: 3.4rem;
		color: var(--soft);
		font-variant-numeric: tabular-nums;
	}

	.transcript {
		line-height: 1.45;
	}

	.transcript.untimed {
		gap: 0.6rem;
	}

	.fetch {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
	}

	.fetch .btn,
	.acts .btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	/* its details, on the right: what it is, where from, whose, and where it is used */
	.details {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		font-size: 0.84rem;
	}

	.details h3 {
		margin: 0;
		font-size: 0.98rem;
		line-height: 2rem;
	}

	.details dl {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.15rem;
		margin: 0;
	}

	.details dt {
		margin-top: 0.5rem;
		color: var(--soft);
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.details dd {
		margin: 0;
		line-height: 1.45;
		overflow-wrap: anywhere;
	}

	.details a {
		color: var(--accent);
	}

	.what {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.details .tags .chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		max-width: 100%;
		color: inherit;
		text-decoration: none;
		white-space: normal;
	}

	.chip.tag {
		background: #e4e9f3;
		color: #2b3f63;
	}

	.chip.tag.auto {
		background: #d6e8e4;
		color: #1f4f47;
	}

	.acts {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.4rem;
		padding-top: 0.4rem;
	}

	.danger {
		color: #a33a2a;
	}

	p {
		margin: 0;
		font-size: 0.85rem;
	}
</style>
