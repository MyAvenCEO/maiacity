<!--
	The second seed. Day 01 says the first step is taken alone and the second is
	somebody else saying yes — this is where that happens. Invite only (Samuel
	2026-10-18): once the city has its admin, an invite link from one of its
	super admins is the only way to sign up, used once. Signing up
	makes the passkey; the app then founds the person's human vault with it in
	avenDB, its profile named as they say here ($lib/app/entry.js): the name
	lives there, nowhere else. After its `#` the link holds a share of one of
	Maia City's cap groups, Traveler or Citizen, and the key that claims it
	(Samuel 2026-10-19): kept in this tab until the person's vault claims it in
	the app, the newcomer's as it is founded, a founder's from before as they
	open it. That share is what opens the sandboxes, worlds and games to them.

	Everything here runs in the browser. The page itself is prerendered like the
	rest of the journal; only the passkey ceremony and the four API calls need a
	server, and none of them run until someone acts.
-->
<script lang="ts">
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { remember } from '$lib/app/session';
	import { founderCount, inviteOpen, me, passkeysAvailable, signOut, signUp, type Founder } from '$lib/auth/client';
	import { invitedWith, signingUp } from '$lib/app/entry.js';

	let founder = $state<Founder | null>(null);
	let count = $state<{ count: number; step: number } | null>(null);
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let ready = $state(false);
	let supported = $state(true);
	/** the invite this link brings, and whether it may still sign one person up */
	let invite = $state('');
	let invited = $state(false);
	/** whether the link brings a share of Maia City's, which the app claims for the person's vault */
	let brings = $state(false);
	/** the first person runs the city and needs no invite; everyone after them does */
	const open = $derived(count?.count === 0 || invited);

	onMount(async () => {
		supported = passkeysAvailable();
		// the share the invite gives, and its key: kept for the app, the key never sent anywhere from here; the share's
		// id is the invite the API signs up on, as avenDB's server says it is open (an older link brings a code of the
		// API's, ?invite=)
		const brought = new URLSearchParams(location.hash.slice(1));
		brings = !!brought.get('share') && !!brought.get('key');
		if (brings) invitedWith(brought.get('share') ?? '', brought.get('key') ?? '');
		invite = new URLSearchParams(location.search).get('invite') || (brings ? (brought.get('share') ?? '') : '');
		// Best-effort, all of them: a signed-out visitor and an API that is
		// briefly down should see the page, not an error.
		const counted = founderCount()
			.then((c) => (count = c))
			.catch(() => {});
		const checked = invite ? inviteOpen(invite).then((ok) => (invited = ok), () => {}) : null;
		founder = await me().catch(() => null);
		await Promise.all([counted, checked]);
		ready = true;
	});

	async function act(run: () => Promise<Founder>) {
		busy = true;
		error = '';
		try {
			founder = await run();
			remember(true);
			// signed up: on into the city's own rooms, where the passkey founds their human vault, named as they said
			signingUp(name);
			return void (await goto(`${base}/app/`));
		} catch (e) {
			// A cancelled passkey prompt is not a failure worth shouting about.
			const message = (e as Error).message ?? '';
			error = /NotAllowed|abort/i.test(message) ? '' : message;
		} finally {
			busy = false;
		}
	}

	async function leave() {
		await signOut();
		remember(false);
		founder = null;
	}
</script>

<svelte:head>
	<title>Become a Maia Citizen · Maia City</title>
	<meta
		name="description"
		content="Build a post-labour economy together in Maia City, a shared digital-twin game shaped by its citizens. Invite only. Planned citizenship subscription: €1 a day."
	/>
</svelte:head>

