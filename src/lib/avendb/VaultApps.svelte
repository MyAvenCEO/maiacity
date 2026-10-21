<!--
	A vault's pages as apps, by group, as a phone's home screen shows them: one list (`NAV`) and one grid for every place
	that shows them, the vault's own home in avenDB (./Shell.svelte, `#sparks`) and the app's dashboard (src/routes/app/
	+page.svelte, which opens each in avenDB's page: `at` its address). Samuel 2026-10-18: one dashboard, the avenDB
	items on it directly.
-->
<script module>
	import { base } from '$app/paths';

	/** The vault's pages, in its list: each a group's, by its address, name and icon; on its home, each an app. */
	export const NAV = /** @type {const} */ ([
		[
			'',
			[
				['sparks', 'Sparks', 'spark'],
				['artifacts', 'Artifacts', 'artifact'],
				['todos', 'Todos', 'todo'],
				['stories', 'Stories', 'story'],
				['docs', 'Docs', 'article'],
				['library', 'Library', 'library'],
				['studio', 'Studio', 'studio'],
				['assets', 'Assets', 'asset'],
				['worlds', 'Worlds', 'play'],
				['models', 'Models', 'audio'],
				// the programs theOS runs beside its own code, Lean first, kept in Maia City (Samuel 2026-10-21)
				['code', 'Code', 'code']
			]
		],
		[
			'Database',
			[
				['query', 'Query', 'search'],
				['tables', 'Table editor', 'table'],
				['schemas', 'Schemas', 'schema'],
				['lenses', 'Lenses', 'lens'],
				// avenDB's own `flow` and `function` schemas, as Schemas and Lenses are (Samuel 2026-10-19)
				['flows', 'Flows', 'flow'],
				['functions', 'Functions', 'fn'],
				['history', 'History', 'history'],
				['jobs', 'Jobs', 'jobs'],
				// what this device's work costs and how the server is doing, read on the device alone, never written to a
				// vault (Samuel 2026-10-20)
				['performance', 'Performance', 'gauge']
			]
		],
		[
			'Settings',
			[
				// one page, each concept once: profile, owners, devices, sharing, backup and security (Samuel 2026-10-20)
				['settings', 'Settings', 'settings'],
				// every vault the server syncs, and who holds which of Maia City's cap groups: invites and roles (Samuel 2026-10-20)
				['vaults', 'Vaults', 'vault'],
				// theOS's own log, live: its avenDB device, its network, its pages (Samuel 2026-10-21)
				['activity', 'Activity', 'activity'],
				// the city's Postgres, read only, the admins' (Samuel 2026-10-20): a page of the app's own
				['postgres', 'Postgres', 'database']
			]
		]
	]);
	/** the apps that open a page of the app's own, not one of the vault's: the studio, which cuts the vaults' footage
	 *  into films (Samuel 2026-10-18), and the city's Postgres (src/routes/app/postgres/) */
	export const OUT = /** @type {Record<string, string>} */ ({ studio: `${base}/app/studio/`, postgres: `${base}/app/postgres/` });
	/** each group's name, where every group has one */
	export const HEADS = /** @type {Record<string, string>} */ ({ '': 'Workspace' });
	/** each group's colour: its apps' icons, on light tiles (Samuel 2026-10-18) */
	const TINTS = /** @type {Record<string, string>} */ ({ '': 'work', Database: 'data', Settings: 'set' });
</script>

<script>
	import Icon from './Icon.svelte';

	/**
	 * @type {{ at?: string, head?: import('svelte').Snippet<[string]>, only?: string[], onopen?: () => void }} `at`:
	 *   avenDB's page, before each app's `#` ('' on it); `head`: how a group's name is shown, else as the vault's home
	 *   shows it; `only`: the apps shown, where not all of them (a Traveler's Assets and Worlds); `onopen`: what an app
	 *   opened does first (picks the vault it opens in)
	 */
	let { at = '', head, only, onopen } = $props();
	const groups = $derived(
		NAV.map(([group, items]) => /** @type {const} */ ([group, only ? items.filter(([id]) => only.includes(id)) : items])).filter(([, items]) => items.length)
	);
</script>

{#each groups as [group, items] (group)}
	<section class="apps" aria-label={HEADS[group] ?? group}>
		{#if head}{@render head(HEADS[group] ?? group)}{:else}<h2 class="group">{HEADS[group] ?? group}</h2>{/if}
		<div class="grid">
			{#each items as [id, label, icon] (id)}
				<a class="app" href={OUT[id] ?? `${at}#${id}`} onclick={() => onopen?.()}>
					<span class="tile {TINTS[group]}"><Icon name={icon} size={34} /></span>
					<span class="label">{label}</span>
				</a>
			{/each}
		</div>
	</section>
{/each}

<style>
	.group {
		margin: 1.4rem 0 0.8rem;
		color: var(--soft);
		font-family: var(--font-body);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
		gap: 1.3rem 0.75rem;
	}

	/* a page as an app: a light round-cornered tile, as the dashboard's, its icon in its group's colour, its name under it */
	.app {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		min-width: 0;
		color: inherit;
		text-decoration: none;
		-webkit-tap-highlight-color: transparent;
	}

	.tile {
		display: grid;
		place-items: center;
		width: 5rem;
		height: 5rem;
		border: 1px solid var(--line, #dcd5c4);
		border-radius: 1.35rem;
		background: var(--paper, #faf8f2);
		box-shadow: 0 1px 2px rgb(38 56 44 / 0.06);
		transition:
			transform 150ms ease,
			box-shadow 150ms ease;
	}

	/* the brand's colours: the workspace terracotta, the database green, the settings mustard */
	.tile.work {
		color: var(--terracotta, #c8744f);
	}

	.tile.data {
		color: #2f6d62;
	}

	.tile.set {
		color: #c58a1c;
	}

	.app:hover .tile {
		transform: translateY(-2px);
		box-shadow: 0 8px 22px rgb(38 56 44 / 0.1);
	}

	.app:active .tile {
		transform: scale(0.94);
	}

	.app:focus-visible {
		outline: none;
	}

	.app:focus-visible .tile {
		outline: 2px solid var(--accent, #2f6d62);
		outline-offset: 3px;
	}

	.label {
		max-width: 100%;
		color: var(--ink, #26382c);
		font-size: 0.84rem;
		font-weight: 500;
		line-height: 1.25;
		text-align: center;
		overflow-wrap: anywhere;
	}

	@media (max-width: 760px) {
		/* four apps a row, as a phone's home screen shows them */
		.grid {
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 1.1rem 0.35rem;
		}

		.tile {
			width: 4.2rem;
			height: 4.2rem;
			border-radius: 1.15rem;
		}

		.label {
			font-size: 0.74rem;
		}
	}
</style>
