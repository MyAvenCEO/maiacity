<!--
	A drawer on the right, over a dimmed screen, as a database studio opens a row: its title, a button and Escape to
	close it, and what it holds, scrolled on its own.
-->
<script>
	/** @type {{ title: string, sub?: string, onclose: () => void, children: import('svelte').Snippet }} */
	let { title, sub = '', onclose, children } = $props();

	/** @param {HTMLButtonElement} el */
	const focus = (el) => el.focus();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="scrim" aria-hidden="true" onclick={onclose}></div>
<div class="panel" role="dialog" aria-modal="true" aria-label={title}>
	<header>
		<div>
			<h3>{title}</h3>
			{#if sub}<small class="soft mono">{sub}</small>{/if}
		</div>
		<button class="btn quiet close" aria-label="Close" use:focus onclick={onclose}>✕</button>
	</header>
	<div class="content">{@render children()}</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 59;
		background: rgb(20 26 22 / 0.28);
	}

	.panel {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		width: min(34rem, 100vw);
		box-sizing: border-box;
		background: #fbfaf7;
		box-shadow: -10px 0 40px rgb(0 0 0 / 0.18);
	}

	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.1rem 0.8rem;
		border-bottom: 1px solid var(--edge);
	}

	h3 {
		margin: 0 0 0.15rem;
		overflow-wrap: anywhere;
	}

	.close {
		font-size: 1rem;
	}

	.content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 1rem 1.1rem 3rem;
	}
</style>
