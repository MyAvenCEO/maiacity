<!--
	The script (Script tab): the timeline itself, read as scenes of shots, each shot with what is said under it. A shot
	not filmed yet is a slate — its words on the picture track — and a line not recorded yet is a line on the voice
	track, in the captions already; drop a storyboard still or the footage on a slate, the recorded voice on a line, and
	it takes its place with its script kept. Edit here or on the timeline: it is the same clips, one truth. A recorded
	voice's words are its captions: rewording them here rewords them everywhere.
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const SIZES = ['', 'EWS', 'WS', 'FS', 'MS', 'MCU', 'CU', 'ECU', 'insert'];
	const STAGE = { text: 'text', storyboard: 'storyboard', footage: 'footage', world: '3D' };
	let newScene = $state('');

	/** @param {string} from @param {string} to */
	function renameScene(from, to) {
		const name = to.trim();
		if (!name || name === from) return;
		for (const sh of s.script.find((x) => x.scene === from)?.shots ?? []) s.setScript(sh.clip.id, { scene: name });
	}
	/** @param {string} id */
	const phrasesOf = (id) => s.phrases.filter((p) => p.clip === id);
	/** @param {import('./studio.svelte.js').Clip} c */
	const pick = (c) => ((s.selected = c.id), s.seek(c.start));
</script>

