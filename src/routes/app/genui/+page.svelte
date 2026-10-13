<!--
	Generated UI: mini app views an agent writes on the fly over the MCP (genui_put), drawn here each in its own box
	(game/genui/views.js says what a view is). A declarative view is drawn by our own components with its logic in
	QuickJS; a code view runs in a sandboxed frame with no origin and no network, and only when someone presses Run.
	New and changed views come in as they are written (the page asks every few seconds).
-->
<script>
	// @ts-nocheck — plain JS
	import { onMount } from 'svelte';
	import { apiCall } from '$lib/auth/client';
	import Frame from '$lib/genui/Frame.svelte';
	import Surface from '$lib/genui/Surface.svelte';
	import { check } from '../../../../game/genui/views.js';
	import { EXAMPLES } from '../../../../game/genui/examples.js';

	let views = $state([]);
	let offline = $state('');
	let running = $state({});
	let feed = $state([]);

	const log = (view, kind, text) => (feed = [{ at: new Date(), view: view.title, kind, text }, ...feed].slice(0, 30));

	async function load() {
		try {
			const r = await apiCall('/api/genui');
			// the API keeps only checked views; checked again here, so a view the page cannot draw safely is never drawn
			const next = [];
			for (const v of r.views) {
				try {
					next.push({ ...check(v), version: v.version, via: v.via, updated: v.updated });
				} catch (e) {
					next.push({ id: v.id, title: v.title, broken: e.message, version: v.version });
				}
			}
			const changed = next.length !== views.length || next.some((v, i) => v.id !== views[i]?.id || v.version !== views[i]?.version);
			if (changed) views = next;
			offline = '';
		} catch (e) {
			if (!views.length) views = EXAMPLES.map((v) => ({ ...check(v), version: 1, via: 'example' }));
			offline = e.message || String(e);
		}
	}

	onMount(() => {
		load();
		const t = setInterval(load, 4000);
		return () => clearInterval(t);
	});
</script>

<svelte:head>
	<title>Generated UI · maiaCITY</title>
</svelte:head>

