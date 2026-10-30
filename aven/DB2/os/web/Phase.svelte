<script>
	// A status line: the phase's dot and what follows it (README, rule 7). Live is green, starting and connecting wait,
	// offline and stalled are down.
	let { phase = 'starting', text, testid } = $props();
</script>

<span class="phase" data-testid={testid} data-phase={phase}><span class="dot {phase}"></span> {text}</span>

<style>
	.phase {
		color: var(--muted);
		font-size: 13px;
	}

	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--pending);
		vertical-align: 1px;
	}

	.live {
		background: var(--live);
	}

	.offline,
	.stalled {
		background: #e03131;
	}
</style>
