<!--
	A file's transcript, word by word, on its own clock: each line with its timecode (the camera's, from its start
	timecode, else file time), the word under the playhead lit. Click a word to go there; drag across words (or
	shift-click) to take a run of them — the source monitor marks it in and out, the inspector cuts the clip to it. The
	search finds a phrase (Enter: the next one). While there is none yet, it says where the transcript stands.
-->
<script>
	import { linesOf, timecodeAt, transcriptOf, transcriptState, wordsOf } from './transcript.js';

	/**
	 * @type {{
	 *   m: import('$lib/auth/client').MediaItem,
	 *   time?: number | null,
	 *   range?: { from: number, to: number } | null,
	 *   onseek?: (t: number) => void,
	 *   onselect?: (sel: { from: number, to: number, text: string } | null) => void
	 * }}
	 */
	let { m, time = null, range = null, onseek = () => {}, onselect = () => {} } = $props();

	const words = $derived(wordsOf(m));
	const t = $derived(transcriptOf(m));
	const st = $derived(transcriptState(m));
	// a clip shows only the lines it plays (and dims the words of them it leaves out)
	const lines = $derived(linesOf(words, t?.utterances).filter((l) => !range || (l.e > range.from && l.s < range.to)));
	/** @param {number} i */
	const outside = (i) => !!range && (words[i].e <= range.from || words[i].s >= range.to);

	// ── the word under the playhead: lit by hand (a class on one span), not by re-drawing thousands ──
	/** @type {HTMLDivElement | null} */
	let box = $state(null);
	let hover = false;
	const now = $derived.by(() => {
		if (time === null || !words.length) return -1;
		// the last word begun (binary search: a long take has thousands)
		let lo = 0, hi = words.length - 1, at = -1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (words[mid].s <= time + 0.02) (at = mid), (lo = mid + 1);
			else hi = mid - 1;
		}
		return at >= 0 && time < words[at].e + 0.6 ? at : -1;
	});
	$effect(() => {
		const i = now;
		void lines; // drawn again (a clip trimmed): lit again
		if (!box) return;
		box.querySelector('.w.now')?.classList.remove('now');
		const el = box.querySelector(`[data-i="${i}"]`);
		el?.classList.add('now');
		if (el && !hover) el.scrollIntoView({ block: 'nearest' });
	});

	// ── a run of words, and the search ──
	/** @type {[number, number] | null} */
	let sel = $state(null);
	let q = $state('');
	let hit = $state(0);
	let anchor = -1;
	let dragging = false;
	let moved = false;
	// a new file: nothing taken
	$effect(() => {
		void m.hash;
		sel = null;
		q = '';
	});
	/** @param {PointerEvent} e @param {number} i */
	function down(e, i) {
		e.preventDefault();
		if (e.shiftKey && anchor >= 0) {
			sel = [Math.min(anchor, i), Math.max(anchor, i)];
			return finish();
		}
		anchor = i;
		dragging = true;
		moved = false;
		sel = [i, i];
		window.addEventListener('pointerup', up, { once: true });
	}
	/** @param {number} i */
	function enter(i) {
		if (!dragging || anchor < 0) return;
		moved = moved || i !== anchor;
		sel = [Math.min(anchor, i), Math.max(anchor, i)];
	}
	function up() {
		dragging = false;
		if (!moved && sel && sel[0] === sel[1]) {
			// a click: go there
			onseek(words[sel[0]].s);
			sel = null;
			onselect(null);
			return;
		}
		finish();
	}
	function finish() {
		if (!sel) return;
		const [a, b] = sel;
		onselect({ from: words[a].s, to: words[b].e, text: words.slice(a, b + 1).map((w) => w.w).join(' ') });
	}
	function clear() {
		sel = null;
		onselect(null);
	}

	// ── search ──
	/** @param {string} w */
	const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
	const matches = $derived.by(() => {
		const want = q.trim().split(/\s+/).map(norm).filter(Boolean);
		if (!want.length) return /** @type {[number, number][]} */ ([]);
		const flat = words.map((w) => norm(w.w));
		/** @type {[number, number][]} */
		const out = [];
		for (let i = 0; i + want.length <= flat.length; i++) {
			// the last word of the phrase may be half typed
			if (want.every((x, k) => (k === want.length - 1 ? flat[i + k].startsWith(x) : flat[i + k] === x))) out.push([i, i + want.length - 1]);
		}
		return out;
	});
	const found = $derived(new Set(matches.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k))));
	/** @param {KeyboardEvent} e */
	function onKey(e) {
		if (e.key !== 'Enter' || !matches.length) return;
		e.preventDefault();
		hit = (hit + (e.shiftKey ? matches.length - 1 : 1)) % matches.length;
		go();
	}
	function go() {
		const mt = matches[hit];
		if (!mt) return;
		onseek(words[mt[0]].s);
		box?.querySelector(`[data-i="${mt[0]}"]`)?.scrollIntoView({ block: 'center' });
	}
	$effect(() => {
		void matches;
		hit = 0;
	});