<main class="genui">
	<header>
		<p class="eyebrow">Admin · agents write these over the MCP</p>
		<h1>Generated UI</h1>
		<p class="lede">Mini apps an agent makes on the fly. Each runs in its own box and can't touch this page, your keys or our API.</p>
		{#if offline}<p class="offline">Showing the built-in examples: {offline}</p>{/if}
	</header>

	<details class="boundary">
		<summary>Where the line is</summary>
		<div class="two">
			<div>
				<h3>Declarative <span class="tag decl">our components</span></h3>
				<p>The agent sends JSON from a fixed catalog (like A2UI). Our own components draw it and set every string as text. A button only names an event. Its logic runs in QuickJS: no page, no network, no clock, 8 MB, and a call that runs too long is stopped.</p>
			</div>
			<div>
				<h3>Code <span class="tag code">sandboxed frame</span></h3>
				<p>HTML and JS (like MCP Apps) in an iframe with only <code>allow-scripts</code>, so it has a "null" origin: no cookies, storage, passkeys or API. Its CSP forbids every connection and loads scripts only from pinned library files. It talks to us only by postMessage, and we take only two shapes. It can still busy the CPU, so it runs only when you press Run.</p>
			</div>
		</div>
	</details>

	<div class="views">
		{#each views as v (v.id + ':' + v.version)}
			<article class="view">
				<div class="head">
					<div>
						<h2>{v.title}</h2>
						{#if v.note}<p class="note">{v.note}</p>{/if}
					</div>
					<div class="meta">
						{#if v.kind === 'a2ui'}<span class="tag decl">Declarative</span>{:else if v.kind === 'html'}<span class="tag code">Code{v.spec.libs.length ? ` · ${v.spec.libs.join(', ')}` : ''}</span>{/if}
						<span class="ver">v{v.version}{v.via ? ` · ${v.via}` : ''}</span>
					</div>
				</div>
				{#if v.broken}
					<p class="error">Not drawn: {v.broken}</p>
				{:else if v.kind === 'a2ui'}
					<Surface view={v} onevent={(e) => log(v, 'event', `${e.name}: ${JSON.stringify(e.value)}`)} onerror={(m) => log(v, 'error', m)} />
				{:else if running[v.id]}
					<Frame view={v} onevent={(e) => log(v, 'event', `${e.name}: ${JSON.stringify(e.value)}`)} onerror={(m) => log(v, 'error', m)} />
				{:else}
					<button class="run" style:height="{v.spec.height}px" onclick={() => (running = { ...running, [v.id]: true })}>
						<b>Run</b><span>Generated code, in a sandboxed frame</span>
					</button>
				{/if}
			</article>
		{/each}
	</div>

	<section class="feed">
		<p class="divider">What the views said</p>
		{#if !feed.length}<p class="quiet">Click a dome, a month or a button: each view's events show here, as plain data.</p>{/if}
		{#each feed as f, i (i)}
			<p class="line {f.kind}"><time>{f.at.toLocaleTimeString()}</time> <b>{f.view}</b> {f.text}</p>
		{/each}
	</section>
</main>

<style>
	.genui { max-width: 64rem; margin: 0 auto; padding: 2.5rem clamp(1rem, 4vw, 2rem) 7rem; }
	.eyebrow { margin: 0; font-size: 0.75rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
	h1 { margin: 0.4rem 0 0; font-size: clamp(2.2rem, 5vw, 3.2rem); }
	.lede { margin: 0.6rem 0 0; color: var(--ink-soft); max-width: 40rem; }
	.offline { margin: 0.8rem 0 0; font-size: 0.85rem; color: var(--terracotta); }
	.boundary { margin: 1.6rem 0 0; background: #fff; border: 1px solid var(--line); border-radius: 18px; padding: 0.8rem 1.1rem; }
	.boundary summary { cursor: pointer; font-weight: 600; }
	.two { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; margin-top: 0.6rem; }
	@media (max-width: 640px) { .two { grid-template-columns: 1fr; } }
	.two h3 { margin: 0 0 0.3rem; font-size: 1rem; display: flex; gap: 0.5rem; align-items: center; }
	.two p { margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--ink-soft); }
	.views { display: flex; flex-direction: column; gap: 1.4rem; margin-top: 1.6rem; }
	.view { background: var(--cream); border-radius: var(--radius); padding: 1rem; display: flex; flex-direction: column; gap: 0.8rem; }
	.head { display: flex; justify-content: space-between; gap: 1rem; align-items: start; }
	.head h2 { margin: 0; font-size: 1.3rem; }
	.note { margin: 0.25rem 0 0; color: var(--ink-soft); font-size: 0.9rem; }
	.meta { display: flex; flex-direction: column; align-items: end; gap: 0.3rem; flex-shrink: 0; }
	.tag { font-size: 0.72rem; padding: 0.15rem 0.55rem; border-radius: 99px; font-weight: 600; white-space: nowrap; }
	.tag.decl { background: #dbeadf; color: #2f6f5e; }
	.tag.code { background: #f4e2c4; color: #8a5a12; }
	.ver { font-size: 0.75rem; color: var(--muted); }
	.run { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; border-radius: 14px; background: repeating-linear-gradient(135deg, #fff, #fff 12px, #f6f3eb 12px, #f6f3eb 24px); border: 1px dashed var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.3rem; }
	.run b { font-size: 1.1rem; background: var(--ink); color: #fff; padding: 0.55rem 1.4rem; border-radius: 99px; }
	.run span { font-size: 0.82rem; color: var(--muted); }
	.error { margin: 0; color: var(--terracotta); }
	.divider { display: flex; align-items: center; gap: 0.8rem; margin: 2.4rem 0 0.9rem; font-size: 0.72rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
	.divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--line); }
	.quiet { color: var(--muted); font-size: 0.9rem; }
	.line { margin: 0.2rem 0; font-size: 0.88rem; font-family: ui-monospace, monospace; }
	.line time { color: var(--muted); }
	.line.error { color: var(--terracotta); }
</style>