<aside class="script">
	<h2>Script</h2>
	{#each s.script as sc (sc.scene)}
		<section class="scene">
			<input class="scn" value={sc.scene} onchange={(e) => renameScene(sc.scene, e.currentTarget.value)} aria-label="Scene" />
			{#each sc.shots as sh (sh.clip.id)}
				{@const c = sh.clip}
				<article class="shot" class:sel={s.selected === c.id} class:now={s.time >= c.start && s.time < c.start + c.dur}>
					<header>
						<button class="tc" onclick={() => pick(c)} title="Go there">{clockText(c.start)}</button>
						<input class="lbl" value={c.script?.label ?? ''} placeholder="shot" onchange={(e) => s.setScript(c.id, { label: e.currentTarget.value })} aria-label="Shot" />
						<select value={c.script?.size ?? ''} onchange={(e) => s.setScript(c.id, { size: e.currentTarget.value })} aria-label="Shot size">
							{#each SIZES as z (z)}<option value={z}>{z || 'size'}</option>{/each}
						</select>
						<span class="stage {sh.stage}" title={sh.stage === 'text' ? 'Not filmed yet: drop a storyboard still or the footage on it (timeline, V1)' : ''}>{STAGE[sh.stage]}</span>
						<span class="len">{c.dur.toFixed(1)} s</span>
					</header>
					{#if sh.stage !== 'text'}<p class="file">{s.clipName(c)}</p>{/if}
					<textarea rows="2" placeholder="What we see" value={c.script?.description ?? ''} onchange={(e) => s.setScript(c.id, { description: e.currentTarget.value })} aria-label="Description"></textarea>
					<textarea class="notes" rows="1" placeholder="Notes" value={c.script?.notes ?? ''} onchange={(e) => s.setScript(c.id, { notes: e.currentTarget.value })} aria-label="Notes"></textarea>
					<div class="lines">
						{#each sh.lines as l (l.id)}
							{#if l.kind === 'line'}
								<label class="line todo" title="Not recorded yet: drop the recorded voice on it (timeline, A1)">
									<span>▢</span>
									<textarea rows="1" placeholder="What is said" value={l.text ?? ''} onchange={(e) => s.setLine(l.id, e.currentTarget.value)}></textarea>
								</label>
							{:else}
								<div class="line said">
									<span title={s.clipName(l)}>♪</span>
									<div class="ph">
										{#each phrasesOf(l.id) as p (`${p.words[0].i}`)}
											<input value={p.words.map((w) => w.word).join(' ')} onchange={(e) => s.rewordPhrase(p, e.currentTarget.value)} aria-label="Words at {p.start.toFixed(1)} s" />
										{:else}
											<em>{s.clipName(l)} — no words yet</em>
										{/each}
									</div>
								</div>
							{/if}
						{/each}
						<button class="add" onclick={() => s.addLine(c.id)}>+ line</button>
					</div>
				</article>
			{/each}
			<button class="add" onclick={() => s.addShot(sc.scene)}>+ shot in {sc.scene}</button>
		</section>
	{/each}
	<form class="new" onsubmit={(e) => (e.preventDefault(), newScene.trim() && (s.addShot(newScene.trim()), (newScene = '')))}>
		<input bind:value={newScene} placeholder="A new scene…" aria-label="New scene" />
		<button class="add" disabled={!newScene.trim()}>+ scene</button>
	</form>
</aside>

<style>
	.script {
		grid-area: inspector;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	h2 {
		margin: 0 0 0.6rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.scene {
		margin-bottom: 1.1rem;
	}

	.scn {
		width: 100%;
		margin-bottom: 0.35rem;
		padding: 0.1rem 0;
		border: 0;
		border-bottom: 1px solid var(--edge);
		background: none;
		font-family: var(--font-display);
		font-size: 1.05rem;
		color: var(--ink);
	}

	.shot {
		margin-bottom: 0.45rem;
		padding: 0.45rem 0.55rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.shot.now {
		border-color: var(--accent);
	}

	.shot.sel {
		border-color: var(--ink);
	}

	header {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}

	.tc {
		padding: 0;
		border: 0;
		background: none;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.68rem;
		color: var(--dim);
		cursor: pointer;
	}

	.lbl {
		width: 3rem;
		padding: 0.05rem 0.25rem;
		border: 1px solid transparent;
		border-radius: 4px;
		font: inherit;
		font-size: 0.76rem;
		font-weight: 600;
	}

	.lbl:hover,
	.lbl:focus {
		border-color: var(--edge);
	}

	select {
		padding: 0 0.2rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		background: #fff;
		font: inherit;
		font-size: 0.68rem;
	}

	.stage {
		padding: 0 0.4rem;
		border-radius: 999px;
		font-size: 0.62rem;
		font-weight: 600;
	}

	.stage.text {
		background: #f3e3c1;
		color: #a8741a;
	}

	.stage.storyboard {
		background: #e6ecf5;
		color: #4a5f93;
	}

	.stage.footage {
		background: #eef2e6;
		color: #3e5a2f;
	}

	.stage.world {
		background: #f1eafb;
		color: #5a3a8a;
	}

	.len {
		margin-left: auto;
		font-size: 0.66rem;
		color: var(--dim);
	}

	.file {
		margin: 0.2rem 0 0;
		overflow: hidden;
		font-size: 0.66rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
	}

	textarea,
	.ph input,
	.new input {
		width: 100%;
		margin-top: 0.25rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: var(--bg);
		font: inherit;
		font-size: 0.76rem;
		resize: vertical;
		color: var(--ink);
	}

	textarea:focus,
	.ph input:focus,
	.new input:focus {
		border-color: var(--edge);
		background: #fff;
		outline: none;
	}

	.notes {
		font-size: 0.7rem;
		color: var(--dim);
	}

	.lines {
		margin-top: 0.2rem;
	}

	.line {
		display: grid;
		grid-template-columns: 1rem 1fr;
		gap: 0.2rem;
		align-items: start;
	}

	.line > span {
		padding-top: 0.45rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.line.todo textarea {
		font-style: italic;
	}

	.ph em {
		display: block;
		padding-top: 0.35rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.add {
		margin-top: 0.25rem;
		padding: 0.1rem 0.5rem;
		border: 1px dashed var(--edge);
		border-radius: 999px;
		background: none;
		font: inherit;
		font-size: 0.7rem;
		color: var(--dim);
		cursor: pointer;
	}

	.add:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.new {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
</style>
