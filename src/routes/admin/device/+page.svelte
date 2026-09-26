<!--
	A terminal asks to act for the admin — `bun media login` opens this page with its code. The admin sees
	what it asks for and says yes with their passkey session; the terminal then receives a key that can do
	exactly that, and nothing else.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { approveDevice, deviceRequest, me, type DeviceRequest } from '$lib/auth/client';
	import AdminNav from '$lib/admin/AdminNav.svelte';

	let phase = $state<'loading' | 'signed-out' | 'ask' | 'approved' | 'error'>('loading');
	let request = $state<DeviceRequest | null>(null);
	let error = $state('');
	let busy = $state(false);
	const code = $derived((page.url.searchParams.get('code') ?? '').toUpperCase());

	onMount(async () => {
		try {
			await me();
		} catch {
			return void (phase = 'signed-out');
		}
		try {
			request = await deviceRequest(code);
			phase = request.approved_at ? 'approved' : 'ask';
		} catch (e) {
			error = (e as Error).message;
			phase = 'error';
		}
	});

	async function approve() {
		busy = true;
		try {
			await approveDevice(code);
			phase = 'approved';
		} catch (e) {
			error = (e as Error).message;
			phase = 'error';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Sign a terminal in · maiaCITY</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
	<article>
		<AdminNav />
		<h1>Sign a terminal in</h1>

		{#if phase === 'loading'}
			<p class="lede">One moment…</p>
		{:else if phase === 'signed-out'}
			<p class="lede">
				<a href="{base}/join/">Sign in with your passkey</a> first, then open the link from the terminal again.
			</p>
		{:else if phase === 'error'}
			<p class="lede bad">{error}</p>
		{:else if phase === 'approved'}
			<p class="lede">Done. The terminal is signed in — you can close this page.</p>
		{:else if request}
			<p class="lede">
				<strong>{request.label}</strong> asks to act for you. Check that the terminal shows the same code:
			</p>
			<p class="code">{code}</p>
			<p class="asks">It could then:</p>
			<ul>
				{#each request.descriptions as d (d)}<li>{d}</li>{/each}
			</ul>
			<p class="fine">Nothing else. You can revoke it any time with <code>bun media logout</code>.</p>
			<button class="pill-btn" onclick={approve} disabled={busy}>{busy ? 'One moment…' : 'Approve this terminal'}</button>
		{/if}
	</article>
</main>

<style>
	main {
		padding-block: 3rem 6rem;
	}

	article {
		max-width: 34rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0.6rem 0 1.25rem;
		font-size: clamp(2rem, 5vw, 2.8rem);
		line-height: 1.05;
	}

	.lede {
		font-size: 1.05rem;
		line-height: 1.6;
		color: var(--ink-soft);
	}

	.lede a {
		color: var(--terracotta);
	}

	.bad {
		color: #9c3b26;
	}

	.code {
		margin: 1rem 0 1.5rem;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 2rem;
		letter-spacing: 0.12em;
		color: var(--ink);
	}

	.asks {
		margin: 0;
		font-weight: 500;
	}

	ul {
		margin: 0.4rem 0 1rem;
		padding-left: 1.2rem;
		color: var(--ink-soft);
	}

	.fine {
		font-size: 0.85rem;
		color: var(--muted);
	}

	button.pill-btn {
		border: 0;
		cursor: pointer;
		font-family: inherit;
	}

	button.pill-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>
