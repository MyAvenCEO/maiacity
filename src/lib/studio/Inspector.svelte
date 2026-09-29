<!--
	The inspector (Edit): the selected clip — where it sits, how long it runs, how loud it plays, what file it is. A world
	clip shows its shot record instead: its version, the camera's keys, the hour, the exposure, the lights and the cues,
	each change saved as a new version of the shot (the clip follows it); and a camera move recorded by flying it.
-->
<script>
	import ColorBadge from './ColorBadge.svelte';
	import { hasShotJs, toKeys } from './shots.js';
	import { SHOT_LIGHTS } from '$lib/auth/client';
	import { isWorld, itemName } from './studio.svelte.js';

	/** @typedef {import('$lib/auth/client').ShotSpec} ShotSpec */
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const sel = $derived(s.sel);
	const m = $derived(sel?.cid ? s.byCid.get(sel.cid) : undefined);
	const shot = $derived(s.shotOf(sel));
	const spec = $derived(isWorld(sel) ? s.specOf(sel) : null);
	const key = $derived(spec?.camera.kind === 'keys' && s.selectedKey !== null ? (spec.camera.keys?.[s.selectedKey] ?? null) : null);
	const ro = $derived(!s.canEdit);
	const sounds = $derived(s.library.filter((x) => x.kind === 'audio' && !x.tags.includes('superseded')));
	let cueSound = $state('');

	/**
	 * A change to the world clip's shot (a new version, saved a moment after the last change). The camera's keys,
	 * lights and cues it changes exist: the fields that show them are only there when they do.
	 * @param {(sp: ShotSpec & { camera: { keys: import('$lib/auth/client').CameraKey[] } }) => unknown} change
	 */
	const edit = (change) => sel && s.editSpec(sel, (sp) => void change(/** @type {any} */ (sp)));
	/** @param {string} v */
	const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
	/** @param {number | undefined} v */
	const fmt = (v, d = 2) => (v === undefined ? '' : String(Math.round(v * 10 ** d) / 10 ** d));
</script>