</script>

<div class="transcript">
	{#if words.length}
		<div class="thead">
			<input type="search" bind:value={q} onkeydown={onKey} placeholder="Find in the words" aria-label="Find in the transcript" />
			{#if q.trim()}<span class="count">{matches.length ? `${hit + 1} / ${matches.length}` : 'none'}</span>{/if}
			{#if sel}
				<button class="clr" onclick={clear} title="Let go of the words">×</button>
			{/if}
			<span class="src" title={st.note}>{t ? (t.language ?? 'transcript') : 'voice timing'}</span>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="lines" bind:this={box} onpointerenter={() => (hover = true)} onpointerleave={() => (hover = false)}>
			{#each lines as l, li (l.from)}
				<p class="line">
					<button class="tc" onclick={() => onseek(l.s)} title="Go to this line">{timecodeAt(m, l.s)}</button>
					<span class="ws">
						{#if l.sp !== undefined && (li === 0 || lines[li - 1].sp !== l.sp)}<b class="sp">{l.sp}</b>{/if}
						{#each { length: l.to - l.from + 1 } as _, k (k)}
							{@const i = l.from + k}
							{@const w = words[i]}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<span
								class="w"
								class:sel={!!sel && i >= sel[0] && i <= sel[1]}
								class:hit={found.has(i)}
								class:out={outside(i)}
								class:low={w.c !== undefined && w.c < 0.5}
								data-i={i}
								onpointerdown={(e) => down(e, i)}
								onpointerenter={() => enter(i)}
								title="{timecodeAt(m, w.s)}{w.c !== undefined ? ` · ${Math.round(w.c * 100)}%` : ''}">{w.w}</span
							>{' '}
						{/each}
					</span>
				</p>
			{:else}
				<p class="empty">No words in this part.</p>
			{/each}
		</div>
	{:else}
		<p class="empty state-{st.state}" title={st.note}>
			{#if st.state === 'queued'}Transcript queued…{:else if st.state === 'transcribing'}Transcribing…{:else if st.state === 'failed'}Transcript failed: {st.note.replace(/^failed:?\s*/, '')}{:else if st.state === 'none'}No speech to transcribe{st.note.replace(/^none:?\s*/, ' — ')}{:else}No transcript yet.{/if}
		</p>
	{/if}
</div>

<style>
	.transcript {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-height: 0;
	}

	.thead {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.4rem;
	}

	.thead input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.6rem;
		border: 1px solid var(--edge);
		border-radius: 999px;
		background: #fff;
		font: inherit;
		font-size: 0.74rem;
		color: var(--ink);
	}

	.count,
	.src {
		font-size: 0.66rem;
		white-space: nowrap;
		color: var(--dim);
	}

	.clr {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font-size: 0.95rem;
		color: var(--dim);
		cursor: pointer;
	}

	.lines {
		flex: 1;
		min-height: 0;
		overflow: auto;
		user-select: none;
	}

	.line {
		display: flex;
		gap: 0.5rem;
		margin: 0 0 0.3rem;
		font-size: 0.8rem;
		line-height: 1.45;
	}

	.tc {
		flex: none;
		align-self: flex-start;
		padding: 0.05rem 0.25rem;
		border: 0;
		border-radius: 4px;
		background: none;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.64rem;
		line-height: 1.9;
		color: var(--dim);
		cursor: pointer;
	}

	.tc:hover {
		background: var(--bg);
		color: var(--ink);
	}

	.sp {
		margin-right: 0.3rem;
		padding: 0 0.3rem;
		border-radius: 4px;
		background: #e6ecf5;
		font-size: 0.62rem;
		font-weight: 600;
		color: #4a5f93;
	}

	.w {
		border-radius: 3px;
		cursor: pointer;
	}

	.w:hover {
		background: #0000000d;
	}

	.w.out {
		color: #b9b3a6;
	}

	.w.low {
		text-decoration: underline dotted #c9b27a;
	}

	.w.hit {
		background: #fbe7b0;
	}

	.w.sel {
		background: rgb(217 154 43 / 0.35);
	}

	.w:global(.now) {
		background: #e5483d;
		color: #fff;
	}

	.empty {
		margin: 0.2rem 0;
		font-size: 0.74rem;
		color: var(--dim);
	}

	.state-failed {
		color: #9c3b26;
	}

	.state-queued,
	.state-transcribing {
		color: #a8741a;
	}
</style>
