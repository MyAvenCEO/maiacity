<!--
	A story's hook: the hooks tried, listed on the left (each with its parts named, the hook-writer skill's anatomy),
	the one on the title card among them — click a variant and it goes on the card, and the YouTube preview on the
	right shows it; then the title, the hook line, the description under it, and the one 16:9 master title card every
	other shape is made from. The card itself is rendered in the repo (scripts/film/thumbnail.mjs) and pushed with the
	story; until then a stand-in shows the hook on the card.
-->
<script>
	import { HOOK_PARTS, fileUrl } from '$lib/auth/client';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */
	/** @typedef {import('$lib/auth/client').HookVariant} HookVariant */
	/** @typedef {import('$lib/auth/client').HookPart} HookPart */

	/** @type {{ item: ContentItem, onchange: (patch: Partial<ContentItem>) => void }} */
	let { item, onchange } = $props();

	// YouTube's limits (the delivery skill, platforms.md): a title 1–100 characters, a description up to 5,000 bytes;
	// a title past ~60 characters is cut in most lists
	const bytes = (/** @type {string} */ s) => new TextEncoder().encode(s ?? '').length;
	const card = $derived(
		(item.deliveries ?? [])
			.filter((d) => d.kind === 'thumbnail' && d.aspect === '16:9')
			.sort((a, b) => Number(b.timeline === 'day') - Number(a.timeline === 'day'))[0]
	);
	const titleLen = $derived((item.title ?? '').length);
	const descBytes = $derived(bytes(item.description ?? ''));

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
		if (h.text.trim()) onchange({ hook: h.text });
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
			<span>Title <small class:over={titleLen > 100} class:long={titleLen > 60 && titleLen <= 100}>{titleLen} / 100</small></span>
			<input class="big" value={item.title} maxlength="200" oninput={(e) => onchange({ title: e.currentTarget.value })} />
		</label>
		<label>
			<span>Hook <small>the line on the title card · {(item.hook ?? '').length} / 300{chosen ? ` · variant ${hooks.indexOf(chosen) + 1}` : ''}</small></span>
			<textarea rows="2" value={item.hook ?? ''} maxlength="300" placeholder="Few words, big type: the promise" oninput={(e) => onchange({ hook: e.currentTarget.value })}></textarea>
		</label>
		<label>
			<span>Description <small class:over={descBytes > 5000}>{descBytes} / 5,000 bytes</small></span>
			<textarea rows="9" value={item.description ?? ''} maxlength="5000" placeholder="What the film is, in the first two lines (they show before “more”); then the links, the chapters" oninput={(e) => onchange({ description: e.currentTarget.value })}></textarea>
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
				<img src={fileUrl(card.hash)} alt="The 16:9 title card" />
			{:else}
				<div class="stand-in">
					<b>{item.hook || item.title}</b>
					<small>maiaCITY</small>
				</div>
			{/if}
		</div>
		<p class="cardnote">{card ? '16:9 master title card' : 'Stand-in: the 16:9 master card is not rendered yet'}</p>
		<h3>{item.title}</h3>
		<p class="chan">maiaCITY</p>
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

	small.long {
		color: #b07a1a;
	}

	small.over {
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

	.stand-in small {
		margin-top: 0.5rem;
		font-size: 0.7rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.75;
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
