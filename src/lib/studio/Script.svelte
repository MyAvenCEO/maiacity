<!--
	The script (Script tab), read-only, set as a screenplay: the timeline itself read as the story's parts (the hook,
	three acts, the cliffhanger), their scenes, each shot as its action and what is said under it — the speaker, on
	camera or V.O., and the line. It is the same clips as the timeline, one truth; an agent writes it through MCP
	(timeline_save: sections, slates, lines, each shot's script), nobody types into it here. A picker at the top opens
	another timeline.
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const PART = /** @type {Record<string, string>} */ ({ hook: 'Hook', act1: 'Act One', act2: 'Act Two', act3: 'Act Three', cliffhanger: 'Cliffhanger' });
	const sections = $derived(s.clips.filter((c) => c.kind === 'section' && c.section !== 'thumbnail').sort((a, b) => a.start - b.start));
	const thumbnail = $derived(s.clips.find((c) => c.kind === 'section' && c.section === 'thumbnail'));
	/** the part of the story a moment is in @param {number} t */
	const partAt = (t) => sections.findLast((c) => t >= c.start - 0.05) ?? null;
	/** the script's pages: each shot with its part, its scene, and whether a new part or scene starts with it */
	const pages = $derived.by(() => {
		/** @type {{ shot: import('./studio.svelte.js').ScriptShot, scene: string, part: import('./studio.svelte.js').Clip | null, newPart: boolean, newScene: boolean }[]} */
		const out = [];
		let lastPart = /** @type {string | null} */ (null), lastScene = '';
		for (const sc of s.script)
			for (const sh of sc.shots) {
				const part = partAt(sh.clip.start);
				out.push({ shot: sh, scene: sc.scene, part, newPart: (part?.id ?? null) !== lastPart, newScene: sc.scene !== lastScene });
				lastPart = part?.id ?? null;
				lastScene = sc.scene;
			}
		return out;
	});
	/** who speaks a voice clip, and whether we see them say it @param {import('./studio.svelte.js').Clip} l */
	function speaker(l) {
		const m = l.hash ? s.byHash.get(l.hash) : undefined;
		const name = String(m?.meta?.speaker ?? 'Samuel').toUpperCase();
		const seen = !!l.hash && s.clips.some((c) => c.track === 'V1' && c.hash === l.hash && l.start < c.start + c.dur && c.start < l.start + l.dur);
		return seen ? name : `${name} (V.O.)`;
	}
	/** what a voice clip says: a line's words, or the recorded voice's captions @param {import('./studio.svelte.js').Clip} l */
	const said = (l) => (l.kind === 'line' ? (l.text ?? '') : s.phrases.filter((p) => p.clip === l.id).map((p) => p.words.map((w) => w.word).join(' ')).join(' '));
	/** @param {string} scene */
	const heading = (scene) => scene.toUpperCase();
</script>

<aside class="script">
	<header>
		<span class="by">Written by the agent through MCP · the timeline switcher is top right</span>
	</header>

	<article class="page">
		<h1>{s.current?.name ?? ''}</h1>
		{#if s.current?.description}<p class="logline">{s.current.description}</p>{/if}
		{#if thumbnail}<p class="thumb">THUMBNAIL — {thumbnail.text || clockText(thumbnail.start)}</p>{/if}

		{#each pages as p (p.shot.clip.id)}
			{#if p.newPart && p.part}
				<h2>{PART[p.part.section ?? ''] ?? p.part.section}</h2>
				{#if p.part.text}<p class="intent">{p.part.text}</p>{/if}
			{/if}
			{#if p.newScene}<h3>{heading(p.scene)}</h3>{/if}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="shot" class:now={s.time >= p.shot.clip.start && s.time < p.shot.clip.start + p.shot.clip.dur} onclick={() => ((s.selected = p.shot.clip.id), s.seek(p.shot.clip.start))}>
				<p class="action">
					<span class="tc">{clockText(p.shot.clip.start)}</span>
					{#if p.shot.clip.script?.size}<b>{p.shot.clip.script.size}.</b>{/if}
					{p.shot.clip.script?.description || s.clipName(p.shot.clip)}
					{#if p.shot.stage === 'text'}<em>(to film)</em>{:else if p.shot.stage === 'storyboard'}<em>(storyboard)</em>{/if}
				</p>
				{#each p.shot.lines as l (l.id)}
					<p class="who">{speaker(l)}</p>
					<p class="line" class:todo={l.kind === 'line'}>{said(l) || '…'}</p>
				{/each}
			</div>
		{:else}
			<p class="empty">No shots yet.</p>
		{/each}
	</article>
</aside>

<style>
	.script {
		grid-area: bin;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
	}

	header {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		padding: 0.6rem 1rem;
		border-bottom: 1px solid var(--edge);
	}

	select {
		max-width: 24rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: var(--raised);
		font: inherit;
		font-size: 0.78rem;
	}

	.by {
		margin-left: auto;
		font-size: 0.68rem;
		color: var(--dim);
	}

	/* a screenplay page: Courier, 12 pt, the classic margins */
	.page {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 1.6rem 2.4rem 3rem;
		background: #0f2136;
		font-family: 'Courier Prime', 'Courier New', Courier, monospace;
		font-size: 0.86rem;
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

	.logline {
		margin: 0 auto 1rem;
		max-width: 34em;
		text-align: center;
		font-style: italic;
		color: var(--ink-soft);
	}

	.thumb {
		margin: 0 0 1.2rem;
		text-align: center;
		color: var(--warn);
	}

	h2 {
		margin: 1.6rem 0 0.2rem;
		font-family: inherit;
		font-size: 0.86rem;
		font-weight: 700;
		text-align: center;
		text-decoration: underline;
		text-transform: uppercase;
	}

	.intent {
		margin: 0 auto 0.6rem;
		max-width: 34em;
		text-align: center;
		font-style: italic;
		color: var(--ink-soft);
	}

	h3 {
		margin: 1rem 0 0.4rem;
		font-family: inherit;
		font-size: 0.86rem;
		font-weight: 700;
	}

	.shot {
		margin: 0 -0.6rem;
		padding: 0.1rem 0.6rem 0.3rem;
		border-left: 2px solid transparent;
		cursor: pointer;
	}

	.shot.now {
		border-left-color: var(--accent);
		background: var(--warn-bg);
	}

	.action {
		margin: 0.4rem 0;
	}

	.tc {
		margin-right: 0.6rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.action em {
		color: var(--warn);
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
		color: var(--warn);
	}

	.empty {
		color: var(--dim);
	}
</style>
