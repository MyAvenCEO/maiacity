<!--
	A picture's colour profile, as a small badge: what the ingest detected (meta.color.profile) or what was set by hand
	(meta.color.override, underlined). A click opens the menu to set it — the proxy is made again from the new one.
-->
<script>
	import { PROFILE_CHOICES, colorOf, profileFor, profileInfo, short } from './color.js';

	/** @type {{ s: import('./studio.svelte.js').Studio, m: import('$lib/auth/client').MediaItem, compact?: boolean }} */
	let { s, m, compact = false } = $props();
	let open = $state(false);
	const p = $derived(profileFor(m));
	const c = $derived(colorOf(m));
	const title = $derived(
		`${profileInfo(p.profile).label}${p.override ? ' — set by hand' : p.guessed ? ' — assumed (not detected yet)' : c?.detectedFrom ? ` — ${c.detectedFrom}` : ''}. Click to change.`
	);
	/** @param {string | null} profile */
	function choose(profile) {
		open = false;
		void s.setOverride(m, profile);
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
		onclick={(e) => (e.stopPropagation(), (open = !open))}>{short(p.profile)}</button
	>
	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="menu" role="menu" tabindex="-1" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()}>
			<p>What this picture is</p>
			{#each PROFILE_CHOICES as k (k)}
				<button role="menuitemradio" aria-checked={p.profile === k} class:on={p.profile === k} onclick={() => choose(k === c?.profile ? null : k)}>
					<b>{short(k)}</b> {profileInfo(k).label}{#if k === c?.profile}<i> · detected</i>{/if}
				</button>
			{/each}
			{#if p.override}<button class="reset" onclick={() => choose(null)}>Back to the detected profile</button>{/if}
		</div>
	{/if}
</span>

<svelte:window onpointerdown={() => (open = false)} />

<style>
	.cb {
		position: relative;
		display: inline-flex;
		flex: none;
	}

	.badge {
		padding: 0 0.3rem;
		border: 1px solid #b9c7bd;
		border-radius: 4px;
		background: #eef4ef;
		font: 600 0.58rem/1.35 ui-monospace, 'SF Mono', Menlo, monospace;
		letter-spacing: 0.02em;
		color: #3c5a45;
		cursor: pointer;
	}

	.badge.log {
		border-color: #c9b58c;
		background: #f7efdc;
		color: #7a5a17;
	}

	.badge.unknown {
		border-color: #d49a8a;
		background: #fbe9e4;
		color: #9c3b26;
	}

	.badge.guessed {
		border-style: dashed;
	}

	.badge.override {
		text-decoration: underline;
	}

	.menu {
		position: absolute;
		top: 1.3rem;
		left: 0;
		z-index: 30;
		display: flex;
		flex-direction: column;
		width: 15rem;
		padding: 0.4rem;
		border: 1px solid var(--edge, #e2dccd);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 10px 30px rgb(38 56 44 / 0.18);
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
		background: #f3e3c1;
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
		color: #9c3b26;
	}
</style>
