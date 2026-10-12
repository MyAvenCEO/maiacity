<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import 'katex/dist/katex.min.css';
	import Tex from '$lib/theos/Tex.svelte';
	import Cite from '$lib/theos/Cite.svelte';
	import LineChart from '$lib/theos/LineChart.svelte';
	import Circulation from '$lib/theos/Circulation.svelte';
	import DecaySurface from '$lib/theos/DecaySurface.svelte';
	import SplitFlow from '$lib/theos/SplitFlow.svelte';
	import DayOfHearts from '$lib/theos/DayOfHearts.svelte';
	import WhereHeartsGo from '$lib/theos/WhereHeartsGo.svelte';
	import FollowOneHeart from '$lib/theos/FollowOneHeart.svelte';
	import MindCycle from '$lib/theos/MindCycle.svelte';
	import { REFS } from '$lib/theos/refs.js';
	import {
		RATE, UIA_DAY, DIVIDEND_SHARE, POOL_DRIP, salesBound, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate, balanceAt, decay,
		idleSeries, convergenceSeries, infraSeries, lvrSeries, basketLvr, selectionSeries, selectionStats, fmt,
		GINI_DE, ownLevel, giniAt, levelYears, reachedBy, giniRest, giniOf, dialSeries,
		yearlyLoss, steadyStateGrowth, yearsToReach, relativeRate, selfDealDay, honestDay,
		poolAfterCrash, heldAfterCrash, pairCount, ROUND_TRIP, flowSum, incomeShare,
		SIM, BASIC_BUNDLE, PROOF, DECILES, OWNER_ONLY, DYN, STATIC, RESERVES, LADDER, variation,
		variationsMuAbove, foodShort, foodOnlyShort, allPass, PRICES_BY_YEAR, bundleShareOfLiving, COMPETITION, FAILURE,
		ENERGY_ENTRANTS, MIND_RETURNS, spendShare, strictThreshold, ownerOnlyYield, impliedSales, netHalfLife,
		meltMargin, stockGrowthDay, moneyGap, growth, poorestDip, livingAt, livingSeries, ENERGY, kwPerPerson, gjToKw, domeYears,
		starveFail, holdingCoverYears, holdingLivingDays, ownerOnlyDividendShare, growthRate, plantGrowthRate, tenYearFalls,
		strictWorstEarly, bedsFromEnergy, decemberGap, SDE_CHECK, bundleMargin, treasuryShare, salesAfterLaw5
	} from '$lib/theos/model.js';

	// Figure 12's simulation, run at build time (+page.server.js)
	let { data } = $props();

	// the four series colours, validated together for colour-blind separation on the paper's surface
	const C = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0'];

	// one map for the numbers of figures, tables and equations, so that a new one never leaves a stale reference behind
	const FIG = { day: 1, wall: 2, heart: 3, idle: 4, surface: 5, conv: 6, split: 7, lvr: 8, infra: 9, selection: 10, machine: 11, gini: 12, dial: 13, cycle: 14, deciles: 15 };
	const TAB = { speeds: 1, prices: 2, binds: 3, rivals: 4, parts: 5, twoWorlds: 6, roundTrip: 7, prop3: 8, variations: 9, gameCity: 10, conditions: 11, notation: 12, threats: 13, physics: 14 };
	const EQ = { normal: 11, strict: 12, abundance: 13 };

	// one rate drives Figures 5 and 6, so a reader can feel what the 7 % does
	let rate = $state(RATE);

	const idle = idleSeries().map((s, i) => ({ id: `r${s.r}`, label: `${Math.round(s.r * 100)} % a year`, color: [C[1], C[0], C[3]][i], points: s.points }));
	const conv = $derived(convergenceSeries(rate).map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] })));
	const star = $derived(steadyState(rate));
	const infra = infraSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const lvr = lvrSeries().map((s, i) => ({ ...s, color: [C[2], C[0], C[1]][i] }));
	const sel = selectionSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const gin = $derived(data.gini.map((s, i) => ({ ...s, color: ['#8a8578', C[0], C[2], C[1]][i] })));
	const dial = dialSeries(undefined, DYN.mu).map((s, i) => ({ ...s, color: [C[1], C[0], C[3], C[2]][i], dash: i === 3 }));
	// Figure 15: real consumption of the richest, the middle and the poorest tenth, every year, on a log scale
	const living = livingSeries().map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] }));

	// a no-break space keeps a number and its % sign on one line
	const pct = (v, d = 0) => `${fmt(v, d)}\u00a0%`;
	// a share (0.87) as a percentage (87 %)
	const pc = (v, d = 0) => pct(v * 100, d);
	// a number inside TeX: its thousands comma must not read as punctuation
	const tn = (v, d = 0) => fmt(v, d).replace(/,/g, '{,}');
	const ev = lifeForRate(RATE);
	const u = UIA_DAY * 365;
	// Figure 10 in numbers, as drawn, and with a COOP C that never learns
	const selNow = selectionStats();
	const selFlat = selectionStats(0);
	// Section 10.4: the round trip, signed, and a person's income by source
	const RT = ROUND_TRIP;
	const sg = (v) => `${v < 0 ? '−' : '+'}${fmt(Math.abs(v), 2)}`;
	const share = (k) => pc(incomeShare(k));
	// Section 10: the poorest tenth's dip, a ladder row by id, and a tick or a cross
	const dip = poorestDip();
	const V = variation;
	const mark = (c) => (c ? '✓' : '✗');
	const goods = COMPETITION.map((g) => ({ ...g, name: g.good[0].toUpperCase() + g.good.slice(1) }));
	const energyGood = COMPETITION.find((g) => g.good === 'energy');
	const foodGood = COMPETITION.find((g) => g.good === 'food');
	// Section 10: the ten-year windows in which the poorest tenth fell, and the worst early year of the strict test
	const falls = tenYearFalls();
	const strictEarly = strictWorstEarly();
	const strictLater = strictWorstEarly(2);

	// the paper's arc: where we come from, the system itself, where it leads
	const parts = [
		{ title: 'Part I · From capitalism', sections: [
			['why', '1 · Why: the end of the wage'],
			['money', '2 · What money is, and why it should melt'],
			['dividend', '3 · Who should create money']
		] },
		{ title: 'Part II · The operating system', sections: [
			['laws', '4 · The five laws'],
			['entropy', '5 · Melting money, in numbers'],
			['pol', '6 · Keeping every MIND tradeable'],
			['avens', '7 · Avens: an agent for every person'],
			['infra', '8 · Building for the long term: land and energy'],
			['governance', '9 · Governance and competition']
		] },
		{ title: 'Part III · Toward Abundism', sections: [
			['living', '10 · The central result'],
			['city', '11 · Proving it: first a game, then a city'],
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
			['disclosure', 'G · Interests and code'],
			['physics', 'H · The physical world'],
			['references', 'References']
		] }
	];
</script>

<svelte:head>
	<title>theOS · The civilization scale operating system of Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, protocol-owned liquidity, open market governance, and Proposition 3: no one starves, no one has to work to survive, and the consumption of every tenth of the people rises from one ten-year mark to the next. By Samuel Andert." />
</svelte:head>

