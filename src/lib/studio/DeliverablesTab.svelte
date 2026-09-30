<!--
	Deliverables (placeholder): where each film's destinations will be managed — every platform, its frame, its
	length, its captions and its schedule. For now: the timeline's own frame, and the platforms to come.
-->
<script>
	/** @type {{ s: import('./studio.svelte.js').Studio }} */
	let { s } = $props();

	const ASPECTS = ['16:9', '9:16', '1:1', '4:5'];
	const PLATFORMS = [
		{ name: 'YouTube', frame: '16:9', note: 'the long film, 4K master' },
		{ name: 'YouTube Shorts', frame: '9:16', note: 'under 60 s' },
		{ name: 'Instagram Reels', frame: '9:16', note: 'up to 90 s' },
		{ name: 'Instagram feed', frame: '4:5', note: 'the still or a cut-down' },
		{ name: 'TikTok', frame: '9:16', note: 'up to 3 min' },
		{ name: 'X', frame: '16:9', note: 'up to 2:20' },
		{ name: 'LinkedIn', frame: '1:1', note: 'a square cut' },
		{ name: 'The journal (maia.city)', frame: '16:9', note: 'the film on its day' }
	];
</script>

<section class="deliver">
	<h2>Deliverables</h2>
	<p class="lead">Every destination of a film will be set here: its platforms, their frames and lengths, captions, and when each one goes out. This is a placeholder for now.</p>

	{#if s.current}
		<div class="frame">
			<span>This timeline is cut in</span>
			<select value={s.current.aspect} onchange={(e) => s.setMeta({ aspect: e.currentTarget.value })} aria-label="Frame">
				{#each ASPECTS as a (a)}<option value={a}>{a}</option>{/each}
			</select>
		</div>
	{/if}

	<ul>
		{#each PLATFORMS as p (p.name)}
			<li><b>{p.name}</b><span class="fr">{p.frame}</span><span class="note">{p.note}</span><span class="soon">soon</span></li>
		{/each}
	</ul>
</section>

<style>
	.deliver {
		grid-area: main;
		overflow: auto;
		padding: 1.4rem 2rem;
		background: var(--panel);
	}

	h2 {
		margin: 0 0 0.4rem;
		font-size: 1.2rem;
	}

	.lead {
		max-width: 40rem;
		margin: 0 0 1.2rem;
		font-size: 0.86rem;
		color: var(--dim);
	}

	.frame {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		margin-bottom: 1.2rem;
		font-size: 0.84rem;
	}

	select {
		padding: 0.2rem 0.4rem;
		border: 1px solid var(--edge);
		border-radius: 6px;
		background: #fff;
		font: inherit;
	}

	ul {
		display: grid;
		gap: 0.35rem;
		max-width: 40rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: 12rem 3.5rem 1fr auto;
		gap: 0.6rem;
		align-items: center;
		padding: 0.5rem 0.8rem;
		border: 1px solid var(--edge);
		border-radius: 8px;
		background: #fff;
		font-size: 0.8rem;
	}

	.fr {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.72rem;
	}

	.note {
		color: var(--dim);
	}

	.soon {
		padding: 0 0.45rem;
		border-radius: 999px;
		background: var(--bg);
		font-size: 0.66rem;
		color: var(--dim);
	}
</style>
