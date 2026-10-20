<!--
	What a page that reads the person's avenDB shows until the tab's session is open (./session.svelte.js): while it
	loads, a quiet line; where this browser holds the person's account, locked, the one button that unlocks it with
	their passkey, which lasts the tab for every page; where it holds none, a line and the way to avenDB's own page
	(./Account.svelte), where they set one up or sign in; and why not, where the device couldn't start. Forgetting the
	account here is Settings' alone (Devices). It boots the session itself, so a page may show it alone.
-->
<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { Here, here, session } from './session.svelte.js';
	import { plain } from './vaults.js';

	/** @type {{ why?: string }} what the page opens avenDB for, as the end of a sentence: "to review the AIPs" */
	let { why = '' } = $props();

	/** whether the passkey's ceremony is under way, and why the last one didn't open it */
	let busy = $state(false);
	let failed = $state('');

	onMount(() => session.boot());

	async function unlock() {
		[busy, failed] = [true, ''];
		try {
			await session.unlock();
		} catch (e) {
			failed = plain(/** @type {Error} */ (e).message ?? String(e));
		} finally {
			busy = false;
		}
	}

	const said = $derived(why ? ` ${why}` : '');
</script>

{#if session.phase === 'loading'}
	<p class="quiet" role="status">Opening your avenDB…</p>
{:else if session.phase === 'closed'}
	<article class="unlock">
		<h3>Unlock your avenDB</h3>
		<p>
			Your account is on {here}{session.meta?.name ? `, as ${session.meta.name}` : ''}. Unlock it with your passkey{said}:
			once is enough while this tab is open.
		</p>
		<button class="go" disabled={busy} onclick={unlock}>{busy ? 'Unlocking…' : 'Unlock'}</button>
		{#if failed}<p class="why" role="alert">{failed}</p>{/if}
	</article>
{:else if session.phase === 'new'}
	<article class="unlock">
		<h3>No avenDB account on {here} yet</h3>
		<p>
			{Here} holds no account of yours. Set one up, or sign in with your passkey, on avenDB's page{said ? `, then come back${said}` : ''}.
		</p>
		<a class="go" href="{base}/app/">Set up or sign in</a>
		{#if session.error}<p class="why" role="alert">{session.error}</p>{/if}
	</article>
{:else if session.phase === 'broken'}
	<article class="unlock">
		<h3>avenDB didn't start</h3>
		<p class="why" role="alert">{session.error}</p>
	</article>
{/if}

<style>
	.quiet {
		color: var(--muted);
	}

	.unlock {
		max-width: 34rem;
		padding: 1rem 1.1rem;
		border: 1px solid var(--line);
		border-radius: 14px;
		background: #fff;
	}

	h3 {
		margin: 0 0 0.4rem;
	}

	p {
		margin: 0 0 0.8rem;
		line-height: 1.5;
	}

	.go {
		display: inline-flex;
		align-items: center;
		padding: 0.4rem 0.95rem;
		border: 1px solid var(--brand-green);
		border-radius: 999px;
		background: var(--brand-green);
		color: #f4f1e8;
		font: inherit;
		font-weight: 500;
		text-decoration: none;
		cursor: pointer;
	}

	.go:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.why {
		margin: 0.7rem 0 0;
		color: var(--terracotta);
	}
</style>