<main class="paper">
	<header class="masthead">
		<p class="brand">theOS</p>
		<p class="kind">Working paper · v6 · October 2026 · maiaCITY</p>
		<h1>The civilization scale operating system of Abundism</h1>
		<p class="subtitle">A macroeconomic and system-engineering framework for a post-labour economy</p>
		<p class="author">Samuel Andert</p>
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
			SamuelHEARTS, Anna's are AnnaHEARTS. HEARTS buy nothing and pay for nothing, not even food. They are a voice.
			People can only invest them into cooperatives, or COOPs: shared enterprises that make what a city needs, such as
			energy, food or housing.
		</p>
		<p>
			Each HEART that a person invests converts into one unit of that COOP's MIND. A MIND is one currency of ownership
			and utility: to hold it is to own part of the COOP, and to spend it is to use what the COOP makes. Half of the new
			MIND goes to the investor and half to the COOP's treasury, the money that the COOP works with. A tenth of that
			half flows into liquidity pools that the protocol owns, so anyone can trade one MIND for another. A treasury keeps
			about {SIM.reserveMonths} months of reserves and pays out the rest.
		</p>
		<p>
			Every sale pays the COOP's owners. A fixed share of every sale, by default {pc(DIVIDEND_SHARE)}, goes at once to
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
			delivers all work with the COOPs' machines. A person's MIND comes from three places: the ownership their
			investing creates, the work items their Aven delivers, and the dividends of what they own.
		</p>
		<p>
			COOPs that make the same good compete, and anyone can found a rival. Prices move freely with demand, with no caps.
			Everything the city makes costs energy. theOS aims for a city where only physics limits abundance, never a lack of
			money.
		</p>
		<p>
			Our central result is Proposition 3. Take a city that can make enough, whose output per person grows, and whose
			sellers compete. Its residents invest for a founding week before the first sale, so the pools hold MIND on
			opening day. Then no one starves, and no one has to work to survive. And the real consumption of every tenth of
			the people is higher at every ten-year mark than ten years before. We check it in one simulation of
			{SIM.people} people over {SIM.years} years, with free prices, rival COOPs, foundings, failures and shocks. Parts 1
			and 2 are checked for every person at every step, and part 3 for every tenth. From day {PROOF.fromDay}, nobody got
			less than every basic need. People whose Avens deliver nothing lived from what they own: the ownership that
			each day's investing creates, and its dividends. The simulation assumes that productivity grows about
			{pc(SIM.prodGrowth)} a year in each COOP, and it has no energy limit yet. Under that assumption, the poorest tenth
			consumed {fmt(growth('d1'))} times as much in year {SIM.years} as in year 1. The test city must check part 3
			with growth that only surplus energy pays for.
		</p>
		<p>
			We also report what fails. In the first week, before anyone held MIND, people went short. Dividends alone missed
			on {pc(1 - strictEarly.share)} of the owner-only days in year {strictEarly.year}, on up to {pc(1 - strictLater.share)}
			in a later year until year {PROOF.strict.lastShortYear}, and on {pc(1 - PROOF.strict.shareAfter10, 2)} after year 10. The poorest tenth consumed {pc(-dip.fall)} less in year
			{dip.to} than in year {dip.from}. Only the main run, 1 of {LADDER.length} runs on one seed, passed all three checks.
			In {starveFail()} of the {LADDER.length - 1} variations, someone ran short of basics, mostly of food. We propose a
			fix for each failure, but none is tested yet.
		</p>
		<p>
			We will prove theOS first in a game, then in the real city. The game is a test city, where AI agents live under
			its rules and we can measure and change every rule. The test city checks Proposition 3 for every person on every
			day. Then the rules that survive become the economy of maiaCITY, the city we are building.
		</p>
		<p class="keywords">
			<strong>Keywords:</strong> demurrage · personal currencies · universal dividend · Relative Theory of Money · post-labour economics ·
			cooperatives · automated market makers · protocol-owned liquidity · mechanism design · agent-based model ·
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
			of new ownership, every day, that the person directs and that cannot pile up without limit.
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
					<tr><td>Slow</td><td>Take over tasks one by one, as in recent decades; new kinds of work keep appearing</td><td>Keep rising; the share of income that goes to work falls slowly</td><td>Runs beside the euro. People keep their jobs, and their HEARTS add a growing stake of ownership</td></tr>
					<tr><td>Medium</td><td>Can do most tasks in about 20 years</td><td>Rise at first, then fall in more and more jobs</td><td>The ownership that investing creates, Aven work items and dividends carry a growing share of each person's income</td></tr>
					<tr><td>Fast</td><td>Can do most tasks in about 5 years</td><td>Can collapse once machines spread faster than new capital is built</td><td>HEARTS become the main way to gain ownership. How plentiful the basics are depends on what the COOPs' machines make, and on the energy they harvest</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			The usual answer is a universal basic income: a fixed sum that everyone gets without conditions
			<Cite k="parijs" />. It would feed people, but it keeps the structure as it is. People would get consumption,
			never direction: they could spend, but they could not decide what the automated economy builds next. theOS feeds
			people through ownership: the ownership that each day's investing creates, and its dividends. HEARTS themselves
			never pay for anything (Section 10).
		</p>
		<p class="thesis">
			This paper describes a way out. It keeps what markets do well and changes the base they stand on. We call the
			destination <em>Abundism</em>: an economy in which automation makes the basics plentiful, and every person helps
			to decide what the economy builds. In Abundism, distribution is always a question of fair participation through
			fair ownership. No human labour is paid. Each person's AI agent, the Aven of Section 7, proposes and delivers the
			work with the machines. MIND is the ownership money of Section 4. A person's MIND comes from three places: the
			ownership their investing creates, the work items their Aven delivers, and the dividends of what they own. The promise is
			concrete. No one starves, no one has to work to survive, and the living standard of every tenth of the people
			rises. theOS aims for a city where only physics limits how far. Section 10 states this as Proposition 3 and checks
			it in a simulation, person by person. To get there, we must
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
			order. The world that money measures runs on energy and wears out. Section 8.2 returns to this: energy is the one
			resource that every other resource needs.
		</p>
		<p>
			Money that never loses value lets its owner escape the physics that everyone else lives in. The most rational
			thing to do with a surplus is then to keep it idle. And the people who already hold the most can wait the longest.
		</p>
		<p>
			Silvio Gesell proposed the fix more than a century ago. In 1916 he argued that money should carry a small holding
			cost, like every good it competes with. Money would then circulate and not wait for a higher interest rate
			<Cite k="gesell" />. The name for a fee on holding money is <em>demurrage</em>: the charge that a ship pays for
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
			held in common <Cite k="gesell" />. Keynes later named the weakness in plain terms. When money carries a cost,
			wealth escapes into substitutes that do not melt, above all land <Cite k="keynes36" />. We return to that warning
			in Sections 8.1 and 12. Demurrage tells us how money should behave. It does not yet tell us where new money should
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

	<p class="partline" id="part-2">Part II · The operating system</p>

	<section id="laws">
		<h2><span>4</span>The five laws</h2>
		<p>
			theOS rests on five laws. The protocol, the shared software at the base of theOS, fixes them the way a physics
			engine fixes gravity. Everything else grows on top of the laws and can change: prices, cooperatives and the way
			each cooperative decides. The laws cannot change: nobody holds a key that changes them. Appendix F says what can
			change in the code, and who decides. The laws are short. Together they say where money comes from, where it can
			go, what it becomes there and who gains when it is spent.
		</p>
		<div class="law">
			<p class="lawname">Law 1 · Universal Intent Allocation (UIA)</p>
			<p>
				Every human gets {UIA_DAY} HEARTS a day, without conditions, one for each hour lived, from birth to death. Each
				human has one stream. Each person's HEARTS are a currency of their own: Samuel's are SamuelHEARTS, Anna's are
				AnnaHEARTS. Only their owner can invest them; for a child, a guardian does.
			</p>
		</div>
		<p>
			The name says what it is. <em>Universal</em>, because everyone gets it. <em>Intent</em>, because it shows what a
			person wants to see built. <em>Allocation</em>, because it is the right to allocate: to invest one's HEARTS into
			the cooperatives (COOPs) that one chooses. It is not a handout for survival. Survival comes from what a person
			owns: the ownership that each day's investing creates, and its dividends. HEARTS themselves never pay (Section 10). The UIA gives each person a voice in where the automated economy puts
			its effort.
		</p>
		<p>
			Three cases need a clear rule. <strong>Who gets HEARTS:</strong> every human, with one stream each, however old
			and wherever born. One stream per human needs an identity that nobody can fake many times (Section 12).
			<strong>Children:</strong> a child gets HEARTS from birth. Until an age that the city sets, for example 16, a
			guardian directs the child's HEARTS. The MIND that they create belongs to the child. <strong>Death:</strong> the
			stream stops when a person dies. The MIND that the person leaves goes either to the City COOP of Section 8.1 or to
			heirs whom the person names. Section 12 keeps this choice open. An Aven, the personal agent of Section 7, invests
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
			<p class="lawname">Law 2 · Pure investment</p>
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
			<p class="lawname">Law 3 · Open cooperative creation</p>
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
			a COOP that owns machines, signs contracts or employs people needs a legal form. In Germany that is often a
			registered cooperative, an <em>eG</em>. An eG needs at least three members, statutes and a membership in an audit
			federation. So "without permission" holds for the protocol, not for the law. One bridge is an umbrella eG whose
			divisions are COOPs. A COOP that grows large becomes its own eG (Section 12). COOPs that make the same good compete
			for buyers, and anyone can found a rival (Section 9.1).
		</p>
		<p>
			The fourth law says what an investment creates. It is the moment when a person's intent becomes something that
			people can own and use.
		</p>
		<div class="law">
			<p class="lawname">Law 4 · Every COOP has its own MIND, created by investing HEARTS</p>
			<p>
				Every COOP has its own MIND: SOLARmind for a solar COOP, AGRImind for a farming COOP. A MIND is the COOP's
				shared intelligence, its automated capacity to make something. It is one currency of ownership and utility. To
				hold it is to own part of the COOP, and to spend it is to use what the COOP makes. Only investment creates MIND.
				Each invested HEART converts into one new MIND of its COOP: half goes to the investor and half to the COOP's
				treasury. Both halves are the same MIND; there is only one kind.
			</p>
		</div>
		<p>
			Follow one HEART. Anna invests one AnnaHEART into the solar COOP. The HEART converts and is gone for good. Nobody
			holds it after that, not even the COOP. In its place, one new SOLARmind appears: half in Anna's wallet and half in
			the COOP's treasury. It is the same SOLARmind in both places, and it does every job.
		</p>
		<p>
			In Anna's wallet, the SOLARmind is her ownership: she is now a part-owner of the solar COOP. While she holds it,
			its value follows the COOP's success, through its price and through a share of every sale (Law 5). When Anna
			switches on her lamp, she pays for the power in SOLARmind. She can pay with any MIND that she holds: the pools
			convert it, and the solar COOP always receives SOLARmind. What she spends goes back to the COOP. What she keeps
			stays her ownership.
		</p>
		<p>
			In the treasury, the SOLARmind is the COOP's working capital. A tenth of this half drips into the pools. The COOP
			spends the rest through proposals that its members accept. It <em>buys</em> panels: it pays in SOLARmind, the
			pools convert it, and the panel COOP receives PANELmind. And it <em>pays for work</em>, but never for human
			labour. The Avens propose and deliver all work, with the COOP's machines, and the COOP pays the human whose Aven
			delivers. Each such piece of work is an <em>Aven work item</em>. Mia's Aven runs the daily check of the panels: a
			<em>running item</em>, which the COOP pays from its running costs. It also proposes a plan for the panels'
			repairs: a <em>work proposal</em>. The COOP accepts, Mia's Aven and the COOP's robots do the work, and the COOP
			pays Mia in SOLARmind. Mia herself does not labour for it. And Mia does not keep it long: her Aven pays for her
			food, her tram rides and a concert. So the MIND that leaves a treasury comes back to the COOPs through what they
			sell (Section 10.4).
		</p>
		<p>
			The treasury keeps a reserve for about {SIM.reserveMonths} months of running costs and planned building. It grows
			its own <em>plant</em> first: the machines and buildings that make its goods. What it holds beyond that, it pays out for more work proposals (Section 9.3). So the MIND
			that Anna paid for her light does not stay in the treasury, where it would only melt. It flows back out to people
			and to other COOPs, and the COOP grows what it can make.
		</p>
		<p>
			The fifth law says who gains when a COOP sells.
		</p>
		<div class="law">
			<p class="lawname">Law 5 · Every sale pays its owners</p>
			<p>
				A fixed share of every sale goes to the COOP's owners at the moment of sale. By default it is {pc(DIVIDEND_SHARE)}. It is paid
				in the COOP's own MIND, to everyone who holds that MIND, in proportion to what each one holds. A COOP can change
				its share by proposal, within a limit that the protocol sets.
			</p>
		</div>
		<p>
			This payment is the <em>dividend</em>. When Anna pays for her light, {pc(DIVIDEND_SHARE)} of her payment goes at once to everyone
			who holds SOLARmind. Anna holds SOLARmind too, so she gets a little of it back. The holders are people and other
			COOPs' treasuries. The solar COOP's own treasury and the pools get no share (Section 9). The other {pc(1 - DIVIDEND_SHARE)} goes to
			the treasury. It pays for inputs, services, building, ground rent, running items and accepted work proposals.
			Nobody has to vote on each dividend.
		</p>
		<p>
			This is the heart of theOS: ownership pays. Everyone owns MIND, and holding it brings more MIND. Every lamp that
			anybody switches on pays Anna a little. What a person holds, and the dividends that it pays, let a person live
			without working (Section 10).
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
				<strong>Figure {FIG.heart}.</strong> Laws 4 and 5, step by step. One HEART converts into one SOLARmind. Half goes to
				Anna's wallet as her ownership, and half to the treasury as working capital. Anna pays for her light in
				SOLARmind, and most of it goes back to the treasury. The treasury pays it out again: a tenth of its half into
				the pool, the panel COOP through the pool in its own PANELmind, and Mia for her Aven's work proposal. A share of
				every sale goes at once to everyone who holds SOLARmind; Anna gets some back as a holder. The areas of the coins
				are to scale. Tap a number to go to a step.
			</figcaption>
		</figure>
		<p>
			So theOS has only two kinds of money. HEARTS are intent, and they exist only until their owner invests them.
			MINDs are what intent becomes, and they carry the whole economy after that. The laws say where both come from.
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
			for the fee, so nobody gains by moving money just before a deadline. The rule is:
		</p>
		<Tex display tex={String.raw`\begin{gathered} B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t} \\ \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \end{gathered} \tag{1}`} />
		<p>
			Here <Tex tex="B" /> is any balance of HEARTS or of a MIND: in a person's wallet, in a COOP's treasury or in a
			pool. The time
			since its last update, in years, is <Tex tex={String.raw`\Delta t`} />. A day costs
			<Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a balance. An idle balance
			loses half of its value in a time called its half-life:
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{2}`} />
		<p>
			On money that people use, the cost is too small to notice. But it is large enough that nobody keeps a fortune idle.
			In Fisher's terms, the melt fixes the amount <Tex tex="M" /> (Section 5.2), and it is meant to raise the velocity
			<Tex tex="V" />. Whether it does is a hypothesis for the test city. The simulation of Section 10.3 cannot settle it, because
			it assumes how much people spend. It shows something else: money keeps moving only while people still want more
			(Section 10.4). The evidence from earlier demurrage money is mixed,
			and each of those currencies was tied to a national one (Appendix D). For HEARTS, it
			means that nobody can store intent to seize power later. For MINDs, it means that a COOP's currency is worth
			holding only while the COOP keeps making things. Wealth stops being something one <em>has</em> and becomes
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
		<figure class="wide">
			<DecaySurface {rate} />
			<div class="control">
				<label for="rate">Demurrage rate <strong>{pct(rate * 100, 1)}</strong> a year</label>
				<input id="rate" type="range" min="0.01" max="0.15" step="0.005" bind:value={rate} />
			</div>
			<figcaption>
				<strong>Figure {FIG.surface}.</strong> All the demurrage curves <Tex tex={String.raw`B(t, r) = e^{-rt}`} /> as one surface.
				One axis shows the time held, the other the demurrage rate. The height shows what remains of one HEART or MIND.
				The terracotta line is the rate that you set with the slider, which also controls Figure {FIG.conv}. Drag the surface to
				turn it.
			</figcaption>
		</figure>
		<h3>5.2 Where all money settles</h3>
		<p>
			Monetary policy, the set of rules that controls how much money exists, is simple in theOS. With one demurrage rule
			for both kinds of money, it fits in four verbs. The protocol <em>issues</em> money only as HEARTS,
			<Tex tex={String.raw`u = ${UIA_DAY} \times 365 = ${tn(UIA_DAY * 365)}`} /> a year per person. Money changes form
			only by <em>conversion</em>, one HEART into one MIND, which neither creates nor destroys money. It
			<em>circulates</em> as MIND: COOPs make, sell and buy their services in it. And it <em>leaves</em> only by melting.
		</p>
		<p>
			Count all the money there is, HEARTS and MINDs together: in wallets, in treasuries and in the pools. Count every
			token as one, whatever its price in the pools. Divide this count by the number of people, <Tex tex="N" />. The
			result, <Tex tex="m" />, is an average count of tokens per person. With a constant population, it gains
			<Tex tex="u" /> a year and melts at the rate <Tex tex="r" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dm}{dt} = u - r\,m, \qquad m^{*} = \frac{u}{r} \\ m(t) = m^{*} + \left(m_0 - m^{*}\right) e^{-rt} \end{gathered} \tag{3}`} />
		<p>
			At <Tex tex="r = 0.07" />, the steady state is <Tex tex={String.raw`m^{*} \approx ${tn(steadyState())}`} /> per
			person. At this level, the new HEARTS of each year equal the money that melts in that year. However people
			invest, spend or trade, the total moves toward this level from either side. A young city's money rises to it from
			below, and an inflated city's money falls to it from above. The gap halves every {fmt(halfLife(), 1)} years. This
			is the resting state of Godley and Lavoie's simplest model, with the melt in place of a tax <Cite k="godley" />.
		</p>
		<p>
			The simulation of Section 10.3 plays the rules of this paper for {SIM.people} people over {SIM.years} years, with
			free prices and rival COOPs. We call it the dynamic world, and an earlier, simpler version the static world. We
			call years {SIM.restFrom} to {SIM.years} of a run its <em>rest</em>. At rest, money per person reached
			{fmt(DYN.money)}, {pc(-moneyGap(), 1)} below <Tex tex="u/r" />. Mostly, money was still filling (Section 10.4); a
			little left with COOPs that ended.
		</p>
		<p>
			But <Tex tex={String.raw`m^{*}`} /> is a count of tokens, not anyone's wealth. It includes the treasuries and the
			pools, and it adds different MINDs one for one. A single balance follows the same rule with its own net inflow. A
			balance with a net inflow of <Tex tex={String.raw`y_i`} /> a year tends to
			<Tex tex={String.raw`B_i^{*} = y_i / r`} />. A person who keeps their half of the MIND that their own investing
			creates, and spends nothing, tends to <Tex tex={String.raw`u/(2r) \approx ${tn(ownLevel())}`} /> MIND: half of
			<Tex tex={String.raw`m^{*}`} />. The other half goes to treasuries and pools, and treasuries pay most of it out
			again for Aven work items (Section 9.3). A person whose net inflow is twice as large tends to twice the balance.
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
			like an equal grant to every person. The levelling comes from the rule itself.
		</p>
		<figure>
			<LineChart
				title="From any start, the count of all HEARTS and MINDs per person moves to the same steady state"
				series={conv}
				x={{ min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1_000_000, ticks: [0, 250_000, 500_000, 750_000, 1_000_000], fmt: (v, tip) => (tip ? fmt(v) : v >= 999_500 ? '1 M' : v ? `${fmt(v / 1000)}k` : '0'), label: 'Tokens per person, all holders' }}
				refs={[{ axis: 'y', at: star, label: `steady state u/r = ${fmt(star)}` }]}
			/>
			<figcaption>
				<strong>Figure {FIG.conv}.</strong> The average count of HEARTS and MINDs per person, in wallets, treasuries and pools,
				with a constant population. It is a count of tokens, not anyone's wealth. Three starts: none (a new city), the 7 %
				steady state, and a million per person. All three meet at <Tex tex="u/r" />, and a new city reaches 95 % of it
				after about {fmt(yearsToReach(0.95, rate))} years. Move the slider under Figure {FIG.surface}. A lower rate raises the steady
				state and slows the approach to it. A higher rate does the opposite.
			</figcaption>
		</figure>
		<h3>5.3 Laborde's rule, arrived at from the other side</h3>
		<p>
			Section 3 introduced Stéphane Laborde's universal dividend: money created equally for every member. With (3), we
			can now compare the two systems closely. Laborde derives the rate of the dividend from one requirement: each
			generation must co-create the same share of money over a life of <Tex tex={String.raw`e_v`} /> years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{4}`} />
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
			<Tex tex={String.raw`b_i = B_i / (m/2)`} />. With (3), <Tex tex={String.raw`\dot b_i = \frac{u}{m(t)}\,(1 - b_i)`} />.
			At the steady state, <Tex tex={String.raw`u/m^{*} = r`} />, so <Tex tex={String.raw`\dot b_i = r\,(1 - b_i)`} />:
			Laborde's law with <Tex tex="c = r" />. ∎
		</p>
		<p>
			So the two systems agree once the money has settled. In a young city, the rate <Tex tex={String.raw`u/m(t)`} />
			starts high and falls to <Tex tex="r" />. From nothing, it is {pct(relativeRate(1) * 100, 1)} in year 1,
			{pct(relativeRate(10) * 100, 1)} in year 10 and {pct(relativeRate(30) * 100, 1)} in year 30. So a young city
			levels its members faster than Laborde's system would. Two differences remain. In Laborde's system every member
			gets all of the new money; in theOS a member gets half, and the other half goes to the COOPs. And Laborde derives
			<Tex tex="c" /> from a life span, while the model here has no births or deaths.
		</p>
		<p>
			Laborde keeps the universal dividend relative and lets the amount of money grow. theOS keeps the issuance fixed
			and lets the money melt. What theOS gains is a unit that people can think in, 24 a day, one per hour. And once the
			money has settled, prices no longer drift upward with a growing money supply. They fall as output grows. A young
			city is different. Its money per person grows about {fmt(balanceAt(0, 30) / balanceAt(0, 1))}-fold from year 1 to
			year 30. If people spend a steady share of what they hold, Fisher's equation says that prices in MIND rise by
			about the same factor, unless output grows faster. In the simulation, output did grow faster. A
			day's basics cost {fmt(PRICES_BY_YEAR[1].bundleMind, 3)} MIND in year 1 and {fmt(PRICES_BY_YEAR[30].bundleMind, 3)}
			in year 30. At rest they still got {pc(-DYN.bundleChange, 1)} cheaper a year in real terms (R, Section 6.3).
		</p>
		<p>
			theOS does not take its rate from (4). The pair of 24 a day and 7 % a year comes from Circles v2
			<Cite k="circles2" />. Circles takes its 7 % as a yearly rate, applied day by day. theOS melts continuously, so 7 %
			a year takes {pct(yearlyLoss() * 100, 1)} of an idle balance in a year. Read through (4), 7 % matches a life of
			<Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years, so it is gentler than Laborde's
			{pct(rtmRate(80) * 100, 1)} for an 80-year life. 7 % also has reasons of its own. It sets the half-life of any
			idle holding, and of any advantage, at {fmt(halfLife(), 1)} years: a fortune fades within a lifetime, while a
			balance left idle for ten years still keeps {pct(decay(100, RATE, 10))} of its value. It sets the steady state at
			{fmt(1 / RATE, 1)} years of issuance, a level that people can picture. And it sets the fairness dial of Section
			9.3: at {pc(RATE)} and a spread of returns of 20 %, the resting Gini index is {fmt(giniRest(0.2), 2)}. A lower rate
			allows more inequality, and a higher rate makes long saving much harder. Section 12.5 makes the rate a parameter
			for the test city.
		</p>
		<p>
			Money now has a source, a form and a limit. One practical question remains. Every COOP has its own MIND. So how
			does Anna pay for a tram ride with SOLARmind? And how does the solar COOP pay the steel COOP in STEELmind for a new
			turbine? The liquidity pools are the answer.
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
			be equal either (Section 6.3). Section 12 asks how to anchor them.
		</p>
		<p>
			The best-known AMMs pair two currencies, and outside investors supply them and can withdraw their money again.
			theOS does neither. Its pools hold baskets of many MINDs, and they belong to the protocol itself.
		</p>
		<div class="law">
			<p class="lawname">The liquidity rule</p>
			<p>
				A tenth of every COOP's treasury half flows automatically into liquidity pools. So {pc(POOL_DRIP / 2)} of the
				MIND that each invested HEART creates drips into the pools, in the COOP's own MIND. What a COOP earns by selling is not levied. Each pool holds a basket of 4 to 8
				different MINDs. The COOP chooses which baskets its MIND joins. The pools belong to the protocol, not to any
				COOP. Nobody can ever withdraw what enters a pool. MIND leaves a pool only through trades, by melting, or when its
				COOP fails and its MIND is retired (Section 12.3).
			</p>
		</div>
		<p>
			So a COOP starts life in two parts. First, people invest their HEARTS, and each HEART converts into the COOP's MIND
			at that very moment. A COOP never holds a HEART. Its treasury holds only MINDs: its own MIND, and the MINDs of other
			COOPs that it buys for its own needs. Second, it partners with at least three other COOPs, whose MINDs join its
			own MIND in its first basket. Only then can people trade its MIND.
		</p>
		<p>
			For example, the solar COOP's SOLARmind might sit in one basket with TRAMmind, AGRImind and STEELmind. It might
			sit in another basket with WATERmind, COMPUTEmind, HABITATmind and ARTmind. No HEARTS ever sit in a pool, because
			every HEART converted into MIND at the moment of its investment.
		</p>
		<p>
			The pools also do the routing. When a COOP sells something, it always gets its own MIND. The buyer's Aven pays
			with whatever MINDs the buyer holds. In the background, the pools convert them into the seller's MIND and route it
			to the seller. So the tram COOP gets only TRAMmind for a ride, whatever its passengers hold.
		</p>
		<figure>
			<SplitFlow />
			<figcaption>
				<strong>Figure {FIG.split}.</strong> One HEART invested into a COOP converts into one MIND and is gone. Half of that MIND
				goes to the investor, half to the COOP's treasury, its working capital. Both halves are the same MIND. A tenth
				of the treasury half, {pc(POOL_DRIP / 2)} of the new MIND, flows on into the protocol's pools, baskets of 4 to 8 MINDs, and never
				returns.
			</figcaption>
		</figure>
		<h3>6.1 The design: one equal-weight basket</h3>
		<p>
			theOS uses only one pool design: the <em>geometric mean market maker</em>. We chose it because it is the most
			widely used design for pools of 4 to 8 volatile currencies. Balancer's weighted pools have used it since 2020
			<Cite k="balancer evans" />, and they now hold up to eight tokens, the same range as a theOS basket
			<Cite k="balancerDocs" />. Its incidents include pools drained through tokens whose balances changed outside trades
			<Cite k="theblock20" />, and a costly rounding bug <Cite k="balancerHack" />. Melting MINDs are such tokens, so
			theOS pools apply the melt through one global index and never change a reserve directly (Section 12).
		</p>
		<p>
			Every pool holds <Tex tex="n" /> = 4 to 8 MINDs in equal shares, <Tex tex={String.raw`w_i = 1/n`} />. With
			<Tex tex={String.raw`x_i`} /> of MIND <Tex tex="i" /> in the pool, it keeps
		</p>
		<Tex display tex={String.raw`\begin{gathered} \prod_{i=1}^{n} x_i^{\,1/n} = k \\ p_{ij} = \frac{x_i}{x_j}, \qquad \text{fee } \varphi = 0.3\,\% \end{gathered} \tag{5}`} />
		<p>
			Every trade keeps the geometric mean of the reserves constant. Only fees and inflows raise it, and only the melt
			lowers it. The price of MIND <Tex tex="j" /> in MIND
			<Tex tex="i" /> is simply the ratio of their reserves. At fair prices, each MIND is an equal share of the pool's
			value. So a basket behaves like an index that rebalances itself. Four more choices complete the design:
		</p>
		<ul>
			<li>
				<strong>A fixed fee of 0.3 %</strong> on every trade, the usual level for volatile currencies, whose prices move
				a lot. Arbitrage is trading to profit from a price difference between two markets. A fee widens the band of
				prices in which arbitrage does not pay <Cite k="lvrfees" />. There are no outside liquidity providers, so the fee
				goes to nobody. It stays in the pool and makes the pool larger.
			</li>
			<li>
				<strong>No pool tokens.</strong> Nobody ever withdraws anything, so a pool issues no tokens that someone could
				redeem. A COOP adds its {pc(POOL_DRIP)} inflow to the pool in its own MIND only: a one-sided deposit.
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
				hop also costs a fee, and that fixed cost makes the full problem harder. Section 12 proposes a hub MIND that
				keeps routes short.
			</li>
		</ul>
		<p>
			One property fits theOS especially well. Every MIND in a basket melts at the same {pc(RATE)} a year. So demurrage shrinks
			every reserve by the same factor, and every price in (5) stays the same. Melting creates no trading opportunity
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
		<Tex display tex={String.raw`\begin{gathered} \frac{\ell}{V} = \tfrac12\Big(\sum_i w_i \sigma_i^2 - w^{\top}\Sigma\,w\Big) \\ \overset{w_i = 1/n}{=}\; \tfrac12\,\sigma^2 (1-\rho)\Big(1 - \frac1n\Big) \end{gathered} \tag{6}`} />
		<p>
			The right-hand side holds for equal weights, one common volatility <Tex tex={String.raw`\sigma`} /> and one common
			correlation <Tex tex={String.raw`\rho`} />: how closely prices move together. Equation (6) assumes random-walk prices
			and arbitrage without fees <Cite k="lvr" />. The cost grows with how much MINDs move against one another, and the
			0.3 % fee wins part of it back <Cite k="lvrfees" />.
		</p>
		<p>
			In theOS, the protocol's pools carry this cost, not any one wallet. The MIND in Anna's wallet is never part of a
			pool. But the cost is real, and people pay it together. Of every new MIND, {pc(POOL_DRIP / 2)} goes to the pools. What
			the pools lose goes to arbitrageurs, to whoever orders the transactions and to the fastest Avens. A speculative
			attack can make a pool smaller, but every COOP's working capital and its turbines keep going. Clearing trades in
			batches at one price could cut the cost further <Cite k="fmamm" />. But the analysis so far covers only
			two-currency pools, so theOS treats it as an upgrade to test in the test city (Section 12).
		</p>
		<figure>
			<LineChart
				title="Yearly loss-versus-rebalancing of an equal-weight basket against its number of MINDs"
				series={lvr}
				x={{ min: 2, max: 8, ticks: [2, 3, 4, 5, 6, 7, 8], fmt: (v, tip) => (tip ? `${fmt(v)} MINDs` : `${v}`), label: 'MINDs in the basket' }}
				y={{ min: 0, max: 8, ticks: [0, 2, 4, 6, 8], fmt: (v, tip) => `${fmt(v, tip ? 2 : Number.isInteger(v) ? 0 : 1)} %`, label: 'LVR a year, share of the pool' }}
				refs={[{ axis: 'x', at: 4, label: 'minimum basket' }]}
			/>
			<figcaption>
				<strong>Figure {FIG.lvr}.</strong> The cost (6) of keeping a basket liquid, before the fee wins part of it back. It
				assumes prices that move as a random walk, at volatilities like those of large company shares. In a basket of
				four, calm MINDs (20 % volatility) cost {pct(basketLvr(4, 0.2) * 100, 1)} of the pool a year. Wild MINDs (40 %)
				cost {pct(basketLvr(4, 0.4) * 100)}. When MINDs move together (correlation 0.6), the cost falls to
				{pct(basketLvr(4, 0.4, 0.6) * 100, 1)}. Going from 4 to 8 MINDs adds only about
				{pct((basketLvr(8, 0.4) / basketLvr(4, 0.4) - 1) * 100)}.
			</figcaption>
		</figure>
		<h3>6.3 What a MIND is worth: R and days of living</h3>
		<p>
			A price needs a yardstick. One SOLARmind buys some kWh, and one AGRImind buys some food. But one of what? theOS has
			no single money to count in, so this paper counts in <em>R</em>. R compares a MIND with three everyday MINDs:
			SOLARmind, HABITATmind and CITYmind. To price a MIND in R, ask what it trades for in the pools against each of the
			three. Then take their geometric mean: the average that multiplies instead of adding. If one AGRImind trades for
			about two of each, it is worth 2 R. R is a yardstick, not a currency: nobody holds R or pays in it. When one of those COOPs ends, its successor takes its place, so R does not jump. We propose that the
			protocol publishes R from time-averaged pool prices.
		</p>
		<p>
			MIND prices do not settle at 1 R. A price of 1 would mean that every COOP delivers the same for its MIND. In a
			world where nothing changes, they nearly do: in the earlier static world of Section 10.3, every MIND ended between
			{fmt(STATIC.pricesMin, 2)} and {fmt(STATIC.pricesMax, 2)} R. In a dynamic world, they do not. In the simulation,
			prices at rest spread from {fmt(DYN.pricesMin, 2)} to {fmt(DYN.pricesMax, 2)} R. A MIND is worth
			what its COOP delivers for it, plus what it pays its holders. A COOP that loses its market is worth less, and its
			MIND can end at zero.
		</p>
		<p>
			A second yardstick is closer to life: a <em>day of living</em>. It is what an average person consumes in a day,
			priced in R that year. It grew from {fmt(PRICES_BY_YEAR[1].living, 1)} R in year 1 to
			{fmt(PRICES_BY_YEAR[60].living)} R in year 60, because people consume more, not because things got dearer. One
			person's basics for a day, the <em>basic bundle</em>, are {fmt(BASIC_BUNDLE.kcal)} kcal of food,
			{BASIC_BUNDLE.L} L of water, {BASIC_BUNDLE.kWh} kWh of energy and {BASIC_BUNDLE.m2} m² of home. A day's basics
			fell from {fmt(PRICES_BY_YEAR[1].bundleR, 3)} to {fmt(PRICES_BY_YEAR[60].bundleR, 3)} R: from
			{pc(bundleShareOfLiving(1))} of a day of living to {pc(bundleShareOfLiving(60), 2)}. Table {TAB.prices} shows the
			path.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.prices}.</strong> Prices in R and in days of living, in the simulation of Section 10.3. A MIND on average is the mean price of all live MINDs.</caption>
				<thead>
					<tr><th>Year</th><th class="num">A day of living, R</th><th class="num">Basics a day, R</th><th class="num">Basics, share of a day of living</th><th class="num">A MIND on average, R</th></tr>
				</thead>
				<tbody>
					{#each [1, 10, 30, 60] as y (y)}
						{@const p = PRICES_BY_YEAR[y]}
						<tr><td>{y}</td><td class="num">{fmt(p.living, 1)}</td><td class="num">{fmt(p.bundleR, 3)}</td><td class="num">{pc(bundleShareOfLiving(y), y > 10 ? 2 : 1)}</td><td class="num">{fmt(p.mindAvg, 2)}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
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
			People decide on values and goals, and Avens do the arithmetic and the work. No human labour is paid in theOS. A
			person's MIND comes from three places: the ownership their investing creates, the work items their Aven delivers,
			and the dividends of what they own (Section 10.4). Each person makes two choices:
		</p>
		<ol>
			<li>
				<strong>Where today's HEARTS go:</strong> for example, 12 to a fusion COOP and 12 to an art COOP. This choice
				decides which infrastructure people build or maintain next.
			</li>
			<li>
				<strong>The life one wants to draw on:</strong> a mix of MINDs, for example 40 % AGRImind, 30 % SOLARmind and
				30 % COMPUTEmind. Through the pools, the Aven trades the MINDs that its human holds into that mix.
			</li>
		</ol>
		<p>The Aven does the rest.</p>
		<ul>
			<li>
				<strong>Keeping money at work.</strong> Every currency melts at the same rate, so a trade from one into another
				cannot escape demurrage. But the Aven can keep idle balances small. It invests HEARTS as they arrive. It keeps
				as MIND what its human wants to own, and pays for daily life from a small float.
			</li>
			<li>
				<strong>Doing the work.</strong> The Aven proposes and delivers Aven work items to COOPs, with the COOPs'
				machines: running items and work proposals (Section 4). The COOP pays the Aven's human in its own MIND. Work
				proposals are open to every Aven, and they include care work and public work for the City COOP. Avens differ in
				what they deliver, so their humans' pay differs too (Section 9.3). This is how most MIND flows from the
				treasuries back to people, and how COOPs grow what they can make.
			</li>
			<li>
				<strong>Living from what one owns.</strong> Under Law 5, a share of every sale goes at once to everyone who
				holds the seller's MIND. Together with what a person holds, these dividends let a person live without working.
				At rest they are {share('dividends')} of an average person's income (Section 10.4). The Aven collects them and keeps them as ownership,
				or trades them through the pools into the MINDs that its human wants to own. Spreading its human's MIND over
				many COOPs also keeps the risk small (Section 9.3).
			</li>
			<li>
				<strong>Choosing a seller.</strong> For each purchase, the Aven compares the rival COOPs that sell the same good
				and buys where the price is lowest. It can switch every day.
			</li>
			<li>
				<strong>Choosing what to hold.</strong> We propose that the Aven keeps enough MIND of COOPs that sell a lot to
				cover its human's basics, and spreads the rest over many COOPs. It pays first with the MIND that earns its human
				the least. The Avens of the simulation do not do this yet (Section 10.6).
			</li>
			<li>
				<strong>Paying without thinking.</strong> When Anna takes a tram, her Aven finds the cheapest route through the
				pools of Section 6. The route goes from the MINDs she holds to the MIND that the tram COOP accepts. The Aven
				pays in the same moment. In the earlier static world of Section 10.3, once the pools had filled, such a payment
				cost about {pc(STATIC.routing, 2)}, of it {pc(STATIC.routingFees, 2)} in pool fees.
			</li>
			<li>
				<strong>Leaving a bad COOP.</strong> If a COOP becomes corrupt or wasteful, it delivers less for its MIND. Then
				its MIND falls in price against the other MINDs in the pools. The Aven sees that a HEART invested there now creates
				less utility, so it moves its human's investment and spending to a better COOP. Albert Hirschman named the two
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
		<h2><span>8</span>Building for the long term: land and energy</h2>
		<p>
			In capitalism, long-lived infrastructure is hard to finance, because every project competes with a safe
			alternative. That alternative is a government bond: a loan to the state that pays a fixed return for doing
			nothing. A 50-year tidal barrier must beat that return and also a risk premium, the extra return that investors
			want for a risk. Gesell and Keynes both saw this floor that a positive return on money puts under every investment
			<Cite k="gesell keynes36" />.
		</p>
		<p>
			In theOS, there is no safe alternative inside the city. HEARTS cannot be lent or parked; they can only be
			invested. Outside the city, euros remain a safe alternative for anyone who earns them (Section 12). Inside it, a
			project does not have to beat a bond. It only has to deliver something that people use. Idle HEARTS melt at
			{pc(RATE)} a year, and the MINDs that an investment creates melt at the same rate. So no balance earns a return just for being
			held. A MIND pays its holder only through its COOP's success: a share of its sales, or a higher price. Compare
			what is left after <Tex tex="T" /> years of the same intent: left idle, or built into a project whose utility
			changes at its real rate <Tex tex="g" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \text{idle: } e^{-rT}, \qquad \text{built: } e^{gT} \\ r = ${tn(RATE * 100)}\,\%,\ g = -1\,\%,\ T = 50 \\ \Rightarrow\; ${tn(decay(100, RATE, 50))}\,\% \text{ against } ${tn(decay(100, 0.01, 50))}\,\% \end{gathered} \tag{7}`} />
		<p>
			What lasts is what the investment built. But the melt does not make the far future worth more to an investor: the
			investor's MIND melts too, so a share of use in fifty years is worth less to its holder than a share of use today.
			What the melt changes is who gains. The later years of a long-lived project serve the people who hold its MIND
			then, the next generations. Nothing pays for sitting still, so the only way to make intent last is to build what
			people keep using: grids, water systems, domes, rail. In the earlier static world of Section 10.3, the MIND of a
			long-lived geothermal plant grew to {fmt(STATIC.geo.geo, 1)} times its start in 20 years, with its dividends and
			after the melt. The MIND of a solar COOP that lost the market kept {fmt(STATIC.geo.solar, 2)}. So building for the
			long term pays the city, and it pays investors when their COOP wins. Whether Avens fund such long projects as readily as short ones is a question for the test city (Section 12).
		</p>
		<figure>
			<LineChart
				title="1,000 HEARTS over 50 years, left idle or built into infrastructure"
				series={infra}
				x={{ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], fmt: (v, tip) => fmt(v), label: 'Left of 1,000: balance, or yearly use' }}
			/>
			<figcaption>
				<strong>Figure {FIG.infra}.</strong> The same 1,000 HEARTS, left idle under 7 % demurrage, or invested into
				infrastructure. For the idle HEARTS, the line shows the balance. For the projects, it shows the yearly use,
				which keeps its real value (0 %) or slowly wears (−1 %). After 50 years, the idle HEARTS keep
				{pct(decay(100, RATE, 50))}. The project that wears still delivers {pct(decay(100, 0.01, 50))} of the use of its
				first year.
			</figcaption>
		</figure>
		<h3>8.1 Land that nobody can sell</h3>
		<p>
			Melting money has one old weakness. Wealth flees into whatever does not melt, and the largest such store is land
			<Cite k="keynes36" />. If land could be bought, the success of every COOP would end up as a higher land
			price, and the owners of land would collect it without building anything. Henry George showed that this rent is
			value that the whole community creates <Cite k="george" />. theOS closes this door with one rule.
		</p>
		<div class="law">
			<p class="lawname">The land rule</p>
			<p>
				All land belongs to the City COOP. Every citizen holds one equal share in it. Nobody can sell or buy
				land or a share. Whoever wants to build, a person or a COOP, leases a plot and pays a yearly ground rent in MIND.
				The rent can be paid in any MIND; the pools convert it, and the City COOP receives its own CITYmind.
			</p>
		</div>
		<p>
			A lease works like the German <em>Erbbaurecht</em>, a heritable building right. It runs for a long, fixed term,
			and what the builder builds belongs to the builder for that term. When the term ends, the plot returns to the City
			COOP, and the lease can start again. The ground rent follows the value of the location. A plot near the tram and
			the market costs more than a plot at the edge, because the city around it makes it worth more. The City COOP
			sets the rent anew at fixed intervals, by auction or by the lessee's own published value, so that no lessee can
			keep the value of the land for itself.
		</p>
		<p>
			So the value that the city creates returns to the city. There is no separate commons beside the City COOP: what
			all citizens share, such as streets, parks and water, the City COOP holds and runs, and the ground rent pays for
			it. Every citizen's share is equal, comes with citizenship and ends with
			it. It is a membership, not money and not a MIND, so it does not bend Law 4, and nobody can collect land the way
			that people collect money. So land can no longer store
			private wealth, and the melt has no way around it.
		</p>
		<p>
			Land is one physical limit. Energy is the other, and it reaches every recipe.
		</p>
		<h3>8.2 Energy, the master resource</h3>
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
			So growth is paid in energy. The city serves basics, running costs and building first, and only what is left pays
			for research. Recipes improve by making more: by Wright's law, each doubling of all the output so far cuts the
			cost of a unit by a fixed share <Cite k="wright" />. They also improve by searching. Both stop at physical floors:
			about {pc(ENERGY.floors.sq)} of sunlight for one single-junction solar cell <Cite k="shockley" />, at most
			{pc(ENERGY.floors.photosynthesis, 1)} (C3 plants) to {pc(ENERGY.floors.photosynthesisC4)} (C4 plants) of sunlight
			into food <Cite k="zhu" />, and about {fmt(ENERGY.floors.steelMin, 1)} MWh for a tonne of steel from ore, the
			practical minimum. theOS aims for abundance that only physics limits: no growth cap, no price cap, and never a lack
			of MIND. Appendix H lists every limit.
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
			{decemberGap()} MWh. So in winter even the basics need stored energy or geothermal heat. Anna's lamp is a basic, so
			it comes first; building and research wait. When Mia's Aven proposes a better cell, the solar COOP can pay for the
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
			kW of primary energy a person <Cite k="smil" />. The comparison is rough, but energy will not limit a full
			village's basics. It limits how fast the village builds and learns.
		</p>
		<p>
			These are design numbers for the test city, the game of Section 11, and some are estimates. The simulation of
			Section 10 counts energy as an input to every recipe. It does not yet model the limits of Appendix H, net energy,
			or growth that surplus energy pays for. It still limits how fast each COOP can grow its plant in a year. And it
			assumes that each COOP's productivity grows about {pc(SIM.prodGrowth)} a year on average, unevenly. In the test
			city's world model, only surplus energy pays for growth (Section 11.1). Money cannot make a city richer: twice the
			HEARTS would only double prices in MIND, and the test city will check this.
		</p>
		<p>
			Long-lived COOPs need good management for decades. The last part of the machine is how they govern themselves,
			and how they compete.
		</p>
	</section>

	<section id="governance">
		<h2><span>9</span>Governance and competition</h2>
		<p>
			theOS sets no constitution for COOPs. Each COOP chooses its own way of deciding and can change it. COOPs that serve
			the same need compete on one open field. One rule holds for all of them:
		</p>
		<div class="law">
			<p class="lawname">The holder rule</p>
			<p>
				A COOP's own MIND in its own treasury, and every MIND in the pools, carries no vote and gets no dividend. Only
				MIND that people and other COOPs' treasuries hold can vote in a COOP and earn its dividend.
			</p>
		</div>
		<p>
			Without this rule, a treasury that holds half of all its COOP's MIND would hold half the votes for ever, and its
			managers would steer it. German company law takes all rights away from a company's own shares for the same reason (§ 71b AktG).
		</p>
		<p>
			Elinor Ostrom showed that the people who share a resource, such as a pasture or a fishery, can govern it well when
			the rules fit their place <Cite k="ostrom" />. Her principles concern shared resources that people govern outside
			markets, so they do not carry over one to one. But they suggest which rules to try first, and in theOS the
			competition between COOPs tests them. Three designs might share a sector. COOP A is capital-weighted: one token,
			one vote, so large holders steer. COOP B is a strict direct democracy: one person, one vote on every operational
			choice. COOP C mixes three tools. It uses quadratic voting on strategy: two votes on one question cost four
			credits, and three votes cost nine. So people can show how strongly they care, but the largest holder cannot
			decide everything <Cite k="qv" />. An AI executive runs daily operations. And prediction markets answer questions
			of fact: people bet on outcomes, so the prices show what is likely <Cite k="hanson" />.
		</p>
		<p>
			These designs live on the protocol layer of Law 3. On the legal layer, a German eG gives each member one vote, or at most
			three, so COOP A's rule fits only inside the protocol. Avens send each HEART where it creates the most utility. Let
			<Tex tex="s_i" /> be a COOP's share of its sector's investment, and <Tex tex="f_i" /> the utility that it delivers
			per HEART. Then the shares follow the equation of natural selection, known as replicator dynamics. Whatever does
			better than average grows, and whatever does worse shrinks, at a speed <Tex tex={String.raw`\kappa`} />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \dot s_i = \kappa\, s_i \left(f_i - \bar f\right) \\ \bar f = \textstyle\sum_j s_j f_j \end{gathered} \tag{8}`} />
		<p>
			In 1950, Alchian proposed this mechanism to explain why markets select efficient firms, even when no firm
			optimises <Cite k="alchian" />. Demurrage makes it stronger: a COOP that stops attracting investment watches its
			treasury melt. Below the level that its service needs, the COOP closes. Its physical assets go to the City COOP,
			which leases them to a COOP that runs them better. Ideas about markets that are designed on purpose, not inherited
			<Cite k="radical" />, become experiments here. One limit is built into (8): a COOP with no share stays at zero. So
			a new COOP needs its first HEARTS from its founders and friends, and Section 12 asks how to keep that door open
			without self-dealing. Law 3 is the way in: anyone can found a rival, and Section 9.1 shows when founders step in.
			Equation (8) also explains why leaders drift toward a monopoly.
		</p>
		<figure>
			<LineChart
				title="Share of a sector's investment for three COOPs with different governance, over ten years"
				series={sel}
				x={{ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Share of investment' }}
			/>
			<figcaption>
				<strong>Figure {FIG.selection}.</strong> An example of (8), not a forecast. A starts as the most efficient, but it slowly
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
			Every household good except water has two COOPs from the first day. In the simulation of Section 10.3, food comes
			from AGRI and GREEN, and energy from SOLAR and WIND. Water stays with the City COOP alone. Avens choose the seller
			for each purchase by price, and they can switch every day.
		</p>
		<p>
			Each COOP sets the price of what it makes, every day, in its own MIND. The price rises while the COOP is sold out.
			It falls while its machines stand idle or its stock grows. There is no cap, no price control and no protected
			price, not even for basics, and nobody imposes a floor. But each COOP's own price rule keeps its price above its
			cost. Its <em>variable cost</em> is what the inputs for one more unit cost. Law 5 takes {pc(DIVIDEND_SHARE)} of
			each sale, so the rule keeps the price above the variable cost divided by {fmt(1 - DIVIDEND_SHARE, 1)}. Below
			that, every sale drains the COOP's treasury. The rule goes lower only to clear stock that would rot.
		</p>
		<p>
			A COOP's price rule should step up and down by the same size. In an earlier version of the simulation, prices rose
			faster than they fell. Whenever demand hovered near capacity, prices ratcheted up: they climbed step by step and
			stayed up. Equal steps fixed it.
		</p>
		<p>
			High margins invite rivals. A product's <em>full cost</em> also counts the wear of its plant and its ground rent.
			Law 3 entry is always open. In the simulation, founders choose to act when the margin over full cost stays above
			{pc(SIM.foundingMargin)} for {SIM.foundingDays} days. A small COOP that lost its market exits. A COOP whose treasury stays dry while it keeps
			losing fails, and the City COOP leases its plant to a successor. In {SIM.years} years, {DYN.foundings} COOPs were
			founded, {DYN.exits} exited and {DYN.failures} failed: {FAILURE.coop}, the first food COOP, in year
			{FAILURE.year}. A rival was already selling food, so nobody went short. When food stays dear for months, Mia's Aven
			can propose a new food COOP. Anna's Aven then moves her food buying to it within days.
		</p>
		<p>
			Competition did not stay even. Each COOP's productivity grew at its own assumed rate, from
			−{pc(-SIM.prodRange[0], 1)} to {pc(SIM.prodRange[1])} a year. The COOP that pulled ahead sold cheaper, sold more, built more and pulled further ahead. By year
			{SIM.years}, one COOP made all the energy, all the housing and {pc(foodGood.y60)} of the food (Table
			{TAB.rivals}). Each of the {ENERGY_ENTRANTS.count} new energy COOPs exited within {ENERGY_ENTRANTS.years} years.
			Selection moved the market to the COOPs whose assumed productivity grew fastest. So output per unit of plant rose
			{fmt(DYN.outputPerPlant, 1)}-fold, about {pc(plantGrowthRate(), 1)} a year, against the {pc(SIM.prodGrowth)} that a
			COOP drew on average.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.rivals}.</strong> The largest seller's share of each good, and the COOPs founded and ended over {SIM.years} years, in the simulation of Section 10.3.</caption>
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
			Basics still got {pc(-DYN.bundleChange, 1)} cheaper a year at rest. But the simulated leaders price to clear their
			capacity, not for profit, and a real manager might not. Four things push back. Anyone can found a rival at any time
			(Law 3). Avens walk away from a dear seller. Law 5 pays {pc(DIVIDEND_SHARE)} of the leader's every sale to all who
			hold its MIND. And the City COOP leases an idle or failed plant to a second seller.
		</p>
		<p>
			The design must still do more, and we propose three rules. First, signal a founding when need goes unmet, or when
			a rival's audited cost is far below the price, not only on the leader's margin. The protocol flags it to every
			Aven, and the City COOP offers a plot and any idle plant. Law 3 entry itself is always open. Second, make what a work proposal
			improves open to rivals after a delay, so that they can imitate, as in the model of Dosi and others
			<Cite k="dosi" />. Third, keep at least two sellers of every basic. The test city measures who keeps the surplus
			with one, two and four sellers (Section 12.2).
		</p>
		<h3>9.2 The whole machine</h3>
		<p>
			All the pieces are now in place. Here are the five laws of Section 4 once more:
		</p>
		<ol class="laws">
			<li><strong>Universal Intent Allocation.</strong> Every human gets {UIA_DAY} personal HEARTS a day, one per hour, from birth to death: one stream per human.</li>
			<li><strong>Pure investment.</strong> HEARTS earn no interest. They buy nothing and pay for nothing. Their owner can only invest them.</li>
			<li><strong>Open cooperative creation.</strong> Anyone can found a COOP, at any time, without permission, from HEARTS and at least three partner COOPs.</li>
			<li><strong>Every COOP has its own MIND, created by investing HEARTS.</strong> One HEART converts into one MIND, half to the investor, half to the COOP's treasury as working capital.</li>
			<li><strong>Every sale pays its owners.</strong> A fixed share of every sale, by default {pc(DIVIDEND_SHARE)}, goes at once to everyone who holds the COOP's MIND, in proportion to what each one holds.</li>
		</ol>
		<p>
			On top of the laws, each part of the machine has a clear job. Table {TAB.parts} lists the parts. MIND is the one part that
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
					<tr><td>MIND</td><td>Ownership of a COOP and the means to use what it makes; people hold it as ownership and spend it to use, the COOP holds it as working capital</td><td>Every invested HEART, one for one: half to the investor, half to the COOP's treasury</td><td>Spent on what the COOP makes, and the seller always receives its own MIND; paid out again by COOPs for resources, services and Aven work items; a tenth of each treasury half into the pools; or melted</td></tr>
					<tr><td>Treasury</td><td>A COOP's working capital: its own MIND and other COOPs' MIND, never HEARTS</td><td>The COOP's half of each new MIND, and {pc(1 - DIVIDEND_SHARE)} of every sale</td><td>Inputs, building, ground rent and Aven work items; a reserve of about {SIM.reserveMonths} months; the rest paid out for work proposals; melt</td></tr>
					<tr><td>Dividends</td><td>Pay the owners of a COOP when it is useful (Law 5)</td><td>A fixed share of every sale, by default {pc(DIVIDEND_SHARE)}, at the moment of sale</td><td>Everyone who holds the seller's MIND, people and other COOPs' treasuries, in proportion to what each one holds; with what people hold, how they live without working</td></tr>
					<tr><td>Prices</td><td>Tell COOPs what to make and Avens where to buy</td><td>Each COOP, every day, in its own MIND: up when sold out, down when idle; no caps</td><td>Avens, which show them in R and in days of living (Section 6.3)</td></tr>
					<tr><td>Liquidity pools</td><td>Prices and trades between MINDs, and routes every payment into the seller's own MIND; owned by the protocol, not by a COOP</td><td>A tenth of every treasury half, automatically, in baskets of 4 to 8 MINDs</td><td>Never withdrawn; MIND leaves a pool only through trades, by melting, or when its COOP fails and its MIND is retired</td></tr>
					<tr><td>Demurrage</td><td>The only way money leaves: {pc(RATE)} a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's agent: invest, trade, pay, propose and deliver all work items with the COOPs' machines, collect dividends, leave</td><td>One per person</td><td>Work only for their human, who receives their pay; no human labour is paid</td></tr>
					<tr><td>City COOP</td><td>Holds all land and what all citizens share, and leases land; never sells it</td><td>The city: every citizen holds one equal share</td><td>Ground rent in MIND from every builder; pays for streets, parks and water</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; tested by selection</td><td>Chosen by each COOP</td><td>Tested by where people invest</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Section 5.2 gave the monetary policy that connects these parts: money is issued as HEARTS, converted into MINDs,
			circulated as MINDs, and melted. Figure {FIG.machine} shows the machine at work.
		</p>
		<figure class="wide">
		<Circulation />
		<figcaption>
				<strong>Figure {FIG.machine}.</strong> The whole machine, simulated. People on the outer ring invest their daily HEARTS
				(terracotta) into six COOPs. Each HEART converts into that COOP's MIND as it arrives, so the COOP
				never holds a HEART. Half returns to its investor (gold), and half sinks into the COOP's treasury, its working
				capital, whose ring grows and slowly melts. Every few seconds, one COOP becomes extractive: its MIND buys less utility, so
				the gold half that returns is worth less (a smaller dot). The Avens see that a HEART creates less utility there, and they send investment to the other COOPs without
				any vote.
			</figcaption>
		</figure>

		<h3>9.3 Who owns the machine: fair ownership, in numbers</h3>
		<p>
			Section 1 asked who gets what the machines make. Now we can answer with numbers. Let <Tex tex="W_i" /> be the MIND
			that person <Tex tex="i" /> owns, valued in a common basket of MINDs. Let <Tex tex="a" /> be what the person keeps
			each year: the ownership their investing creates, plus their Aven's pay, minus what they spend. Demurrage takes
			<Tex tex={String.raw`r\,W_i`} />, so a holding moves toward <Tex tex="a/r" />. A person who keeps the ownership
			their investing creates, and pays for daily life from their Aven's pay and their dividends, keeps
			<Tex tex="a = u/2" />. If everyone keeps the same amount each year, every holding moves toward the same resting
			level <Tex tex={String.raw`W^{*} = u/(2r) \approx ${tn(ownLevel())}`} /> MIND. Start with holdings as unequal as
			Germany's today, with a Gini index <Tex tex="G_0" /> and a mean <Tex tex="m_0" />. (The Gini index of Section 1 is
			0 if everyone has the same, and 1 if one person has everything.) Then the Gini index after <Tex tex="t" /> years is
		</p>
		<Tex display tex={String.raw`\begin{gathered} G(t) = \frac{G_0\, e^{-rt}\, m_0}{e^{-rt}\, m_0 + W^{*}\left(1 - e^{-rt}\right)} \\ m_0 = W^{*} \;\Rightarrow\; G(t) = G_0\, e^{-rt} \end{gathered} \tag{9}`} />
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
			keep, not at zero. No human labour is paid, so the spread of pay comes from how much each Aven delivers. The
			simulation of Section 10.3 shows how much this matters. In it, what an Aven delivers differs from Aven to Aven.
			The Gini index of what people hold was {fmt(DYN.giniOwned, 2)} at rest, against Germany's {fmt(GINI_DE, 2)}. It
			was still rising: {fmt(DYN.giniOwnedBy.y20, 2)} in year 20 and {fmt(DYN.giniOwnedBy.y60, 2)} in year {SIM.years}.
			People whose Avens earn more than the median hold {fmt(DYN.topBottom, 1)} times as much as the rest. In the
			earlier static world, these were {fmt(STATIC.giniOwned, 2)} and {fmt(STATIC.topBottom, 1)}. There, with all
			Avens alike the Gini index was {fmt(STATIC.avenEven, 2)}, and with Avens twice as unequal it was
			{fmt(STATIC.avenDouble, 2)}.
		</p>
		<p>
			Returns differ too, because people choose different COOPs. Let <Tex tex={String.raw`\sigma`} /> be the spread
			of returns between people's holdings. Let <Tex tex={String.raw`\mu`} /> be the lasting return on a holding: the
			dividend yield that its COOPs pay, plus any lasting rise of its price. Then each holding follows
			<Tex tex={String.raw`dW = \big(a - (r - \mu)\,W\big)\,dt + \sigma W\, dZ`} />, where <Tex tex="dZ" /> is
			random noise. This is the model of Bouchaud and Mézard for wealth <Cite k="bouchaud" />, with equal issuance in
			place of trade.
		</p>
		<p>
			<strong>Proposition 2.</strong> <em>If <Tex tex={String.raw`\mu < r`} />, the holdings settle into an
			inverse-gamma spread with shape <Tex tex={String.raw`\alpha = 1 + 2(r - \mu)/\sigma^2`} /> and mean
			<Tex tex={String.raw`a/(r - \mu)`} />. Its Gini index is (10). If any holder keeps
			<Tex tex={String.raw`\mu \ge r`} />, that holding grows without limit.</em>
		</p>
		<Tex display tex={String.raw`G_{\infty} = \frac{\Gamma\!\left(\alpha - \tfrac12\right)}{\sqrt{\pi}\;\Gamma(\alpha)} \tag{10}`} />
		<p>
			The stationary Fokker–Planck equation of this process has the inverse-gamma solution <Cite k="bouchaud" />, and
			its Lorenz curve gives (10). A simulation of the process agrees with (10) to within
			{fmt(SDE_CHECK.formula - SDE_CHECK.sim, 3)}. ∎ So inequality stays
			bounded if, and only if, demurrage is larger than the best lasting return on holdings. This is theOS's own form of
			Piketty's <Tex tex="r > g" />. Proposition 2 bounds the spread that returns create. Unequal Aven pay adds its own
			spread on top.
		</p>
		<p>
			Theory meets the simulation here, but only late in the run. At rest, the lasting return is
			<Tex tex={String.raw`\mu = ${tn(DYN.mu * 100, 1)}\,\%`} /> and its spread is
			<Tex tex={String.raw`\sigma = ${tn(DYN.sigma * 100, 1)}\,\%`} />. By (10), the resting Gini index is then
			{fmt(giniRest(DYN.sigma, RATE, DYN.mu), 2)}. What people hold is more unequal, {fmt(DYN.giniOwned, 2)}, because
			unequal Aven pay adds its own spread. Over the whole run, though, <Tex tex={String.raw`\mu`} /> averaged
			{pc(DYN.muRun, 1)}, at or above the melt in {DYN.muYearsAbove.years} of {DYN.muYearsAbove.of} years, while the city
			grew fast. So Proposition 2's condition held, on average, only in years {SIM.restFrom} to {SIM.years}. The simulation also shows the warning of Proposition 2. Of the
			{MIND_RETURNS.withThreeYears} MINDs that lived at least three years, {MIND_RETURNS.aboveMelt} returned more than the
			melt on average, and {MIND_RETURNS.aboveMeltEnded} of those then ended. One, ARTS, returned
			{pc(MIND_RETURNS.arts.compounded, 1)} a year for {MIND_RETURNS.arts.years} years. A person who held only ARTS would
			have grown without limit. Avens that spread what people own lower the average, but the simulation's Avens did not
			keep it below the melt in most years.
		</p>
		<p>
			Dividends are such a return. Under Law 5, a COOP's dividend yield is its share of every sale, times its yearly
			sales, divided by the MIND that others hold. With the same yield for everyone, the resting level rises to
			<Tex tex={String.raw`a/(r - \mu)`} />. Dividends also widen the spread. At a spread of returns of 20 %, a lasting
			return of {pct((RATE / 2) * 100, 1)} a year would raise the resting Gini index of (10) from
			{fmt(giniRest(0.2), 2)} to {fmt(giniRest(0.2, RATE, RATE / 2), 2)}. So Law 5 is safe only while the lasting return
			stays below the melt. At the default share of {pc(DIVIDEND_SHARE)}, the yield alone stays below the melt while
			yearly sales stay below {pc(salesBound())} of the MIND that others hold.
		</p>
		<p>
			Dividends make holding pay. In the simulation, people buy far more than basics. A year's sales are about
			{pc(impliedSales(), 1)} of the MIND that others hold, so the dividend yield is {pc(DYN.yield, 1)}, above the melt.
			So the yield alone breaks the simple bound. That bound assumes that prices and COOPs stay the same. What matters
			is <Tex tex={String.raw`\mu`} />: dividends plus price changes. At rest, MIND prices fell by
			{pc(-DYN.priceChange, 1)} a year in R, and the MIND of a COOP that ends is lost. So at rest
			<Tex tex={String.raw`\mu`} /> is {pc(DYN.mu, 1)}, below the {pc(RATE)} melt, with a thin margin of
			{fmt(meltMargin(), 1)} points. Over the whole run it was {pc(DYN.muRun, 1)}, above the melt.
		</p>
		<p>
			The price is slower levelling. A fortune spread over many MINDs, and not spent, shrinks only at the net rate
			<Tex tex={String.raw`r - \mu`} />. At the <Tex tex={String.raw`\mu`} /> of the rest, it halves in about
			{fmt(netHalfLife())} years, not {fmt(halfLife(), 1)}. While <Tex tex={String.raw`\mu`} /> stays above the melt, it
			does not halve at all. Law 5 trades levelling speed for a living from ownership.
		</p>
		<p>
			We tested three shares, one run each. A <em>person-day</em> is one person on one day. At
			{pc(DIVIDEND_SHARE)}, the yield is {pc(V('main').yield, 1)} and <Tex tex={String.raw`\mu`} />
			{pc(V('main').mu, 1)} at rest. All three parts of Proposition 3 pass, part 2 with its normal test (Section 10).
			At {pc(V('law35').share)},
			<Tex tex={String.raw`\mu`} /> rises to {pc(V('law35').mu, 1)}, {V('law35').failures} COOPs fail and basics run
			short on {pc(V('law35').shortfall, 2)} of person-days. At {pc(V('law50').share)}, <Tex tex={String.raw`\mu`} /> rises to
			{pc(V('law50').mu, 1)}, and food runs short. Of the three shares tested, only {pc(DIVIDEND_SHARE)} passed, and it
			kept <Tex tex={String.raw`\mu`} /> at rest at least a point below the melt. Lower shares are untested. The
			protocol's limit on the share should stay near {pc(DIVIDEND_SHARE)} until the test city has tried lower ones
			(Section 10.6). In the earlier static world, every want had a limit, people spent only {pc(STATIC.spent)} of their
			income, and the yield was only {pc(STATIC.yield, 1)}.
		</p>
		<p>
			Law 5 alone does not bring the MIND to people. The rest of every sale lands in the treasury. A treasury keeps
			reserves for {SIM.reserveMonths} months, grows its plant first, and pays out what it holds above that. At rest it
			pays {pc(treasuryShare('items'))} of what it keeps for running items and {pc(treasuryShare('proposals'))} for work
			proposals. The dividends never pass through it: each sale pays them at once. People hold {pc(DYN.people)} of all MIND by value,
			treasuries {pc(DYN.treasuries)} and the pools {pc(DYN.pools)}. People own the COOPs that hold those reserves. In
			year {SIM.years}, the lowest reserve was {RESERVES.minDays} days of running costs, and the median
			{RESERVES.medianDays}: about twice the {RESERVES.days} days of the target. One reason is that the target also
			covers planned building, which these days leave out. The target is a tuned number: with {V('res6').months} months, food ran short in year
			{V('res6').foodYear}, and with {V('res12').months} months in year {V('res12').foodYear} (Section 10.6). If treasuries keep their whole surplus, it melts there: in the earlier static
			world, people then held only {pc(STATIC.keepSurplus)}. So fair ownership needs one more rule for treasuries:
		</p>
		<div class="law">
			<p class="lawname">The payout rule (proposed)</p>
			<p>
				A treasury keeps a reserve of about {SIM.reserveMonths} months of running costs and planned building. It grows
				its own plant first, where it sells out or earns a margin. It pays out what it holds above the reserve, within
				weeks, for Aven work proposals that its members accept.
			</p>
		</div>
		<figure>
			<LineChart
				title="Ownership inequality over 100 years, from Germany's spread today"
				series={gin}
				x={{ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Years under theOS' }}
				y={{ min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => fmt(v, 2), label: 'Gini index of ownership' }}
			/>
			<figcaption>
				<strong>Figure {FIG.gini}.</strong> An illustration of (9) and (10), not a forecast. Everyone starts as unequal as
				Germany today. If everyone keeps the same amount each year and all holdings earn the same return, inequality
				halves every {fmt(halfLife(), 1)} years and goes to zero. If returns spread by 10 % or 20 % between people, it
				settles near {fmt(giniRest(0.1), 2)} or {fmt(giniRest(0.2), 2)}. Unequal Aven pay adds its own spread: in the
				simulation of Section 10.3, the Gini index of what people hold was {fmt(DYN.giniOwned, 2)} at rest, and still
				rising. In the
				earlier static world, holdings made as unequal as Germany's ({fmt(STATIC.germany[0], 2)}) fell to
				{fmt(STATIC.germany[1], 2)} in 10 years and to {fmt(STATIC.germany[2], 2)} in 20. Under capitalism it stays where
				it is.
			</figcaption>
		</figure>
		<p>
			So the level of fairness depends on how evenly income reaches people, and on two dials: the rate of demurrage,
			and how much people's returns spread. Avens
			that spread each person's MIND over many COOPs keep <Tex tex={String.raw`\sigma`} /> small. A basket of 8
			independent MINDs has about a third of the spread of one MIND. So diversification is part of fairness, not only a
			convenience. This matters more in a dynamic world. In the simulation, <Tex tex={String.raw`r - \mu`} /> was only
			about a point at rest, and below zero in most earlier years.
		</p>
		<figure>
			<LineChart
				title="Resting Gini index of ownership against the spread of returns, for three rates, and at 7 % with the dynamic world's dividends"
				series={dial}
				x={{ min: 0.05, max: 0.5, ticks: [0.1, 0.2, 0.3, 0.4, 0.5], fmt: (v, tip) => (tip ? `Spread ${fmt(v * 100)} %` : `${fmt(v * 100)} %`), label: 'Spread of returns between people (σ)' }}
				y={{ min: 0, max: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], fmt: (v) => fmt(v, 2), label: 'Resting Gini index' }}
				refs={[{ axis: 'y', at: GINI_DE, label: `Germany today: ${fmt(GINI_DE, 2)}` }, { axis: 'x', at: DYN.sigma, label: `σ simulated: ${fmt(DYN.sigma * 100, 1)} %` }]}
			/>
			<figcaption>
				<strong>Figure {FIG.dial}.</strong> The fairness dial, from (10). A higher rate of demurrage or a smaller spread of
				returns gives a fairer resting state. At {pc(RATE)} and a spread of 20 %, the Gini index is {fmt(giniRest(0.2), 2)}.
				If people hold one COOP each (a spread of about 40 %), it is {fmt(giniRest(0.4), 2)}, still below Germany's
				{fmt(GINI_DE, 2)} today. The dashed line adds the dynamic world's dividends,
				<Tex tex={String.raw`\mu = ${tn(DYN.mu * 100, 1)}\,\%`} />. There, a spread of {pc(DYN.sigma, 1)} gives
				{fmt(giniRest(DYN.sigma, RATE, DYN.mu), 2)}, but a spread of 20 % would give {fmt(giniRest(0.2, RATE, DYN.mu), 2)},
				near Germany's. This line uses the <Tex tex={String.raw`\mu`} /> of the rest. Over the whole run,
				<Tex tex={String.raw`\mu`} /> averaged {pc(DYN.muRun, 1)}, above the melt, and then (10) has no resting state.
			</figcaption>
		</figure>
		<p>
			Now we can say what <em>fair</em> means in theOS. It means three things. <strong>Equal issuance:</strong> every
			person gets the same flow of new ownership, {UIA_DAY} HEARTS a day, whatever their wealth, their Aven's pay or
			their birth. <strong>Self-direction:</strong> each person decides what their share builds. <strong>Bounded
			advantage:</strong> every holding melts, so any advantage from luck, skill, an Aven's output or inheritance fades
			unless the holder earns it again. Without dividends, it halves in {fmt(halfLife(), 1)} years. With the dividends
			of the simulation's rest, it halves in about {fmt(netHalfLife())}, and while <Tex tex={String.raw`\mu`} /> stays
			above the melt, not at all. Fair participation follows from fair ownership: every person
			owns and steers the automated economy in equal measure of issuance.
		</p>
		<p>
			theOS does not promise equal outcomes. People who use more own less. People whose Avens serve others well earn
			more. People who choose better COOPs hold more. theOS promises that no difference grows without limit while the
			lasting return <Tex tex={String.raw`\mu`} /> stays below the melt, and that then nobody inherits a difference for
			long. In the simulation, this held only at rest, as shown above. In Rawls's terms, theOS is a property-owning democracy whose "beginning of
			each period" is every day <Cite k="rawls" />.
		</p>
	</section>


	<p class="partline" id="part-3">Part III · Toward Abundism</p>

	<section id="living">
		<h2><span>10</span>The central result: no one starves, no one has to work, living standards rise</h2>
		<p>
			Does every person in Abundism live well? That question decides whether it is worth building. An average can rise
			while one person goes hungry. So parts 1 and 2 below check every person at every step of the simulation, not
			averages. Part 3 checks every tenth of the people.
		</p>
		<h3>10.1 Proposition 3</h3>
		<p>
			Four terms come first. The <em>basic bundle</em> (Section 6.3) is one day of basics for one person. An
			<em>owner-only person</em> is a person whose Aven delivers nothing and who starts with nothing. <em>Real
			consumption</em> counts every unit that a person consumes, valued at the prices of day 1, so it counts amounts,
			not price changes. Prices fell sharply in year 1, so real consumption is not comparable with a day of living. A
			<em>tenth of the people</em>, or decile, is one of ten equal groups when we sort the people by real consumption
			each year.
		</p>
		<div class="law prop">
			<p class="lawname">Proposition 3 · No one starves, no one has to work, living standards rise</p>
			<p>
				<em>Take a city that follows the five laws, the melt, the land rule and the payout rule, and that meets the
				conditions C1 to C5 below. Then, after the bootstrap, parts 1 and 2 hold for every person on every day, and part
				3 holds for every tenth of the people:</em>
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
			We call part 2 the <em>normal test</em>. We also check a stronger target, which the proposition does not claim:
			the <em>strict test</em>, in which dividends alone pay for the basic bundle. Part 3 is the weakest part. It
			compares ten-year marks (years 10, 20 and so on). A test over every ten-year or five-year window fails in the
			simulation (Section 10.5).
		</p>
		<p>The five conditions are these:</p>
		<ul>
			<li>
				<strong>C1 Enough output that grows fast enough.</strong> Plants, land and net energy cover the basics, and output
				per person grows (Section 8.2). How fast is enough for part 3 is open (Section 10.2). In the simulation, each COOP's productivity grows about {pc(SIM.prodGrowth)} a year
				on average, and selection made output per unit of plant grow about {pc(plantGrowthRate(), 1)} a year (Section 9.1).
			</li>
			<li>
				<strong>C2 Competition.</strong> Two or more sellers of every basic, prices that move freely both ways, and Law
				3 entry that is always open (Section 9.1).
			</li>
			<li>
				<strong>C3 The bootstrap.</strong> Residents invest their HEARTS for a founding week before the first sale. A
				tenth of each treasury half fills the pools, so every MIND can trade on opening day. Each person's first
				investment makes them a part-owner of the basics COOPs (Section 12.4). Euros fund only machines, never MIND.
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
			The simulation of Section 10.3 meets C5. It meets C1 only by assumption: its productivity growth is assumed, and
			net energy is not modelled. It meets C2 only in part: water has one seller throughout, and by
			year {SIM.years} one COOP makes all the energy and all the housing. It does not model C3 or C4 yet, so its checks
			start on day {PROOF.fromDay}.
		</p>
		<p>
			HEARTS pay for none of this. A HEART only makes its owner an owner. What a person spends is their ownership, used.
			Proposition 3 is a claim with an argument and with evidence from a simulation, not a theorem. The normal and strict
			tests have closed forms, given in Section 10.2. Parts 1 and 3 have none, so the simulation and, later, the test
			city must check them.
		</p>
		<h3>10.2 Why it can hold</h3>
		<p>
			Part 2 rests on margins that we can compute. Take the normal test first. Let <Tex tex="W_i" /> be what person
			<Tex tex="i" /> holds, in R, and let <Tex tex="X_i" /> be what they spend. Let <Tex tex={String.raw`\omega`} /> be
			the ownership that their investing creates for them, and <Tex tex="D_i" /> their dividends. Let
			<Tex tex="p_b" /> be the cost of a day's basic bundle. With all flows counted a year,
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dW_i}{dt} = \omega + D_i - r\,W_i - X_i \\ 365\,p_b < \omega + D_i \;\Rightarrow\; W_i(t) > 0 \\ T_i = \frac{1}{r}\,\ln\!\Big(1 + \frac{r\,W_i}{365\,p_b}\Big) \end{gathered} \tag{${EQ.normal}}`} />
		<p>
			In words: a holding grows while what flows in, new ownership and dividends, exceeds the melt and the spending. The
			normal test asks only that the holding never runs out while it pays for the basics. The second line is the
			condition that carries it. A holding cannot run out while the ownership that a year of investing creates,
			<Tex tex={String.raw`\omega`} />, plus the dividends, exceeds a year of basics. In the main run, a day's basics cost
			at most {fmt(PROOF.bundleMindMax, 3)} MIND (year {PROOF.bundleMindMaxYear}). A day of investing creates
			{UIA_DAY / 2} MIND for the investor, so the margin was about ×{fmt(bundleMargin())}. Where this margin collapsed,
			owner-only people went short: ×{fmt(bundleMargin(V('law35').bundleMax), 1)} with Law 5 at {pc(V('law35').share)},
			×{fmt(bundleMargin(V('prod0').bundleMax), 1)} without productivity growth,
			×{fmt(bundleMargin(V('aven').bundleMax), 1)} with fixed Aven capacity. In the other variations that failed, the basics themselves ran short (part 1).
			<Tex tex="T_i" /> measures the buffer: how many years a holding <Tex tex="W_i" /> would pay a day's basics with
			nothing flowing in at all, the melt included. In the simulation, the lowest holding of any owner-only person, from year 2 on, was
			{fmt(PROOF.normal.lowestHolding)} R. With no dividends and no new ownership, it alone would have paid that year's
			basic bundle for about {fmt(holdingCoverYears())} years. In fact it never came close to running out (Table
			{TAB.prop3}). Equation ({EQ.normal}) leaves out price moves: when a MIND that a person holds falls in price, so
			does the holding. The simulation includes them. Their HEARTS buy nothing: what they spend is MIND that they own.
		</p>
		<p>
			The strict test asks more: dividends alone. Law 5 pays each holder in proportion to what they hold. Let
			<Tex tex={String.raw`\lambda`} /> be Law 5's share, <Tex tex="Y" /> what people buy from COOPs (R a person a day)
			and <Tex tex={String.raw`\bar W`} /> the mean holding. Then the city's dividend yield is
			<Tex tex={String.raw`\bar\eta = \lambda Y / \bar W`} />, and
		</p>
		<Tex display tex={String.raw`\begin{gathered} D_i \approx \bar\eta\, W_i = \lambda\,Y\,\frac{W_i}{\bar W} \\ D_i \ge p_b \iff \frac{W_i}{\bar W} \ge \frac{p_b}{\lambda\,Y} \end{gathered} \tag{${EQ.strict}}`} />
		<p>
			At rest, the right side is {pc(strictThreshold(), 2)} of the mean holding. So an owner with an average mix of MIND
			passes by far. A miss comes from which MIND a person holds, not from how much (C4). The strict test also needs
			sales beyond the basics. If people bought only basics, their dividends would be just {pc(DIVIDEND_SHARE)} of their
			cost. Abundance must be sold and used, not only made.
		</p>
		<p>
			Law 5 also hedges the basics. When food gets dear, those who hold food MIND get more dividends. Ownership lifts
			what each person can pay, with no cap on any price.
		</p>
		<p>
			Part 1 needs capacity at or above need, with some stock in hand. It needs buyers who can pay, which part 2 gives.
			It needs two or more sellers of each basic (C2) and, on day 1, the bootstrap (C3). A seller with idle capacity
			lowers its price, and a rival takes the buyers it loses. MIND must never be what runs short while physics allows
			more.
		</p>
		<p>
			Part 3 needs output per person to grow fast enough (C1), and wants that grow with it (C5). The poorest tenth gain
			through two channels. Every person gets the same new ownership each day, {UIA_DAY / 2} MIND. And competition
			passes productivity on as lower MIND prices: a day's basics cost {fmt(PRICES_BY_YEAR[1].bundleMind, 3)} MIND in
			year 1 and {fmt(PRICES_BY_YEAR[60].bundleMind, 3)} in year {SIM.years}. So the same daily ownership buys more each
			year. How fast is enough is open. The run with even growth, {pc(SIM.prodGrowth)} for every COOP, meets C1 to C5 as
			stated, and part 3 still fails there. Its output per unit of plant grew
			{pc(plantGrowthRate(V('even').plant), 1)} a year, against {pc(plantGrowthRate(), 1)} in the main run. Part 3 has
			no closed form, and the simulation tests it.
		</p>
		<h3>10.3 The simulation</h3>
		<p>
			An <em>agent-based</em> simulation lets every person and every COOP act by its own rules, day by day, and then
			adds up what happens. Ours plays the rules of this paper in one city (Appendix G):
		</p>
		<ul>
			<li>{SIM.people} people over {SIM.years} years, on one <em>seed</em>: one fixed set of random events. Daily steps in year 1, weekly steps after; each week counts as seven person-days.</li>
			<li>
				On day 1 the plants can make {pc(SIM.seedCapacity)} of the first needs, but nobody holds MIND yet. Every tenth
				person is owner-only.
			</li>
			<li>{SIM.goods} goods. Experiences never satisfy fully.</li>
			<li>
				Two rival COOPs for each household good except water, free prices, reserves of {SIM.reserveMonths} months,
				and Law 5 at {pc(SIM.lawShare)}.
			</li>
			<li>
				Each COOP's productivity rises at its own rate, about {pc(SIM.prodGrowth)} a year on average. This is an
				assumption (Section 8.2). The COOPs that grew fastest won their markets. So output per unit of plant rose about
				{pc(plantGrowthRate(), 1)} a year, and mean real consumption about {pc(growthRate('mean'), 1)} a year, with no
				energy limit.
			</li>
			<li>
				{SIM.shocks} capacity shocks of {pc(SIM.shockDepth[0])} to {pc(SIM.shockDepth[1])}, for {SIM.shockMonths[0]} to
				{SIM.shockMonths[1]} months, and tastes that drift.
			</li>
			<li>COOPs are founded, exit and fail.</li>
			<li>People spend about half of what they hold a year, basics first.</li>
			<li>Every human has one Aven, and no human labour is paid.</li>
		</ul>
		<p>
			The <em>main run</em> is the run with these default settings. It is the evidence of Sections 10.4 and 10.5.
		</p>
		<p>
			An earlier static world ran under the same laws, with simpler markets. It had one COOP per good (two for food),
			fixed tastes and no growth. Its prices were capped at twice their full cost, which theOS does not allow, and its
			reserves were short. That cap is one reason why we replaced it. We now use the dynamic world. "Static" marks every
			number in this paper that still comes from the earlier one. Table {TAB.twoWorlds} compares the two.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.twoWorlds}.</strong> Two worlds, at rest (years {SIM.restFrom} to {SIM.years}) unless the row says otherwise: the dynamic world that this paper uses, and the earlier static one.</caption>
				<thead>
					<tr><th>Measure</th><th class="num">Dynamic</th><th class="num">Static</th></tr>
				</thead>
				<tbody>
					<tr><td>A day of living, R: year 1 / year {SIM.years}</td><td class="num">{fmt(DYN.dayLiving.y1, 1)} / {fmt(DYN.dayLiving.y60, 1)}</td><td class="num">{fmt(STATIC.dayLiving.y1, 1)} / {fmt(STATIC.dayLiving.y60, 1)}</td></tr>
					<tr><td>Income a person a day, R</td><td class="num">{fmt(DYN.income, 1)}</td><td class="num">{fmt(STATIC.income, 1)}</td></tr>
					<tr><td>Share of income spent / melting in wallets</td><td class="num">{pc(DYN.spent)} / {pc(DYN.walletMelt)}</td><td class="num">{pc(STATIC.spent)} / {pc(STATIC.walletMelt)}</td></tr>
					<tr><td>Share of all MIND: people / treasuries / pools</td><td class="num">{fmt(DYN.people * 100)} / {fmt(DYN.treasuries * 100)} / {pc(DYN.pools)}</td><td class="num">{fmt(STATIC.people * 100)} / {fmt(STATIC.treasuries * 100)} / {pc(STATIC.pools)}</td></tr>
					<tr><td>Dividend yield a year</td><td class="num">{pc(DYN.yield, 1)}</td><td class="num">{pc(STATIC.yield, 1)}</td></tr>
					<tr><td>Lasting return <Tex tex={String.raw`\mu`} />; whole run</td><td class="num">{pc(DYN.mu, 1)}; {pc(DYN.muRun, 1)}</td><td class="num">{pc(STATIC.mu, 1)}</td></tr>
					<tr><td>Gini index of what people hold</td><td class="num">{fmt(DYN.giniOwned, 2)}</td><td class="num">{fmt(STATIC.giniOwned, 2)}</td></tr>
					<tr><td>MIND prices, R</td><td class="num">{fmt(DYN.pricesMin, 2)}–{fmt(DYN.pricesMax, 2)}</td><td class="num">{fmt(STATIC.pricesMin, 2)}–{fmt(STATIC.pricesMax, 2)}</td></tr>
					<tr><td>COOP failures / exits / foundings, whole run</td><td class="num">{DYN.failures} / {DYN.exits} / {DYN.foundings}</td><td class="num">{STATIC.failures} / {STATIC.exits} / {STATIC.foundings}</td></tr>
					<tr><td>MINDs alive at the end</td><td class="num">{DYN.mindsAlive}</td><td class="num">{STATIC.mindsAlive}</td></tr>
				</tbody>
			</table>
		</div>
		<h3>10.4 Where MIND goes: the cycle and the round trip</h3>
		<p>
			The MIND that COOPs pay out comes back to them through what they sell. At rest, people spend {pc(DYN.spent)} of
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
				only the rest reaches the treasury. The gold coins are MIND, and the widths show the simulation's rest. The buttons
				switch to the earlier static world, where people spent {pc(STATIC.spent)} and {pc(STATIC.walletMelt)}
				melted.
			</figcaption>
		</figure>
		<p>
			A person's MIND comes from three places. The ownership their investing creates gives {share('own')} of their
			income. The work items their Aven delivers give {pc(incomeShare('items') + incomeShare('proposals'))}: running
			items {share('items')} and work proposals {share('proposals')}. The dividends of what they own give
			{share('dividends')}. There is no wage for human labour.
		</p>
		<p>
			Table {TAB.roundTrip} follows every MIND around the round trip, at rest in years {SIM.restFrom} to {SIM.years}. The
			unit is R (Section 6.3). When prices move, so does the value of what each place holds. Godley and Lavoie call this
			revaluation <Cite k="godley" />. With it, every place balances to within {pc(RT.unexplainedMax, 2)} of its
			inflow.
		</p>
		<div class="table-wrap">
			<table class="flows">
				<caption>
					<strong>Table {TAB.roundTrip}.</strong> The round trip at rest, in R a person a day. In each place, the net
					flow plus the price moves equals the change of what that place holds, to within {pc(RT.unexplainedMax, 2)}
					of its inflow. All values are rounded to 0.01 R. The Law 5 share goes from each sale straight to the holders, so
					it never passes through a treasury.
				</caption>
				<thead>
					<tr><th>Flow</th><th>R a day</th></tr>
				</thead>
				<tbody>
					<tr><th colspan="2" scope="colgroup">People's wallets</th></tr>
					<tr><td>The ownership their investing creates (their half of the new MIND)</td><td>{sg(RT.people.in.own)}</td></tr>
					<tr><td>Aven work items: running items</td><td>{sg(RT.people.in.items)}</td></tr>
					<tr><td>Aven work items: work proposals</td><td>{sg(RT.people.in.proposals)}</td></tr>
					<tr><td>Law 5 dividends, paid at each sale</td><td>{sg(RT.people.in.dividends)}</td></tr>
					<tr><td>Buying from COOPs</td><td>{sg(-RT.people.out.buying)}</td></tr>
					<tr><td>Melt</td><td>{sg(-RT.people.out.melt)}</td></tr>
					<tr><td>Retired with a COOP that ended</td><td>{sg(-RT.people.out.retired)}</td></tr>
					<tr class="net"><td>Net flow</td><td>{sg(RT.people.net)}</td></tr>
					<tr><td>Price moves</td><td>{sg(RT.people.moves)}</td></tr>
					<tr><td>Not explained (routing, timing)</td><td>{sg(RT.people.rest)}</td></tr>
					<tr class="net"><td>Change of what people hold</td><td>{sg(RT.people.change)}</td></tr>
					<tr><th colspan="2" scope="colgroup">COOP treasuries</th></tr>
					<tr><td>The COOP's half of the new MIND, less the tenth for the pools</td><td>{sg(RT.treasuries.in.own)}</td></tr>
					<tr><td>Sales to people, after the Law 5 share</td><td>{sg(salesAfterLaw5())}</td></tr>
					<tr><td>Aven work items: running items</td><td>{sg(-RT.treasuries.out.items)}</td></tr>
					<tr><td>Aven work items: work proposals</td><td>{sg(-RT.treasuries.out.proposals)}</td></tr>
					<tr><td>Melt</td><td>{sg(-RT.treasuries.out.melt)}</td></tr>
					<tr class="net"><td>Net flow</td><td>{sg(RT.treasuries.net)}</td></tr>
					<tr><td>Price moves</td><td>{sg(RT.treasuries.moves)}</td></tr>
					<tr><td>Not explained (routing, timing)</td><td>{sg(RT.treasuries.rest)}</td></tr>
					<tr class="net"><td>Change of what treasuries hold</td><td>{sg(RT.treasuries.change)}</td></tr>
					<tr><th colspan="2" scope="colgroup">Pools</th></tr>
					<tr><td>The tenth of the COOP's half</td><td>{sg(RT.pools.in.tenth)}</td></tr>
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
			({fmt(RT.between.sales, 2)} R) and ground rent to the City COOP ({fmt(RT.between.rent, 2)} R). The macro checks,
			each marked as met or not:
		</p>
		<ul>
			<li>
				<strong>The books close: met.</strong> What flows and price moves do not explain is at most
				{pc(RT.unexplainedMax, 2)} of a place's inflow.
			</li>
			<li>
				<strong>New money equals the melt: not yet.</strong> Money per person is {fmt(DYN.money)} MIND,
				{pc(-moneyGap(), 1)} below <Tex tex={String.raw`u/r = ${tn(steadyState())}`} />, and still filling. At that
				level, (3) predicts growth of {fmt(stockGrowthDay(), 2)} MIND a person a day. The simulation shows
				{fmt(RT.stockGrowth, 2)}, plus {fmt(RT.retiredMind, 2)} that left with COOPs that ended. New MIND
				({fmt(RT.issuedMind, 2)} a day) still exceeds the melt ({fmt(RT.meltedMind, 2)}). Money is still approaching
				<Tex tex="u/r" />; it does not leak.
			</li>
			<li>
				<strong>COOPs stay solvent: not met.</strong> Treasuries were short of working capital on
				{fmt(DYN.coopDaysShort)} COOP-days in {SIM.years} years ({fmt(DYN.coopDaysShortAfter10)} after year 10),
				against {STATIC.coopDaysShort} in the static world. Still, after each of the {DYN.failures + DYN.exits} ends,
				nobody went short of basics.
			</li>
			<li>
				<strong>Basics get cheaper: met.</strong> At rest, a day's basics cost {pc(-DYN.bundleChange, 1)} less in R
				each year, as productivity rises.
			</li>
			<li>
				<strong>People own the economy: not met.</strong> They hold {pc(DYN.people)} of all MIND by value, against
				{pc(STATIC.people)} in the static world. Treasuries hold {pc(DYN.treasuries)} as reserves, and people own those
				COOPs.
			</li>
			<li>
				<strong>Holding does not beat the melt: met at rest only.</strong> At rest, the lasting return
				<Tex tex={String.raw`\mu`} /> is {pc(DYN.mu, 1)}, below the {pc(RATE)} melt. Over the whole run it averaged
				{pc(DYN.muRun, 1)} (Section 9.3).
			</li>
		</ul>
		<h3>10.5 The evidence, person by person and day by day</h3>
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
					<tr><td>1. No one starves</td><td>Every person-day from day {PROOF.fromDay}</td><td>{PROOF.short} of {fmt(PROOF.personDays)} below {pc(BASIC_BUNDLE.tolerance)}; the worst person-day had {pc(PROOF.worst)}</td></tr>
					<tr><td>1, after shocks</td><td>The {SIM.shockAfterDays} days after each of {PROOF.shocks} shocks</td><td>{PROOF.shockShort} of {fmt(PROOF.shockPersonDays)} short; the worst had {pc(PROOF.shockWorst)}</td></tr>
					<tr><td>1, after ends</td><td>The {SIM.endAfterDays} days after {PROOF.failures} failure and {PROOF.exits} exits</td><td>{PROOF.endedShort} of {fmt(PROOF.endedPersonDays)} short; the worst had {pc(PROOF.endedWorst)}</td></tr>
					<tr><td>2. Normal test</td><td>Every owner-only person, every day from day {PROOF.fromDay}</td><td>Always covered; the lowest holding was {fmt(PROOF.normal.lowestHolding)} R in year {PROOF.normal.lowestYear}, about {fmt(holdingLivingDays())} days of living, or {fmt(holdingCoverYears())} years of basics with nothing flowing in</td></tr>
					<tr><td>Strict test (not claimed)</td><td>Dividends alone, for every owner-only person</td><td>Missed on {pc(1 - strictEarly.share)} of their person-days in year {strictEarly.year}, and on up to {pc(1 - strictLater.share)} in a later year until year {PROOF.strict.lastShortYear} (year {strictLater.year}); after year 10, on {pc(1 - PROOF.strict.shareAfter10, 2)}, all in years {PROOF.strict.lateMissYears.join(' and ')}; in year {SIM.years}, the worst day paid {fmt(PROOF.strict.endRatio, 2)} times the bundle</td></tr>
					<tr><td>3. Living standards rise</td><td>Real consumption of every tenth, at every ten-year mark</td><td>Higher at every ten-year mark, but not over every ten-year window: those that start in years {falls[0][0]} to {falls.at(-1)[0]} end lower for the poorest tenth. Poorest {fmt(DECILES.d1[0], 1)} → {fmt(DECILES.d1.at(-1), 1)} R a day (×{fmt(growth('d1'))}); middle ×{fmt(growth('d5'))}; richest ×{fmt(growth('d10'))}</td></tr>
				</tbody>
			</table>
		</div>
		<figure>
			<LineChart
				title={`Real consumption a person a day, at the prices of day 1, for the poorest, the middle and the richest tenth, years 1 to ${SIM.years}`}
				series={living}
				x={{ min: 1, max: SIM.years, ticks: [1, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Year' }}
				y={{ min: 10, max: 10_000, log: true, ticks: [10, 100, 1_000, 10_000], fmt: (v, tip) => (tip ? `${fmt(v, 1)} R` : v >= 10_000 ? `${fmt(v / 1000)}k` : fmt(v)), label: 'R a day, day-1 prices (log)' }}
				refs={[{ axis: 'x', at: FAILURE.year, label: 'first food COOP fails' }]}
			/>
			<figcaption>
				<strong>Figure {FIG.deciles}.</strong> Real consumption at the prices of day 1, on a log scale, where each step
				up is ten times as much. Every tenth is higher at every ten-year mark. None of the three tenths shown falls in
				year {FAILURE.year}, when the first food COOP fails. The poorest tenth are exactly the {OWNER_ONLY.count} owner-only people. Their
				dip from year {dip.from} to {dip.to} is an open point of Section 10.6.
			</figcaption>
		</figure>
		<p>
			Every tenth gains, but not alike. The Gini index of consumption grew from {fmt(DECILES.gini[0], 2)} to
			{fmt(DECILES.gini.at(-1), 2)}, because Avens that deliver more earn more. We checked part 3 at ten-year marks.
			Over shorter or shifted windows it fails. The poorest tenth had {fmt(livingAt('d1', 50), 1)} R a day in year 50,
			against {fmt(livingAt('d1', 45), 1)} in year 45. Every ten-year window that starts in years {falls[0][0]} to
			{falls.at(-1)[0]} ends lower than it starts.
		</p>
		<h3>10.6 What fails, and the fix</h3>
		<p>
			The main run passes parts 1 and 3, and part 2 with its normal test. It also shows where they are thin. For each
			weak point we propose a fix, but none is tested yet.
		</p>
		<ul>
			<li>
				<strong>The genesis week.</strong> In days 1 to {PROOF.genesis.days}, nobody holds MIND yet and the pools are
				empty. Of {fmt(PROOF.genesis.personDays)} person-days, {PROOF.genesis.short} were short, and the worst had
				{pc(PROOF.genesis.worst)} of the basics, on day 1. In the earlier static world, {pc(STATIC.coldStart.day1, 1)}
				of people went short on day 1, and {pc(STATIC.coldStart.year1, 1)} of person-days over year 1. Fix (proposed):
				the bootstrap (C3, Section 12.4). The simulation does not test it yet.
			</li>
			<li>
				<strong>Dividends alone.</strong> The proposition does not claim them, but they show how thin the margin is. In
				year {strictEarly.year}, they missed on {pc(1 - strictEarly.share)} of the owner-only person-days. Until year
				{PROOF.strict.lastShortYear}, they still missed on up to {pc(1 - strictLater.share)} in a year (year
				{strictLater.year}). After year 10, they missed on {pc(1 - PROOF.strict.shareAfter10, 2)} of
				those days, all in years {PROOF.strict.lateMissYears.join(' and ')}. The worst day paid
				{fmt(PROOF.strict.worst, 2)} times the bundle, in year {PROOF.strict.worstYear}, and in year {SIM.years} the worst
				day paid only {fmt(PROOF.strict.endRatio, 2)} times. So the owner-only people lived mainly from the ownership that
				their investing creates each day. Their dividends were about {pc(ownerOnlyDividendShare(40))} of what flowed in to
				them in year 40, but only {pc(ownerOnlyDividendShare(60), 1)} in year {SIM.years}, if we value their new
				ownership at the average MIND price. The cause: Law 5 pays only on sales. CITYmind made up {pc(OWNER_ONLY.mix.CITY.share)} of what
				the group held, and it pays almost nothing, because ground rent is not a sale and the City COOP sells little
				water. The group also spent its experience MIND, which paid the most, and kept what paid least. Its yield was
				{pc(ownerOnlyYield(), 1)}, against the city's {pc(DYN.yield, 1)}. Fix (proposed): C4, the Aven's holding mix. No
				rule changes, and ground rent stays with the City COOP.
			</li>
			<li>
				<strong>The poorest tenth's dip.</strong> Their real consumption fell {pc(-dip.fall)} from year {dip.from} to
				{dip.to}. Their holdings fell from {fmt(OWNER_ONLY.holding40)} R in year 40 to {fmt(OWNER_ONLY.holding60)} R in
				year {SIM.years}. The likely cause is that the dividends on what they held fell, and a run that tracks this must
				confirm it. Fix (proposed): the same as for dividends alone. The test city checks every window, not only
				ten-year marks.
			</li>
			<li>
				<strong>Food is the weak point.</strong> Food rots in the simulation. In the real city, a food forest also takes
				{ENERGY.forest.fullYear} years to reach full yield (Section 8.2). Food ran short in {foodShort()} of the
				{LADDER.length - 1} variations, and in {foodOnlyShort()} of them it was the only basic short in the worst years.
				Fix (proposed): keep {ENERGY.foodStockDays} days of food in hand, and let prices read the coming harvest. Keep two
				or more food COOPs at all times, and prompt a Law 3 founding when food need goes unmet. The City COOP leases a
				failed food plant at once. These are stock rules and founding signals, never a protected price.
			</li>
			<li>
				<strong>Near-monopolies.</strong> By year {SIM.years}, one COOP made almost all of most goods (Section 9.1). The
				evidence does not yet test C2 against a leader that prices for profit. Fix (proposed): the three rules of
				Section 9.1.
			</li>
			<li>
				<strong>The lasting return near the melt.</strong> <Tex tex={String.raw`\mu`} /> was {pc(DYN.mu, 1)} at rest in
				the main run, but {pc(DYN.muRun, 1)} over the whole run. At rest, {variationsMuAbove()} of the
				{LADDER.length - 1} variations reached {pc(RATE)} or more. Fix (proposed): keep Law 5 near
				{pc(DIVIDEND_SHARE)}, within the protocol's limit on the share (Appendix F), and let Avens spread holdings (C4).
				The test city must show that <Tex tex={String.raw`\mu`} /> stays below the melt over a whole run.
			</li>
			<li>
				<strong>Newcomers.</strong> When the population grows, newcomers start with nothing, and some went short in their
				first weeks. Owner-only people went short too, with {pc(V('pop').ownerWorst)} of the basics on the worst day. The
				poorest of them consumed {fmt(V('pop').poorOwner[0], 1)} R a day in year 10 and {fmt(V('pop').poorOwner[1], 1)}
				in year 20. Fix (proposed): the same bootstrap as day 1, for every newcomer.
			</li>
		</ul>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.variations}.</strong> The main run and ten variations, one run each. Checks: 1 no one starves, 2 no one has to work (normal test), 3 living standards rise. The strict test failed in every run.</caption>
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
			Only the main run, one of {LADDER.length}, passes all three checks, and all of it rests on one seed. In
			{starveFail()} of the {LADDER.length - 1} variations, someone ran short of basics. Three lessons follow. Of the
			three shares tested for Law 5, only {pc(DIVIDEND_SHARE)} passed; lower shares are untested. {SIM.reserveMonths}
			months is the reserve that passed. And growth must come from somewhere. Without productivity growth, food ran short in {V('prod0').shortYears} of
			the {SIM.years} years, on up to {pc(V('prod0').worstYearShare)} of person-days (year {V('prod0').worstYear}),
			owner-only people included. With {pc(SIM.prodGrowth)} for every COOP, output per unit of plant grew only
			{pc(plantGrowthRate(V('even').plant), 1)} a year, and the poorest tenth fell from year 30 to year 50. Without a
			good that never satisfies (experiences), people spent {pc(V('wants').spent)} of their income, and dividends fell
			to almost nothing. One tension stays open. The main run passed part 3 because the COOPs that grew fastest won
			their markets. The same selection made the near-monopolies of Section 9.1. The
			test city repeats every check for every person on every day, on five seeds (Section 11.1).
		</p>
	</section>

	<section id="city">
		<h2><span>11</span>Proving it: first a game, then a city</h2>
		<p>
			Nobody can run a whole economy in a laboratory. And nobody should test it on people's lives first. So maiaCITY
			tests theOS in two steps. The first step is a game. The game is a test city, where AI agents live, trade and
			invest under the rules of this paper. Every rule is a parameter: we can measure it, change it through an open
			proposal and play again.
		</p>
		<p>
			So the claims of Sections 5 to 10 become experiments, not hopes. For each claim, we publish a prediction before the
			run, together with the result that would refute it. AI agents are not people, so the test city first tests the
			code and the mechanisms. Sessions with human players, and then a small pilot, test how people behave. The early
			worlds of the test city already run the first layer. That layer has {UIA_DAY} HEARTS a day that melt at {pc(RATE)} a
			year, and COOPs whose MIND people get when they invest. The second step is the real city. The rules that survive the test
			city become the economy of maiaCITY while we build it.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.gameCity}.</strong> Each part of theOS, first in the test city, then in the real city.</caption>
				<thead>
					<tr><th>Part</th><th>In the test city</th><th>In the real city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>Every agent gets {UIA_DAY} personal HEARTS a day, which it can only invest</td><td>Every person with a verified identity gets {UIA_DAY} personal HEARTS a day: one stream per human</td></tr>
					<tr><td>COOPs</td><td>Agents found COOPs and invest HEARTS, which convert into MIND</td><td>An energy COOP for a village's geothermal plant, a food COOP for its food forest, a housing COOP for its domes</td></tr>
					<tr><td>Markets</td><td>Protocol-owned baskets of MINDs, fed by every treasury. {pc(DIVIDEND_SHARE)} of every sale goes at once to the holders of the seller's MIND</td><td>Avens route every purchase through the pools, and the seller gets its own MIND. Each COOP can change its dividend share, within the protocol's limit</td></tr>
					<tr><td>Prices</td><td>Free, every day, with two rivals for each basic</td><td>The same</td></tr>
					<tr><td>Land</td><td>One City COOP holds the map; agents lease plots and pay ground rent</td><td>The City COOP holds all land; every citizen holds one equal share; builders lease plots like an Erbbaurecht</td></tr>
					<tr><td>Energy</td><td>Every recipe costs energy; growth comes only from surplus energy</td><td>Measured on the village's meters</td></tr>
					<tr><td>Agents</td><td>AI agents with memory and goals; later, human players join them</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Work</td><td>Each agent's Aven proposes and delivers work items; COOPs pay the Aven's owner</td><td>The same: Avens do all work with the COOPs' machines; no human labour is paid</td></tr>
					<tr><td>Governance</td><td>Rule changes as open proposals, measured world by world</td><td>COOPs choose their own governance and compete (Section 9)</td></tr>
					<tr><td>Proposition 3</td><td>Checked per person, every day, with an owner-only group</td><td>The same, for every resident</td></tr>
				</tbody>
			</table>
		</div>
		<h3>11.1 The test city's world model</h3>
		<p>
			We are building the test city's <em>world model</em> from the simulation script of Appendix G. It is designed as
			one engine that plays every example of this paper as a short scenario. Each scenario has a condition for passing.
			It starts from a fixed seed (Section 10.3), so every run of it gives the same result. Run over years, the engine
			uses simple rules; run day by day, it uses AI agents.
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
			The recipes of Section 8.2 and Appendix H set every limit, and nothing caps growth or prices. Every day, each basic
			records its <em>binding limit</em>: the input that runs out first (Section 8.2). MIND must never be that limit
			while physics allows more.
		</p>
		<p>
			We borrow rules, not code. Mark-0 gives the steps of prices and quantities <Cite k="gualdi" />. Godley and Lavoie,
			and Caiani and others, give the accounting. The model of Dosi and others gives competition, entry, exit and
			innovation <Cite k="dosi" />. All of them create money by credit and pay wages, and theOS has neither. None of them
			checks a basic bundle for every person on every day. That check is new.
		</p>
		<p>The scenarios replay the examples of this paper. Among them:</p>
		<ul>
			<li>Anna's lamp, and the resting state of Section 5.2;</li>
			<li>a failing food COOP, with one seller and with two;</li>
			<li>the founder ring of Section 12.2;</li>
			<li>the first day, with and without the bootstrap;</li>
			<li>twice the HEARTS, which should only double prices in MIND;</li>
			<li>more surplus energy, which should lift every tenth.</li>
		</ul>
		<p>
			Proposition 3 runs on five seeds, and on a grid of melt rates and Law 5 shares. The engine's results will add a
			second, game-based proof.
		</p>
		<h3>11.2 A roadmap in three steps</h3>
		<ol>
			<li>
				<strong>The world model.</strong> Play every example of this paper as a seeded scenario, with (1), many COOPs
				and their pools. Check Proposition 3 for every person, on every day, on five seeds.
			</li>
			<li><strong>Human intents.</strong> Let people make the two daily choices of Section 7 and leave the rest to their Aven. Then humans and AI agents share one economy.</li>
			<li><strong>The first real village.</strong> One village centre with its energy, food and housing COOPs, which run on the rules that survived the test city.</li>
		</ol>
		<p>
			Before we build the city, the test city must also answer the questions that this paper cannot answer yet.
		</p>
	</section>

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
				<strong>Work, care and payments between people.</strong> No human labour is paid. COOPs pay for Aven work items,
				and the pay goes to the human whose Aven delivers (Section 4). Work proposals are open to every Aven, including
				care work and public work for the City COOP. This matters for fairness: in the simulation, people whose Avens
				earn more than the median hold {fmt(DYN.topBottom, 1)} times as much as the rest. Open questions remain. How do care, art and
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
				own COOP. The founder then controls {fmt(selfDealDay(), 1)} MIND a day instead of {fmt(honestDay())}: both
				halves, less the tenth that drips into the pools. Friends can act as each other's basket partners, and two COOPs
				could sell to each other in a circle. In the earlier static world, a founder ring drew
				{pc(STATIC.ring.hearts, 2)} of all HEARTS, though it was {pc(STATIC.ring.people, 1)} of the people. Its income
				was {fmt(STATIC.ring.income, 1)} times that of others, and after {STATIC.ring.years} years its wealth was
				{fmt(STATIC.ring.wealth, 1)} times. We propose a related-party rule. When insiders invest, their treasury half
				waits in a locked account (escrow) until an audit confirms real output. Every treasury flow and every work item is
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
				members vote. Then an order of payment applies: Aven work items first, then supplier COOPs. The physical assets
				go to the City COOP, which leases them to a COOP that runs them better, without a forced sale. In the simulation,
				the first food COOP failed in year {FAILURE.year}. A rival was already selling food, and the City COOP leased the
				plant on. In the {SIM.endAfterDays} days after each of the {PROOF.failures + PROOF.exits} ends, {PROOF.endedShort}
				of {fmt(PROOF.endedPersonDays)} person-days were short. In the earlier static world, the same rule kept food
				{pc(STATIC.foodFailure.withRule)} short for one year, against {pc(STATIC.foodFailure.without)} without it. The
				order of payment must itself resist capture by a small group, and the legal wrapper must match it.
				<em>Test:</em> more injected failures in the test city.
			</li>
			<li>
				<strong>Long-lived projects.</strong> A treasury's savings melt while it saves, and theOS has no credit. So a
				tidal barrier or a fusion plant needs firm pledges of HEARTS over years before it can start. Euro credit
				from a cooperative bank, at the legal layer, is another path. <em>Test:</em> the test city measures whether Avens
				fund such projects.
			</li>
			<li>
				<strong>Competition that fades.</strong> In the simulation, one COOP came to make almost all of most goods
				(Section 9.1). Its prices stayed low, because the simulated leaders price to clear their capacity. A real leader
				might price for profit. We propose the three rules of Section 9.1. <em>Test:</em> a
				leader that prices for profit, with one, two and four sellers of each good.
			</li>
			<li>
				<strong>Aven capacity.</strong> The results assume that Avens deliver what the COOPs ask, at a fixed rate for each
				work item. We also ran Avens with a fixed capacity and a floating rate. Then all three checks failed: food ran
				short, and the worst person-day had {pc(V('aven').worst)} of the basics. <em>Test:</em> Avens with real limits,
				and rates that float.
			</li>
		</ul>
		<h3>12.3 Pools and prices</h3>
		<ul>
			<li>
				<strong>Basket admission, and a dying MIND.</strong> An equal-weight pool keeps an equal share of its value in
				each MIND, so it keeps buying a falling MIND all the way down. If one MIND loses 99 % of its value, a pool of
				four keeps {pct(poolAfterCrash(0.01, 4) * 100)} of its value. The same tokens, simply held, would keep
				{pct(heldAfterCrash(0.01, 4) * 100)}, and a pool of eight keeps {pct(poolAfterCrash(0.01, 8) * 100)}. We propose
				that a MIND joins a basket only after verified output and with the consent of the COOPs already in it. Its
				founders also post a bond that they lose on fraud. A breaker stops a pool from taking in a failing MIND, while
				the pool still sells it. The breaker reacts to events, such as failed deliveries, not to prices. The failing
				COOP's inflow stops too. Once the COOP has failed, its MIND leaves the baskets. The main run of Section 10 assumes
				this rule: a failed COOP's MIND leaves the pools and is retired, and its holders lose it. It is a third way out of a pool, beside trades and the melt. In the earlier static world, a failed
				COOP's MIND kept a pool price, and its holders could still swap it for their partners' MIND. The healthy
				reserves could then move into a successor pool. That needs one decision: whether "never withdrawn" means "never
				leaves the protocol's pools". A hub MIND in every basket, for
				example CITYmind, keeps routes short and the network connected. <em>Test:</em> junk dumping, price pumps and
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
				{fmt(pairCount(1000))} exchange rates between them. So this paper counts in R, the yardstick of Section 6.3.
				Two questions stay open: which MINDs should define R, and how stable it stays. Each COOP also publishes what one
				of its MIND buys, for example kWh per SOLARmind. <em>Test:</em> the test city measures how R moves against a day
				of living.
			</li>
			<li>
				<strong>Liquidity that never leaves.</strong> Nobody can withdraw from the pools, so nobody can repair a pool by
				moving money out, and every bug stays exposed. So the code must be right from the start. It needs verified
				maths, rounding in the pool's favour and one global melt index. A narrow pause may stop trading but never move
				funds (Appendix F). Equal-weight baskets are in wide use, but never yet with steady one-sided inflows, no
				withdrawals and melting currencies. <em>Test:</em> the test city, a red team and a bug bounty test this mix before
				real value flows.
			</li>
		</ul>
		<h3>12.4 The city, the euro and the law</h3>
		<ul>
			<li>
				<strong>Escape into assets.</strong> Melting money pushes wealth into anything that does not decay
				<Cite k="keynes36" />. The land rule of Section 8.1 closes the largest door. Other stores of value remain, such
				as euros, art or rare objects. theOS must also decide how the City COOP sets the ground rent, and how citizens
				decide what it builds with it. <em>Test:</em> the test city offers assets that do not melt, and measures how much
				wealth flows into them.
			</li>
			<li>
				<strong>The euro border.</strong> Panels, chips, medicine and insurance cost euros, and taxes are due in euros,
				even on services paid in MIND. No supplier outside the city accepts SOLARmind. The alternative currencies that
				lasted kept a bridge to national money; the Chiemgauer charges a fee to change back into euros
				<Cite k="gelleri" />. We propose that each COOP is a legal eG with a euro balance sheet. COOPs that sell power,
				heat, food or services outside the city earn euros, and a shared euro reserve pays for imports and taxes.
				Changing MIND into euros carries a fee, and individuals cannot redeem MIND for euros. Each COOP publishes a euro
				reference price and keeps a tax reserve. <em>Test:</em> the test city adds an outside euro economy that agents can
				trade with and leave for.
			</li>
			<li>
				<strong>Securities and co-op law.</strong> Under EU rules, a token that carries ownership and can be traded is
				likely a security, with the duties of one <Cite k="esma" />. Pools and trading Avens may count as licensed
				crypto services, and each trade may be a taxable sale. HEARTS, which nobody can transfer, probably fall outside
				crypto law. We propose to run COOPs as divisions of an umbrella eG. Investing a HEART makes the investor a
				member with one vote. The legal wrapper describes MIND as a member's share and right to the COOP's services. A
				legal opinion, and rulings from BaFin, Germany's financial supervisor, and from the tax office, come before any
				real value flows. <em>Test:</em> the test city counts the taxable trades that each Aven makes.
			</li>
			<li>
				<strong>The cold start of the first village.</strong> A COOP needs three partners before its MIND can trade, so
				the first COOPs wait for each other. Circles, with the same {UIA_DAY} a day and {pc(RATE)}, had about 25,000
				registered people in mid-2026 <Cite k="gnosis" />. Empty pools are a second trap (Section 10.6). We propose the
				bootstrap. On opening day, the City COOP and the energy, food and housing COOPs open together as the first
				basket. Residents invest their HEARTS for a founding week before the first sale. A tenth of each treasury half
				fills the pools, so any MIND a person holds can pay any seller from the first sale. Only investment creates MIND, so nothing else may fill them. Each
				person's first investment makes them a part-owner of the basics COOPs, so Law 5 pays them a share of every
				basic sold from day one. Newcomers get the same start. Euros fund the first machines, never MIND, so that the COOPs deliver from day one. Residents can pledge future
				HEARTS to a founding as a standing order. <em>Test:</em> the test city's first village, judged by kWh delivered
				per HEART and the time to the first kWh.
			</li>
		</ul>
		<h3>12.5 The rate, the conditions and the evidence</h3>
		<p>
			Section 5.3 gives the reasons for the rate of {pc(RATE)}. The test city runs Proposition 3 on a grid of melt rates
			(Section 11.1), and measures how behaviour changes with the rate.
		</p>
		<p>
			Propositions 2 and 3 hold only under conditions. Table {TAB.conditions} lists them, and what the simulation found
			for each. Two need a word. Arbitrage profits from the pools are a lasting return, so they must flow back to all
			Avens, or batch trading must remove them. And a COOP that closes its doors to new HEARTS creates scarcity for its
			first owners.
		</p>
		<div class="table-wrap">
			<table class="narrow">
				<caption><strong>Table {TAB.conditions}.</strong> The conditions of Propositions 2 and 3, and what the simulation found for each.</caption>
				<thead>
					<tr><th>Condition</th><th>Needed for</th><th>In the simulation</th></tr>
				</thead>
				<tbody>
					<tr><td>The lasting return <Tex tex={String.raw`\mu`} /> stays below the melt</td><td>P2</td><td>Only at rest: {pc(DYN.mu, 1)} in years {SIM.restFrom} to {SIM.years} of the main run, but {pc(DYN.muRun, 1)} over the whole run, at or above the melt in {DYN.muYearsAbove.years} of {DYN.muYearsAbove.of} years; {pc(RATE)} or more at rest in {variationsMuAbove()} of {LADDER.length - 1} variations; {MIND_RETURNS.aboveMelt} of {MIND_RETURNS.withThreeYears} MINDs above it over their lives</td></tr>
					<tr><td>Every COOP accepts HEARTS from anyone</td><td>P2, P3</td><td>Assumed</td></tr>
					<tr><td>A rule for how euros can buy MIND</td><td>P2</td><td>A closed city, with no euros</td></tr>
					<tr><td>A rule for estates</td><td>P2</td><td>Not modelled</td></tr>
					<tr><td>The payout rule, with a reserve of about {SIM.reserveMonths} months</td><td>P2, P3</td><td>People hold {pc(DYN.people)}, treasuries {pc(DYN.treasuries)}, pools {pc(DYN.pools)}; reserves of {V('res6').months} and {V('res12').months} months failed</td></tr>
					<tr><td>All land with the City COOP</td><td>P2</td><td>An earlier model: a Gini index of {fmt(STATIC.land.city, 2)}, against {fmt(STATIC.land.private, 2)} with private land</td></tr>
					<tr><td>Work proposals open to every Aven</td><td>P2</td><td>The top half of Aven pay holds {fmt(DYN.topBottom, 1)} times the bottom half</td></tr>
					<tr><td>Enough output, and it keeps growing</td><td>P3</td><td>Without productivity growth, all checks failed; with {pc(SIM.prodGrowth)} for every COOP, part 3 failed</td></tr>
					<tr><td>Two or more sellers of each basic</td><td>P3</td><td>Not met: water had one seller throughout, and by year {SIM.years} one COOP made all the energy and all the housing. Still, nobody went short after the {DYN.failures + DYN.exits} ends ({DYN.foundings} COOPs founded, {DYN.exits} exited, {DYN.failures} failed)</td></tr>
					<tr><td>Wants that keep growing</td><td>P3</td><td>Without them, all checks failed</td></tr>
					<tr><td>The bootstrap</td><td>P3</td><td>Not yet tested; the genesis week was short</td></tr>
					<tr><td>Spread ownership (C4)</td><td>P3</td><td>Not modelled: the owner-only people kept the MIND that paid least</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			<strong>The physical numbers.</strong> The food forest's yield is the riskiest number in this paper. Peters and
			others find that diets like those of the United States need more land than the city plans <Cite k="peters" />.
			So the test city runs the yield at half and at one and a half times the plan. The energy return of deep
			geothermal and the energy for compute are estimates (Appendix H). And part 3's evidence rests on fast growth with
			no physical limit: output per unit of plant grew about {pc(plantGrowthRate(), 1)} a year, and mean real
			consumption about {pc(growthRate('mean'), 1)} a year. So the test city must check part 3 again, with growth that
			only surplus energy pays for.
		</p>
		<p>
			<strong>Proposition 3 is not yet robust.</strong> It rests on one seed. Only the main run, one of
			{LADDER.length}, passes all three checks (Table {TAB.variations}). The strict test fails in every run. And the
			owner-only margin shrinks late in the run. The group's dividends fell from {fmt(OWNER_ONLY.strictAvg40, 2)} times the
			bundle in year 40 to {fmt(OWNER_ONLY.strictAvg60, 2)} times in year {SIM.years}. <em>Test:</em> five seeds, and
			the grid of Section 11.1.
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
			In capitalism, people sold their time so that they could survive. In Abundism, no human labour is paid, and
			survival rests on ownership. A person's MIND comes from three places: the ownership their investing creates, the
			work items their Aven delivers, and the dividends of what they own. In the simulation, basics got cheaper as
			productivity rose. Whether rivals keep them cheap when a leader prices for profit is still open (Section 12.2).
		</p>
		<p>
			Proposition 3 says what this gives: no one starves, no one has to work to survive, and the living standard of
			every tenth of the people rises. In a simulation, parts 1 and 2 held for every person at every step after the
			first week, and part 3 held at every ten-year mark. It also failed. The first week was short. Dividends alone
			missed often in the first {PROOF.strict.lastShortYear} years. The poorest tenth consumed {pc(-dip.fall)} less in
			year {dip.to} than in year {dip.from}. And in {starveFail()} of {LADDER.length - 1} variations, someone ran short,
			mostly of food. Only 1 of {LADDER.length} runs, on one seed, passed all three checks. We propose a fix for each
			failure, and the test city must show that each one works. Human action becomes steering: deciding,
			every day and together, what the city builds next. maiaCITY will prove it first in a game, and then in the real
			city.
		</p>
	</section>

	<p class="partline" id="appendices">Appendices</p>

	<section id="assumptions">
		<h2><span>A</span>Assumptions</h2>
		<p>
			The results of this paper rest on these assumptions. Each one marks a place where the test city must look first.
		</p>
		<ol>
			<li><strong>A closed city.</strong> The models leave out euros, imports, exports and taxes (Section 12.4).</li>
			<li><strong>A constant population,</strong> except where Section 5.2 adds growth. Equation (3) holds only then.</li>
			<li><strong>Prompt investment.</strong> Avens invest HEARTS as they arrive, so few HEARTS sit unused.</li>
			<li><strong>One human, one stream.</strong> Identity works, and nobody directs the HEARTS of fake people (Section 12.1).</li>
			<li><strong>Faithful Avens.</strong> Each Aven serves only its human, follows its human's choices and makes no costly mistakes.</li>
			<li><strong>No paid human labour.</strong> Every human has one Aven, and the Avens propose and deliver all work with the COOPs' machines. Avens differ in what they deliver. Section 10.4 shows where a person's MIND comes from.</li>
			<li><strong>Treasuries pay out.</strong> Law 5 sends {pc(DIVIDEND_SHARE)} of every sale to the holders. The rest follows the payout rule of Section 9.3: a reserve of about {SIM.reserveMonths} months, plant first, then payout for work proposals.</li>
			<li><strong>Honest prices.</strong> Time-averaged pool prices reflect the use that each MIND buys.</li>
			<li><strong>Connected baskets.</strong> Every MIND in a basket can reach every other MIND through the pools.</li>
			<li>
				<strong>Random returns.</strong> In Proposition 2, holdings are valued in a common basket of MINDs. Their
				returns move as a random walk, with a lasting return below the melt.
			</li>
			<li><strong>Land in the City COOP.</strong> All land belongs to the City COOP and is only leased (Section 8.1).</li>
			<li>
				<strong>Enough output and net energy.</strong> The COOPs' machines, land and net energy make enough per person to
				cover the basics (Section 8.2, Appendix H). No rule about money can make up for missing output.
			</li>
			<li><strong>Free prices.</strong> Each COOP's own price rule moves its price up and down by equal steps, every day. The rule keeps the price above the COOP's own cost; nobody imposes a floor, and nothing caps a price (Section 9.1).</li>
			<li><strong>Rivals.</strong> Every household good except water has two COOPs from the first day. Law 3 entry is always open; in the simulation, founders act when a margin over full cost stays above {pc(SIM.foundingMargin)} for {SIM.foundingDays} days.</li>
			<li><strong>Productivity growth.</strong> Each COOP's productivity rises about {pc(SIM.prodGrowth)} a year on average, unevenly. This is assumed. It stands in for growth that surplus energy pays for (Section 8.2).</li>
			<li><strong>Spending.</strong> People spend a share <Tex tex={String.raw`\theta = ${tn(SIM.spendRate, 1)}`} /> of what they hold a year, basics first. This drives the {pc(DYN.spent)} of income that they spend (Section 10.4).</li>
			<li><strong>Wants that keep growing.</strong> At least one good, such as experiences, never satisfies fully (C5).</li>
			<li><strong>Avens deliver what COOPs ask,</strong> at a fixed rate for each work item (Section 12.2).</li>
			<li><strong>The bootstrap.</strong> Residents invest their HEARTS for a founding week before the first sale. A tenth of each treasury half fills the pools, and each person owns part of the basics COOPs (C3, Section 12.4). The simulation does not test it yet.</li>
		</ol>
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
					<tr><td><Tex tex="g" /></td><td>A project's real rate of change. In Section 1 only: the growth of the whole economy</td><td>1, 8</td></tr>
					<tr><td><Tex tex={String.raw`B,\ \Delta t`} /></td><td>Any balance of HEARTS or of one MIND, and the years since its last update</td><td>5.1</td></tr>
					<tr><td><Tex tex="u" /></td><td>HEARTS issued per person a year, {fmt(u)}</td><td>5.2</td></tr>
					<tr><td><Tex tex="N" /></td><td>The number of people</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`m,\ m^{*}`} /></td><td>The average count of HEARTS and MINDs per person, and its steady state</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`y_i,\ B_i^{*}`} /></td><td>The net inflow of one balance a year, and the level that the balance tends to</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`\nu`} /></td><td>The yearly growth rate of the population</td><td>5.2</td></tr>
					<tr><td><Tex tex={String.raw`c,\ e_v`} /></td><td>Laborde's universal-dividend rate, and the life span that it derives from</td><td>5.3</td></tr>
					<tr><td><Tex tex={String.raw`b,\ b_i`} /></td><td>A member's balance relative to the average</td><td>5.3</td></tr>
					<tr><td><Tex tex={String.raw`n,\ w_i`} /></td><td>The number of MINDs in a basket, 4 to 8, and each one's weight, <Tex tex="1/n" /></td><td>6</td></tr>
					<tr><td><Tex tex={String.raw`x_i,\ k,\ p_{ij}`} /></td><td>A pool's reserve of MIND <Tex tex="i" />, the pool's invariant, and the price of MIND <Tex tex="j" /> in MIND <Tex tex="i" /></td><td>6.1</td></tr>
					<tr><td><Tex tex={String.raw`\varphi`} /></td><td>The trading fee, 0.3 %</td><td>6.1</td></tr>
					<tr><td><Tex tex="V" /></td><td>A pool's value. In Section 2 only: Fisher's velocity</td><td>2, 6</td></tr>
					<tr><td><Tex tex={String.raw`\sigma,\ \Sigma,\ \rho,\ \ell`} /></td><td>Volatility, covariance and correlation of prices, and the yearly loss-versus-rebalancing</td><td>6.2</td></tr>
					<tr><td><Tex tex="T" /></td><td>A time horizon in years</td><td>8</td></tr>
					<tr><td><Tex tex={String.raw`s_i,\ f_i,\ \bar f,\ \kappa`} /></td><td>A COOP's share of its sector's investment, its utility per HEART, the average utility, and the speed of selection</td><td>9</td></tr>
					<tr><td><Tex tex={String.raw`W_i,\ W^{*},\ a`} /></td><td>A person's MIND holding, its resting level, and what the person keeps each year</td><td>9.3, 10.2</td></tr>
					<tr><td><Tex tex={String.raw`\mu`} /></td><td>The lasting return on a holding: dividend yield plus any lasting price rise</td><td>9.3</td></tr>
					<tr><td><Tex tex={String.raw`\sigma,\ dZ,\ \alpha`} /></td><td>The spread of returns between people, random noise, and the shape of the resting spread</td><td>9.3</td></tr>
					<tr><td><Tex tex={String.raw`G,\ G_0,\ G_{\infty}`} /></td><td>The Gini index of ownership: over time, at the start, and at rest</td><td>9.3</td></tr>
					<tr><td>R</td><td>The yardstick of value: what a MIND trades for against three reference MINDs, on their geometric mean</td><td>6.3</td></tr>
					<tr><td><Tex tex={String.raw`\lambda`} /></td><td>Law 5's share of every sale, {pc(DIVIDEND_SHARE)} by default</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`\omega`} /></td><td>The ownership that a person's investing creates for them</td><td>10.2</td></tr>
					<tr><td><Tex tex="T_i" /></td><td>The years a holding would pay the basic bundle with nothing flowing in</td><td>10.2</td></tr>
					<tr><td><Tex tex="p_b" /></td><td>The cost of a day's basic bundle</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`D_i,\ X_i`} /></td><td>A person's dividends, and what they spend</td><td>10.2</td></tr>
					<tr><td><Tex tex={String.raw`\bar W,\ Y`} /></td><td>The mean holding, and what people buy from COOPs, R a person a day</td><td>10.2</td></tr>
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
			<dd>A person's own currency of intent, {UIA_DAY} a day. HEARTS buy nothing and pay for nothing, not even food. They earn nothing and can only be invested into COOPs.</dd>
			<dt>MIND</dt>
			<dd>A COOP's own currency of ownership and utility. To hold it is to own part of the COOP; to spend it is to use what the COOP makes.</dd>
			<dt>COOP</dt>
			<dd>A cooperative enterprise that makes something a city needs, such as energy, food or housing. It has its own MIND and treasury.</dd>
			<dt>Treasury</dt>
			<dd>A COOP's working capital: its own MIND and the MINDs of other COOPs that it buys for its own needs. It keeps a reserve of about {SIM.reserveMonths} months and never holds HEARTS.</dd>
			<dt>Conversion</dt>
			<dd>The moment an invested HEART becomes one MIND: half to the investor, half to the COOP's treasury.</dd>
			<dt>Dividend</dt>
			<dd>Law 5: a fixed share of every sale, by default {pc(DIVIDEND_SHARE)}. It goes at once to everyone who holds the seller's MIND, in proportion to their holding. It is not Laborde's universal dividend of Section 3, which is new money.</dd>
			<dt>Aven work item</dt>
			<dd>A piece of work that a person's Aven proposes and delivers to a COOP, with the COOP's machines. The COOP pays the Aven's human in its own MIND. No human labour is paid. A <em>running item</em> keeps a COOP going, such as a daily check, and the COOP pays it from its running costs. A <em>work proposal</em> is new work, such as a repair plan. If the members accept it, the treasury pays it from what it holds above its reserve.</dd>
			<dt>Payout rule</dt>
			<dd>A proposed rule. A treasury keeps a reserve of about {SIM.reserveMonths} months of running costs and planned building, and grows its own plant first. It pays out the rest within weeks, for work proposals.</dd>
			<dt>Turnover</dt>
			<dd>The total of a COOP's sales over a time. Only real deliveries count.</dd>
			<dt>R</dt>
			<dd>The yardstick of value of Section 6.3. To price a MIND in R, ask what it trades for in the pools against SOLARmind, HABITATmind and CITYmind, and take the geometric mean. A MIND that trades for about two of each is worth 2 R. When one of their COOPs ends, its successor takes its place, so the chain of prices does not jump. Nobody holds R or pays in it.</dd>
			<dt>Melt, demurrage</dt>
			<dd>To melt is to shrink continuously, at a rate of {pc(RATE)} a year. Demurrage is the name of that holding cost.</dd>
			<dt>UIA</dt>
			<dd>Universal Intent Allocation, Law 1: the right of every human to invest {UIA_DAY} HEARTS a day.</dd>
			<dt>Pool, basket</dt>
			<dd>A protocol-owned store of 4 to 8 MINDs in equal value shares, which anyone can trade against and nobody can withdraw from. MIND leaves it only through trades, by melting, or when its COOP fails and its MIND is retired.</dd>
			<dt>G3M</dt>
			<dd>Geometric mean market maker: the pool formula (5), which keeps the geometric mean of the reserves constant in every trade.</dd>
			<dt>LVR</dt>
			<dd>Loss-versus-rebalancing: what a pool loses to arbitrageurs when prices move, against a perfect rebalancer.</dd>
			<dt>Aven</dt>
			<dd>A personal AI agent that works only for its human: it invests, trades, pays, proposes and delivers Aven work items, and collects dividends.</dd>
			<dt>City COOP</dt>
			<dd>The COOP that holds all land and everything that all citizens share. Every citizen holds one equal share, as a membership.</dd>
			<dt>Ground rent, Erbbaurecht</dt>
			<dd>The yearly fee for a leased plot, paid in any MIND and received as CITYmind. The lease works like a German heritable building right.</dd>
			<dt>Protocol</dt>
			<dd>The shared software at the base of theOS that runs the laws. No person or COOP owns it.</dd>
			<dt>Steady state</dt>
			<dd>The level at which a balance's yearly inflow equals what melts from it in a year.</dd>
			<dt>Gini index</dt>
			<dd>A measure of inequality from 0 to 1: 0 means that everyone has the same, 1 means that one person has everything. It is the average gap between two people chosen at random, divided by twice the mean.</dd>
			<dt>Sybil attack</dt>
			<dd>One person posing as many people, to collect many streams of HEARTS.</dd>
			<dt>Day of living</dt>
			<dd>What an average person consumes in a day, priced in R that year (Section 6.3).</dd>
			<dt>Basic bundle</dt>
			<dd>One day of basics for one person: {fmt(BASIC_BUNDLE.kcal)} kcal of food, {BASIC_BUNDLE.L} L of water, {BASIC_BUNDLE.kWh} kWh of energy and {BASIC_BUNDLE.m2} m² of home.</dd>
			<dt>Owner-only person</dt>
			<dd>A person whose Aven delivers nothing and who starts with nothing. Every tenth person in the simulation is one.</dd>
			<dt>Real consumption</dt>
			<dd>Every unit that a person consumes, valued at the prices of day 1, so that it counts amounts, not price changes. It is not comparable with a day of living.</dd>
			<dt>Decile, tenth</dt>
			<dd>One of ten equal groups of people, sorted by real consumption each year.</dd>
			<dt>Proposition 3</dt>
			<dd>The central claim of Section 10: no one starves, no one has to work to survive, and the living standard of every tenth rises. Part 2 claims the normal test, which lets an owner-only person spend some of what they hold. The strict test, dividends alone, is a stronger target that the simulation does not yet meet.</dd>
			<dt>Rival COOP</dt>
			<dd>A COOP that makes the same good as another and competes for the same buyers (Section 9.1).</dd>
			<dt>Founding, exit, failure</dt>
			<dd>A founding starts a COOP. An exit closes a small COOP that lost its market. A failure ends a COOP whose treasury stays dry while it keeps losing; the City COOP leases its plant to a successor.</dd>
			<dt>Reserve</dt>
			<dd>What a treasury keeps for about {SIM.reserveMonths} months of running costs and planned building, before it pays out.</dd>
			<dt>Net energy</dt>
			<dd>The energy that a source delivers, less the energy that it takes to build and run it.</dd>
			<dt>EROI</dt>
			<dd>Energy return on investment: the energy that a source delivers over its life, divided by the energy that it takes to build and run it.</dd>
			<dt>Wright's law</dt>
			<dd>The cost of a product falls by a fixed share each time the total ever made doubles.</dd>
			<dt>Recipe</dt>
			<dd>The inputs and the energy that make one unit of a good (Section 8.2).</dd>
			<dt>Plant</dt>
			<dd>The machines and buildings with which a COOP makes its goods.</dd>
			<dt>Rest (of a run)</dt>
			<dd>Years 51 to 60 of a simulation run, which its steady-state numbers average.</dd>
			<dt>Main run</dt>
			<dd>The run of the simulation with the default settings: Law 5 at 20 % and reserves of 9 months (Section 10.3).</dd>
			<dt>Binding limit</dt>
			<dd>The input that runs out first and so sets how much of a good the city can make that day.</dd>
			<dt>Agent-based model</dt>
			<dd>A simulation in which every person and every COOP acts by its own rules, and the result is what all of them do together.</dd>
			<dt>Stock-flow consistent</dt>
			<dd>A way to keep the books of a model: every flow leaves one place and arrives in another, so every stock adds up.</dd>
			<dt>Dynamic and static world</dt>
			<dd>The two simulations of Section 10.3. The dynamic world has rivals, free prices, growth and shocks, and this paper uses it. The earlier static world had fixed tastes, no growth and capped prices; "static" marks its numbers.</dd>
			<dt>Test city</dt>
			<dd>The game of Section 11, where AI agents live, trade and invest under the rules of this paper before the real city.</dd>
		</dl>
	</section>

	<section id="related">
		<h2><span>D</span>Related work</h2>
		<p>
			<strong>Circles.</strong> Circles gives every person a currency of their own <Cite k="circles" />. Its second
			version issues {UIA_DAY} a day and takes {pc(RATE)} a year, the numbers that theOS adopts <Cite k="circles2" />. Circles moves
			value through a web of trust. theOS drops the web of trust and lets people only invest their personal currency.
		</p>
		<p>
			<strong>Gesell, Wörgl and the Chiemgauer.</strong> Gesell proposed money with a holding cost <Cite k="gesell" />.
			Wörgl tested it in 1932–33 <Cite k="schwarz" />, and the Chiemgauer has run since 2003 <Cite k="gelleri" />. Each
			was tied to national money and could be changed back into it, so the melt was a real cost. MINDs float against each
			other, so in theOS the melt works first as a levelling tool.
		</p>
		<p>
			<strong>The Relative Theory of Money and Ğ1.</strong> Laborde's universal dividend creates money equally for every
			member, at a rate tied to the life span <Cite k="laborie" />, and Ğ1 runs it <Cite k="duniter" />. theOS keeps the
			issuance fixed and lets money melt. The two agree at the steady state (Proposition 1).
		</p>
		<p>
			<strong>WIR and Sardex.</strong> WIR has given Swiss firms credit in its own currency since 1934
			<Cite k="stodder" />, and Sardex gives interest-free credit to firms in Sardinia <Cite k="sardex" />. theOS has no
			credit, so Section 12.2 lists long-lived projects as an open problem.
		</p>
		<p>
			<strong>Balancer and geometric mean pools.</strong> Balancer's weighted pools use the formula of theOS's baskets,
			but outside investors supply the reserves, hold pool tokens and can withdraw <Cite k="balancer evans" />. theOS
			pools belong to the protocol, issue no pool tokens, take one-sided inflows and hold currencies that melt.
		</p>
		<p>
			<strong>Agent-based and stock-flow consistent models.</strong> Mark-0 <Cite k="gualdi" /> and the model of Dosi
			and others <Cite k="dosi" /> let many firms and households act by simple rules. Godley and Lavoie
			<Cite k="godley" />, and Caiani and others <Cite k="caiani" />, keep the books so that every flow lands somewhere.
			These models create money by credit, pay wages and report Gini indices, but none checks a floor for every person
			on every day. The simulation of Section 10 keeps stock-flow consistent books and adds that check. The test city's
			world model will borrow their rules (Section 11.1).
		</p>
		<p>
			<strong>Energy and growth.</strong> Ayres and Warr <Cite k="ayres" />, and Lindenberger and Kümmel
			<Cite k="kummel" />, put energy and useful work at the centre of growth. Murphy and Hall show that growth gets
			harder as the energy return falls <Cite k="murphy" />, and Smil traces how each civilization rests on its energy
			<Cite k="smil" />. theOS takes this as its last limit: money counts what the city makes, and net energy sets what
			it can make (Section 8.2).
		</p>
		<p>
			<strong>Property-owning democracy.</strong> Rawls asked for ownership spread "at the beginning of each period"
			<Cite k="rawls" />. Meade proposed it for an age of automation <Cite k="meade" />, and Roemer designed coupons that
			citizens can only invest <Cite k="roemer" />. HEARTS are the closest relative of Roemer's coupons: they refill every
			day and cannot be traded.
		</p>
		<p>
			<strong>Georgism.</strong> Henry George showed that land rent is value that the whole community creates
			<Cite k="george" />. The City COOP of Section 8.1 collects that rent as ground rent in MIND and spends it on what
			all citizens share.
		</p>
	</section>

	<section id="threats">
		<h2><span>E</span>Threat model</h2>
		<p>
			theOS creates prizes that attackers will want. Table {TAB.threats} lists the main attacks, what they gain, the
			defences that Section 12 proposes, and how the test city tests them.
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
					<tr><td>Empty work items</td><td>Treasury MIND for work that an Aven never delivered, or for a friend's Aven</td><td>Public work items with a proof of delivery, members' acceptance, work proposals open to every Aven, audits of the largest earners</td><td>Avens that bill empty work, COOPs that favour related Avens</td></tr>
					<tr><td>Pool attacks and front-running</td><td>A pushed price draws HEARTS from Avens; bots trade around payments and inflows</td><td>Time-averaged prices, one batch at one price per block, sealed orders, an event breaker</td><td>Price pumps, junk dumping, sandwich bots</td></tr>
					<tr><td>Capture</td><td>Control of a COOP's treasury, of the Avens' defaults, or of the protocol's code</td><td>The holder rule, a default COOP constitution, several Aven providers, the process of Appendix F</td><td>Vote buying, a captured Aven provider, injected instructions</td></tr>
					<tr><td>Bugs</td><td>Value drained from pools that nobody can withdraw from</td><td>Verified maths, one global melt index, independent code, a pause that cannot move funds, a bug bounty</td><td>A red team before real value flows</td></tr>
					<tr><td>Market power over a basic</td><td>A leading COOP raises prices or keeps rivals out</td><td>A founding signal when need goes unmet or a rival's cost is far below the price (Law 3 entry is always open); open improvements after a delay; Avens' exit; Law 5 to all holders; the City COOP leases idle plants</td><td>One, two and four sellers of each good</td></tr>
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
			<strong>The laws.</strong> The five laws and the rate are fixed. Nobody holds a key that changes them. A change to
			a law would be a new protocol, and each person would choose whether to move to it. In the test city it is different:
			every rule is a parameter, anyone can propose a change, and the change runs in a new world.
		</p>
		<p>
			<strong>The code.</strong> The software that runs the laws must be fixable, because it will have bugs. We propose
			that every change goes through a public proposal, an independent audit and a waiting time of at least 30 days.
			Then the citizens decide in the City COOP, one vote per citizen share. No change may break a law.
		</p>
		<p>
			<strong>The pause.</strong> One narrow pause can stop trading in a pool, but it can never move funds. Each pause ends
			after 72 hours unless a large majority renews it.
		</p>
		<p>
			<strong>Details inside the laws.</strong> Some rules work inside the laws. Among them are the reserve target of
			about {SIM.reserveMonths} months, the founding signal for rivals (Law 3 entry itself is always open), and the Law 5
			share and its limit. Basket
			admission, R and the identity system are rules of this kind too. The limit matters: a share of {pc(V('law35').share)} failed the checks of Proposition 3. These
			rules change by the same process as the code, and the test city tests each change first.
		</p>
		<p>
			During the test city and the first pilot, the maiaCITY team writes and runs the code. That is a concentration of power.
			The city must hand it to the process above before real value flows.
		</p>
	</section>

	<section id="disclosure">
		<h2><span>G</span>Interests and code</h2>
		<p>
			The author leads maiaCITY, which builds the test city and the real city that this paper describes. He therefore
			has an interest in the success of theOS. The code behind every number and figure in this paper is open, in the
			maiaCITY repository at
			<a href="https://github.com/MyAvenCEO/maiacity" target="_blank" rel="noopener noreferrer">github.com/MyAvenCEO/maiacity</a>.
			The file <code>src/lib/theos/model.js</code> holds every number that the text prints. Each constant names the
			table of the simulation that it comes from. A function computes every ratio, so readers can check and rerun each
			one.
		</p>
		<p>
			The agent-based simulation that Sections 5 to 12 quote is the script <code>scripts/theos-e2e-sim.mjs</code> in the
			same repository. Its main scenario is the dynamic world, and the static world is the comparison. In both, no
			human labour is paid: every human has one Aven, and the Avens deliver all work items. The script prints the
			per-person checks of Proposition 3 first. Then it prints the tables of the dynamic world, its variations and the
			static world. It is seeded with {SIM.seed}, so the same command, <code>node scripts/theos-e2e-sim.mjs</code>,
			gives the same results, in about {fmt(SIM.runSeconds / 60)} minutes. The flag <code>--quick</code> runs a short smoke test, and
			<code>--csv FILE</code> also writes a yearly series of every run. The test city's world model is being built from
			this script (Section 11.1).
		</p>
	</section>

	<section id="physics">
		<h2><span>H</span>The physical world: primitives and limits</h2>
		<p>
			Money counts what the city makes, and physics sets what it can make (Section 8.2). Table {TAB.physics} lists the
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
			Recipes get better in two ways. They improve by making more, as Wright's law says, and by searching, through
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
			<strong>Cite as:</strong> Andert, S. (2026). theOS: The civilization scale operating system of Abundism. A macroeconomic and
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

	.laws li::marker {
		color: var(--terracotta);
		font-weight: 600;
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
