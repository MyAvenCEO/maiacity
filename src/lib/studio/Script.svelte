<!--
	The script (Script tab), set as a screenplay: the timeline itself read as the story's parts (the hook, three acts,
	the cliffhanger), their scenes, each shot as its action and what is said under it — the speaker, on camera or V.O.,
	and the line. It is the same clips as the timeline, one truth; an agent writes it through MCP (timeline_save:
	sections, slates, lines, each shot's script). What a recording says is its transcript's words, and a word heard
	wrong is put right here: click it, type, Enter (Tab: on to the next word, Esc: leave it); Backspace at a word's
	start joins it to the word before, Delete at its end to the word after ("To morrow" → "Tomorrow"). The transcript itself
	changes — the captions read it, in the preview and the render alike. Words the model was unsure of are marked.
-->
<script>
	import { clockText } from './studio.svelte.js';
	import { transcriptOf } from './transcript.js';
	import { PART, feelingsOf, pagesOf, sectionsOf, speakerOf } from './screenplay.js';
	import { listContent } from '$lib/auth/client';
	import { storyHref } from '$lib/stories/stories.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const sections = $derived(sectionsOf(s.clips));
	const thumbnail = $derived(s.clips.find((c) => c.kind === 'section' && c.section === 'thumbnail'));
	const pages = $derived(pagesOf(s.script, sections));
	/** @param {import('./studio.svelte.js').Clip} l */
	const speaker = (l) => speakerOf(l, s.clips, s.byHash);
	/** what a voice clip says: a line's words, or the recorded voice's captions @param {import('./studio.svelte.js').Clip} l */
	const said = (l) => (l.kind === 'line' ? (l.text ?? '') : s.phrases.filter((p) => p.clip === l.id).map((p) => p.words.map((w) => w.word).join(' ')).join(' '));
	// the story on the Stories board this script is the film of (made from it, or filed under its project): the same
	// script is read there, in its Writing step
	let items = $state(/** @type {import('$lib/auth/client').ContentItem[]} */ ([]));
	$effect(() => {
		listContent()
			.then((r) => (items = r.items))
			.catch(() => {});
	});
	const story = $derived.by(() => {
		const t = s.current;
		if (!t) return null;
		return items.find((i) => i.timeline_id === t.id) ?? (t.project ? items.find((i) => i.project?.toLowerCase() === t.project?.toLowerCase()) : undefined) ?? null;
	});
	/** @param {string} scene */
	const heading = (scene) => scene.toUpperCase();

	// ── a word put right ──
	/** @typedef {import('./studio.svelte.js').CaptionWord} CaptionWord */
	/** a recording's words where its clip plays them @param {import('./studio.svelte.js').Clip} l */
	const wordsIn = (l) => s.captionWords.filter((w) => w.clip === l.id);
	/** how sure the model was of a word (1 for words a person or a voice take gave) @param {CaptionWord} w */
	const sure = (w) => transcriptOf(s.byHash.get(w.hash))?.words[w.i]?.c ?? 1;
	/** @type {{ clip: string, hash: string, i: number } | null} */
	let editing = $state(null);
	let draft = $state('');
	let saving = $state(false);
	/** @param {CaptionWord} w */
	function edit(w) {
		editing = { clip: w.clip, hash: w.hash, i: w.i };
		draft = w.word;
	}
	/** keep the word as typed; `next`: then the word after it @param {CaptionWord} w @param {boolean} next */
	async function keep(w, next) {
		const text = draft.trim(), at = editing;
		editing = null;
		if (!at) return;
		const typed = text.split(/\s+/).filter(Boolean).length;
		if (text !== w.word) {
			saving = true;
			await s.fixWord(w.hash, w.i, text);
			saving = false;
		}
		if (!next) return;
		const after = s.captionWords.find((x) => x.clip === w.clip && x.hash === w.hash && x.i === w.i + Math.max(typed, text === w.word ? 1 : typed));
		if (after) edit(after);
	}
	/**
	 * Two words made one: Backspace at the start of a word joins it to the word before, Delete at its end to the word
	 * after — and the joined word stays open to type.
	 * @param {CaptionWord} w @param {-1 | 1} side
	 */
	async function join(w, side) {
		const prev = side < 0 ? s.captionWords.find((x) => x.clip === w.clip && x.hash === w.hash && x.i === w.i - 1) : w;
		const next = side < 0 ? w : s.captionWords.find((x) => x.clip === w.clip && x.hash === w.hash && x.i === w.i + 1);
		if (!prev || !next) return;
		const typed = draft.trim();
		const text = side < 0 ? prev.word + typed : typed + next.word;
		editing = null;
		saving = true;
		await s.joinWords(w.hash, prev.i, text);
		saving = false;
		const joined = s.captionWords.find((x) => x.clip === w.clip && x.hash === w.hash && x.i === prev.i);
		if (joined) {
			edit(joined);
			// the cursor where the two met
			const at = side < 0 ? prev.word.length : typed.length;
			setTimeout(() => {
				const el = /** @type {HTMLInputElement | null} */ (document.querySelector('.words .fix'));
				el?.setSelectionRange(at, at);
			}, 0);
		}
	}
	/** @param {KeyboardEvent} e @param {CaptionWord} w */
	function key(e, w) {
		const el = /** @type {HTMLInputElement} */ (e.currentTarget);
		if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0) {
			e.preventDefault();
			void join(w, -1);
		} else if (e.key === 'Delete' && el.selectionStart === el.value.length && el.selectionEnd === el.value.length) {
			e.preventDefault();
			void join(w, 1);
		} else if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			void keep(w, e.key === 'Tab');
		} else if (e.key === 'Escape') editing = null;
	}
