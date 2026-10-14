<!--
	Sandbox 8 · the rules of the world, each a small card in one plain sentence (Primer: rules you can see). They are
	the concept rules the engine keeps ($lib/sandbox-9/engine.js); nothing else moves money.
-->
<script>
	// @ts-nocheck — plain JS
	const RULES = [
		{ t: 'HEARTS', s: 'Every person gets 24 HEARTS of their own a day. A HEART buys nothing: it is only the right to invest in a COOP.' },
		{ t: 'Investing', s: 'One HEART invested makes one MIND of the COOP at once: 0.5 of it to the person, 0.4 to the COOP’s treasury and 0.1 to the city’s pools. One token in three places; no HEART stays anywhere.' },
		{ t: 'Pools', s: 'The city’s pools are baskets of 4 to 8 MINDs. Their LP tokens belong to the MaiaCity COOP, which may redeem them only by a passed MIP. MIND leaves a pool as the other side of a swap, by the melt, or by such a redemption. Their 0.3 % fee stays in them.' },
		{ t: 'Pay to use', s: 'A buyer pays with any MIND it holds; the pools convert it, and the seller receives only its own MIND.' },
		{ t: 'Every sale pays its owners', s: 'A fifth of every real sale goes at once, in the seller’s own MIND, to everyone who holds it: people, other COOPs’ treasuries and the city’s pools, never the seller’s own treasury.' },
		{ t: 'Work proposals', s: 'There are no wages and no jobs. All work is a work proposal priced in the COOP’s own MIND, like in a DAO: the running proposals that keep a COOP going, and new ones from what it holds above a reserve of 9 months of costs. Each person’s Aven delivers them.' },
		{ t: 'Nothing else', s: 'There are no wages, no interest, no loans, no taxes, no basic income and no rent paid to people.' },
		{ t: 'The melt', s: 'Every HEART and every MIND melts 7 % a year, everywhere at once. Money goes out of existence only by the melt and when a failed COOP’s MIND is retired from the pools; payments for resources, services and work only move MIND.' },
		{ t: 'Land', s: 'All land belongs to the City COOP. Every citizen holds one equal share that cannot be sold; builders lease plots and pay ground rent in MIND.' },
		{ t: 'Free prices', s: 'No price caps, no protected prices, no subsidies. Two COOPs sell every good from the first day, and anyone can found another. A seller never sells below its own cost floor.' },
		{ t: 'Energy first', s: 'Energy serves the basics first, then the works, then building, then the export that buys accelerators. Only the surplus pays for R&D, and only R&D and practice make recipes better, never past their physical floor.' },
		{ t: 'Only physics', s: 'Nothing appears that physics does not allow: food grows on the forest by its age and the season, rain fills the tanks, and the sun and the geothermal well give the energy. The accelerators that run the Avens’ services are made outside: COOPs buy them through a euro reserve (each COOP its own account), with electricity they export after the city’s own basics and works. No person redeems MIND, and no MIND is made from euros.' },
		{ t: 'Ownership', s: 'Everyone owns MINDs, and holding MINDs pays more MIND. That is how people live.' }
	];
</script>

<ol class="rules">
	{#each RULES as r, i}
		<li><span class="n">{i + 1}</span><b>{r.t}</b><p>{r.s}</p></li>
	{/each}
</ol>

<style>
	.rules {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
		gap: 0.6rem;
	}
	li {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 0.6rem 0.75rem 0.7rem;
		position: relative;
	}
	.n {
		position: absolute;
		top: 0.55rem;
		right: 0.7rem;
		font-size: 0.7rem;
		color: var(--muted);
	}
	b {
		font-size: 0.85rem;
	}
	p {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		line-height: 1.45;
		color: var(--ink-soft);
	}
</style>
