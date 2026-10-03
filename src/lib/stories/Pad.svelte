<!--
	A Markdown pad: written on the left as plain text, read on the right as the journal sets it (on a phone, one or the
	other). Every change goes to `onchange`; the page saves it a moment after the typing stops. Read only when `locked`
	says why.
-->
<script>
	import { renderMarkdown } from '$lib/admin/markdown';

	/**
	 * @type {{
	 *   value: string,
	 *   onchange: (value: string) => void,
	 *   placeholder?: string,
	 *   locked?: string,
	 *   label: string
	 * }}
	 */
	let { value, onchange, placeholder = '', locked = '', label } = $props();

	/** @type {'write' | 'read'} on a phone, which half shows */
	let half = $state('write');
	const html = $derived(value?.trim() ? renderMarkdown(value) : '');
</script>

<div class="pad" class:locked={!!locked}>
	{#if !locked}
		<div class="halves" role="tablist" aria-label="Write or read">
			<button role="tab" aria-selected={half === 'write'} class:on={half === 'write'} onclick={() => (half = 'write')}>Write</button>
			<button role="tab" aria-selected={half === 'read'} class:on={half === 'read'} onclick={() => (half = 'read')}>Read</button>
		</div>
		<textarea
			class:hidden={half !== 'write'}
			aria-label={label}
			{value}
			{placeholder}
			spellcheck="true"
			oninput={(e) => onchange(/** @type {HTMLTextAreaElement} */ (e.currentTarget).value)}
		></textarea>
	{:else}
		<p class="lock">{locked}</p>
	{/if}
	<div class="read prose" class:hidden={!locked && half !== 'read'}>
		{#if html}{@html html}{:else}<p class="none">Nothing written yet.</p>{/if}
	</div>
</div>

<style>
	.pad {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		grid-template-rows: auto minmax(0, 1fr);
		gap: 0 1.2rem;
		min-height: 60vh;
	}

	.pad.locked {
		grid-template-columns: minmax(0, 46rem);
		justify-content: center;
	}

	.halves {
		display: none;
	}

	textarea {
		box-sizing: border-box;
		width: 100%;
		min-height: 60vh;
		padding: 1rem 1.1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: #fff;
		font: 0.92rem/1.6 ui-monospace, 'SF Mono', Menlo, monospace;
		color: var(--ink);
		resize: vertical;
		field-sizing: content;
	}

	textarea:focus-visible {
		outline: 2px solid var(--mustard);
		outline-offset: 1px;
	}

	.read {
		min-width: 0;
		padding: 0.2rem 0.4rem;
		font-size: 1rem;
		line-height: 1.65;
		overflow-wrap: anywhere;
	}

	.read :global(h1) {
		margin-top: 0;
		font-size: 1.8rem;
	}

	.read :global(h2) {
		margin: 1.8rem 0 0.6rem;
		font-size: 1.35rem;
	}

	.read :global(a) {
		color: inherit;
		text-decoration-color: var(--mustard);
		text-underline-offset: 3px;
	}

	.read :global(figure) {
		margin: 1.5rem 0;
	}

	.read :global(figure img) {
		display: block;
		width: 100%;
		border-radius: var(--radius);
	}

	.read :global(figcaption) {
		margin-top: 0.5rem;
		font-size: 0.85rem;
		color: var(--muted);
		text-align: center;
	}

	.none,
	.lock {
		font-size: 0.88rem;
		color: var(--muted);
	}

	.lock {
		margin: 0 0 1rem;
		padding: 0.6rem 0.9rem;
		border-radius: 10px;
		background: var(--cream);
	}

	@media (min-width: 761px) {
		textarea {
			grid-row: 1 / 3;
		}

		.read {
			grid-row: 1 / 3;
			max-height: none;
		}

		.pad.locked .read {
			grid-row: 2;
		}

		.hidden {
			display: block;
		}
	}

	/* on a phone: one half at a time */
	@media (max-width: 760px) {
		.pad {
			grid-template-columns: minmax(0, 1fr);
		}

		.halves {
			display: flex;
			gap: 0.3rem;
			margin-bottom: 0.6rem;
		}

		.halves button {
			padding: 0.25rem 0.8rem;
			border: 1px solid var(--line);
			border-radius: 999px;
			background: #fff;
			font: inherit;
			font-size: 0.8rem;
			color: var(--muted);
			cursor: pointer;
		}

		.halves button.on {
			border-color: var(--ink);
			background: var(--ink);
			color: var(--paper);
		}

		.hidden {
			display: none;
		}
	}
</style>