</script>

<aside class="script">
	<header>
		{#if story}<a class="story" href={storyHref(story.id, 'writing')} title="The same script, in the story's Writing step">{story.title} · Writing ›</a>{/if}
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
				{@const feels = feelingsOf(p.part)}
				{#if feels.length}<p class="journey">The viewer: {#each feels as f, i (i)}{i ? ' · ' : ''}<span>{f.feel} {f.up ? '↑' : '↓'}</span>{/each}</p>{/if}
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
					{#if l.kind === 'line' || !l.hash}
						<p class="line" class:todo={l.kind === 'line'}>{said(l) || '…'}</p>
					{:else}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<p class="line words" class:saving onclick={(e) => e.stopPropagation()}>
							{#each wordsIn(l) as w (w.i)}
								{#if editing?.clip === l.id && editing.i === w.i}
									<input class="fix" bind:value={draft} size={Math.max(3, draft.length + 1)} {@attach (el) => el.select()} onkeydown={(e) => key(e, w)} onblur={() => void keep(w, false)} aria-label="Put the word right" />
								{:else}
									<button class="w" class:unsure={sure(w) < 0.6} title="{clockText(w.t)} · {Math.round(sure(w) * 100)} % sure — click to put it right" onclick={() => edit(w)}>{w.word}</button>
								{/if}{' '}
							{:else}…{/each}
						</p>
					{/if}
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

	.story {
		font-size: 0.74rem;
		font-weight: 600;
		color: var(--accent);
		text-decoration: none;
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

	/* the emotional journey of a part: the feelings the viewer goes through, the tension rising (↑) or released (↓) */
	.journey {
		margin: -0.3rem auto 0.8rem;
		max-width: 34em;
		text-align: center;
		font-size: 0.78em;
		letter-spacing: 0.02em;
		color: var(--ink-soft);
	}

	.journey span {
		font-weight: 600;
		color: var(--terracotta, #b86a43);
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

	.words .w {
		padding: 0;
		border: 0;
		border-radius: 3px;
		background: none;
		font: inherit;
		color: inherit;
		cursor: text;
	}

	.words .w:hover {
		background: var(--raised);
	}

	/* a word the model was unsure of: the one to check */
	.words .w.unsure {
		text-decoration: underline dotted var(--warn);
		text-underline-offset: 3px;
	}

	.words .fix {
		padding: 0 0.15rem;
		border: 1px solid var(--accent);
		border-radius: 3px;
		background: var(--raised);
		font: inherit;
		color: var(--ink);
	}

	.words.saving {
		opacity: 0.7;
	}

	.line.todo {
		font-style: italic;
		color: var(--warn);
	}

	.empty {
		color: var(--dim);
	}
</style>
