<!--
	A story's hook step: three texts, each its own job (the hook-writer skill). The hook grabs attention and is the
	title everywhere (the card, the article, the header, YouTube); the intro, the trailer, is the first 3–30 s of the
	film: why to care, and the viewer's transformation; the description is the overview and the detail. The hooks
	tried are listed on the left (each with its parts named), the one on the card among them — click a variant and it
	goes on the card, and the YouTube preview on the right shows it: the 16:9 card as rendered, else as designed in
	layers on the Thumbnail step, else a stand-in with the hook and the day's badge on it.
-->
<script>
	import { HOOK_PARTS, fileUrl } from '$lib/auth/client';
	import Card from './Card.svelte';
	import { cardWords } from './stories.js';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').HookVariant} HookVariant */
	/** @typedef {import('$lib/auth/client').HookPart} HookPart */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	// YouTube's limits (the delivery skill, platforms.md): a title 1–100 characters, a description up to 5,000 bytes
	const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s ?? '').length;
	/** the 16:9 card, by hash: the one designed on the Thumbnail step and rendered, else a render's */
	const card = $derived(
		item.thumbnail?.card ??
			(item.deliveries ?? [])
				.filter((d) => d.kind === 'thumbnail' && d.aspect === '16:9')
				.sort((a, b) => Number(b.timeline === 'day') - Number(a.timeline === 'day'))[0]?.hash
	);
	/** the card as designed in layers (the Thumbnail step), shown until it is rendered */
	const layers = $derived(item.thumbnail?.layers ?? []);
	/** the day's badge, bottom right of the stand-in: the badge layer's words */
	const badge = $derived(layers.find((l) => l.kind === 'badge' && l.on !== false)?.text ?? (layers.some((l) => l.kind === 'badge') ? 'DAY 1' : ''));
	// the hook is the title: YouTube's limit is 100 characters, and a title past ~60 is cut in most lists
	const hookLen = $derived((item.hook ?? '').length);
	const descBytes = $derived(bytes(item.description ?? ''));
	/** what goes out as the title: the hook; the story's working name only until there is one */
	const title = $derived((item.hook ?? '').trim() || item.title);
	/** the words on the card: the image title (the catchwords), else the hook */
	const words = $derived(cardWords(item));
	/** the image title as typed: one catchword per line */
	const imageTitle = $derived((item.image_title ?? []).join('\n'));
	const linesOf = (/** @type {string} */ v) => v.split('\n').map((l) => l.trim()).filter(Boolean);

	// ── the variants ──
	/** @type {Record<HookPart, string>} what each part is called on the card */
	const PART_LABEL = { subject: 'Subject', action: 'Action', end: 'End state', contrast: 'Contrast', proof: 'Proof', time: 'Time', anchor: 'Anchor' };
	/** the extreme dial (the hook-writer skill): aim at 3, the most impossible-sounding line that is still true */
	const DIAL = ['', 'mild', 'bold', 'extreme', 'false'];
	const hooks = $derived(item.hooks ?? []);
	/** the variant on the card: the one whose line is the story's hook */
	const chosen = $derived(hooks.find((h) => h.text === (item.hook ?? '').trim()));
	/** @type {string | null} the variant open in the list (its parts shown) */
	let openId = $state(null);
	/** @type {string | null} the variant whose parts are being edited */
	let editId = $state(null);
	const open = $derived(hooks.find((h) => h.id === openId) ?? chosen ?? null);

	const newId = () => `h${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
	/** @param {HookVariant[]} next */
	const setHooks = (next) => onchange({ hooks: next });
	/** @param {string} id @param {Partial<HookVariant>} patch */
	const edit = (id, patch) => setHooks(hooks.map((h) => (h.id === id ? { ...h, ...patch } : h)));

	/** The variant goes on the card: its line becomes the story's hook. */
	function choose(/** @type {HookVariant} */ h) {
		openId = h.id;
		if (h.text.trim()) onchange({ hook: h.text, ...(h.image_title?.length ? { image_title: h.image_title } : {}) });
	}

	/** A new variant: the line on the card, when it is not among them yet; else an empty one, opened to write. */
	function add() {
		const line = (item.hook ?? '').trim();
		const fresh = { id: newId(), text: line && !hooks.some((h) => h.text === line) ? line : '', dial: 3 };
		setHooks([...hooks, fresh]);
		openId = fresh.id;
		editId = fresh.id;
	}

	function remove(/** @type {string} */ id) {
		setHooks(hooks.filter((h) => h.id !== id));
		if (editId === id) editId = null;
		if (openId === id) openId = null;
	}

	/** The parts a variant has named, in the skill's order. @param {HookVariant} h */
	const named = (h) => HOOK_PARTS.filter((p) => h[p]).map((p) => ({ part: p, label: PART_LABEL[p], text: /** @type {string} */ (h[p]) }));
</script>

<div class="hook">
	<!-- the hooks tried: click one and it goes on the card -->
	<aside class="variants" aria-label="The hooks tried">
		<div class="head">
			<span>Variants <small>{hooks.length}{chosen ? ' · one on the card' : hooks.length ? ' · none on the card yet' : ''}</small></span>
			<button class="add" onclick={add}>+ Variant</button>
		</div>
		{#if hooks.length}
			<ol class="list">
				{#each hooks as h, k (h.id)}
					{@const onCard = chosen?.id === h.id}
					{@const isOpen = open?.id === h.id}
					<li class:oncard={onCard} class:open={isOpen}>
						<button class="line" aria-pressed={onCard} onclick={() => choose(h)} title={onCard ? 'On the title card' : 'Put it on the title card'}>
							<span class="n">{k + 1}</span>
							<b>{h.text || 'A new hook, not written yet'}</b>
							<span class="meta">
								{#if h.dial}
									<span class="dial" title="The extreme dial: {h.dial} {DIAL[h.dial]}">
										{#each [1, 2, 3, 4] as d (d)}<i class:lit={d <= (h.dial ?? 0)} class:false={d === 4 && h.dial === 4}></i>{/each}
										<small>{DIAL[h.dial]}</small>
									</span>
								{/if}
								{#if onCard}<em>◆ on the card</em>{/if}
							</span>
						</button>
						{#if isOpen}
							<div class="parts">
								{#if editId === h.id}
									<label class="field"><span>The line</span><textarea rows="2" maxlength="300" value={h.text} oninput={(e) => edit(h.id, { text: e.currentTarget.value })}></textarea></label>
									{#each HOOK_PARTS as p (p)}
										<label class="field"><span>{PART_LABEL[p]}</span><input maxlength="160" value={h[p] ?? ''} oninput={(e) => edit(h.id, { [p]: e.currentTarget.value })} /></label>
									{/each}
									<label class="field"><span>Image title <small>catchwords, one per line</small></span><textarea rows="2" value={(h.image_title ?? []).join('\n')} oninput={(e) => edit(h.id, { image_title: linesOf(e.currentTarget.value) })}></textarea></label>
									<label class="field"><span>Promise</span><input maxlength="300" value={h.promise ?? ''} oninput={(e) => edit(h.id, { promise: e.currentTarget.value })} /></label>
									<label class="field"><span>Objection killer</span><input maxlength="300" value={h.objection ?? ''} oninput={(e) => edit(h.id, { objection: e.currentTarget.value })} /></label>
									<label class="field">
										<span>Dial</span>
										<select value={String(h.dial ?? 3)} onchange={(e) => edit(h.id, { dial: Number(e.currentTarget.value) })}>
											{#each [1, 2, 3, 4] as d (d)}<option value={String(d)}>{d} · {DIAL[d]}</option>{/each}
										</select>
									</label>
									<label class="field"><span>Note</span><input maxlength="200" value={h.note ?? ''} oninput={(e) => edit(h.id, { note: e.currentTarget.value })} /></label>
								{:else}
									{#if named(h).length}
										<dl>
											{#each named(h) as { part, label, text } (part)}
												<dt>{label}</dt>
												<dd>{text}</dd>
											{/each}
										</dl>
									{:else}
										<p class="none">No parts named yet: point at its subject, its verb and its contrast.</p>
									{/if}
									{#if h.image_title?.length}<p class="after"><b>Image title</b> {h.image_title.join(' · ')}</p>{/if}
									{#if h.promise}<p class="after"><b>Promise</b> {h.promise}</p>{/if}
									{#if h.objection}<p class="after"><b>Objection</b> {h.objection}</p>{/if}
									{#if h.note}<p class="note">{h.note}</p>{/if}
								{/if}
								<div class="actions">
									{#if !onCard && h.text.trim()}<button class="use" onclick={() => choose(h)}>Put it on the card</button>{/if}
									<button onclick={() => (editId = editId === h.id ? null : h.id)}>{editId === h.id ? 'Done' : 'Edit'}</button>
									<button class="drop" onclick={() => remove(h.id)}>Remove</button>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ol>
		{:else}
			<p class="empty">No hooks tried yet. Write at least ten, from different angles, each with its parts named — then put the most extreme true one on the card.</p>
		{/if}
	</aside>

	<div class="fields">
		<label>
			<span>Hook <small>grabs attention · the title everywhere: the card, the article, the header · <b class:over={hookLen > 100} class:long={hookLen > 60 && hookLen <= 100}>{hookLen} / 100</b>{chosen ? ` · variant ${hooks.indexOf(chosen) + 1}` : ''}</small></span>
			<textarea class="big" rows="2" value={item.hook ?? ''} maxlength="300" placeholder="One line, ~10 words, readable in a second: the most extreme true thing" oninput={(e) => onchange({ hook: e.currentTarget.value })}></textarea>
		</label>
		<label>
			<span>Image title <small>the hook's catchwords for the card, even more compact · one per line · {(item.image_title ?? []).length} / 8</small></span>
			<textarea class="catch" rows="2" value={imageTitle} placeholder={"a '1' million lives\ndecision"} oninput={(e) => onchange({ image_title: linesOf(e.currentTarget.value) })}></textarea>
		</label>
		<label>
			<span>Intro <small>the trailer: the first 3–30 s · why should I care, what is my transformation · {(item.intro ?? '').length} / 5,000</small></span>
			<textarea rows="4" value={item.intro ?? ''} maxlength="5000" placeholder="The first seconds after the hook: the promise, the objection killer, the pain in the viewer’s own life — ending on the question the story answers" oninput={(e) => onchange({ intro: e.currentTarget.value })}></textarea>
		</label>
		<label>
			<span>Description <small>the overview and the detail · <b class:over={descBytes > 5000}>{descBytes} / 5,000 bytes</b></small></span>
			<textarea rows="8" value={item.description ?? ''} maxlength="5000" placeholder="What the film is, in the first two lines (they show before “more”); then the links, the chapters" oninput={(e) => onchange({ description: e.currentTarget.value })}></textarea>
		</label>
		<p class="vault">
			{#if item.story}
				<b>◆ Filed in the media vault</b> · its story <code>{item.story.slice(0, 10)}…</code>
			{:else}
				<b>◇ Not in the media vault yet</b> · the Mac app makes its story there, under this title, the next time it runs
			{/if}
		</p>
	</div>

	<!-- how it looks on YouTube: the card, the title, the first lines of the description -->
	<aside class="yt" aria-label="How it looks on YouTube">
		<div class="frame">
			{#if card}
				<img src={fileUrl(card)} alt="The 16:9 title card" />
			{:else if layers.length}
				<Card {layers} hook={words} />
			{:else}
				<div class="stand-in">
					<b>{words}</b>
					{#if badge}<small class="day">{badge}</small>{/if}
				</div>
			{/if}
		</div>
		<p class="cardnote">{card ? '16:9 master title card' : layers.length ? 'As designed on the Thumbnail step, not rendered yet' : 'Stand-in: the card is designed on the Thumbnail step'}</p>
		<h3>{title}</h3>
		<p class="chan">maiaCITY</p>
		{#if item.intro}<p class="intro">{item.intro}</p>{/if}
		{#if item.description}<p class="desc">{item.description}</p>{/if}
	</aside>
</div>

<style>
	.hook {
		display: grid;
		grid-template-columns: minmax(0, 19rem) minmax(0, 1fr) minmax(0, 24rem);
		align-items: start;
		gap: 2rem;
	}

	/* ── the variants ── */
	.variants {
		position: sticky;
		top: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-height: calc(100vh - 2rem);
		overflow: auto;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.6rem;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.add,
	.actions button {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.78rem;
		color: var(--ink);
		cursor: pointer;
	}

	.add:hover,
	.actions button:hover {
		border-color: var(--mustard);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.list li {
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		transition: border-color 0.15s;
	}

	.list li.open {
		border-color: var(--ink-soft);
	}

	.list li.oncard {
		border-color: var(--mustard);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--mustard) 35%, transparent);
	}

	.line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.15rem 0.6rem;
		width: 100%;
		box-sizing: border-box;
		padding: 0.6rem 0.75rem;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink);
		cursor: pointer;
	}

	.line .n {
		grid-row: 1 / span 2;
		align-self: start;
		font-size: 0.72rem;
		font-weight: 600;
		line-height: 1.6;
		color: var(--muted);
	}

	.line b {
		font-family: var(--font-display);
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.25;
	}

	.line .meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.7rem;
		color: var(--muted);
	}

	.line em {
		font-style: normal;
		font-weight: 600;
		color: #b07a1a;
	}

	.dial {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
	}

	.dial i {
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: var(--line);
	}

	.dial i.lit {
		background: var(--mustard);
	}

	.dial i.false {
		background: #9c3b26;
	}

	.dial small {
		margin-left: 0.3rem;
		font-size: 0.7rem;
	}

	.parts {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding: 0 0.75rem 0.7rem;
	}

	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 0.2rem 0.6rem;
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	dt {
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		line-height: 1.8;
		text-transform: uppercase;
		color: var(--muted);
	}

	dd {
		margin: 0;
	}

	.after,
	.note,
	.none {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.after b {
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.note,
	.none {
		color: var(--ink-soft);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.actions .use {
		border-color: var(--mustard);
		background: var(--mustard);
	}

	.actions .drop {
		color: #9c3b26;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.field span {
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.field input,
	.field textarea,
	.field select {
		padding: 0.35rem 0.5rem;
		font-size: 0.82rem;
	}

	.empty {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	/* ── the fields ── */
	.fields {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
	}

	label > span {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		margin-bottom: 0.3rem;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--muted);
	}

	small {
		font-size: 0.72rem;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	small b {
		font-weight: 400;
	}

	small .long {
		color: #b07a1a;
	}

	small .over {
		color: #9c3b26;
		font-weight: 600;
	}

	input,
	textarea,
	select {
		box-sizing: border-box;
		width: 100%;
		padding: 0.55rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 10px;
		background: #fff;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--ink);
		resize: vertical;
	}

	.big {
		font-family: var(--font-display);
		font-size: 1.35rem;
		line-height: 1.25;
	}

	input:focus-visible,
	textarea:focus-visible,
	select:focus-visible,
	.line:focus-visible {
		outline: 2px solid var(--mustard);
		outline-offset: 1px;
	}

	.vault {
		margin: 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.vault b {
		font-weight: 600;
		color: var(--ink);
	}

	code {
		font-size: 0.78rem;
	}

	/* ── YouTube ── */
	.yt {
		position: sticky;
		top: 1rem;
	}

	.frame {
		aspect-ratio: 16 / 9;
		overflow: hidden;
		border-radius: 12px;
		background: #1d2b22;
	}

	.frame img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.stand-in {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		height: 100%;
		box-sizing: border-box;
		padding: 7% 8%;
		background: linear-gradient(160deg, #3c5a44, #1d2b22 70%);
		color: #fdf8ec;
	}

	.stand-in b {
		display: -webkit-box;
		overflow: hidden;
		font-family: var(--font-display);
		font-size: clamp(1.2rem, 2.4vw, 1.9rem);
		line-height: 1.08;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
	}

	/* the day's badge, bottom right: gold, letter-spaced, a gold edge on a dark fill */
	.stand-in .day {
		position: absolute;
		right: 5%;
		bottom: 7%;
		padding: 0.3em 0.7em;
		border: 2px solid #f6c75a;
		border-radius: 7px;
		background: rgb(10 14 12 / 0.55);
		font-family: var(--font-display);
		font-size: clamp(0.72rem, 1.3vw, 0.95rem);
		font-weight: 760;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: #f6c75a;
	}

	.cardnote {
		margin: 0.35rem 0 0.8rem;
		font-size: 0.72rem;
		color: var(--muted);
	}

	h3 {
		display: -webkit-box;
		margin: 0;
		overflow: hidden;
		font-family: var(--font-body);
		font-size: 1.05rem;
		font-weight: 600;
		letter-spacing: normal;
		line-height: 1.35;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.chan {
		margin: 0.3rem 0 0.6rem;
		font-size: 0.82rem;
		color: var(--muted);
	}

	.intro {
		margin: 0 0 0.6rem;
		font-size: 0.86rem;
		line-height: 1.5;
		white-space: pre-line;
		color: var(--ink);
	}

	.desc {
		display: -webkit-box;
		margin: 0;
		padding: 0.7rem 0.8rem;
		overflow: hidden;
		border-radius: 10px;
		background: #f2f0ea;
		font-size: 0.82rem;
		line-height: 1.5;
		white-space: pre-line;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
	}

	@media (max-width: 1180px) {
		.hook {
			grid-template-columns: minmax(0, 17rem) minmax(0, 1fr);
		}

		.yt {
			grid-column: 2;
			position: static;
			max-width: 26rem;
		}
	}

	@media (max-width: 760px) {
		.hook {
			grid-template-columns: minmax(0, 1fr);
		}

		.variants {
			position: static;
			max-height: none;
			overflow: visible;
		}

		.yt {
			grid-column: auto;
		}
	}
</style>
