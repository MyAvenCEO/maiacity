<!--
	What an agent may not do by itself waits for the person here (the Mac app only: vault/app asks.rs). A delete shows
	every file that would go — the ones asked for and the files made of them — with the agent's why; "Delete everywhere"
	removes them from this Mac, every device and the server's storage for good; "Keep them" leaves everything as it is.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { command, native } from '$lib/native';

	type AskFile = {
		hash: string;
		name: string;
		title?: string;
		kind: string;
		class?: string;
		role?: string | null;
		size: number;
		preview?: string | null;
		part: 'asked' | 'with';
	};
	type Ask = { id: string; kind: 'delete'; why: string; files: AskFile[]; bytes: number };

	let asks = $state<Ask[]>([]);
	let busy = $state(false);
	let error = $state('');
	const ask = $derived(asks[0]);

	const size = (b: number) =>
		b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
	const what = (f: AskFile) => [f.role, f.class, f.kind].filter((x) => x && x !== 'default').join(' · ');

	onMount(() => {
		if (!native()) return;
		const stops: (() => void)[] = [];
		(async () => {
			const { listen } = await import('@tauri-apps/api/event');
			stops.push(await listen<Ask>('vault-ask', ({ payload }) => void (asks = [...asks.filter((a) => a.id !== payload.id), payload])));
			stops.push(await listen<{ id: string }>('vault-ask-gone', ({ payload }) => void (asks = asks.filter((a) => a.id !== payload.id))));
			try {
				asks = await command<Ask[]>('asks_open');
			} catch {
				// not signed in yet: the questions come as events
			}
		})();
		return () => stops.forEach((s) => s());
	});

	async function answer(yes: boolean) {
		if (!ask) return;
		busy = true;
		error = '';
		try {
			await command('ask_answer', { id: ask.id, yes });
			asks = asks.filter((a) => a.id !== ask.id);
		} catch (e) {
			error = String(e);
		} finally {
			busy = false;
		}
	}
</script>

{#if ask}
	<div class="scrim" role="presentation">
		<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="ask-title">
			<h2 id="ask-title">Delete {ask.files.length} {ask.files.length === 1 ? 'file' : 'files'} everywhere?</h2>
			<p class="why">“{ask.why}”</p>
			<ul>
				{#each ask.files as f (f.hash)}
					<li class:with={f.part === 'with'}>
						{#if f.preview}<img src="vault://localhost/{f.preview}" alt="" loading="lazy" />{:else}<span class="blank">{f.kind}</span>{/if}
						<span class="name">
							{f.name}
							<small>{what(f)}{f.part === 'with' ? ' · made of a file above' : ''}</small>
						</span>
						<span class="size">{size(f.size)}</span>
					</li>
				{/each}
			</ul>
			<p class="fine">
				{size(ask.bytes)} in all. Gone from this Mac, every device and the server's storage — this cannot be undone.
				{#if asks.length > 1}<br />{asks.length - 1} more {asks.length === 2 ? 'question waits' : 'questions wait'} after this one.{/if}
			</p>
			{#if error}<p class="bad">{error}</p>{/if}
			<div class="actions">
				<button class="keep" disabled={busy} onclick={() => answer(false)}>Keep them</button>
				<button class="go" disabled={busy} onclick={() => answer(true)}>Delete everywhere</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgb(20 23 26 / 0.45);
	}

	.modal {
		width: min(34rem, 100%);
		max-height: min(80vh, 44rem);
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 1.3rem 1.4rem 1.1rem;
		border-radius: 14px;
		background: var(--cream, #f6f1e6);
		color: var(--ink, #14171a);
		box-shadow: 0 18px 60px rgb(0 0 0 / 0.3);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display, inherit);
		font-size: 1.3rem;
	}

	.why {
		margin: 0;
		color: var(--ink-soft, #3a3f44);
		font-size: 0.9rem;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		border-top: 1px solid rgb(20 23 26 / 0.1);
		border-bottom: 1px solid rgb(20 23 26 / 0.1);
	}

	li {
		display: grid;
		grid-template-columns: 3.4rem 1fr auto;
		align-items: center;
		gap: 0.7rem;
		padding: 0.4rem 0;
	}

	li + li {
		border-top: 1px solid rgb(20 23 26 / 0.06);
	}

	li.with {
		padding-left: 1rem;
		grid-template-columns: 2.4rem 1fr auto;
		opacity: 0.8;
	}

	img,
	.blank {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		border-radius: 4px;
		background: rgb(20 23 26 / 0.08);
	}

	.blank {
		display: grid;
		place-items: center;
		font-size: 0.6rem;
		color: var(--muted, #6b7075);
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 0.85rem;
	}

	small {
		display: block;
		color: var(--muted, #6b7075);
		font-size: 0.72rem;
	}

	.size {
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		color: var(--muted, #6b7075);
	}

	.fine {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted, #6b7075);
	}

	.bad {
		margin: 0;
		font-size: 0.8rem;
		color: var(--terracotta, #b5532f);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: 1px solid rgb(20 23 26 / 0.2);
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	button.go {
		border-color: transparent;
		background: var(--terracotta, #b5532f);
		color: #fff;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
