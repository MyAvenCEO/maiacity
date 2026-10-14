<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	// The city's pools (Section 6): the pools' part of one new solarMIND enters two baskets as one-sided deposits, each
	// deposit makes LP tokens for the City COOP, and Anna's tram ride is routed through a basket, so the tram COOP gets
	// only tramMIND. Every number comes from model.js.
	import { POOL_SHARE, POOL, fmt } from '$lib/theos/model.js';

	const top = ['solar', 'water', 'compute', 'habitat', 'arts'];
	const low = ['solar', 'tram', 'agri', 'steel'];
	const coins = (names, y) => names.map((n, i) => ({ n, x: 340 - ((names.length - 1) * 34) / 2 + i * 34, y }));
	const topCoins = coins(top, 92);
	const lowCoins = coins(low, 246);
	const aria = `The pools' part of one new solarMIND, ${fmt(POOL_SHARE, 1)} of each HEART, enters two baskets of ${top.length} and ${low.length} MINDs as one-sided deposits. Each deposit makes LP tokens, and the City COOP holds them. Anna pays for a tram ride in solarMIND; a basket converts it, and the tram COOP gets only tramMIND. A basket holds ${POOL.min} to ${POOL.max} MINDs.`;
</script>

<div class="scroll">
<svg viewBox="0 0 680 340" role="img" aria-label={aria}>
	<defs>
		<marker id="pool-arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 Z" fill="#5b8fa8" />
		</marker>
		<marker id="pool-arrow-gold" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 Z" fill="#b8860b" />
		</marker>
		<marker id="pool-arrow-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0 0 L10 5 L0 10 Z" fill="var(--ink)" />
		</marker>
	</defs>

	<!-- the solar COOP's new MIND: the pools' part goes into two baskets -->
	<rect x="8" y="104" width="160" height="78" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="88" y="130" text-anchor="middle" class="node">Solar COOP</text>
	<text x="88" y="148" text-anchor="middle" class="sub">1 HEART → 1 new solarMIND</text>
	<text x="88" y="166" text-anchor="middle" class="lab">the pools' part: {fmt(POOL_SHARE, 1)}</text>
	<path d="M168 130 C205 130, 215 84, 248 84" fill="none" stroke="#5b8fa8" stroke-width="2.5" marker-end="url(#pool-arrow-blue)" />
	<path d="M168 156 C205 156, 215 232, 248 232" fill="none" stroke="#5b8fa8" stroke-width="2.5" marker-end="url(#pool-arrow-blue)" />
	<text x="206" y="196" text-anchor="middle" class="sub">one-sided</text>
	<text x="206" y="209" text-anchor="middle" class="sub">deposits</text>

	<!-- two baskets of the city's pools -->
	<rect x="250" y="40" width="180" height="96" rx="14" fill="none" stroke="#5b8fa8" stroke-width="1.5" />
	<text x="340" y="60" text-anchor="middle" class="lab">a basket of {top.length} MINDs</text>
	{#each topCoins as c (c.n)}
		<circle cx={c.x} cy={c.y} r="12" fill={c.n === 'solar' ? '#d9a520' : '#5b8fa8'} opacity={c.n === 'solar' ? 0.85 : 0.35} />
		<text x={c.x} y={c.y + 26} text-anchor="middle" class="tiny">{c.n}</text>
	{/each}
	<rect x="250" y="194" width="180" height="96" rx="14" fill="none" stroke="#5b8fa8" stroke-width="1.5" />
	<text x="340" y="214" text-anchor="middle" class="lab">a basket of {low.length} MINDs</text>
	{#each lowCoins as c (c.n)}
		<circle cx={c.x} cy={c.y} r="12" fill={c.n === 'solar' ? '#d9a520' : '#5b8fa8'} opacity={c.n === 'solar' || c.n === 'tram' ? 0.85 : 0.35} />
		<text x={c.x} y={c.y + 26} text-anchor="middle" class="tiny">{c.n}</text>
	{/each}

	<!-- each deposit makes LP tokens for the City COOP -->
	<rect x="500" y="22" width="172" height="76" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="586" y="52" text-anchor="middle" class="node">City COOP</text>
	<text x="586" y="70" text-anchor="middle" class="sub">holds the LP tokens</text>
	<text x="586" y="84" text-anchor="middle" class="sub">of every pool</text>
	<path d="M432 70 L496 58" fill="none" stroke="#b8860b" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#pool-arrow-gold)" />
	<path d="M432 204 L498 94" fill="none" stroke="#b8860b" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#pool-arrow-gold)" />
	<text x="470" y="128" text-anchor="middle" class="lab">LP tokens</text>

	<!-- Anna pays for a tram ride: solarMIND in, tramMIND out -->
	<rect x="8" y="254" width="160" height="72" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="88" y="280" text-anchor="middle" class="node">Anna's wallet</text>
	<text x="88" y="298" text-anchor="middle" class="sub">pays for a tram ride</text>
	<text x="88" y="312" text-anchor="middle" class="sub">in solarMIND</text>
	<path d="M168 290 C215 290, 270 296, 318 262" fill="none" stroke="var(--ink)" stroke-width="1.6" marker-end="url(#pool-arrow-ink)" />
	<path d="M354 262 C400 300, 450 286, 496 280" fill="none" stroke="var(--ink)" stroke-width="1.6" marker-end="url(#pool-arrow-ink)" />
	<text x="340" y="326" text-anchor="middle" class="sub">solarMIND in, tramMIND out</text>
	<rect x="500" y="244" width="172" height="72" rx="10" fill="var(--paper)" stroke="var(--ink)" stroke-width="1.5" />
	<text x="586" y="272" text-anchor="middle" class="node">Tram COOP</text>
	<text x="586" y="290" text-anchor="middle" class="sub">gets only tramMIND</text>
</svg>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}

	svg {
		min-width: 540px;
		display: block;
		width: 100%;
		height: auto;
		font-family: var(--font-body);
	}

	.node {
		font-size: 14px;
		font-weight: 600;
		fill: var(--ink);
	}

	.sub {
		font-size: 11.5px;
		fill: var(--ink-soft);
	}

	.lab {
		font-size: 12px;
		font-weight: 500;
		fill: var(--ink);
	}

	.tiny {
		font-size: 10.5px;
		fill: var(--ink-soft);
	}
</style>
