<!--
	A story's hook: its title, the hook (the line set into its title card), the description under it, and the one 16:9
	master title card every other shape is made from — and, beside them, how it will look on YouTube, where the base
	film goes out first. The card itself is rendered in the repo (scripts/film/thumbnail.mjs) and pushed with the story;
	until then a stand-in shows the hook on the card.
-->
<script>
	import { fileUrl } from '$lib/auth/client';

	/** @typedef {import('$lib/auth/client').ContentItem} ContentItem */

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
</script>

<div class="hook">
	<div class="fields">
		<label>
			<span>Title <small class:over={titleLen > 100} class:long={titleLen > 60 && titleLen <= 100}>{titleLen} / 100</small></span>
			<input class="big" value={item.title} maxlength="200" oninput={(e) => onchange({ title: e.currentTarget.value })} />
		</label>
		<label>
			<span>Hook <small>the line on the title card · {(item.hook ?? '').length} / 300</small></span>
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
		grid-template-columns: minmax(0, 1fr) minmax(0, 26rem);
		align-items: start;
		gap: 2rem;
	}

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
	textarea {
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
	textarea:focus-visible {
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

	@media (max-width: 900px) {
		.hook {
			grid-template-columns: minmax(0, 1fr);
		}

		.yt {
			position: static;
			max-width: 26rem;
		}
	}
</style>
