<!--
	What maiaCITY kept before avenDB, offered on the Sparks page (./Sparks.svelte) of the Maia City COOP alone, where the
	acting vault may add sparks and artifacts to it (Samuel 2026-10-18: a person's own vault gets no sparks, artifacts or
	the like from the seed; they all go into Maia City, as ./seed.js writes the rest), to copy in once (./legacy.js): the inspire-me reports with their sources, the journal's
	sources and idea pads, and the admin's notebook where the person signed in to maia.city holds it. The originals stay
	where they are. Each piece copies as its artifacts and then its spark, one after another; what is copied already is
	left out, so it shows only while something is left. "Not now" hides it in this browser for this vault.
-->
<script>
	import { apiCall } from '$lib/auth/client';
	import { ARTIFACT } from './artifacts.js';
	import { copying, pieces, uncopied } from './legacy.js';
	import { creatable } from './ops.js';
	import { SPARK } from './sparks.js';
	import { count, nameOf, seeded } from './vaults.js';

	/** @type {{ world: import('./vaults.js').WorldView, vault: string, actor: string, api: any, busy: boolean }} */
	let { world, vault, actor, api, busy } = $props();

	/** the notebook's ideas, once the server gave them; why not, where it didn't */
	let ideas = $state(/** @type {{ id: string, body: string, done: boolean }[]} */ ([]));
	let noIdeas = $state('');
	$effect(() => {
		let gone = false;
		apiCall('/api/ideas').then(
			(got) => !gone && Array.isArray(got) && (ideas = /** @type {any} */ (got)),
			() => !gone && (noIdeas = 'The notebook’s ideas come along when you’re signed in to maia.city as its admin.')
		);
		return () => {
			gone = true;
		};
	});

	/** whether this is the Maia City COOP of the person's seed: the one vault the copy goes into */
	const city = $derived(seeded(world)[3]?.[0]?.id === vault);
	const left = $derived(city ? uncopied(world, vault, pieces(ideas)) : []);
	const by = $derived({
		report: left.filter((p) => p.kind === 'report').length,
		journal: left.filter((p) => p.kind === 'journal').length,
		pad: left.filter((p) => p.kind === 'pad').length,
		idea: left.filter((p) => p.kind === 'idea').length
	});
	const what = $derived(
		[
			by.report && `${count(by.report, 'inspire-me report')} with ${by.report === 1 ? 'its source' : 'their sources'}`,
			by.journal && 'the journal’s sources',
			by.pad && count(by.pad, 'story idea pad'),
			by.idea && count(by.idea, 'notebook idea')
		].filter(Boolean)
	);

	/** the tags the caps ask a new spark and artifact to carry: `null` where nothing lets it add one */
	let tags = $state(/** @type {{ spark: string[], artifact: string[] } | null} */ (null));
	$effect(() => {
		let gone = false;
		if (!city) {
			tags = null;
			return;
		}
		Promise.all([creatable(api, actor, vault, SPARK), creatable(api, actor, vault, ARTIFACT)]).then(
			([spark, artifact]) => !gone && (tags = spark && artifact ? { spark, artifact } : null)
		);
		return () => {
			gone = true;
		};
	});

	const key = $derived(`avendb.legacy.later.${vault}`);
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

	/** how far the copy is: done of all, while it runs */
	let going = $state(/** @type {{ done: number, of: number } | null} */ (null));
	let failed = $state('');
	async function copyIn() {
		const t = tags;
		if (!t || going) return;
		const todo = [...left];
		going = { done: 0, of: todo.length };
		failed = '';
		for (const p of todo) {
			const ops = await copying(p, vault, actor, t).catch(() => null);
			const got = ops && (await api.runAll(`Copying ${p.kind === 'idea' ? 'an idea' : `“${p.name}”`} (${going.done + 1} of ${going.of})`, ops));
			if (!got) {
				failed = `Stopped at “${p.name}”. What was copied stays; copying again goes on from there.`;
				break;
			}
			going = { ...going, done: going.done + 1 };
		}
		going = null;
	}
</script>

{#if tags && (left.length || going) && !later}
	<aside class="legacy" aria-label="From before avenDB">
		<div class="words">
			<b>From before avenDB</b>
			{#if going}
				<span>Copying {going.done + 1} of {going.of}…</span>
				<progress max={going.of} value={going.done}></progress>
			{:else}
				<span
					>{what.join(', ')}. Copying makes each a spark in {nameOf(world.vaults.find((v) => v.id === vault))}, its sources artifacts on
					it; the originals stay where they are.</span
				>
				{#if noIdeas}<small class="soft">{noIdeas}</small>{/if}
				{#if failed}<small class="warn">{failed}</small>{/if}
			{/if}
		</div>
		{#if !going}
			<div class="acts">
				<button class="btn primary" disabled={busy} onclick={copyIn}>Copy them in</button>
				<button class="btn quiet" onclick={notNow}>Not now</button>
			</div>
		{/if}
	</aside>
{/if}

<style>
	.legacy {
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
