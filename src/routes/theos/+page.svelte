<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import 'katex/dist/katex.min.css';
	import Tex from '$lib/theos/Tex.svelte';
	import Cite from '$lib/theos/Cite.svelte';
	import LineChart from '$lib/theos/LineChart.svelte';
	import Circulation from '$lib/theos/Circulation.svelte';
	import PoolFlow from '$lib/theos/PoolFlow.svelte';
	import DayOfHearts from '$lib/theos/DayOfHearts.svelte';
	import WhereHeartsGo from '$lib/theos/WhereHeartsGo.svelte';
	import FollowOneHeart from '$lib/theos/FollowOneHeart.svelte';
	import MindCycle from '$lib/theos/MindCycle.svelte';
	import { REFS } from '$lib/theos/refs.js';
	import {
		RATE, UIA_DAY, DIVIDEND_SHARE, INVESTOR_SHARE, TREASURY_SHARE, POOL_SHARE, OLD_POOL_SHARE, salesBound, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate, balanceAt, decay,
		idleSeries, convergenceSeries, lvrSeries, basketLvr, selectionSeries, selectionStats, fmt,
		GINI_DE, ownLevel, giniAt, levelYears, reachedBy, giniRest, giniOf, dialSeries,
		yearlyLoss, steadyStateGrowth, yearsToReach, relativeRate, selfDealDay, honestDay,
		poolAfterCrash, heldAfterCrash, pairCount, ROUND_TRIP, flowSum, incomeShare,
		SIM, BASIC_BUNDLE, PROOF, DECILES, OWNER_ONLY, DYN, STATIC, RESERVES, LADDER, variation,
		variationsMuAbove, variations, foodShort, foodOnlyShort, allPass, PRICES_BY_YEAR, bundleShareOfLiving, COMPETITION, FAILURE,
		ENERGY_ENTRANTS, MIND_RETURNS, spendShare, strictThreshold, ownerOnlyYield, impliedSales,
		meltMargin, stockGrowthDay, moneyGap, growth, poorestDip, livingAt, livingSeries, ENERGY, kwPerPerson, gjToKw, domeYears,
		starveFail, holdingCoverYears, holdingLivingDays, ownerOnlyDividendShare, growthRate, plantGrowthRate, tenYearFalls,
		strictWorstEarly, bedsFromEnergy, decemberGap, SDE_CHECK, bundleMargin, treasuryShare, salesAfterLaw5, OLD_R,
		EURO_BORDER, SEEDS, MELT_TESTS, passing, soleMakers, issueGap, SAME_SHOCK, CHAOS,
		TEST_CITY, AVEN_RULE, POOL, CIRCLES, LVR_CASES, CRASH, GOVERNANCE, VERSION, SECONDS_YEAR, netHalfLife, retiredShare,
		holderSeries, INFRA_MINDS, mindRange, SIM_NAMES, MODEL_VERSIONS, SIM_HISTORY, HYPOTHESES, COST_BAND, holdsCount
	} from '$lib/theos/model.js';

	// Figure 10's simulation, run at build time (+page.server.js)
	let { data } = $props();

	// the four series colours, validated together for colour-blind separation on the paper's surface
	const C = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0'];

	// one map for the numbers of figures, tables and equations, so that a new one never leaves a stale reference behind
	const FIG = { day: 1, wall: 2, heart: 3, idle: 4, conv: 5, pools: 6, lvr: 7, holder: 8, selection: 9, gini: 10, dial: 11, machine: 12, cycle: 13, deciles: 14 };
	const TAB = { speeds: 1, binds: 2, rivals: 3, parts: 4, conditions: 5, twoWorlds: 6, roundTrip: 7, prices: 8, prop3: 9, prop2: 10, variations: 11, cityParts: 12, testCity: 13, scenarios: 14, notation: 15, threats: 16, sameShock: 17, physics: 18, kinds: 19, hyps: 20 };
	const EQ = { melt: 1, half: 2, money: 3, rtm: 4, pool: 5, lvr: 6, unit: 7, select: 8, level: 9, gini: 10, normal: 11, strict: 12, abundance: 13, share: 14, stock: 15 };

	// the slider under Figure 5 sets the rate, so a reader can feel what the 7 % does
	let rate = $state(RATE);

	const idle = idleSeries().map((s, i) => ({ id: `r${s.r}`, label: `${Math.round(s.r * 100)} % a year`, color: [C[1], C[0], C[3]][i], points: s.points }));
	const conv = $derived(convergenceSeries(rate).map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] })));
	const star = $derived(steadyState(rate));
	// Figure 8: what a holder keeps of 1,000 HEARTS invested in year 1, against the same HEARTS left idle (log scale)
	const holders = holderSeries().map((s, i) => ({ ...s, color: ['#8a8578', C[0], C[1], C[2], C[3]][i], dash: s.id === 'idle' ? '5 4' : undefined }));
	const holdEnd = (id) => holders.find((s) => s.id === id).points.at(-1)[1];
	const BM = MIND_RETURNS.byMind;
	const lvr = lvrSeries().map((s, i) => ({ ...s, color: [C[2], C[0], C[1]][i] }));
	const sel = selectionSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const gin = $derived(data.gini.map((s, i) => ({ ...s, color: ['#8a8578', C[0], C[2], C[1]][i] })));
	// the simulation's lasting return in the last ten years is above the melt, where (EQ.gini) has no resting state, so
	// no line draws it
	const dial = dialSeries().map((s, i) => ({ ...s, color: [C[1], C[0], C[3]][i] }));
	// Figure 14: real consumption of the richest, the middle and the poorest tenth, every year, on a log scale
	const living = livingSeries().map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] }));

	// a no-break space keeps a number and its % sign on one line
	const pct = (v, d = 0) => `${fmt(v, d)}\u00a0%`;
	// a share (0.87) as a percentage (87 %)
	const pc = (v, d = 0) => pct(v * 100, d);
	// a number inside TeX: its thousands comma must not read as punctuation
	const tn = (v, d = 0) => fmt(v, d).replace(/,/g, '{,}');
	const ev = lifeForRate(RATE);
	const u = UIA_DAY * 365;
	// Figure 9 in numbers, as drawn, and with a COOP C that never learns
	const selNow = selectionStats();
	const selFlat = selectionStats(0);
	// Section 11.2.2: the round trip, signed, and a person's income by source
	const RT = ROUND_TRIP;
	const sg = (v) => `${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}`;
	const share = (k) => pc(incomeShare(k));
	// Section 10: the poorest tenth's dip, a ladder row by id, and a tick or a cross
	const dip = poorestDip();
	const V = variation;
	const mark = (c) => (c ? '✓' : '✗');
	// a run's verdict on the three checks of Proposition 3, in words, from its checks
	const checkWords = (v) => {
		const ok = [1, 2, 3].filter((k, i) => v.checks[i]);
		const bad = [1, 2, 3].filter((k, i) => !v.checks[i]);
		if (!bad.length) return 'passed all three checks';
		if (!ok.length) return 'failed all three checks';
		const pp = (a) => `${a.length > 1 ? 'parts' : 'part'} ${list(a.map(String))}`;
		return `passed ${pp(ok)} and failed ${pp(bad)}`;
	};
	const HYP = HYPOTHESES;
	const goods = COMPETITION.map((g) => ({ ...g, name: g.good[0].toUpperCase() + g.good.slice(1) }));
	const energyGood = COMPETITION.find((g) => g.good === 'energy');
	const foodGood = COMPETITION.find((g) => g.good === 'food');
	// Section 10: the ten-year windows in which the poorest tenth fell, and the worst early year of the strict test
	const falls = tenYearFalls();
	const strictEarly = strictWorstEarly();
	const strictLater = strictWorstEarly(2);
	// Law 4 in words: what one invested HEART makes (Section 4)
	const RULE = `${fmt(INVESTOR_SHARE, 1)} to the investor, ${fmt(TREASURY_SHARE, 1)} to the treasury, ${fmt(POOL_SHARE, 1)} to the city's pools`;
	// a list in words: 'a, b and c'
	const list = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);
	// the goods that one COOP made alone in the last year
	const sole = soleMakers();
	// part 3 at the ten-year marks: the marks at which the poorest tenth fell
	const MARKS = [1, 10, 20, 30, 40, 50, 60];
	const markFalls = MARKS.slice(1).map((y, i) => [MARKS[i], y]).filter(([a, b]) => livingAt('d1', b) < livingAt('d1', a));
	// Section 11.2.3: the years with basics short in the main run
	const shortYears = PROOF.shortYears.map((y) => y.year);
	// the eight seeds, and the melt tests (Section 11.2.5)
	const SN = SEEDS.new, SO = SEEDS.old, MT = MELT_TESTS;
	const law35 = variation('law35');
	// the ten-year windows in which the poorest tenth fell, by their first year, in words: '27 to 35, 49 and 50'
	const runsOf = (ys) => {
		const runs = [];
		for (const y of ys) {
			if (runs.length && y === runs.at(-1)[1] + 1) runs.at(-1)[1] = y;
			else runs.push([y, y]);
		}
		return runs;
	};
	const fallStarts = list(runsOf(falls.map(([a]) => a)).flatMap(([a, b]) => (b - a > 1 ? [`${a} to ${b}`] : b > a ? [`${a}`, `${b}`] : [`${a}`])));
	// the ten-year marks at which the poorest tenth fell, in words, and with their real consumption
	const markFallWords = list(markFalls.map(([a, b]) => `from year ${a} to year ${b}`));
	const fellAt = list(markFalls.map(([a, b]) => `in year ${b} than in year ${a}`));
	const markFallNumbers = markFalls.map(([a, b]) => `${fmt(livingAt('d1', a), 1)} in year ${a} and ${fmt(livingAt('d1', b), 1)} in year ${b}`).join('; ');
	// the goods that ran short in the worst year of the main run
	const worstGoods = list(PROOF.shortYears.find((y) => y.year === PROOF.worstYear)?.goods ?? []);
	// the runs whose owner-only people went short (part 2 failed)
	const ownerShort = LADDER.filter((v) => !v.checks[1]).length;
	// the owner-only group's holding mix in year 60: its cityMIND, and the MIND of a food COOP and an energy COOP that
	// sold almost nothing by then
	const ownerCity = OWNER_ONLY.mix.CITY;
	const ownerIdle = OWNER_ONLY.mix.GREEN.share + OWNER_ONLY.mix.WIND.share;
	// the food COOPs among the failures, in words
	const foodFailures = FAILURE.food === FAILURE.count ? (FAILURE.count === 2 ? 'both failures were food COOPs' : `every one of the ${FAILURE.count} failures was a food COOP`) : `${FAILURE.food} of the ${FAILURE.count} failures were food COOPs`;
	// what the City COOP did with the failed plants (the idle-plant rule), in words
	const scrappedWords = FAILURE.scrapped === FAILURE.count ? (FAILURE.count === 2 ? 'Both plants stood almost idle, so the City COOP scrapped both' : 'Every one of those plants stood almost idle, so the City COOP scrapped them') : `${FAILURE.scrapped} of those plants stood almost idle, so the City COOP scrapped them`;
	// a phrase with a capital first letter
	const cap = (t) => t[0].toUpperCase() + t.slice(1);
	// 'in year 14' or 'in years 2 and 34'
	const inYears = (ys) => (ys.length === 1 ? `in year ${ys[0]}` : `in years ${list(ys.map(String))}`);
	// a count that may be zero, in words
	const noneOr = (k) => (k === 0 ? 'none' : `${k}`);
	// the runs in words, for lists
	const runWords = {
		main: 'the main run', law35: `Law 5 at ${pc(V('law35').share)}`, law50: `Law 5 at ${pc(V('law50').share)}`,
		res6: `reserves of ${V('res6').months} months`, res12: `reserves of ${V('res12').months} months`,
		prod0: 'no productivity growth', even: 'even growth', wide: 'growth twice as uneven', wants: 'wants that do not grow',
		aven: 'fixed Aven capacity', pop: 'a growing population', pool05: 'the old pool rule'
	};
	// the variations that passed parts 1 and 2 but failed part 3, on the main seed
	const only3Fails = variations().filter((v) => v.checks[0] && v.checks[1] && !v.checks[2]);
	// the run whose day of basics cost the most, so the margin of (EQ.normal) was smallest
	const tightest = LADDER.reduce((a, v) => (v.bundleMax > a.bundleMax ? v : a));
	// the same-shock comparison of the two pool rules (Appendix G), and its sign tests
	const SS = SAME_SHOCK, ST = SAME_SHOCK.tests;
	// a p value of a sign test
	const pv = (t) => fmt(t.p, 3);
	// the main seed, with the pools' part moved by a hair (Section 11.2.6)
	const hair = (pool) => CHAOS.find((c) => c.pool === pool);
	const hairLow = hair(0.0999), hairHigh = hair(0.1001), oldLow = hair(0.0499), oldHigh = hair(0.0501);
	// person-days short, in words
	const shortWords = (c) => (c.short ? `${fmt(c.short)} person-days were short` : 'no one went short');
	// a count of seeds in words
	const seeds = (k) => `${k} ${k === 1 ? 'seed' : 'seeds'}`;
	// 'every seed' when all of them, else 'k of n seeds'
	const ofSeeds = (k) => (k === SEEDS.n ? 'every seed' : `${k} of ${SEEDS.n} seeds`);
	// Section 11.3.3: the test city's fifth round. A part holds on a seed when nothing failed there; the strict test holds
	// when dividends alone paid the whole bundle
	const TC = TEST_CITY, TS = TEST_CITY.scenarios;
	const holdsOn = (xs, ok = (v) => v === 0) => xs.filter(ok).length;
	// a scenario's verdict, or two of them, in words
	const verdict = (p) => [p].flat().map((v) => (v === null ? 'Comparison' : v ? 'Pass' : 'Fail')).join(' / ');
	// the lowest and the highest of a list, in words: '12 to 18'
	const span = (xs, f = (v) => fmt(v)) => (Math.min(...xs) === Math.max(...xs) ? f(xs[0]) : `${f(Math.min(...xs))} to ${f(Math.max(...xs))}`);
	// the base seeds on which part 1 missed, and on which the normal test failed, with their person-days
	const p1Missed = TC.p1.filter((v) => v > 0);
	const normalFails = TC.seeds.map((s, i) => [s, TC.p2normal[i]]).filter(([, v]) => v > 0);
	const mindBound = TC.abundance.filter((v) => v > 0);
	// person-days short, or none
	const shortOr = (k, none = 'no one went short') => (k ? `${fmt(k)} person-days were short` : none);


	// the paper's arc: where we come from, the system itself, where it leads
	const parts = [
		{ title: 'Part I · From capitalism', sections: [
			['why', '1 · Why: the end of the wage'],
			['money', '2 · What money is, and why it should melt'],
			['dividend', '3 · Who should create money']
		] },
		{ title: 'Part II · The operating system: rules, policies and concepts', sections: [
			['laws', '4 · The five laws'],
			['entropy', '5 · Melting money, in numbers'],
			['pol', '6 · Keeping every MIND tradeable'],
			['avens', '7 · Avens: an agent for every person'],
			['infra', '8 · Building for the long term: land, the euro and energy'],
			['governance', '9 · Governance and competition']
		] },
		{ title: 'Part III · Hypotheses: what theOS should achieve', sections: [
			['living', '10 · Hypotheses: what theOS should achieve']
		] },
		{ title: 'Part IV · Our simulations', sections: [
			['sims', '11 · Our simulations']
		] },
		{ title: 'Part V · Limits, open problems and the road ahead', sections: [
			['limits', '12 · Limitations and open problems'],
			['synthesis', '13 · From capitalism to Abundism']
		] },
		{ title: 'Appendices', sections: [
			['assumptions', 'A · Assumptions'],
			['notation', 'B · Notation'],
			['glossary', 'C · Glossary'],
			['related', 'D · Related work'],
			['threats', 'E · Threat model'],
			['protocol', 'F · Who can change the rules'],
			['disclosure', 'G · Code, data and interests'],
			['physics', 'H · The physical world'],
			['references', 'References']
		] }
	];
</script>

<svelte:head>
	<title>theOS · The civilization scale operating system of Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, HEARTS as the unit of account, liquidity owned by the City COOP, open market governance, and Proposition 3: no one starves, no one has to work to survive, and the consumption of every tenth of the people rises from one ten-year mark to the next. By Samuel Andert and Claude." />
</svelte:head>

