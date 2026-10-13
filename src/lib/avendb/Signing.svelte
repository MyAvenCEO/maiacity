<!--
	Signing in, setting up or unlocking, as a sheet that slides up from the bottom of the page while the person waits:
	every step of the device's start as it happens ($lib/avendb/steps.js), the passkey's prompts among them, each with
	the seconds it took or, under way, has taken so far, and the whole start's time. A prompt waiting on the person
	says so. It stays open on a failure, with what went wrong, until they close it.
-->
<script>
	import { fade, fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import { seconds } from './steps.js';

	/**
	 * @type {{ title: string, asks: string, rows: import('./steps.js').Row[], total: number, over: boolean,
	 *  error: string, onclose: () => void }}
	 */
	let { title, asks, rows, total, over, error, onclose } = $props();

	const done = $derived(over && !error);
	const waiting = $derived(rows.find((r) => r.state === 'now'));
	const status = $derived(
		done
			? 'All done'
			: error
				? 'It stopped'
				: waiting?.prompt
					? 'Waiting for your passkey'
					: waiting
						? `${waiting.title}…`
						: asks
	);
</script>

<!-- the scrim closes the sheet once the start is over, as its button does -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" transition:fade={{ duration: 180 }} onclick={() => over && onclose()}></div>
<div
	class="signing"
	role="dialog"
	aria-modal="true"
	aria-labelledby="signing-title"
	transition:fly={{ y: 640, duration: 280, opacity: 1 }}
>
	<div class="grip" aria-hidden="true"></div>
	<header>
		<div>
			<h2 id="signing-title">{title}</h2>
			<p class="soft" aria-live="polite">{status}</p>
		</div>
		<span class="total" class:done class:bad={!!error}>{seconds(total)}</span>
	</header>

	<ol class="steps">
		{#each rows as r, i (r.step)}
			<li class={r.state} class:prompt={r.prompt}>
				<span class="mark" aria-hidden="true">
					{#if r.state === 'done'}<Icon name="check" size={14} />
					{:else if r.state === 'failed'}<Icon name="close" size={14} />
					{:else if r.prompt}<Icon name="key" size={14} />
					{:else if r.state === 'now'}<span class="spin"></span>
					{:else}{i + 1}{/if}
				</span>
				<span class="what">
					<b>{r.title}</b>
					<small>{r.does}</small>
				</span>
				<span class="time">
					{#if r.state === 'now' && r.prompt}<span class="you">Your turn</span>{/if}
					{r.state === 'next' ? '' : seconds(r.ms)}
				</span>
			</li>
		{/each}
	</ol>

	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if over}
		<div class="row">
			<button class="btn primary" onclick={onclose}>{error ? 'Close' : 'Done'}</button>
		</div>
	{/if}
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: rgb(20 28 24 / 0.32);
	}

	/* it rises from the foot of the page to just above the app's nav pill, which stays over everything in the page */
	.signing {
		position: fixed;
		left: 50%;
		bottom: var(--nav-room, 0.5rem);
		z-index: 71;
		box-sizing: border-box;
		width: min(36rem, calc(100% - 1rem));
		max-height: min(42rem, calc(100vh - var(--nav-room, 0.5rem) - 1rem));
		overflow-y: auto;
		transform: translateX(-50%);
		padding: 0.6rem 1.2rem 1.2rem;
		border-radius: 1.1rem;
		background: var(--card, #fff);
		box-shadow: 0 -12px 40px rgb(0 0 0 / 0.18);
	}

	.grip {
		width: 2.6rem;
		height: 0.28rem;
		margin: 0 auto 0.8rem;
		border-radius: 999px;
		background: var(--edge);
	}

	header {
		display: flex;
		gap: 1rem;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 0.8rem;
	}

	h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	header p {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
	}

	.soft {
		color: var(--soft);
	}

	.total {
		flex: none;
		padding: 0.2rem 0.6rem;
		border-radius: 999px;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		background: color-mix(in srgb, var(--accent) 12%, transparent);
		color: var(--accent);
	}

	.total.done {
		background: color-mix(in srgb, var(--ok) 14%, transparent);
		color: var(--ok);
	}

	.total.bad {
		background: color-mix(in srgb, var(--bad) 14%, transparent);
		color: var(--bad);
	}

	.steps {
		display: grid;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.steps li {
		display: grid;
		grid-template-columns: 1.6rem 1fr auto;
		gap: 0.7rem;
		align-items: start;
		padding: 0.5rem 0.55rem;
		border-radius: 0.6rem;
		transition: background 0.2s;
	}

	.steps li.next {
		opacity: 0.45;
	}

	.steps li.now {
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}

	.steps li.now.prompt {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}

	.steps li.failed {
		background: color-mix(in srgb, var(--bad) 10%, transparent);
	}

	.mark {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		font-size: 0.72rem;
		background: color-mix(in srgb, var(--soft) 10%, transparent);
		color: var(--soft);
	}

	.done .mark {
		background: color-mix(in srgb, var(--ok) 16%, transparent);
		color: var(--ok);
	}

	.now .mark,
	.prompt .mark {
		background: color-mix(in srgb, var(--accent) 18%, transparent);
		color: var(--accent);
	}

	.failed .mark {
		background: color-mix(in srgb, var(--bad) 18%, transparent);
		color: var(--bad);
	}

	.now.prompt .mark {
		animation: pulse 1.2s ease-in-out infinite;
	}

	.spin {
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.what b {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
	}

	.what small {
		display: block;
		margin-top: 0.1rem;
		font-size: 0.78rem;
		line-height: 1.35;
		color: var(--soft);
	}

	.time {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		padding-top: 0.1rem;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--soft);
		white-space: nowrap;
	}

	.now .time {
		color: var(--accent);
	}

	.you {
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.error {
		margin: 0.8rem 0 0;
		padding: 0.6rem 0.75rem;
		border-radius: 0.6rem;
		font-size: 0.85rem;
		line-height: 1.4;
		background: color-mix(in srgb, var(--bad) 10%, transparent);
		color: var(--bad);
	}

	.row {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.9rem;
	}

	@keyframes spin {
		to {
			transform: rotate(1turn);
		}
	}

	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 0.35rem color-mix(in srgb, var(--accent) 16%, transparent);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin,
		.now.prompt .mark {
			animation: none;
		}
	}
</style>
