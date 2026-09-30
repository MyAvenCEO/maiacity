<!--
	The mixer (Audio tab): the sound tracks — voice (A1), music (A2), sounds (A3) — each clip's gain in dB and its
	fades, beside what it measures (loudness at its gain, LUFS) and the level its track is aimed at. The sound design
	by hand; an agent does the same through MCP (audio_measure, audio_level, audio_mix). Nothing here moves a clip.
-->
<script>
	import { clockText } from './studio.svelte.js';

	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const TRACKS = [
		{ id: 'A1', label: 'Voice', target: -18 },
		{ id: 'A2', label: 'Music', target: -26 },
		{ id: 'A3', label: 'Sounds', target: -30 }
	];
	/** @param {number} vol */
	const db = (vol) => (vol > 0 ? 20 * Math.log10(vol) : -60);
	/** @param {number} g */
	const vol = (g) => Math.round(10 ** (Math.min(12, Math.max(-60, g)) / 20) * 1000) / 1000;
	/** @param {string} id */
	const measured = (id) => s.loud?.clips?.find((/** @type {any} */ c) => c.clip === id);
	/** @param {number | null | undefined} v */
	const lufs = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');
	const under = $derived(s.loud?.voice_over_music ?? []);

	// measured by itself: when the tab opens, and a moment after the sound clips change (their files, places, gains)
	const soundKey = $derived(JSON.stringify(s.clips.filter((c) => c.track !== 'V1').map((c) => [c.id, c.hash, c.start, c.in, c.dur, c.vol])));
	$effect(() => {
		void soundKey;
		const t = setTimeout(() => void s.measureSound(), s.loud ? 1500 : 0);
		return () => clearTimeout(t);
	});
</script>

<aside class="mixer">
	<h2>Mixer <span class="st">{s.loudMeasuring ? 'listening…' : s.loud ? 'measured' : ''}</span></h2>
	{#each TRACKS as t (t.id)}
		{@const clips = s.clips.filter((c) => c.track === t.id).sort((a, b) => a.start - b.start)}
		<section class="track {t.id}">
			<header><b>{t.id}</b> {t.label} <span class="tg">aim {t.target} LUFS</span></header>
			{#each clips as c (c.id)}
				{@const m = measured(c.id)}
				{@const off = typeof m?.lufs_at_vol === 'number' ? m.lufs_at_vol - t.target : null}
				<div class="clip" class:sel={s.selected === c.id}>
					<button class="nm" onclick={() => ((s.selected = c.id), s.seek(c.start))} title="{s.clipName(c)} · {clockText(c.start)}">{s.clipName(c)}</button>
					<span class="lv" class:ok={off !== null && Math.abs(off) <= 1.5} class:off={off !== null && Math.abs(off) > 1.5} title="Loudness at its gain">{lufs(m?.lufs_at_vol)}</span>
					<label class="gain" title="Gain, dB (double-click: 0)">
						<input type="range" min="-30" max="12" step="0.5" value={db(c.vol)} oninput={(e) => s.setSound(c.id, { vol: vol(Number(e.currentTarget.value)) })} ondblclick={() => s.setSound(c.id, { vol: 1 })} />
						<output>{db(c.vol) > 0 ? '+' : ''}{db(c.vol).toFixed(1)}</output>
					</label>
					<label class="fade" title="Fade in, s"><span>in</span><input type="number" min="0" step="0.05" value={c.fin ?? 0} onchange={(e) => s.setSound(c.id, { fin: Math.max(0, Number(e.currentTarget.value)) })} /></label>
					<label class="fade" title="Fade out, s"><span>out</span><input type="number" min="0" step="0.05" value={c.fout ?? 0} onchange={(e) => s.setSound(c.id, { fout: Math.max(0, Number(e.currentTarget.value)) })} /></label>
				</div>
			{:else}
				<p class="none">No clips.</p>
			{/each}
		</section>
	{/each}
	{#if under.length}
		<section class="under">
			<header>Voice over music</header>
			{#each under as u, i (i)}
				{@const v = s.clips.find((c) => c.id === u.voice)}
				<p class:warn={u.voice_over_music_lu < 12}>{v ? s.clipName(v) : u.voice}: <b>{u.voice_over_music_lu.toFixed(1)} LU</b> above the music</p>
			{/each}
			<p class="hint">12–18 LU keeps a voice clear (the render keys the music down 6 dB under it).</p>
		</section>
	{/if}
	<p class="hint">The whole mix is levelled to −14 LUFS, −1 dBTP in the render.</p>
</aside>

<style>
	.mixer {
		grid-area: bin;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	h2 {
		display: flex;
		justify-content: space-between;
		margin: 0 0 0.6rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	.st {
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
	}

	.track {
		margin-bottom: 0.8rem;
	}

	.track header {
		display: flex;
		gap: 0.35rem;
		align-items: baseline;
		margin-bottom: 0.25rem;
		font-size: 0.76rem;
	}

	.track.A1 b {
		color: #b8860b;
	}

	.track.A2 b {
		color: #4a5f93;
	}

	.track.A3 b {
		color: #3e5a2f;
	}

	.tg {
		margin-left: auto;
		font-size: 0.66rem;
		color: var(--dim);
	}

	.clip {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 2.6rem;
		grid-template-areas: 'nm lv' 'gain gain' 'fin fout';
		gap: 0.15rem 0.4rem;
		margin-bottom: 0.3rem;
		padding: 0.35rem 0.45rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.clip.sel {
		border-color: var(--ink);
	}

	.nm {
		grid-area: nm;
		overflow: hidden;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.74rem;
		text-align: left;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--ink);
		cursor: pointer;
	}

	.lv {
		grid-area: lv;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.68rem;
		text-align: right;
		color: var(--dim);
	}

	.lv.ok {
		color: #3e5a2f;
	}

	.lv.off {
		color: #b8860b;
	}

	.gain {
		grid-area: gain;
		display: grid;
		grid-template-columns: 1fr 2.6rem;
		gap: 0.3rem;
		align-items: center;
	}

	.gain input {
		width: 100%;
		accent-color: var(--ink);
	}

	output {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.66rem;
		text-align: right;
	}

	.fade {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		font-size: 0.66rem;
		color: var(--dim);
	}

	.fade input {
		width: 3.4rem;
		padding: 0.1rem 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 4px;
		font: inherit;
		font-size: 0.7rem;
	}

	.none,
	.hint {
		margin: 0.2rem 0;
		font-size: 0.7rem;
		color: var(--dim);
	}

	.under header {
		margin-bottom: 0.2rem;
		font-size: 0.76rem;
		font-weight: 600;
	}

	.under p {
		margin: 0.1rem 0;
		font-size: 0.72rem;
	}

	.under .warn b {
		color: #9c3b26;
	}
</style>
