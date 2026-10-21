<!--
	theOS's activity, live (Samuel 2026-10-21: "the full activity logs visually … as its own app view"), in the layout
	every avenDB view has (./Frame.svelte): every line the app logs, its avenDB device's and its network's among them,
	as the app keeps the newest of them (vault/app/src/activity.rs `activity_log`), read every second from where it read
	last. On the left what it shows: the levels, where the lines come from, the routine polls hidden or not, and a
	search; in the middle the lines, the newest at the foot, followed as they come unless the person scrolled up or
	paused; on the right the line picked, whole. Read on this Mac alone: nothing here is written to a vault or sent anywhere.
-->
<script>
	import { onMount, tick } from 'svelte';
	import { command, native } from '$lib/native';
	import Frame from './Frame.svelte';
	import Icon from './Icon.svelte';
	import { LEVELS, SOURCES, clock, keep, parse } from './activity.js';

	const mac = native();
	/** how many lines the page keeps, the newest, as the app does */
	const KEPT = 5000;

	/** @type {any[]} */
	let rows = $state([]);
	let next = $state(0);
	let failed = $state('');
	let paused = $state(false);
	let follow = $state(true);
	let levels = $state(new Set(['ERROR', 'WARN', 'INFO', 'DEBUG']));
	let sources = $state(new Set(SOURCES.map(([id]) => id)));
	let quiet = $state(true);
	let search = $state('');
	/** @type {any} */
	let picked = $state(null);
	let open = $state(/** @type {'' | 'nav' | 'aside'} */ (''));
	/** @type {HTMLElement | undefined} */
	let list = $state();

	const shown = $derived(keep(rows, { levels, sources, quiet, search }));
	const counts = $derived(Object.fromEntries(LEVELS.map((l) => [l, rows.filter((r) => r.level === l).length])));

	/** Reads the lines the app logged since the page read last. */
	async function read() {
		if (!mac || paused) return;
		try {
			/** @type {{ lines: [number, string][], next: number }} */
			const got = await command('activity_log', { after: next, limit: KEPT });
			failed = '';
			if (!got.lines.length) return void (next = got.next);
			const fresh = got.lines.map(([n, text]) => parse(n, text));
			rows = [...rows, ...fresh].slice(-KEPT);
			next = got.next;
			if (follow) {
				await tick();
				list?.scrollTo({ top: list.scrollHeight });
			}
		} catch (e) {
			// an app from before the Activity view has no such command
			failed = /** @type {Error} */ (e)?.message ?? String(e);
		}
	}

	onMount(() => {
		read();
		const t = setInterval(read, 1000);
		return () => clearInterval(t);
	});

	/** The person scrolled: the page follows the newest lines only while it is at their foot. */
	function scrolled() {
		if (!list) return;
		follow = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
	}

	/** Set `set` with `x` in it or out of it, toggled. @param {Set<string>} set @param {string} x */
	const toggled = (set, x) => {
		const s = new Set(set);
		if (s.has(x)) s.delete(x);
		else s.add(x);
		return s;
	};

	/** Copies the lines shown, as plain text. */
	const copy = () => navigator.clipboard?.writeText(shown.map((r) => r.text).join('\n')).catch(() => {});
	/** Lets go of the lines read so far: the page shows only what comes from now on. */
	const clear = () => ([rows, picked] = [[], null]);
</script>

