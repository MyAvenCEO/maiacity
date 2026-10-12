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
	import { REFS } from '$lib/theos/refs.js';
	import {
		RATE, UIA_DAY, DIVIDEND_SHARE, salesBound, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate, balanceAt, decay,
		idleSeries, convergenceSeries, infraSeries, lvrSeries, basketLvr, selectionSeries, selectionStats, fmt,
		GINI_DE, ownLevel, giniAt, levelYears, reachedBy, giniRest, dialSeries,
		yearlyLoss, steadyStateGrowth, yearsToReach, relativeRate, selfDealDay, honestDay,
		poolAfterCrash, heldAfterCrash, pairCount
	} from '$lib/theos/model.js';

	// Figure 12's simulation, run at build time (+page.server.js)
	let { data } = $props();

	// the four series colours, validated together for colour-blind separation on the paper's surface
	const C = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0'];

	// one rate drives Figures 5 and 6, so a reader can feel what the 7 % does
	let rate = $state(RATE);

	const idle = idleSeries().map((s, i) => ({ id: `r${s.r}`, label: `${Math.round(s.r * 100)} % a year`, color: [C[1], C[0], C[3]][i], points: s.points }));
	const conv = $derived(convergenceSeries(rate).map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] })));
	const star = $derived(steadyState(rate));
	const infra = infraSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const lvr = lvrSeries().map((s, i) => ({ ...s, color: [C[2], C[0], C[1]][i] }));
	const sel = selectionSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const gin = $derived(data.gini.map((s, i) => ({ ...s, color: ['#8a8578', C[0], C[2], C[1]][i] })));
	const dial = dialSeries().map((s, i) => ({ ...s, color: [C[1], C[0], C[3]][i] }));

	const pct = (v, d = 0) => `${fmt(v, d)} %`;
	// a number inside TeX: its thousands comma must not read as punctuation
	const tn = (v, d = 0) => fmt(v, d).replace(/,/g, '{,}');
	const ev = lifeForRate(RATE);
	const u = UIA_DAY * 365;
	// Figure 10 in numbers, as drawn, and with a COOP C that never learns
	const selNow = selectionStats();
	const selFlat = selectionStats(0);

	// the paper's arc: where we come from, the system itself, where it leads
	const parts = [
		{ title: 'Part I · From capitalism', sections: [
			['why', '1 · Why: the end of the wage'],
			['money', '2 · What money is, and why it should melt'],
			['dividend', '3 · Who should create money']
		] },
		{ title: 'Part II · The operating system', sections: [
			['laws', '4 · The four laws'],
			['entropy', '5 · Melting money, in numbers'],
			['pol', '6 · Keeping every MIND tradeable'],
			['avens', '7 · Avens: an agent for every person'],
			['infra', '8 · Why building for the long term pays'],
			['governance', '9 · Governance that evolves']
		] },
		{ title: 'Part III · Toward Abundism', sections: [
			['city', '10 · Proving it: first a game, then a city'],
			['limits', '11 · Limitations and open problems'],
			['synthesis', '12 · From capitalism to Abundism']
		] },
		{ title: 'Appendices', sections: [
			['assumptions', 'A · Assumptions'],
			['notation', 'B · Notation'],
			['glossary', 'C · Glossary'],
			['related', 'D · Related work'],
			['threats', 'E · Threat model'],
			['protocol', 'F · Who can change the rules'],
			['disclosure', 'G · Interests and code'],
			['references', 'References']
		] }
	];
</script>

<svelte:head>
	<title>theOS · The civilization scale operating system of Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, protocol-owned liquidity and open market governance, by Samuel Andert." />
</svelte:head>

