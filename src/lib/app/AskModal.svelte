<!--
	What an agent may not do by itself waits for the person here (the Mac app only: vault/app asks.rs). A delete shows
	every file that would go — the ones asked for and the files made of them — with the agent's why; "Delete everywhere"
	removes them from this Mac, every device and the server's storage for good; "Keep them" leaves everything as it is.
	A change of where a story is kept shows each class of its files before and after — a store added fetches them there,
	one left out lets them go there. Deleting economy worlds (Sandbox 7) lists each world with its days and avens.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { command, native } from '$lib/native';
	import { className } from '$lib/studio/vault';

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
	type Rules = Record<'default' | 'original' | 'proxy' | 'delivery', string[]>;
	type AskWorld = { id: string; name: string; config?: string | null; version?: number | null; days: number; alive?: number | null; saved?: string | null };
	type Ask =
		| { id: string; kind: 'delete'; why: string; files: AskFile[]; bytes: number }
		| { id: string; kind: 'worlds'; why: string; worlds: AskWorld[] }
		| { id: string; kind: 'rules'; why: string; story: string; before: Rules; after: Rules };
	const CLASSES = ['original', 'proxy', 'default', 'delivery'] as const;

	let asks = $state<Ask[]>([]);
	let busy = $state(false);
	let error = $state('');
	const ask = $derived(asks[0]);

	const size = (b: number) =>
		b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
	const what = (f: AskFile) => [f.role, className(f.class ?? 'default'), f.kind].filter(Boolean).join(' · ');

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
			{#if ask.kind === 'rules'}
				<h2 id="ask-title">Change where “{ask.story}” is kept?</h2>
				{#if ask.why}<p class="why">“{ask.why}”</p>{/if}
				<ul>
					{#each CLASSES as c (c)}
						{@const added = ask.after[c].filter((s) => !ask.before[c].includes(s))}
						{@const gone = ask.before[c].filter((s) => !ask.after[c].includes(s))}
						<li class="rule">
							<span class="name">{className(c, 2)}</span>
							<span class="stores">
								{#each ask.after[c] as st (st)}<b class:added={added.includes(st)}>{st}</b>{/each}
								{#each gone as st (st)}<s>{st}</s>{/each}
							</span>
						</li>
					{/each}
				</ul>
				<p class="fine">A store added fetches the story's files there (verified as they stream); one taken away lets them go there.</p>
				{#if error}<p class="bad">{error}</p>{/if}
				<div class="actions">
					<button class="keep" disabled={busy} onclick={() => answer(false)}>Keep as it is</button>
					<button class="go" disabled={busy} onclick={() => answer(true)}>Change</button>
				</div>
			{:else if ask.kind === 'worlds'}
				<h2 id="ask-title">Delete {ask.worlds.length} {ask.worlds.length === 1 ? 'world' : 'worlds'} of Sandbox 7?</h2>
				{#if ask.why}<p class="why">“{ask.why}”</p>{/if}
				<ul>
					{#each ask.worlds as w (w.id)}
						<li class="world">
							<span class="name">
								{w.name || 'A world'}
								<small>{w.config ?? 'no config'}{w.version ? ` v${w.version}` : ''} · {w.days} {w.days === 1 ? 'day' : 'days'}{w.alive != null ? ` · ${w.alive} alive` : ''}{w.saved ? '' : ' · history only'}</small>
							</span>
						</li>
					{/each}
				</ul>
				<p class="fine">Their days, trades, decisions and the avens' brains in them go too. This cannot be undone.</p>
				{#if error}<p class="bad">{error}</p>{/if}
				<div class="actions">
					<button class="keep" disabled={busy} onclick={() => answer(false)}>Keep them</button>
					<button class="go" disabled={busy} onclick={() => answer(true)}>Delete</button>
				</div>
			{:else}
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
			{/if}
		</div>
	</div>
{/if}

<style>
	li.world {
		grid-template-columns: 1fr;
	}

	li.rule {
		grid-template-columns: 7rem 1fr;
	}

	.stores {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.stores b,
	.stores s {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 500;
		background: var(--ask-well);
		box-shadow: inset 0 0 0 1px var(--ask-line);
	}

	.stores b.added {
		color: #7fe0c0;
		box-shadow: inset 0 0 0 1px rgb(127 224 192 / 0.5);
	}

	.stores s {
		color: var(--ask-muted);
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgb(2 6 12 / 0.65);
		/* dark marine, as the studio it is shown over — its own values, since it renders outside the studio's root */
		color-scheme: dark;
		--ask-panel: #0b1a2c;
		--ask-well: #07121f;
		--ask-line: rgb(58 110 160 / 0.35);
		--ask-line-soft: rgb(58 110 160 / 0.2);
		--ask-ink: #e6eef7;
		--ask-soft: #b4c4d6;
		--ask-muted: #8ba1b9;
		--ask-bad: #f78f76;
		--ask-go: #c4452d;
	}

	.modal {
		width: min(34rem, 100%);
		max-height: min(80vh, 44rem);
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 1.3rem 1.4rem 1.1rem;
		border-radius: 14px;
		background: var(--ask-panel);
		color: var(--ask-ink);
		box-shadow: 0 0 0 1px var(--ask-line), 0 18px 60px rgb(0 0 0 / 0.6);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display, inherit);
		font-size: 1.3rem;
	}

	.why {
		margin: 0;
		color: var(--ask-soft);
		font-size: 0.9rem;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-y: auto;
		border-top: 1px solid var(--ask-line);
		border-bottom: 1px solid var(--ask-line);
	}

	li {
		display: grid;
		grid-template-columns: 3.4rem 1fr auto;
		align-items: center;
		gap: 0.7rem;
		padding: 0.4rem 0;
	}

	li + li {
		border-top: 1px solid var(--ask-line-soft);
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
		background: var(--ask-well);
	}

	.blank {
		display: grid;
		place-items: center;
		font-size: 0.6rem;
		color: var(--ask-muted);
	}

	.name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 0.85rem;
	}

	small {
		display: block;
		color: var(--ask-muted);
		font-size: 0.72rem;
	}

	.size {
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		color: var(--ask-muted);
	}

	.fine {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ask-muted);
	}

	.bad {
		margin: 0;
		font-size: 0.8rem;
		color: var(--ask-bad);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.6rem;
	}

	button {
		padding: 0.5rem 1rem;
		border-radius: 999px;
		border: 1px solid var(--ask-line);
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	button.go {
		border-color: transparent;
		background: var(--ask-go);
		color: #fff;
	}

	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
