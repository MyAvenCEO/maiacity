<!--
	A picture's colour profile, as a small badge: what the ingest detected (meta.color.profile) or what was set by hand
	(meta.color.override, underlined). A click opens the menu to set it — the API queues the proxy again from the new
	one — or to have the worker make the proxy again as it is.
-->
<script>
	import { remakeProxy } from '$lib/auth/client';
	import { PROFILE_CHOICES, colorOf, isVideo, profileFor, profileInfo, short } from './color.js';

	/** @type {{ s: import('./studio.svelte.js').Studio, m: import('$lib/auth/client').MediaItem, compact?: boolean }} */
	let { s, m, compact = false } = $props();
	let open = $state(false);
	/** where the menu opens: fixed on the page, beside the badge, never cut off by the panel it is in */
	let at = $state({ top: 0, left: 0 });
	/** @param {MouseEvent} e */
	function toggle(e) {
		e.stopPropagation();
		const r = /** @type {HTMLElement} */ (e.currentTarget).getBoundingClientRect();
		at = { top: Math.max(8, Math.min(r.bottom + 4, innerHeight - 380)), left: Math.max(8, Math.min(r.left, innerWidth - 256)) };
		open = !open;
	}
	const p = $derived(profileFor(m));
	const c = $derived(colorOf(m));
	/** the picture seen is its ACEScct proxy (the Edit tab plays proxies): the source's colour → the working space */
	const viaProxy = $derived(isVideo(m) && !!s.proxy(m).hash && p.profile !== 'acescct');
	const title = $derived(
		`The source: ${profileInfo(p.profile).label}${p.override ? ' — set by hand' : p.guessed ? ' — assumed (not detected yet)' : c?.detectedFrom ? ` — ${c.detectedFrom}` : ''}.${viaProxy ? ' Its proxy is ACEScct (the working space) — that is what plays here.' : ''} Click to change.`
	);
	/** @param {string | null} profile */
	function choose(profile) {
		open = false;
		void s.setOverride(m, profile).then(() => s.refreshJobs());
	}
	async function remake() {
		open = false;
		await remakeProxy(m.hash).catch((e) => (s.error = e.message));
		void s.refreshJobs();
	}
</script>

<span class="cb" class:compact>
	<button
		class="badge"
		class:log={profileInfo(p.profile).log}
		class:unknown={p.profile === 'unknown'}
		class:override={p.override}
		class:guessed={p.guessed}
		{title}
		aria-label="Colour: {profileInfo(p.profile).label}"
		aria-expanded={open}
		onpointerdown={(e) => e.stopPropagation()}
		onclick={toggle}>{short(p.profile)}{#if viaProxy && !compact}<i class="via"> → CCT</i>{/if}</button
	>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="menu" role="menu" tabindex="-1" style:top="{at.top}px" style:left="{at.left}px" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>
			<p>What this picture is</p>
			{#each PROFILE_CHOICES as k (k)}
				<button role="menuitemradio" aria-checked={p.profile === k} class:on={p.profile === k} onclick={() => choose(k === c?.profile ? null : k)}>
					<b>{short(k)}</b> {profileInfo(k).label}{#if k === c?.profile}<i> · detected</i>{/if}
				</button>
			{/each}
			{#if p.override}<button class="reset" onclick={() => choose(null)}>Back to the detected profile</button>{/if}
			{#if isVideo(m)}<button class="reset" onclick={remake}>Make its proxy again</button>{/if}
		</div>
	{/if}
</span>

<svelte:window onpointerdown={() => (open = false)} />

<style>
	.via {
		font-style: normal;
		opacity: 0.7;
	}
	.cb {
		position: relative;
		display: inline-flex;
		flex: none;
	}

	.badge {
		padding: 0 0.3rem;
		border: 1px solid var(--ok-line);
		border-radius: 4px;
		background: var(--ok-bg);
		font: 600 0.58rem/1.35 ui-monospace, 'SF Mono', Menlo, monospace;
		letter-spacing: 0.02em;
		color: var(--ok);
		cursor: pointer;
	}

	.badge.log {
		border-color: var(--warn-line);
		background: var(--warn-bg);
		color: var(--warn);
	}

	.badge.unknown {
		border-color: var(--bad-line);
		background: var(--bad-bg);
		color: var(--bad);
	}

	.badge.guessed {
		border-style: dashed;
	}

	.badge.override {
		text-decoration: underline;
	}

	.menu {
		position: fixed;
		z-index: 300;
		max-height: 370px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		width: 15rem;
		padding: 0.4rem;
		border: 1px solid var(--edge, #e2dccd);
		border-radius: 8px;
		background: var(--raised);
		box-shadow: 0 10px 30px rgb(0 0 0 / 0.55);
		font-size: 0.72rem;
	}

	.menu p {
		margin: 0.1rem 0.3rem 0.3rem;
		font-size: 0.64rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--dim, #7b857a);
	}

	.menu button {
		padding: 0.22rem 0.35rem;
		border: 0;
		border-radius: 5px;
		background: none;
		font: inherit;
		text-align: left;
		color: var(--ink, #26382c);
		cursor: pointer;
	}

	.menu button:hover,
	.menu button.on {
		background: var(--chosen);
	}

	.menu b {
		display: inline-block;
		min-width: 3rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.64rem;
	}

	.menu i {
		color: var(--dim, #7b857a);
	}

	.menu .reset {
		margin-top: 0.25rem;
		border-top: 1px solid var(--edge, #e2dccd);
		border-radius: 0;
		color: var(--bad);
	}
</style>
