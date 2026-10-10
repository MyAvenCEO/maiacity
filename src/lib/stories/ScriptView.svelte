<!--
	A story's film script, as the studio's Script tab sets it: the story's timeline read as a screenplay — its parts,
	scenes, each shot as its action and what is said under it (the speaker, on camera or V.O., the line). The same
	reading of the same clips (screenplay.js), so the two never disagree; it is written in the studio (or by the agent
	through MCP) and read here. Its timeline: the one the story was made from, else the newest filed under its project.
-->
<script>
	import { base } from '$app/paths';
	import { listMedia, listTimelines } from '$lib/auth/client';
	import { asStudio } from '$lib/studio/color.js';
	import { PART, feelingsOf, pagesOf, saidBy, scriptOf, sectionsOf, speakerOf } from '$lib/studio/screenplay.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').Timeline} Timeline */
	/** @typedef {import('$lib/auth/client').MediaItem} MediaItem */

	/** @type {{ item: ContentItem }} */
	let { item } = $props();

	let timelines = $state(/** @type {Timeline[] | null} */ (null));
	let media = $state(/** @type {MediaItem[]} */ ([]));
	let error = $state('');
	let picked = $state('');

	$effect(() => {
		listTimelines()
			.then((t) => (timelines = t))
			.catch((e) => ((error = e.message), (timelines = [])));
		listMedia()
			.then((m) => (media = asStudio(m)))
			.catch(() => {});
	});

	// the story's cuts: the one it was made from first, then the rest of its project's, newest first
	const mine = $derived(
		(timelines ?? [])
			.filter((t) => t.id === item.timeline_id || (item.project && t.project?.toLowerCase() === item.project.toLowerCase()))
			.sort((a, b) => Number(b.id === item.timeline_id) - Number(a.id === item.timeline_id) || Date.parse(b.updated) - Date.parse(a.updated))
	);
	const timeline = $derived(mine.find((t) => t.id === picked) ?? mine[0] ?? null);
	const byHash = $derived(new Map(media.map((m) => [m.hash, m])));
	const clips = $derived(timeline?.clips ?? []);
	const pages = $derived(pagesOf(scriptOf(clips, byHash), sectionsOf(clips)));
	const thumbnail = $derived(clips.find((c) => c.kind === 'section' && c.section === 'thumbnail'));
	/** @param {number} t */
	const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
	const studio = $derived(timeline ? `${base}/app/studio/?timeline=${encodeURIComponent(timeline.id)}&tab=script` : '');
</script>

<div class="script-view">
	{#if timelines === null}
		<p class="empty">Reading the studio's timelines…</p>
	{:else if !timeline}
		<p class="empty">No timeline yet. The script is the film's timeline read as a screenplay: start the film in the Movie step, or lay it out in the studio.{#if error} ({error}){/if}</p>
	{:else}
		<div class="bar">
			{#if mine.length > 1}
				<select aria-label="Which cut" value={timeline.id} onchange={(e) => (picked = e.currentTarget.value)}>
					{#each mine as t (t.id)}<option value={t.id}>{t.name}{t.variant ? ` · ${t.variant}` : ''}</option>{/each}
				</select>
			{:else}
				<span class="name">{timeline.name}</span>
			{/if}
			<a class="open" href={studio}>Write it in the studio ›</a>
		</div>

		<article class="page">
			<h1>{timeline.name}</h1>
			{#if timeline.description}<p class="logline">{timeline.description}</p>{/if}
			{#if thumbnail}<p class="thumb">THUMBNAIL — {thumbnail.text || clock(thumbnail.start)}</p>{/if}

			{#each pages as p (p.shot.clip.id)}
				{#if p.newPart && p.part}
					<h2>{PART[p.part.section ?? ''] ?? p.part.section}</h2>
					{#if p.part.text}<p class="intent">{p.part.text}</p>{/if}
					{@const feels = feelingsOf(p.part)}
					{#if feels.length}<p class="journey">The viewer: {#each feels as f, i (i)}{#if i} · {/if}<span>{f.feel} {f.up ? '↑' : '↓'}</span>{/each}</p>{/if}
				{/if}
				{#if p.newScene}<h3>{p.scene.toUpperCase()}</h3>{/if}
				<div class="shot">
					<p class="action">
						<span class="tc">{clock(p.shot.clip.start)}</span>
						{#if p.shot.clip.script?.size}<b>{p.shot.clip.script.size}.</b>{/if}
						{p.shot.clip.script?.description || p.shot.clip.script?.label || byHash.get(p.shot.clip.hash ?? '')?.title || 'A shot'}
						{#if p.shot.stage === 'text'}<em>(to film)</em>{:else if p.shot.stage === 'storyboard'}<em>(storyboard)</em>{/if}
					</p>
					{#each p.shot.lines as l (l.id)}
						<p class="who">{speakerOf(l, clips, byHash)}</p>
						<p class="line" class:todo={l.kind === 'line'}>{saidBy(l, byHash) || l.text || '…'}</p>
					{/each}
				</div>
			{:else}
				<p class="empty">No shots yet.</p>
			{/each}
		</article>
	{/if}
</div>

<style>
	.script-view {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		max-width: 46rem;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		font-size: 0.84rem;
	}

	.name {
		font-weight: 600;
	}

	select {
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		font: inherit;
	}

	.open {
		margin-left: auto;
		font-weight: 600;
		color: var(--ink);
	}

	/* a screenplay page, as the studio sets it: Courier, the classic margins */
	.page {
		max-width: 46rem;
		padding: 2rem 2.6rem 3rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		font-family: 'Courier Prime', 'Courier New', Courier, monospace;
		font-size: 0.9rem;
		line-height: 1.45;
		color: var(--ink);
	}

	h1 {
		margin: 0 0 0.3rem;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 700;
		text-align: center;
		text-transform: uppercase;
	}

	.logline,
	.intent {
		margin: 0 auto 1rem;
		max-width: 34em;
		text-align: center;
		font-style: italic;
		color: var(--ink-soft);
	}

	.thumb {
		margin: 0 0 1.2rem;
		text-align: center;
		color: #b86a43;
	}

	h2 {
		margin: 1.6rem 0 0.2rem;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		text-align: center;
		text-decoration: underline;
		text-transform: uppercase;
	}

	.journey {
		margin: -0.3rem auto 0.8rem;
		max-width: 34em;
		text-align: center;
		font-size: 0.78em;
		color: var(--ink-soft);
	}

	.journey span {
		font-weight: 600;
		color: #b86a43;
	}

	h3 {
		margin: 1rem 0 0.4rem;
		font-family: inherit;
		font-size: 0.9rem;
		font-weight: 700;
	}

	.action {
		margin: 0.4rem 0;
	}

	.tc {
		margin-right: 0.6rem;
		font-size: 0.7rem;
		color: var(--muted);
	}

	.action em {
		color: #b86a43;
	}

	.who {
		margin: 0.5rem 0 0;
		padding-left: 37%;
		text-transform: uppercase;
	}

	.line {
		margin: 0 16% 0.4rem 22%;
	}

	.line.todo {
		font-style: italic;
		color: #b86a43;
	}

	.empty {
		color: var(--muted);
	}

	@media (max-width: 640px) {
		.page {
			padding: 1.2rem 1rem 2rem;
		}

		.who {
			padding-left: 20%;
		}

		.line {
			margin: 0 4% 0.4rem 10%;
		}
	}
</style>