<main class="paper">
	<header class="masthead">
		<p class="brand">theOS</p>
		<p class="kind">Working paper · v5 · October 2026 · maiaCITY</p>
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
			This paper proposes a different answer: an economic operating system that we call theOS. It rests on three simple
			ideas. First, every person gets a personal currency every day, simply for being alive: {UIA_DAY} HEARTS, one for
			each hour. Samuel's are SamuelHEARTS, Anna's are AnnaHEARTS. HEARTS are not money to spend; they are a voice.
			People can only invest them into cooperatives, or COOPs: shared enterprises that make what a city needs, such as
			energy, food or housing.
		</p>
		<p>
			Second, each HEART that a person invests converts into one unit of that COOP's MIND. A MIND is the COOP's shared
			intelligence, carried as one currency of ownership and utility. To hold it is to own part of the COOP; to spend it
			is to use what the COOP makes. Half of the new MIND goes to the investor and half to the COOP's treasury, the
			money that the COOP works with. A tenth of that treasury half flows into liquidity pools, and with these pools
			anyone can trade one MIND for another. The pools belong to the protocol itself: the base layer of theOS, which no
			person or COOP owns. COOPs pay their MIND out again: for resources and services, and for the work that people's
			agents propose. So MIND keeps moving through the economy.
		</p>
		<p>
			Every sale also pays the COOP's owners. A fixed share of every sale, by default 20 %, goes at once to everyone who
			holds the COOP's MIND. So owners gain exactly when their COOP is useful, and a COOP pays its owners best by
			selling a lot to many people.
		</p>
		<p>
			Third, all money melts slowly, just as food spoils and machines wear out. It melts at a continuous rate of
			{pct(RATE * 100)} a year, which takes {pct(yearlyLoss() * 100, 1)} of an idle balance in a year. So wealth keeps
			moving and does not sit idle.
		</p>
		<p>
			We then show what follows from these rules. Money enters only as HEARTS, becomes MIND only by investment and
			leaves only by melting. So, with a constant population, the count of all HEARTS and MINDs settles at a fixed level
			per person. Each balance moves toward its own resting level: its yearly net inflow divided by the melt rate.
			Nobody stays rich by sitting still, and nobody starts with nothing for long.
		</p>
		<p>
			Once the money has settled, each person's relative position moves just as in Stéphane Laborde's Relative Theory
			of Money. Because HEARTS can only be invested, a project inside the city no longer has to beat the return of a
			bond; it only has to be useful. COOPs compete on the quality of their management. A personal AI agent, called an
			Aven, does the arithmetic for each person, so taking part needs only two simple choices a day.
		</p>
		<p>
			We will test theOS in two steps. First in a game, where AI agents live under its rules and we can measure and
			change every rule. Then for real, as the economy of maiaCITY, the city we are building. Our aim is to prove it
			first in a game, then in the real city.
		</p>
		<p class="keywords">
			<strong>Keywords:</strong> demurrage · personal currencies · universal dividend · Relative Theory of Money · post-labour economics ·
			cooperatives · automated market makers · protocol-owned liquidity · mechanism design
		</p>
		<p class="keywords"><strong>JEL:</strong> E42 · E51 · H41 · O33 · P13</p>
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
			Frey and Osborne estimated that 47 % of US jobs had a high risk of computerisation <Cite k="frey" />. Studies
			that look at the tasks inside each job find far less: about 9 % of jobs across the OECD, and 12 % in Germany
			<Cite k="arntz" />. Acemoglu estimates that AI raises total factor productivity, the output of all inputs together,
			by at most about 0.66 % over ten years <Cite k="acemoglu24" />. The ILO puts 3.3 % of world employment in the group
			most exposed to generative AI. It expects most of those jobs to change, not to disappear <Cite k="ilo25" />. And new
			work keeps appearing: most US jobs today are of kinds that did not exist in 1940 <Cite k="autor" />.
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
			prices goes to them. In Germany, the richest tenth own more than half of all net wealth, and the Gini index of
			wealth is {fmt(GINI_DE, 2)} <Cite k="bundesbank" />. The Gini index measures inequality: 0 means that everyone owns
			the same, 1 means that one person owns everything. Korinek and Suh show that wages can fall even before machines
			can do every task <Cite k="korinek" />.
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
			ownership is concentrated. Korinek and Suh compare paths of different speed <Cite k="korinek" />. Table 1 shows
			three of them, and what theOS does in each.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 1.</strong> Three speeds of automation, after the scenarios of Korinek and Suh, and the role of theOS in each.</caption>
				<thead>
					<tr><th>Speed</th><th>What machines do</th><th>Wages</th><th>What theOS does</th></tr>
				</thead>
				<tbody>
					<tr><td>Slow</td><td>Take over tasks one by one, as in recent decades; new kinds of work keep appearing</td><td>Keep rising; the share of income that goes to work falls slowly</td><td>Runs beside the euro. People keep their jobs, and their HEARTS add a growing stake of ownership</td></tr>
					<tr><td>Medium</td><td>Can do most tasks in about 20 years</td><td>Rise at first, then fall in more and more jobs</td><td>MIND from HEARTS, from work proposals and from dividends carries a growing share of each person's income</td></tr>
					<tr><td>Fast</td><td>Can do most tasks in about 5 years</td><td>Can collapse once machines spread faster than new capital is built</td><td>HEARTS become the main way to gain ownership. How plentiful the basics are depends on what the COOPs' machines make</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			The usual answer is a universal basic income: a fixed sum that everyone gets without conditions
			<Cite k="parijs" />. It would feed people, but it keeps the structure as it is. People would get consumption,
			never direction: they could spend, but they could not decide what the automated economy builds next.
		</p>
		<p class="thesis">
			This paper describes a way out. It keeps what markets do well and changes the base they stand on. We call the
			destination <em>Abundism</em>: an economy in which automation makes the basics plentiful, and every person helps to
			decide what the economy builds. In Abundism, distribution is always a question of fair participation through fair
			ownership. To get there, we must first look at the tool that both questions pass through:
			money. What is it, who creates it, and why does it behave the way it does?
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
			order.
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
			in Sections 8.1 and 11. Demurrage tells us how money should behave. It does not yet tell us where new money should
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
		<h2><span>4</span>The four laws</h2>
		<p>
			theOS rests on four laws. The protocol, the shared software at the base of theOS, fixes them the way a physics
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
			the cooperatives (COOPs) that one chooses. It is not a handout for survival. It gives each person a voice in where
			the automated economy puts its effort.
		</p>
		<p>
			Three cases need a clear rule. <strong>Who gets HEARTS:</strong> every human, with one stream each, however old
			and wherever born. One stream per human needs an identity that nobody can fake many times (Section 11).
			<strong>Children:</strong> a child gets HEARTS from birth. Until an age that the city sets, for example 16, a
			guardian directs the child's HEARTS. The MIND that they create belongs to the child. <strong>Death:</strong> the
			stream stops when a person dies. The MIND that the person leaves goes either to the City COOP of Section 8.1 or to
			heirs whom the person names. Section 11 keeps this choice open. An Aven, the personal agent of Section 7, invests
			only as its human directs.
		</p>
		<figure>
			<DayOfHearts />
			<figcaption>
				<strong>Figure 1.</strong> Law 1 in motion. Three people live through the same day. Each hour drops one HEART
				into each person's dial, in a currency of their own. At midnight the {UIA_DAY} HEARTS of the day leave, and
				their owners invest them into COOPs.
			</figcaption>
		</figure>
		<div class="law">
			<p class="lawname">Law 2 · Pure investment</p>
			<p>
				HEARTS earn no interest and cannot buy goods directly. They enter the economy only when their owner invests them
				into COOPs.
			</p>
		</div>
		<p>
			So a HEART is not money to spend. It is a vote with weight, and every person casts {UIA_DAY} of them every day.
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
				<strong>Figure 2.</strong> Laws 2 and 3 in motion. Anna sends out her HEARTS. A HEART that aims at goods or at
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
			divisions are COOPs. A COOP that grows large becomes its own eG (Section 11).
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
			<p>
				<strong>Every sale pays its owners.</strong> A fixed share of every sale, by default 20 %, goes to the COOP's
				owners at the moment of sale. It is paid in the COOP's own MIND, to everyone who holds that MIND, in proportion
				to what each one holds. A COOP can change its share by proposal, within a limit that the protocol sets.
			</p>
		</div>
		<p>
			Follow one HEART. Anna invests one AnnaHEART into the solar COOP. The HEART converts and is gone for good. Nobody
			holds it after that, not even the COOP. In its place, one new SOLARmind appears: half in Anna's wallet and half in
			the COOP's treasury. It is the same SOLARmind in both places, and it does every job.
		</p>
		<p>
			In Anna's wallet, the SOLARmind is her ownership: she is now a part-owner of the solar COOP. While she holds it,
			its value follows the COOP's success, through its price and through a share of every sale. When Anna switches on
			her lamp, she pays for the power in SOLARmind. She can pay with any MIND that she holds: the pools convert it, and
			the solar COOP always receives SOLARmind. What she spends goes back to the COOP. What she keeps stays her
			ownership.
		</p>
		<p>
			In the treasury, the SOLARmind is the COOP's working capital. A tenth of this half drips into the pools. The COOP
			spends the rest through proposals that its members accept. It <em>buys</em> panels: it pays in SOLARmind, the
			pools convert it, and the panel COOP receives PANELmind. And it <em>pays for work</em>. Mia's Aven proposes to
			clean the panels and to plan their repairs, the COOP accepts, and it pays Mia in SOLARmind. The treasury keeps
			what it needs to run for about two months. What it takes in beyond that, it pays out within weeks for more work
			proposals (Section 9.2). So the MIND that Anna paid for her light does not stay in the treasury, where it would
			only melt. It flows back out to people and to other COOPs, and the COOP grows what it can make.
		</p>
		<p>
			Law 4 also says who gains when a COOP sells: every sale pays its owners. This payment is the <em>dividend</em>.
			When Anna pays for her light, 20 % of her payment goes at once to everyone who holds SOLARmind. Anna holds
			SOLARmind too, so she gets a little of it back. The holders are people and other COOPs' treasuries. The solar
			COOP's own treasury and the pools get no share (Section 9). The other 80 % goes to the treasury. It pays for
			inputs, services, building, ground rent and accepted work proposals. Nobody has to vote on each dividend.
		</p>
		<p>
			This rule ties what owners gain to what the COOP does for others. A COOP pays its owners best when it sells a lot,
			and it sells a lot when many people find it useful. So each COOP works for good turnover: the total of its sales.
			Two guards keep this honest. First, only real deliveries count as sales. Otherwise two COOPs could sell to each
			other in a circle, and every round would move MIND from their treasuries to their holders. Second, a sale brings
			the treasury only what is left after the dividend. If that does not cover the cost of the delivery, the treasury
			loses on every sale. So more turnover pays only while prices cover costs (Section 11.2).
		</p>
		<figure>
			<FollowOneHeart />
			<figcaption>
				<strong>Figure 3.</strong> Law 4, step by step. One HEART converts into one SOLARmind. Half goes to Anna's
				wallet as her ownership, and half to the treasury as working capital. Anna pays for her light in SOLARmind, and
				most of it goes back to the treasury. The treasury pays it out again: a tenth of its half into the pool, the
				panel COOP through the pool in its own PANELmind, and Mia for her Aven's work proposal. A share of every sale
				goes at once to everyone who holds SOLARmind; Anna gets some back as a holder. The areas of the coins are to
				scale. Tap a number to go to a step.
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
		<Tex display tex={String.raw`B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t}, \qquad \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \tag{1}`} />
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
			<Tex tex="V" />. Whether it does is a hypothesis for the game. The evidence from earlier demurrage money is mixed,
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
				<strong>Figure 4.</strong> What remains of 100 idle HEARTS or MINDs. At theOS's 7 % a year, half is gone after
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
				<strong>Figure 5.</strong> All the demurrage curves <Tex tex={String.raw`B(t, r) = e^{-rt}`} /> as one surface.
				One axis shows the time held, the other the demurrage rate. The height shows what remains of one HEART or MIND.
				The terracotta line is the rate that you set with the slider, which also controls Figure 6. Drag the surface to
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
			below, and an inflated city's money falls to it from above. The gap halves every {fmt(halfLife(), 1)} years.
		</p>
		<p>
			But <Tex tex={String.raw`m^{*}`} /> is a count of tokens, not anyone's wealth. It includes the treasuries and the
			pools, and it adds different MINDs one for one. A single balance follows the same rule with its own net inflow. A
			balance with a net inflow of <Tex tex={String.raw`y_i`} /> a year tends to
			<Tex tex={String.raw`B_i^{*} = y_i / r`} />. A person who keeps the investor half of their own HEARTS, and spends
			nothing, tends to <Tex tex={String.raw`u/(2r) \approx ${tn(ownLevel())}`} /> MIND: half of
			<Tex tex={String.raw`m^{*}`} />. The other half goes to treasuries and pools, and treasuries pay most of it out
			again for work proposals (Section 9.2). A person whose net inflow is twice as large tends to twice the balance. So
			every balance moves toward about {fmt(1 / RATE, 1)} years of its own net inflow.
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
			only after about {fmt(yearsToReach(0.95))} years. During this transition, prices in MIND can rise (Section 5.3).
		</p>
		<p>
			There is no central bank, no interest rate to set and no inflation target. With a constant population, the money
			supply moves to <Tex tex={String.raw`N u / r`} /> from any start. The whole policy is the four laws and one rate.
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
				<strong>Figure 6.</strong> The average count of HEARTS and MINDs per person, in wallets, treasuries and pools,
				with a constant population. It is a count of tokens, not anyone's wealth. Three starts: none (a new city), the 7 %
				steady state, and a million per person. All three meet at <Tex tex="u/r" />, and a new city reaches 95 % of it
				after about {fmt(yearsToReach(0.95, rate))} years. Move the slider under Figure 5. A lower rate raises the steady
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
			<Tex tex="r" />.</em> Take a member who keeps the investor half of their own HEARTS, so that
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
			about the same factor. So prices stop drifting only once the money has settled.
		</p>
		<p>
			theOS does not take its rate from (4). The pair of 24 a day and 7 % a year comes from Circles v2
			<Cite k="circles2" />. Circles takes its 7 % as a yearly rate, applied day by day. theOS melts continuously, so 7 %
			a year takes {pct(yearlyLoss() * 100, 1)} of an idle balance in a year. Read through (4), 7 % matches a life of
			<Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years. So it is gentler than Laborde's
			{pct(rtmRate(80) * 100, 1)} for an 80-year life. A newcomer who starts with nothing holds
			{pct(reachedBy(40) * 100, 1)} of the average after 40 years, against {pct(reachedBy(40, rtmRate(80)) * 100, 1)} at
			Laborde's rate. So 7 % is a little kinder to the people who are already in.
		</p>
		<p>
			7 % also has reasons of its own. First, it sets the half-life of any idle holding, and of any advantage, at
			{fmt(halfLife(), 1)} years. A fortune fades within a lifetime, while a balance left idle for ten years still keeps
			{pct(decay(100, RATE, 10))} of its value. Second, it sets the steady state at {fmt(1 / RATE, 1)} years of
			issuance, a level that people can picture. Third, it sets the fairness dial of Section 9.2: at 7 % and a spread of
			returns of 20 %, the resting Gini index is {fmt(giniRest(0.2), 2)}. A lower rate allows more inequality, and a
			higher rate makes long saving much harder. Section 11 lists the rate as a parameter for the game.
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
			the market. So arbitrage keeps their prices consistent with each other, but not always right. Section 11 asks
			how to anchor them.
		</p>
		<p>
			The best-known AMMs pair two currencies, and outside investors supply them and can withdraw their money again.
			theOS does neither. Its pools hold baskets of many MINDs, and they belong to the protocol itself.
		</p>
		<div class="law">
			<p class="lawname">The liquidity rule</p>
			<p>
				A tenth of every COOP's treasury half flows automatically into liquidity pools: of each invested HEART, 5 %
				drips into the pools in the COOP's own MIND. What a COOP earns by selling is not levied. Each pool holds a basket of 4 to 8
				different MINDs. The COOP chooses which baskets its MIND joins. The pools belong to the protocol, not to any
				COOP. Nobody can ever withdraw what enters a pool; it leaves only through trades, or by melting.
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
				<strong>Figure 7.</strong> One HEART invested into a COOP converts into one MIND and is gone. Half of that MIND
				goes to the investor, half to the COOP's treasury, its working capital. Both halves are the same MIND. A tenth
				of the treasury half, 5 % of the HEART, flows on into the protocol's pools, baskets of 4 to 8 MINDs, and never
				returns.
			</figcaption>
		</figure>
		<h3>6.1 The design: one equal-weight basket</h3>
		<p>
			theOS uses only one pool design: the <em>geometric mean market maker</em>. We chose it because it is the most
			widely used design for pools of 4 to 8 volatile currencies. Balancer's weighted pools have used it since 2020
			<Cite k="balancer evans" />, and they now hold up to eight tokens, the same range as a theOS basket
			<Cite k="balancerDocs" />. The design has had incidents. In 2020, attackers drained Balancer pools that held tokens
			whose balances changed outside trades <Cite k="theblock20" />. In 2025, a rounding bug cost Balancer about 95
			million dollars <Cite k="balancerHack" />. Melting MINDs are such tokens. So theOS pools should apply the melt
			through one global index and never change a reserve directly (Section 11).
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
				redeem. A COOP adds its 10 % inflow to the pool in its own MIND only: a one-sided deposit.
			</li>
			<li>
				<strong>Inflows in small slices.</strong> When <Tex tex="d" /> of a MIND enters a pool, its price falls by the
				factor <Tex tex={String.raw`x_i/(x_i + d)`} />. Arbitrageurs then take about
				<Tex tex={String.raw`\tfrac12 V w_i (1 - w_i)\,\delta^2`} />, with
				<Tex tex={String.raw`\delta = \ln(1 + d/x_i)`} />, for inflows that are small against the reserve. If the
				inflow comes in <Tex tex="S" /> small slices, that loss falls about <Tex tex="S" />-fold. So the protocol adds
				inflows a little at a time, in every new block of transactions, as in the time-weighted AMM <Cite k="twamm" />.
			</li>
			<li>
				<strong>Routing by Avens.</strong> Avens, the personal AI agents of Section 7, route each trade. A trade between
				two MINDs goes through the pools that hold them. The best way to divide a trade across many pools is a convex
				problem: computers solve it fast, to any accuracy that we choose <Cite k="angerisMulti routing" />. Each extra
				hop also costs a fee, and that fixed cost makes the full problem harder. Section 11 proposes a hub MIND that
				keeps routes short.
			</li>
		</ul>
		<p>
			One property fits theOS especially well. Every MIND in a basket melts at the same 7 % a year. So demurrage shrinks
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
			correlation <Tex tex={String.raw`\rho`} />, a number for how closely the prices move together. Equation (6) assumes
			that prices move as a random walk and that arbitrage runs without fees <Cite k="lvr" />. The cost grows with how
			much MINDs move against one another. It grows only a little with the size of the basket. And the 0.3 % fee wins
			part of it back <Cite k="lvrfees" />.
		</p>
		<p>
			In theOS, the protocol's pools carry this cost, not any one wallet. The MIND in Anna's wallet is never part of a
			pool. But the cost is real, and people pay it together. Every investor gives 5 % of each HEART to the pools. What
			the pools lose goes to arbitrageurs, to whoever orders the transactions and to the fastest Avens. A speculative
			attack can make a pool smaller, but every COOP's working capital and its turbines keep going. Clearing trades in
			batches at one price could cut the cost further <Cite k="fmamm" />. But the analysis so far covers only
			two-currency pools, so theOS treats it as an upgrade to test in the game (Section 11).
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
				<strong>Figure 8.</strong> The cost (6) of keeping a basket liquid, before the fee wins part of it back. It
				assumes prices that move as a random walk, at volatilities like those of large company shares. In a basket of
				four, calm MINDs (20 % volatility) cost {pct(basketLvr(4, 0.2) * 100, 1)} of the pool a year. Wild MINDs (40 %)
				cost {pct(basketLvr(4, 0.4) * 100)}. When MINDs move together (correlation 0.6), the cost falls to
				{pct(basketLvr(4, 0.4, 0.6) * 100, 1)}. Going from 4 to 8 MINDs adds only about
				{pct((basketLvr(8, 0.4) / basketLvr(4, 0.4) - 1) * 100)}.
			</figcaption>
		</figure>
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
			People decide on values and goals, and Avens do the arithmetic. Each person makes two choices:
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
				<strong>Earning by work.</strong> An Aven can make a work proposal to a COOP: a service that creates value for
				the COOP, such as cleaning panels, planning a route or checking a design. If the COOP accepts, it pays the
				Aven's human in its own MIND. Work proposals are open to everyone, and they include care work and public work for
				the City COOP. This is how MIND flows from the treasuries back to people, and how COOPs grow what they can make.
			</li>
			<li>
				<strong>Collecting dividends.</strong> Under Law 4, a share of every sale goes at once to everyone who holds the
				seller's MIND. The Aven collects these dividends and can reinvest them. It keeps them as ownership, or it trades
				them through the pools into the MINDs that its human wants to own. Spreading its human's MIND over many COOPs
				also keeps the risk small (Section 9.2).
			</li>
			<li>
				<strong>Paying without thinking.</strong> When Anna takes a tram, her Aven finds the cheapest route through the
				pools of Section 6. The route goes from the MINDs she holds to the MIND that the tram COOP accepts. The Aven
				pays in the same moment. In the simulation of Section 9.2, once the pools have filled, such a payment costs
				about 0.44 %, mostly pool fees (0.35 %).
			</li>
			<li>
				<strong>Leaving a bad COOP.</strong> If a COOP becomes corrupt or wasteful, it delivers less for its MIND. Then
				its MIND falls in price against the other MINDs in the pools. The Aven sees that a HEART invested there now buys
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
		<h2><span>8</span>Why building for the long term pays</h2>
		<p>
			In capitalism, long-lived infrastructure is hard to finance, because every project competes with a safe
			alternative. That alternative is a government bond: a loan to the state that pays a fixed return for doing
			nothing. A 50-year tidal barrier must beat that return and also a risk premium, the extra return that investors
			want for a risk. Gesell and Keynes both saw this floor that a positive return on money puts under every investment
			<Cite k="gesell keynes36" />.
		</p>
		<p>
			In theOS, there is no safe alternative inside the city. HEARTS cannot be lent or parked; they can only be
			invested. Outside the city, euros remain a safe alternative for anyone who earns them (Section 11). Inside it, a
			project does not have to beat a bond. It only has to deliver something that people use. Idle HEARTS melt at 7 % a
			year, and the MINDs that an investment creates melt at the same rate. So no balance earns a return just for being
			held. A MIND pays its holder only through its COOP's success: a share of its sales, or a higher price. Compare
			what is left after <Tex tex="T" /> years of the same intent: left idle, or built into a project whose utility
			changes at its real rate <Tex tex="g" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \text{idle: } e^{-rT}, \qquad \text{built: } e^{gT} \\ r = 7\,\%,\ g = -1\,\%,\ T = 50 \;\Rightarrow\; ${tn(decay(100, RATE, 50))}\,\% \text{ against } ${tn(decay(100, 0.01, 50))}\,\% \end{gathered} \tag{7}`} />
		<p>
			What lasts is what the investment built. But the melt does not make the far future worth more to an investor: the
			investor's MIND melts too, so a share of use in fifty years is worth less to its holder than a share of use today.
			What the melt changes is who gains. The later years of a long-lived project serve the people who hold its MIND
			then, the next generations. Nothing pays for sitting still, so the only way to make intent last is to build what
			people keep using: grids, water systems, domes, rail. In the simulation of Section 9.2, the MIND of a long-lived
			geothermal plant grew to about 5.4 times its start in 20 years. That value includes its dividends, after the melt.
			For 20 years, (7) gives a factor of {fmt(decay(1, 0.01, 20) / decay(1, RATE, 20), 1)}. The MIND of a solar COOP
			that lost the market kept 0.26. So building for the long term pays the city, and it pays investors when their COOP
			wins. Whether Avens fund such long projects as readily as short ones is a question for the game (Section 11).
		</p>
		<figure>
			<LineChart
				title="1,000 HEARTS over 50 years, left idle or built into infrastructure"
				series={infra}
				x={{ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], fmt: (v, tip) => fmt(v), label: 'Left of 1,000: balance, or yearly use' }}
			/>
			<figcaption>
				<strong>Figure 9.</strong> The same 1,000 HEARTS, left idle under 7 % demurrage, or invested into
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
			Long-lived COOPs need good management for decades. The last part of the machine is how they govern themselves.
		</p>
	</section>

	<section id="governance">
		<h2><span>9</span>Governance that evolves</h2>
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
			competition between COOPs tests them. Three designs might share a sector:
		</p>
		<ul>
			<li><strong>COOP A</strong>, capital-weighted: one token, one vote. Large holders steer.</li>
			<li><strong>COOP B</strong>, strict direct democracy: one person, one vote on every operational choice.</li>
			<li>
				<strong>COOP C</strong> mixes three tools. It uses quadratic voting on strategy: two votes on one question cost
				four credits, and three votes cost nine. So people can show how strongly they care, but the largest holder
				cannot decide everything <Cite k="qv" />. An AI executive runs daily operations. And prediction markets answer
				questions of fact: people bet on outcomes, so the prices show what is likely <Cite k="hanson" />.
			</li>
		</ul>
		<p>
			These designs live on the protocol layer of Law 3. On the legal layer, a German eG gives each member one vote, or at most
			three, so COOP A's rule fits only inside the protocol. Avens send each HEART where it buys the most utility. Let
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
			a new COOP needs its first HEARTS from its founders and friends, and Section 11 asks how to keep that door open
			without self-dealing.
		</p>
		<figure>
			<LineChart
				title="Share of a sector's investment for three COOPs with different governance, over ten years"
				series={sel}
				x={{ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Share of investment' }}
			/>
			<figcaption>
				<strong>Figure 10.</strong> An example of (8), not a forecast. A starts as the most efficient, but it slowly
				becomes extractive: it gives back less for each HEART. B is steady but slow, and C starts behind and learns.
				Avens route the investment every month, so it follows the utility delivered. A leads until year
				{fmt(selNow.lead, 2)}, and after five years C has {pct(selNow.share)} of the sector. The result follows from the
				paths of efficiency that we assign, and A's slide does most of the work. If C never learned, it would still lead
				from year {fmt(selFlat.lead)}. If the game confirms paths like these, governance becomes a technology that can
				improve by selection.
			</figcaption>
		</figure>
		<h3>9.1 The whole machine</h3>
		<p>
			All the pieces are now in place. Here are the four laws of Section 4 once more:
		</p>
		<ol class="laws">
			<li><strong>Universal Intent Allocation.</strong> Every human gets 24 personal HEARTS a day, one per hour, from birth to death: one stream per human.</li>
			<li><strong>Pure investment.</strong> HEARTS earn no interest and buy nothing. Their owner can only invest them.</li>
			<li><strong>Open cooperative creation.</strong> Anyone can found a COOP, at any time, without permission, from HEARTS and at least three partner COOPs.</li>
			<li><strong>Every COOP has its own MIND, created by investing HEARTS.</strong> One HEART converts into one MIND, half to the investor, half to the COOP's treasury as working capital. Every sale pays its owners: a fixed share, by default 20 %, goes at once to everyone who holds the COOP's MIND.</li>
		</ol>
		<p>
			On top of the laws, each part of the machine has a clear job. Table 2 lists the parts. MIND is the one part that
			does several jobs on purpose: it carries ownership and use in one token.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 2.</strong> The parts of theOS and their jobs.</caption>
				<thead>
					<tr><th>Part</th><th>Its job</th><th>Comes from</th><th>Goes to</th></tr>
				</thead>
				<tbody>
					<tr><td>HEARTS</td><td>A person's intent: what they want built</td><td>The UIA, 24 a day per person</td><td>Converted into MIND by investment, or melted</td></tr>
					<tr><td>MIND</td><td>Ownership of a COOP and the means to use what it makes; people hold it as ownership and spend it to use, the COOP holds it as working capital</td><td>Every invested HEART, one for one: half to the investor, half to the COOP's treasury</td><td>Spent on what the COOP makes, and the seller always receives its own MIND; paid out again by COOPs, through proposals, for resources, services and work; 5 % of every HEART into the pools; or melted</td></tr>
					<tr><td>Dividends</td><td>Pay the owners of a COOP when it is useful (Law 4)</td><td>A fixed share of every sale, by default 20 %, at the moment of sale</td><td>Everyone who holds the seller's MIND, people and other COOPs' treasuries, in proportion to what each one holds</td></tr>
					<tr><td>Liquidity pools</td><td>Prices and trades between MINDs, and routes every payment into the seller's own MIND; owned by the protocol, not by a COOP</td><td>A tenth of every treasury half (5 % of every HEART), automatically, in baskets of 4 to 8 MINDs</td><td>Never withdrawn; MIND leaves a pool only through trades, or by melting</td></tr>
					<tr><td>Demurrage</td><td>The only way money leaves: 7 % a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's arithmetic: invest, trade, pay, propose work, collect dividends, leave</td><td>One per person</td><td>Work only for their human</td></tr>
					<tr><td>City COOP</td><td>Holds all land and what all citizens share, and leases land; never sells it</td><td>The city: every citizen holds one equal share</td><td>Ground rent in MIND from every builder; pays for streets, parks and water</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; tested by selection</td><td>Chosen by each COOP</td><td>Tested by where people invest</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Section 5.2 gave the monetary policy that connects these parts: money is issued as HEARTS, converted into MINDs,
			circulated as MINDs, and melted. Figure 11 shows the machine at work.
		</p>
		<figure class="wide">
		<Circulation />
		<figcaption>
				<strong>Figure 11.</strong> The whole machine, simulated. People on the outer ring invest their daily HEARTS
				(terracotta) into six COOPs. Each HEART converts into that COOP's MIND as it arrives, so the COOP
				never holds a HEART. Half returns to its investor (gold), and half sinks into the COOP's treasury, its working
				capital, whose ring grows and slowly melts. Every few seconds, one COOP becomes extractive: its MIND buys less utility, so
				the gold half that returns is worth less (a smaller dot). The Avens see that a HEART buys less utility there, and they send investment to the other COOPs without
				any vote. The animation runs the rates faster, so you can see the melting.
			</figcaption>
		</figure>

		<h3>9.2 Who owns the machine: fair ownership, in numbers</h3>
		<p>
			Section 1 asked who gets what the machines make. Now we can answer with numbers. Let <Tex tex="W_i" /> be the MIND
			that person <Tex tex="i" /> owns, valued in a common basket of MINDs. Let <Tex tex="a" /> be what the person
			keeps each year: half of what their own HEARTS convert into, plus what their Aven earns by work, minus what they
			spend. Demurrage takes <Tex tex={String.raw`r\,W_i`} />, so a holding moves toward <Tex tex="a/r" />. A person
			who keeps the MIND from their HEARTS and pays for daily life from work income keeps <Tex tex="a = u/2" />. If
			everyone keeps the same amount each year, every holding moves toward the same resting level
			<Tex tex={String.raw`W^{*} = u/(2r) \approx ${tn(ownLevel())}`} /> MIND. Start with holdings as unequal as
			Germany's today, with a Gini index <Tex tex="G_0" /> and a mean <Tex tex="m_0" />. Then the Gini index after
			<Tex tex="t" /> years is
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
			But people do not all keep the same. Work income differs, and so does spending. Each holding then settles at its
			own level, <Tex tex={String.raw`a_i/r`} />, and inequality settles at the spread of what people keep, not at zero.
			An agent-based simulation of the whole economy, with 250 people and nine COOPs under the rules of this paper,
			shows how much this matters (Appendix G). In the simulation, 60 % of people offer work. The Gini index of what
			people hold settles near 0.54, against Germany's {fmt(GINI_DE, 2)}. People who offer work hold 14.6 times as much
			as those who offer none. If everyone can offer some work, the Gini index settles near 0.32. A shock can make
			holdings about as unequal as Germany's, at 0.70. Then the Gini index falls to 0.51 in 10 years and to 0.48 in 20.
			It falls toward its resting level, not toward zero.
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
			its Lorenz curve gives (10). A simulation of the process agrees with (10) to within 0.003. ∎ So inequality
			stays bounded if, and only if, demurrage is larger than the best lasting return on holdings. This is theOS's own
			form of Piketty's <Tex tex="r > g" />. Proposition 2 bounds the spread that returns create. Unequal work income
			adds its own spread on top.
		</p>
		<p>
			Dividends are such a return. Under Law 4, a COOP's dividend yield is its share of every sale, times its yearly
			sales, divided by the MIND that others hold. Dividends make holding pay, and with the same yield
			<Tex tex={String.raw`\mu`} /> for everyone, the resting level rises to <Tex tex={String.raw`a/(r - \mu)`} />. But
			they slow the levelling: an inherited fortune fades at the net rate <Tex tex={String.raw`r - \mu`} />, not at
			<Tex tex="r" />. And they widen the spread. At a spread of returns of 20 %, a yield of {pct((RATE / 2) * 100, 1)}
			a year would raise the resting Gini index of (10) from {fmt(giniRest(0.2), 2)} to
			{fmt(giniRest(0.2, RATE, RATE / 2), 2)}. So dividends are safe only while every COOP's yield, plus any lasting
			rise of its price, stays below the melt. The protocol's limit on the share must keep it there. At the default
			share of {pct(DIVIDEND_SHARE * 100)}, the yield stays below the melt while yearly sales stay below
			{pct(salesBound() * 100)} of the MIND that others hold.
		</p>
		<p>
			In the simulation, 20 % meets this condition by a wide margin. In a year, sales are only about 3 % of the MIND
			that people hold, and 20 % of 3 % is about 0.6 %. At rest, the yield is 0.6 to 0.7 % a year. The lasting return
			<Tex tex={String.raw`\mu`} />, dividends plus price, is 0.4 %, far below the 7 % melt. Shares of 10 %, 20 % and 30
			% give yields of 0.4 %, 0.7 % and 1.1 %. The yield is high only at the start, while little MIND exists. It is 27 %
			in year 1, 3 % in year 5 and 1.2 % in year 10. Early holders gain more, and the melt removes that edge.
		</p>
		<p>
			Dividends alone do not bring the MIND to people. The rest of every sale lands in the treasury. If treasuries keep
			their surplus, most MIND sits there and melts. People then hold only 26 % of all MIND, even with the dividend at
			20 %. If treasuries pay their surplus out for work proposals, people hold 94 %. At rest, treasuries then pay 80 %
			of what they take in for work proposals and 9 % as dividends. About a tenth goes to operating wages, inputs and
			ground rent. So fair ownership needs one more rule for treasuries:
		</p>
		<div class="law">
			<p class="lawname">The payout rule (proposed)</p>
			<p>
				A treasury keeps a working-capital target: about 60 days of running costs and planned building. It pays out the
				rest within weeks, for work proposals that its members accept.
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
				<strong>Figure 12.</strong> An illustration of (9) and (10), not a forecast. Everyone starts as unequal as
				Germany today. If everyone keeps the same amount each year and all holdings earn the same return, inequality
				halves every {fmt(halfLife(), 1)} years and goes to zero. If returns spread by 10 % or 20 % between people, it
				settles at {fmt(giniRest(0.1), 2)} or {fmt(giniRest(0.2), 2)}. Unequal work income adds its own spread: in the
				simulation, the Gini index settles near 0.54. Under capitalism it stays where it is.
			</figcaption>
		</figure>
		<p>
			So the level of fairness depends on how evenly income reaches people, and on two dials: the rate of demurrage,
			and how much people's returns spread. Avens
			that spread each person's MIND over many COOPs keep <Tex tex={String.raw`\sigma`} /> small. A basket of 8
			independent MINDs has about a third of the spread of one MIND. So diversification is part of fairness, not only a
			convenience.
		</p>
		<figure>
			<LineChart
				title="Resting Gini index of ownership against the spread of returns, for three rates"
				series={dial}
				x={{ min: 0.05, max: 0.5, ticks: [0.1, 0.2, 0.3, 0.4, 0.5], fmt: (v, tip) => (tip ? `Spread ${fmt(v * 100)} %` : `${fmt(v * 100)} %`), label: 'Spread of returns between people (σ)' }}
				y={{ min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => fmt(v, 2), label: 'Resting Gini index' }}
				refs={[{ axis: 'y', at: GINI_DE, label: `Germany today: ${fmt(GINI_DE, 2)}` }]}
			/>
			<figcaption>
				<strong>Figure 13.</strong> The fairness dial, from (10). A higher rate of demurrage or a smaller spread of
				returns gives a fairer resting state. At 7 % and a spread of 20 %, the Gini index is {fmt(giniRest(0.2), 2)}.
				If people hold one COOP each (a spread of about 40 %), it is {fmt(giniRest(0.4), 2)}, still below Germany's
				{fmt(GINI_DE, 2)} today.
			</figcaption>
		</figure>
		<p>
			Now we can say what <em>fair</em> means in theOS. It means three things. <strong>Equal issuance:</strong> every
			person gets the same flow of new ownership, {UIA_DAY} HEARTS a day, whatever their wealth, work or birth.
			<strong>Self-direction:</strong> each person decides what their share builds. <strong>Bounded advantage:</strong>
			every holding melts, so any advantage from luck, skill, work or inheritance fades unless the holder earns it
			again. Without dividends, it halves in {fmt(halfLife(), 1)} years. Fair participation follows from fair ownership: every person owns and steers the
			automated economy in equal measure of issuance.
		</p>
		<p>
			theOS does not promise equal outcomes. People who use more own less. People whose work serves others earn more.
			People who choose better COOPs hold more. theOS promises that no difference grows without limit, and that nobody
			inherits a difference for long. In Rawls's terms, theOS is a property-owning democracy whose "beginning of each
			period" is every day <Cite k="rawls" />.
		</p>
	</section>


	<p class="partline" id="part-3">Part III · Toward Abundism</p>

	<section id="city">
		<h2><span>10</span>Proving it: first a game, then a city</h2>
		<p>
			Nobody can run a whole economy in a laboratory. And nobody should test it on people's lives first. So maiaCITY
			tests theOS in two steps. The first step is a game. In its world, AI agents with their own needs and goals live,
			trade and invest under the rules of this paper. Every rule is a parameter: we can measure it, change it through an
			open proposal and play again.
		</p>
		<p>
			So the claims of Sections 5 to 9 become experiments, not hopes. For each claim, we publish a prediction before the
			run, together with the result that would refute it. AI agents are not people, so the game first tests the code and
			the mechanisms. Sessions with paid human players, and then a small pilot, test how people behave. The early worlds
			already run the first layer. This layer has 24 HEARTS a day that melt at 7 % a year, and COOPs whose MIND people
			get when they invest. The second step is the real city. The rules that survive the game become the economy of
			maiaCITY while we build it.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 3.</strong> Each part of theOS, first in the game, then in the city.</caption>
				<thead>
					<tr><th>Part</th><th>In the game</th><th>In the city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>Every agent gets 24 personal HEARTS a day, which it can only invest</td><td>Every person with a verified identity gets 24 personal HEARTS a day: one stream per human</td></tr>
					<tr><td>Demurrage</td><td>Continuous, Eq. (1), on HEARTS and MINDs</td><td>The same rule, fixed in the protocol</td></tr>
					<tr><td>COOPs</td><td>Agents found COOPs and invest HEARTS, which convert into MIND</td><td>An energy COOP for a village's geothermal plant, a food COOP for its food forest, a housing COOP for its domes</td></tr>
					<tr><td>Dividends</td><td>20 % of every sale goes at once to the agents that hold the seller's MIND</td><td>The same; each COOP can change its share by proposal, within the protocol's limit</td></tr>
					<tr><td>Markets</td><td>Protocol-owned baskets of 4 to 8 MINDs, fed with 5 % of every invested HEART</td><td>Avens route every purchase through the pools; the seller gets its own MIND</td></tr>
					<tr><td>Land</td><td>One City COOP holds the map; agents lease plots and pay ground rent</td><td>The City COOP holds all land; every citizen holds one equal share; builders lease plots like an Erbbaurecht</td></tr>
					<tr><td>Agents</td><td>AI agents with memory and goals; later, human players join them</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Governance</td><td>Rule changes as open proposals, measured world by world</td><td>COOPs choose their own governance and compete (Section 9)</td></tr>
				</tbody>
			</table>
		</div>
		<h3>10.1 A roadmap in four steps</h3>
		<ol>
			<li><strong>Continuous demurrage.</strong> Run Eq. (1) in the game, and measure how the behaviour of agents changes with the rate.</li>
			<li><strong>HEARTS into MINDs.</strong> Let agents found several COOPs, each with its own MIND and treasury, and with its MIND in the protocol's pools. Watch which COOPs survive.</li>
			<li><strong>Human intents.</strong> Let people make the two daily choices of Section 7 and leave the rest to their Aven. Then humans and AI agents share one economy.</li>
			<li><strong>The first real village.</strong> One village centre with its energy, food and housing COOPs, which run on the rules that survived the game.</li>
		</ol>
		<p>
			Before we build the city, the game must also answer the questions that this paper cannot answer yet.
		</p>
	</section>

	<section id="limits">
		<h2><span>11</span>Limitations and open problems</h2>
		<p>
			A blueprint is only scientific if it says where it could fail. Each item below names an open problem, a rule that
			we propose for it, and how the game tests it. Every proposed rule works inside the four laws. Appendix E collects
			the attacks in one threat model.
		</p>
		<h3>11.1 People and identity</h3>
		<ul>
			<li>
				<strong>One person, one stream.</strong> The UIA needs an identity that nobody can fake many times. The name for
				this property is Sybil resistance. A fake identity directs {fmt(u)} HEARTS a year, so the prize for faking is
				large. It must work without a central registry that can exclude people <Cite k="soul" />. Passkeys prove a
				device, not a unique person, so maiaCITY's passkey-based vaults are a start, not a proof. We propose to stage
				it. The game and the first village use an in-person register of residents. The city uses a state eID with a
				zero-knowledge proof: a cryptographic proof that shows only "a unique resident" and nothing else. Everyone gets
				the full 24 HEARTS. But a new identity can direct only a capped share into any one COOP until others vouch for
				it. Regular checks make rented keys go stale. <em>Test:</em> farms of fake agents in the game.
			</li>
			<li>
				<strong>Estates.</strong> When a person dies, the MIND that they leave goes to the City COOP or to heirs whom
				they name (Law 1). The choice barely changes inequality, because the melt shrinks any bequest fast: only
				{pct(decay(100, RATE, 30))} of it is left after 30 years. But people hold a large part of all MIND, so the
				choice matters for the City COOP's budget. <em>Test:</em> the game runs both rules side by side.
			</li>
			<li>
				<strong>Work, care and payments between people.</strong> COOPs pay for work through accepted proposals (Law 4).
				Work proposals are open to everyone, including care work and public work for the City COOP. This matters for
				fairness: in the simulation, people who offer work hold 14.6 times as much as those who offer none. Open
				questions remain. How do care, art and research get paid when they sell little? And how does MIND pass between
				people, for a babysitter or a gift? Voluntary investment tends to underfund what everyone shares
				<Cite k="qf" />. We propose a default share of HEARTS, which each person can change, for COOPs that serve
				everyone, such as care, courts and research. <em>Test:</em> the game measures which work goes unpaid.
			</li>
		</ul>
		<h3>11.2 COOPs and their treasuries</h3>
		<ul>
			<li>
				<strong>Self-dealing and related parties.</strong> Nothing in the laws stops a founder from investing in his own
				COOP. He then controls {fmt(selfDealDay(), 1)} MIND a day instead of {fmt(honestDay())}: both halves, less the
				tenth that drips into the pools. Four friends can act as each other's three basket partners, and trade MINDs
				that make nothing for real ones. Two COOPs could also sell to each other in a circle. Every round would move
				MIND from their treasuries to their holders as dividends (Law 4). We propose a related-party rule. When a COOP's
				founders, officers or their relatives invest, the treasury half waits in a locked account (escrow) until an
				audit confirms real output. A treasury pays nobody who invested in recent months, except for audited work. Every
				treasury flow is public, and the share of inflow from a COOP's own controllers is capped. Only real deliveries
				count as sales under Law 4: a meter or a buyer outside the COOP's related parties must confirm each one. Sales
				between related COOPs pay no dividend. Selling below cost cannot buy turnover for long. The treasury keeps only
				what is left after the dividend, so it loses on every such sale until it is empty. <em>Test:</em> kickback
				COOPs, investment rings and circular sales as attackers in the game.
			</li>
			<li>
				<strong>Who decides inside a COOP.</strong> Each COOP chooses its own rules, but its founders write the first
				ones. We propose a default constitution that holds until the members change it by a large majority. It follows
				the holder rule of Section 9 and gives one member one vote on membership. Every member has the rights to
				information, audit, election and recall. Avens raise a second question: whoever sets an Aven's defaults steers
				investment. So a person's own choices bind their Aven, and the Aven optimises only inside them. <em>Test:</em>
				the game compares COOPs with and without the default.
			</li>
			<li>
				<strong>Failure and wind-down.</strong> If every Aven leaves, a corrupt COOP still holds
				{pct(decay(100, RATE, 1))} of its treasury after a year. So exit alone works slowly. We propose recall and
				receivership: when inflows fall below a threshold or an audit fails, a trustee freezes the treasury, and the
				members vote. Then an order of payment applies: work first, then supplier COOPs. The physical assets go to the
				City COOP, which leases them to a COOP that runs them better, without a forced sale. In the simulation, this
				rule worked. When the main food COOP failed and the City COOP leased its plant on, food fell 9 % short for one
				year. Without the rule, it fell 100 % short. The order of payment must itself resist capture by a small group,
				and the legal wrapper must match it. <em>Test:</em> more injected failures in the game.
			</li>
			<li>
				<strong>Long-lived projects.</strong> A treasury's savings melt while it saves, and theOS has no credit. So a
				tidal barrier or a fusion plant needs binding pledges of HEARTS over years before it can start. Euro credit
				from a cooperative bank, at the legal layer, is another path. <em>Test:</em> the game measures whether Avens
				fund such projects.
			</li>
		</ul>
		<h3>11.3 Pools and prices</h3>
		<ul>
			<li>
				<strong>Basket admission, and a dying MIND.</strong> An equal-weight pool keeps an equal share of its value in
				each MIND, so it keeps buying a falling MIND all the way down. If one MIND loses 99 % of its value, a pool of
				four keeps {pct(poolAfterCrash(0.01, 4) * 100)} of its value. The same tokens, simply held, would keep
				{pct(heldAfterCrash(0.01, 4) * 100)}, and a pool of eight keeps {pct(poolAfterCrash(0.01, 8) * 100)}. We propose
				that a MIND joins a basket only after verified output and with the consent of the COOPs already in it. Its
				founders also post a bond that they lose on fraud. A breaker stops a pool from taking in a failing MIND, while
				the pool still sells it. The breaker reacts to events, such as failed deliveries, not to prices. The failing
				COOP's inflow stops too. Once the COOP has failed, its MIND leaves the baskets. In the simulation, a failed
				COOP's MIND kept a pool price, and its holders could still swap it for their partners' MIND. The healthy
				reserves could then move into a successor pool. That needs one decision: whether "never withdrawn" means "never
				leaves the protocol's pools". A daily cap on sales of each MIND slows runs. A hub MIND in every basket, for
				example CITYmind, keeps routes short and the network connected. <em>Test:</em> junk dumping, price pumps and
				sudden failures in the game.
			</li>
			<li>
				<strong>Front-running and batch clearing.</strong> Every Aven payment is a small, predictable trade, and the
				pools' inflows are public. A bot can trade just before and just after it, an attack called a sandwich.
				Whoever orders the transactions can capture this value too. We propose one batch at one price per block across
				all pools, with orders sealed until the batch closes, and public rules for ordering. Avens also follow
				time-averaged prices, and only at a limited speed, so that a pushed price cannot buy investment.
				<em>Test:</em> sandwich bots and price pumps in the game.
			</li>
			<li>
				<strong>A unit of account.</strong> Every COOP prices in its own MIND, and 1,000 COOPs have
				{fmt(pairCount(1000))} exchange rates between them. People need one number to compare prices. We propose a
				<em>par index</em>. The protocol publishes each MIND's time-averaged pool price against the average of all
				MINDs, and Avens quote prices and rank COOPs in it. It is a number to count in, not a third currency. Each COOP
				also publishes what one of its MIND buys, for example kWh per SOLARmind. <em>Test:</em> the game measures how
				stable the index stays.
			</li>
			<li>
				<strong>Liquidity that never leaves.</strong> Nobody can withdraw from the pools, so nobody can repair a pool by
				moving money out, and every bug stays exposed. So the code must be right from the start. It needs verified
				maths, rounding in the pool's favour and one global melt index. A narrow pause may stop trading but never move
				funds (Appendix F). Equal-weight baskets are in wide use, but never yet with steady one-sided inflows, no
				withdrawals and melting currencies. <em>Test:</em> the game, a red team and a bug bounty test this mix before
				real value flows.
			</li>
		</ul>
		<h3>11.4 The city, the euro and the law</h3>
		<ul>
			<li>
				<strong>Escape into assets.</strong> Melting money pushes wealth into anything that does not decay
				<Cite k="keynes36" />. The land rule of Section 8.1 closes the largest door. Other stores of value remain, such
				as euros, art or rare objects. theOS must also decide how the City COOP sets the ground rent, and how citizens
				decide what it builds with it. <em>Test:</em> the game offers assets that do not melt, and measures how much
				wealth flows into them.
			</li>
			<li>
				<strong>The euro border.</strong> Panels, chips, medicine and insurance cost euros, and taxes are due in euros,
				even on services paid in MIND. No supplier outside the city accepts SOLARmind. The alternative currencies that
				lasted kept a bridge to national money; the Chiemgauer charges a fee to change back into euros
				<Cite k="gelleri" />. We propose that each COOP is a legal eG with a euro balance sheet. COOPs that sell power,
				heat, food or services outside the city earn euros, and a shared euro reserve pays for imports and taxes.
				Changing MIND into euros carries a fee, and individuals cannot redeem MIND for euros. Each COOP publishes a euro
				reference price and keeps a tax reserve. <em>Test:</em> the game adds an outside euro economy that agents can
				trade with and leave for.
			</li>
			<li>
				<strong>Securities and co-op law.</strong> Under EU rules, a token that carries ownership and can be traded is
				likely a security, with the duties of one <Cite k="esma" />. Pools and trading Avens may count as licensed
				crypto services, and each trade may be a taxable sale. HEARTS, which nobody can transfer, probably fall outside
				crypto law. We propose to run COOPs as divisions of an umbrella eG. Investing a HEART makes the investor a
				member with one vote. The legal wrapper describes MIND as a member's share and right to the COOP's services. A
				legal opinion, and rulings from BaFin, Germany's financial supervisor, and from the tax office, come before any
				real value flows. <em>Test:</em> the game counts the taxable trades that each Aven makes.
			</li>
			<li>
				<strong>The cold start of the first village.</strong> A COOP needs three partners before its MIND can trade, so
				the first COOPs wait for each other. Circles, with the same 24 a day and 7 %, had about 25,000 registered people
				in mid-2026 <Cite k="gnosis" />. Empty pools are a second trap: in the simulation, 94 % of people went short on
				day one, because no Aven could convert MIND. We propose a bootstrap mode. The City COOP and the energy, food and
				housing COOPs launch together as the first basket, and the pools are seeded before the city opens. Until they
				trade, each MIND buys its own COOP's service at a published rate. Euros fund the first machines, so that the
				COOPs deliver from day one. Residents can pledge future HEARTS to a founding as a standing order. <em>Test:</em>
				the game's first village, judged by kWh delivered per HEART and the time to the first kWh.
			</li>
		</ul>
		<h3>11.5 The rate and the conditions of fairness</h3>
		<ul>
			<li>
				<strong>The rate.</strong> 7 % comes from Circles v2 and has its own reasons (Section 5.3). Laborde's rule would
				give {pct(rtmRate(80) * 100, 1)} for an 80-year life. <em>Test:</em> the game measures how behaviour changes
				from 3 to 12 %.
			</li>
			<li>
				<strong>The conditions of fairness.</strong> The fairness of Section 9.2 holds only under seven rules. First, no
				holder may earn more than the rate of demurrage, year after year, on any holding. Arbitrage profits from the
				protocol pools are such a return, so they must flow back to all Avens, or batch trading must remove them.
				Dividends under Law 4 are such a return too. A COOP's dividend yield, plus any lasting rise of its price, must
				stay below the 7 % melt. In the simulation, the default share of 20 % meets this by a wide margin (Section 9.2).
				Second, every COOP must accept HEARTS from anyone, one for one. A COOP that closes its doors creates scarcity
				for its first owners. Third, theOS must decide how euros can buy MIND, because those purchases bring outside
				inequality in. Fourth, the MIND of people who die goes to the City COOP or to named heirs, and theOS must choose
				(Section 11.1). Fifth, COOPs pay out what they take in. Dividends alone are not enough: a COOP that keeps the
				rest of its sales in its treasury slowly becomes its own owner. In the simulation, if treasuries keep their
				surplus, people hold 26 % of all MIND, even with the dividend at 20 %. With the payout rule of Section 9.2, they
				hold 94 %. Sixth, land stays with the City COOP. In an earlier end-to-end model, private land kept the Gini
				index near 0.5; with all land in the City COOP, it settled at 0.29. Seventh, work proposals stay open to
				everyone, because unequal work income adds its own spread (Section 9.2). <em>Test:</em> the game measures the
				spread of returns, the dividend yields, the spread of work income and the Gini index of ownership.
			</li>
		</ul>
	</section>

	<section id="synthesis">
		<h2><span>12</span>From capitalism to Abundism</h2>
		<p>
			We started with two questions: who gets what is made, and who decides what is made next. Capitalism answered both
			with wages and ownership, and automation begins to remove that answer. theOS answers them differently: everyone
			gets an equal, daily share of direction and of ownership. That share can only build things. What it builds belongs
			to those who hold its MIND, on land that belongs to everyone. Every sale pays those owners a share, so a COOP
			gains exactly when it is useful. All money melts like the world it measures, so nobody can keep wealth idle and
			out of reach. The whole architecture fits in one line:
		</p>
		<Tex display tex={String.raw`\left(\mathrm{HEARTS} + \mathrm{MINDS}\right) \cdot \mathrm{ACTION} = \mathrm{ABUNDANCE} \tag{11}`} />
		<p>
			<strong>HEARTS</strong> are human intent, issued equally to everyone, every day. <strong>MINDS</strong> are what
			that intent becomes: the shared intelligence of the COOPs, ownership and utility in one. <strong>ACTION</strong>
			is the conscious act that converts the one into the other. Neither intent without capacity nor capacity without
			intent builds anything. Only the product does, within the limits of one planet <Cite k="raworth" />.
		</p>
		<p>
			In capitalism, human action was sold by the hour so that people could survive. In Abundism, survival is the
			baseline that the machines provide. Human action becomes steering: deciding, every day and together, what the city
			builds next. maiaCITY will prove it first in a game, and then in the real city.
		</p>
	</section>

	<p class="partline" id="appendices">Appendices</p>

	<section id="assumptions">
		<h2><span>A</span>Assumptions</h2>
		<p>
			The results of this paper rest on these assumptions. Each one marks a place where the game must look first.
		</p>
		<ol>
			<li><strong>A closed city.</strong> The models leave out euros, imports, exports and taxes (Section 11.4).</li>
			<li><strong>A constant population,</strong> except where Section 5.2 adds growth. Equation (3) holds only then.</li>
			<li><strong>Prompt investment.</strong> Avens invest HEARTS as they arrive, so few HEARTS sit unused.</li>
			<li><strong>One human, one stream.</strong> Identity works, and nobody directs the HEARTS of fake people (Section 11.1).</li>
			<li><strong>Faithful Avens.</strong> Each Aven serves only its human, follows its human's choices and makes no costly mistakes.</li>
			<li><strong>Treasuries pay out.</strong> Law 4 sends 20 % of every sale to the holders. For the rest, COOPs follow the payout rule of Section 9.2. They keep about 60 days of costs and pay out the surplus for work proposals.</li>
			<li><strong>Honest prices.</strong> Time-averaged pool prices reflect the use that each MIND buys.</li>
			<li><strong>Connected baskets.</strong> Every MIND in a basket can reach every other MIND through the pools.</li>
			<li>
				<strong>Random returns.</strong> In Proposition 2, holdings are valued in a common basket of MINDs. Their
				returns move as a random walk, with a lasting return below the melt.
			</li>
			<li><strong>Land in the City COOP.</strong> All land belongs to the City COOP and is only leased (Section 8.1).</li>
			<li>
				<strong>Enough output.</strong> The COOPs' machines make enough per person to cover the basics. No rule about
				money can make up for missing output.
			</li>
		</ol>
	</section>

	<section id="notation">
		<h2><span>B</span>Notation</h2>
		<p>
			A few letters mean different things in different sections, as in the sources that the paper follows. Table 4
			lists each symbol and where it is used.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 4.</strong> The symbols of the paper.</caption>
				<thead>
					<tr><th>Symbol</th><th>Meaning</th><th>Section</th></tr>
				</thead>
				<tbody>
					<tr><td><Tex tex="M, V, P, Q" /></td><td>Fisher's money, velocity, prices and goods</td><td>2</td></tr>
					<tr><td><Tex tex="r" /></td><td>The melt rate, 0.07 a year. In Section 1 only: Piketty's return on capital</td><td>1, 5</td></tr>
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
					<tr><td><Tex tex={String.raw`d,\ \delta,\ S`} /></td><td>An inflow into a pool, its log size, and the number of slices it comes in</td><td>6.1</td></tr>
					<tr><td><Tex tex="V" /></td><td>A pool's value. In Section 2 only: Fisher's velocity</td><td>2, 6</td></tr>
					<tr><td><Tex tex={String.raw`\sigma,\ \Sigma,\ \rho,\ \ell`} /></td><td>Volatility, covariance and correlation of prices, and the yearly loss-versus-rebalancing</td><td>6.2</td></tr>
					<tr><td><Tex tex="T" /></td><td>A time horizon in years</td><td>8</td></tr>
					<tr><td><Tex tex={String.raw`s_i,\ f_i,\ \bar f,\ \kappa`} /></td><td>A COOP's share of its sector's investment, its utility per HEART, the average utility, and the speed of selection</td><td>9</td></tr>
					<tr><td><Tex tex={String.raw`W_i,\ W^{*},\ a`} /></td><td>A person's MIND holding, its resting level, and what the person keeps each year</td><td>9.2</td></tr>
					<tr><td><Tex tex={String.raw`\mu`} /></td><td>The lasting return on a holding: dividend yield plus any lasting price rise</td><td>9.2</td></tr>
					<tr><td><Tex tex={String.raw`\sigma,\ dZ,\ \alpha`} /></td><td>The spread of returns between people, random noise, and the shape of the resting spread</td><td>9.2</td></tr>
					<tr><td><Tex tex={String.raw`G,\ G_0,\ G_{\infty}`} /></td><td>The Gini index of ownership: over time, at the start, and at rest</td><td>9.2</td></tr>
				</tbody>
			</table>
		</div>
	</section>

	<section id="glossary">
		<h2><span>C</span>Glossary</h2>
		<dl class="glossary">
			<dt>HEARTS</dt>
			<dd>A person's own currency of intent, 24 a day. HEARTS buy nothing, earn nothing and can only be invested into COOPs.</dd>
			<dt>MIND</dt>
			<dd>A COOP's own currency of ownership and utility. To hold it is to own part of the COOP; to spend it is to use what the COOP makes.</dd>
			<dt>COOP</dt>
			<dd>A cooperative enterprise that makes something a city needs, such as energy, food or housing. It has its own MIND and treasury.</dd>
			<dt>Treasury</dt>
			<dd>A COOP's working capital: its own MIND and the MINDs of other COOPs that it buys for its own needs. It never holds HEARTS.</dd>
			<dt>Conversion</dt>
			<dd>The moment an invested HEART becomes one MIND: half to the investor, half to the COOP's treasury.</dd>
			<dt>Dividend</dt>
			<dd>Under Law 4, a fixed share of every sale, by default 20 %. It goes at once to everyone who holds the seller's MIND, in proportion to their holding. It is not Laborde's universal dividend of Section 3, which is new money.</dd>
			<dt>Work proposal</dt>
			<dd>An offer of work that creates value for a COOP, made by a person's Aven. If the members accept it, the COOP pays in its own MIND.</dd>
			<dt>Payout rule</dt>
			<dd>A proposed rule: a treasury keeps about 60 days of running costs and pays out the rest within weeks, for work proposals.</dd>
			<dt>Turnover</dt>
			<dd>The total of a COOP's sales over a time. Only real deliveries count.</dd>
			<dt>Melt, demurrage</dt>
			<dd>To melt is to shrink continuously, at a rate of 7 % a year. Demurrage is the name of that holding cost.</dd>
			<dt>UIA</dt>
			<dd>Universal Intent Allocation, Law 1: the right of every human to invest 24 HEARTS a day.</dd>
			<dt>Pool, basket</dt>
			<dd>A protocol-owned store of 4 to 8 MINDs in equal value shares, which anyone can trade against and nobody can withdraw from.</dd>
			<dt>G3M</dt>
			<dd>Geometric mean market maker: the pool formula (5), which keeps the geometric mean of the reserves constant in every trade.</dd>
			<dt>LVR</dt>
			<dd>Loss-versus-rebalancing: what a pool loses to arbitrageurs when prices move, against a perfect rebalancer.</dd>
			<dt>Par index</dt>
			<dd>A proposed published number: each MIND's time-averaged pool price against the average of all MINDs. It is a unit to count in, not a currency.</dd>
			<dt>Aven</dt>
			<dd>A personal AI agent that works only for its human: it invests, trades, pays, proposes work and collects dividends.</dd>
			<dt>City COOP</dt>
			<dd>The COOP that holds all land and everything that all citizens share. Every citizen holds one equal share, as a membership.</dd>
			<dt>Ground rent, Erbbaurecht</dt>
			<dd>The yearly fee for a leased plot, paid in any MIND and received as CITYmind. The lease works like a German heritable building right.</dd>
			<dt>Protocol</dt>
			<dd>The shared software at the base of theOS that runs the laws. No person or COOP owns it.</dd>
			<dt>Steady state</dt>
			<dd>The level at which a balance's yearly inflow equals what melts from it in a year.</dd>
			<dt>Gini index</dt>
			<dd>A measure of inequality: 0 means that everyone owns the same, 1 means that one person owns everything.</dd>
			<dt>Sybil attack</dt>
			<dd>One person posing as many people, to collect many streams of HEARTS.</dd>
		</dl>
	</section>

	<section id="related">
		<h2><span>D</span>Related work</h2>
		<p>
			<strong>Circles.</strong> Circles gives every person a currency of their own <Cite k="circles" />. Its second
			version issues 24 a day and takes 7 % a year, the numbers that theOS adopts <Cite k="circles2" />. Circles moves
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
			<strong>WIR and Sardex.</strong> These networks give firms credit in a currency of their own. WIR has run in
			Switzerland since 1934, and its use rises when the national economy falls <Cite k="stodder" />. Sardex runs
			interest-free credit lines among firms in Sardinia <Cite k="sardex" />. theOS has no credit; Section 11 lists
			long-lived projects as an open problem.
		</p>
		<p>
			<strong>Balancer and geometric mean pools.</strong> Balancer's weighted pools use the formula of theOS's baskets
			<Cite k="balancer evans" />. There, outside investors supply the reserves, hold pool tokens and can withdraw.
			theOS pools belong to the protocol, issue no pool tokens, take one-sided inflows and hold currencies that melt.
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
			theOS creates prizes that attackers will want. Table 5 lists the main attacks, what they gain, the defences that
			Section 11 proposes, and how the game tests them.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 5.</strong> Attacks on theOS, and the proposed defences.</caption>
				<thead>
					<tr><th>Attack</th><th>What it gains</th><th>Proposed defence</th><th>Test in the game</th></tr>
				</thead>
				<tbody>
					<tr><td>Fake identities (Sybil)</td><td>{fmt(u)} HEARTS a year to direct for each fake person</td><td>A staged identity system, caps on new identities, regular liveness checks</td><td>Farms of fake agents</td></tr>
					<tr><td>Self-dealing and rings</td><td>A founder controls {fmt(selfDealDay(), 1)} MIND a day instead of {fmt(honestDay())}; friends trade empty MINDs for real ones</td><td>Escrow for related parties, no payouts to recent investors, public treasuries, only real deliveries count as sales, basket admission</td><td>Kickback COOPs, investment rings and circular sales</td></tr>
					<tr><td>Pool attacks and front-running</td><td>A pushed price buys HEARTS from Avens; bots trade around payments and inflows</td><td>Time-averaged prices, one batch at one price per block, sealed orders, daily sale caps, an event breaker</td><td>Price pumps, junk dumping, sandwich bots</td></tr>
					<tr><td>Capture</td><td>Control of a COOP's treasury, of the Avens' defaults, or of the protocol's code</td><td>The holder rule, a default COOP constitution, several Aven providers, the process of Appendix F</td><td>Vote buying, a captured Aven provider, injected instructions</td></tr>
					<tr><td>Bugs</td><td>Value drained from pools that nobody can withdraw from</td><td>Verified maths, one global melt index, independent code, a pause that cannot move funds, a bug bounty</td><td>A red team before real value flows</td></tr>
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
			<strong>The laws.</strong> The four laws and the rate are fixed. Nobody holds a key that changes them. A change to
			a law would be a new protocol, and each person would choose whether to move to it. In the game it is different:
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
			<strong>Details inside the laws.</strong> Some rules work inside the laws: the payout target, the dividend share
			and its limit, basket admission, the par index and the identity system. They change by the same process as the
			code, and the game tests each change first.
		</p>
		<p>
			During the game and the first pilot, the maiaCITY team writes and runs the code. That is a concentration of power.
			The city must hand it to the process above before real value flows.
		</p>
	</section>

	<section id="disclosure">
		<h2><span>G</span>Interests and code</h2>
		<p>
			The author leads maiaCITY, which builds the game and the city that this paper describes. He therefore has an
			interest in the success of theOS. The code behind every number and figure in this paper is open, in the maiaCITY
			repository at
			<a href="https://github.com/MyAvenCEO/maiacity" target="_blank" rel="noopener noreferrer">github.com/MyAvenCEO/maiacity</a>.
			The file <code>src/lib/theos/model.js</code> computes every formula number that the text prints, so readers can
			check and rerun each one. The agent-based simulation that Sections 7 to 11 quote is the script
			<code>scripts/theos-e2e-sim.mjs</code> in the same repository. It is seeded, so the same command gives the same
			results.
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
			system-engineering framework for a post-labour economy, v5. maiaCITY working paper.
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

	code {
		font-size: 0.88em;
		word-break: break-all;
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
	}
</style>