<main class="wrap">
	<article>
		{#if founder}
			<p class="eyebrow">Founder {String(founder.number).padStart(3, '0')}</p>
			<h1>You are in the line.</h1>
			<p class="lede">
				Your name lives in your human vault in avenDB, which only you hold: change it there, in
				its About page. Nothing about you is stored anywhere else.
			</p>

			{#if brings}<p class="lede">This link brings an invite to Maia City: your human vault takes it as your dashboard opens.</p>{/if}

			<p class="already"><a class="pill-btn" href="{base}/app/">{brings ? 'Take the invite →' : 'Open your dashboard →'}</a></p>

			<button class="quiet" onclick={leave}>Sign out on this device</button>
		{:else}
			<div class="product-hero">
				<div>
					<p class="eyebrow">A shared world. An economy we build together.</p>
					<h1>Build the world<br />after work.</h1>
					<p class="lede">Become a Maia Citizen. Step into a digital-twin game where we build and test a post-labour, post-AGI economy — together.</p>
					<p class="hero-note">Start with a tent, a shared pickup and a handful of citizens. Help decide what comes next.</p>
					<a class="pill-btn" href="#citizenship">Explore citizenship <span aria-hidden="true">↗</span></a>
					<span class="invite-badge">Early build · invite only</span>
				</div>
				<figure class="world-preview">
					<img src="{base}/maiacity-v2/cover.jpg" alt="The first Maia City settlement in the game" />
					<figcaption><span>MAIA CITY / THE BEGINNING</span><strong>A little world.<br />A very big question.</strong><span>How do we live when work no longer defines us?</span></figcaption>
				</figure>
			</div>

			<section class="possibilities" aria-label="What we explore together">
				<div><span class="number">01 / ECONOMY</span><h2>Try a different set of rules.</h2><p>Explore monetary policies, shared resources and COOPs. Propose changes. See what happens to the world we share.</p></div>
				<div><span class="number">02 / EVERYDAY LIFE</span><h2>Make the city work.</h2><p>Homes, energy, water, transport and logistics. Help turn big ideas about life after labour into systems we can play with and test.</p></div>
				<div><span class="number">03 / CO-CREATION</span><h2>Build the game as we go.</h2><p>The gameplay grows with us. Citizen by citizen, we shape new mechanics, ways to organize and things worth building.</p></div>
			</section>

			<section class="citizenship" id="citizenship" aria-labelledby="citizenship-title">
				<div class="offer">
					<p class="eyebrow">Your place in the experiment</p>
					<h2 id="citizenship-title">Virtual citizenship.<br />Real participation.</h2>
					<p>Bring your curiosity, your skills and your ideas. Play the early world, help test its rules and co-create what it becomes.</p>
					<p class="price"><strong>€1</strong><span>/ day<br /><small>planned subscription</small></span></p>
					<p class="offer-note">The planned subscription supports the ongoing build. Payments are not open yet. Joining with an invitation does not start a subscription or charge you.</p>
				</div>
				<div class="invitation">
					<p class="eyebrow">We grow one citizen at a time</p>
					<h3>{invited ? 'Your invitation is here.' : 'A small beginning. Come build with us.'}</h3>
					<p>Maia City is currently invite only. An invitation from an admin opens your place in the game.</p>

			{#if ready && !open}
				<p class="note">
					maiaCITY is invite only: {invite
						? 'this invite link is used up or expired. Ask for a new one.'
						: 'have an invitation? Open your personal invite link to begin.'}
				</p>
				<p class="already">
					Already a founder?
					<a class="quiet" href="{base}/app/">Sign in</a>
				</p>
			{:else if !supported}
				<p class="note bad">
					This browser cannot create a passkey. Try a current Safari, Chrome or Firefox — on a
					phone it usually just works.
				</p>
			{:else if ready}
				<form
					onsubmit={(e) => {
						e.preventDefault();
						act(() => signUp(name, invite));
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
						{busy ? 'One moment…' : 'Become a Maia Citizen →'}
					</button>
				</form>

				{#if error}<p class="note bad">{error}</p>{/if}

				<p class="fine">
					No password, no email address. Your device makes a passkey and that is the whole
					account: it opens your human vault in avenDB too, where your name lives — which also
					means that if you lose every device you have, the account goes with them.
				</p>

				<p class="already">
					Already a founder?
					<a class="quiet" href="{base}/app/">Sign in</a>
				</p>
			{/if}
				</div>
			</section>
			<section class="mission">
				<p class="eyebrow">First in game. Then in real.</p>
				<h2>One million founders.<br />One city. Sixteen years.</h2>
				<p>That is the ambition. Today, we are building the game and learning together. Virtual citizenship means joining this shared experiment; the real-world city is the long-term vision.</p>
				<p class="maia-note">I’m avenMAIA. I’m learning to build this city with Samuel, Daniel — and the citizens who join us next.</p>
			</section>
		{/if}

		{#if ready && count}
			<!-- The ladder from Day 01, made literal. -->
			<aside class="ladder">
				<span class="n">{count.count}</span>
				<span class="label">
					{count.count === 1 ? 'citizen' : 'citizens'} · the world grows with every one
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
		max-width: 70rem;
		margin: 0 auto;
	}

	h1 {
		margin: 0.75rem 0 0;
		font-size: clamp(2.8rem, 5.8vw, 5rem);
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

	#terminal {
		margin-top: 1rem;
	}

	.product-hero { display:grid; grid-template-columns:1.12fr 1fr; gap:3rem; align-items:center; }
	.product-hero .eyebrow { font-size:.68rem; letter-spacing:.15em; }
	.product-hero .lede { max-width:34rem; margin:1.25rem 0 .8rem; font-size:1.13rem; }
	.hero-note { color:var(--ink-soft); margin:0 0 1.7rem; max-width:29rem; }
	.invite-badge { display:block; margin-top:.8rem; color:var(--ink-soft); font-size:.75rem; }
	.world-preview { position:relative; min-height:26rem; margin:0; border-radius:1.8rem; overflow:hidden; background:#243a2b; color:#fff8e8; }
	.world-preview img { position:absolute; width:100%; height:100%; object-fit:cover; }
	.world-preview::after { content:''; position:absolute; inset:0; background:linear-gradient(transparent 20%,rgb(17 38 28 / .9)); }
	.world-preview figcaption { position:absolute; z-index:1; bottom:2rem; left:2rem; right:2rem; display:grid; gap:.8rem; }
	.world-preview figcaption span:first-child { font-size:.65rem; letter-spacing:.16em; }
	.world-preview figcaption strong { font-family:var(--font-display, Georgia, serif); font-size:2.25rem; font-weight:400; line-height:1.05; }
	.world-preview figcaption span:last-child { font-size:.8rem; max-width:20rem; }
	.possibilities { display:grid; grid-template-columns:repeat(3,1fr); gap:2rem; margin:3.25rem 0; padding:2rem 0; border-block:1px solid var(--line, #d8d1bf); }
	.number { font-size:.65rem; letter-spacing:.12em; color:var(--ink-soft); }
	.possibilities h2 { font-size:1.5rem; line-height:1.1; margin:.85rem 0; }
	.possibilities p { font-size:.92rem; line-height:1.6; color:var(--ink-soft); margin:0; }
	.citizenship { scroll-margin-top:6rem; display:grid; grid-template-columns:1fr 1fr; background:#243a2b; color:#f6f0e4; border-radius:1.8rem; overflow:hidden; }
	.offer, .invitation { padding:2.3rem; }
	.offer { border-right:1px solid #ffffff25; }
	.citizenship .eyebrow { color:#dec18b; font-size:.65rem; }
	.citizenship h2 { margin:.7rem 0 1rem; font-size:2.3rem; line-height:1.08; }
	.citizenship h3 { margin:.7rem 0 1rem; font-size:1.8rem; line-height:1.1; }
	.citizenship p { line-height:1.55; }
	.citizenship .price { display:flex; gap:.8rem; align-items:center; margin:1.5rem 0 1rem; }
	.price strong { font-size:4.6rem; font-family:var(--font-display, Georgia, serif); font-weight:400; line-height:1; }
	.price small { font-size:.7rem; color:#d7cdb9; }
	.citizenship .offer-note { font-size:.76rem; color:#d7cdb9; max-width:28rem; }
	.citizenship .already, .citizenship .fine, .citizenship .note { color:#e4dbca; }
	.citizenship a { color:#f4c99e; }
	.citizenship form { color:var(--ink, #243a2b); }
	.mission { padding:3rem 0 0; max-width:42rem; }
	.mission h2 { font-size:2.2rem; line-height:1.1; margin:.8rem 0; }
	.mission p { color:var(--ink-soft); line-height:1.6; }
	.mission .maia-note { font-size:.85rem; }
	@media(max-width:720px) {
		main { padding-block:2rem 3rem; }
		.product-hero,.citizenship { grid-template-columns:1fr; gap:0; }
		.product-hero { gap:2rem; }
		.world-preview { min-height:20rem; }
		.possibilities { grid-template-columns:1fr; gap:1.6rem; margin:2rem 0; }
		.offer,.invitation { padding:1.6rem; }
		.offer { border-right:0; border-bottom:1px solid #ffffff25; }
	}
</style>