<main class="paper">
	<header class="masthead">
		<p class="brand">theOS</p>
		<p class="kind">Working paper · v6 · October 2026 · maiaCITY</p>
		<h1>The civilization scale operating system of Abundism</h1>
		<p class="subtitle">A macroeconomic and system-engineering framework for a post-labour economy</p>
		<p class="author">Samuel Andert and Claude</p>
		<p class="affil">maiaCITY · Munich</p>
	</header>

	<section class="abstract" aria-label="Abstract">
		<h2>Abstract</h2>
		<p>
			Picture a city where machines grow the food, run the power plants and build the homes. Two questions decide if
			such a city is a good place to live. Who gets a fair share of what the machines make? And who decides what they
			build next? For two centuries, wages and ownership answered both: most people worked, got a wage and spent it. If
			machines do most of the work, that answer stops working.
		</p>
		<p>
			This paper proposes a different answer: an economic operating system that we call theOS. Every person gets a
			personal currency every day, simply for being alive: {UIA_DAY} HEARTS, one for each hour. Samuel's are
			samuelHEARTS, Anna's are annaHEARTS. HEARTS buy nothing and pay for nothing, not even food. They are a voice.
			People can only invest them into cooperatives, or COOPs: shared enterprises that make what a city needs, such as
			energy, food or housing.
		</p>
		<p>
			Each HEART that a person invests converts into one unit of that COOP's MIND. A MIND is one currency of ownership
			and utility: to hold it is to own part of the COOP, and to spend it is to use what the COOP makes. The new MIND
			goes {RULE}. So half goes to the investor. The treasury is the money that the COOP works with. The city's pools,
			baskets of MINDs whose LP tokens the City COOP holds, let anyone trade one MIND for another. A treasury
			keeps about {SIM.reserveMonths} months of reserves and pays out the rest. Every value is shown in HEARTS, the unit of
			account: the average MIND is worth 1 HEART.
		</p>
		<p>
			Every sale pays the COOP's owners. {pc(DIVIDEND_SHARE)} of every sale goes at once to
			everyone who holds the COOP's MIND. So a COOP pays its owners best by selling a lot to many people. Ownership
			pays: holding MIND brings more MIND.
		</p>
		<p>
			All money melts slowly, just as food spoils and machines wear out: {pct(RATE * 100)} a year, which takes
			{pct(yearlyLoss() * 100, 1)} of an idle balance in a year. So money per person settles at a fixed level, and each
			person's relative position then moves as in Stéphane Laborde's Relative Theory of Money.
		</p>
		<p>
			In this economy, no human labour is paid. Each person has a personal AI agent, called an Aven, which proposes and
			delivers all work with the COOPs' machines. A person's MIND comes from three places: their own half of the
			HEARTS they invest, the work proposals their Aven delivers, and dividends.
		</p>
		<p>
			COOPs that make the same good compete, and anyone can found a rival. Prices move freely with demand, with no caps.
			Everything the city makes costs energy. theOS aims for a city where only physics limits abundance, never a lack of
			money.
		</p>
		<p>
			Our central result is Proposition 3. Take a city that can make enough, whose output per person grows, and whose
			sellers compete. Its residents invest for a founding week before the first sale, so the pools hold MIND on
			opening day. Then, from the end of the founding, no one starves, and no one has to work to survive. And the real consumption of every tenth of
			the people is higher at every ten-year mark than ten years before. We check it in one simulation of
			{SIM.people} people over {SIM.years} years, with free prices, rival COOPs, foundings, failures and shocks. Parts 1
			and 2 are checked for every person at every step, and part 3 for every tenth. People whose Avens deliver nothing
			live from what they own: the ownership that each day's investing creates, and its dividends. The simulation
			assumes that productivity grows about
			{pc(SIM.prodGrowth)} a year in each COOP, and it has no energy limit yet. Under that assumption, the poorest tenth
			consumed {fmt(growth('d1'))} times as much in year {SIM.years} as in year 1. The test city must check part 3
			with growth that only surplus energy pays for.
		</p>
		<p>
			We also report what fails. In the main run, all three parts failed. {cap(inYears(shortYears))}, after a capacity
			shock, people went short of {worstGoods}, owner-only people too. The poorest tenth consumed less {fellAt}. On
			one seed, {noneOr(allPass())} of {LADDER.length} runs passed all three checks; on {SEEDS.n} seeds, the main run
			passed on {SN.pass}. The lasting return on holdings stayed above the melt on {SEEDS.n - SN.below} of the
			{SEEDS.n} seeds, so nothing bounded how unequal ownership could grow. Only a lower share for Law 5 kept it below
			the melt, and Law 5 stays at {pc(DIVIDEND_SHARE)}. One seed is one random history. An older rule gave the pools {fmt(OLD_POOL_SHARE, 2)} of each HEART. We
			ran both rules on the same random shocks, on {SS.n} seeds. Ours gave fewer shortages on {ST.short.better} of
			them and more on {ST.short.worse}. When a COOP fails, the City COOP now scraps
			its plant if the plant stands idle. We propose a fix for each other failure, but none is tested yet.
		</p>
		<p>
			We will prove theOS first in a game, then in the real city. First comes a test city, where simulated residents
			live under its rules and we can measure and change every rule. The test city checks Proposition 3 for every person on every
			day. Then the rules that survive become the economy of maiaCITY, the city we are building.
		</p>
		<p class="keywords">
			<strong>Keywords:</strong> demurrage · personal currencies · universal dividend · Relative Theory of Money · post-labour economics ·
			cooperatives · automated market makers · city-owned liquidity · unit of account · mechanism design · agent-based model ·
			stock-flow consistency · energy return on investment
		</p>
		<p class="keywords"><strong>JEL:</strong> C63 · D31 · E42 · E51 · H41 · O33 · P13 · Q43</p>
	</section>

	<nav class="toc" aria-label="Contents">
		<h2>Contents</h2>
		{#each parts as part (part.title)}
			<p class="part">{part.title}</p>
			<ol>
				{#each part.sections as [id, label] (id)}
					<li><a href="#{id}">{label}</a></li>
				{/each}
			</ol>
		{/each}
	</nav>

	<p class="partline" id="part-1">Part I · From capitalism</p>

	<section id="why">
		<h2><span>1</span>Why: the end of the wage</h2>
		<p>
			Every economy must answer two questions. Who gets what is made? And who decides what is made next? Capitalism
			answers both through work and ownership. Most people sell their time for a wage and spend the wage on what others
			make. The people who own the factories, the land and the capital decide what to build, and they keep what remains.
			For two centuries this system held, for all its injustice, because the owners needed the workers and so had to
			share.
		</p>
		<p>
			That need may be ending. In 1930, Keynes saw that within a century humanity could solve the “economic problem” of
			scarcity. The hard question would then be what to do with the freedom <Cite k="keynes30" />. Ninety-six years
			later, part of his forecast is coming true, by a road he did not expect: machines that learn. How fast it comes
			is still open, and the estimates differ widely.
		</p>
		<p>
			Frey and Osborne put 47 % of US jobs at high risk of computerisation <Cite k="frey" />. Studies of the tasks inside
			each job find about 9 % across the OECD <Cite k="arntz" />. Acemoglu expects AI to raise total factor
			productivity, the output of all inputs together, by at most about 0.66 % over ten years <Cite k="acemoglu24" />.
			The ILO expects most exposed jobs to change, not to disappear <Cite k="ilo25" />, and new kinds of work keep
			appearing <Cite k="autor" />.
		</p>
		<p>
			So automation is a strong trend, not yet today's fact. But the trend is real. Acemoglu and Restrepo found that
			each additional industrial robot per thousand workers lowered employment and wages in the local labour markets most
			exposed to robots <Cite k="acemoglu" />. Language models and humanoid robots now begin to take on thinking and
			handling work too. Rifkin argues that machines will make more and more goods at almost no extra cost
			<Cite k="rifkin" />. If automation keeps spreading, production does not fall. It rises.
		</p>
		<p>
			What fails is distribution. If income flows to whoever owns the machines, wealth tends to concentrate. Piketty
			traced this over three centuries of data. Concentration fell between 1914 and the 1970s, after wars, taxes and
			inflation, and it has risen since. He named the force behind it in one simple inequality, <Tex tex="r > g" />.
			When the return on capital, <Tex tex="r" />, is larger than the growth of the whole economy, <Tex tex="g" />,
			existing owners take a growing share of everything <Cite k="piketty" />. (Later sections use <Tex tex="r" /> and
			<Tex tex="g" /> for other things; Appendix B lists every symbol.)
		</p>
		<p>
			Today's data show where this leads. Since 2004, the share of world income that goes to work fell by 1.6 points.
			That is about 2.4 trillion dollars a year, and AI can push the share lower <Cite k="ilo" />. In the United States,
			the richest 1 % own half of all company shares <Cite k="fed" />. So about half of each gain that AI adds to share
			prices goes to them. In Germany, the richest tenth own more than half of all net wealth <Cite k="bundesbank" />.
			The Gini index measures how unevenly something is shared, in one number from 0 to 1. At 0, everyone has the same.
			At 1, one person has everything. If Anna owns three times as much as Mia, and they are the whole city, the Gini
			index is {fmt(giniOf([3, 1]), 2)}. For wealth in Germany it is {fmt(GINI_DE, 2)} <Cite k="bundesbank" />. Korinek
			and Suh show that wages can fall even before machines can do every task <Cite k="korinek" />.
		</p>
		<p>
			This is the distribution problem of capitalism in its sharpest form. Income reaches people through two channels:
			wages and ownership. Automation closes the first channel and widens the second. So a fair answer must work
			through ownership. And new ownership must go to every person directly. People cannot earn it through wages that
			disappear, and they must not inherit it, because inheritance repeats the past. Rawls called an economy that
			spreads ownership "at the beginning of each period" a property-owning democracy <Cite k="rawls" />. Meade
			proposed such an economy for an age of automation in 1964 <Cite k="meade" />, and Roemer designed shares that
			every citizen gets in equal number <Cite k="roemer" />. None of these proposals gives every person an equal flow
			of new ownership, every day, that the person directs and that cannot pile up without limit while no holding
			earns more than the melt (Section 5.4).
		</p>
		<p>
			This argument does not need the fastest path. It needs only the trend: output moves from wages to ownership, and
			ownership is concentrated. Korinek and Suh compare paths of different speed <Cite k="korinek" />. Table
			{TAB.speeds} shows three of them, and what theOS does in each.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.speeds}.</strong> Three speeds of automation, after the scenarios of Korinek and Suh, and the role of theOS in each.</caption>
				<thead>
					<tr><th>Speed</th><th>What machines do</th><th>Wages</th><th>What theOS does</th></tr>
				</thead>
				<tbody>
					<tr><td>Slow</td><td>Take over tasks one by one, as in recent decades; new kinds of work keep appearing</td><td>Keep rising; the share of income that goes to work falls slowly</td><td>Runs beside the euro. Outside the city, anyone may still take a job for euros. Inside it, there are only work proposals, and HEARTS add a growing stake of ownership</td></tr>
					<tr><td>Medium</td><td>Can do most tasks in about 20 years</td><td>Rise at first, then fall in more and more jobs</td><td>The ownership that investing creates, work proposals and dividends carry a growing share of each person's income</td></tr>
					<tr><td>Fast</td><td>Can do most tasks in about 5 years</td><td>Can collapse once machines spread faster than new capital is built</td><td>HEARTS become the main way to gain ownership. How plentiful the basics are depends on what the COOPs' machines make, and on the energy they harvest</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			The usual answer is a universal basic income: a fixed sum that everyone gets without conditions
			<Cite k="parijs" />. It would feed people, but it keeps the structure as it is. People would get consumption,
			never direction: they could spend, but they could not decide what the automated economy builds next. theOS is
			meant to feed people through ownership: the ownership that each day's investing creates, and its dividends
			(Section 10.4). HEARTS
			themselves never pay for anything (Law 2, Section 4).
		</p>
		<p class="thesis">
			This paper describes a way out. It keeps what markets do well and changes the base they stand on. We call the
			destination <em>Abundism</em>: an economy in which automation makes the basics plentiful, and every person helps
			to decide what the economy builds. In Abundism, distribution is always a question of fair participation through
			fair ownership. Each person's AI agent, the Aven of Section 7, proposes and delivers the work with the machines. Outside the
			city, anyone may still take a job for euros. Inside it, there are only work proposals (Section 4). A
			person gains MIND, the money of ownership and use of Section 4, and Section 11.2.2 shows where it comes from. The
			aim is concrete. No one starves, no one has to work to survive, and the living standard of every tenth of the
			people rises. theOS aims for a city where only physics limits how far. Section 10.3 states this as Proposition 3,
			a hypothesis, and Section 11 tests it in two simulations, person by person. To get there, we must
			first look at the tool that both questions pass through: money. What is it, who creates it, and why does it behave
			the way it does?
		</p>
	</section>

	<section id="money">
		<h2><span>2</span>What money is, and why it should melt</h2>
		<p>
			Money works like a shared memory of who gave what to whom. Kocherlakota showed that money can do the same job as a
			complete record of past trades <Cite k="kocherlakota" />. A note in your pocket says that you once gave something
			of value, and that you can now claim something back. Irving Fisher wrote down how this memory moves through an
			economy, in his equation of exchange <Cite k="fisher11" />. Fisher counted all trades; the common form today counts
			the goods and services produced: <Tex tex="MV = PQ" />. The amount of money, <Tex tex="M" />, times how often it
			changes owner, <Tex tex="V" />, equals the prices, <Tex tex="P" />, times the goods, <Tex tex="Q" />. Money does
			its job only while it moves.
		</p>
		<p>
			But our money is built to stand still. Everything else in the world decays. In 1926 Frederick Soddy, a Nobel
			chemist, wrote that houses crumble, harvests rot and machines rust. A claim on them, however, can grow for ever at
			compound interest <Cite k="soddy" />. Later, Georgescu-Roegen put entropy at the core of his economics
			<Cite k="georgescu" />. Entropy is the tendency of every ordered thing to fall apart unless energy keeps it in
			order. The world that money measures runs on energy and wears out. Section 8.4 returns to this: energy is the one
			resource that every other resource needs.
		</p>
		<p>
			Money that never loses value lets its owner escape the physics that everyone else lives in. The most rational
			thing to do with a surplus is then to keep it idle. And the people who already hold the most can wait the longest.
		</p>
		<p>
			Silvio Gesell proposed the fix more than a century ago. In 1916 he argued that money should carry a small holding
			cost, like every good it competes with. Money would then circulate and not wait for a higher interest rate
			<Cite k="gesell" />. Section 8 shows what a safe return does to long-lived projects. The name for a fee on holding money is <em>demurrage</em>: the charge that a ship pays for
			each day it lies idle in port. Demurrage is the central idea of this paper, and people tested it in practice:
		</p>
		<ul>
			<li>
				In 1932–33, mayor Unterguggenberger of the Tyrolean town of Wörgl issued notes that lost 1 % a month. To keep
				a note's value, its holder had to buy a stamp for it. During the Depression, the town paved roads and built a
				bridge with these notes. Then the Austrian national bank stopped the scheme. The best-known account comes from
				Fritz Schwarz, a supporter of Gesell <Cite k="schwarz" />.
			</li>
			<li>
				Fisher himself wrote a whole book in support of such stamped money, or stamp scrip, for the United States
				<Cite k="fisher33" />. Keynes predicted that “the future will learn more from the spirit of Gesell than from
				that of Marx” <Cite k="keynes36" />.
			</li>
			<li>
				Margrit Kennedy showed how compound interest silently moves wealth upward <Cite k="kennedy" />. Bernard
				Lietaer argued for complementary currencies: local or purpose-made money that runs beside the national one
				<Cite k="lietaer" />. The Chiemgauer in Bavaria, a regional demurrage currency, started in 2003 and still runs
				today. It loses 2 % every quarter <Cite k="gelleri" />.
			</li>
		</ul>
		<p>
			Melting money alone is not enough. Gesell paired his <em>Freigeld</em> (free money) with <em>Freiland</em>, land
			that the community owns and leases out, and never sells <Cite k="gesell" />. Keynes later named the weakness in plain terms. When money carries a cost,
			wealth escapes into substitutes that do not melt, above all land <Cite k="keynes36" />. We return to that warning
			in Sections 8.2 and 8.3. Demurrage tells us how money should behave. It does not yet tell us where new money should
			come from, and that is the next question.
		</p>
	</section>

	<section id="dividend">
		<h2><span>3</span>Who should create money</h2>
		<p>
			Today, banks create most money when they lend <Cite k="mcleay" />. Whoever gets the loan gets the new money first
			and repays it with interest. If money is a shared memory, there is a fairer starting point: create it equally for every person.
		</p>
		<p>
			Stéphane Laborde developed this idea in his <em>Relative Theory of Money</em> (Théorie Relative de la Monnaie). He
			asked which way of creating money treats every generation the same: the people alive now and those not yet born.
			His answer is a <em>universal dividend</em>: new money paid to every member alike, at a rate that depends on how
			long people live <Cite k="laborie" />. The Ğ1 currency started in 2017 and uses this rule
			<Cite k="duniter" />. Remember his rule. Section 5.3 shows that theOS reaches the same rule by another road, once
			its money has settled.
		</p>
		<p>
			Circles UBI took the idea one step further. In Circles, every person gets their own currency, so money starts with
			people and not with banks <Cite k="circles" />. Its second version uses the two numbers that theOS adopts. These
			are 24 tokens a day, one an hour, and a demurrage of 7 % a year <Cite k="circles2" />. Because every person's coin
			is different, Circles needs a web of trust to move value between people: I accept your coin because I trust you.
		</p>
		<p>
			We now have the three ingredients: money that melts, money created equally for every person, and money that
			carries its owner's name. theOS combines them and makes one decisive change. It drops Circles' web of trust,
			because people never trade the personal currency with each other at all. They can only <em>invest</em> it. That
			change is where the operating system starts.
		</p>
	</section>

	<p class="partline" id="part-2">Part II · The operating system: rules, policies and concepts</p>

	<section id="laws">
		<h2><span>4</span>The five laws</h2>
		<p>
			theOS rests on five laws. The protocol, the shared software at the base of theOS, fixes them the way a physics
			engine fixes gravity. Part II says what theOS is, in three kinds of statement. A <em>rule</em> is a law of the
			protocol, or a rule built on the laws; only a new version of the protocol changes it (Appendix F). A
			<em>policy</em> is a setting that the City COOP chooses by a vote of its members, a MIP (Section 8.2), and
			each policy box gives its current value. A <em>concept</em> is a definition. Whatever theOS should achieve is a
			hypothesis, and Part III states each one with its status. Everything else grows on top of the laws and can change: prices, cooperatives and the way
			each cooperative decides. The laws cannot change: nobody holds a key that changes them. Appendix F says what can
			change in the code, and who decides. The laws are short. Together they say where money comes from, where it can
			go, what it becomes there and who gains when it is spent.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>Law 1 · Universal Intent Allocation (UIA)</p>
			<p>
				Every human gets {UIA_DAY} HEARTS a day, without conditions, one for each hour lived, from birth to death. Each
				human has one stream. Each person's HEARTS are a currency of their own: Samuel's are samuelHEARTS, Anna's are
				annaHEARTS. Only their owner can invest them; for a child, a guardian does.
			</p>
		</div>
		<p>
			The name says what it is. <em>Universal</em>, because everyone gets it. <em>Intent</em>, because it shows what a
			person wants to see built. <em>Allocation</em>, because it is the right to allocate: to invest one's HEARTS into
			the cooperatives (COOPs) that one chooses. It is not a handout for survival. The UIA gives each person a voice in
			where the automated economy puts its effort.
		</p>
		<p>
			Three cases need a clear rule. <strong>Who gets HEARTS:</strong> every human, with one stream each, however old
			and wherever born. One stream per human needs an identity that nobody can fake many times (Section 12.1).
			<strong>Children:</strong> a child gets HEARTS from birth. Until an age that the city sets, for example 16, a
			guardian directs the child's HEARTS. The MIND that they create belongs to the child. <strong>Death:</strong> the
			stream stops when a person dies. The MIND that the person leaves goes either to heirs whom the person names or to
			the City COOP. The City COOP is the city's own COOP, and every citizen holds one equal share in it (in maiaCITY,
			the MaiaCity COOP). It holds the land (Section 8.2), the LP tokens of the city's pools (Section 6) and the euro
			border (Section 8.3). Section 12.1 keeps the choice at death open. An Aven, the personal agent of Section 7, invests
			only as its human directs.
		</p>
		<figure>
			<DayOfHearts />
			<figcaption>
				<strong>Figure {FIG.day}.</strong> Law 1 in motion. Three people live through the same day. Each hour drops one HEART
				into each person's dial, in a currency of their own. At midnight the {UIA_DAY} HEARTS of the day leave, and
				their owners invest them into COOPs.
			</figcaption>
		</figure>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>Law 2 · Pure investment</p>
			<p>
				HEARTS earn no interest. They buy nothing and pay for nothing. They enter the economy only when their owner
				invests them into COOPs.
			</p>
		</div>
		<p>
			So a HEART is not money to spend, not even for food. It is a vote with weight, and every person casts {UIA_DAY} of them every day.
			The third law says what a HEART can vote for: a COOP. A COOP is an enterprise that belongs to the people who invest
			in it and use it. Examples are an energy COOP that runs a power plant, or a food COOP that runs a farm.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>Law 3 · Open cooperative creation</p>
			<p>
				Anyone, alone or with others, can found a COOP at any time without permission. It can be for energy, food, compute,
				housing, art or any need that nobody meets yet. A COOP starts from HEARTS and at least three partner COOPs, whose
				MINDs form its first basket (Section 6).
			</p>
		</div>
		<figure>
			<WhereHeartsGo />
			<figcaption>
				<strong>Figure {FIG.wall}.</strong> Laws 2 and 3 in motion. Anna sends out her HEARTS. A HEART that aims at goods or at
				interest stops at the wall. A HEART that aims at a COOP arrives. Then someone founds a new COOP without asking
				anyone, and HEARTS start to arrive there too.
			</figcaption>
		</figure>
		<p>
			Law 3 works on two layers. On the <em>protocol layer</em>, a COOP is code: a MIND, a treasury and the rules by
			which its members decide. Anyone can create one there, and nobody has to approve it. On the <em>legal layer</em>,
			a COOP that owns machines, leases land or signs contracts needs a legal form. In Germany that is often a
			registered cooperative, an <em>eG</em>. An eG needs at least three members, statutes and a membership in an audit
			federation. So "without permission" holds for the protocol, not for the law. One bridge is an umbrella eG whose
			divisions are COOPs. A COOP that grows large becomes its own eG (Section 8.3). COOPs that make the same good compete
			for buyers, and anyone can found a rival (Section 9.1).
		</p>
		<p>
			The fourth law says what an investment creates. It is the moment when a person's intent becomes something that
			people can own and use.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>Law 4 · Every COOP has its own MIND, created by investing HEARTS</p>
			<p>
				Every COOP has its own MIND: solarMIND for a solar COOP, agriMIND for a farming COOP. A MIND is the COOP's
				shared intelligence, its automated capacity to make something. It is one currency of ownership and utility. To
				hold it is to own part of the COOP, and to spend it is to use what the COOP makes. Only investment creates MIND.
				Each invested HEART converts into one new MIND of its COOP, and half goes to the investor: {RULE}. All three
				parts are the same MIND; there is only one kind.
			</p>
		</div>
		<p>
			Follow one HEART. Anna invests one annaHEART into the solar COOP. The HEART converts and is gone for good. Nobody
			holds it after that, not even the COOP: a treasury holds only MINDs. In its place, one new solarMIND appears: {fmt(INVESTOR_SHARE, 1)} in Anna's
			wallet, {fmt(TREASURY_SHARE, 1)} in the COOP's treasury and {fmt(POOL_SHARE, 1)} in the city's pools. It is the
			same solarMIND in all three places, and it does every job.
		</p>
		<p>
			In Anna's wallet, the solarMIND is her ownership: she is now a part-owner of the solar COOP. While she holds it,
			it pays her a share of every sale (Law 5). Its price rises only while demand grows faster than new investment
			makes new solarMIND (Section 6.3; Hypothesis H5, Section 10). When Anna
			switches on her lamp, she pays for the power in solarMIND. She can pay with any MIND that she holds; the pools
			convert it (Section 6), and the solar COOP always receives solarMIND. What she spends goes back to the COOP. What she keeps
			stays her ownership.
		</p>
		<p>
			In the pools, the solarMIND lets anyone trade solarMIND for another MIND (Section 6). In the treasury, the
			solarMIND is the COOP's working capital. The COOP spends it through proposals that its members accept. It <em>buys</em> panels: it pays in solarMIND, the
			pools convert it, and the panel COOP receives panelMIND. And it <em>pays for work</em>, but never for human
			labour. There are no jobs and no wages. All work is a <em>work proposal</em>, priced in the COOP's own MIND, as in
			a DAO (a decentralised autonomous organisation, which runs on proposals and votes). An Aven proposes a piece of
			work and its price for its person, the COOP accepts it, and its treasury pays on delivery. The Avens deliver all
			work with the COOP's machines. Some work proposals keep a COOP running: Mia's Aven runs the daily check of the
			panels, and the COOP pays it from its running costs. Others are new work, paid from the surplus: Mia's Aven
			proposes a plan for the panels' repairs, the members accept it, Mia's Aven and the COOP's robots do the work, and
			the COOP pays Mia in solarMIND. Mia herself does not labour for it. And Mia does not keep it long: her Aven pays for her
			food, her tram rides and a concert. So the MIND that leaves a treasury comes back to the COOPs through what they
			sell (Hypothesis H13, Section 10).
		</p>
		<div class="law concept">
			<p class="lawname"><span class="kind">Concept</span>Work proposal</p>
			<p>
				A piece of work that an Aven proposes to a COOP for its person, priced in the COOP's own MIND, as in a DAO. Running
				work keeps a COOP going and is paid from its running costs. New work is paid from the surplus, once the members
				accept it. The treasury pays on delivery. No human labour is paid.
			</p>
		</div>
		<p>
			The MIND that Anna paid for her light must not stay in the treasury, where it would only melt. It must flow back
			out to people and to other COOPs, while the COOP grows its own <em>plant</em>: the machines and buildings that
			make its goods. One rule says how.
		</p>
		<div class="law" id="payout">
			<p class="lawname"><span class="kind">Rule</span>The payout rule</p>
			<p>
				A treasury keeps a reserve of running costs, plus what it plans to build, and pays out the rest for work
				proposals. It grows its own plant first, where it sells out or earns a margin. What it holds above the reserve
				goes out within weeks, for new work that its members accept.
			</p>
			<p>
				<em>Policy, the length of the reserve:</em> the City COOP sets it by MIP. Its current value is
				{SIM.reserveMonths} months.
			</p>
		</div>
		<p>
			The fifth law says who gains when a COOP sells.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>Law 5 · Every sale pays its owners</p>
			<p>
				{pc(DIVIDEND_SHARE)} of every sale goes at once, in the COOP's own MIND, to everyone who holds it: people, other
				COOPs and the city's pools, in proportion to what each holds. The share is the same for every COOP. The COOP's
				own treasury gets none, because paying itself would only move its MIND in a circle. Only real deliveries count
				as sales.
			</p>
		</div>
		<p>
			This payment is the <em>dividend</em>. When Anna pays for her light, {pc(DIVIDEND_SHARE)} of her payment goes at once to everyone
			who holds solarMIND. Anna holds solarMIND too, so she gets a little of it back. The other {pc(1 - DIVIDEND_SHARE)} goes to
			the treasury. It pays for inputs, services, building, ground rent and work proposals.
			Nobody has to vote on each dividend.
		</p>
		<p>
			This is the heart of theOS: every sale pays its owners. Everyone owns MIND, and every lamp that anybody switches
			on pays Anna a little. What a person holds, and the dividends that it pays, are meant to let a person live
			without working (Hypothesis H3, part 2, Section 10).
		</p>
		<p>
			Law 5 ties what owners gain to what the COOP does for others. A COOP pays its owners best when it sells a lot, and
			it sells a lot when many people find it useful. So each COOP works for good turnover: the total of its sales. Two
			guards keep this honest. First, only real deliveries count as sales. Otherwise two COOPs could sell to each other
			in a circle, and every round would move MIND from their treasuries to their holders (Section 12.2). Second, a sale
			brings the treasury only what is left after the dividend. If that does not cover the cost of the delivery, the
			treasury loses on every sale. So more turnover pays only while prices cover costs. Each COOP sets its own prices
			every day, with no cap, but it cannot sell below its own cost for long (Section 9.1).
		</p>
		<figure>
			<FollowOneHeart />
			<figcaption>
				<strong>Figure {FIG.heart}.</strong> Laws 4 and 5, step by step. One HEART converts into one solarMIND, and it goes
				{RULE}: Anna's ownership, the treasury's working capital, and the city's pools that let people trade. Anna pays for
				her light in solarMIND, and most of it goes back to the treasury. The treasury pays it out again: the panel COOP
				through the pools in its own panelMIND, and Mia for her Aven's work proposal. A share of
				every sale goes at once to everyone who holds solarMIND; Anna gets some back as a holder. The areas of the coins
				are to scale. Tap a number to go to a step.
			</figcaption>
		</figure>
		<p>
			So theOS has only two kinds of money. HEARTS are intent, and they exist only until their owner invests them.
			MINDs are what intent becomes, and they carry the whole economy after that. No human labour is paid. A person's
			MIND comes from three places: their own half of the HEARTS they invest, the work proposals their Aven delivers,
			and Law 5 dividends (Section 11.2.2). The laws say where both come from.
			They do not yet say what stops either from growing without limit. That is the job of the one rule that HEARTS and
			MINDs share: they melt.
		</p>
	</section>

	<section id="entropy">
		<h2><span>5</span>Melting money, in numbers</h2>
		<h3>5.1 One demurrage rule for HEARTS and MINDs</h3>
		<p>
			Every balance of HEARTS and of MINDs melts at the same fixed rate of <Tex tex="r = 0.07" /> a year. This is
			Gesell's demurrage from Section 2, built into the protocol, and it is the same for both kinds of money. So a
			conversion of a HEART into a MIND, or a trade from one MIND into another, cannot escape it. The protocol applies
			demurrage continuously: it updates a balance each time it reads or changes that balance. There is no fixed date
			for the fee, so nobody gains by moving money just before a deadline.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>The melt</p>
			<p>
				Every balance of HEARTS and of MINDs, everywhere, melts at the same fixed rate <Tex tex="r" />,
				{pc(RATE)} a year, continuously: in wallets, treasuries and pools. Melted money is gone.
			</p>
		</div>
		<p>The rule is:</p>
		<Tex display tex={String.raw`\begin{gathered} B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t} \\ \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \end{gathered} \tag{${EQ.melt}}`} />
		<p>
			Here <Tex tex="B" /> is any balance of HEARTS or of a MIND: in a person's wallet, in a COOP's treasury or in a
			pool. The time
			since its last update, in years, is <Tex tex={String.raw`\Delta t`} />. A day costs
			<Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a balance. An idle balance
			loses half of its value in a time called its half-life:
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{${EQ.half}}`} />
		<p>
			On money that people use, the cost is too small to notice. But it is large enough that nobody keeps a fortune idle.
			In Fisher's terms, the melt fixes the amount <Tex tex="M" /> (Section 5.2), and it is meant to raise the velocity
			<Tex tex="V" /> (Hypothesis H13, Section 10). The evidence from earlier demurrage money is mixed,
			and each of those currencies was tied to a national one (Appendix D). For HEARTS, it
			means that nobody can store intent to seize power later. For MINDs, it means that holding a COOP's MIND pays
			only through a share of its sales (Law 5), while the COOP keeps selling. Wealth stops being something one <em>has</em> and becomes
			something one <em>does</em>.
		</p>
		<figure>
			<LineChart
				title="An idle balance of 100 HEARTS or MINDs over 40 years, at 3, 7 and 10 % demurrage"
				series={idle}
				x={{ min: 0, max: 40, ticks: [0, 10, 20, 30, 40], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years left idle' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => fmt(v, tip ? 1 : 0), label: 'Left of 100' }}
				refs={[{ axis: 'x', at: halfLife(), label: `half-life at 7 %: ${fmt(halfLife(), 1)} y` }]}
			/>
			<figcaption>
				<strong>Figure {FIG.idle}.</strong> What remains of 100 idle HEARTS or MINDs. At theOS's 7 % a year, half is gone after
				{fmt(halfLife(), 1)} years. A working balance that people spend and refill every few weeks loses almost nothing.
			</figcaption>
		</figure>
		<h3>5.2 Where all money settles</h3>
		<p>
			Monetary policy, the set of rules that controls how much money exists, is simple in theOS. With one demurrage rule
			for both kinds of money, it fits in four verbs. The protocol <em>issues</em> money only as HEARTS,
			<Tex tex={String.raw`u = ${UIA_DAY} \times 365 = ${tn(UIA_DAY * 365)}`} /> a year per person. Money changes form
			only by <em>conversion</em>, one HEART into one MIND, which neither creates nor destroys money. It
			<em>circulates</em> as MIND: COOPs make, sell and buy their services in it. Last, it <em>leaves</em> the money
			stock. Money goes out of existence in two ways: it melts, and a failed COOP's MIND is retired from the pools.
			Everything else, paying for resources, services and work proposals, only moves MIND from one holder to another.
		</p>
		<p>
			Count all the money there is, HEARTS and MINDs together: in wallets, in treasuries and in the pools. Count every
			token as one, whatever its price in the pools. Divide this count by the number of people, <Tex tex="N" />. The
			result, <Tex tex="m" />, is an average count of tokens per person. With a constant population, it gains
			<Tex tex="u" /> a year and melts at the rate <Tex tex="r" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dm}{dt} = u - r\,m, \qquad m^{*} = \frac{u}{r} \\ m(t) = m^{*} + \left(m_0 - m^{*}\right) e^{-rt} \end{gathered} \tag{${EQ.money}}`} />
		<p>
			At <Tex tex="r = 0.07" />, the steady state is <Tex tex={String.raw`m^{*} \approx ${tn(steadyState())}`} /> per
			person. At this level, the new HEARTS of each year equal the money that melts in that year. However people
			invest, spend or trade, the total moves toward this level from either side. A young city's money rises to it from
			below, and an inflated city's money falls to it from above. The gap halves every {fmt(halfLife(), 1)} years. This
			is the resting state of Godley and Lavoie's simplest model, with the melt in place of a tax <Cite k="godley" />.
		</p>
		<p>
			The economic model of Section 11.2 checks this level.
		</p>
		<p>
			But <Tex tex={String.raw`m^{*}`} /> is a count of tokens, not anyone's wealth. It includes the treasuries and the
			pools, and it adds different MINDs one for one. A single holding follows the same rule with its own net inflow. A
			holding <Tex tex={String.raw`W_i`} /> whose owner adds <Tex tex={String.raw`a_i`} /> a year, net of what they
			spend, tends to <Tex tex={String.raw`W_i^{*} = a_i / r`} />. A person who keeps their half of the MIND that their
			own investing creates, <Tex tex={String.raw`\omega = u/2`} /> a year, and spends nothing, tends to
			<Tex tex={String.raw`\omega/r = u/(2r) \approx ${tn(ownLevel())}`} /> MIND: half of <Tex tex={String.raw`m^{*}`} />.
			The other half goes to the treasury and the pools (Law 4). Treasuries pay most of theirs out again for work
			proposals (the payout rule, Section 4). A person whose net inflow is twice as large tends to twice the holding.
			So every balance moves toward about {fmt(1 / RATE, 1)} years of its own net inflow.
		</p>
		<p>
			The steady state <Tex tex={String.raw`m^{*} = u/r`} /> also needs a constant population. Then money per person
			that starts at or below <Tex tex="u/r" /> stays at or below it, and money that starts above it falls toward it. If
			the population grows at the rate <Tex tex={String.raw`\nu`} /> a year, newcomers share the money. The steady state
			then falls to <Tex tex={String.raw`u/(r + \nu)`} />: {fmt(steadyStateGrowth(0.01))} at 1 % growth and
			{fmt(steadyStateGrowth(0.02))} at 2 %. If the population shrinks, it rises above <Tex tex="u/r" />.
		</p>
		<p>
			A young city also needs time. From nothing, money per person grows from {fmt(balanceAt(0, 1))} in year 1 to
			{fmt(balanceAt(0, 10))} in year 10 and {fmt(balanceAt(0, 30))} in year 30. It reaches 95 % of the steady state
			only after about {fmt(yearsToReach(0.95))} years. During this transition, prices in MIND can rise, unless output
			grows faster (Section 5.3).
		</p>
		<p>
			There is no central bank, no interest rate to set and no inflation target. With a constant population, the money
			supply moves to <Tex tex={String.raw`N u / r`} /> from any start. The whole policy is the five laws and one rate.
			Appendix F says who may change the code that runs them.
		</p>
		<p>
			The same rule levels people. Every balance that sits still melts toward zero, while everyone gets the same
			{UIA_DAY} HEARTS a day. So nobody stays rich by holding, and nobody starts with nothing for long. Nobody collects a
			tax, and nobody decides who gets what. The melt works like a flat levy on every holding, and the daily HEARTS work
			like an equal grant to every person. The levelling comes from the rule itself, while no holding earns more than the
			melt (Section 5.4; Hypothesis H4, Section 10).
		</p>
		<figure>
			<LineChart
				title="From any start, the count of all HEARTS and MINDs per person moves to the same steady state"
				series={conv}
				x={{ min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1_000_000, ticks: [0, 250_000, 500_000, 750_000, 1_000_000], fmt: (v, tip) => (tip ? fmt(v) : v >= 999_500 ? '1 M' : v ? `${fmt(v / 1000)}k` : '0'), label: 'Tokens per person, all holders' }}
				refs={[{ axis: 'y', at: star, label: `steady state u/r = ${fmt(star)}` }]}
			/>
			<div class="control">
				<label for="rate">Demurrage rate <strong>{pct(rate * 100, 1)}</strong> a year</label>
				<input id="rate" type="range" min="0.01" max="0.15" step="0.005" bind:value={rate} />
			</div>
			<figcaption>
				<strong>Figure {FIG.conv}.</strong> The average count of HEARTS and MINDs per person, in wallets, treasuries and pools,
				with a constant population. It is a count of tokens, not anyone's wealth. Three starts: none (a new city), the 7 %
				steady state, and a million per person. All three meet at <Tex tex="u/r" />, and a new city reaches 95 % of it
				after about {fmt(yearsToReach(0.95, rate))} years. Move the slider under the chart to change the rate. A lower
				rate raises the steady state and slows the approach to it. A higher rate does the opposite.
			</figcaption>
		</figure>
		<h3>5.3 Laborde's rule, arrived at from the other side</h3>
		<p>
			Section 3 introduced Stéphane Laborde's universal dividend: money created equally for every member. With ({EQ.money}), we
			can now compare the two systems closely. Laborde derives the rate of the dividend from one requirement: each
			generation must co-create the same share of money over a life of <Tex tex={String.raw`e_v`} /> years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{${EQ.rtm}}`} />
		<p>
			In Laborde's system, the money supply <Tex tex="M" /> of <Tex tex="N" /> members grows, and each member gets
			<Tex tex={String.raw`c\,M/N`} /> a year. Measure a member's balance relative to the average,
			<Tex tex={String.raw`b = B / (M/N)`} />. Because the average grows at the rate <Tex tex="c" />,
			<Tex tex={String.raw`\dot b = c\,(1 - b)`} />. This is Laborde's law: every member's relative position moves toward
			the average at the rate <Tex tex="c" />.
		</p>
		<p>
			<strong>Proposition 1.</strong> <em>With a constant population and at the steady state
			<Tex tex={String.raw`m = m^{*}`} />, a member's balance, measured relative to the average, follows Laborde's law
			with <Tex tex="c = r" />. Outside the steady state, the rate is <Tex tex={String.raw`u/m(t)`} />, not
			<Tex tex="r" />.</em> Take a member who keeps their half of the MIND that their own investing creates, so that
			<Tex tex={String.raw`\dot B_i = u/2 - r\,B_i`} />. If every member does the same, the members hold half of all
			money, <Tex tex="m/2" /> per person. Measure the member relative to that average,
			<Tex tex={String.raw`b_i = B_i / (m/2)`} />. With ({EQ.money}), <Tex tex={String.raw`\dot b_i = \frac{u}{m(t)}\,(1 - b_i)`} />.
			At the steady state, <Tex tex={String.raw`u/m^{*} = r`} />, so <Tex tex={String.raw`\dot b_i = r\,(1 - b_i)`} />:
			Laborde's law with <Tex tex="c = r" />. ∎
		</p>
		<p>
			So the two systems agree once the money has settled. In a young city, the rate <Tex tex={String.raw`u/m(t)`} />
			starts high and falls to <Tex tex="r" />. From nothing, it is {pct(relativeRate(1) * 100, 1)} in year 1,
			{pct(relativeRate(10) * 100, 1)} in year 10 and {pct(relativeRate(30) * 100, 1)} in year 30. So a young city
			levels its members faster than Laborde's system would, while <Tex tex={String.raw`u/m(t)`} /> stays above
			Laborde's <Tex tex="c" />. Two differences remain. In Laborde's system every member
			gets all of the new money; in theOS a member gets half, and the other half goes to the COOP's treasury and the
			city's pools. And Laborde derives
			<Tex tex="c" /> from a life span, while the model here has no births or deaths.
		</p>
		<p>
			Laborde keeps the universal dividend relative and lets the amount of money grow. theOS keeps the issuance fixed
			and lets the money melt. What theOS gains is a unit that people can think in, 24 a day, one per hour. And once the
			money has settled, prices no longer drift upward with a growing money supply. They can fall as output grows. A young
			city is different. Its money per person grows about {fmt(balanceAt(0, 30) / balanceAt(0, 1))}-fold from year 1 to
			year 30. If people spend a steady share of what they hold, Fisher's equation says that prices in MIND rise by
			about the same factor, unless output grows faster. Whether it does is Hypothesis H8 (Section 10).
		</p>
		<p>
			theOS does not take its rate from ({EQ.rtm}). The pair of {CIRCLES.day} a day and {pc(CIRCLES.rate)} a year comes from
			Circles v2 (Section 3) <Cite k="circles2" />. Circles takes its {pc(CIRCLES.rate)} as a yearly rate, applied day by day. theOS melts continuously, so 7 %
			a year takes {pct(yearlyLoss() * 100, 1)} of an idle balance in a year. Read through ({EQ.rtm}), 7 % matches a life of
			<Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years, so it is gentler than Laborde's
			{pct(rtmRate(80) * 100, 1)} for an 80-year life. 7 % also has reasons of its own. It sets the half-life of any
			idle holding, and of any advantage, at {fmt(halfLife(), 1)} years: a fortune that earns less than the melt fades
			within a lifetime (Section 5.4), while a
			balance left idle for ten years still keeps {pct(decay(100, RATE, 10))} of its value. It sets the steady state at
			{fmt(1 / RATE, 1)} years of issuance, a level that people can picture. And it sets the fairness dial of Section
			9.2. A lower rate allows more inequality, and a higher rate makes long saving much harder. Section 12.5 makes the rate a parameter
			for the test city.
		</p>
		<h3 id="returns">5.4 The melt against returns</h3>
		<p>
			Every holding melts at the rate <Tex tex="r" />, {pc(RATE)} a year. But a holding of MIND can also earn: its COOP pays dividends
			(Law 5), and its price can rise.
		</p>
		<div class="law concept">
			<p class="lawname"><span class="kind">Concept</span>The lasting return</p>
			<p>
				The <em>lasting return</em> <Tex tex={String.raw`\mu`} /> of a holding is the dividend yield of its COOPs,
				plus any lasting rise of their prices, as a share of the holding a year.
			</p>
		</div>
		<p>
			A holding that is not spent then shrinks at the net rate <Tex tex={String.raw`r - \mu`} />. Its half-life is
			<Tex tex={String.raw`\ln 2/(r - \mu)`} />, not <Tex tex={String.raw`\ln 2/r`} />.
		</p>
		<p>
			A holding that earns half the melt, <Tex tex={String.raw`\mu = r/2`} />, halves in
			{fmt(netHalfLife(RATE / 2), 1)} years, not in {fmt(halfLife(), 1)}. So a holding shrinks only while
			<Tex tex={String.raw`\mu < r`} />. If <Tex tex={String.raw`\mu \ge r`} />, it grows for as long as its return
			lasts, and the melt no longer levels it.
		</p>
		<p>
			Law 5 sets the dividend part of <Tex tex={String.raw`\mu`} />. Let <Tex tex={String.raw`\lambda`} /> be Law 5's
			share of every sale, {pc(DIVIDEND_SHARE)}. A COOP's dividend yield is <Tex tex={String.raw`\lambda`} /> times
			its yearly sales, divided by the MIND that others hold. So the yield alone stays below the melt while yearly sales
			stay below <Tex tex={String.raw`r/\lambda`} />, which is {pc(salesBound())} of the MIND that others hold.
			Section 9.2 shows what <Tex tex={String.raw`\mu`} /> does to the spread of ownership. Whether
			<Tex tex={String.raw`\mu`} /> stays below the melt is Hypothesis H4 (Section 10).
		</p>
		<p>
			Money now has a source, a form and a limit. Section 4 promised that any MIND can pay for anything, because the
			pools convert it. Section 6 shows how thousands of MINDs stay tradeable.
		</p>
	</section>

	<section id="pol">
		<h2><span>6</span>Keeping every MIND tradeable</h2>
		<p>
			With thousands of COOPs, there are thousands of MINDs. People must be able to trade each of them at any moment; in
			other words, each MIND must be <em>liquid</em>. theOS uses automated market makers (AMMs) for this. An AMM is a
			pool of currencies that sets their exchange rates from the ratios of its reserves. So anyone can trade against a
			formula at any time, and nobody has to wait for a buyer or a seller <Cite k="uniswap" />. Such pools give reliable
			public prices when traders can compare them with an outside market <Cite k="angeris" />. In theOS the pools are
			the market. So arbitrage keeps their prices consistent with each other, but not always right. MIND prices need not
			be equal either. Section 6.3 shows them all in one unit, the HEART.
		</p>
		<p>
			The best-known AMMs pair two currencies, and outside investors supply them and can withdraw their money again.
			theOS does neither. Its pools hold baskets of many MINDs, and together they are the city's liquidity pool. We
			call them <em>the city's pools</em>. A pool issues <em>LP tokens</em> (liquidity-provider tokens) for what
			enters it: shares that say who owns the pool. The City COOP of Section 4 holds them all.
		</p>
		<div class="law" id="lp">
			<p class="lawname"><span class="kind">Rule</span>The pools and their LP tokens</p>
			<p>
				Law 4 sends the pools' part of each new MIND, {fmt(POOL_SHARE, 1)} of each HEART, into the city's pools, in the
				COOP's own MIND. It comes out of the half that does not go to the investor. What a COOP earns by selling is not
				levied. Each pool holds a basket of {POOL.min} to {POOL.max} different MINDs, and the COOP chooses which baskets
				its MIND joins. Each deposit makes LP tokens, and they go to the City COOP, not to the COOP that deposits. The
				City COOP may redeem LP tokens only by a passed MIP, a vote of its members (Section 8.2). What it redeems goes
				to its own treasury, never to a person and never as HEARTS. A redemption of LP tokens by a passed MIP moves MIND
				to the City COOP; it destroys none. So MIND leaves a pool in four ways only: through trades, by melting, when its
				COOP fails and its MIND is retired (Section 12.3), or by such a redemption. The pools also route every payment:
				a buyer pays in any MIND, and the seller always gets its own.
			</p>
		</div>
		<p>
			So a COOP starts life in two parts. First, people invest their HEARTS. A HEART converts at the moment of
			investment (Law 4), so no COOP and no pool ever holds one. Second, the COOP partners with at least
			{POOL.partners} other COOPs, whose MINDs join its own MIND in its first basket. Only then can people trade its
			MIND.
		</p>
		<p>
			For example, the solar COOP's solarMIND might sit in one basket with tramMIND, agriMIND and steelMIND. It might
			sit in another basket with waterMIND, computeMIND, habitatMIND and artsMIND. When Anna pays for a tram ride with
			solarMIND, her Aven sends it into a basket that holds both. The basket converts it, and the tram COOP gets only
			tramMIND, whatever its passengers hold. Figure {FIG.pools} shows both jobs of the pools.
		</p>
		<figure>
			<PoolFlow />
			<figcaption>
				<strong>Figure {FIG.pools}.</strong> The city's pools. Law 4 sends the pools' part of each new MIND,
				{fmt(POOL_SHARE, 1)} of each HEART, into baskets of {POOL.min} to {POOL.max} MINDs; here two baskets hold
				solarMIND. Each deposit makes LP tokens for the City COOP. When Anna pays for a tram ride with solarMIND, the
				pools convert it, and the tram COOP gets tramMIND.
			</figcaption>
		</figure>
		<h3>6.1 The design: one equal-weight basket</h3>
		<p>
			theOS uses only one pool design: the <em>geometric mean market maker</em>. We chose it because it is the most
			widely used design for pools of {POOL.min} to {POOL.max} volatile currencies. Balancer's weighted pools have used it since 2020
			<Cite k="balancer evans" />, and they now hold up to eight tokens, the same range as a theOS basket
			<Cite k="balancerDocs" />. Its incidents include pools drained through tokens whose balances changed outside trades
			<Cite k="theblock20" />, and a costly rounding bug <Cite k="balancerHack" />. Melting MINDs are such tokens, so
			theOS pools apply the melt through one global index and never change a reserve directly (Section 12.3).
		</p>
		<p>
			Every pool holds <Tex tex="n" /> = {POOL.min} to {POOL.max} MINDs in equal shares, <Tex tex={String.raw`w_i = 1/n`} />. With
			<Tex tex={String.raw`x_i`} /> of MIND <Tex tex="i" /> in the pool, it keeps
		</p>
		<Tex display tex={String.raw`\begin{gathered} \prod_{i=1}^{n} x_i^{\,1/n} = K \\ p_{ij} = \frac{x_i}{x_j}, \qquad \text{fee } \varphi = ${tn(POOL.fee * 100, 1)}\,\% \end{gathered} \tag{${EQ.pool}}`} />
		<p>
			Every trade keeps the geometric mean of the reserves constant. Only fees and inflows raise it, and only the melt
			lowers it. The price of MIND <Tex tex="j" /> in MIND
			<Tex tex="i" /> is simply the ratio of their reserves. At fair prices, each MIND is an equal share of the pool's
			value. So a basket behaves like an index that rebalances itself. Four more choices complete the design:
		</p>
		<ul>
			<li>
				<strong>A fixed fee of {pct(POOL.fee * 100, 1)}</strong> on every trade, the usual level for volatile currencies, whose prices move
				a lot. Arbitrage is trading to profit from a price difference between two markets. A fee widens the band of
				prices in which arbitrage does not pay <Cite k="lvrfees" />. There are no outside liquidity providers, so no
				investor collects the fee. It stays in the pool and makes the pool larger, and so it adds to what the City COOP's
				LP tokens stand for.
			</li>
			<li>
				<strong>One-sided deposits.</strong> Each COOP deposits only its own MIND, and the LP tokens go to the City
				COOP (the box above). So the city's liquidity belongs to all its citizens.
			</li>
			<li>
				<strong>Inflows in small slices.</strong> A large inflow moves a price at once, and arbitrageurs take the gap. So
				the protocol adds inflows a little at a time, in every new block of transactions, as in the time-weighted AMM
				<Cite k="twamm" />.
			</li>
			<li>
				<strong>Routing by Avens.</strong> Avens, the personal AI agents of Section 7, route each trade. A trade between
				two MINDs goes through the pools that hold them. The best way to divide a trade across many pools is a convex
				problem: computers solve it fast, to any accuracy that we choose <Cite k="angerisMulti routing" />. Each extra
				hop also costs a fee, and that fixed cost makes the full problem harder. Section 12.3 proposes a hub MIND that
				keeps routes short.
			</li>
		</ul>
		<p>
			One property fits theOS especially well. Every MIND in a basket melts at the same {pc(RATE)} a year. So demurrage shrinks
			every reserve by the same factor, and every price in ({EQ.pool}) stays the same. Melting creates no trading opportunity
			inside a basket.
		</p>
		<h3>6.2 The cost of liquidity, and who carries it</h3>
		<p>
			A pool is not free. When prices move in other markets, arbitrageurs trade against the pool until its prices match.
			The pool then loses what a perfect rebalancer would not lose. The name for this cost is
			<em>loss-versus-rebalancing</em> (LVR). For a geometric mean pool, it is a steady share of the pool's value each
			year <Cite k="lvr" />.
		</p>
		<p>
			Take the volatilities <Tex tex={String.raw`\sigma_i`} /> of the MINDs: how strongly each price moves. Take also
			the covariance <Tex tex={String.raw`\Sigma`} /> of their price moves: how the prices move together. Then the
			yearly cost <Tex tex={String.raw`\ell`} />, as a share of the pool's value <Tex tex="V" />, is
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{\ell}{V} = \tfrac12\Big(\sum_i w_i \sigma_i^2 - w^{\top}\Sigma\,w\Big) \\ \overset{w_i = 1/n}{=}\; \tfrac12\,\sigma^2 (1-\rho)\Big(1 - \frac1n\Big) \end{gathered} \tag{${EQ.lvr}}`} />
		<p>
			The right-hand side holds for equal weights, one common volatility <Tex tex={String.raw`\sigma`} /> and one common
			correlation <Tex tex={String.raw`\rho`} />: how closely prices move together. Equation ({EQ.lvr}) assumes random-walk prices
			and arbitrage without fees <Cite k="lvr" />. The cost grows with how much MINDs move against one another, and the
			{pct(POOL.fee * 100, 1)} fee wins part of it back <Cite k="lvrfees" />.
		</p>
		<p>
			In theOS, the city's pools carry this cost, not any one wallet. The MIND in Anna's wallet is never part of a
			pool. But the cost is real, and people pay it together, through the pools' part of every new MIND (Law 4). What
			the pools lose goes to arbitrageurs, to whoever orders the transactions and to the fastest Avens. A speculative
			attack can make a pool smaller, but every COOP's working capital and its turbines keep going. Clearing trades in
			batches at one price could cut the cost further <Cite k="fmamm" />. But the analysis so far covers only
			two-currency pools, so theOS treats it as an upgrade to test in the test city (Section 12.3).
		</p>
		<figure>
			<LineChart
				title="Yearly loss-versus-rebalancing of an equal-weight basket against its number of MINDs"
				series={lvr}
				x={{ min: 2, max: POOL.max, ticks: [2, 3, 4, 5, 6, 7, 8], fmt: (v, tip) => (tip ? `${fmt(v)} MINDs` : `${v}`), label: 'MINDs in the basket' }}
				y={{ min: 0, max: 8, ticks: [0, 2, 4, 6, 8], fmt: (v, tip) => `${fmt(v, tip ? 2 : Number.isInteger(v) ? 0 : 1)} %`, label: 'LVR a year, share of the pool' }}
				refs={[{ axis: 'x', at: POOL.min, label: 'minimum basket' }]}
			/>
			<figcaption>
				<strong>Figure {FIG.lvr}.</strong> The cost ({EQ.lvr}) of keeping a basket liquid, before the fee wins part of it back. It
				assumes prices that move as a random walk, at volatilities like those of large company shares. In a basket of
				{LVR_CASES.n[0]}, calm MINDs ({pc(LVR_CASES.calm)} volatility) cost
				{pct(basketLvr(LVR_CASES.n[0], LVR_CASES.calm) * 100, 1)} of the pool a year. Wild MINDs ({pc(LVR_CASES.wild)})
				cost {pct(basketLvr(LVR_CASES.n[0], LVR_CASES.wild) * 100)}. When MINDs move together (correlation
				{fmt(LVR_CASES.rho, 1)}), the cost falls to {pct(basketLvr(LVR_CASES.n[0], LVR_CASES.wild, LVR_CASES.rho) * 100, 1)}.
				Going from {LVR_CASES.n[0]} to {LVR_CASES.n[1]} MINDs adds only about
				{pct((basketLvr(LVR_CASES.n[1], LVR_CASES.wild) / basketLvr(LVR_CASES.n[0], LVR_CASES.wild) - 1) * 100)}.
			</figcaption>
		</figure>
		<h3>6.3 HEARTS: the universal display and unit of account</h3>
		<p>
			A price needs a unit. One solarMIND buys some kWh, and one agriMIND buys some food. But one of what? Every COOP
			prices in its own MIND, so theOS needs one unit in which to show and compare all values. That unit is the HEART. A
			<em>unit of account</em> is the unit in which people write prices and keep their books. In German it is the
			<em>Rechnungseinheit</em>, and economists call it a <em>numéraire</em>. It need not be what people pay with.
		</p>
		<p>
			Why the HEART? Because every MIND starts as one. Each invested HEART makes exactly one MIND (Law 4). HEARTS and
			MINDs melt at the same {pc(RATE)} a year. So the MINDs that
			exist are the HEARTS that people invested, less the same melt and less the MIND of COOPs that ended. The pools set
			only relative prices: how many of one MIND trade for one of another. Nothing in them says what the average MIND is
			worth. theOS fixes that one free number.
		</p>
		<div class="law concept">
			<p class="lawname"><span class="kind">Concept</span>The unit of account</p>
			<p>
				Every value is shown in HEARTS. The average MIND, weighted by how much of each exists, is worth exactly 1
				HEART. The HEART is for display only: every payment is in MIND.
			</p>
		</div>
		<p>
			Let <Tex tex="s_k" /> be the supply of MIND <Tex tex="k" />: all of it that exists, in wallets, treasuries and
			pools. Let <Tex tex="p_k" /> be its pool price against one MIND, the same one for every <Tex tex="k" />. Then the
			value of MIND <Tex tex="k" /> in HEARTS is
		</p>
		<Tex display tex={String.raw`\begin{gathered} v_k = \frac{p_k}{\bar p}, \qquad \bar p = \frac{\sum_j s_j\, p_j}{\sum_j s_j} \\ \Rightarrow\; \sum_k s_k\, v_k = \sum_k s_k \end{gathered} \tag{${EQ.unit}}`} />
		<p>
			In words: all MIND together is worth as many HEARTS as there are MINDs. The MIND that the prices are measured
			against drops out, because it scales every <Tex tex="p_k" /> and <Tex tex={String.raw`\bar p`} /> alike. So the
			HEART needs no anchor MIND: no cityMIND, no chosen basket and no reference COOP that might fail. We propose that
			the protocol publishes every <Tex tex="v_k" /> from time-averaged pool prices.
		</p>
		<p>
			The HEART is for display only. Each Aven shows every balance and every price first in HEARTS, with the amount of
			MIND in small type. The rule never changes a trade, a price or a payment. Every payment is in MIND. Three things the HEART is
			not:
		</p>
		<ul>
			<li>
				<strong>Not a peg.</strong> Nobody trades a MIND for a HEART at 1, and nobody can. A MIND whose COOP delivers
				more rises above 1 HEART, and one whose COOP delivers less falls below it. Only the average is fixed. Anyone
				can turn 1 HEART into 1 new MIND of any COOP. So a MIND worth more than 1 HEART draws new HEARTS, and the new
				MIND shares its rise with its new holders (Section 8.1).
			</li>
			<li>
				<strong>Not a price.</strong> Nobody pays in HEARTS (Law 2).
			</li>
			<li>
				<strong>Not a promise of what a HEART buys.</strong> What 1 HEART buys in goods moves with what the COOPs
				deliver. In this, the HEART is like the IMF's Special Drawing Right (SDR). The SDR is a unit of account whose
				value comes from a basket of five currencies, and it is neither a currency nor a claim <Cite k="imf" />. Keynes's
				bancor was to be such a unit too, for clearing between central banks, not money that people hold
				<Cite k="keynes43" />. The HEART's basket is every MIND, weighted by supply, and it changes as COOPs start and
				end.
			</li>
		</ul>
		<p>
			Three cases need care. <strong>A failing COOP.</strong> As its MIND falls, the fixed average lifts every other
			MIND a little in HEARTS. When the COOP fails, its MIND leaves the pools and is retired (Section 12.3). It then
			leaves both sides of ({EQ.unit}), and its holders lose what it was worth. So a value in HEARTS is a share of all
			MIND, not an amount of goods. <strong>A new MIND.</strong> Until its first basket trades, the pools cannot price
			it. It counts at 1 HEART, the HEART that made it. <strong>The investor's half.</strong> A HEART makes one MIND,
			but the investor gets only half of it. So a person's {UIA_DAY} HEARTS a day give them {UIA_DAY / 2} MIND of their
			own, worth about {UIA_DAY / 2} HEARTS, not {UIA_DAY} (Section 11.2.2 measures it). The other half works in the COOP's treasury and in the city's pools, and people own the COOPs.
		</p>
		<p>
			So the HEART is the right unit for the rest of this paper. Each new MIND is worth about 1 HEART, so a person's new
			ownership has the same value in HEARTS every year. In any unit tied to chosen MINDs, that value drifts.
		</p>
		<p>
			A second yardstick is closer to life: a <em>day of living</em>. It is what an average person consumes in a day,
			priced in HEARTS that year. One person's basics for a day, the <em>basic bundle</em>, are
			{fmt(BASIC_BUNDLE.kcal)} kcal of food, {BASIC_BUNDLE.L} L of water, {BASIC_BUNDLE.kWh} kWh of energy and
			{BASIC_BUNDLE.m2} m² of home. Section 11.2.2 shows how both moved in the simulation.
		</p>
		<p>
			MIND values do not settle at 1 HEART. Equal values would mean that every COOP delivers the same for its MIND, and
			in a changing world they do not. A MIND is worth what its COOP delivers for it, plus what it pays its holders,
			shared with everyone who invests later (Section 8.1). A COOP that loses its market is worth less, and its MIND can
			end at zero. Section 11.2.2 shows how far values spread in the simulation.
		</p>
		<p>
			An earlier version measured values in R, a basket of three MINDs; Appendix G says why we retired it.
		</p>
		<p>
			Through the pools, anyone can now trade a MIND that sits in a basket for any other MIND that the baskets connect
			to. But no person can follow thousands of currencies and their prices. The next layer does that work for them.
		</p>
	</section>

	<section id="avens">
		<h2><span>7</span>Avens: an agent for every person</h2>
		<p>
			Herbert Simon showed that people decide with limited time and knowledge, so they settle for a choice that is good
			enough <Cite k="simon" />. He called this limit bounded rationality. George Miller found that people can hold only
			about seven items in mind at once <Cite k="miller" />. These limits are not flaws that education can remove. They
			are the design constraint. So theOS gives every person an Aven: a personal AI agent that works only for its human.
			People decide on values and goals, and Avens do the arithmetic and the work. Avens do all the work, so no human
			labour is paid (Section 4). Each person makes two choices:
		</p>
		<ol>
			<li>
				<strong>Where today's HEARTS go:</strong> for example, {UIA_DAY / 2} to a fusion COOP and {UIA_DAY / 2} to an
				art COOP. This choice decides which infrastructure people build or maintain next. A person sets the aim, and
				their choice always overrides the default. Without a choice, the Aven follows the city's default rule (the box
				below).
			</li>
			<li>
				<strong>The life one wants to draw on:</strong> a mix of MINDs, for example 40 % agriMIND, 30 % solarMIND and
				30 % computeMIND. Through the pools, the Aven trades the MINDs that its human holds into that mix.
			</li>
		</ol>
		<div class="law policy">
			<p class="lawname"><span class="kind">Policy</span>The Avens' default investment rule</p>
			<p>
				Where a person has not chosen, their Aven invests by the city's default rule. The City COOP sets it by MIP, and
				every Aven shows it to its person. Its current value, which the economic model uses: {pc(AVEN_RULE.share)} of a
				person's HEARTS go into the {AVEN_RULE.top} MINDs with the highest price × (1 + {AVEN_RULE.yieldWeight} ×
				dividend yield), and the rest by the person's own values. A new COOP gets other people's HEARTS only after its
				pool has traded for a year.
			</p>
		</div>
		<p>The Aven does the rest.</p>
		<ul>
			<li>
				<strong>Keeping money at work.</strong> Every MIND melts alike (Section 5.1), so the Aven keeps idle balances
				small. It invests HEARTS as they arrive. It keeps
				as MIND what its human wants to own, and pays for daily life from a small float.
			</li>
			<li>
				<strong>Doing the work.</strong> The Aven makes work proposals to COOPs and delivers them with the COOPs'
				machines: work that keeps a COOP running, and new work (Section 4). The COOP pays the Aven's human in its own MIND. Work
				proposals are open to every Aven, and they include care work and public work for the City COOP. Avens differ in
				what they deliver, so their humans' pay differs too (Section 9.2). This is how most MIND flows from the
				treasuries back to people, and how COOPs grow what they can make.
			</li>
			<li>
				<strong>Living from what one owns.</strong> Under Law 5, a share of every sale goes at once to everyone who
				holds the seller's MIND. These dividends are meant to let a person live from what they own (Hypothesis H3,
				part 2, Section 10). The Aven collects them and keeps them as ownership, or trades them through the
				pools into the MINDs that its human wants to own. Spreading its human's MIND over many COOPs also keeps the
				risk small (Section 9.2).
			</li>
			<li>
				<strong>Choosing a seller.</strong> For each purchase, the Aven buys from the rival COOP with the lowest price,
				and it can switch every day (Section 9.1).
			</li>
			<li>
				<strong>Choosing what to hold.</strong> We propose that the Aven keeps enough MIND of COOPs that sell a lot to
				cover its human's basics, and spreads the rest over many COOPs. It pays first with the MIND that earns its human
				the least. This is the mechanism of Hypothesis H11 (Section 10); the Avens of the economic model do not do this
				yet.
			</li>
			<li>
				<strong>Paying without thinking.</strong> When Anna takes a tram, her Aven finds the cheapest route through the
				pools of Section 6. The route goes from the MINDs she holds to the MIND that the tram COOP accepts. The Aven
				pays in the same moment. The economic model measures what the pool fees on such payments cost people (Section
				11.2.2).
			</li>
			<li>
				<strong>Leaving a bad COOP.</strong> If a COOP becomes corrupt or wasteful, it delivers less for its MIND. Then
				its MIND falls in price against the other MINDs in the pools. The Aven sees the fall and moves its human's
				investment and spending to a better COOP. Albert Hirschman named the two
				ways that members discipline an organisation: <em>exit</em>, leaving for a better one, and <em>voice</em>,
				speaking up from inside <Cite k="hirschman" />. Avens make exit easy and continuous.
			</li>
		</ul>
		<p>
			Prices here do what Hayek asked of them: they carry knowledge that no planner holds <Cite k="hayek45" />. The many
			competing MINDs also recall his proposal for competing private currencies <Cite k="hayek76" />, with two
			differences. Hayek expected competition to select the most stable money, and every MIND melts on purpose. And
			every MIND comes from HEARTS issued equally to every person, not from whoever is able to issue money. With people,
			COOPs, pools and Avens in place, we can now ask what the system changes in the long term.
		</p>
	</section>

	<section id="infra">
		<h2><span>8</span>Building for the long term: land, the euro and energy</h2>
		<p>
			In capitalism, long-lived infrastructure is hard to finance, because every project competes with a safe
			alternative. That alternative is a government bond: a loan to the state that pays a fixed return for doing
			nothing. A tidal barrier that serves for generations must beat that return and also a risk premium, the extra
			return that investors want for a risk. Gesell and Keynes both saw this floor that a positive return on money puts
			under every investment <Cite k="gesell keynes36" />.
		</p>
		<p>
			In theOS, there is no safe alternative inside the city. HEARTS cannot be lent or parked; they can only be
			invested (Law 2). Outside the city, euros remain a safe alternative for anyone who earns them (Section 8.3).
			Inside it, a project does not have to beat a bond. But it competes for HEARTS with every other MIND, and by
			default an Aven puts HEARTS where price and dividends are highest (the Avens' default rule, Section 7). Idle HEARTS earn nothing and melt. MIND earns
			only what its COOP sells or gains in price. A MIND pays its holder only through its COOP's success: a share of
			its sales, or a higher price. The higher price is hard to keep, because a MIND above 1 HEART draws new HEARTS,
			and the new MIND shares the rise (Section 6.3).
		</p>
		<p>
			What lasts is what the investment built: grids, water systems, domes, rail. So the only way to make intent last
			is to build what people keep using. Who gains from what lasts?
		</p>
		<h3 id="gains">8.1 Who gains from long-lived projects</h3>
		<p>
			Law 4 decides who gains. Every HEART invested makes a new MIND, which shares any rise with its new holder (Section
			6.3). So we expect a city-scale project's rising value to go to its users and to the new investors who fund each
			stage. Long-term holders gain through Law 5 on growing sales, not through a rising price (Hypothesis H5, Section
			10).
		</p>
		<p>
			What the city keeps using is the users' gain. Every resident who uses the grid, the water and the homes pays the
			price of the day for them. So the users gain what the project goes on giving, and the new investors who fund each
			stage share its rise. Section 11.2.4 gives what the economic model found.
		</p>
		<p>
			How does a long project get its capital? A HEART converts on the day it is invested, so nobody can save HEARTS
			for a project. Residents can pledge future HEARTS to a project as a standing order, and each HEART converts on its
			day. Machines from outside the city cost euros. The City COOP gives the project a euro loan, and the project repays
			it in its own MIND, without interest (Section 8.3). Two questions stay open: how the City COOP sets the ground
			rent, and whether ground rent counts as a Law 5 sale; and whether Avens fund long projects as readily as short
			ones (Sections 12.2 and 12.4).
		</p>
		<h3 id="land">8.2 Land that nobody can sell</h3>
		<p>
			Section 2 ended on Keynes's warning: when money melts, wealth flees into whatever does not melt, and the largest
			such store is land. If land could be bought, the success of every COOP would end up as a higher land
			price, and the owners of land would collect it without building anything. Henry George showed that this rent is
			value that the whole community creates <Cite k="george" />. theOS closes this door with one rule.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>The land rule</p>
			<p>
				All land belongs to the City COOP. Every citizen holds one equal share in it. Nobody can sell or buy
				land or a share. Whoever wants to build, a person or a COOP, leases a plot and pays a yearly ground rent in MIND.
				The rent can be paid in any MIND; the pools convert it, and the City COOP receives its own cityMIND.
			</p>
		</div>
		<p>
			A lease works like the German <em>Erbbaurecht</em>, a heritable building right. It runs for a long, fixed term,
			and what the builder builds belongs to the builder for that term. When the term ends, the plot returns to the City
			COOP, and the lease can start again. The ground rent follows the value of the location. A plot near the tram and
			the market costs more than a plot at the edge, because the city around it makes it worth more.
		</p>
		<div class="law policy">
			<p class="lawname"><span class="kind">Policy</span>Ground rent</p>
			<p>
				The City COOP sets each plot's rent anew at fixed intervals, by auction or by the lessee's own published value,
				so that no lessee can keep the value of the land for itself. It chooses between the two by MIP. Its level is
				not set yet, and whether ground rent counts as a Law 5 sale is open (Section 12.4).
			</p>
		</div>
		<p>
			So the value that the city creates returns to the city. Nothing shared sits outside the City COOP: what
			all citizens share, such as streets, parks and water, the City COOP holds and runs, and the ground rent pays for
			it. Every citizen's share is equal, comes with citizenship and ends with
			it. It is a membership, not money and not a MIND, so it does not bend Law 4, and nobody can collect land the way
			that people collect money. So land can no longer store private wealth. Other stores remain, such as buildings
			and euros (Section 12.4).
		</p>
		<p>
			The City COOP decides by one vote per citizen share. A proposal that its members pass is a <em>MIP</em>, a
			MaiaCity improvement proposal. Only a passed MIP can redeem LP tokens (Section 6), and the same vote decides on
			changes to the code (Appendix F).
			<!-- for Samuel to confirm: MIP = MaiaCity improvement proposal -->
		</p>
		<p>
			Land is one door out of the melt. The euro is the other.
		</p>
		<h3 id="euro">8.3 The euro border</h3>
		<p>
			Panels, chips, medicine and insurance cost euros, and taxes are due in euros, even on services paid in MIND. No
			supplier outside the city accepts solarMIND. The alternative currencies that lasted kept a bridge to national
			money; the Chiemgauer charges a fee to change back into euros <Cite k="gelleri" />. theOS keeps one bridge, and
			the City COOP holds it.
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>The euro border</p>
			<p>
				The City COOP is the city's euro bank, and every euro crosses the border through it; in maiaCITY that is the
				MaiaCity COOP. It gives COOPs euro loans for machines, imports and taxes, and each COOP repays its loan in its
				own MIND, without interest. The City COOP makes no MIND from euros, and no person changes MIND into euros.
			</p>
			<p>
				<em>Policy, the loan terms:</em> the City COOP sets them by MIP. In the test city, a COOP repays a
				{TEST_CITY.bank.repayWeeks}th of what it owes each week, at most {pc(TEST_CITY.bank.repayCap)} of its own MIND
				in its treasury that week.
			</p>
		</div>
		<p>
			Outside the city, anyone may still take a job for euros. Inside it, there are only work proposals. COOPs that
			sell power, heat, food or services outside the city earn euros, and these euros go through the City COOP too.
			We expect these exports to repay the euros that the city needs (Hypothesis H9, Section 10). One legal form carries all of this: an <em>umbrella eG</em>, a registered cooperative whose divisions
			are the COOPs. Investing a HEART makes the investor a member with one vote. Each COOP keeps a euro balance sheet
			as a division, publishes a euro reference price and keeps a tax reserve. A COOP that grows large becomes its own
			eG. Section 12.4 lists what stays open at the border.
		</p>
		<p>
			Land and the euro are the city's two doors. Energy is its physical limit, and it reaches every recipe.
		</p>
		<h3 id="energy">8.4 Energy, the master resource</h3>
		<p>
			Money only counts what the city makes. Physics sets what it can make, and energy above all. Every <em>recipe</em>,
			the inputs and energy that make one unit of a good, costs energy: food and pumped water, glass at about {fmt(ENERGY.recipes.glass, 1)} MWh a tonne, steel at about
			{fmt(ENERGY.recipes.steel, 1)}, timber, building, transport, and every Aven's thinking. Soddy saw this a century
			ago (Section 2). Ayres and Warr showed that useful work, together with capital and labour, explains long-run
			growth <Cite k="ayres" />. Lindenberger and Kümmel found that energy adds far more to output than its share of
			cost <Cite k="kummel" />.
		</p>
		<p>
			What counts is <em>net energy</em>: what the harvesters give, minus the energy to build and run them. What they
			give, divided by what they cost, is the <em>energy return on investment</em>, or EROI. A dome's solar cells pay
			back the energy that made them in about {fmt(ENERGY.pvPayback, 1)} years <Cite k="fraunhofer" />. Murphy and Hall
			showed that growth gets harder as EROI falls <Cite k="murphy" />.
		</p>
		<p>
			So growth is paid in energy. Avens buy basics first, so basics outbid building and research, and research gets
			the energy that is left. Recipes improve by making more: by Wright's law, each doubling of all the output so far cuts the
			cost of a unit by a fixed share <Cite k="wright" />. They also improve by searching. Both stop at physical floors:
			about {pc(ENERGY.floors.sq)} of sunlight for one single-junction solar cell <Cite k="shockley" />, at most
			{pc(ENERGY.floors.photosynthesis, 1)} (C3 plants) to {pc(ENERGY.floors.photosynthesisC4)} (C4 plants) of sunlight
			into food <Cite k="zhu" />, and about {fmt(ENERGY.floors.steelMin, 1)} MWh for a tonne of steel from ore, the
			practical minimum. theOS aims for abundance that only physics limits: no growth cap, no price cap, and never a lack
			of MIND (Hypothesis H7, Section 10). Appendix H lists every limit.
		</p>
		<p>
			Take {ENERGY.dome.people} people in one great dome, with solar cells and no geothermal plant. A limit
			<em>binds</em> when it is the input that runs out first, so it sets how much the city can make. The cells give
			{fmt(ENERGY.dome.harvest, 1)} GWh a year, and homes use {fmt(ENERGY.dome.use, 2)}. The surplus could build the
			glass, steel and timber of one more dome in about {fmt(domeYears(), 1)} years: about {fmt(bedsFromEnergy())} beds
			a year. But for homes, wood binds first: the city's {ENERGY.wood.ha} ha give wood for about {ENERGY.wood.beds} beds
			a year. For every other build, and for research, net energy binds first.
		</p>
		<p>
			In December the cells give {ENERGY.dome.decHarvest} MWh against at least {ENERGY.dome.decUse}, a gap of at least
			{decemberGap()} MWh. So in winter even the basics need stored energy or geothermal heat. Anna's Aven buys power
			for her lamp first, so basics outbid building and research. When Mia's Aven proposes a better cell, the solar COOP can pay for the
			research only from the summer's surplus. Table {TAB.binds} shows the limits in order.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.binds}.</strong> What binds first in a small city of {ENERGY.dome.people} people in one dome with solar cells. These are design numbers for the test city (Appendix H).</caption>
				<thead>
					<tr><th>Limit</th><th>In numbers</th><th>When it binds</th></tr>
				</thead>
				<tbody>
					<tr><td>Net energy</td><td>{fmt(ENERGY.dome.harvest, 1)} GWh a year from the cells, {fmt(ENERGY.dome.use, 2)} used at home; in December {ENERGY.dome.decHarvest} MWh against at least {ENERGY.dome.decUse}</td><td>First: for research, for every build except homes, and in winter, when even basics need storage or geothermal heat</td></tr>
					<tr><td>Land, as wood</td><td>{ENERGY.wood.t} t of wood a year from {ENERGY.wood.ha} ha: about {ENERGY.wood.beds} beds a year, against about {fmt(bedsFromEnergy())} from the energy surplus</td><td>First for homes</td></tr>
					<tr><td>The food forest's age</td><td>{pc(ENERGY.forest.y1)} of the food in year 1, all of it in year {ENERGY.forest.fullYear}</td><td>First for the basics in years 1 to {ENERGY.forest.fullYear - 1}, unless the city starts with food</td></tr>
					<tr><td>Land, as food area</td><td>Fixed, all with the City COOP</td><td>Only when the population grows on fixed land</td></tr>
					<tr><td>Water</td><td>{ENERGY.water.supply} L of rain a bed a day, against {ENERGY.water.need} L of fresh water</td><td>Last: only in a year {pc(ENERGY.water.dry)} drier than normal</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			With a geothermal plant, a full village of {fmt(ENERGY.village.people)} people can harvest
			{fmt(kwPerPerson(ENERGY.village.el), 1)} kW of electricity and up to {fmt(kwPerPerson(ENERGY.village.heat), 1)} kW of
			heat for each person. They use about {fmt(kwPerPerson(ENERGY.village.useEl), 1)} kW of electricity each. Smil found
			that quality of life stops rising at about {fmt(gjToKw(ENERGY.smilGJ[0]), 1)} to {fmt(gjToKw(ENERGY.smilGJ[1]), 1)}
			kW of primary energy a person <Cite k="smil" />. The comparison is rough. We expect that energy will not limit a
			full village's basics, only how fast the village builds and learns (Hypothesis H8, Section 10).
		</p>
		<p>
			Some of these design numbers are estimates. Money cannot make a city richer; only energy, land and recipes can
			(Hypothesis H7, Section 10). Section 11 tests what energy does in each simulation.
		</p>
		<p>
			Land, the euro and energy set the city's limits. The last part of the machine is how COOPs decide, and how they
			compete.
		</p>
	</section>

	<section id="governance">
		<h2><span>9</span>Governance and competition</h2>
		<p>
			theOS sets no constitution for COOPs. Each COOP chooses its own way of deciding and can change it. COOPs that serve
			the same need compete on one open field. One rule holds for all of them:
		</p>
		<div class="law">
			<p class="lawname"><span class="kind">Rule</span>The holder rule</p>
			<p>
				A COOP's own MIND in its own treasury carries no vote and gets no dividend. MIND in the city's pools gets its
				Law 5 dividend but carries no vote. Only MIND that people and other COOPs' treasuries hold can vote in a COOP.
			</p>
		</div>
		<p>
			Without this rule, a treasury, which receives {fmt(TREASURY_SHARE, 1)} of every new MIND of its COOP, could hold a
			large share of the votes for ever, and its managers would steer it. German company law takes all rights away from a company's own shares for the same reason (§ 71b AktG).
		</p>
		<p>
			Elinor Ostrom showed that the people who share a resource, such as a pasture or a fishery, can govern it well when
			the rules fit their place <Cite k="ostrom" />. Her principles concern shared resources that people govern outside
			markets, so they do not carry over one to one. But they suggest which rules to try first, and in theOS the
			competition between COOPs tests them. Three designs might share a sector. COOP A is capital-weighted: one MIND,
			one vote, so large holders steer. COOP B is a strict direct democracy: one person, one vote on every operational
			choice. COOP C mixes three tools. It uses quadratic voting on strategy: two votes on one question cost four
			credits, and three votes cost nine. So people can show how strongly they care, but the largest holder cannot
			decide everything <Cite k="qv" />. An AI executive runs daily operations. And prediction markets answer questions
			of fact: people bet on outcomes, so the prices show what is likely <Cite k="hanson" />.
		</p>
		<p>
			These designs live on the protocol layer of Law 3. On the legal layer, a German eG gives each member one vote, or at most
			three, so COOP A's rule fits only inside the protocol. Avens aim to send each HEART where it creates the most
			utility. By default they read utility from a MIND's price and dividends (the Avens' default rule, Section 7). Let
			<Tex tex="s_i" /> be a COOP's share of its sector's investment, and <Tex tex="f_i" /> the utility that it delivers
			per HEART. Then the shares follow the equation of natural selection, known as replicator dynamics. Whatever does
			better than average grows, and whatever does worse shrinks, at a speed <Tex tex={String.raw`\kappa`} />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \dot s_i = \kappa\, s_i \left(f_i - \bar f\right) \\ \bar f = \textstyle\sum_j s_j f_j \end{gathered} \tag{${EQ.select}}`} />
		<p>
			In 1950, Alchian proposed this mechanism to explain why markets select efficient firms, even when no firm
			optimises <Cite k="alchian" />. Demurrage makes it stronger: a COOP that stops attracting investment watches its
			treasury melt. Below the level that its service needs, the COOP closes. Its physical assets go to the City COOP,
			which leases them to a COOP that runs them better, as long as people still use them (the idle-plant rule,
			Section 9.1). Ideas about markets that
			are designed on purpose, not inherited
			<Cite k="radical" />, become experiments here. One limit is built into ({EQ.select}): a COOP with no share stays at zero. So
			a new COOP needs its first HEARTS from its founders and friends, and Section 12.2 asks how to keep that door open
			without self-dealing. Law 3 is the way in: anyone can found a rival, and Section 9.1 shows when founders step in.
			Equation ({EQ.select}) also explains why leaders drift toward a monopoly. And selection by current returns starves
			projects whose use comes late (Section 8.1). Whether selection improves governance is Hypothesis H14 (Section
			10).
		</p>
		<figure>
			<LineChart
				title="Share of a sector's investment for three COOPs with different governance, over ten years"
				series={sel}
				x={{ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Share of investment' }}
			/>
			<figcaption>
				<strong>Figure {FIG.selection}.</strong> An example of ({EQ.select}), not a forecast. A starts as the most efficient, but it slowly
				becomes extractive: it gives back less for each HEART. B is steady but slow, and C starts behind and learns.
				Avens route the investment every month, so it follows the utility delivered. A leads until year
				{fmt(selNow.lead, 2)}, and after five years C has {pct(selNow.share)} of the sector. The result follows from the
				paths of efficiency that we assign, and A's slide does most of the work. If C never learned, it would still lead
				from year {fmt(selFlat.lead)}. If the test city confirms paths like these, governance becomes a technology that can
				improve by selection.
			</figcaption>
		</figure>
		<h3>9.1 Rivals and free prices</h3>
		<p>
			Every household good except water should have two COOPs from the first day. Water stays with the City COOP alone.
			Avens choose the seller for each purchase by price, and they can switch every day.
		</p>
		<p>
			Each COOP sets the price of what it makes, every day, in its own MIND. The price rises while the COOP is sold out.
			It falls while its machines stand idle or its stock grows. There is no cap, no price control and no protected
			price, not even for basics, and nobody imposes a floor. But each COOP's own price rule should keep its price above
			its cost. Its <em>variable cost</em> is what the inputs for one more unit cost. Law 5 takes {pc(DIVIDEND_SHARE)} of
			each sale, so the rule keeps the price above the variable cost divided by {fmt(1 - DIVIDEND_SHARE, 1)}. Below
			that, every sale drains the COOP's treasury. The rule goes lower only to clear stock that would rot. This floor
			leaves out rot and the rent on idle plant, so a seller can still lose on every sale; Section 11.5 tests a fuller
			one.
		</p>
		<p>
			A COOP's price rule should step up and down by the same size. In an earlier version of the simulation, prices rose
			faster than they fell. Whenever demand hovered near capacity, prices ratcheted up: they climbed step by step and
			stayed up. Equal steps fixed it.
		</p>
		<p>
			High margins invite rivals. A product's <em>full cost</em> also counts the wear of its plant and its ground rent.
			Law 3 entry is always open, and founders step in while the margin over full cost stays high. A small COOP that
			lost its market exits. A COOP whose treasury stays dry while it keeps losing fails, and its plant goes to the
			City COOP.
		</p>
		<div class="law policy">
			<p class="lawname"><span class="kind">Policy</span>The idle-plant rule</p>
			<p>
				The City COOP leases a failed COOP's plant to a successor while people still use it: while demand is at least a
				set share of the plant's capacity. Otherwise it scraps the plant and takes the land back. The City COOP sets the
				share by MIP. Its current value, which the economic model uses, is {pc(SIM.reletUse)}.
			</p>
		</div>
		<p>
			A real city would not keep leasing a plant whose rent is many times its sales. When food stays dear for months,
			Mia's Aven can propose a new food COOP. Anna's Aven then moves her food buying to it as its plant grows.
		</p>
		<p>
			Four things push back. Anyone can found a
			rival at any time (Law 3). Avens walk away from a dear seller. Law 5 pays {pc(DIVIDEND_SHARE)} of the leader's
			every sale to all who hold its MIND. And the City COOP leases a failed plant that people still use to a second
			seller. We expect these to keep basics near their cost (Hypothesis H6, Section 10).
		</p>
		<p>
			The design must still do more, and we propose three rules. First, signal a founding when need goes unmet, or when
			a rival's audited cost is far below the price, not only on the leader's margin. The protocol flags it to every
			Aven, and the City COOP offers a plot. Law 3 entry itself is always open. Second, make what a work proposal
			improves open to rivals after a delay, so that they can imitate, as in the model of Dosi and others
			<Cite k="dosi" />. Third, keep at least two sellers of every basic except water, which the City COOP runs. The test city measured who keeps the surplus
			with one, two and four sellers (Section 11.3.3).
		</p>
		<h3 id="fair">9.2 Fair ownership in theory</h3>
		<p>
			Section 1 asked who gets what the machines make. Here is the theory. Section 10 states what we expect from it,
			and Section 11.2.5 tests it. Let
			<Tex tex="W_i" /> be the MIND that person <Tex tex="i" /> owns, valued in HEARTS (Section 6.3). Let
			<Tex tex="a_i" /> be what the person keeps each year: the ownership their investing creates, plus their Aven's
			pay, minus what they spend. As in Section 5.2, the melt takes <Tex tex={String.raw`r\,W_i`} />, so a holding moves
			toward <Tex tex={String.raw`W_i^{*} = a_i/r`} />. A person who keeps the ownership their investing creates, and
			pays for daily life from their Aven's pay and their dividends, keeps <Tex tex={String.raw`a_i = \omega = u/2`} />.
			If everyone keeps the same amount each year, every holding moves toward the same resting level
			<Tex tex={String.raw`W^{*} = \omega/r \approx ${tn(ownLevel())}`} /> MIND. Start with holdings as unequal as
			Germany's today, with a Gini index <Tex tex="G_0" /> and a mean <Tex tex={String.raw`\bar W_0`} />. (The Gini index of Section 1 is
			0 if everyone has the same, and 1 if one person has everything.) Then the Gini index after <Tex tex="t" /> years is
		</p>
		<Tex display tex={String.raw`\begin{gathered} G(t) = \frac{G_0\, e^{-rt}\, \bar W_0}{e^{-rt}\, \bar W_0 + W^{*}\left(1 - e^{-rt}\right)} \\ \bar W_0 = W^{*} \;\Rightarrow\; G(t) = G_0\, e^{-rt} \end{gathered} \tag{${EQ.level}}`} />
		<p>
			So, if everyone keeps the same, inequality halves every {fmt(halfLife(), 1)} years, the same half-life as an idle
			balance. From Germany's
			{fmt(GINI_DE, 2)}, the Gini index falls to {fmt(giniAt(GINI_DE, 10), 2)} after 10 years and to
			{fmt(giniAt(GINI_DE, 30), 2)} after 30. Large fortunes level more slowly. A fortune 100 times the resting level
			needs about {fmt(levelYears(100))} years to fall to twice that level: one lifetime. A child who gets HEARTS from
			birth owns {pct(reachedBy(18) * 100)} of the resting level at 18. That is a start in life for everyone, without a
			separate fund.
		</p>
		<p>
			But people do not all keep the same. Their Avens' pay differs, and so does their spending. Each holding then
			settles at its own level, <Tex tex={String.raw`a_i/r`} />, and inequality settles at the spread of what people
			keep, not at zero. The spread of pay comes from how much each Aven delivers, and Section 11.2.5 measures it.
		</p>
		<p>
			Returns differ too, because people choose different COOPs. Let <Tex tex={String.raw`\sigma_W`} /> be the spread
			of returns between people's holdings, and <Tex tex={String.raw`\mu`} /> the lasting return of Section 5.4. Then
			each holding follows <Tex tex={String.raw`dW_i = \big(a_i - (r - \mu)\,W_i\big)\,dt + \sigma_W W_i\, dZ`} />,
			where <Tex tex="dZ" /> is random noise. This is the model of Bouchaud and Mézard for wealth <Cite k="bouchaud" />, with equal issuance in
			place of trade.
		</p>
		<p>
			<strong>Proposition 2.</strong> <em>If <Tex tex={String.raw`\mu < r`} /> and everyone keeps the same
			<Tex tex={String.raw`a_i = a`} />, the holdings settle into an inverse-gamma spread with shape
			<Tex tex={String.raw`\alpha = 1 + 2(r - \mu)/\sigma_W^2`} /> and mean <Tex tex={String.raw`a/(r - \mu)`} />. Its Gini index is ({EQ.gini}). If any holder keeps
			<Tex tex={String.raw`\mu \ge r`} />, that holding grows without limit.</em>
		</p>
		<Tex display tex={String.raw`G_{\infty} = \frac{\Gamma\!\left(\alpha - \tfrac12\right)}{\sqrt{\pi}\;\Gamma(\alpha)} \tag{${EQ.gini}}`} />
		<p>
			The stationary Fokker–Planck equation of this process has the inverse-gamma solution <Cite k="bouchaud" />, and
			its Lorenz curve gives ({EQ.gini}). A simulation of the process agrees with ({EQ.gini}) to within
			{fmt(SDE_CHECK.formula - SDE_CHECK.sim, 3)}. ∎ So inequality stays
			bounded if, and only if, demurrage is larger than the best lasting return on holdings. This is theOS's own form of
			Piketty's <Tex tex="r > g" />. Proposition 2 bounds the spread that returns create. Unequal Aven pay adds its own
			spread on top. Whether the condition holds is Hypothesis H4 (Section 10).
		</p>
		<p>
			Dividends are such a return (Section 5.4). With the same yield for everyone, the resting level rises to
			<Tex tex={String.raw`a/(r - \mu)`} />. Dividends also widen the spread. At a spread of returns of 20 %, a lasting
			return of {pct((RATE / 2) * 100, 1)} a year would raise the resting Gini index of ({EQ.gini}) from
			{fmt(giniRest(0.2), 2)} to {fmt(giniRest(0.2, RATE, RATE / 2), 2)}. So Law 5 is safe only while the lasting return
			stays below the melt, which bounds how much a COOP may sell against the MIND that others hold (Section 5.4).
		</p>
		<p>
			The price is slower levelling. A fortune spread over many MINDs, and not spent, shrinks only at the net rate
			<Tex tex={String.raw`r - \mu`} /> (Section 5.4). With no dividends, it halves in {fmt(halfLife(), 1)} years.
			Law 5 trades levelling speed for a living from ownership.
		</p>
		<figure>
			<LineChart
				title="Ownership inequality over 100 years, from Germany's spread today"
				series={gin}
				x={{ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Years under theOS' }}
				y={{ min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => fmt(v, 2), label: 'Gini index of ownership' }}
			/>
			<figcaption>
				<strong>Figure {FIG.gini}.</strong> An illustration of ({EQ.level}) and ({EQ.gini}), not a forecast. Everyone starts as unequal as
				Germany today. If everyone keeps the same amount each year and all holdings earn the same return, inequality
				halves every {fmt(halfLife(), 1)} years and goes to zero. If returns spread by 10 % or 20 % between people, it
				settles near {fmt(giniRest(0.1), 2)} or {fmt(giniRest(0.2), 2)}. Unequal pay for work proposals adds its own spread
				(Section 11.2.5). Under capitalism it stays where it is.
			</figcaption>
		</figure>
		<p>
			So the level of fairness depends on how evenly income reaches people, and on three dials: the rate of demurrage,
			how much people's returns spread, and the lasting return <Tex tex={String.raw`\mu`} />. Avens that spread each
			person's MIND over many COOPs keep <Tex tex={String.raw`\sigma_W`} /> small. A basket of 8 independent MINDs
			has about a third of the spread of one MIND. So diversification is part of fairness, not only a convenience.
			Spreading lowers <Tex tex={String.raw`\sigma_W`} />; whether it also lowers <Tex tex={String.raw`\mu`} /> is
			open.
		</p>
		<figure>
			<LineChart
				title="Resting Gini index of ownership against the spread of returns, for three rates of demurrage"
				series={dial}
				x={{ min: 0.05, max: 0.5, ticks: [0.1, 0.2, 0.3, 0.4, 0.5], fmt: (v, tip) => (tip ? `Spread ${fmt(v * 100)} %` : `${fmt(v * 100)} %`), label: 'Spread of returns between people (σ_W)' }}
				y={{ min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: (v) => fmt(v, 2), label: 'Resting Gini index' }}
				refs={[{ axis: 'y', at: GINI_DE, label: `Germany today: ${fmt(GINI_DE, 2)}` }, { axis: 'x', at: DYN.sigma, label: `σ_W simulated: ${fmt(DYN.sigma * 100, 1)} %` }]}
			/>
			<figcaption>
				<strong>Figure {FIG.dial}.</strong> The fairness dial, from ({EQ.gini}). A higher rate of demurrage or a smaller spread of
				returns gives a fairer resting state. At {pc(RATE)} and a spread of 20 %, the Gini index is {fmt(giniRest(0.2), 2)}.
				If people hold one COOP each (a spread of about 40 %), it is {fmt(giniRest(0.4), 2)}, still below Germany's
				{fmt(GINI_DE, 2)} today. The lines assume no lasting return. Dividends raise the curves, and a lasting return
				at or above the melt removes the resting state at any spread.
			</figcaption>
		</figure>
		<p>
			Now we can say what <em>fair</em> means in theOS. It means three things. <strong>Equal issuance:</strong> every
			person gets the same flow of new ownership, {UIA_DAY} HEARTS a day, whatever their wealth, their Aven's pay or
			their birth. <strong>Self-direction:</strong> each person decides what their share builds. <strong>Bounded
			advantage:</strong> every holding melts, so any advantage from luck, skill, an Aven's output or inheritance fades
			unless the holder earns it again. Without dividends, it halves in {fmt(halfLife(), 1)} years. With dividends, it
			halves only while <Tex tex={String.raw`\mu`} /> stays below the melt (Section 5.4). Bounded advantage needs
			<Tex tex={String.raw`\mu`} /> below the melt. Fair participation follows from fair ownership: every person
			owns and steers the automated economy in equal measure of issuance.
		</p>
		<p>
			theOS does not promise equal outcomes. People who use more own less. People whose Avens serve others well earn
			more. People who choose better COOPs hold more. theOS promises that no difference grows without limit while the
			lasting return <Tex tex={String.raw`\mu`} /> stays below the melt, and that then nobody inherits a difference for
			long. Whether <Tex tex={String.raw`\mu`} /> stays below the melt is Hypothesis H4 (Section 10). In Rawls's terms, theOS is a property-owning democracy whose "beginning of
			each period" is every day <Cite k="rawls" />.
		</p>
		<h3 id="machine">9.3 The whole machine</h3>
		<p>
			All the pieces are now in place: the five laws of Section 4, and the rules built on them. Each part of the
			machine has a clear job, and Table {TAB.parts} lists the parts. MIND is the one part that
			does several jobs on purpose: it carries ownership and use in one token.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.parts}.</strong> The parts of theOS and their jobs.</caption>
				<thead>
					<tr><th>Part</th><th>Its job</th><th>Comes from</th><th>Goes to</th></tr>
				</thead>
				<tbody>
					<tr><td>HEARTS</td><td>A person's intent: what they want built</td><td>The UIA, {UIA_DAY} a day per person</td><td>Converted into MIND by investment, or melted</td></tr>
					<tr><td>MIND</td><td>Ownership of a COOP and the means to use what it makes; people hold it as ownership and spend it to use, the COOP holds it as working capital</td><td>Every invested HEART, one for one: {RULE}</td><td>Spent on what the COOP makes, and the seller always receives its own MIND; paid out again by COOPs for resources, services and work proposals, which only moves it from one holder to another. It goes out of existence when it melts, or when a failed COOP's MIND is retired from the pools</td></tr>
					<tr><td>Treasury</td><td>A COOP's working capital: its own MIND and other COOPs' MIND, never HEARTS</td><td>The treasury's part of each new MIND, {fmt(TREASURY_SHARE, 1)} of each HEART, and {pc(1 - DIVIDEND_SHARE)} of every sale</td><td>Inputs, building, ground rent and work proposals that keep it running; the reserve of the payout rule (Section 4); the rest paid out for new work; melt</td></tr>
					<tr><td>Dividends</td><td>Pay the owners of a COOP when it is useful (Law 5)</td><td>{pc(DIVIDEND_SHARE)} of every sale, the same for every COOP, at the moment of sale</td><td>Everyone who holds the seller's MIND except its own treasury: people, other COOPs and the city's pools, in proportion to what each one holds; with what people hold, meant to let them live without working (H3)</td></tr>
					<tr><td>Prices</td><td>Tell COOPs what to make and Avens where to buy</td><td>Each COOP, every day, in its own MIND: up when sold out, down when idle; no caps</td><td>Avens, which show them in HEARTS and in days of living (Section 6.3)</td></tr>
					<tr><td>The city's pools</td><td>Prices and trades between MINDs, and routes every payment into the seller's own MIND; the City COOP holds their LP tokens (Section 6)</td><td>The pools' part of each new MIND, {fmt(POOL_SHARE, 1)} of each HEART, automatically, in baskets of {POOL.min} to {POOL.max} MINDs</td><td>No COOP or person withdraws; MIND leaves a pool in four ways only (Section 6)</td></tr>
					<tr><td>Demurrage</td><td>One of two ways money goes out of existence (Section 5.2): {pc(RATE)} a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's agent: invest, trade, pay, propose and deliver all work proposals with the COOPs' machines, collect dividends, leave</td><td>One per person</td><td>Work only for their human, who receives their pay; no human labour is paid</td></tr>
					<tr><td>City COOP</td><td>Holds all land and what all citizens share, and leases land; never sells it. Holds the LP tokens of the city's pools, and the euro border (Sections 8.2 and 8.3)</td><td>The city: every citizen holds one equal share</td><td>Ground rent in MIND from every builder; pays for streets, parks and water</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; tested by selection</td><td>Chosen by each COOP</td><td>Tested by where people invest</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Section 5.2 gave the monetary policy that connects these parts: money is issued as HEARTS, converted into MINDs,
			circulated as MINDs, and goes out of existence when it melts or when a failed COOP's MIND is retired. Figure {FIG.machine} shows the machine at work.
		</p>
		<figure class="wide">
		<Circulation />
		<figcaption>
				<strong>Figure {FIG.machine}.</strong> The whole machine, simulated. People on the outer ring invest their daily HEARTS
				(terracotta) into six COOPs. Each HEART converts into that COOP's MIND as it arrives, so the COOP
				never holds a HEART. Half returns to its investor (gold). The treasury's {fmt(TREASURY_SHARE, 1)} sinks into the COOP's
					treasury, its working capital, whose ring grows and slowly melts. The pools' {fmt(POOL_SHARE, 1)} goes to the
					city's pools, which the figure leaves out. Every few seconds, one COOP becomes extractive: its MIND buys less utility, so
				the gold half that returns is worth less (a smaller dot). The Avens see that a HEART creates less utility there, and they send investment to the other COOPs without
				any vote.
			</figcaption>
		</figure>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.kinds}.</strong> What theOS is: its rules, its policies with their current values, and its main concepts.</caption>
				<thead>
					<tr><th>Kind</th><th>Name</th><th>Where</th><th>Who changes it</th></tr>
				</thead>
				<tbody>
					<tr><td>Rule</td><td>Laws 1 to 5</td><td>Section 4</td><td>Nobody: the laws cannot change</td></tr>
					<tr><td>Rule</td><td>The melt, {pc(RATE)} a year</td><td>Section 5.1</td><td>A new version of the protocol (Appendix F)</td></tr>
					<tr><td>Rule</td><td>The payout rule</td><td>Section 4</td><td>A new version of the protocol</td></tr>
					<tr><td>Rule</td><td>The pools and their LP tokens</td><td>Section 6</td><td>A new version of the protocol</td></tr>
					<tr><td>Rule</td><td>The land rule</td><td>Section 8.2</td><td>A new version of the protocol</td></tr>
					<tr><td>Rule</td><td>The euro border</td><td>Section 8.3</td><td>A new version of the protocol</td></tr>
					<tr><td>Rule</td><td>The holder rule</td><td>Section 9</td><td>A new version of the protocol</td></tr>
					<tr><td>Policy</td><td>The reserve: {SIM.reserveMonths} months</td><td>Section 4</td><td>The City COOP, by MIP</td></tr>
					<tr><td>Policy</td><td>The Avens' default investment rule</td><td>Section 7</td><td>The City COOP, by MIP; each person overrides it</td></tr>
					<tr><td>Policy</td><td>Ground rent: not set yet</td><td>Section 8.2</td><td>The City COOP, by MIP</td></tr>
					<tr><td>Policy</td><td>The euro loan terms</td><td>Section 8.3</td><td>The City COOP, by MIP</td></tr>
					<tr><td>Policy</td><td>The idle-plant rule: {pc(SIM.reletUse)} of capacity</td><td>Section 9.1</td><td>The City COOP, by MIP</td></tr>
					<tr><td>Concept</td><td>HEARTS, MIND, COOP, treasury, the City COOP</td><td>Section 4</td><td>Definitions</td></tr>
					<tr><td>Concept</td><td>Work proposal</td><td>Section 4</td><td>A definition</td></tr>
					<tr><td>Concept</td><td>The lasting return <Tex tex={String.raw`\mu`} /></td><td>Section 5.4</td><td>A definition</td></tr>
					<tr><td>Concept</td><td>The unit of account, a day of living, the basic bundle</td><td>Section 6.3</td><td>Definitions</td></tr>
					<tr><td>Concept</td><td>Selection between COOPs</td><td>Section 9</td><td>A definition</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			The machine is complete. Table {TAB.kinds} sorts its parts into rules, policies and concepts. What should the
			machine achieve? Part III states it as hypotheses, and Part IV tests them.
		</p>
	</section>


	<p class="partline" id="part-3">Part III · Hypotheses: what theOS should achieve</p>

	<section id="living">
		<h2><span>10</span>Hypotheses: what theOS should achieve</h2>
		<p>
			Part II said what theOS is. This part says what we expect it to achieve. Each expectation is a
			<em>hypothesis</em>: a statement that mathematics can prove, or that the simulations of Part IV can support or
			refute. The central one asks whether every person in Abundism lives well. That question decides whether it is
			worth building. An average can rise while one person goes hungry, so Proposition 3 checks every person, not
			averages.
		</p>
		<h3 id="hyp">10.1 How we grade a hypothesis</h3>
		<p>
			Each hypothesis has a statement, the rules of Part II that should make it hold, a status, and the evidence in
			Part IV. There are five statuses. <strong>Proven:</strong> it follows from the rules by mathematics.
			<strong>Supported:</strong> every simulation run that tests it holds. <strong>Mixed:</strong> some runs hold,
			and some fail. <strong>Failing:</strong> every run that tests it fails. <strong>Open:</strong> no simulation
			tests it yet. Each status is computed from the results of Section 11, so a new run updates it. Table
			{TAB.hyps} lists them all.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.hyps}.</strong> The hypotheses of theOS, the rules they rest on, and their status today.</caption>
				<thead>
					<tr><th>Hypothesis</th><th>Rests on</th><th>Status</th><th>Evidence</th></tr>
				</thead>
				<tbody>
					<tr><td>H1 Laborde's rule (Proposition 1)</td><td>Law 1, the melt</td><td>{HYP.H1.status}</td><td>Section 5.3</td></tr>
					<tr><td>H2 Bounded inequality (Proposition 2)</td><td>The melt, Law 5</td><td>{HYP.H2.status}</td><td>Section 9.2</td></tr>
					<tr><td>H3 No one starves, no one has to work, living standards rise (Proposition 3)</td><td>Laws 1 to 5, the melt, the land rule, the payout rule</td><td>{HYP.H3.status}</td><td>Sections 11.2.3 and 11.3.3</td></tr>
					<tr><td>H4 The melt levels ownership</td><td>The melt, Law 5's share</td><td>{HYP.H4.status}</td><td>Sections 11.2.5 and 11.3.3</td></tr>
					<tr><td>H5 Long-lived projects get built, and their rise is shared</td><td>Laws 2 and 4, the euro border</td><td>{HYP.H5.status}</td><td>Section 11.2.4</td></tr>
					<tr><td>H6 Rivals keep basics near cost</td><td>Law 3, price rules, the idle-plant rule</td><td>{HYP.H6.status}</td><td>Sections 11.2.4 and 11.3.3</td></tr>
					<tr><td>H7 Only physics limits abundance</td><td>Laws 1 to 4</td><td>{HYP.H7.status}</td><td>Section 11.3.3</td></tr>
					<tr><td>H8 Energy binds growth</td><td>Recipes and net energy</td><td>{HYP.H8.status}</td><td>Section 11.3.3</td></tr>
					<tr><td>H9 The euro border balances</td><td>The euro border</td><td>{HYP.H9.status}</td><td>Section 11.3.3</td></tr>
					<tr><td>H10 The founding leaves no one short</td><td>The bootstrap (C3)</td><td>{HYP.H10.status}</td><td>Sections 11.2.3 and 11.3.3</td></tr>
					<tr><td>H11 Spread ownership pays the basics</td><td>Law 5, the Avens' choice (C4)</td><td>{HYP.H11.status}</td><td>Sections 11.2.3 and 11.3.3</td></tr>
					<tr><td>H12 People own most MIND</td><td>The payout rule</td><td>{HYP.H12.status}</td><td>Sections 11.2.2 and 11.3.3</td></tr>
					<tr><td>H13 The melt keeps money moving</td><td>The melt</td><td>{HYP.H13.status}</td><td>Section 11.2.2</td></tr>
					<tr><td>H14 Selection improves governance</td><td>Law 3, the Avens' exit</td><td>{HYP.H14.status}</td><td>None yet</td></tr>
				</tbody>
			</table>
		</div>
		<h3 id="props">10.2 Propositions 1 and 2</h3>
		<p>
			<strong>H1, Laborde's rule.</strong> With a constant population and once money has settled, each member's
			balance, measured against the average, moves toward the average at the rate of the melt: Laborde's law with
			<Tex tex="c = r" />. This is Proposition 1 (Section 5.3). It rests on Law 1 and the melt. Status:
			{HYP.H1.status}. In a young city the rate starts higher and falls to <Tex tex="r" />.
		</p>
		<p>
			<strong>H2, bounded inequality.</strong> If the lasting return <Tex tex={String.raw`\mu`} /> stays below the
			melt and everyone keeps the same each year, holdings settle into a spread whose Gini index is ({EQ.gini}). If
			any holder keeps <Tex tex={String.raw`\mu \ge r`} />, that holding grows without limit. This is Proposition 2
			(Section 9.2), and a simulation of the process agrees with it. Status: {HYP.H2.status}. Whether the city meets
			its condition is H4 (Section 10.5).
		</p>
		<h3 id="prop3">10.3 Proposition 3, the central hypothesis</h3>
		<p>
			Five terms come first. The <em>founding</em> is a city's first days: residents invest before the first sale,
			until every person holds MIND. In the economic model it ends on day {PROOF.fromDay}. The <em>basic bundle</em>
			(Section 6.3) is one day of basics for one person. An
			<em>owner-only person</em> is a person whose Aven delivers nothing and who starts with nothing. <em>Real
			consumption</em> counts every unit that a person consumes, valued at the prices of day 1, so it counts amounts,
			not price changes. Prices fell sharply in year 1, so real consumption is not comparable with a day of living. A
			<em>tenth of the people</em>, or decile, is one of ten equal groups when we sort the people by real consumption
			each year.
		</p>
		<div class="law prop">
			<p class="lawname">Hypothesis H3 · Proposition 3 · No one starves, no one has to work, living standards rise</p>
			<p>
				<em>Take a city that follows the five laws, the melt, the land rule and the payout rule, and that meets the
				conditions C1 to C5 below. Then, from the end of the founding, parts 1 and 2 hold for every person on every
				day, and part 3 holds for every tenth of the people:</em>
			</p>
			<ol>
				<li><em><strong>No one starves.</strong> Each person gets at least {pc(BASIC_BUNDLE.tolerance)} of every basic need.</em></li>
				<li>
					<em><strong>No one has to work to survive.</strong> An owner-only person lives from what they own: their Law 5
					dividends, plus spending some of the MIND they hold, pay for the basic bundle every day, and their holding
					never runs out.</em>
				</li>
				<li>
					<em><strong>Living standards rise.</strong> The real consumption of every tenth of the people is higher at
					every ten-year mark than ten years before.</em>
				</li>
			</ol>
		</div>
		<p>
			Proposition 3 is claimed from the end of the founding, not from day 1. The founding is reported on its own
			(Section 11.2.3), and H10 states what we expect of it. We call part 2 the <em>normal test</em>. We also check a
			stronger target, which the proposition does not claim: the <em>strict test</em>, in which dividends alone pay
			for the basic bundle. Part 3 is the weakest part. It compares ten-year marks (years 10, 20 and so on); a test
			over every ten-year window is stricter (Section 11.2.3). Status of H3: {HYP.H3.status}. Part 1:
			{HYP.H3.parts[0].status}; part 2: {HYP.H3.parts[1].status}; part 3: {HYP.H3.parts[2].status}. All three parts
			held on {HYP.H3.model[0]} of the economic model's {HYP.H3.model[1]} seeds and on {HYP.H3.city[0]} of the test
			city's {HYP.H3.city[1]} base seeds (Section 11.4).
		</p>
		<p>The five conditions are these:</p>
		<ul>
			<li>
				<strong>C1 Enough output that grows fast enough.</strong> Plants, land and net energy cover the basics, and output
				per person grows (Section 8.4). How fast is enough for part 3 is open (Section 10.4). In the economic model,
				the growth is an assumption (Section 11.2.1).
			</li>
			<li>
				<strong>C2 Competition.</strong> Two or more sellers of every basic, prices that move freely both ways, and Law
				3 entry that is always open (Section 9.1).
			</li>
			<li>
				<strong>C3 The bootstrap.</strong> Residents invest their HEARTS for a founding week before the first sale. The
				pools' part of each new MIND fills the pools, so every MIND can trade on opening day. Each person's first
				investment makes them a part-owner of the basics COOPs (Section 12.4). Euros fund only machines, never MIND.
				The founding ends once every person holds MIND.
			</li>
			<li>
				<strong>C4 Spread ownership.</strong> Avens keep enough MIND of COOPs that sell a lot to cover the basic bundle,
				spread the rest, and pay first with the MIND that earns least (Section 7). This is an untested proposal. Holding
				only the MINDs that sell most would raise <Tex tex={String.raw`\mu`} /> (Proposition 2).
			</li>
			<li>
				<strong>C5 Wants and Aven work that can grow.</strong> At least one good never satisfies fully, such as
				experiences, and Avens deliver what COOPs ask.
			</li>
		</ul>
		<p>
			Table {TAB.conditions} lists what the economic model of Section 11.2 found for each condition.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.conditions}.</strong> Conditions and what the economic model found on its main seed.</caption>
				<thead>
					<tr><th>Condition</th><th>In the economic model</th></tr>
				</thead>
				<tbody>
					<tr><td>C1 Enough output that grows fast enough</td><td>Assumed: each COOP's productivity grows about {pc(SIM.prodGrowth)} a year on average, and net energy is not modelled. Without productivity growth, the run {checkWords(V('prod0'))}; with {pc(SIM.prodGrowth)} for every COOP, it {checkWords(V('even'))}</td></tr>
					<tr><td>C2 Competition</td><td>{sole.length ? 'Met only in part' : 'Met'}: water had one seller throughout, and by year {SIM.years} the {list(sole)} each came from one COOP alone (Table {TAB.rivals}). After the {DYN.failures + DYN.exits} ends, {fmt(PROOF.endedShort)} person-days were short</td></tr>
					<tr><td>C3 The bootstrap (Section 12.4)</td><td>Not modelled: the checks start on day {PROOF.fromDay}, when every person holds MIND, and the founding is reported on its own (Section 11.2.3)</td></tr>
					<tr><td>C4 Spread ownership</td><td>Not modelled: {pc(ownerCity.share)} of what the owner-only people held was cityMIND, which pays almost nothing</td></tr>
					<tr><td>C5 Wants and Aven work that can grow</td><td>Met: experiences never satisfy fully. Without them, the run {checkWords(V('wants'))}, and the dividend yield fell to {pc(V('wants').yield, 1)}</td></tr>
					<tr><td>The payout rule (Section 4)</td><td>With reserves of {V('res6').months} months, the run {checkWords(V('res6'))}; with {V('res12').months} months, it {checkWords(V('res12'))}, and all three checks passed on {MT.res12.new.pass} of {SEEDS.n} seeds</td></tr>
					<tr><td>Every COOP accepts HEARTS from anyone</td><td>Assumed</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Proposition 3 is a hypothesis with an argument, not a theorem. Section 10.4 gives the conditions under which
			each part can hold. Parts 1 and 3 have no closed form, so the simulations must check them.
		</p>
		<h3 id="when">10.4 When Proposition 3 can hold</h3>
		<p>
			Three conditions follow from the rules. We derive each one and check it against the economic model.
		</p>
		<p>
			<strong>(a) No one has to work if a day's basics cost less than the investor's half of a day's HEARTS, plus
			dividends.</strong> Let <Tex tex="W_i" /> be what person <Tex tex="i" /> holds, in HEARTS, and let
			<Tex tex="X_i" /> be what they spend. Let <Tex tex={String.raw`\omega`} /> be the ownership that their
			investing creates for them, and <Tex tex="D_i" /> their dividends. Let <Tex tex="p_b" /> be the cost of a day's
			basic bundle. With all flows counted a year,
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dW_i}{dt} = \omega + D_i - r\,W_i - X_i \\ 365\,p_b < \omega + D_i \;\Rightarrow\; W_i(t) > 0 \\ T_i = \frac{1}{r}\,\ln\!\Big(1 + \frac{r\,W_i}{365\,p_b}\Big) \end{gathered} \tag{${EQ.normal}}`} />
		<p>
			In words: a holding grows while what flows in, new ownership and dividends, exceeds the melt and the spending.
			If a person spends only on the basics, <Tex tex={String.raw`X_i = 365\,p_b`} />, and the second line holds,
			then the holding moves toward a positive level and never runs out. Each day, a person invests {UIA_DAY} HEARTS
			and keeps {UIA_DAY / 2} MIND. A new MIND is worth 1 HEART only on average (Section 6.3), so
			<Tex tex={String.raw`\omega`} /> is about {UIA_DAY / 2} HEARTS a day for a person who invests like the
			average, and less for one who invests in MINDs worth less. Three qualifiers apply. The condition needs basics
			that exist, so part 1 must hold too: a margin in MIND cannot buy food that nobody has made. It leaves out price
			moves: when a MIND that a person holds falls in price, so does the holding. And each payment through the pools
			costs a small fee. <Tex tex="T_i" /> measures the buffer: how many years a holding <Tex tex="W_i" /> would pay a
			day's basics with nothing flowing in, the melt included. In the economic model, a day's basics cost at most
			{fmt(PROOF.bundleMax, 3)} HEARTS, in year {PROOF.bundleMaxYear}, so the investor's half alone covered them
			about ×{fmt(bundleMargin())}. The model is far inside condition (a).
		</p>
		<p>
			<strong>(b) Dividends alone can pay everyone's basics only if the basics cost less than Law 5's share of all
			sales.</strong> Law 5 pays <Tex tex={String.raw`\lambda`} />, {pc(DIVIDEND_SHARE)}, of every sale to the
			holders of the seller's MIND. Let <Tex tex="Q" /> be all sales a day, <Tex tex="N" /> the number of people,
			and <Tex tex="s_p" /> the share of the dividend-earning MIND that people hold; the rest is held by other
			COOPs' treasuries and by the city's pools. Then
		</p>
		<Tex display tex={String.raw`\begin{gathered} \sum_i D_i = \lambda\, s_p\, Q \ge N\,p_b \\ \Rightarrow\; \frac{N\,p_b}{Q} \le \lambda\, s_p \le \lambda \end{gathered} \tag{${EQ.share}}`} />
		<p>
			So the strict test can hold for everyone only if a day's basics for everyone cost less than
			{pc(DIVIDEND_SHARE)} of a day's sales, and less still where treasuries and pools hold MIND. The condition is
			necessary, not sufficient: every person also needs enough MIND that pays. If all sales are to people and the
			dividend yield is the city's average, <Tex tex={String.raw`\bar\eta = \lambda Y / \bar W`} />, with
			<Tex tex="Y" /> what people buy (HEARTS a person a day) and <Tex tex={String.raw`\bar W`} /> the mean holding,
			then each person needs
		</p>
		<Tex display tex={String.raw`\begin{gathered} D_i \approx \bar\eta\, W_i = \lambda\,Y\,\frac{W_i}{\bar W} \\ D_i \ge p_b \iff \frac{W_i}{\bar W} \ge \frac{p_b}{\lambda\,Y} \end{gathered} \tag{${EQ.strict}}`} />
		<p>
			In the last ten years of the economic model, people's dividends were {fmt(RT.people.in.dividends, 2)} HEARTS a
			person a day, against {fmt(PRICES_BY_YEAR[SIM.years].bundle, 3)} for a day's basics in year {SIM.years}:
			condition ({EQ.share}) held about ×{fmt(RT.people.in.dividends / PRICES_BY_YEAR[SIM.years].bundle)}. The right
			side of ({EQ.strict}) was {pc(strictThreshold(), 2)} of the mean holding, so an owner with an average mix of
			MIND passes by far. Yet in year {SIM.years}, dividends alone covered {pc(PROOF.strict.lateMissEnd)} of the
			owner-only person-days, and {pc(ownerCity.share)} of what the owner-only people held was cityMIND, which pays
			almost nothing. A miss comes from which MIND a person holds, not from how much (C4, H11). The strict test also
			needs sales far beyond the basics: if people bought only basics, their dividends would be just
			{pc(DIVIDEND_SHARE)} of their cost. So the strict test is a goal for abundance, which must be sold and used, not
			only made. Law 5 also hedges the basics, but only for those who hold MIND of the food COOPs that sell: when
			food gets dear, they get more dividends.
		</p>
		<p>
			<strong>(c) No one starves only if the stock and the capacity cover the need through the largest shock that
			the city plans for.</strong> Let <Tex tex="d" /> be the need for a basic a day, <Tex tex="q" /> the capacity
			to make it, and <Tex tex="S" /> the stock in hand. A shock takes a share <Tex tex={String.raw`\delta`} /> of
			the capacity for <Tex tex={String.raw`\tau`} /> days. Then the stock must cover the gap:
		</p>
		<Tex display tex={String.raw`S \ge \big(d - (1 - \delta)\,q\big)\,\tau \tag{${EQ.stock}}`} />
		<p>
			Rot and the stock used before the shock come on top. The largest shock in the economic model takes
			{pc(SIM.shockDepth[1])} of a plant's capacity for {SIM.shockMonths[1]} months. With capacity just at need, the
			stock must then hold {fmt(SIM.shockDepth[1] * SIM.shockMonths[1], 1)} months of need. The model keeps no stock
			sized for this, and its price floor leaves out rot (Section 11.5). Condition (c) is necessary, not sufficient.
			Part 1 also needs buyers who can pay, which part 2 gives, two or more sellers of each basic (C2), and, in the
			founding, the bootstrap (C3). A seller with idle capacity lowers its price, and a rival takes the buyers it
			loses. MIND must never be what runs short while physics allows more (H7).
		</p>
		<p>
			<strong>Part 3</strong> has no such condition. It needs output per person to grow fast enough (C1), and wants
			that grow with it (C5). The poorest tenth gain through two channels. Every person gets the same new ownership
			each day, {UIA_DAY / 2} MIND. And competition passes productivity on as lower prices of the basics in HEARTS: a
			day's basics cost {fmt(PRICES_BY_YEAR[1].bundle, 3)} HEARTS in year 1 and {fmt(PRICES_BY_YEAR[60].bundle, 3)} in
			year {SIM.years}. So the same daily ownership buys more each year. How fast is enough is open (H8). The run with
			even growth, {pc(SIM.prodGrowth)} for every COOP, meets C1 and C5, and C2 in part, and there the run
			{checkWords(V('even'))}. Its output per unit of plant grew {pc(plantGrowthRate(V('even').plant), 1)} a year,
			against {pc(plantGrowthRate(), 1)} in the main run.
		</p>
		<h3 id="more">10.5 More hypotheses</h3>
		<p>
			Proposition 3 rests on more than its own parts. Each hypothesis below says what we expect, which rules should
			make it hold, its status and where Part IV tests it.
		</p>
		<dl class="hyps">
			<dt>H4 The melt levels ownership</dt>
			<dd>
				The lasting return <Tex tex={String.raw`\mu`} /> stays below the melt for every holder, so no holding grows
				without limit and every advantage fades. It rests on the melt (Section 5.1) and on Law 5's share, which sets
				the dividend part of <Tex tex={String.raw`\mu`} /> (Section 5.4). Status: <strong>{HYP.H4.status}</strong>.
				<Tex tex={String.raw`\mu`} /> was below the melt on {HYP.H4.model[0]} of {HYP.H4.model[1]} seeds of the
				economic model, and on {HYP.H4.same[0]} of {HYP.H4.same[1]} seeds with the same shocks (Section 11.2.5).
			</dd>
			<dt>H5 Long-lived projects get built, and their rise is shared</dt>
			<dd>
				The city builds what lasts. A project's rising value goes to its users and to the new investors who fund each
				stage, and long-term holders gain through Law 5 on growing sales. It rests on Laws 2 and 4 and on the euro
				loans (Section 8.1). Status: <strong>{HYP.H5.status}</strong>. In the economic model, {HYP.H5.won.length} of
				the {HYP.H5.of} infrastructure COOPs made all of their good by the last year, and the MINDs of
				{HYP.H5.below.length} of them returned less than the melt (Section 11.2.4).
			</dd>
			<dt>H6 Rivals keep basics near cost</dt>
			<dd>
				Open entry, free prices and Avens that switch keep the price of each basic within {pc(COST_BAND)} of its full
				cost, and no basic but water ends with one seller. It rests on Law 3, each COOP's price rule and the
				idle-plant rule (Section 9.1). Status: <strong>{HYP.H6.status}</strong>. In the test city, basics sold at
				{list(TEST_CITY.scenarios.sellers.cost.map((v) => fmt(v, 2)))} times their full cost with
				{list(TEST_CITY.scenarios.sellers.per.map(String))} sellers. In the economic model, by the last year,
				{HYP.H6.sole.length ? `the ${list(HYP.H6.sole)} each came from one COOP` : 'every basic but water had two sellers or more'} (Section 11.2.4).
			</dd>
			<dt>H7 Only physics limits abundance</dt>
			<dd>
				MIND never binds a basic while physics allows more, and more money does not make the city richer. It rests on
				Laws 1 to 4: money comes from intent, not from goods (Sections 5.2 and 8.4). Status:
				<strong>{HYP.H7.status}</strong>. In the test city, MIND never bound a basic on {HYP.H7.city[0]} of
				{HYP.H7.city[1]} base seeds. Twice the HEARTS raised prices {fmt(TEST_CITY.scenarios.money.prices, 1)}-fold
				and changed what people got by at most {pc(TEST_CITY.scenarios.money.largest, 1)} (Section 11.3.3).
			</dd>
			<dt>H8 Energy binds growth</dt>
			<dd>
				Output per person grows only as fast as surplus energy pays for, and fast enough for part 3 of Proposition 3.
				It rests on the recipes and net energy (Section 8.4, Appendix H). Status: <strong>{HYP.H8.status}</strong>:
				the economic model assumes productivity growth and has no energy limit. In the test city, with surplus energy,
				{shortOr(TEST_CITY.scenarios.energy.short)}, against {fmt(TEST_CITY.scenarios.energy.shortWithout)} without it
				(Section 11.3.3).
			</dd>
			<dt>H9 The euro border balances</dt>
			<dd>
				Exports earn back the euros that the city needs for its machines and imports. It rests on the euro border
				(Section 8.3). Status: <strong>{HYP.H9.status}</strong>. In the test city, the village owed at most
				€{fmt(TEST_CITY.bank.bootstrap / 1e6, 1)} million outside, and its exports
				{TEST_CITY.bank.repaid ? 'repaid' : 'did not repay'} that within {TEST_CITY.years} years (Section 11.3.3).
			</dd>
			<dt>H10 The founding leaves no one short</dt>
			<dd>
				From the first sale, every person can buy the basics. It rests on the bootstrap (C3, Section 12.4). Status:
				<strong>{HYP.H10.status}</strong>. The economic model has no founding rule, and {fmt(PROOF.genesis.short)} of
				{fmt(PROOF.genesis.personDays)} person-days were short in its founding (Section 11.2.3). In the test city,
				with the founding rule, {shortOr(TEST_CITY.scenarios.founding.shortWith)} in year 1 (Section 11.3.3).
			</dd>
			<dt>H11 Spread ownership pays the basics</dt>
			<dd>
				Once Avens keep enough MIND of COOPs that sell a lot, dividends alone pay every owner-only person's basics:
				the strict test. It rests on Law 5 and on the Avens' choice of what to hold (C4, Section 7). Status:
				<strong>{HYP.H11.status}</strong>: no simulation spreads ownership this way yet. Without it, the strict test
				held on {HYP.H3.strict.city[0]} of the test city's {HYP.H3.strict.city[1]} base seeds (Sections 11.2.3 and
				11.3.3).
			</dd>
			<dt>H12 People own most MIND</dt>
			<dd>
				Treasuries pay out what they do not need, so people, not treasuries, own most of the city's MIND. It rests on
				the payout rule (Section 4). Status: <strong>{HYP.H12.status}</strong>: it held in {HYP.H12.held} of
				{HYP.H12.of} tests. In the economic model, people held {pc(DYN.people)} of all MIND by value (Section 11.2.2).
			</dd>
			<dt>H13 The melt keeps money moving</dt>
			<dd>
				Because money melts, people spend or invest it rather than keep it idle, so the velocity of money rises. It
				rests on the melt (Section 5.1). Status: <strong>{HYP.H13.status}</strong>: the economic model assumes how much
				people spend, so it cannot settle this (Section 11.2.2).
			</dd>
			<dt>H14 Selection improves governance</dt>
			<dd>
				Avens move investment away from COOPs that deliver less for their MIND, so better-run COOPs grow, and governance
				improves by selection. It rests on Law 3 and on the Avens' exit (Sections 7 and 9). Status:
				<strong>{HYP.H14.status}</strong>: no simulation tests it yet.
			</dd>
		</dl>
	</section>

	<p class="partline" id="part-4">Part IV · Our simulations</p>

	<section id="sims">
		<h2><span>11</span>Our simulations</h2>
		<p>
			Nobody can run a whole economy in a laboratory. And nobody should test it on people's lives first. So we prove
			theOS first in a game, then in the real city. Part III stated what theOS should achieve. This part tests it in
			two simulations: {SIM_NAMES.model}, which plays the rules in a small city, and {SIM_NAMES.testCity}, which
			plays them in a village with land, energy and a euro border. Each new version of the one and each new round of the
			other should come closer to the hypotheses of Section 10. Section 11.4 shows how far they have come.
		</p>
		<h3 id="yardstick">11.1 How we test: one yardstick</h3>
		<p>
			<strong>One seed, one history.</strong> A seed fixes the random events of a run, but each event also depends on
			what happened before. When a rule moves one number by a hair, a random draw lands on a different event. From then
			on, the run takes another path. We moved the pools' part on the main seed. At {fmt(hairLow.pool, 4)} of each
			HEART instead of {fmt(POOL_SHARE, 1)}, {shortWords(hairLow)}, and all three checks
			{hairLow.pass ? 'passed' : 'failed'}. At {fmt(hairHigh.pool, 4)}, {shortWords(hairHigh)}. The old pool rule
			does the same. At {fmt(oldLow.pool, 4)}, {shortWords(oldLow)}; at {fmt(oldHigh.pool, 4)},
			{shortWords(oldHigh)}. So one seed cannot show which of two rules is better. On the main seed, the gap between
			the two pool rules in Table {TAB.variations} is one history against another.
		</p>
		<p>
			Instead, we compare two rules on the same shocks. With <em>common random numbers</em>, both runs of a seed
			draw their capacity shocks and the drift of tastes from one shared random stream. So on each seed, both rules
			meet the same shocks on the same days. Most of the difference between the two runs then comes from the rule.
			Some luck remains, because founders and trades still draw from each run's own stream. We ran rules on {SS.n}
			seeds, {SS.from} to {SS.to}, in pairs. A <em>sign test</em> then counts the seeds on which the new rule did better and those on which it did worse, and
			leaves out ties. If the rule made no difference, each seed would be a coin toss. The value <em>p</em> is the
			chance that coin tosses alone give a count at least this uneven, in either direction.
		</p>
		<h3 id="model">11.2 The economic model</h3>
		<h4>11.2.1 The model and its versions</h4>
		<p>
			An <em>agent-based</em> simulation lets every person and every COOP act by its own rules, day by day, and then
			adds up what happens. Ours plays the rules of this paper in one city (Appendix G):
		</p>
		<ul>
			<li>
				{SIM.people} people over {SIM.years} years, on one <em>seed</em>: one fixed set of random events, such as its
				shocks and its drifting tastes. Section 11.2.6 runs the main run on {SEEDS.n - 1} more seeds. A
				<em>person-day</em> is one person on one day. Daily steps in year 1, weekly steps after; each week counts as
				seven person-days.
			</li>
			<li>
				On day 1 the plants can make {pc(SIM.seedCapacity)} of the first needs, but nobody holds MIND yet. Every tenth
				person is owner-only.
			</li>
			<li>{SIM.goods} goods. Experiences never satisfy fully.</li>
			<li>
				Two rival COOPs for each household good except water, free prices, reserves of {SIM.reserveMonths} months,
				and Law 5 at {pc(SIM.lawShare)}. The run pays it to people and other COOPs' treasuries; the pools' share is
				being added.
			</li>
			<li>Each invested HEART makes one MIND (Law 4, Section 4).</li>
			<li>
				Each COOP's productivity rises at its own rate, about {pc(SIM.prodGrowth)} a year on average. This is an
				assumption (Appendix A). The COOPs that grew fastest won their markets. So output per unit of plant rose about
				{pc(plantGrowthRate(), 1)} a year, and mean real consumption about {pc(growthRate('mean'), 1)} a year, with no
				energy limit.
			</li>
			<li>
				{SIM.shocks} capacity shocks of {pc(SIM.shockDepth[0])} to {pc(SIM.shockDepth[1])}, for {SIM.shockMonths[0]} to
				{SIM.shockMonths[1]} months, and tastes that drift.
			</li>
			<li>COOPs are founded, exit and fail.</li>
			<li>
				The City COOP leases a failed COOP's plant to a successor while demand is at least {pc(SIM.reletUse)} of its
				capacity. It scraps an idle plant and takes the land back: the idle-plant rule of Section 9.1.
			</li>
			<li>
				Each Aven puts {pc(AVEN_RULE.share)} of its person's HEARTS into the {AVEN_RULE.top} MINDs with the highest
				price × (1 + {AVEN_RULE.yieldWeight} × dividend yield), and the rest by its person's own values. A new COOP
				gets other people's HEARTS only after its pool has traded for a year.
			</li>
			<li>People spend about half of what they hold a year, basics first.</li>
			<li>Every human has one Aven, and no human labour is paid.</li>
		</ul>
		<p>
			The <em>main run</em> is the run with these settings. It is the evidence of Sections 11.2.2 to 11.2.5. We call its
			years {SIM.restFrom} to {SIM.years} its <em>last ten years</em>.
		</p>
		<p>
			An earlier static world ran under the same laws, with simpler markets. It had one COOP per good (two for food),
			fixed tastes and no growth. Its prices were capped at twice their full cost, which theOS does not allow, and its
			reserves were short. That cap is one reason why we replaced it. We now use the dynamic world. "Static" marks every
			number in this paper that still comes from the earlier one. Table {TAB.twoWorlds} compares the two.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.twoWorlds}.</strong> Two worlds, in the last ten years (years {SIM.restFrom} to {SIM.years}) unless the row says otherwise: the dynamic world that this paper uses, and the earlier static one.</caption>
				<thead>
					<tr><th>Measure</th><th class="num">Dynamic</th><th class="num">Static</th></tr>
				</thead>
				<tbody>
					<tr><td>A day of living, HEARTS: year 1 / year {SIM.years}</td><td class="num">{fmt(DYN.dayLiving.y1, 1)} / {fmt(DYN.dayLiving.y60, 1)}</td><td class="num">{fmt(STATIC.dayLiving.y1, 1)} / {fmt(STATIC.dayLiving.y60, 1)}</td></tr>
					<tr><td>Income a person a day, HEARTS</td><td class="num">{fmt(DYN.income, 1)}</td><td class="num">{fmt(STATIC.income, 1)}</td></tr>
					<tr><td>Share of income spent / melting in wallets</td><td class="num">{pc(DYN.spent)} / {pc(DYN.walletMelt)}</td><td class="num">{pc(STATIC.spent)} / {pc(STATIC.walletMelt)}</td></tr>
					<tr><td>Share of all MIND by value: people / treasuries / pools</td><td class="num">{fmt(DYN.people * 100)} / {fmt(DYN.treasuries * 100)} / {pc(DYN.pools)}</td><td class="num">{fmt(STATIC.people * 100)} / {fmt(STATIC.treasuries * 100)} / {pc(STATIC.pools)}</td></tr>
					<tr><td>Dividend yield a year</td><td class="num">{pc(DYN.yield, 1)}</td><td class="num">{pc(STATIC.yield, 1)}</td></tr>
					<tr><td>Lasting return <Tex tex={String.raw`\mu`} />; whole run</td><td class="num">{pc(DYN.mu, 1)}; {pc(DYN.muRun, 1)}</td><td class="num">{pc(STATIC.mu, 1)}</td></tr>
					<tr><td>Gini index of what people hold</td><td class="num">{fmt(DYN.giniOwned, 2)}</td><td class="num">{fmt(STATIC.giniOwned, 2)}</td></tr>
					<tr><td>MIND values, HEARTS</td><td class="num">{fmt(DYN.pricesMin, 2)}–{fmt(DYN.pricesMax, 2)}</td><td class="num">{fmt(STATIC.pricesMin, 2)}–{fmt(STATIC.pricesMax, 2)}</td></tr>
					<tr><td>COOP failures / exits / foundings, whole run</td><td class="num">{DYN.failures} / {DYN.exits} / {DYN.foundings}</td><td class="num">{STATIC.failures} / {STATIC.exits} / {STATIC.foundings}</td></tr>
					<tr><td>MINDs alive at the end</td><td class="num">{DYN.mindsAlive}</td><td class="num">{STATIC.mindsAlive}</td></tr>
				</tbody>
			</table>
		</div>
		<h4 id="cycle">11.2.2 Where MIND goes: the cycle and the round trip</h4>
		<p>
			The MIND that COOPs pay out comes back to them through what they sell. In the last ten years, people spent {pc(DYN.spent)} of
			what they get, and only {pc(DYN.walletMelt)} melts in their wallets. In the static world, where every want had a
			limit (satiation), they spent {pc(STATIC.spent)} and {pc(STATIC.walletMelt)} melted. The share follows from a rule about
			people, not from the melt. If people spend a share <Tex tex={String.raw`\theta`} /> of what they hold each year,
			they spend <Tex tex={String.raw`\theta/(\theta + r)`} /> of their income. With
			<Tex tex={String.raw`\theta = ${tn(SIM.spendRate, 1)}`} />, that is {pc(spendShare(), 1)}, close to the
			{pc(DYN.spent)} measured. So the cycle needs wants that keep growing.
		</p>
		<figure>
			<MindCycle />
			<figcaption>
				<strong>Figure {FIG.cycle}.</strong> MIND goes round. What treasuries pay out comes back through what they sell,
				and little melts on the way. At each sale (the gold dot), the Law 5 share goes at once back to the holders, and
				only the rest reaches the treasury. The gold coins are MIND, and the widths show the simulation's last ten years. The buttons
				switch to the earlier static world, where people spent {pc(STATIC.spent)} and {pc(STATIC.walletMelt)}
				melted.
			</figcaption>
		</figure>
		<p>
			A person's MIND comes from three places. Their own half of the HEARTS they invest gives {share('own')} of their
			income. The work proposals their Aven delivers give {pc(incomeShare('items') + incomeShare('proposals'))}: work
			that keeps COOPs running {share('items')} and new work {share('proposals')}. Law 5 dividends give
			{share('dividends')}. There are no jobs and no wages.
		</p>
		<p>
			Table {TAB.roundTrip} follows every MIND around the round trip, in the last ten years. The
			unit is the HEART (Section 6.3). When prices move, so does the value of what each place holds. Godley and Lavoie call this
			revaluation <Cite k="godley" />. With it, every place balances to within {pc(RT.unexplainedMax, 2)} of its
			inflow.
		</p>
		<div class="table-wrap">
			<table class="flows">
				<caption>
					<strong>Table {TAB.roundTrip}.</strong> The round trip in the last ten years, in HEARTS a person a day. In each place, the net
					flow plus the price moves equals the change of what that place holds, to within {pc(RT.unexplainedMax, 2)}
					of its inflow. All values are rounded to 0.01 HEARTS. The Law 5 share goes from each sale straight to the holders, so
					it never passes through a treasury.
				</caption>
				<thead>
					<tr><th>Flow</th><th>HEARTS a day</th></tr>
				</thead>
				<tbody>
					<tr><th colspan="2" scope="colgroup">People's wallets</th></tr>
					<tr><td>The ownership their investing creates (their half of the new MIND)</td><td>{sg(RT.people.in.own)}</td></tr>
					<tr><td>Work proposals: running work</td><td>{sg(RT.people.in.items)}</td></tr>
					<tr><td>Work proposals: new work</td><td>{sg(RT.people.in.proposals)}</td></tr>
					<tr><td>Law 5 dividends, paid at each sale</td><td>{sg(RT.people.in.dividends)}</td></tr>
					<tr><td>Buying from COOPs</td><td>{sg(-RT.people.out.buying)}</td></tr>
					<tr><td>Melt</td><td>{sg(-RT.people.out.melt)}</td></tr>
					<tr><td>Retired with a COOP that ended</td><td>{sg(-RT.people.out.retired)}</td></tr>
					<tr class="net"><td>Net flow</td><td>{sg(RT.people.net)}</td></tr>
					<tr><td>Price moves</td><td>{sg(RT.people.moves)}</td></tr>
					<tr><td>Not explained (routing, timing)</td><td>{sg(RT.people.rest)}</td></tr>
					<tr class="net"><td>Change of what people hold</td><td>{sg(RT.people.change)}</td></tr>
					<tr><th colspan="2" scope="colgroup">COOP treasuries</th></tr>
					<tr><td>The treasury's part of the new MIND ({fmt(TREASURY_SHARE, 1)} of each HEART)</td><td>{sg(RT.treasuries.in.own)}</td></tr>
					<tr><td>Sales to people, after the Law 5 share</td><td>{sg(salesAfterLaw5())}</td></tr>
					<tr><td>Work proposals: running work</td><td>{sg(-RT.treasuries.out.items)}</td></tr>
					<tr><td>Work proposals: new work</td><td>{sg(-RT.treasuries.out.proposals)}</td></tr>
					<tr><td>Melt</td><td>{sg(-RT.treasuries.out.melt)}</td></tr>
					<tr><td>Retired with a COOP that ended</td><td>{sg(-RT.treasuries.out.retired)}</td></tr>
					<tr class="net"><td>Net flow</td><td>{sg(RT.treasuries.net)}</td></tr>
					<tr><td>Price moves</td><td>{sg(RT.treasuries.moves)}</td></tr>
					<tr><td>Not explained (routing, timing)</td><td>{sg(RT.treasuries.rest)}</td></tr>
					<tr class="net"><td>Change of what treasuries hold</td><td>{sg(RT.treasuries.change)}</td></tr>
					<tr><th colspan="2" scope="colgroup">Pools</th></tr>
					<tr><td>The pool's part of the new MIND ({fmt(POOL_SHARE, 1)} of each HEART)</td><td>{sg(RT.pools.in.pool)}</td></tr>
					<tr><td>Routing costs</td><td>{sg(RT.pools.in.routing)}</td></tr>
					<tr><td>Melt</td><td>{sg(-RT.pools.out.melt)}</td></tr>
					<tr><td>Retired with a COOP that ended</td><td>{sg(-RT.pools.out.retired)}</td></tr>
					<tr class="net"><td>Net flow</td><td>{sg(RT.pools.net)}</td></tr>
					<tr><td>Price moves</td><td>{sg(RT.pools.moves)}</td></tr>
					<tr><td>Not explained (routing, timing)</td><td>{sg(RT.pools.rest)}</td></tr>
					<tr class="net"><td>Change of what the pools hold</td><td>{sg(RT.pools.change)}</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Flows between treasuries cancel out, so Table {TAB.roundTrip} leaves them out. Examples are sales to other COOPs
			({fmt(RT.between.sales, 2)} HEARTS) and ground rent to the City COOP ({fmt(RT.between.rent, 2)} HEARTS). The macro checks,
			each marked as met or not:
		</p>
		<ul>
			<li>
				<strong>The books close: met.</strong> What flows and price moves do not explain is at most
				{pc(RT.unexplainedMax, 2)} of a place's inflow.
			</li>
			<li>
				<strong>New money equals the melt: met only with retired MIND counted.</strong> New MIND
				({fmt(RT.issuedMind, 2)} a person a day) equals the melt ({fmt(RT.meltedMind, 2)}) plus the MIND retired with
				COOPs that ended ({fmt(RT.retiredMind, 2)}), to within {pc(Math.abs(issueGap()), 1)}. So the stock of money
				{RT.stockGrowth < 0 ? 'shrank' : 'grew'} a little: {sg(RT.stockGrowth)} MIND a person a day, about
				{pc((Math.abs(RT.stockGrowth) * 365) / DYN.money, 1)} of it a year. It stands at {fmt(DYN.money)} MIND a person,
				{pc(-moneyGap(), 1)} below <Tex tex={String.raw`u/r = ${tn(steadyState())}`} />. At that level, ({EQ.money}) predicts
				growth of {fmt(stockGrowthDay(), 2)} MIND a person a day, and the retired MIND takes
				{RT.retiredMind > stockGrowthDay() ? 'all of it and a little more' : 'it'}. In HEARTS the melt is
				the same number, because by ({EQ.unit}) all MIND is worth as many HEARTS as there are MINDs.
			</li>
			<li>
				<strong>COOPs stay solvent: not met.</strong> Treasuries were short of working capital on
				{fmt(DYN.coopDaysShort)} COOP-days in {SIM.years} years ({fmt(DYN.coopDaysShortAfter10)} after year 10),
				against {STATIC.coopDaysShort} in the static world. After the {DYN.failures + DYN.exits} ends,
				{fmt(PROOF.endedShort)} person-days were short of basics.
			</li>
			<li>
				{#if DYN.bundleChange < 0}<strong>Basics get cheaper: met.</strong> In the last ten years, a day's basics cost
				{pc(-DYN.bundleChange, 1)} less in HEARTS each year, as productivity rises.{:else}<strong>Basics get cheaper: met
				over the run, not in the last ten years.</strong> A day's basics cost {fmt(PRICES_BY_YEAR[1].bundle, 3)} HEARTS
				in year 1 and {fmt(PRICES_BY_YEAR[SIM.years].bundle, 3)} in year {SIM.years}. In the last ten years, they cost
				{pc(DYN.bundleChange, 1)} more each year.{/if}
			</li>
			<li>
				<strong>People own the economy: not met.</strong> They hold {pc(DYN.people)} of all MIND by value (Table
				{TAB.twoWorlds}). Treasuries hold {pc(DYN.treasuries)} as reserves, and people own those COOPs.
			</li>
			<li>
				<strong>Holding does not beat the melt: not met.</strong> In the last ten years, the lasting return
				<Tex tex={String.raw`\mu`} /> was {pc(DYN.mu, 1)}, above the {pc(RATE)} melt (Section 11.2.5).
			</li>
		</ul>
		<p>
			Values in HEARTS moved too (Section 6.3). A day of living grew from {fmt(PRICES_BY_YEAR[1].living, 1)} HEARTS in
			year 1 to {fmt(PRICES_BY_YEAR[60].living)} in year 60, because people consume more, not because things got dearer.
			A day's basics fell from {fmt(PRICES_BY_YEAR[1].bundle, 3)} to {fmt(PRICES_BY_YEAR[60].bundle, 3)} HEARTS: from
			{pc(bundleShareOfLiving(1))} of a day of living to {pc(bundleShareOfLiving(60), 2)}. MIND values spread: in the
			last ten years, from {fmt(DYN.pricesMin, 2)} to {fmt(DYN.pricesMax, 2)} HEARTS. In the static world, where nothing
			changed, every MIND ended between {fmt(STATIC.pricesMin, 2)} and {fmt(STATIC.pricesMax, 2)}. Table {TAB.prices}
			shows the path.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.prices}.</strong> Values in HEARTS and in days of living, in the simulation of Section 11.2.1. The last column shows how far single MINDs spread around the average MIND, which is worth 1 HEART.</caption>
				<thead>
					<tr><th>Year</th><th class="num">A day of living, HEARTS</th><th class="num">Basics a day, HEARTS</th><th class="num">Basics, share of a day of living</th><th class="num">MIND values, HEARTS</th></tr>
				</thead>
				<tbody>
					{#each [1, 10, 30, 60] as y (y)}
						{@const p = PRICES_BY_YEAR[y]}
						<tr><td>{y}</td><td class="num">{fmt(p.living, 1)}</td><td class="num">{fmt(p.bundle, 3)}</td><td class="num">{pc(bundleShareOfLiving(y), y > 10 ? 2 : 1)}</td><td class="num">{fmt(p.vMin, 2)}–{fmt(p.vMax, 2)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<h4 id="evidence">11.2.3 The evidence, person by person</h4>
		<p>
			Picture Anna's Aven delivering nothing, ever. Anna owns a little of many COOPs, and she lives from what she owns.
			In the simulation, {OWNER_ONLY.count} people live like Anna: every tenth
			person. Table {TAB.prop3} gives the checks of Proposition 3.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.prop3}.</strong> Proposition 3 in the simulation. Parts 1 and 2 are checked for every person at every step: daily in year 1, weekly after, each week counted as seven person-days. Part 3 is checked for every tenth.</caption>
				<thead>
					<tr><th>Part</th><th>What we checked</th><th>Result</th></tr>
				</thead>
				<tbody>
					<tr><td>1. No one starves</td><td>Every person-day from day {PROOF.fromDay}</td><td>Not met: {fmt(PROOF.short)} of {fmt(PROOF.personDays)} below {pc(BASIC_BUNDLE.tolerance)}, {inYears(shortYears)}; the worst person-day had {pc(PROOF.worst)}, in year {PROOF.worstYear}</td></tr>
					<tr><td>1, after shocks</td><td>The {SIM.shockAfterDays} days after each of {PROOF.shocks} shocks</td><td>{fmt(PROOF.shockShort)} of {fmt(PROOF.shockPersonDays)} short; the worst had {pc(PROOF.shockWorst)}</td></tr>
					<tr><td>1, after ends</td><td>The {SIM.endAfterDays} days after {PROOF.failures} failures and {PROOF.exits} exits</td><td>{fmt(PROOF.endedShort)} of {fmt(PROOF.endedPersonDays)} short; the worst had {pc(PROOF.endedWorst)}</td></tr>
					<tr><td>2. Normal test</td><td>Every owner-only person, every day from day {PROOF.fromDay}</td><td>Not met: {fmt(PROOF.normal.short)} owner-only person-days were short, the worst with {pc(PROOF.normal.worst)}, when the basics themselves ran short. No holding ran out: the lowest was {fmt(PROOF.normal.lowestHolding)} HEARTS in year {PROOF.normal.lowestYear}, about {fmt(holdingLivingDays())} days of living, or {fmt(holdingCoverYears())} years of basics with nothing flowing in</td></tr>
					<tr><td>Strict test (not claimed)</td><td>Dividends alone, for every owner-only person</td><td>Missed on {pc(1 - strictEarly.share)} of their person-days in year {strictEarly.year}, and on up to {pc(1 - strictLater.share)} in a later year until year {PROOF.strict.lastShortYear} (year {strictLater.year}); after year 10, on {pc(1 - PROOF.strict.shareAfter10, 2)}, all in years {PROOF.strict.lateMiss.from} to {PROOF.strict.lateMiss.to}; in year {SIM.years}, dividends alone covered only {pc(PROOF.strict.lateMissEnd)} of their person-days, and the worst day paid {fmt(PROOF.strict.endRatio, 2)} times the bundle</td></tr>
					<tr><td>3. Living standards rise</td><td>Real consumption of every tenth, at every ten-year mark</td><td>Not met: the poorest tenth fell {markFallWords}, and every ten-year window that starts in years {fallStarts} ends lower for them. Poorest {fmt(DECILES.d1[0], 1)} → {fmt(DECILES.d1.at(-1), 1)} HEARTS a day at day-1 prices (×{fmt(growth('d1'))}); middle ×{fmt(growth('d5'))}; richest ×{fmt(growth('d10'))}</td></tr>
				</tbody>
			</table>
		</div>
		<figure>
			<LineChart
				title={`Real consumption a person a day, at the prices of day 1, for the poorest, the middle and the richest tenth, years 1 to ${SIM.years}`}
				series={living}
				x={{ min: 1, max: SIM.years, ticks: [1, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Year' }}
				y={{ min: 10, max: 10_000, log: true, ticks: [10, 100, 1_000, 10_000], fmt: (v, tip) => (tip ? `${fmt(v, 1)} HEARTS` : v >= 10_000 ? `${fmt(v / 1000)}k` : fmt(v)), label: 'HEARTS a day, day-1 prices (log)' }}
				refs={[{ axis: 'x', at: PROOF.worstYear, label: 'basics short' }]}
			/>
			<figcaption>
				<strong>Figure {FIG.deciles}.</strong> Real consumption at the prices of day 1, on a log scale, where each step
				up is ten times as much. The poorest tenth are exactly the {OWNER_ONLY.count} owner-only people. The line
				marks year {PROOF.worstYear}, when {worstGoods} ran short after a capacity shock.
			</figcaption>
		</figure>
		<p>
			Every tenth gains over the whole run, but not alike. The Gini index of consumption grew from
			{fmt(DECILES.gini[0], 2)} to {fmt(DECILES.gini.at(-1), 2)}, because Avens that deliver more earn more. Part 3
			fails even at ten-year marks. In HEARTS a day at day-1 prices, the poorest tenth had {markFallNumbers}.
		</p>
		<p id="founding">
			<strong>The founding, reported on its own.</strong> Proposition 3 is claimed from day {PROOF.fromDay}, when every
			person holds MIND. In days 1 to {PROOF.genesis.days}, nobody holds MIND yet and the pools are empty. Of
			{fmt(PROOF.genesis.personDays)} person-days, {PROOF.genesis.short} were short, and the worst had
			{pc(PROOF.genesis.worst)} of the basics, on day 1. In the earlier static world, {pc(STATIC.coldStart.day1, 1)}
			of people went short on day 1, and {pc(STATIC.coldStart.year1, 1)} of person-days over year 1. Fix (proposed):
			the bootstrap (C3, Section 12.4). The simulation does not test it yet; the test city did (Section 11.3.3).
		</p>
		<h4 id="longterm">11.2.4 Long-lived projects and rivals</h4>
		<p>
			The simulation shows it. Over {BM.SOLAR.years} years, the MINDs of the city's infrastructure returned between
			{pc(mindRange('mean')[0], 1)} and {pc(mindRange('mean')[1], 1)} a year in HEARTS, dividends and price changes
			together, before the melt: solarMIND {pc(BM.SOLAR.mean, 1)}, windMIND {pc(BM.WIND.mean, 1)}, habitatMIND
			{pc(BM.HABITAT.mean, 1)} and cityMIND {pc(BM.CITY.mean, 1)}. artsMIND, of the COOP that sells experiences,
			returned {pc(BM.ARTS.mean, 1)}. Yet the solar COOP, the habitat COOP and the City COOP won their markets: by year
			{SIM.years}, they made {pc(BM.SOLAR.share60)} of the energy, {pc(BM.HABITAT.share60)} of the housing and
			{pc(BM.CITY.share60)} of the water (Table {TAB.rivals}). Winning a market did not lift their MINDs for long. Their
			holders gained through Law 5 on the sales, and these returns stayed below the melt, so a holding of these MINDs
			that is not spent still shrinks (Section 5.4).
		</p>
		<figure>
			<LineChart
				title={`What a holder keeps of ${fmt(1000)} HEARTS invested in year 1, against the same HEARTS left idle`}
				series={holders}
				x={{ min: 1, max: SIM.years, ticks: [1, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Year of the run' }}
				y={{ min: 1, max: 10_000_000, log: true, ticks: [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000], fmt: (v, tip) => (tip ? `${fmt(v, v < 100 ? 1 : 0)} HEARTS` : v >= 1_000_000 ? `${fmt(v / 1_000_000)} M` : v >= 1000 ? `${fmt(v / 1000)}k` : fmt(v)), label: 'HEARTS (log)' }}
			/>
			<figcaption>
				<strong>Figure {FIG.holder}.</strong> What a holder keeps of {fmt(1000)} HEARTS invested in year 1 of the main
				run, valued in HEARTS, on a log scale. Law 4 gives the investor {fmt(INVESTOR_SHARE, 1)} MIND for each HEART;
				the other half went to the treasury and the pools. Each line grows at its MIND's compounded return, with the
				dividends kept as more of the same MIND, and melts at {pc(RATE)} a year like any balance. In year {SIM.years},
				the idle HEARTS had melted to {fmt(holdEnd('idle'), 1)}. The holder of solarMIND kept {fmt(holdEnd('SOLAR'), 1)},
				of habitatMIND {fmt(holdEnd('HABITAT'), 1)} and of cityMIND {fmt(holdEnd('CITY'), 1)}. The holder of artsMIND
				had {fmt(holdEnd('ARTS') / 1_000_000, 1)} million (Section 11.2.5).
			</figcaption>
		</figure>
		<p>
			Competition did not stay even. Each COOP's productivity grew at its own assumed rate, from
			−{pc(-SIM.prodRange[0], 1)} to {pc(SIM.prodRange[1])} a year. The COOP that pulled ahead sold cheaper, sold more, built more and pulled further ahead. By year
				{SIM.years}, the {list(sole)} each came from one COOP alone (Table {TAB.rivals}). Each of the {ENERGY_ENTRANTS.count} new energy COOPs exited within {ENERGY_ENTRANTS.years} years.
			Selection moved the market to the COOPs whose assumed productivity grew fastest. So output per unit of plant rose
			{fmt(DYN.outputPerPlant, 1)}-fold, about {pc(plantGrowthRate(), 1)} a year, against the {pc(SIM.prodGrowth)} that a
			COOP drew on average.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.rivals}.</strong> The largest seller's share of each good, and the COOPs founded and ended over {SIM.years} years, in the simulation of Section 11.2.1.</caption>
				<thead>
					<tr><th>Good</th><th class="num">Year 1</th><th class="num">Year {SIM.years}</th><th class="num">Founded</th><th class="num">Ended</th></tr>
				</thead>
				<tbody>
					{#each goods as g (g.good)}
						<tr><td>{g.name}</td><td class="num">{pc(g.y1)}</td><td class="num">{g.y60 == null ? 'none' : pc(g.y60)}</td><td class="num">{g.founded}</td><td class="num">{g.ended}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p>
			Basics got much cheaper over the run, but no longer in the last ten years (Section 11.2.2). And the simulated
			leaders price to
			clear their capacity, not for profit, and a real manager might not.
		</p>
		<h4 id="fairsim">11.2.5 Fair ownership in the model</h4>
		<p>
			Section 9.2 showed that the melt bounds how unequal ownership can grow, if the lasting return
			<Tex tex={String.raw`\mu`} /> stays below it. Here the simulation does not meet the theory. In the last ten years
			of the main run, <Tex tex={String.raw`\mu = ${tn(DYN.mu * 100, 1)}\,\%`} /> in HEARTS, and its spread between
			people was <Tex tex={String.raw`\sigma_W = ${tn(DYN.sigma * 100, 1)}\,\%`} />. So <Tex tex={String.raw`\mu`} /> was
			{fmt(-meltMargin(), 1)} points above the {pc(RATE)} melt, and ({EQ.gini}) has no resting state. Over the whole
			run, <Tex tex={String.raw`\mu`} /> averaged {pc(DYN.muRun, 1)}, at or above the melt in
			{DYN.muYearsAbove.years} of {DYN.muYearsAbove.of} years.
		</p>
		<p>
			<Tex tex={String.raw`\mu`} /> sits close to the melt and depends on the seed: above it on {SEEDS.n - SN.below} of
			{SEEDS.n} seeds, below it on {SS.new.below} of {SS.n} seeds with the same shocks (median
			{pc(SS.new.muMedian, 2)}). Where it is above, nothing bounds how unequal ownership can grow.
		</p>
		<p>
			What people hold grew more unequal in the last twenty years. Its Gini index was {fmt(DYN.giniOwnedBy.y40, 2)} in
			year 40, {fmt(DYN.giniOwned, 2)} in the last ten years and {fmt(DYN.giniOwnedBy.y60, 2)} in year {SIM.years},
			against Germany's {fmt(GINI_DE, 2)}. What an Aven delivers differs from Aven to Aven. People whose Avens earn more
			than the median hold {fmt(DYN.topBottom, 1)} times as much as the rest. In the static world, whose prices were
			capped (Section 11.2.1), these were {fmt(STATIC.giniOwned, 2)} and {fmt(STATIC.topBottom, 1)}. There, with all
			Avens alike the Gini index was {fmt(STATIC.avenEven, 2)}, and with Avens twice as unequal it was
			{fmt(STATIC.avenDouble, 2)}.
		</p>
		<p>
			<strong>A warning about the Gini index.</strong> The measured Gini index of what people hold is not a resting
			level. At the end of the main run it still rose about {fmt(DYN.giniTrend, 3)} every ten years, and it still rose
			on {SN.rising} of {SEEDS.n} seeds. And the Gini index of ({EQ.gini}) counts only the spread of returns. It leaves
			out that Avens earn different pay, which adds its own spread. So the two indices measure different things. Here
			({EQ.gini}) gives {fmt(DYN.gini2, 2)}, because <Tex tex={String.raw`\mu`} /> is above the melt.
		</p>
		<p>
			The simulation also shows the warning of Proposition 2. Of the {MIND_RETURNS.withThreeYears} MINDs that lived at
			least three years, {MIND_RETURNS.aboveMelt} returned more than the melt on average, and
			{MIND_RETURNS.aboveMeltEnded} of those then ended. One, artsMIND, returned {pc(MIND_RETURNS.arts.compounded, 1)}
			a year for {MIND_RETURNS.arts.years} years. A person who held only artsMIND would have grown without limit. Avens
			that spread what people own lower the average, but the simulation's Avens did not keep it below the melt. Section
			8.1 gives the returns of the other MINDs.
		</p>
		<p>
			Dividends make holding pay. In the simulation, people buy far more than basics. A year's sales are about
			{pc(impliedSales(), 1)} of the MIND that others hold, so the dividend yield is {pc(DYN.yield, 1)}, above the melt.
			So the yield alone breaks the sales bound of Section 5.4. That bound assumes that prices and COOPs stay the same.
			What matters is <Tex tex={String.raw`\mu`} />: dividends plus price changes. In HEARTS, the average MIND neither
			rises nor falls, because ({EQ.unit}) fixes it at 1. In the last ten years, price changes
			{DYN.priceChange < 0 ? 'took' : 'added'} {pc(Math.abs(DYN.priceChange), 1)} a year
			{DYN.priceChange < 0 ? 'from' : 'to'} what people hold, and the MIND of a COOP that ends is lost. So a fortune
			that is spread over many MINDs, and not spent, did not halve at all. At {pc(DIVIDEND_SHARE)}, Law 5 traded too
			much levelling speed for a living from ownership.
		</p>
		<p>
			We tested three shares for Law 5, one run each. At {pc(DIVIDEND_SHARE)}, the yield is {pc(V('main').yield, 1)}
			and <Tex tex={String.raw`\mu`} /> {pc(V('main').mu, 1)} in the last ten years, and all three parts of Proposition
			3 fail (Section 11.2.6). At {pc(law35.share)}, the yield is {pc(law35.yield, 1)} and <Tex tex={String.raw`\mu`} />
			{pc(law35.mu, 1)}. No one went short of basics, owner-only people included. But the poorest tenth consumed less
			at one ten-year mark than at the mark before, so part 3 fails. At {pc(V('law50').share)},
			<Tex tex={String.raw`\mu`} /> rises to {pc(V('law50').mu, 1)}, and part 3 fails too. None of the three shares
			passed. In the static world, every want had a limit, people spent only {pc(STATIC.spent)} of their income, and
			the yield was only {pc(STATIC.yield, 1)}.
		</p>
		<p>
			<strong>The melt tests.</strong> Can another lever bring <Tex tex={String.raw`\mu`} /> below the melt? We ran the main
			run on {SEEDS.n} seeds, {SEEDS.from} to {SEEDS.to}, and changed one lever at a time (Appendix G). As it
			stands, the main run's <Tex tex={String.raw`\mu`} /> lay between {pc(SN.muMin, 1)} and {pc(SN.muMax, 1)} on
			these seeds, and below the melt on only {seeds(SN.below)}.
		</p>
		<ul>
			<li>
				<strong>A higher melt failed.</strong> At a {pc(MT.melt9.melt)} melt, <Tex tex={String.raw`\mu`} /> lay
				between {pc(MT.melt9.new.mu[0], 1)} and {pc(MT.melt9.new.mu[1], 1)}. It stayed above that melt on
				{seeds(SEEDS.n - MT.melt9.new.below)}, and all three checks passed on {noneOr(MT.melt9.new.pass)} of the {SEEDS.n} seeds.
				At {pc(MT.melt8.melt)}, <Tex tex={String.raw`\mu`} /> stayed above the melt on
				{seeds(SEEDS.n - MT.melt8.new.below)}, and the checks passed on {MT.melt8.new.pass}.
			</li>
			<li>
				<strong>Longer reserves failed.</strong> With {MT.res12.months} months, <Tex tex={String.raw`\mu`} /> lay
				between {pc(MT.res12.new.mu[0], 1)} and {pc(MT.res12.new.mu[1], 1)}, above the melt on
				{seeds(SEEDS.n - MT.res12.new.below)}. On the main seed, part 3 failed (Table {TAB.variations}). All three
				checks passed on only {MT.res12.new.pass} of the {SEEDS.n} seeds.
			</li>
			<li>
				<strong>Only a lower Law 5 share kept <Tex tex={String.raw`\mu`} /> below the melt.</strong> At
				{pc(MT.law10.share)}, <Tex tex={String.raw`\mu`} /> lay between {pc(MT.law10.new.mu[0], 1)} and
				{pc(MT.law10.new.mu[1], 1)}, below the melt on {ofSeeds(MT.law10.new.below)}, by at least
				{fmt(MT.law10.new.marginMin * 100, 1)} points. At {pc(MT.law15.share)}, it stayed below on
				{ofSeeds(MT.law15.new.below)}{MT.law15.new.marginMin < 0
					? `; on ${SEEDS.n - MT.law15.new.below === 1 ? 'the other seed, it was' : 'the others, it was up to'} ${fmt(-MT.law15.new.marginMin * 100, 2)} points above`
					: `, but by only ${fmt(MT.law15.new.marginMin * 100, 2)} points on the closest one`}.
				All three checks passed on {MT.law10.new.pass} and on {MT.law15.new.pass} of the {SEEDS.n} seeds.
			</li>
		</ul>
		<p>
			<strong>Law 5 stays at {pc(DIVIDEND_SHARE)}.</strong> A lower share pays owners less: at {pc(MT.law10.share)},
			the dividend yield was {pc(MT.law10.new.yieldMid, 1)} on the median seed, against {pc(DYN.yield, 1)} in the main
			run. We keep {pc(DIVIDEND_SHARE)}, and we say plainly what that means. In these runs, holding beat the melt on
			{SEEDS.n - SN.below} of {SEEDS.n} seeds. So Proposition 2 sets no bound on how unequal ownership can grow. The
			melt still takes {pc(RATE)} a year from every holding, but the lasting return is larger. A bound, if there is
			one, must come from Avens that spread holdings (C4). The test city must measure it over whole runs (Section
			12.5).
		</p>
		<p>
			Law 5 alone does not bring the MIND to people. The rest of every sale lands in the treasury. Under the payout rule
			(Section 4), a treasury keeps reserves for {SIM.reserveMonths} months, grows its plant first, and pays out what it
			holds above that. In the last ten years it paid {pc(treasuryShare('items'))} of what it keeps for running work
			and {pc(treasuryShare('proposals'))} for new work. The dividends never pass through it: each sale pays them
			at once. People hold {pc(DYN.people)} of all MIND by value, treasuries {pc(DYN.treasuries)} and the pools
			{pc(DYN.pools)}. People own the COOPs that hold those reserves. In year {SIM.years}, the lowest reserve was
			{RESERVES.minDays} days of running costs, and the median {RESERVES.medianDays}:
			{fmt(RESERVES.medianDays / RESERVES.days, 1)} times the {RESERVES.days} days of the target. One reason is that the
			target also covers planned building, which these days leave out. The target is a tuned number. With
			{V('res6').months} months, food ran short {inYears(V('res6').foodYears)}. With {V('res12').months} months, no one
			went short on the main seed, but part 3 failed, and all three checks passed on only {MT.res12.new.pass} of the
			{SEEDS.n} seeds (the melt tests above). If treasuries keep their whole surplus, it melts there: in the static
			world, people then held only {pc(STATIC.keepSurplus)}. So fair ownership needs the payout rule.
		</p>
		<p>
			Proposition 2 holds only under conditions. Table {TAB.prop2} lists them, and what the simulation found for each.
			Arbitrage profits from the pools are a lasting return, so they must flow back to all people, or batch trading
			must remove them. And a COOP that closed its doors to new HEARTS would create scarcity for its first owners.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.prop2}.</strong> The conditions of Proposition 2, and what the simulation found for each.</caption>
				<thead>
					<tr><th>Condition</th><th>In the simulation</th></tr>
				</thead>
				<tbody>
					<tr><td>The lasting return <Tex tex={String.raw`\mu`} /> stays below the melt</td><td>Not met: {pc(DYN.mu, 1)} in the last ten years of the main run; above the melt on {SEEDS.n - SN.below} of {SEEDS.n} seeds; only a lower Law 5 share kept it below on every seed</td></tr>
					<tr><td>Every COOP accepts HEARTS from anyone</td><td>Assumed</td></tr>
					<tr><td>The euro border: euros never make MIND, and no person changes MIND into euros (Section 8.3)</td><td>A closed city, with no euros</td></tr>
					<tr><td>A rule for estates</td><td>Not modelled</td></tr>
					<tr><td>The payout rule (Section 4)</td><td>People hold {pc(DYN.people)} of all MIND, treasuries {pc(DYN.treasuries)}, pools {pc(DYN.pools)}</td></tr>
					<tr><td>All land with the City COOP</td><td>An earlier model: a Gini index of {fmt(STATIC.land.city, 2)}, against {fmt(STATIC.land.private, 2)} with private land</td></tr>
					<tr><td>Work proposals open to every Aven</td><td>The top half of Aven pay holds {fmt(DYN.topBottom, 1)} times the bottom half</td></tr>
					<tr><td>Arbitrage profits flow back to all people</td><td>Not measured</td></tr>
				</tbody>
			</table>
		</div>
		<h4 id="fails">11.2.6 What fails, and the fixes</h4>
		<p>
			From the end of the founding, the main run fails all three parts of Proposition 3, and the strict test too. For
			each failure we propose a fix, but none is tested yet.
		</p>
		<ul>
			<li>
				<strong>Food COOPs that fail.</strong> Here, {foodFailures}: {FAILURE.coop} in year {FAILURE.year} and
				{FAILURE.second.coop} in year {FAILURE.second.year}. {scrappedWords} (the idle-plant rule, Section 9.1). Basics ran short
				{inYears(shortYears)}, after a capacity shock, and owner-only people went short too. The last version of this
				paper leased every failed plant to a successor, even an idle one. On the main seed, {SEEDS.noFix.main.food} food
				COOPs then failed, {SEEDS.noFix.main.successors} of them successors that leased an idle plant, and
				{fmt(SEEDS.noFix.main.short)} person-days were short. That version named the smaller treasury part of the new
				pool rule as a candidate cause. It was not the cause. Most of those failures came from the idle plants, and one
				seed is one random history (below). Fix (proposed): the stock rules and founding signals for food below.
			</li>
			<li>
				<strong>Dividends alone.</strong> The proposition does not claim them, but they show how thin the margin is.
				They missed often (Table {TAB.prop3}). In year 40, dividends were {pc(ownerOnlyDividendShare(40), 1)} of what flowed in to the owner-only
				people, if we count their new ownership at 1 HEART a MIND, the average (Section 6.3). In year {SIM.years}, they
				were only {pc(ownerOnlyDividendShare(60), 1)}, so these people lived almost only from the ownership that their
				investing creates each day. The cause: Law 5 pays only on sales. In year {SIM.years}, cityMIND made up
				{pc(ownerCity.share)} of what the group held, and it pays almost nothing, because ground rent is not a sale and
				the City COOP sells little water. Another {pc(ownerIdle)} was the MIND of a food COOP and an energy COOP that
				sold almost nothing by then. The group's yield was {pc(ownerOnlyYield(), 1)}, against the city's
				{pc(DYN.yield, 1)}. Fix
				(proposed): C4, the Aven's holding mix. No rule changes, and ground rent stays with the City COOP.
			</li>
			<li>
				<strong>The poorest tenth fell</strong> (Table {TAB.prop3}). From year {dip.from} to {dip.to}, their real
				consumption fell {pc(-dip.fall)}. {#if OWNER_ONLY.holding60 < OWNER_ONLY.holding40}Their holdings fell too:
				from {fmt(OWNER_ONLY.holding40)} HEARTS in year 40 to {fmt(OWNER_ONLY.holding60)} in year {SIM.years}, and
				their dividends with them (above). So they had less to spend, but we do not yet know why their holdings
				fell.{:else}Their holdings did not fall: they rose from {fmt(OWNER_ONLY.holding40)} HEARTS in year 40 to
				{fmt(OWNER_ONLY.holding60)} in year {SIM.years}. So we do not yet know the cause.{/if} A run that tracks what
				they held and bought, and at what prices, must find it. Fix: none yet. The test city checks every window, not
				only ten-year marks.
			</li>
			<li>
				<strong>Food is the weak point.</strong> Food rots in the simulation. In the real city, a food forest also takes
				{ENERGY.forest.fullYear} years to reach full yield (Section 8.4). Food ran short in the main run and in {foodShort()} of the
				{LADDER.length - 1} variations, and in {foodOnlyShort()} of them it was the only basic short in the worst years.
				Fix (proposed): keep {ENERGY.foodStockDays} days of food in hand, and let prices read the coming harvest. Keep two
				or more food COOPs at all times, and prompt a Law 3 founding when food need goes unmet. The City COOP leases at
				once a failed food plant that people still use. These are stock rules and founding signals, never a protected price.
			</li>
			<li>
				<strong>Near-monopolies.</strong> By year {SIM.years}, the {list(sole)} each came from one COOP alone (Table {TAB.rivals}). The
				evidence does not yet test C2 against a leader that prices for profit. Fix (proposed): the three rules of
				Section 9.1.
			</li>
			<li>
				<strong>The lasting return above the melt.</strong> <Tex tex={String.raw`\mu`} /> was {pc(DYN.mu, 1)} in the
				last ten years of the main run, above the melt, so Proposition 2 sets no bound (Section 11.2.5). In the last ten
				years, {variationsMuAbove()} of the {LADDER.length - 1} variations reached {pc(RATE)} or more. Fix (proposed): Avens that spread holdings (C4). The test city must find what keeps
				<Tex tex={String.raw`\mu`} /> below the melt over a whole run, with the rate as a parameter (Section 12.5).
			</li>
			<li>
				<strong>Newcomers.</strong> When the population grows, newcomers start with nothing, and some went short in their
				first weeks. Owner-only people went short too, with {pc(V('pop').ownerWorst)} of the basics on the worst day. The
				poorest of them consumed {fmt(V('pop').poorOwner[0], 1)} HEARTS a day, at day-1 prices, in year 10 and {fmt(V('pop').poorOwner[1], 1)}
				in year 20. Fix (proposed): the same bootstrap as day 1, for every newcomer.
			</li>
		</ul>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.variations}.</strong> The main run and {LADDER.length - 1} variations, one run each, on the main seed. Checks: 1 no one starves, 2 no one has to work (normal test), 3 living standards rise. The strict test passed only with Law 5 at {pc(V('law50').share)}. μ is the lasting return in the last ten years, in HEARTS.</caption>
				<thead>
					<tr><th>Run</th><th class="checks">Checks 1 · 2 · 3</th><th><Tex tex={String.raw`\mu`} /></th><th>What broke first</th></tr>
				</thead>
				<tbody>
					{#each LADDER as v (v.id)}
						<tr><td>{v.label}</td><td class="checks">{v.checks.map(mark).join(' · ')}</td><td>{pc(v.mu, 1)}</td><td>{v.broke}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p>
			On the main seed, {noneOr(allPass())} of the {LADDER.length} runs passed all three checks{allPass() ? `: ${list(passing().map((v) => runWords[v.id]))}` : ''}.
			Of the variations, {only3Fails.length} passed parts 1 and 2 but failed part 3:
			{list(only3Fails.map((v) => runWords[v.id]))}. On {SEEDS.n} seeds, the main run passed all three checks on
			{SN.pass}: part 1 on {SN.check1}, part 2 on {SN.check2} and part 3 on {SN.check3}. Reserves of
			{V('res12').months} months passed on {MT.res12.new.pass}, and the old pool rule on {SO.pass} (Section 11.2.5).
		</p>
		<p>
			The margin of ({EQ.normal}) stayed wide in most runs: ×{fmt(bundleMargin(law35.bundleMax), 1)} with Law 5 at
			{pc(law35.share)}, and ×{fmt(bundleMargin(V('prod0').bundleMax), 1)} without productivity growth. It was
			smallest with {runWords[tightest.id]}, at ×{fmt(bundleMargin(tightest.bundleMax), 1)}. Yet owner-only people
			went short in {ownerShort} of the {LADDER.length} runs, the main run among them. In each of those runs, the basics
			themselves ran short (part 1). In {starveFail()} of the {LADDER.length - 1} variations, someone ran short of
			basics. Law 5's share and the reserves are in Section 11.2.5. One more lesson follows: growth must come from
			somewhere. Without productivity growth, food ran short in
			{V('prod0').shortYears} of the {SIM.years} years, on up to {pc(V('prod0').worstYearShare)} of person-days (year
			{V('prod0').worstYear}), owner-only people included. With {pc(SIM.prodGrowth)} for every COOP, output per unit of
			plant grew only {pc(plantGrowthRate(V('even').plant), 1)} a year, and part 3 failed. Without a good that never
			satisfies (experiences), people spent {pc(V('wants').spent)} of their income, and dividends fell to almost
			nothing. One tension stays open. The COOPs that grew fastest won their markets, and so output per unit of plant
			rose fast. The same selection made the near-monopolies of Section 9.1. The test city repeats every check for
			every person on every day (Section 11.3.1).
		</p>
		<p>
			On the same shocks, a pools' part of {fmt(POOL_SHARE, 1)} left fewer person-days short than
			{fmt(OLD_POOL_SHARE, 2)} (Appendix G). We tested the idle-plant rule itself the same way, under the
			new pool rule. It cut food COOP failures from {SS.fix.no.food} to {SS.fix.yes.food}: fewer on
			{SS.fix.tests.food.better} seeds, and more on {noneOr(SS.fix.tests.food.worse)} (<em>p</em> =
			{pv(SS.fix.tests.food)}). But it left the person-days short almost unchanged, {fmt(SS.fix.yes.short)} against
			{fmt(SS.fix.no.short)}, and all three checks passed on {SS.fix.yes.pass} seeds with it and on {SS.fix.no.pass}
			without it. So the rule ends the chains of failed plants, but most shortages have other causes (Section 12.5).
		</p>
		<h3 id="city">11.3 The test city</h3>
		<p>
			The test city is the second simulation. Its simulated residents live, trade and invest under the rules of this
			paper, in a village with land, energy and a euro border, which the economic model does not have. Every rule is a
			parameter: we can measure it, change it through an open proposal and play again. Its residents' Avens follow fixed
			rules, so the test city first tests the code and the mechanisms. AI agents, sessions with human players and then a
			small pilot will test how people behave. The rules that survive the test city become the economy of maiaCITY
			while we build it.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.cityParts}.</strong> Each part of theOS, first in the test city, then in the real city.</caption>
				<thead>
					<tr><th>Part</th><th>In the test city</th><th>In the real city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>Every resident gets {UIA_DAY} personal HEARTS a day, which it can only invest</td><td>Every person with a verified identity gets {UIA_DAY} personal HEARTS a day: one stream per human</td></tr>
					<tr><td>COOPs</td><td>Residents found COOPs and invest HEARTS, which convert into MIND</td><td>The Village COOP runs the geothermal plant and the centre's works, and a food COOP runs the food forest. Each settlement has a Tribe COOP, whose MIND is tribeMIND: it owns the domes and beds there and rents them to residents</td></tr>
					<tr><td>Markets</td><td>Baskets of MINDs, fed by the pools' part of every new MIND (Law 4); the City COOP holds their LP tokens. {pc(DIVIDEND_SHARE)} of every sale goes at once to the holders of the seller's MIND</td><td>Avens route every purchase through the pools, and the seller gets its own MIND. {pc(DIVIDEND_SHARE)} of every sale, the same for every COOP</td></tr>
					<tr><td>Land</td><td>One City COOP holds the map; residents lease plots and pay ground rent</td><td>The City COOP holds all land; every citizen holds one equal share; builders lease plots like an Erbbaurecht</td></tr>
					<tr><td>Energy</td><td>Every recipe costs energy; growth comes only from surplus energy</td><td>Measured on the village's meters</td></tr>
					<tr><td>Residents</td><td>Avens that follow fixed rules; later, AI agents and human players</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Governance</td><td>Rule changes as open proposals, measured world by world</td><td>COOPs choose their own governance and compete (Section 9)</td></tr>
				</tbody>
			</table>
		</div>
		<h4 id="world">11.3.1 Its world model</h4>
		<p>
			The test city's <em>world model</em> grew from the simulation script of Appendix G. It is one engine that plays
			every example of this paper as a short scenario. Each scenario has a condition for passing.
			It starts from a fixed seed (Section 11.1), so every run of it gives the same result. Its Avens follow simple
			rules.
		</p>
		<p>
			Its agents are the ones of this paper. People act through their Avens. Each COOP has a treasury, a plant, plots
			and a manager, a rule in code that sets its prices. The City COOP holds the land, and the pools and the protocol
			do the rest. Every day, money melts and HEARTS convert into MIND. Then the COOPs harvest energy, make goods and set
			prices, and the Avens buy, with Law 5 on every sale. Once a week, the pools trade, the Avens deliver work, the
			treasuries pay out, and COOPs build, start or close.
		</p>
		<p>
			Two ledgers must close at every step. The money ledger counts every flow twice: once where it leaves and once where
			it arrives. It uses the tables of Godley and Lavoie <Cite k="godley" /> and of Caiani and others
			<Cite k="caiani" />, a method called <em>stock-flow consistent</em>. One more row holds revaluation: changes in
			value from prices, not from flows. The rows for wages, interest, loans, taxes and basic income stay empty, and so
			does the row for HEARTS held by a COOP. The second ledger counts matter and energy. What is made equals what is
			eaten, used, built in, rotted or added to stock. Harvested energy equals what is used, stored, curtailed or lost.
			The engine stops at any leak, as Mark-0 does <Cite k="gualdi" />. Mark-0 is a small agent-based model of a whole
			economy.
		</p>
		<p>
			The recipes of Section 8.4 and Appendix H set every limit, and nothing caps growth or prices. Every day, each basic
			records its <em>binding limit</em>: the input that runs out first (Section 8.4). MIND must never be that limit
			while physics allows more.
		</p>
		<p>
			We borrow rules, not code. Mark-0 gives the steps of prices and quantities <Cite k="gualdi" />. Godley and Lavoie,
			and Caiani and others, give the accounting. The model of Dosi and others gives competition, entry, exit and
			innovation <Cite k="dosi" />. All of them create money by credit and pay wages, and theOS has neither. None of them
			checks a basic bundle for every person on every day. That check is new.
		</p>
		<p>
			The scenarios replay the examples of this paper, and Proposition 3 runs on several seeds. Section 11.3.2 lists
			the rounds so far, and Section 11.3.3 gives the results of the fifth.
		</p>
		<h4 id="rounds">11.3.2 Five rounds</h4>
		<h4 id="found">11.3.3 What round 5 found</h4>
		<p>
			The fifth round ran a village of {fmt(TC.people)} residents over {TC.years} years, on {TC.seeds.length} base seeds
			and on {TC.more.seeds.length} more. It also ran {TC.suite.scenarios} scenarios and {TC.suite.experiments}
			experiments: {TC.suite.pass} passed, {TC.suite.fail} failed, and {TC.suite.compare} only compare. Every check runs
			for every resident on every day. Part 3 is judged in real units: the basics and the extras that a person gets,
			such as floor space, goods and Aven hours, not their value in money. Table {TAB.testCity} gives Proposition 3 seed
			by seed.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.testCity}.</strong> Proposition 3 in the test city, round {TC.round}: {fmt(TC.people)} residents over {TC.years} years. Every {TC.ownerOnlyEvery}th newcomer is owner-only. Part 3 counts the tenths by holdings and the tenths by Aven output.</caption>
				<thead>
					<tr><th rowspan="2">Part</th><th colspan={TC.seeds.length}>Base seed</th><th rowspan="2">Holds on</th><th rowspan="2">Holds on, seeds {TC.more.seeds[0]} to {TC.more.seeds.at(-1)}</th></tr>
					<tr>{#each TC.seeds as s (s)}<th class="num">{s}</th>{/each}</tr>
				</thead>
				<tbody>
					<tr><td>1. No one starves: person-days short of a basic</td>{#each TC.p1 as v, i (i)}<td class="num">{fmt(v)}</td>{/each}<td class="num">{holdsOn(TC.p1)} of {TC.seeds.length}</td><td class="num">{TC.more.p1} of {TC.more.seeds.length}</td></tr>
					<tr><td>2. Normal test: owner-only person-days failing</td>{#each TC.p2normal as v, i (i)}<td class="num">{fmt(v)}</td>{/each}<td class="num">{holdsOn(TC.p2normal)} of {TC.seeds.length}</td><td class="num">{TC.more.p2normal} of {TC.more.seeds.length}</td></tr>
					<tr><td>Strict test: what dividends alone paid of the basic bundle, for the lowest owner-only resident in the last year</td>{#each TC.p2strict as v, i (i)}<td class="num">{pc(v)}</td>{/each}<td class="num">{holdsOn(TC.p2strict, (v) => v >= 1)} of {TC.seeds.length}</td><td class="num">{TC.more.p2strict} of {TC.more.seeds.length}</td></tr>
					<tr><td>3. Living standards rise: tenths failing in real units, of {TC.p3.of}</td>{#each TC.p3.failing as v, i (i)}<td class="num">{v}</td>{/each}<td class="num">{holdsOn(TC.p3.failing)} of {TC.seeds.length}</td><td class="num">{TC.more.p3} of {TC.more.seeds.length}</td></tr>
					<tr><td>Abundance: day-goods (a day and a basic) on which MIND, not physics, bound a basic</td>{#each TC.abundance as v, i (i)}<td class="num">{fmt(v)}</td>{/each}<td class="num">{holdsOn(TC.abundance)} of {TC.seeds.length}</td><td class="num">—</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			The basics held better than in the simulation of Section 11.2.3: part 1 held on {holdsOn(TC.p1)} of the
			{TC.seeds.length} base seeds and missed on the others by {list(p1Missed.map((v) => fmt(v)))} person-days, and the
			normal test failed only on {normalFails.length === 1 ? 'seed' : 'seeds'}
			{list(normalFails.map(([s, v]) => `${s}, on ${fmt(v)} owner-only person-days`))}. Part 3 failed in real units on
			every seed, in {span(TC.p3.failing)} of {TC.p3.of} tenths, and only because extras fell: no basic failed, and every
			tenth's basket rose over the run. The strict test never held: in the last year, dividends alone paid the lowest
			owner-only resident {span(TC.p2strict, (v) => pc(v))} of the basic bundle. On {mindBound.length} of the base seeds,
			MIND rather than physics bound a basic, on {list(mindBound.map((v) => fmt(v)))} day-goods; Section 11.3.1 asks that
			it never does. The village owed at most
			€{fmt(TC.bank.bootstrap / 1e6, 1)} million outside, and its exports {TC.bank.repaid ? 'repaid' : 'did not repay'}
			that within {TC.years} years: in the last ten years it sold €{fmt(TC.bank.exports / 1e6, 1)} million a year abroad
			and bought €{fmt(TC.bank.imports / 1e6, 1)} million (Section 8.3). The test city still gives the pools
			{fmt(TC.poolShare, 2)} of each HEART; its next round runs the rule of Law 4.
		</p>
		<p>
			Table {TAB.scenarios} gives the scenarios that replay the examples of this paper. Each verdict is the scenario's
			condition for passing (Section 11.3.1); a comparison has none.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.scenarios}.</strong> The test city's scenarios in round {TC.round}, and what each found.</caption>
				<thead>
					<tr><th>Scenario</th><th>What happened</th><th>Verdict</th></tr>
				</thead>
				<tbody>
					<tr><td>Money melts</td><td>A balance kept {fmt(TS.melt.index30, 3)} of itself after {TS.melt.years} years, as the melt says; {TS.melt.idle} idle MIND kept {fmt(TS.melt.keep10, 1)} after {TS.melt.idleYears} years, a half-life of {fmt(TS.melt.halfLife, 1)} years</td><td>{verdict(TS.melt.pass[0])}</td></tr>
					<tr><td>The resting level</td><td>A person's MIND reached {pc(TS.melt.level30 / TS.melt.rest, 1)} of its resting level after {TS.melt.years} years</td><td>{verdict(TS.melt.pass[1])}</td></tr>
					<tr><td>The founding</td><td>{cap(shortOr(TS.founding.shortWith))} in year 1 with the founding rule. Without it, {fmt(TS.founding.shortWithout)} person-days were short in year 1, and {pc(TS.founding.day0Without, 1)} of residents were short on day 0</td><td>{verdict(TS.founding.pass)}</td></tr>
					<tr><td>A food COOP fails</td><td>{cap(shortOr(TS.foodFails.short, 'no one went short'))} of food, with one food COOP or two; the failing COOP went into receivership after {TS.foodFails.receivershipDays} days</td><td>{verdict(TS.foodFails.pass)}</td></tr>
					<tr><td>Newcomers</td><td>The village grew from {fmt(TS.newcomers.from)} to {fmt(TS.newcomers.to)}; in their first {TS.newcomers.years} years, newcomers were short on {fmt(TS.newcomers.short)} of {fmt(TS.newcomers.personDays)} person-days</td><td>{verdict(TS.newcomers.pass)}</td></tr>
					<tr><td>People arrive faster than beds</td><td>The village grew from {fmt(TS.bedsOutrun.from)} to {fmt(TS.bedsOutrun.to)}; in their first {TS.bedsOutrun.years} years, newcomers were short on {fmt(TS.bedsOutrun.short)} of {fmt(TS.bedsOutrun.personDays)} person-days</td><td>{verdict(TS.bedsOutrun.pass)}</td></tr>
					<tr><td>A founder ring</td><td>A ring of {pc(TS.ring.people)} of the residents drew {pc(TS.ring.drew, 1)} of the others' HEARTS. Its members ended with {fmt(TS.ring.endOutput, 2)} times the others' mean holding when Avens followed output, and {fmt(TS.ring.endPrice, 2)} times when they followed prices</td><td>{verdict(TS.ring.pass)}</td></tr>
					<tr><td>Sellers of a basic</td><td>With {list(TS.sellers.per.map(String))} sellers of each basic, basics sold at {list(TS.sellers.cost.map((v) => fmt(v, 2)))} times their full cost, and sellers kept {list(TS.sellers.keep.map((v) => pc(v, 1)))} of basics revenue above variable cost</td><td>{verdict(TS.sellers.pass)}</td></tr>
					<tr><td>The melt rate</td><td>At {list(TS.rates.rates.map((v) => pc(v)))}, part 3 failed at each; the Gini of holdings was {span(TS.rates.gini, (v) => fmt(v, 2))}</td><td>{verdict(TS.rates.pass)}</td></tr>
					<tr><td>All land in the City COOP</td><td>After {TS.land.years} years, the Gini of holdings was {fmt(TS.land.giniCity, 2)}, against {fmt(TS.land.giniPrivate, 2)} with private land; person-days short: {noneOr(TS.land.shortCity)}, against {fmt(TS.land.shortPrivate)}</td><td>{verdict(TS.land.pass)}</td></tr>
					<tr><td>A closed border</td><td>Over {TS.closed.years} years, closed against open: {fmt(TS.closed.hoursClosed, 1)} hours of Aven services a person a day against {fmt(TS.closed.hoursOpen, 1)}; {fmt(TS.closed.shortClosed)} person-days short against {noneOr(TS.closed.shortOpen)}; a mean living standard of {fmt(TS.closed.livingClosed, 2)} against {fmt(TS.closed.livingOpen, 2)} in the last year; part 3 failed in {TS.closed.p3Closed} tenths against {TS.closed.p3Open}</td><td>{verdict(TS.closed.pass)}</td></tr>
					<tr><td>Shocks at once</td><td>A drought, a dark winter, failing COOPs and a failing well: {fmt(TS.shocks.short)} person-days short; part 3 failed in {TS.shocks.p3Failing} tenths</td><td>{verdict(TS.shocks.pass)}</td></tr>
					<tr><td>The food forest's yield</td><td>At {list(TS.forest.yields.map((v) => `${fmt(v, 1)} times`))} its yield, {shortOr(TS.forest.short)}</td><td>{verdict(TS.forest.pass)}</td></tr>
					<tr><td>Surplus energy</td><td>Person-days short: {noneOr(TS.energy.short)} with geothermal heat and research, against {fmt(TS.energy.shortWithout)} without; the poorest tenth's living standard was {fmt(TS.energy.poorest, 2)}, against {fmt(TS.energy.poorestWithout, 2)}</td><td>{verdict(TS.energy.pass)}</td></tr>
					<tr><td>Twice the HEARTS</td><td>Prices rose {fmt(TS.money.prices, 1)}-fold, and what people got changed by at most {pc(TS.money.largest, 1)}, on each of {TS.money.seeds} seeds</td><td>{verdict(TS.money.pass)}</td></tr>
					<tr><td>Food from abroad</td><td>Food bought abroad was {pc(TS.food.bought[0])} of what was eaten in year {TS.food.at[0]}, {pc(TS.food.bought[1])} in year {TS.food.at[1]} and {pc(TS.food.bought[2])} in the last year; the village first grew all it needs in year {TS.food.selfYear}</td><td>{verdict(TS.food.pass)}</td></tr>
					<tr><td>Treasuries pay out</td><td>People's share of all MIND when treasuries pay out, against when they keep their surplus: {pc(TS.payout.x3[0], 1)} against {pc(TS.payout.x3[1], 1)} after {TS.payout.years[0]} years, and {pc(TS.payout.b02[0], 1)} against {pc(TS.payout.b02[1], 1)} after {TS.payout.years[1]}</td><td>{verdict(TS.payout.pass)}</td></tr>
					<tr><td>As unequal as Germany</td><td>The Gini of holdings rose from {fmt(TS.germany.gini[0], 2)} to {fmt(TS.germany.gini[1], 2)} with the shock, and was {fmt(TS.germany.gini[2], 2)} after {TS.germany.years} more years</td><td>{verdict(TS.germany.pass)}</td></tr>
					<tr><td>Avens that differ</td><td>With Aven skills spread {list(TS.avenSpread.spread.map((v) => fmt(v, 1)))}, the Gini of holdings after {TS.avenSpread.years} years was {list(TS.avenSpread.gini.map((v) => fmt(v, 2)))}</td><td>{verdict(TS.avenSpread.pass)}</td></tr>
					<tr><td>Law 5 at other shares</td><td>At {list(TS.law5.shares.map((v) => pc(v)))}, the dividend yield stayed under the {pc(RATE)} melt from year {list(TS.law5.belowMeltFrom.map(String))}, in that order</td><td>{verdict(TS.law5.pass)}</td></tr>
				</tbody>
			</table>
		</div>
		<h3 id="progress">11.4 Progress toward the hypotheses</h3>
		<h3 id="next">11.5 The next simulations</h3>
	</section>

	<p class="partline" id="part-5">Part V · Limits, open problems and the road ahead</p>

	<section id="limits">
		<h2><span>12</span>Limitations and open problems</h2>
		<p>
			A blueprint is only scientific if it says where it could fail. Each item below names an open problem, a rule that
			we propose for it, and how the test city tests it. Every proposed rule works inside the five laws. Appendix E collects
			the attacks in one threat model.
		</p>
		<h3>12.1 People and identity</h3>
		<ul>
			<li>
				<strong>One person, one stream.</strong> The UIA needs an identity that nobody can fake many times. The name for
				this property is Sybil resistance. A fake identity directs {fmt(u)} HEARTS a year, so the prize for faking is
				large. It must work without a central registry that can exclude people <Cite k="soul" />. Passkeys prove a
				device, not a unique person, so maiaCITY's passkey-based vaults are a start, not a proof. We propose to stage
				it. The test city and the first village use an in-person register of residents. The city uses a state eID with a
				zero-knowledge proof: a cryptographic proof that shows only "a unique resident" and nothing else. Everyone gets
				the full {UIA_DAY} HEARTS. But a new identity can direct only a capped share into any one COOP until others vouch for
				it. Regular checks make rented keys go stale. <em>Test:</em> farms of fake agents in the test city.
			</li>
			<li>
				<strong>Estates.</strong> When a person dies, the MIND that they leave goes to the City COOP or to heirs whom
				they name (Law 1). The choice barely changes inequality, because the melt shrinks any bequest fast: only
				{pct(decay(100, RATE, 30))} of it is left after 30 years. But people hold a large part of all MIND, so the
				choice matters for the City COOP's budget. <em>Test:</em> the test city runs both rules side by side.
			</li>
			<li>
				<strong>Work, care and payments between people.</strong> Open questions remain. How do care, art and
				research get paid when they sell little? And how does MIND pass between people, as a gift? Voluntary investment
				tends to underfund what everyone shares <Cite k="qf" />. We propose a default share of HEARTS, which each person
				can change, for COOPs that serve everyone, such as care, courts and research. <em>Test:</em> the test city measures
				which needs no Aven proposes work for.
			</li>
		</ul>
		<h3>12.2 COOPs and their treasuries</h3>
		<ul>
			<li>
				<strong>Self-dealing and related parties.</strong> Nothing in the laws stops a founder from investing in their
				own COOP. The founder then controls {fmt(selfDealDay(), 1)} MIND a day instead of {fmt(honestDay())}: the
				investor's part and the treasury's part, everything but the pools' part. Friends can act as each other's basket partners, and two COOPs
				could sell to each other in a circle. In the earlier static world, a founder ring drew
				{pc(STATIC.ring.hearts, 2)} of all HEARTS, though it was {pc(STATIC.ring.people, 1)} of the people. Its income
				was {fmt(STATIC.ring.income, 1)} times that of others, and after {STATIC.ring.years} years its wealth was
				{fmt(STATIC.ring.wealth, 1)} times. We propose a related-party rule. When insiders invest, the treasury's part of
				their investment waits in a locked account (escrow) until an audit confirms real output. Every treasury flow and every work proposal is
				public, with a proof of delivery. Only deliveries that a meter or an outside buyer confirms count as sales, and
				sales between related COOPs pay no dividend. <em>Test:</em> kickback COOPs, investment rings and circular sales
				as attackers in the test city.
			</li>
			<li>
				<strong>Who decides inside a COOP.</strong> Each COOP chooses its own rules, but its founders write the first
				ones. We propose a default constitution that holds until the members change it by a large majority. It follows
				the holder rule of Section 9 and gives one member one vote on membership. Every member has the rights to
				information, audit, election and recall. Avens raise a second question: whoever sets an Aven's defaults steers
				investment. So a person's own choices limit their Aven, and the Aven optimises only inside them. <em>Test:</em>
				the test city compares COOPs with and without the default.
			</li>
			<li>
				<strong>Failure and wind-down.</strong> If every Aven leaves, a corrupt COOP still holds
				{pct(decay(100, RATE, 1))} of its treasury after a year. So exit alone works slowly. We propose recall and
				receivership: when inflows fall below a threshold or an audit fails, a trustee freezes the treasury, and the
				members vote. Then an order of payment applies: work proposals first, then supplier COOPs. The physical assets
				go to the City COOP, which leases them to a COOP that runs them better, without a forced sale, or scraps a plant
				that stands idle (the idle-plant rule, Section 9.1). Section 11.2.6 reports the failures in the simulation. The
				order of payment must itself resist capture by a small group, and the legal wrapper must match it.
				<em>Test:</em> more injected failures in the test city.
			</li>
			<li>
				<strong>Long-lived projects.</strong> Who gets the rising value of a city-scale project, and does that make
				Avens fund it? Section 8.1 shows that the rise goes to its users and to new investors, and that holders gain
				through Law 5 on growing sales. theOS makes no MIND from euros and charges no interest; the City COOP gives
				euro loans, repaid in the COOP's own MIND (Section 8.3). <em>Test:</em> the test city measures whether Avens fund a
				tidal barrier or a fusion plant, and who gains from it.
			</li>
			<li>
				<strong>Competition that fades.</strong> In the simulation, the {list(sole)} each came from one COOP alone
				(Table {TAB.rivals}). Their prices stayed low, because the simulated leaders price to clear their capacity. A
				real leader might price for profit. We propose the three rules of Section 9.1. The test city ran one, two and
				four sellers of each basic (Section 11.3.3). <em>Test:</em> a leader that prices for profit.
			</li>
			<li>
				<strong>Aven capacity.</strong> The results assume that Avens deliver what the COOPs ask, at a fixed rate for each
				work proposal. We also ran Avens with a fixed capacity and a floating rate. Then all three checks failed: food ran
				short, and the worst person-day had {pc(V('aven').worst)} of the basics. <em>Test:</em> Avens with real limits,
				and rates that float.
			</li>
		</ul>
		<h3>12.3 Pools and prices</h3>
		<ul>
			<li>
				<strong>Basket admission, and a dying MIND.</strong> An equal-weight pool keeps an equal share of its value in
				each MIND, so it keeps buying a falling MIND all the way down. If one MIND loses {pc(1 - CRASH.left)} of its
				value, a pool of {CRASH.small} keeps {pct(poolAfterCrash(CRASH.left, CRASH.small) * 100)} of its value. The same
				tokens, simply held, would keep {pct(heldAfterCrash(CRASH.left, CRASH.small) * 100)}, and a pool of
				{CRASH.large} keeps {pct(poolAfterCrash(CRASH.left, CRASH.large) * 100)}. We propose
				that a MIND joins a basket only after verified output and with the consent of the COOPs already in it. Its
				founders also post a bond that they lose on fraud. A breaker stops a pool from taking in a failing MIND, while
				the pool still sells it. The breaker reacts to events, such as failed deliveries, not to prices. The failing
				COOP's inflow stops too. Once the COOP has failed, its MIND leaves the baskets. The main run of Section 11.2.1 assumes
				this rule: a failed COOP's MIND leaves the pools and is retired, and its holders lose it. In the earlier static world, a failed
				COOP's MIND kept a pool price, and its holders could still swap it for their partners' MIND. The healthy
				reserves could then move into a successor pool, by a redemption that the City COOP's members vote for (Section
				6). A hub MIND in every basket, for
				example cityMIND, keeps routes short and the network connected. <em>Test:</em> junk dumping, price pumps and
				sudden failures in the test city.
			</li>
			<li>
				<strong>Front-running and batch clearing.</strong> Every Aven payment is a small, predictable trade, and the
				pools' inflows are public. A bot can trade just before and just after it, an attack called a sandwich.
				Whoever orders the transactions can capture this value too. We propose one batch at one price per block across
				all pools, with orders sealed until the batch closes, and public rules for ordering. Avens also follow
				time-averaged prices, and only at a limited speed, so that a pushed price cannot buy investment.
				<em>Test:</em> sandwich bots and price pumps in the test city.
			</li>
			<li>
				<strong>A unit of account.</strong> Every COOP prices in its own MIND, and 1,000 COOPs have
				{fmt(pairCount(1000))} exchange rates between them. Section 6.3 settles which unit to count in: the HEART, the
				average MIND, which needs no anchor MIND. One question stays open: how stable the HEART's purchasing power is.
				What 1 HEART buys moves with what the COOPs deliver, and no rule holds it steady. In the last ten years of the
				simulation, {DYN.bundleChange < 0 ? 'basics still got cheaper' : 'basics no longer got cheaper'} (Section
				10.4). Each COOP also publishes what one of its
				MIND buys, for example kWh per solarMIND. <em>Test:</em> the test city measures how the HEART moves against a
				day of living and against the basic bundle.
			</li>
			<li>
				<strong>Liquidity that leaves only by vote.</strong> No COOP and no person can withdraw from the pools (Section
				6). So until a vote passes, nobody can repair a pool by moving money out, and every bug stays exposed. So the code must be right from
				the start. It needs verified maths, rounding in the pool's favour and one global melt index. A narrow pause may
				stop trading but never move funds (Appendix F). Equal-weight baskets are in wide use, but never yet with steady
				one-sided inflows, withdrawals only by a city's vote and melting currencies. The simulation runs with no
				redemptions. <em>Test:</em> the test city, a red team and a bug bounty test this mix before real value flows.
			</li>
			<li>
				<strong>A vote that thins a pool.</strong> A redemption takes reserves out of a pool. A thinner pool moves its
				prices more for each trade. So a pushed price costs less to make, and every payment that routes through the pool
				costs more. A vote could also empty a pool to pay for something else. The guard is the City COOP's own decision
				rule (Section 8.2), in which every citizen holds one equal share. theOS does not yet set how large a majority a
				redemption needs. <em>Test:</em> the test city runs redemptions by vote, and measures prices and routing costs
				before and after.
			</li>
		</ul>
		<h3>12.4 The founding and the border's open risks</h3>
		<ul>
			<li>
				<strong>Escape into assets.</strong> Section 2 ended on Keynes's warning: melting money pushes wealth into
				anything that does not decay <Cite k="keynes36" />. The land rule of Section 8.2 closes the largest door. Other stores of value remain, such
				as euros, art or rare objects. theOS must also decide how the City COOP sets the ground rent, and how citizens
				decide what it builds with it. <em>Test:</em> the test city offers assets that do not melt, and measures how much
				wealth flows into them.
			</li>
			<li>
				<strong>The euro border's open risks.</strong> A repayment in MIND never returns a euro (Section 8.3). So the
				founders' euros are in effect a grant, unless exports earn them back. In the test city, a village of
				{fmt(EURO_BORDER.people)} residents needed €{fmt(EURO_BORDER.euros / 1e6, 1)} million from outside, and its
				exports {EURO_BORDER.repaid ? 'repaid' : 'did not repay'} that within {EURO_BORDER.years} years (Section 11.3.3).
				Taxes are due in euros, even on services paid in MIND. <em>Test:</em> the test city adds an outside euro
				economy that residents can trade with and leave for, and counts the euros that exports earn back.
			</li>
			<li>
				<strong>Securities and co-op law.</strong> Under EU rules, a token that carries ownership and can be traded is
				likely a security, with the duties of one <Cite k="esma" />. Pools and trading Avens may count as licensed
				crypto services, and each trade may be a taxable sale. HEARTS, which nobody can transfer, probably fall outside
				crypto law. The umbrella eG of Section 8.3 describes MIND as a member's share and right to the COOP's
				services. A
				legal opinion, and rulings from BaFin, Germany's financial supervisor, and from the tax office, come before any
				real value flows. <em>Test:</em> the test city counts the taxable trades that each Aven makes.
			</li>
			<li>
				<strong>The founding of the first village.</strong> A COOP needs {POOL.partners} partners before its MIND can
				trade, so the first COOPs wait for each other. Circles, with the same {CIRCLES.day} a day and
				{pc(CIRCLES.rate)}, had about {fmt(CIRCLES.people)} registered people in {CIRCLES.asOf} <Cite k="gnosis" />.
				Empty pools are a second trap (Section 11.2.6). We propose the
				bootstrap. On opening day, the City COOP, the energy and food COOPs and the Tribe COOP of each settlement open
				together as the first basket. Residents invest their HEARTS for a founding week before the first sale. The pools' part of each new MIND
				fills the pools, so any MIND a person holds can pay any seller from the first sale. Only investment creates MIND, so nothing else may fill them. Each
				person's first investment makes them a part-owner of the basics COOPs, so Law 5 pays them a share of every
				basic sold from day one. Newcomers get the same start. Euros fund the first machines, never MIND, so that the
				COOPs deliver from day one. In the test city, {TEST_CITY.scenarios.founding.shortWith ? `${fmt(TEST_CITY.scenarios.founding.shortWith)} person-days were short` : 'no one went short'}
				in year 1 with it, and {fmt(TEST_CITY.scenarios.founding.shortWithout)} person-days were short without it
				(Section 11.3.3).
				<em>Test:</em> the first real village, judged by kWh delivered per HEART and the time to the first kWh.
			</li>
		</ul>
		<h3>12.5 What the models still lack</h3>
		<p>
			Section 5.3 gives the reasons for the rate of {pc(RATE)}. The test city runs Proposition 3 on a grid of melt rates
			(Section 11.3.3), and measures how behaviour changes with the rate.
		</p>
		<p>
			Section 10.3 lists the conditions of Proposition 3 and what the simulation found for each, and Section 11.2.5 those
			of Proposition 2.
		</p>
		<p>
			<strong>The physical numbers.</strong> The food forest's yield is the riskiest number in this paper. Peters and
			others find that diets like those of the United States need more land than the city plans <Cite k="peters" />.
			So the test city runs the yield at half and at one and a half times the plan. The energy return of deep
			geothermal and the energy for compute are estimates (Appendix H). And part 3's evidence rests on assumed growth
			with no physical limit (Section 11.2.1). So the test city must check part 3 again, with growth that only surplus
			energy pays for.
		</p>
		<p>
			<strong>Gaps in the simulation.</strong> The simulation is a model, and we found gaps in it that can move its
			results. None is fixed yet:
		</p>
		<ul>
			<li>
				<strong>The price floor.</strong> A COOP's lowest price leaves out the food that rots, the rent on land that it
				does not use, and the lease of its plant. So a large seller can sell below its real cost.
			</li>
			<li>
				<strong>Energy standby.</strong> An idle plant keeps inputs only for its recent sales. When energy runs short,
				every user loses the same share. So one shock to the main energy seller also cuts water and food.
			</li>
			<li>
				<strong>The City COOP's upkeep.</strong> Its price floor leaves out its upkeep. In the main run on seed
				{SAME_SHOCK.collapse.seed}, its treasury ran dry in year {SAME_SHOCK.collapse.year}, and water stopped for about
				a year: {fmt(SAME_SHOCK.collapse.short)} person-days were short.
			</li>
			<li>
				<strong>Founders' technology.</strong> A founder copies the technology of a random seller, even one whose plant
				needs far more land than its rival's.
			</li>
			<li>
				<strong>Start-ups.</strong> A new COOP pays ground rent before it builds its plant, and it may never build it.
			</li>
			<li>
				<strong>Year 1.</strong> On {SN.year1} of the {SEEDS.n} seeds, people went short in the first weeks of year 1,
				after the founding.
			</li>
		</ul>
		<p>
			<strong>Proposition 3 is not yet robust.</strong> It failed in the main run, and it depends on the seed
			(Sections 11.2.5 and 11.2.6). In the test city, part 3 held on {noneOr(TEST_CITY.headline.p3 + TEST_CITY.more.p3)}
			of its {TEST_CITY.seeds.length + TEST_CITY.more.seeds.length} seeds (Section 11.3.3). One seed can make a rule look
			sound, and the next seed can break it, so two rules must be compared on the same shocks. <em>Test:</em> many
			seeds, the same shocks for each pair of rules, and the grid of Section 11.3.3.
		</p>
		<h3 id="roadmap">12.6 A roadmap in three steps</h3>
		<ol>
			<li>
				<strong>The world model.</strong> Play every example of this paper as a seeded scenario, with ({EQ.melt}), many COOPs
				and their pools. Check Proposition 3 for every person, on every day, on many seeds.
			</li>
			<li><strong>Human intents.</strong> Let people make the two daily choices of Section 7 and leave the rest to their Aven. Then humans and AI agents share one economy.</li>
			<li><strong>The first real village.</strong> One village with its energy and food COOPs and the Tribe COOP of each settlement, which run on the rules that survived the test city.</li>
		</ol>
		<p>
			Before we build the city, the test city must also answer the questions that this paper cannot answer yet.
		</p>
	</section>

	<section id="synthesis">
		<h2><span>13</span>From capitalism to Abundism</h2>
		<p>
			We started with two questions: who gets what is made, and who decides what is made next. Capitalism answered both
			with wages and ownership, and automation begins to remove that answer. theOS answers them differently: everyone
			gets an equal, daily share of direction and of ownership. That share can only build things. What it builds belongs
			to those who hold its MIND, on land that the City COOP holds, in which every citizen has one equal share. Every
			sale pays those owners a share, so a COOP gains exactly when it is useful. All money melts like the world it
			measures, so nobody can keep wealth idle and out of reach. theOS aims for a city whose output has no limit but
			physics, above all net energy. The whole architecture fits in one line:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \left(\mathrm{HEARTS} + \mathrm{MINDS}\right) \cdot \mathrm{ACTION} \\ = \mathrm{ABUNDANCE} \end{gathered} \tag{${EQ.abundance}}`} />
		<p>
			<strong>HEARTS</strong> are human intent, issued equally to everyone, every day. <strong>MINDS</strong> are what
			that intent becomes: the shared intelligence of the COOPs, ownership and utility in one. <strong>ACTION</strong>
			is the conscious act that converts the one into the other. Neither intent without capacity nor capacity without
			intent builds anything. Only the product does, within the limits of one planet <Cite k="raworth" />.
		</p>
		<p>
			In capitalism, people sold their time so that they could survive. In Abundism, no human labour is paid.
			Survival rests on a person's own half of the HEARTS they invest, the work proposals their Aven delivers, and Law 5 dividends (Section 4). In the simulation, basics got cheaper as
			productivity rose. Whether rivals keep them cheap when a leader prices for profit is still open (Section 12.2).
		</p>
		<p>
			Proposition 3 says what this gives: no one starves, no one has to work to survive, and the living standard of
			every tenth of the people rises. In the main run of our simulation, all three parts failed. The first week was
			short. {cap(inYears(shortYears))}, after a capacity shock, basics ran short, for owner-only people too. The
			poorest tenth consumed less {fellAt}. Dividends alone missed often in the first {PROOF.strict.lastShortYear}
			years, and again from year {PROOF.strict.lateMiss.from}. On {SEEDS.n} seeds, the main run passed all three checks
			on {SN.pass}. The lasting return on holdings stayed above the melt on {SEEDS.n - SN.below} of them, so
			Proposition 2 set no bound on inequality. Only a lower Law 5 share changed that, and Law 5 stays at
			{pc(DIVIDEND_SHARE)}. One seed is one random history, so we compare rules on the same shocks. On {SS.n} seeds,
			the pool rule of this paper gave fewer shortages than the old one. We propose a fix for each failure, and the
			test city must show that each one works. Human action becomes steering: deciding,
			every day and together, what the city builds next. maiaCITY will prove it first in a game, then in the real
			city.
		</p>
	</section>

	<p class="partline" id="appendices">Appendices</p>

	<section id="assumptions">
		<h2><span>A</span>Assumptions</h2>
		<p>
			The results of this paper rest on these model assumptions. Each one has an id, the section that uses it, and a
			status: whether it holds in the main run, is only assumed, is broken by the results, or was tested in the test
			city. The conditions of Proposition 3 are C1 to C5 of Section 10.3, and the list cites them.
		</p>
		<h3>The world</h3>
		<ul class="assume">
			<li id="a1"><strong>A1 A closed city.</strong> The models leave out euros, imports, exports and taxes (Section 8.3). <span class="status">Status: —</span></li>
			<li id="a2"><strong>A2 A constant population,</strong> except where Section 5.2 adds growth. Equation ({EQ.money}) holds only then. <span class="status">Status: —</span></li>
			<li id="a3"><strong>A3 Enough output and net energy</strong> = C1 (Section 10.3). <span class="status">Status: —</span></li>
			<li id="a4"><strong>A4 Productivity growth.</strong> Each COOP's productivity rises about {pc(SIM.prodGrowth)} a year on average, unevenly. This is assumed. It stands in for growth that surplus energy pays for (Sections 8.4 and 11.2.1). <span class="status">Status: —</span></li>
			<li id="a5"><strong>A5 Land in the City COOP.</strong> All land belongs to the City COOP and is only leased (Section 8.2). <span class="status">Status: —</span></li>
		</ul>
		<h3>People and Avens</h3>
		<ul class="assume">
			<li id="a6"><strong>A6 One human, one stream.</strong> Identity works, and nobody directs the HEARTS of fake people (Section 12.1). <span class="status">Status: —</span></li>
			<li id="a7"><strong>A7 Prompt investment.</strong> Avens invest HEARTS as they arrive, so few HEARTS sit unused (Section 7). <span class="status">Status: —</span></li>
			<li id="a8"><strong>A8 Where Avens invest.</strong> In the simulation, each Aven puts {pc(AVEN_RULE.share)} of its person's HEARTS into the {AVEN_RULE.top} MINDs with the highest price and dividend yield, and the rest by its person's own values (Section 11.2.1). <span class="status">Status: —</span></li>
			<li id="a9"><strong>A9 Faithful Avens.</strong> Each Aven serves only its human, follows its human's choices and makes no costly mistakes (Section 7). <span class="status">Status: —</span></li>
			<li id="a10"><strong>A10 No paid human labour.</strong> Every human has one Aven, and the Avens propose and deliver all work with the COOPs' machines. Avens differ in what they deliver (Section 4). <span class="status">Status: —</span></li>
			<li id="a11"><strong>A11 Avens deliver what COOPs ask,</strong> at a fixed rate for each work proposal (Section 12.2). <span class="status">Status: —</span></li>
			<li id="a12"><strong>A12 Spending.</strong> People spend a share <Tex tex={String.raw`\theta = ${tn(SIM.spendRate, 1)}`} /> of what they hold a year, basics first (Section 11.2.2). <span class="status">Status: —</span></li>
			<li id="a13"><strong>A13 Spread ownership</strong> = C4 (Section 10.3). <span class="status">Status: —</span></li>
			<li id="a14"><strong>A14 Wants that keep growing</strong> = C5 (Section 10.3). <span class="status">Status: —</span></li>
		</ul>
		<h3>COOPs and markets</h3>
		<ul class="assume">
			<li id="a15"><strong>A15 Treasuries pay out</strong> under the payout rule of Section 4. <span class="status">Status: —</span></li>
			<li id="a16"><strong>A16 Every COOP accepts HEARTS from anyone</strong> (Section 11.2.5). <span class="status">Status: —</span></li>
			<li id="a17"><strong>A17 Rivals and free prices</strong> = C2 (Section 10.3). Each COOP's own price rule moves its price up and down by equal steps, every day, and nothing caps a price (Section 9.1). <span class="status">Status: —</span></li>
			<li id="a18"><strong>A18 Honest prices.</strong> Time-averaged pool prices reflect the use that each MIND buys (Section 6.3). <span class="status">Status: —</span></li>
			<li id="a19"><strong>A19 Connected baskets.</strong> Every MIND in a basket can reach every other MIND through the pools (Section 6). <span class="status">Status: —</span></li>
			<li id="a20"><strong>A20 No redemptions.</strong> The City COOP redeems no LP tokens (Section 6). The simulation runs this way. <span class="status">Status: —</span></li>
			<li id="a21"><strong>A21 Random returns.</strong> In Proposition 2, holdings are valued in HEARTS, and their returns move as a random walk (Section 9.2). <span class="status">Status: —</span></li>
			<li id="a22"><strong>A22 Failed plants:</strong> the idle-plant rule of Section 9.1, with a threshold of {pc(SIM.reletUse)}. <span class="status">Status: —</span></li>
		</ul>
		<h3>The simulation's settings</h3>
		<ul class="assume">
			<li id="a23"><strong>A23 The bootstrap</strong> = C3 (Section 12.4). Proposition 3 is claimed from the end of the founding, once every person holds MIND. The simulation does not test the bootstrap yet. <span class="status">Status: —</span></li>
			<li id="a24"><strong>A24 The main run.</strong> {SIM.people} people over {SIM.years} years on one seed, with the settings of Section 11.2.1; founders act when a margin over full cost stays above {pc(SIM.foundingMargin)} for {SIM.foundingDays} days (Section 9.1). It pays Law 5 to people and other COOPs' treasuries; the pools' share is being added. <span class="status">Status: —</span></li>
		</ul>
	</section>

	<section id="notation">
		<h2><span>B</span>Notation</h2>
		<p>
			A few letters mean different things in different sections, as in the sources that the paper follows. Table {TAB.notation}
			lists each symbol and where it is used.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.notation}.</strong> The symbols of the paper.</caption>
				<thead>
					<tr><th>Symbol</th><th>Meaning</th><th>Section</th></tr>
				</thead>
				<tbody>
					<tr><td><Tex tex="M, V, P, Q" /></td><td>Fisher's money, velocity, prices and goods</td><td>2</td></tr>
					<tr><td><Tex tex="r" /></td><td>The melt rate, {fmt(RATE, 2)} a year. In Section 1 only: Piketty's return on capital</td><td>1, 5</td></tr>
					<tr><td><Tex tex="g" /></td><td>Piketty's growth of the whole economy</td><td>1</td></tr>
					<tr><td><Tex tex={String.raw`B,\ \Delta t`} /></td><td>Any balance of HEARTS or of one MIND, and the years since its last update</td><td>5.1</td></tr>
					<tr><td><Tex tex="u" /></td><td>HEARTS issued per person a year, {fmt(u)}</td><td>5.2</td></tr>
					<tr><td><Tex tex="N" /></td><td>The number of people</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`m,\ m^{*}`} /></td><td>The average count of HEARTS and MINDs per person, and its steady state</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`a_i,\ W_i^{*}`} /></td><td>What a person adds to a holding each year, net of what they spend, and the level that the holding tends to, <Tex tex={String.raw`a_i/r`} /></td><td>5.2, 9.2</td></tr>
					<tr><td><Tex tex={String.raw`\omega`} /></td><td>The ownership that a person's investing creates for them a year, <Tex tex="u/2" />: {fmt(INVESTOR_SHARE, 1)} MIND for each HEART</td><td>5.2, 9.2, 10.2</td></tr>
					<tr><td><Tex tex={String.raw`\nu`} /></td><td>The yearly growth rate of the population</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`c,\ e_v`} /></td><td>Laborde's universal-dividend rate, and the life span that it derives from</td><td>5.3</td></tr>
					<tr><td><Tex tex={String.raw`b,\ b_i`} /></td><td>A member's balance relative to the average</td><td>5.3</td></tr>
					<tr><td><Tex tex={String.raw`n,\ w_i`} /></td><td>The number of MINDs in a basket, {POOL.min} to {POOL.max}, and each one's weight, <Tex tex="1/n" /></td><td>6</td></tr>
					<tr><td><Tex tex={String.raw`x_i,\ K,\ p_{ij}`} /></td><td>A pool's reserve of MIND <Tex tex="i" />, the pool's invariant, and the price of MIND <Tex tex="j" /> in MIND <Tex tex="i" /></td><td>6.1</td></tr>
					<tr><td><Tex tex={String.raw`\varphi`} /></td><td>The trading fee, {pct(POOL.fee * 100, 1)}</td><td>6.1</td></tr>
					<tr><td><Tex tex="V" /></td><td>A pool's value. In Section 2 only: Fisher's velocity</td><td>2, 6</td></tr>
					<tr><td><Tex tex={String.raw`\sigma,\ \Sigma,\ \rho,\ \ell`} /></td><td>Volatility, covariance and correlation of prices, and the yearly loss-versus-rebalancing</td><td>6.2</td></tr>
					<tr><td><Tex tex={String.raw`s_i,\ f_i,\ \bar f,\ \kappa`} /></td><td>A COOP's share of its sector's investment, its utility per HEART, the average utility, and the speed of selection</td><td>9</td></tr>
					<tr><td><Tex tex={String.raw`W_i,\ W^{*},\ \bar W_0`} /></td><td>A person's MIND holding, the resting level when everyone keeps <Tex tex={String.raw`\omega`} />, and the mean holding at the start</td><td>9.2, 10.2</td></tr>
					<tr><td><Tex tex={String.raw`\mu`} /></td><td>The lasting return on a holding: dividend yield plus any lasting price rise</td><td>5.4</td></tr>
					<tr><td><Tex tex={String.raw`t_{1/2}`} /></td><td>The half-life of an idle balance, <Tex tex={String.raw`\ln 2/r`} />, and of a holding that earns <Tex tex={String.raw`\mu`} />, <Tex tex={String.raw`\ln 2/(r - \mu)`} /></td><td>5.1, 5.4</td></tr>
					<tr><td><Tex tex={String.raw`\sigma_W,\ dZ,\ \alpha`} /></td><td>The spread of returns between people, random noise, and the shape of the resting spread</td><td>9.2</td></tr>
					<tr><td><Tex tex={String.raw`G,\ G_0,\ G_{\infty}`} /></td><td>The Gini index of ownership: over time, at the start, and at rest</td><td>9.2</td></tr>
					<tr><td><Tex tex={String.raw`s_k,\ p_k,\ \bar p,\ v_k`} /></td><td>The supply of MIND <Tex tex="k" />, its pool price against one MIND, the supply-weighted average price, and its value in HEARTS, the unit of account ({EQ.unit})</td><td>6.3</td></tr>
					<tr><td><Tex tex={String.raw`\lambda`} /></td><td>Law 5's share of every sale, {pc(DIVIDEND_SHARE)}</td><td>5.4, 10.2</td></tr>
					<tr><td><Tex tex="T_i" /></td><td>The years a holding would pay the basic bundle with nothing flowing in</td><td>10.2</td></tr>
					<tr><td><Tex tex="p_b" /></td><td>The cost of a day's basic bundle</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`D_i,\ X_i`} /></td><td>A person's dividends, and what they spend</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`\bar W,\ Y`} /></td><td>The mean holding, and what people buy from COOPs, HEARTS a person a day</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`\bar\eta`} /></td><td>The city's dividend yield, <Tex tex={String.raw`\lambda Y / \bar W`} /></td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`\theta`} /></td><td>The share of what they hold that people spend a year</td><td>10.4</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="glossary">
		<h2><span>C</span>Glossary</h2>
		<dl class="glossary">
			<dt>HEARTS</dt>
			<dd>A person's own currency of intent, {UIA_DAY} a day. HEARTS buy nothing and pay for nothing, not even food. They earn nothing and can only be invested into COOPs. The HEART is also the unit of account (Section 6.3): every value is shown in HEARTS, and the average MIND is worth 1 HEART.</dd>
			<dt>MIND</dt>
			<dd>A COOP's own currency of ownership and utility. To hold it is to own part of the COOP; to spend it is to use what the COOP makes.</dd>
			<dt>COOP</dt>
			<dd>A cooperative enterprise that makes something a city needs, such as energy, food or housing. It has its own MIND and treasury.</dd>
			<dt>Treasury</dt>
			<dd>A COOP's working capital: its own MIND and the MINDs of other COOPs that it buys for its own needs. It gets {fmt(TREASURY_SHARE, 1)} of each new MIND of its COOP. It keeps the reserve of the payout rule and never holds HEARTS.</dd>
			<dt>Conversion</dt>
			<dd>The moment an invested HEART converts into one MIND of its COOP: {RULE}. This is Law 4.</dd>
			<dt>Dividend</dt>
			<dd>Law 5: {pc(DIVIDEND_SHARE)} of every sale, the same for every COOP. It goes at once to everyone who holds the seller's MIND except its own treasury, in proportion to their holding: people, other COOPs and the city's pools. It is not Laborde's universal dividend of Section 3, which is new money.</dd>
			<dt>Work proposal</dt>
			<dd>All paid work in the city, as in a DAO: a person's Aven proposes a piece of work and its price in the COOP's own MIND, the COOP accepts it, the Aven delivers it with the COOP's machines, and the treasury pays the Aven's human on delivery. There are no jobs and no wages. Some work proposals keep a COOP running, such as a daily check, and the COOP pays them from its running costs. Others are new work, such as a repair plan: if the members accept it, the treasury pays it from what it holds above its reserve. Outside the city, anyone may still take a job for euros.</dd>
			<dt>Payout rule</dt>
			<dd>A treasury keeps a reserve of {SIM.reserveMonths} months of running costs, plus what it plans to build, and pays out the rest for work proposals (Section 4).</dd>
			<dt>Turnover</dt>
			<dd>The total of a COOP's sales over a time. Only real deliveries count.</dd>
			<dt>Unit of account</dt>
			<dd>The unit in which all values are shown and compared: the HEART. The pools set only how MINDs stand against each other; the supply-weighted average MIND is worth 1 HEART, and a MIND that the pools cannot price yet counts at 1 HEART (Section 6.3). It is for display only: it never changes a trade, a price or a payment, and it is not a peg.</dd>
			<dt>Melt, demurrage</dt>
			<dd>To melt is to shrink continuously, at a rate of {pc(RATE)} a year. Demurrage is the name of that holding cost.</dd>
			<dt>UIA</dt>
			<dd>Universal Intent Allocation, Law 1: the right of every human to invest {UIA_DAY} HEARTS a day.</dd>
			<dt>Pool, basket, LP token</dt>
			<dd>A pool is a basket of {POOL.min} to {POOL.max} MINDs in equal value shares, which anyone can trade against. Together the city's pools are the city's liquidity pool. A pool issues an LP token (liquidity-provider token), a share of the pool, for each deposit, and the City COOP holds them all (Section 6).</dd>
			<dt>G3M</dt>
			<dd>Geometric mean market maker: the pool formula ({EQ.pool}), which keeps the geometric mean of the reserves constant in every trade.</dd>
			<dt>LVR</dt>
			<dd>Loss-versus-rebalancing: what a pool loses to arbitrageurs when prices move, against a perfect rebalancer.</dd>
			<dt>Aven</dt>
			<dd>A personal AI agent that works only for its human: it invests, trades, pays, proposes and delivers work proposals, and collects dividends.</dd>
			<dt>City COOP</dt>
			<dd>The city's own COOP (Section 4). It holds all land and everything that all citizens share, including the LP tokens of the city's pools, and it is the city's euro bank (Sections 8.2 and 8.3). Every citizen holds one equal share, as a membership. In maiaCITY it is the MaiaCity COOP.</dd>
			<dt>Settlement, village, Tribe COOP</dt>
			<dd>A settlement is one hex of the city's map, and a village is a group of settlements. Each settlement has a Tribe COOP, whose MIND is tribeMIND. It owns the domes and beds there and rents them to residents.</dd>
			<dt>MIP</dt>
			<!-- for Samuel to confirm: the expansion of MIP -->
			<dd>A MaiaCity improvement proposal: a vote of the City COOP's members, one vote per citizen share (Section 8.2). Only a passed MIP can redeem LP tokens.</dd>
			<dt>Ground rent, Erbbaurecht</dt>
			<dd>The yearly fee for a leased plot, paid in any MIND and received as cityMIND. The lease works like a German heritable building right.</dd>
			<dt>Protocol</dt>
			<dd>The shared software at the base of theOS that runs the laws. No person or COOP owns it.</dd>
			<dt>Steady state</dt>
			<dd>The level at which a balance's yearly inflow equals what melts from it in a year.</dd>
			<dt>Gini index</dt>
			<dd>A measure of inequality from 0 to 1: 0 means that everyone has the same, 1 means that one person has everything. It is the average gap between two people chosen at random, divided by twice the mean.</dd>
			<dt>Sybil attack</dt>
			<dd>One person posing as many people, to collect many streams of HEARTS.</dd>
			<dt>Day of living</dt>
			<dd>What an average person consumes in a day, priced in HEARTS that year (Section 6.3).</dd>
			<dt>Basic bundle</dt>
			<dd>One day of basics for one person: {fmt(BASIC_BUNDLE.kcal)} kcal of food, {BASIC_BUNDLE.L} L of water, {BASIC_BUNDLE.kWh} kWh of energy and {BASIC_BUNDLE.m2} m² of home.</dd>
			<dt>Owner-only person</dt>
			<dd>A person whose Aven delivers nothing and who starts with nothing. Every tenth person in the simulation is one.</dd>
			<dt>Real consumption</dt>
			<dd>Every unit that a person consumes, valued at the prices of day 1, so that it counts amounts, not price changes. It is not comparable with a day of living.</dd>
			<dt>Decile, tenth</dt>
			<dd>One of ten equal groups of people, sorted by real consumption each year.</dd>
			<dt>Proposition 3</dt>
			<dd>The central claim of Section 10.3: from the end of the founding, no one starves, no one has to work to survive, and the living standard of every tenth rises. The founding, a city's first days until every person holds MIND, is reported on its own. Part 2 claims the normal test, which lets an owner-only person spend some of what they hold. The strict test, dividends alone, is a stronger target. The main run met neither test.</dd>
			<dt>Rival COOP</dt>
			<dd>A COOP that makes the same good as another and competes for the same buyers (Section 9.1).</dd>
			<dt>Founding, exit, failure</dt>
			<dd>A founding starts a COOP. An exit closes a small COOP that lost its market. A failure ends a COOP whose treasury stays dry while it keeps losing; the City COOP leases its plant to a successor while people still use it, and scraps it otherwise.</dd>
			<dt>Reserve</dt>
			<dd>What a treasury keeps under the payout rule before it pays out (Section 4).</dd>
			<dt>Net energy</dt>
			<dd>The energy that a source delivers, less the energy that it takes to build and run it.</dd>
			<dt>EROI</dt>
			<dd>Energy return on investment: the energy that a source delivers over its life, divided by the energy that it takes to build and run it.</dd>
			<dt>Wright's law</dt>
			<dd>The cost of a product falls by a fixed share each time the total ever made doubles.</dd>
			<dt>Recipe</dt>
			<dd>The inputs and the energy that make one unit of a good (Section 8.4).</dd>
			<dt>Plant</dt>
			<dd>The machines and buildings with which a COOP makes its goods.</dd>
			<dt>Last ten years</dt>
			<dd>Years {SIM.restFrom} to {SIM.years} of a simulation run, which its steady-state numbers average (Section 11.2.1).</dd>
			<dt>Main run</dt>
			<dd>The run of the simulation with the settings of Section 11.2.1: Law 5 at {pc(DIVIDEND_SHARE)}, reserves of {SIM.reserveMonths} months, Law 4 and the idle-plant rule.</dd>
			<dt>Idle-plant rule</dt>
			<dd>When a COOP fails, the City COOP leases its plant to a successor only while demand is at least {pc(SIM.reletUse)} of the plant's capacity. Otherwise it scraps the plant and takes the land back (Section 9.1).</dd>
			<dt>Seed, common random numbers</dt>
			<dd>A seed fixes all the random events of a simulation run. With common random numbers, two runs of one seed share the random stream for shocks and tastes, so two rules meet the same shocks (Section 11.2.6).</dd>
			<dt>Sign test</dt>
			<dd>A test for two rules run on the same seeds: it counts the seeds on which each rule did better and asks how likely so uneven a count is by chance alone.</dd>
			<dt>Binding limit</dt>
			<dd>The input that runs out first and so sets how much of a good the city can make that day.</dd>
			<dt>Agent-based model</dt>
			<dd>A simulation in which every person and every COOP acts by its own rules, and the result is what all of them do together.</dd>
			<dt>Stock-flow consistent</dt>
			<dd>A way to keep the books of a model: every flow leaves one place and arrives in another, so every stock adds up.</dd>
			<dt>Dynamic and static world</dt>
			<dd>The two simulations of Section 11.2.1. The dynamic world has rivals, free prices, growth and shocks, and this paper uses it. The earlier static world had fixed tastes, no growth and capped prices; "static" marks its numbers.</dd>
			<dt>Test city</dt>
			<dd>The first step of Section 11.3.1, where simulated residents live, trade and invest under the rules of this paper before the real city.</dd>
		</dl>
	</section>

	<section id="related">
		<h2><span>D</span>Related work</h2>
		<p>
			<strong>WIR and Sardex.</strong> WIR has given Swiss firms credit in its own currency since 1934
			<Cite k="stodder" />, and Sardex gives interest-free credit to firms in Sardinia <Cite k="sardex" />. theOS makes
			no MIND from euros and charges no interest; the City COOP gives euro loans, repaid in the COOP's own MIND (Section
			8.3).
		</p>
		<p>
			<strong>Balancer and owned liquidity.</strong> Balancer's weighted pools use the formula of theOS's baskets, but
			outside investors supply the reserves, hold pool tokens and can withdraw <Cite k="balancer evans" />. theOS pools
			take one-sided inflows from every COOP and hold currencies that melt. The closest model is the owned liquidity
			that Olympus made known: a treasury buys the LP tokens of its own pools and keeps them, so it does not have to pay
			outside investors to supply liquidity <Cite k="olympus" />. theOS keeps that idea: owned liquidity, not rented
			liquidity, but the owner is the City COOP, not the protocol. So every citizen owns an equal part of it, and the
			inflow comes from the COOPs' own MIND, not from a sale of new tokens (Section 6).
		</p>
		<p>
			<strong>Agent-based and stock-flow consistent models.</strong> Mark-0 <Cite k="gualdi" /> and the model of Dosi
			and others <Cite k="dosi" /> let many firms and households act by simple rules. Godley and Lavoie
			<Cite k="godley" />, and Caiani and others <Cite k="caiani" />, keep the books so that every flow lands somewhere.
			The simulation of Section 11.2.1 keeps stock-flow consistent books, and Section 11.3.1 says what the test city borrows
			from these models and where theOS differs.
		</p>
		<p>
			<strong>Sources that the body discusses.</strong> Circles: Section 3. Gesell, Wörgl and the Chiemgauer: Section
			2. The Relative Theory of Money and Ğ1: Sections 3 and 5.3. Property-owning democracy, after Rawls, Meade and
			Roemer: Section 1. Georgism: Section 8.2. Energy and growth: Section 8.4.
		</p>
	</section>

	<section id="threats">
		<h2><span>E</span>Threat model</h2>
		<p>
			theOS creates prizes that attackers will want. Table {TAB.threats} lists the main attacks, what they gain, the
			defences that Sections 12.1 to 12.5 propose, and how the test city tests them.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.threats}.</strong> Attacks on theOS, and the proposed defences.</caption>
				<thead>
					<tr><th>Attack</th><th>What it gains</th><th>Proposed defence</th><th>Test in the test city</th></tr>
				</thead>
				<tbody>
					<tr><td>Fake identities (Sybil)</td><td>{fmt(u)} HEARTS a year to direct for each fake person</td><td>A staged identity system, caps on new identities, regular liveness checks</td><td>Farms of fake agents</td></tr>
					<tr><td>Self-dealing and rings</td><td>A founder controls {fmt(selfDealDay(), 1)} MIND a day instead of {fmt(honestDay())}; friends trade empty MINDs for real ones</td><td>Escrow for related parties, no payouts to recent investors, public treasuries, only real deliveries count as sales, basket admission</td><td>Kickback COOPs, investment rings and circular sales</td></tr>
					<tr><td>Empty work proposals</td><td>Treasury MIND for work that an Aven never delivered, or for a friend's Aven</td><td>Public work proposals with a proof of delivery, members' acceptance, work proposals open to every Aven, audits of the largest earners</td><td>Avens that bill empty work, COOPs that favour related Avens</td></tr>
					<tr><td>Pool attacks and front-running</td><td>A pushed price draws HEARTS from Avens; bots trade around payments and inflows</td><td>Time-averaged prices, one batch at one price per block, sealed orders, an event breaker</td><td>Price pumps, junk dumping, sandwich bots</td></tr>
					<tr><td>Capture</td><td>Control of a COOP's treasury, of the Avens' defaults, or of the protocol's code</td><td>The holder rule, a default COOP constitution, several Aven providers, the process of Appendix F</td><td>Vote buying, a captured Aven provider, injected instructions</td></tr>
					<tr><td>Bugs</td><td>Value drained from pools that only a vote of the City COOP's members can withdraw from</td><td>Verified maths, one global melt index, independent code, a pause that cannot move funds, a bug bounty</td><td>A red team before real value flows</td></tr>
					<tr><td>Market power over a basic</td><td>A leading COOP raises prices or keeps rivals out</td><td>A founding signal when need goes unmet or a rival's cost is far below the price (Law 3 entry is always open); open improvements after a delay; Avens' exit; Law 5 to all holders; the City COOP leases failed plants that people still use</td><td>One, two and four sellers of each good</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="protocol">
		<h2><span>F</span>Who can change the rules</h2>
		<p>
			theOS has three layers of rules, and each one changes in a different way. This appendix proposes how.
		</p>
		<p>
			<strong>The laws.</strong> The five laws, the melt rate and Law 5's share of {pc(DIVIDEND_SHARE)} are fixed. Nobody holds a key that changes them. A change to
			a law would be a new protocol, and each person would choose whether to move to it. In the test city it is different:
			every rule is a parameter, anyone can propose a change, and the change runs in a new world.
		</p>
		<p>
			<strong>The code.</strong> The software that runs the laws must be fixable, because it will have bugs. We propose
			that every change goes through a public proposal, an independent audit and a waiting time of at least
			{GOVERNANCE.waitDays} days. Then the citizens decide in the City COOP, one vote per citizen share (a MIP, Section
			8.2). No change may break a law.
		</p>
		<p>
			<strong>The pause.</strong> One narrow pause can stop trading in a pool, but it can never move funds. Each pause ends
			after {GOVERNANCE.pauseHours} hours unless a large majority renews it.
		</p>
		<p>
			<strong>Details inside the laws.</strong> Some rules work inside the laws. Among them are the reserve target of
			about {SIM.reserveMonths} months and the founding signal for rivals (Law 3 entry itself is always open). Basket
			admission, how the HEART index reads pool prices (Section 6.3) and the identity system are rules of this kind too. These
			rules change by the same process as the code, and the test city tests each change first.
		</p>
		<p>
			During the test city and the first pilot, the maiaCITY team writes and runs the code. That is a concentration of power.
			The city must hand it to the process above before real value flows.
		</p>
	</section>

	<section id="disclosure">
		<h2><span>G</span>Code, data and interests</h2>
		<p>
			Samuel Andert leads maiaCITY, which builds the test city and the real city, and so has an interest in the success
			of theOS. Claude, an AI model made by Anthropic, co-wrote the text and the code behind its numbers. It holds no
			stake in maiaCITY. The code behind every number and figure in this paper is open, in the
			maiaCITY repository at
			<a href="https://github.com/MyAvenCEO/maiacity" target="_blank" rel="noopener noreferrer">github.com/MyAvenCEO/maiacity</a>.
			The file <code>src/lib/theos/model.js</code> holds every number that the text prints. Each constant names the
			table of the simulation that it comes from. A function computes every ratio, so readers can check and rerun each
			one.
		</p>
		<p>
			The agent-based simulation that Sections 5 to 12 quote is the script <code>scripts/theos-e2e-sim.mjs</code> in the
			same repository. Its main scenario is the dynamic world, and the static world is the comparison. The script prints the
			per-person checks of Proposition 3 first. Then it prints the tables of the dynamic world, its variations and the
			static world. It is seeded with {SIM.seed}, so the same command, <code>node scripts/theos-e2e-sim.mjs</code>,
			gives the same results, in about {fmt(SIM.runSeconds / 60)} minutes. The flag <code>--quick</code> runs a short smoke test, and
			<code>--csv FILE</code> also writes a yearly series of every run. The test city's world model grew from this
			script (Section 11.3.1).
		</p>
		<p>
			The script's own tables still use R, the yardstick that we retired (below). The values in HEARTS come from
			the same seeded runs. The script's HEART report values every flow and every holding at the HEART index of its
			step, and it changes no move, price or trade. The script prints it as tables H1 to H8, and <code>model.js</code>
			names them. <code>--json FILE</code> writes the report's main numbers. <code>--seeds A-B</code> runs the main run
			on every seed from A to B and prints the seed check of Section 11.2.6. <code>--set key=value</code> changes one
			setting of the main run, for example <code>turnDiv</code> for Law 5's share, <code>capDays</code> for the
			reserves, <code>poolShare</code> for the pools' part or <code>reletUse</code> for the idle-plant rule, and
			<code>--melt R</code> sets the melt. With <code>--set reletUse=0</code>, the City COOP leases every failed plant,
			as in the last version of this paper. The melt tests of Section 11.2.5 use these flags, and with
			<code>--set poolShare={OLD_POOL_SHARE}</code> they run under the old pool rule. <code>--pair A-B --vs key=value</code>
			runs the same-shock comparison of Table {TAB.sameShock}. It runs the main run and the same run with one setting changed, on
			every seed from A to B, both with common random numbers (<code>crn=1</code>). It prints the paired results and a
			sign test.
		</p>
		<p>
			<strong>R, the retired yardstick.</strong> Earlier versions of this paper measured values in R, the geometric mean of a MIND's prices
			against three chosen MINDs: solarMIND, habitatMIND and cityMIND. We retired R for two reasons. It needed an anchor
			of three COOPs that could fail. And it drifted, because those three MINDs moved against the average MIND. One
			HEART was worth {fmt(OLD_R.y1, 2)} R in year 1, {fmt(OLD_R.y40, 2)} R in year 40 and {fmt(OLD_R.y60, 2)} R in year
			60. Every value in this paper is now in HEARTS, from the same simulation runs. A value in R and the same value in
			HEARTS differ because R drifted, not because the economy did. The largest gap is in the lasting return of
			Section 11.2.5: in the last ten years, it reads {pc(OLD_R.mainMu, 1)} in R and {pc(DYN.mu, 1)} in HEARTS.
		</p>
		<p>
			<strong>The old pool rule.</strong> An earlier version of this paper gave the pools {fmt(OLD_POOL_SHARE, 2)} of
			each HEART. We ran it against the rule of Law 4 on the same shocks, on {SS.n} seeds, {SS.from} to {SS.to}, both
			with the idle-plant rule (Table {TAB.sameShock}). Section 11.2.6 explains the method and the sign test.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.sameShock}.</strong> The pool rule of this paper ({fmt(POOL_SHARE, 1)} of each HEART to the pools) against the old one ({fmt(OLD_POOL_SHARE, 2)}), on the same shocks, on {SS.n} seeds. Both run with the idle-plant rule. Better means fewer person-days short, fewer failures, a lower μ, or all three checks passing where the other rule failed. p: the two-sided sign test.</caption>
				<thead>
					<tr><th>Measure</th><th class="num">New</th><th class="num">Old</th><th class="num">Seeds: new better · worse · same</th><th class="num">p</th></tr>
				</thead>
				<tbody>
					<tr><td>Person-days short from day {PROOF.fromDay}, all seeds</td><td class="num">{fmt(SS.new.short)}</td><td class="num">{fmt(SS.old.short)}</td><td class="num">{ST.short.better} · {ST.short.worse} · {ST.short.same}</td><td class="num">{pv(ST.short)}</td></tr>
					<tr><td>Food COOP failures, all seeds</td><td class="num">{SS.new.food}</td><td class="num">{SS.old.food}</td><td class="num">{ST.food.better} · {ST.food.worse} · {ST.food.same}</td><td class="num">{pv(ST.food)}</td></tr>
					<tr><td>All COOP failures, all seeds</td><td class="num">{SS.new.fails}</td><td class="num">{SS.old.fails}</td><td class="num">{ST.fails.better} · {ST.fails.worse} · {ST.fails.same}</td><td class="num">{pv(ST.fails)}</td></tr>
					<tr><td>μ in the last ten years, median seed</td><td class="num">{pc(SS.new.muMedian, 1)}</td><td class="num">{pc(SS.old.muMedian, 1)}</td><td class="num">{ST.mu.better} · {ST.mu.worse} · {ST.mu.same}</td><td class="num">{pv(ST.mu)}</td></tr>
					<tr><td>Seeds on which all three checks pass</td><td class="num">{SS.new.pass}</td><td class="num">{SS.old.pass}</td><td class="num">{ST.pass.better} · {ST.pass.worse} · {ST.pass.same}</td><td class="num">{pv(ST.pass)}</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			On the same shocks, the new pool rule did better. It left fewer person-days short on {ST.short.better} seeds and
			more on {ST.short.worse} (<em>p</em> = {pv(ST.short)}). It had fewer food COOP failures on {ST.food.better} seeds
			and more on {ST.food.worse} (<em>p</em> = {pv(ST.food)}). The other differences could be luck, with
			<em>p</em> above {fmt(SS.alpha, 2)}. All three checks passed on {SS.new.pass} seeds under the new rule and on
			{SS.old.pass} under the old (<em>p</em> = {pv(ST.pass)}). All COOP failures fell on {ST.fails.better} seeds and
			rose on {ST.fails.worse} (<em>p</em> = {pv(ST.fails)}). And <Tex tex={String.raw`\mu`} /> was lower on
			{ST.mu.better} seeds and higher on {ST.mu.worse} (<em>p</em> = {pv(ST.mu)}). It stayed below the melt on
			{SS.new.below} seeds under the new rule, and on {SS.old.below} under the old. So the larger pools' part did not
			cause the food failures of the main seed. On the same shocks, it made shortages and food failures rarer.
			Without the idle-plant rule, the new pool rule also left fewer person-days short than the old
			one: on {SS.noFix.tests.short.better} seeds, against {SS.noFix.tests.short.worse} (<em>p</em> =
			{pv(SS.noFix.tests.short)}).
		</p>
		<p>
			Under the old pool rule, the melt tests of Section 11.2.5 came to the same answer. A higher melt still left
			<Tex tex={String.raw`\mu`} /> above it on {seeds(SEEDS.n - MT.melt9.old.below)} at {pc(MT.melt9.melt)}, and on
			{seeds(SEEDS.n - MT.melt8.old.below)} at {pc(MT.melt8.melt)}. Reserves of {MT.res12.months} months left it above
			the melt on {seeds(SEEDS.n - MT.res12.old.below)}. Only Law 5 at {pc(MT.law10.share)} kept it at least
			{fmt(MT.law10.old.marginMin * 100, 1)} points below on {ofSeeds(MT.law10.old.below)}.
		</p>
	</section>

	<section id="physics">
		<h2><span>H</span>The physical world: primitives and limits</h2>
		<p>
			Money counts what the city makes, and physics sets what it can make (Section 8.4). Table {TAB.physics} lists the
			<em>primitives</em> of the test city: the basic resources that every recipe draws on. It gives what each one gives
			and costs in energy, and the limit that no recipe can pass. These are
			design numbers, and "estimate" marks the ones that nobody has checked yet.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.physics}.</strong> The physical primitives of the test city, and their limits.</caption>
				<thead>
					<tr><th>Resource</th><th>Rate and energy cost</th><th>Hard limit</th></tr>
				</thead>
				<tbody>
					<tr><td>Sunlight</td><td>About {ENERGY.pvMunich} MWh a year for each kWp of solar panels in Munich</td><td>About {pc(ENERGY.floors.sq)} of sunlight for one single-junction solar cell <Cite k="shockley" /></td></tr>
					<tr><td>Land</td><td>Fixed, and all of it the City COOP's</td><td>Only how hard it is used can change</td></tr>
					<tr><td>Rain and water</td><td>About {ENERGY.water.supply} L of rain a bed a day, against a need of {ENERGY.water.need} L of fresh water</td><td>A year {pc(ENERGY.water.dry)} drier gives {pc(ENERGY.water.dryYear)} of the need</td></tr>
					<tr><td>Soil and food</td><td>A food forest gives {pc(ENERGY.forest.y1)} of the food in year 1 and all of it in year {ENERGY.forest.fullYear}; then {fmt(ENERGY.forest.kgM2, 2)} kg/m² a year, the riskiest number (estimate) <Cite k="peters" /></td><td>At most {pc(ENERGY.floors.photosynthesis, 1)} (C3 plants) to {pc(ENERGY.floors.photosynthesisC4)} (C4 plants) of sunlight into food <Cite k="zhu" /></td></tr>
					<tr><td>Geothermal heat</td><td>{fmt(ENERGY.geo.el, 1)} MW of electricity and {fmt(ENERGY.geo.heat, 1)} MW of heat a plant; EROI {ENERGY.geo.eroiHeat[0]} to {ENERGY.geo.eroiHeat[1]} with the heat used (estimate) <Cite k="atlason" /></td><td>The Carnot limit: at most {pc(ENERGY.geo.carnot)} of the heat into electricity</td></tr>
					<tr><td>Timber</td><td>{ENERGY.wood.t} t a year from {ENERGY.wood.ha} ha (estimate); glued timber about {fmt(ENERGY.recipes.glulam, 1)} MWh a tonne</td><td>Land times growth</td></tr>
					<tr><td>Steel</td><td>About {fmt(ENERGY.recipes.steel, 1)} MWh a tonne</td><td>About {fmt(ENERGY.floors.steelMin, 1)} MWh a tonne from ore, the practical minimum; steel from scrap needs far less</td></tr>
					<tr><td>Glass</td><td>About {fmt(ENERGY.recipes.glass, 1)} MWh a tonne</td><td>At least {fmt(ENERGY.floors.glassMin, 2)} MWh a tonne</td></tr>
					<tr><td>Fired clay</td><td>About {fmt(ENERGY.recipes.clay, 1)} MWh a tonne</td><td>Clay is plentiful; energy binds</td></tr>
					<tr><td>Solar panels</td><td>About {fmt(ENERGY.recipes.panels, 1)} MWh a tonne; they pay back their energy in about {fmt(ENERGY.pvPayback, 1)} years <Cite k="fraunhofer" /></td><td>The limit of one solar cell, above</td></tr>
					<tr><td>Compute</td><td>{ENERGY.compute[0]} to {ENERGY.compute[1]} kWh a person a year for an Aven (estimate)</td><td>Chips and energy</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Recipes get better in two ways (Section 8.4). They improve by making more, as Wright's law says, and by searching, through
			research that Avens propose and COOPs fund. Klaassen and others measured both effects for wind power
			<Cite k="klaassen" />. In the test city, research is paid only from surplus energy: basics, running costs and
			building come first. Both kinds of learning stop at the physical floor of each recipe. The simulation of Section
			10 counts energy in every recipe, but it does not use these limits yet.
		</p>
	</section>

	<section id="references" class="refs">
		<h2>References</h2>
		<ol>
			{#each REFS as r, i (r.key)}
				<li id="ref-{i + 1}">
					{r.text}
					{#if r.url}<a href={r.url} target="_blank" rel="noopener noreferrer">{r.url.replace(/^https?:\/\//, '')}</a>{/if}
				</li>
			{/each}
		</ol>
		<p class="cite-as">
			<strong>Cite as:</strong> Andert, S., &amp; Claude (2026). theOS: The civilization scale operating system of Abundism. A macroeconomic and
			system-engineering framework for a post-labour economy, v6. maiaCITY working paper.
		</p>
	</section>
</main>

<style>
	.paper {
		--measure: 42rem;
		max-width: var(--measure);
		margin: 0 auto;
		padding: 3rem 1.25rem 5rem;
		font-family: var(--font-display);
		font-size: 1.08rem;
		font-variation-settings: 'opsz' 14;
		line-height: 1.68;
		color: var(--ink);
	}

	.masthead {
		text-align: center;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--line);
	}

	.brand {
		margin: 0 0 0.9rem;
		font-family: var(--font-display);
		font-size: 1.5rem;
		font-weight: 500;
		letter-spacing: -0.01em;
		color: var(--terracotta);
	}

	.kind {
		margin: 0 0 1.4rem;
		font-family: var(--font-body);
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--muted);
	}

	h1 {
		margin: 0;
		font-size: clamp(2rem, 5.5vw, 3rem);
		font-weight: 500;
		line-height: 1.1;
		letter-spacing: -0.02em;
		font-variation-settings: 'opsz' 72;
	}

	.subtitle {
		margin: 0.8rem auto 0;
		max-width: 32rem;
		font-size: 1.15rem;
		font-style: italic;
		color: var(--ink-soft);
	}

	.author {
		margin: 1.6rem 0 0;
		font-family: var(--font-body);
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.affil {
		margin: 0.1rem 0 0;
		font-family: var(--font-body);
		font-size: 0.85rem;
		color: var(--muted);
	}

	.abstract {
		margin: 2rem 0 0;
		padding: 1.4rem 1.6rem;
		border-radius: var(--radius);
		background: var(--paper);
		font-size: 0.98rem;
	}

	.abstract h2,
	.toc h2 {
		margin: 0 0 0.5rem;
		font-family: var(--font-body);
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	.abstract p {
		margin: 0 0 0.8rem;
		text-align: justify;
		hyphens: auto;
	}

	.keywords {
		font-family: var(--font-body);
		font-size: 0.82rem;
		color: var(--ink-soft);
		text-align: left !important;
	}

	.keywords:last-child {
		margin-bottom: 0 !important;
	}

	.toc {
		margin: 2rem 0;
		font-family: var(--font-body);
		font-size: 0.9rem;
	}

	.toc .part {
		margin: 0.9rem 0 0.3rem;
		font-size: 0.74rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.toc ol {
		columns: 2 14rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.toc li {
		break-inside: avoid;
		padding: 0.15rem 0;
	}

	.toc a {
		color: var(--ink-soft);
		text-decoration: none;
	}

	.toc a:hover {
		color: var(--terracotta);
	}

	section {
		scroll-margin-top: 1.5rem;
	}

	section h2 {
		margin: 3.2rem 0 1rem;
		font-size: 1.6rem;
		font-weight: 500;
		line-height: 1.2;
		letter-spacing: -0.01em;
		font-variation-settings: 'opsz' 48;
	}

	section h2 span {
		display: inline-block;
		min-width: 2rem;
		color: var(--terracotta);
	}

	h3 {
		margin: 2rem 0 0.6rem;
		font-family: var(--font-body);
		font-size: 1rem;
		font-weight: 600;
	}

	h4 {
		margin: 1.6rem 0 0.5rem;
		font-family: var(--font-body);
		font-size: 0.95rem;
		font-weight: 600;
		font-style: italic;
	}

	section p {
		margin: 0 0 1rem;
		text-align: justify;
		hyphens: auto;
	}

	.thesis {
		padding-left: 1rem;
		border-left: 3px solid var(--terracotta);
		font-style: italic;
	}

	ol,
	ul {
		padding-left: 1.3rem;
	}

	li {
		margin-bottom: 0.5rem;
	}

	.law {
		margin: 1.4rem 0;
		padding: 0.9rem 1.2rem 0.1rem;
		border-left: 3px solid var(--terracotta);
		border-radius: 0 var(--radius) var(--radius) 0;
		background: var(--paper);
	}

	.law .lawname {
		margin: 0 0 0.4rem;
		font-family: var(--font-body);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-align: left;
		color: var(--terracotta);
	}

	.law .lawname .kind {
		display: inline-block;
		margin-right: 0.6rem;
		padding: 0 0.35rem;
		border: 1px solid currentColor;
		border-radius: 3px;
		font-size: 0.68rem;
		letter-spacing: 0.08em;
	}

	.law.policy {
		border-left-color: var(--mustard);
	}

	.law.policy .lawname {
		color: var(--ink-soft);
	}

	.law.concept {
		border-left-color: var(--sage);
	}

	.law.concept .lawname {
		color: var(--ink-soft);
	}

	.hyps dt {
		margin-top: 1rem;
		font-weight: 600;
	}

	.hyps dd {
		margin: 0.3rem 0 0.8rem;
		text-align: justify;
		hyphens: auto;
	}

	.partline {
		margin: 4.2rem 0 -1.6rem;
		padding-top: 1.2rem;
		border-top: 1px solid var(--line);
		font-family: var(--font-body);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--terracotta);
		scroll-margin-top: 1.5rem;
	}

	figure {
		margin: 2.2rem 0;
		padding: 1.2rem 1.2rem 1rem;
		border-radius: var(--radius);
		background: var(--paper);
	}

	figure.wide {
		margin-left: min(0px, calc((var(--measure) - min(64rem, 100vw - 2.5rem)) / 2));
		margin-right: min(0px, calc((var(--measure) - min(64rem, 100vw - 2.5rem)) / 2));
	}

	figcaption {
		margin-top: 0.9rem;
		font-family: var(--font-body);
		font-size: 0.84rem;
		line-height: 1.55;
		color: var(--ink-soft);
	}

	figcaption strong {
		color: var(--ink);
	}

	.control {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 1rem;
		margin-top: 0.9rem;
		font-family: var(--font-body);
		font-size: 0.88rem;
	}

	.control input {
		flex: 1 1 14rem;
		accent-color: var(--terracotta);
	}

	.table-wrap {
		position: relative;
		margin: 1.8rem 0;
		overflow-x: auto;
	}

	table {
		width: 100%;
		min-width: 38rem;
		border-collapse: collapse;
		font-family: var(--font-body);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	caption {
		margin-bottom: 0.7rem;
		text-align: left;
		color: var(--ink-soft);
	}

	th,
	td {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid var(--line);
		text-align: left;
		vertical-align: top;
	}

	thead th {
		border-bottom: 2px solid var(--ink);
		font-weight: 600;
	}

	td:first-child {
		font-weight: 600;
	}

	/* Table 7: a narrow table of flows, two columns, so that it fits a phone */
	table.flows {
		min-width: 0;
	}

	.flows td:first-child {
		font-weight: 400;
	}

	.flows td + td,
	.flows thead th + th {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.flows tbody th {
		padding-top: 1rem;
		font-weight: 600;
	}

	.flows tr.net td {
		font-weight: 600;
	}

	/* a table that fits a phone: its text wraps instead of scrolling, and its numbers line up */
	table.narrow {
		min-width: 0;
	}

	table.narrow td,
	table.narrow th {
		font-variant-numeric: tabular-nums;
	}

	table.narrow .num {
		text-align: right;
	}

	table.narrow td.num,
	.checks {
		white-space: nowrap;
	}

	.law.prop ol {
		margin: 0.4rem 0 0.9rem;
		padding-left: 1.4rem;
	}

	.law.prop li {
		margin: 0.35rem 0;
	}

	.assume {
		list-style: none;
		padding-left: 0;
	}

	.assume li {
		margin: 0.45rem 0;
	}

	.assume .status {
		color: var(--ink-soft);
		font-size: 0.92em;
	}

	.glossary {
		margin: 0;
	}

	.glossary dt {
		margin-top: 0.7rem;
		font-family: var(--font-body);
		font-weight: 600;
	}

	.glossary dd {
		margin: 0.1rem 0 0;
	}

	/* inline code wraps at spaces first, and breaks inside a path only if the path alone is wider than the line */
	code {
		font-size: 0.88em;
		overflow-wrap: anywhere;
	}

	.refs ol {
		padding-left: 2rem;
		font-family: var(--font-body);
		font-size: 0.84rem;
		line-height: 1.5;
		color: var(--ink-soft);
	}

	.refs li {
		scroll-margin-top: 1.5rem;
	}

	.refs li:target {
		background: #f6e6c8;
	}

	.refs a {
		margin-left: 0.25rem;
		color: var(--ink-soft);
		word-break: break-all;
	}

	.cite-as {
		margin-top: 2rem;
		font-family: var(--font-body);
		font-size: 0.84rem;
		color: var(--ink-soft);
	}

	@media (max-width: 640px) {
		.paper {
			padding-top: 2rem;
			font-size: 1rem;
		}

		section p,
		.abstract p {
			text-align: left;
		}

		figure {
			padding: 0.9rem 0.75rem 0.8rem;
			margin-left: -0.5rem;
			margin-right: -0.5rem;
		}

		/* on a phone, narrow tables give their columns the side padding */
		table.narrow th,
		table.narrow td {
			padding-left: 0.3rem;
			padding-right: 0.3rem;
		}
	}
</style>
