<!--
	The second seed. Day 01 says the first step is taken alone and the second is
	somebody else saying yes — this is where that happens.

	Everything here runs in the browser. The page itself is prerendered like the
	rest of the journal; only the passkey ceremony and the four API calls need a
	server, and none of them run until someone acts.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		founderCount,
		me,
		passkeysAvailable,
		rename,
		signIn,
		signOut,
		signUp,
		type Founder
	} from '$lib/auth/client';

	let founder = $state<Founder | null>(null);
	let count = $state<{ count: number; step: number } | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let saved = $state(false);
	let ready = $state(false);
	let supported = $state(true);

	onMount(async () => {
		supported = passkeysAvailable();
		// Both are best-effort: a signed-out visitor and an API that is briefly
		// down should see the page, not an error.
		founderCount()
			.then((c) => (count = c))
			.catch(() => {});
		try {
			founder = await me();
			name = founder.name;
		} catch {
			founder = null;
		}
		ready = true;
	});

	async function act(run: () => Promise<Founder>) {
		busy = true;
		error = '';
		try {
			founder = await run();
			name = founder.name;
			count = await founderCount().catch(() => count);
		} catch (e) {
			// A cancelled passkey prompt is not a failure worth shouting about.
			const message = (e as Error).message ?? '';
			error = /NotAllowed|abort/i.test(message) ? '' : message;
		} finally {
			busy = false;
		}
	}

	async function save() {
		busy = true;
		error = '';
		saved = false;
		try {
			founder = await rename(name);
			saved = true;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	async function leave() {
		await signOut();
		founder = null;
		name = '';
	}
</script>

<svelte:head>
	<title>Join · maiaCITY</title>
	<meta
		name="description"
		content="One founder, then two, then we. Claim your place in the line that builds Maia City."
	/>
</svelte:head>

<main class="wrap">
	<article>
		{#if founder}
			<p class="eyebrow">Founder {String(founder.number).padStart(3, '0')}</p>
			<h1>You are in the line.</h1>
			<p class="lede">
				This is the name the city knows you by. Change it whenever you like — nothing else about
				you is stored.
			</p>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					save();
				}}
			>
				<label for="name">Your name</label>
				<input id="name" bind:value={name} maxlength="60" autocomplete="name" />
				<button class="pill-btn" type="submit" disabled={busy || name.trim().length < 2}>
					{busy ? 'Saving…' : 'Save'}
				</button>
			</form>

			{#if saved}<p class="note ok">Saved.</p>{/if}
			{#if error}<p class="note bad">{error}</p>{/if}

			<button class="quiet" onclick={leave}>Sign out on this device</button>
		{:else}
			<p class="eyebrow">Step two</p>
			<h1>The first step was mine. The second one is yours.</h1>
			<p class="lede">
				A city of a million co-founders does not start with a million people. It starts with one
				more. Put your name in and the line grows by one.
			</p>

			{#if !supported}
				<p class="note bad">
					This browser cannot create a passkey. Try a current Safari, Chrome or Firefox — on a
					phone it usually just works.
				</p>
			{:else}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						act(() => signUp(name));
					}}
				>
					<label for="name">What should the city call you?</label>
					<input
						id="name"
						bind:value={name}
						maxlength="60"
						autocomplete="name"
						placeholder="Your name"
					/>
					<button class="pill-btn" type="submit" disabled={busy || name.trim().length < 2}>
						{busy ? 'One moment…' : 'Join as a founder →'}
					</button>
				</form>

				{#if error}<p class="note bad">{error}</p>{/if}

				<p class="fine">
					No password, no email address. Your device makes a passkey and that is the whole
					account — which also means that if you lose every device you have, the account goes
					with them.
				</p>

				<p class="already">
					Already a founder?
					<button class="quiet" disabled={busy} onclick={() => act(signIn)}>Sign in</button>
				</p>
			{/if}
		{/if}

		{#if ready && count}
			<!-- The ladder from Day 01, made literal. -->
			<aside class="ladder">
				<span class="n">{count.count}</span>
				<span class="label">
					{count.count === 1 ? 'founder' : 'founders'} · step {count.step} of thirty-one
				</span>
			</aside>
		{/if}
	</article>
</main>

<style>
	main {
		padding-block: 3.5rem 6rem;
	}

	article {
		max-width: 34rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0.75rem 0 0;
		font-size: clamp(2rem, 5vw, 3rem);
		line-height: 1.05;
	}

	.lede {
		margin: 1.25rem 0 2rem;
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.5rem;
		border-radius: var(--radius);
		background: var(--paper);
	}

	label {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--ink-soft);
	}

	input {
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-radius: 12px;
		background: var(--cream);
		font: inherit;
		color: var(--ink);
	}

	input:focus-visible {
		outline: 2px solid var(--terracotta);
		outline-offset: 1px;
	}

	button.pill-btn {
		align-self: flex-start;
		margin-top: 0.4rem;
		border: 0;
		cursor: pointer;
		font-family: inherit;
	}

	button.pill-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
		transform: none;
	}

	.quiet {
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		font-size: 0.9rem;
		color: var(--terracotta);
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.note {
		margin: 1rem 0 0;
		font-size: 0.9rem;
	}

	.note.ok {
		color: var(--ink-soft);
	}

	.note.bad {
		color: #9c3b26;
	}

	.fine {
		margin: 1.25rem 0 0;
		font-size: 0.85rem;
		line-height: 1.55;
		color: var(--muted);
	}

	.already {
		margin: 2rem 0 0;
		font-size: 0.9rem;
		color: var(--ink-soft);
	}

	.ladder {
		display: flex;
		align-items: baseline;
		gap: 0.7rem;
		margin-top: 3rem;
		padding-top: 1.25rem;
		border-top: 1px solid var(--line);
	}

	.ladder .n {
		font-family: var(--font-display);
		font-size: 2rem;
		color: var(--terracotta);
	}

	.ladder .label {
		font-size: 0.85rem;
		color: var(--muted);
	}
</style>