<aside class="inspector">
	<h2>Inspector</h2>
	{#if sel && !isWorld(sel)}
		<p class="iname">{String(m?.meta?.title ?? itemName(m))} {#if m && m.kind !== 'audio'}<ColorBadge {s} {m} />{/if}</p>
		{#if m?.meta?.text}<p class="line">{String(m.meta.text)}</p>{/if}
		<fieldset disabled={ro}>
			<label>Start <input type="number" step="0.05" min="0" value={sel.start.toFixed(2)} onchange={(e) => s.setClip({ start: Math.max(0, Number(e.currentTarget.value)) })} /> s</label>
			<label>Length <input type="number" step="0.05" min="0.2" value={sel.dur.toFixed(2)} onchange={(e) => s.setClip({ dur: Math.max(0.2, Number(e.currentTarget.value)) })} /> s</label>
			{#if m?.kind !== 'image'}
				<label>From <input type="number" step="0.05" min="0" value={sel.in.toFixed(2)} onchange={(e) => s.setClip({ in: Math.max(0, Number(e.currentTarget.value)) })} /> s in</label>
				<label class="vol">Volume <input type="range" min="0" max="1" step="0.01" value={sel.vol} oninput={(e) => s.setClip({ vol: Number(e.currentTarget.value) })} /> {Math.round(sel.vol * 100)}%</label>
			{/if}
		</fieldset>
		<dl>
			{#if m?.meta?.voice}<dt>Voice</dt><dd>{String(m.meta.voice)} · {String(m.meta.model ?? '').split('/').pop()}</dd>{/if}
			{#if m?.meta?.artist}<dt>Artist</dt><dd>{String(m.meta.artist)}</dd>{/if}
			{#if m?.kind === 'video'}
				{@const px = s.proxy(m)}
				<dt>Proxy</dt><dd>{px.state === 'ready' ? 'ready — Edit plays it' : px.state === 'none' ? 'none yet — the original plays' : px.state}</dd>
			{/if}
			{#if sel.grade}<dt>Grade</dt><dd>graded (Grade tab)</dd>{/if}
			<dt>Tags</dt><dd>{m?.tags.join(', ') || '—'}</dd>
			<dt>CID</dt><dd><code>{sel.cid}</code></dd>
		</dl>
		{#if !ro}<button class="ghost danger" onclick={() => s.remove(sel.id)}>Remove clip</button>{/if}
	{:else if sel && spec}
		<p class="iname">{shot?.name ?? 'World shot'} <span class="ver">v{sel.shotVersion}{#if s.drafts[sel.id]} · saving…{/if}</span></p>
		<p class="sub">A world shot: data, drawn live. Every change is a new version; this clip follows it.</p>
		<fieldset disabled={ro}>
			<label>Start <input type="number" step="0.05" min="0" value={sel.start.toFixed(2)} onchange={(e) => s.setClip({ start: Math.max(0, Number(e.currentTarget.value)) })} /> s</label>
			<label>Length <input type="number" step="0.05" min="0.2" value={sel.dur.toFixed(2)} onchange={(e) => s.setClip({ dur: Math.max(0.2, Math.min(spec.seconds - sel.in, Number(e.currentTarget.value))) })} /> s</label>
			<label>From <input type="number" step="0.05" min="0" value={sel.in.toFixed(2)} onchange={(e) => s.setClip({ in: Math.max(0, Math.min(spec.seconds - 0.2, Number(e.currentTarget.value))) })} /> s in</label>

			<h3>Camera</h3>
			<div class="row">
				<button class="ghost small rec" class:on={s.world.recording} onclick={() => sel && s.record(sel)} disabled={s.world.state !== 'ready'} title={s.world.state === 'ready' ? 'Fly the camera by hand while the timeline plays from this clip' : 'Needs the live world (film mode)'}>
					{s.world.recording ? '■ Stop recording' : '● Record a move'}
				</button>
				{#if spec.camera.kind !== 'keys'}
					<button class="ghost small" disabled={!hasShotJs()} title={hasShotJs() ? 'Turn the preset move into keys, one a second' : 'Needs game/film/shot.js (stream B)'} onclick={() => edit((sp) => (sp.camera = { kind: 'keys', curve: sp.camera.curve ?? 'glide', keys: toKeys(sp) ?? [] }))}>Preset → keys</button>
				{/if}
			</div>
			<label>Move <select value={spec.camera.curve ?? 'glide'} onchange={(e) => edit((sp) => (sp.camera.curve = /** @type {'glide'} */ (e.currentTarget.value)))}>{#each ['glide', 'ease', 'landing', 'drift'] as c (c)}<option>{c}</option>{/each}</select></label>
			<label>Lens <input type="number" step="1" min="5" max="150" value={spec.lens.fov} onchange={(e) => edit((sp) => (sp.lens.fov = num(e.currentTarget.value, 50)))} /> ° → <input type="number" step="1" min="5" max="150" value={spec.lens.fovTo ?? ''} placeholder="–" onchange={(e) => edit((sp) => (e.currentTarget.value ? (sp.lens.fovTo = num(e.currentTarget.value, 50)) : delete sp.lens.fovTo))} /></label>
			{#if spec.camera.kind === 'keys'}
				<p class="sub">{spec.camera.keys?.length ?? 0} keys · double-click the Camera lane to add one; drag a key to move it.</p>
				{#if key && s.selectedKey !== null}
					{@const i = s.selectedKey}
					<div class="key">
						<b>Key {i + 1}</b>
						<label>At <input type="number" step="0.05" value={fmt(key.t)} onchange={(e) => edit((sp) => (sp.camera.keys[i].t = num(e.currentTarget.value)))} /> s</label>
						<label class="xyz">Position {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" value={fmt(key.position[a], 1)} onchange={(e) => edit((sp) => (sp.camera.keys[i].position[a] = num(e.currentTarget.value)))} />{/each}</label>
						{#if key.aim}
							<label class="xyz">Aim {#each [0, 1, 2] as a (a)}<input type="number" step="0.5" value={fmt(key.aim[a], 1)} onchange={(e) => edit((sp) => { const aim = sp.camera.keys[i].aim; if (aim) aim[a] = num(e.currentTarget.value); })} />{/each}</label>
						{:else}
							<label>Yaw <input type="number" step="0.01" value={fmt(key.yaw)} onchange={(e) => edit((sp) => (sp.camera.keys[i].yaw = num(e.currentTarget.value)))} /> Pitch <input type="number" step="0.01" value={fmt(key.pitch)} onchange={(e) => edit((sp) => (sp.camera.keys[i].pitch = num(e.currentTarget.value)))} /></label>
						{/if}
						<label>Lens <input type="number" step="1" value={fmt(key.fov, 0)} onchange={(e) => edit((sp) => (sp.camera.keys[i].fov = num(e.currentTarget.value, 50)))} /> °</label>
						<button class="ghost small danger" onclick={() => (edit((sp) => sp.camera.keys.splice(i, 1)), (s.selectedKey = null))}>Delete key</button>
					</div>
				{/if}
			{/if}

			<h3>Hour</h3>
			<label>From <input type="number" step="0.25" min="0" max="24" value={spec.time.hour} onchange={(e) => edit((sp) => (sp.time.hour = num(e.currentTarget.value, 12)))} /> h to <input type="number" step="0.25" min="0" max="24" value={spec.time.hourTo ?? ''} placeholder="–" onchange={(e) => edit((sp) => (e.currentTarget.value ? (sp.time.hourTo = num(e.currentTarget.value, 12)) : delete sp.time.hourTo))} /> h</label>

			<h3>Exposure</h3>
			<label>Meter <select value={spec.exposure.meter} onchange={(e) => edit((sp) => (sp.exposure.meter = /** @type {'lock'} */ (e.currentTarget.value)))}><option value="lock">lock (metered once)</option><option value="ramp">ramp (follows the light)</option><option value="fixed">fixed EV</option></select></label>
			{#if Array.isArray(spec.exposure.stops)}
				<p class="sub">Offset: a curve of {spec.exposure.stops.length} keys (set in the shot record)</p>
			{:else}
				<label>Offset <input type="number" step="0.1" value={spec.exposure.stops} onchange={(e) => edit((sp) => (sp.exposure.stops = num(e.currentTarget.value)))} /> stops</label>
			{/if}

			<h3>Lights</h3>
			{#each spec.lights as l, i (i)}
				<label class="light">
					<select class="lid" value={l.id} onchange={(e) => edit((sp) => (sp.lights[i].id = /** @type {typeof l.id} */ (e.currentTarget.value)))} aria-label="Light">
						{#each SHOT_LIGHTS as id (id)}<option value={id}>{id}</option>{/each}
					</select>
					{#if Array.isArray(l.intensity)}<span class="sub">curve ({l.intensity.length} points)</span>{:else}<input type="number" step="0.05" min="0" value={l.intensity ?? 1} onchange={(e) => edit((sp) => (sp.lights[i].intensity = num(e.currentTarget.value, 1)))} aria-label="Intensity" />{/if}
					<input type="color" value={l.color ?? '#ffd9a0'} onchange={(e) => edit((sp) => (sp.lights[i].color = e.currentTarget.value))} aria-label="Colour" />
					<button class="x" onclick={() => edit((sp) => sp.lights.splice(i, 1))} aria-label="Remove the light">×</button>
				</label>
			{/each}
			{#if spec.lights.length < SHOT_LIGHTS.length}
				<button class="ghost small" onclick={() => edit((sp) => sp.lights.push({ id: SHOT_LIGHTS.find((id) => !sp.lights.some((x) => x.id === id)) ?? 'lamps', intensity: 1 }))}>+ Light</button>
			{/if}

			<h3>Cues</h3>
			{#each spec.cues as q, i (i)}
				<label class="light">
					<input type="number" step="0.05" value={fmt(q.at)} onchange={(e) => edit((sp) => (sp.cues[i].at = num(e.currentTarget.value)))} aria-label="At (s)" />
					{#if q.kind === 'sound'}
						<span class="cue">♪ {s.byCid.get(q.cid)?.title || q.cid.slice(0, 8)}</span>
						<input type="number" step="0.05" min="0" max="1" value={q.level} onchange={(e) => edit((sp) => (/** @type {{ level: number }} */ (sp.cues[i]).level = num(e.currentTarget.value, 1)))} aria-label="Level" />
					{:else}
						<input class="lid" value={q.name} pattern="[a-z][a-z0-9-]*" onchange={(e) => edit((sp) => (/** @type {{ name: string }} */ (sp.cues[i]).name = e.currentTarget.value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '') || 'event'))} aria-label="Event" />
					{/if}
					<button class="x" onclick={() => edit((sp) => sp.cues.splice(i, 1))} aria-label="Remove the cue">×</button>
				</label>
			{/each}
			<div class="row">
				<select bind:value={cueSound} aria-label="Sound for a new cue">
					<option value="">a sound…</option>
					{#each sounds as a (a.cid)}<option value={a.cid}>{a.title || a.cid.slice(0, 10)}</option>{/each}
				</select>
				<button class="ghost small" disabled={!cueSound} onclick={() => edit((sp) => sp.cues.push({ at: Math.max(sel.in, s.shotTime(sel)), kind: 'sound', cid: cueSound, level: 0.8 }))}>+ Sound cue here</button>
				<button class="ghost small" onclick={() => edit((sp) => sp.cues.push({ at: Math.max(sel.in, s.shotTime(sel)), kind: 'event', name: 'event' }))}>+ Event</button>
			</div>
		</fieldset>
		<dl>
			<dt>Shot</dt><dd><code>{sel.shot}</code></dd>
			<dt>Versions</dt>
			<dd class="vers">
				{#each Array.from({ length: Math.max(sel.shotVersion ?? 1, shot?.version ?? 1) }, (_, i) => i + 1) as v (v)}
					<button class="link" class:on={v === sel.shotVersion} disabled={ro} onclick={() => s.useVersion(sel, v)}>v{v}</button>
				{/each}
			</dd>
			{#if spec.look}<dt>Lit for</dt><dd>{spec.look} (a suggestion for Grade)</dd>{/if}
		</dl>
		{#if !ro}<button class="ghost danger" onclick={() => s.remove(sel.id)}>Remove clip</button>{/if}
	{:else if sel}
		<p class="hint">Loading the shot…</p>
	{:else}
		<p class="hint">Click a clip to see and set it. Drag it to move it, drag its edges to trim it.</p>
	{/if}
</aside>

<style>
	.inspector {
		grid-area: inspector;
		min-height: 0;
		padding: 0.9rem;
		overflow: auto;
		background: var(--panel);
	}

	h2 {
		margin: 0 0 0.6rem;
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--dim);
	}

	h3 {
		margin: 0.8rem 0 0.2rem;
		font-family: var(--font-body);
		padding-top: 0.5rem;
		border-top: 1px solid var(--edge);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim);
	}

	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
	}

	.iname {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin: 0 0 0.3rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.ver {
		font-weight: 400;
		font-size: 0.72rem;
		color: #4a5f93;
	}

	.sub,
	.hint {
		margin: 0.2rem 0;
		font-size: 0.72rem;
		color: var(--dim);
	}

	.line {
		margin: 0 0 0.7rem;
		font-family: var(--font-display);
		line-height: 1.4;
	}

	label {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		margin: 0.3rem 0;
		font-size: 0.76rem;
		color: var(--dim);
	}

	input[type='number'],
	select,
	.lid {
		width: 4.4rem;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--edge);
		border-radius: 5px;
		background: #fff;
		font: inherit;
		color: var(--ink);
	}

	select {
		width: auto;
		max-width: 11rem;
	}

	.xyz input {
		width: 3.3rem;
	}

	.lid {
		width: 5.2rem;
	}

	input[type='color'] {
		width: 1.6rem;
		height: 1.4rem;
		padding: 0;
		border: 1px solid var(--edge);
		border-radius: 4px;
	}

	.vol input {
		flex: 1;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
		margin: 0.3rem 0;
	}

	.key {
		margin: 0.4rem 0;
		padding: 0.4rem 0.5rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
	}

	.key b {
		font-size: 0.72rem;
	}

	.rec.on {
		border-color: #e5483d;
		background: #e5483d;
		color: #fff;
	}

	.cue {
		overflow: hidden;
		max-width: 6rem;
		font-size: 0.7rem;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: #4a5f93;
	}

	.x {
		padding: 0 0.3rem;
		border: 0;
		background: none;
		font-size: 1rem;
		color: var(--dim);
		cursor: pointer;
	}

	dl {
		display: grid;
		gap: 0.15rem;
		margin: 0.6rem 0 0;
	}

	dt {
		margin-top: 0.35rem;
		font-size: 0.7rem;
		color: var(--dim);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	dd code {
		font-size: 0.68rem;
		color: var(--dim);
	}

	.vers {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.link {
		padding: 0 0.3rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: none;
		font: inherit;
		font-size: 0.74rem;
		color: var(--accent);
		cursor: pointer;
	}

	.link.on {
		border-color: var(--accent);
	}
</style>