{#snippet nav()}
	<input class="nav-search" type="search" placeholder="Search the lines" bind:value={search} aria-label="Search the lines" />
	<h3 class="nav-group">Levels</h3>
	{#each LEVELS as l (l)}
		<button class="nav-item" class:on={levels.has(l)} aria-pressed={levels.has(l)} onclick={() => (levels = toggled(levels, l))}>
			<span class="dot {l.toLowerCase()}"></span><span>{l[0] + l.slice(1).toLowerCase()}</span><small>{counts[l]}</small>
		</button>
	{/each}
	<h3 class="nav-group">From</h3>
	{#each SOURCES as [id, name] (id)}
		<button class="nav-item" class:on={sources.has(id)} aria-pressed={sources.has(id)} onclick={() => (sources = toggled(sources, id))}>
			<span>{name}</span><small>{rows.filter((r) => r.source === id).length}</small>
		</button>
	{/each}
	<h3 class="nav-group">Show</h3>
	<button class="nav-item" class:on={!quiet} aria-pressed={!quiet} onclick={() => (quiet = !quiet)}>
		<span>Routine polls and store diagnostics</span>
	</button>
{/snippet}

{#snippet aside()}
	{#if picked}
		<dl>
			<dt>Time</dt>
			<dd>{picked.time ? `${clock(picked.time)} (${picked.time})` : '–'}</dd>
			<dt>Level</dt>
			<dd>{picked.level || '–'}</dd>
			<dt>From</dt>
			<dd>{picked.target || '–'}</dd>
			{#if picked.spans}<dt>Inside</dt>
				<dd>{picked.spans}</dd>{/if}
			<dt>Line</dt>
			<dd>#{picked.n}</dd>
		</dl>
		<pre class="whole">{picked.message}</pre>
		<button class="btn" onclick={() => navigator.clipboard?.writeText(picked.text).catch(() => {})}>Copy the line</button>
	{/if}
{/snippet}

<Frame {nav} aside={picked ? aside : undefined} bind:open navLabel="What it shows" navIcon="activity" asideLabel="The line" asideIcon="info">
	{#if !mac}
		<p class="soft">The activity log is theOS’s own: open avenDB in theOS on your Mac to see it live.</p>
	{:else}
		<div class="bar">
			<span class="soft">{shown.length} of {rows.length} lines{paused ? ', paused' : follow ? ', live' : ''}</span>
			<span class="grow"></span>
			<button class="btn" onclick={() => (paused = !paused)}>{paused ? 'Go on' : 'Pause'}</button>
			<button class="btn" onclick={copy} disabled={!shown.length}>Copy</button>
			<button class="btn" onclick={clear} disabled={!rows.length}>Clear</button>
		</div>
		{#if failed}<p class="error">{failed.includes('activity_log') ? 'This build of theOS keeps no activity log yet: it comes with the next one.' : failed}</p>{/if}
		<div class="lines" bind:this={list} onscroll={scrolled} role="log" aria-live="off">
			{#each shown as r (r.n)}
				<button class="line {r.level.toLowerCase()}" class:on={picked?.n === r.n} onclick={() => ([picked, open] = [r, 'aside'])}>
					<span class="time">{r.time ? clock(r.time) : ''}</span>
					<span class="level">{r.level}</span>
					<span class="target" title={r.target}>{r.target.split('::').slice(-1)[0]}</span>
					<span class="message">{r.message}</span>
				</button>
			{:else}
				<p class="soft empty">{rows.length ? 'No line fits what the left side shows.' : 'Nothing logged yet.'}</p>
			{/each}
		</div>
		{#if !follow && !paused}
			<button class="btn newest" onclick={() => (list?.scrollTo({ top: list.scrollHeight }), (follow = true))}>
				<Icon name="download" size={14} /> Newest
			</button>
		{/if}
	{/if}
</Frame>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.6rem;
		font-size: 0.82rem;
	}

	.grow {
		flex: 1;
	}

	.lines {
		height: calc(100dvh - 15rem);
		min-height: 18rem;
		overflow-y: auto;
		border: 1px solid var(--edge);
		border-radius: 0.6rem;
		background: #1f2724;
		color: #dfe6e2;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 0.74rem;
	}

	.line {
		display: grid;
		grid-template-columns: 6.6rem 3.4rem 9rem minmax(0, 1fr);
		gap: 0.6rem;
		width: 100%;
		padding: 0.12rem 0.6rem;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.line:hover,
	.line.on {
		background: rgb(255 255 255 / 0.07);
	}

	.time,
	.target {
		color: #8fa39a;
	}

	.target {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.message {
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.line.error .level,
	.line.error .message {
		color: #ff9b8a;
	}

	.line.warn .level {
		color: #f2c46d;
	}

	.line.info .level {
		color: #8fd0a8;
	}

	.line.debug .level,
	.line.trace .level {
		color: #8aa6d6;
	}

	.empty {
		padding: 1rem;
	}

	.dot {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #8aa6d6;
	}

	.dot.error {
		background: #e0634f;
	}

	.dot.warn {
		background: #e0a93a;
	}

	.dot.info {
		background: #4fa173;
	}

	.newest {
		position: sticky;
		bottom: 0.5rem;
		float: right;
		margin-top: -2.6rem;
		margin-right: 1rem;
	}

	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.35rem 0.8rem;
		margin: 0 0 0.8rem;
		font-size: 0.84rem;
	}

	dt {
		color: var(--soft);
	}

	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.whole {
		margin: 0 0 0.8rem;
		padding: 0.6rem;
		border-radius: 0.5rem;
		background: rgb(0 0 0 / 0.05);
		font-size: 0.76rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	@media (max-width: 40rem) {
		.line {
			grid-template-columns: 5.6rem minmax(0, 1fr);
		}

		.level,
		.target {
			display: none;
		}
	}
</style>
