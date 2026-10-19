<!--
	The site's pictures, sounds and films (./sitemedia.js), offered on the Library (./Library.svelte) of the seed's Maia
	City alone, to copy in once from the old media vault (Samuel 2026-10-19, the final move to avenDB): each file the
	homepage, the Maia Universe and the sandboxes show by its hash, named so, tagged `site:media`, which one Public share
	lets everyone read; a file Maia City holds already under that name (an article's picture) only gets the tag, and one
	the old vault keeps private goes in private (./sitemedia-copy.js). Each file's bytes are checked against its hash as
	they come in, so nothing else goes in under its name. The old vault keeps its copies. The same copy runs by itself
	as an owner opens avenDB in the Mac app (./Account.svelte); this is the way to run it by hand, in a browser too.
	What is copied already is left
	out, so it shows only while something is left, and copying again goes on from there. "Not now" hides it in this
	browser for this vault.
-->
<script>
	import { publicShare } from './flows.js';
	import { allowed, creatable, may } from './ops.js';
	import { bringing, marking, SITE } from './sitemedia.js';
	import { copySiteMedia, leftOut, siteLeft } from './sitemedia-copy.js';
	import { count, nameOf, seeded, size, why } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean }} */
	let { world, vault, actor, api, busy } = $props();

	/** whether this is the Maia City COOP of the person's seed: the one vault the copy goes into */
	const city = $derived(seeded(world)[0]?.[0]?.id === vault);
	const here = $derived(world.vaults.find((v) => v.id === vault));
	const left = $derived(city ? siteLeft(world, vault) : []);
	const shared = $derived(!!publicShare(world, vault, SITE));
	const by = $derived({
		picture: left.filter((p) => p.media.startsWith('image/')).length,
		sound: left.filter((p) => p.media.startsWith('audio/')).length,
		film: left.filter((p) => p.media.startsWith('video/')).length
	});
	const what = $derived(
		[by.picture && count(by.picture, 'picture'), by.sound && count(by.sound, 'sound'), by.film && count(by.film, 'film')].filter(
			Boolean
		)
	);

	/** the tags the caps ask a new file to carry: `null` where nothing lets the acting vault add one */
	let asked = $state(/** @type {string[] | null} */ (null));
	$effect(() => {
		let gone = false;
		if (!city) {
			asked = null;
			return;
		}
		creatable(api, actor, vault, 'file', [SITE]).then((t) => !gone && (asked = t));
		return () => {
			gone = true;
		};
	});

	/** why the device won't do it for the acting vault, as it answers a dry run of the share, the tags and one file */
	let refused = $state('');
	$effect(() => {
		const t = asked;
		const first = left.find((p) => !p.entry);
		if (!t || !left.length) return;
		const ops = [...marking(left, vault, actor, shared), ...(first ? [{ ...bringing(first, vault, actor, t), len: 0 }] : [])];
		let gone = false;
		may(api, actor, ops).then((verdicts) => {
			const no = verdicts.find((v) => !allowed(v));
			if (!gone) refused = no ? why(/** @type {any} */ (no)) : '';
		});
		return () => {
			gone = true;
		};
	});

	const key = $derived(`avendb.sitemedia.later.${vault}`);
	let later = $state(false);
	$effect(() => {
		try {
			later = localStorage.getItem(key) === '1';
		} catch {
			later = false;
		}
	});
	function notNow() {
		later = true;
		try {
			localStorage.setItem(key, '1');
		} catch {
			// kept for this visit only
		}
	}

	/** how far the copy is: done of all, and the file it is on, while it runs */
	let going = $state(/** @type {{ done: number, of: number, now: string, bytes: number } | null} */ (null));
	let failed = $state('');
	async function copyIn() {
		if (!asked || going) return;
		failed = '';
		going = { done: 0, of: left.length, now: '', bytes: 0 };
		try {
			const out = await copySiteMedia(api, () => world, vault, actor, (at) => (going = at));
			failed = leftOut(out);
		} catch (e) {
			failed = `${/** @type {Error} */ (e)?.message ?? e}. What was copied stays; copying again goes on from there.`;
		} finally {
			going = null;
		}
	}
</script>

{#if asked && (left.length || going) && !later}
	<aside class="site-media" aria-label="The site’s media">
		<div class="words">
			<b>The site’s pictures, sounds and films</b>
			{#if going}
				<span
					>Copying {Math.min(going.done + 1, going.of)} of {going.of}{going.now ? `: ${going.now}` : ''}{going.bytes
						? ` (${size(going.bytes)})`
						: ''}…</span
				>
				<progress max={going.of} value={going.done}></progress>
			{:else}
				<span
					>{what.join(', ')} that the homepage, the Universe and the sandboxes show still come from the old media vault.
					Copying brings each into {nameOf(here)} under its hash, checked byte for byte, and lets everyone read them there,
					so the site loads them from avenDB. The old vault keeps its copies.</span
				>
				{#if refused}<small class="warn">{nameOf(world.vaults.find((v) => v.id === actor))} can’t: {refused}.</small>{/if}
				{#if failed}<small class="warn">{failed}</small>{/if}
			{/if}
		</div>
		{#if !going}
			<div class="acts">
				<button class="btn primary" disabled={busy || !!refused} onclick={copyIn}>Copy them in</button>
				<button class="btn quiet" onclick={notNow}>Not now</button>
			</div>
		{/if}
	</aside>
{/if}

<style>
	.site-media {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		margin: 0 0 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid #e6dcc3;
		border-radius: 12px;
		background: #fbf6e9;
	}

	.words {
		display: flex;
		flex: 1 1 18rem;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.86rem;
		line-height: 1.4;
	}

	.words small {
		font-size: 0.76rem;
	}

	.warn {
		color: #9a3b1f;
	}

	progress {
		width: 100%;
		max-width: 20rem;
		accent-color: var(--accent);
	}

	.acts {
		display: flex;
		gap: 0.4rem;
	}
</style>
