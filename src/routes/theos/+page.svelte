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
		RATE, UIA_DAY, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate,
		idleSeries, convergenceSeries, infraSeries, lvrSeries, selectionSeries, fmt,
		GINI_DE, ownLevel, giniAt, levelYears, reachedBy, giniRest, dialSeries
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
			['synthesis', '12 · From capitalism to Abundism'],
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
			build next? For two centuries, the wage answered both: people worked, got a wage and spent it. When machines do
			the work, that answer stops working.
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
			intelligence, carried as one currency of ownership and utility. To hold it is to own part of the COOP; to spend it is
			to use what the COOP makes. Half of the new MIND goes to the investor and half to the COOP's treasury, the money
			that the COOP works with. COOPs pay their MIND out again, for resources, services and the work that people's agents
			propose, so MIND keeps moving through the economy. A tenth of that treasury half flows into liquidity pools, and with these pools anyone can
			trade any MIND for any other. The pools belong to the protocol itself: the base layer of theOS, which no person or
			COOP owns.
		</p>
		<p>
			Third, all money melts slowly. It loses {pct(RATE * 100)} of its value each year, just as food spoils and machines
			wear out. So wealth keeps moving and does not sit idle.
		</p>
		<p>
			We then show what follows from these rules. Money enters only as HEARTS, changes form only by investment and
			leaves only by melting. So the total amount of money settles at a fixed level per person, and the MIND that each
			person holds moves toward one resting level. Nobody stays rich by sitting still, and nobody starts with nothing for long.
		</p>
		<p>
			Mathematically, this rule is the same as Stéphane Laborde's Relative Theory of Money. Because HEARTS can only be
			invested, a project no longer has to beat the return of a bond; it only has to be useful. COOPs compete on the
			quality of their management. A personal AI agent,
			called an Aven, does the arithmetic for each person, so taking part needs only two simple choices a day.
		</p>
		<p>
			We will prove theOS in two steps. First, we prove it in a game, where AI agents live under its rules and we can
			measure and change every rule. Then we prove it for real, as the economy of maiaCITY, the city we are building.
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
			That need is ending. In 1930, Keynes saw that within a century humanity could solve the “economic problem” of
			scarcity. The hard question would then be what to do with the freedom <Cite k="keynes30" />. Ninety-six years
			later, his forecast arrives, but by a road he did not expect. Frey and Osborne estimated that 47 % of US jobs had a
			high risk of computerisation <Cite k="frey" />. Acemoglu and Restrepo measured that each additional industrial
			robot per thousand workers lowered employment and wages in the towns that used the robots <Cite k="acemoglu" />.
		</p>
		<p>
			Language models and humanoid robots now also do the thinking and handling work that was left. Machines make more
			goods at almost no extra cost <Cite k="rifkin" />. So production does not fall. It rises.
		</p>
		<p>
			What fails is distribution. If income flows to whoever owns the machines, wealth concentrates without limit.
			Piketty showed this with data from the twentieth century and wrote it as one simple inequality,
			<Tex tex="r > g" />. When the return on capital, <Tex tex="r" />, is larger than the growth of the whole economy,
			<Tex tex="g" />, existing owners take a growing share of everything <Cite k="piketty" />.
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
			Money is a shared memory of who gave what to whom <Cite k="kocherlakota" />. A note in your pocket says that you
			once gave something of value, and that you can now claim something back. Irving Fisher wrote down how this memory
			moves through an economy, in his equation of exchange <Cite k="fisher11" />: <Tex tex="MV = PQ" />. The amount of
			money, <Tex tex="M" />, times how often it changes owner, <Tex tex="V" />, equals the prices,
			<Tex tex="P" />, times the goods traded, <Tex tex="Q" />. Money does its job only while it moves.
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
				bridge with these notes. Then the Austrian national bank stopped the scheme <Cite k="schwarz" />.
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
			Gesell also warned that melting money alone is not enough. Wealth that cannot stay in money escapes into land. So
			he paired his <em>Freigeld</em> (free money) with <em>Freiland</em>, land held in common. We return to that
			warning in Section 11. Demurrage tells us how money should behave. It does not yet tell us where new money should
			come from, and that is the next question.
		</p>
	</section>

	<section id="dividend">
		<h2><span>3</span>Who should create money</h2>
		<p>
			Today, banks create most money when they lend. Whoever gets the loan gets the new money first and repays it with
			interest. If money is a shared memory, there is a fairer starting point: create it equally for every person.
		</p>
		<p>
			Stéphane Laborde developed this idea in his <em>Relative Theory of Money</em> (Théorie Relative de la Monnaie). He
			asked which way of creating money treats every generation the same: the people alive now and those not yet born.
			His answer is a <em>universal dividend</em>: new money paid to every member alike, at a rate that depends on how
			long people live <Cite k="laborie" />. The Ğ1 currency started in 2017 and uses this rule
			<Cite k="duniter" />. Remember his rule. Section 5.3 shows that theOS arrives at exactly the same place by another
			road.
		</p>
		<p>
			Circles UBI took the idea one step further. In Circles, every person gets their own currency, one token an hour,
			so money starts with people and not with banks. Its balances lose 7 % of their value each year
			<Cite k="circles" />. Because every person's coin is different, Circles needs a web of trust to move value between
			people: I accept your coin because I trust you.
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
			each cooperative decides. The laws cannot change. They are short, and together they say where money comes from,
			where it can go and what it becomes there.
		</p>
		<div class="law">
			<p class="lawname">Law 1 · Universal Intent Allocation (UIA)</p>
			<p>
				Every human gets {UIA_DAY} HEARTS a day, without conditions, one for each hour lived. Each person's HEARTS are a
				currency of their own: Samuel's are SamuelHEARTS, Anna's are AnnaHEARTS. Only their owner can invest them.
			</p>
		</div>
		<p>
			The name says what it is. <em>Universal</em>, because everyone gets it. <em>Intent</em>, because it shows what a
			person wants to see built. <em>Allocation</em>, because it is the right to allocate: to invest one's HEARTS into
			the cooperatives (COOPs) that one chooses. It is not a handout for survival. It gives each person a voice in where
			the automated economy puts its effort.
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
				housing, art or any need that nobody meets yet.
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
			its value follows the COOP's success. When Anna switches on her lamp, she pays for the power in SOLARmind. She can
			pay with any MIND that she holds: the pools convert it, and the solar COOP always receives SOLARmind. What she
			spends goes back into the treasury. What she keeps stays her ownership.
		</p>
		<p>
			In the treasury, the SOLARmind is the COOP's working capital. A tenth of this half drips into the pools. The COOP
			spends the rest through proposals that its members accept. It <em>buys</em> panels: it pays in SOLARmind, the pools
			convert it, and the panel COOP receives PANELmind. And it <em>pays for work</em>. Mia's Aven proposes to clean the
			panels and to plan their repairs, the COOP accepts, and it pays Mia in SOLARmind. So the MIND that Anna paid for
			her light does not stay in the treasury. It flows back out to people and to other COOPs, and the COOP grows what it
			can make.
		</p>
		<figure>
			<FollowOneHeart />
			<figcaption>
				<strong>Figure 3.</strong> Law 4, step by step. One HEART converts into one SOLARmind. Half goes to Anna's
				wallet as her ownership, and half to the treasury as working capital. Anna pays for her light in SOLARmind, and it
				goes back to the treasury. The treasury pays it out again: a tenth of its half into the pool, the panel COOP
				through the pool in its own PANELmind, and Mia for her Aven's work proposal. The areas of the coins are to scale.
				Tap a number to go to a step.
			</figcaption>
		</figure>
		<p>
			So theOS has exactly two kinds of money. HEARTS are intent, and they exist only until their owner invests them.
			MINDs are what intent becomes, and they carry the whole economy after that. The laws say where both come from.
			They do not yet say what stops either from growing without limit. That is the job of the one rule that HEARTS and
			MINDs share: they melt.
		</p>
	</section>

	<section id="entropy">
		<h2><span>5</span>Melting money, in numbers</h2>
		<h3>5.1 One demurrage rule for HEARTS and MINDs</h3>
		<p>
			Every HEART and every MIND loses value at the same fixed rate of <Tex tex="r = 0.07" /> a year. This is Gesell's
			demurrage from Section 2, built into the protocol, and it is the same for both kinds of money. So a conversion of a
			HEART into a MIND, or a trade from one MIND into another, never escapes it. The protocol applies demurrage
			continuously: it updates a balance each time it reads or changes that balance. There is no fixed date for the fee,
			so it never pays to move money just before a deadline. The rule is:
		</p>
		<Tex display tex={String.raw`B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t}, \qquad \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \tag{1}`} />
		<p>
			Here <Tex tex="B" /> is any balance of HEARTS or of a MIND, in a person's wallet or in a COOP's treasury. The time
			since its last update, in years, is <Tex tex={String.raw`\Delta t`} />. A day costs
			<Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a balance. An idle balance
			loses half of its value in a time called its half-life:
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{2}`} />
		<p>
			On money that people use, the cost is too small to notice. But it is large enough that nobody keeps a fortune idle.
			In Fisher's terms, demurrage raises the velocity <Tex tex="V" />, not the amount <Tex tex="M" />. For HEARTS, it
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
			Count all the money there is, HEARTS and MINDs together, in wallets and in treasuries. Divide it by the number of
			people, <Tex tex="N" />. This money per person, <Tex tex="m" />, gains <Tex tex="u" /> a year and melts at the rate
			<Tex tex="r" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dm}{dt} = u - r\,m, \qquad m^{*} = \frac{u}{r} \\ m(t) = m^{*} + \left(m_0 - m^{*}\right) e^{-rt} \end{gathered} \tag{3}`} />
		<p>
			At <Tex tex="r = 0.07" />, the steady state is <Tex tex={String.raw`m^{*} \approx ${tn(steadyState())}`} /> per
			person. At this level, the new HEARTS of each year equal the money that melts in that year. However people
			invest, spend or trade, all money moves toward this level from either side. A young city's money rises to it from
			below, and an inflated city's money falls to it from above. The gap halves every {fmt(halfLife(), 1)} years.
		</p>
		<p>
			There is no central bank, no interest rate to set and no inflation target. From any start, the money supply moves
			to <Tex tex={String.raw`N u / r`} />, and the whole policy is the four laws and one rate.
		</p>
		<p>
			The same rule levels people. Every balance that sits still melts toward zero, while everyone gets the same
			{UIA_DAY} HEARTS a day. So nobody stays rich by holding, and nobody starts with nothing for long. Nobody collects a
			tax, and nobody decides who gets what. The melt works like a flat levy on every holding, and the daily HEARTS work
			like an equal grant to every person. The levelling comes from the rule itself.
		</p>
		<figure>
			<LineChart
				title="From any start, money per person, HEARTS and MINDs together, moves to the same steady state"
				series={conv}
				x={{ min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1_000_000, ticks: [0, 250_000, 500_000, 750_000, 1_000_000], fmt: (v, tip) => (tip ? fmt(v) : v >= 999_500 ? '1 M' : v ? `${fmt(v / 1000)}k` : '0'), label: 'Money per person' }}
				refs={[{ axis: 'y', at: star, label: `steady state u/r = ${fmt(star)}` }]}
			/>
			<figcaption>
				<strong>Figure 6.</strong> All money per person, HEARTS and MINDs together, from three starts: none (a new
				city), the steady state, and a million per person. All three meet at <Tex tex="u/r" />.
				Move the slider under Figure 5. A lower rate raises the steady state and slows the approach to it. A higher rate
				does the opposite.
			</figcaption>
		</figure>
		<h3>5.3 Laborde's rule, arrived at from the other side</h3>
		<p>
			Section 3 introduced Stéphane Laborde's universal dividend: money created equally for every member. With (3), we
			can now compare the two systems exactly. Laborde derives the rate of the dividend from one requirement: each
			generation must co-create the same share of money over a life of <Tex tex={String.raw`e_v`} /> years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{4}`} />
		<p>
			<strong>Proposition 1.</strong> <em>theOS with a fixed allocation <Tex tex="u" /> and demurrage
			<Tex tex="r" /> is the Relative Theory of Money with <Tex tex="c = r" />, written in a different unit.</em> In
			Laborde's system, the money supply <Tex tex="M" /> of <Tex tex="N" /> members grows, and each member gets
			<Tex tex={String.raw`c\,M/N`} />. Measure a member's balance relative to the average,
			<Tex tex={String.raw`x = B / (M/N)`} />. Because the average grows at the rate <Tex tex="c" />,
			<Tex tex={String.raw`\dot x = c - c\,x = c\,(1 - x)`} />. In theOS, measure money per person relative to the
			steady state, <Tex tex={String.raw`b = m/m^{*}`} />. From (3), <Tex tex={String.raw`\dot b = r - r\,b = r\,(1 - b)`} />.
			The two are the same equation. ∎
		</p>
		<p>
			Laborde keeps the dividend relative and lets the amount of money grow. theOS keeps the dividend fixed and lets the
			money melt. In both, every member's relative position changes in the same way. What theOS gains is a unit that
			people can think in, 24 a day, one per hour. And once the money has settled, prices no longer drift upward with a
			growing money supply. They fall as output grows.
		</p>
		<p>
			If we solve (4) for <Tex tex={String.raw`e_v`} /> at <Tex tex="c = 0.07" />, we get
			<Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years. So the rate of theOS is gentler than Laborde's rate for an
			80-year life. This conservative choice keeps a decade of savings meaningful.
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
			public prices <Cite k="angeris" />.
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
				COOP. Nobody can ever withdraw what enters a pool; it leaves only through trades.
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
			theOS uses only one pool design: the <em>geometric mean market maker</em>. We chose it because it is the only
			multi-currency AMM that is proven in real use for more than three currencies. Balancer's weighted pools started
			to use it in 2020, with up to eight tokens: exactly the range of a theOS basket <Cite k="balancer evans" />. Every
			pool holds <Tex tex="n" /> = 4 to 8 MINDs in equal shares, <Tex tex={String.raw`w_i = 1/n`} />. With
			<Tex tex={String.raw`x_i`} /> of MIND <Tex tex="i" /> in the pool, it keeps
		</p>
		<Tex display tex={String.raw`\begin{gathered} \prod_{i=1}^{n} x_i^{\,1/n} = k \\ p_{ij} = \frac{x_i}{x_j}, \qquad \text{fee } f = 0.3\,\% \end{gathered} \tag{5}`} />
		<p>
			Every trade keeps the geometric mean of the reserves constant. The price of MIND <Tex tex="j" /> in MIND
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
				<Tex tex={String.raw`\delta = \ln(1 + d/x_i)`} />. If the inflow comes in <Tex tex="N" /> small slices, that
				loss falls about <Tex tex="N" />-fold. So the protocol adds inflows a little at a time, in every new block of
				transactions, as in the time-weighted AMM <Cite k="twamm" />.
			</li>
			<li>
				<strong>Routing by Avens.</strong> Avens, the personal AI agents of Section 7, route each trade. A trade between
				two MINDs goes through the pools that hold them. The best way to divide a trade across many pools is a convex
				problem, a kind of problem that computers can solve exactly <Cite k="angerisMulti routing" />.
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
			correlation <Tex tex={String.raw`\rho`} />, a number for how closely the prices move together. The cost grows with
			how much MINDs move against one another. It grows only a little with the size of the basket. And the 0.3 % fee wins
			part of it back.
		</p>
		<p>
			In theOS, the protocol's pools carry this cost, never a person. The MIND in Anna's wallet is never part of a pool.
			A speculative attack can make a pool smaller, but every COOP's working capital and its turbines keep going. Clearing
			trades in batches at one price could cut the cost further <Cite k="fmamm" />. But this is proven only for
			two-currency pools, so theOS leaves it as a later upgrade to test in the game.
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
				<strong>Figure 8.</strong> The cost (6) of keeping a basket liquid, before the fee wins part of it back. In a
				basket of four, calm MINDs (20 % volatility) cost 1.5 % of the pool a year. Wild MINDs (40 %) cost 6 %. When
				MINDs move together (correlation 0.6), the cost falls to 2.4 %. Going from 4 to 8 MINDs adds only about a sixth.
			</figcaption>
		</figure>
		<p>
			Through the pools, anyone can now trade every MIND for every other. But no person can follow thousands of
			currencies and their prices. The next layer does that work for them.
		</p>
	</section>

	<section id="avens">
		<h2><span>7</span>Avens: an agent for every person</h2>
		<p>
			Herbert Simon showed that people can weigh only a few options at a time <Cite k="simon" />. This limit, called
			bounded rationality, is not a flaw that education can remove. It is the design constraint. So theOS gives every
			person an Aven: a personal AI agent that works only for its human. People decide on values and goals, and Avens do
			the arithmetic. Each person makes two choices:
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
				Aven's human in its own MIND. This is how MIND flows from the treasuries back to people, and how COOPs grow what
				they can make.
			</li>
			<li>
				<strong>Paying without thinking.</strong> When Anna takes a tram, her Aven finds the cheapest route through the
				pools of Section 6. The route goes from the MINDs she holds to the MIND that the tram COOP accepts. The Aven pays
				in the same moment.
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
			competing MINDs also come close to his proposal for competing private currencies <Cite k="hayek76" />. There is
			one difference. Every MIND comes from HEARTS issued equally to every person, not from whoever is able to issue
			money. With people, COOPs, pools and Avens in place, we can now ask what the system changes in the long term.
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
			In theOS, there is no safe alternative inside the city. HEARTS cannot be lent or parked; they can only be invested.
			So a project does not have to beat a bond. It only has to deliver something that people use. Idle HEARTS lose 7 %
			a year, and the MINDs that an investment creates melt at the same rate, so no balance anywhere earns a return for
			doing nothing. Compare what is left after <Tex tex="T" /> years of the same intent: left idle, or built into a
			project whose utility changes at its real rate <Tex tex="g" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \text{idle: } e^{-rT}, \qquad \text{built: } e^{gT} \\ r = 7\,\%,\ g = -1\,\%,\ T = 50 \;\Rightarrow\; ${tn(Math.exp(-RATE * 50) * 100)}\,\% \text{ against } ${tn(Math.exp(-0.01 * 50) * 100)}\,\% \end{gathered} \tag{7}`} />
		<p>
			What lasts is what the investment built. But the melt does not make the far future worth more to an investor: the
			investor's MIND melts too, so a share of use in fifty years is worth less to its holder than a share of use today.
			What the melt changes is who gains. The later years of a long-lived project serve the people who hold its MIND
			then, the next generations. Nothing pays for sitting still, so the only way to make intent last is to build what
			people keep using: grids, water systems, domes, rail. Whether Avens fund such long projects as readily as short
			ones is a question for the game (Section 11).
		</p>
		<figure>
			<LineChart
				title="1,000 HEARTS over 50 years, left idle or built into infrastructure"
				series={infra}
				x={{ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], fmt: (v, tip) => fmt(v), label: 'Value left of 1,000' }}
			/>
			<figcaption>
				<strong>Figure 9.</strong> The same 1,000 HEARTS, left idle under 7 % demurrage, or invested into
				infrastructure. The utility of that infrastructure keeps its real value (0 %) or slowly wears (−1 %). After 50
				years, the idle HEARTS keep 3 %. The project that wears still delivers 61 % of the utility of its first year.
			</figcaption>
		</figure>
		<h3>8.1 Land that nobody can sell</h3>
		<p>
			Melting money has one old weakness. Wealth flees into whatever does not melt, and the largest such store is land
			<Cite k="gesell keynes36" />. If land could be bought, the success of every COOP would end up as a higher land
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
			the same need compete on one open field.
		</p>
		<p>
			Elinor Ostrom showed that the people who share a resource, such as a pasture or a fishery, can govern it well when
			the rules fit their place <Cite k="ostrom" />. In theOS, her
			design principles become hypotheses that the market tests. Three designs might share a sector:
		</p>
		<ul>
			<li><strong>COOP A</strong>, capital-weighted: one token, one vote. Large holders steer.</li>
			<li><strong>COOP B</strong>, strict direct democracy: one person, one vote on every operational choice.</li>
			<li>
				<strong>COOP C</strong> mixes three tools. It uses quadratic voting on strategy: to cast <Tex tex="n" /> votes
				on one question costs <Tex tex="n^2" />. So people can show how strongly they care, but the largest holder
				cannot decide everything <Cite k="qv qf" />. An AI executive runs daily operations. And prediction markets
				answer questions of fact: people bet on outcomes, so the prices show what is likely <Cite k="hanson" />.
			</li>
		</ul>
		<p>
			Avens send each HEART where it buys the most utility. Let <Tex tex="s_i" /> be a COOP's share of its sector's
			investment, and <Tex tex="f_i" /> the utility that it delivers per HEART. Then the shares follow the equation of
			natural selection, known as replicator dynamics. Whatever does better than average grows, and whatever does worse
			shrinks:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \dot s_i = k\, s_i \left(f_i - \bar f\right) \\ \bar f = \textstyle\sum_j s_j f_j \end{gathered} \tag{8}`} />
		<p>
			In 1950, Alchian proposed this mechanism to explain why markets select efficient firms, even when no firm
			optimises <Cite k="alchian" />. Demurrage makes it stronger: a COOP that stops attracting investment watches its
			treasury melt. Below the level that its service needs, the COOP closes. Its physical assets go to the City COOP,
			which leases them to a COOP that runs them better. Ideas about markets that are designed on purpose, not inherited
			<Cite k="radical" />, become experiments here.
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
				Avens route the investment every month, so it follows the utility delivered. A leads in the first year and loses
				the lead in the second, and after five years C has most of the sector. Governance becomes a technology that improves by
				selection.
			</figcaption>
		</figure>
		<h3>9.1 The whole machine</h3>
		<p>
			All the pieces are now in place. Here are the four laws of Section 4 once more:
		</p>
		<ol class="laws">
			<li><strong>Universal Intent Allocation.</strong> Every person gets 24 personal HEARTS a day, one per hour.</li>
			<li><strong>Pure investment.</strong> HEARTS earn no interest and buy nothing. Their owner can only invest them.</li>
			<li><strong>Open cooperative creation.</strong> Anyone can found a COOP, at any time, without permission.</li>
			<li><strong>Every COOP has its own MIND, created by investing HEARTS.</strong> One HEART converts into one MIND, half to the investor, half to the COOP's treasury as working capital.</li>
		</ol>
		<p>
			On top of the laws, each part of the machine has exactly one job. Table 1 lists the parts. No part of theOS does
			two of these jobs, and no two parts do the same job.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 1.</strong> The parts of theOS and their jobs.</caption>
				<thead>
					<tr><th>Part</th><th>Its one job</th><th>Comes from</th><th>Goes to</th></tr>
				</thead>
				<tbody>
					<tr><td>HEARTS</td><td>A person's intent: what they want built</td><td>The UIA, 24 a day per person</td><td>Converted into MIND by investment, or melted</td></tr>
					<tr><td>MIND</td><td>Ownership of a COOP and the means to use what it makes; people hold it as ownership and spend it to use, the COOP holds it as working capital</td><td>Every invested HEART, one for one: half to the investor, half to the COOP's treasury</td><td>Spent on what the COOP makes, and the seller always receives its own MIND; paid out again by COOPs, through proposals, for resources, services and work; 5 % of every HEART into the pools; or melted</td></tr>
					<tr><td>Liquidity pools</td><td>Prices and trades between MINDs, and routes every payment into the seller's own MIND; owned by the protocol, not by a COOP</td><td>A tenth of every treasury half (5 % of every HEART), automatically, in baskets of 4 to 8 MINDs</td><td>Never withdrawn; MIND leaves a pool only through trades</td></tr>
					<tr><td>Demurrage</td><td>The only way money leaves: 7 % a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's arithmetic: invest, trade, pay, propose work, leave</td><td>One per person</td><td>Work only for their human</td></tr>
					<tr><td>City COOP</td><td>Holds all land and what all citizens share, and leases land; never sells it</td><td>The city: every citizen holds one equal share</td><td>Ground rent in MIND from every builder; pays for streets, parks and water</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; improved by selection</td><td>Chosen by each COOP</td><td>Tested by where people invest</td></tr>
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
			who keeps the MIND from their HEARTS and pays for daily life from work income keeps <Tex tex="a = u/2" />. Then
			every such holding moves toward the same resting level
			<Tex tex={String.raw`W^{*} = u/(2r) \approx ${tn(ownLevel())}`} /> MIND. Start with holdings as unequal as Germany's today, with a Gini index <Tex tex="G_0" /> and a mean
			<Tex tex="m_0" />. Then the Gini index after <Tex tex="t" /> years is
		</p>
		<Tex display tex={String.raw`\begin{gathered} G(t) = \frac{G_0\, e^{-rt}\, m_0}{e^{-rt}\, m_0 + W^{*}\left(1 - e^{-rt}\right)} \\ m_0 = W^{*} \;\Rightarrow\; G(t) = G_0\, e^{-rt} \end{gathered} \tag{9}`} />
		<p>
			So inequality halves every {fmt(halfLife(), 1)} years, the same half-life as an idle balance. From Germany's
			{fmt(GINI_DE, 2)}, the Gini index falls to {fmt(giniAt(GINI_DE, 10), 2)} after 10 years and to
			{fmt(giniAt(GINI_DE, 30), 2)} after 30. Large fortunes level more slowly. A fortune 100 times the resting level
			needs about {fmt(levelYears(100))} years to fall to twice that level: one lifetime. A child who gets HEARTS from
			birth owns {pct(reachedBy(18) * 100)} of the resting level at 18. That is a start in life for everyone, without a
			separate fund.
		</p>
		<p>
			But people choose different COOPs, so their returns differ. Let <Tex tex={String.raw`\sigma`} /> be the spread
			of returns between people's holdings, and <Tex tex={String.raw`\mu`} /> the best extra return that a holder can
			keep year after year. Then each holding follows
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
			form of Piketty's <Tex tex="r > g" />.
		</p>
		<figure>
			<LineChart
				title="Ownership inequality over 100 years, from Germany's spread today"
				series={gin}
				x={{ min: 0, max: 100, ticks: [0, 20, 40, 60, 80, 100], fmt: (v, tip) => (tip ? `Year ${fmt(v)}` : `${v}`), label: 'Years under theOS' }}
				y={{ min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8], fmt: (v) => fmt(v, 2), label: 'Gini index of ownership' }}
			/>
			<figcaption>
				<strong>Figure 12.</strong> An illustration of (9) and (10), not a forecast. Everyone starts as unequal as
				Germany today. If all holdings earn the same return, inequality halves every {fmt(halfLife(), 1)} years and
				goes to zero. If returns spread by 10 % or 20 % between people, it settles at {fmt(giniRest(0.1), 2)} or
				{fmt(giniRest(0.2), 2)}. Under capitalism it stays where it is.
			</figcaption>
		</figure>
		<p>
			So the level of fairness depends on two dials: the rate of demurrage, and how much people's returns spread. Avens
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
			every holding melts, so any advantage from luck, skill, work or inheritance halves in {fmt(halfLife(), 1)} years
			unless the holder earns it again. Fair participation follows from fair ownership: every person owns and steers the
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
			Nobody can test a theory of a whole economy in a laboratory. And nobody should test it on people's lives first. So
			maiaCITY proves theOS in two steps. The first step is a game. In its world, AI agents with their own needs and
			goals live, trade and invest under exactly the rules of this paper. Every rule is a parameter: we can measure it,
			change it through an open proposal and play again.
		</p>
		<p>
			So the claims of Sections 5 to 9 become experiments, not hopes. The early worlds already run the first layer. This layer has
			24 HEARTS a day that melt at 7 % a year, and COOPs whose MIND people get when they invest. The second step is the
			real city. The rules that survive the game become the economy of maiaCITY while we build it.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 2.</strong> Each part of theOS, first in the game, then in the city.</caption>
				<thead>
					<tr><th>Part</th><th>In the game</th><th>In the city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>Every agent gets 24 personal HEARTS a day, which it can only invest</td><td>Every resident gets 24 personal HEARTS a day, one identity per person</td></tr>
					<tr><td>Demurrage</td><td>Continuous, Eq. (1), on HEARTS and MINDs</td><td>The same rule, fixed in the protocol</td></tr>
					<tr><td>COOPs</td><td>Agents found COOPs and invest HEARTS, which convert into MIND</td><td>An energy COOP for a village's geothermal plant, a food COOP for its food forest, a housing COOP for its domes</td></tr>
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
		<p>A blueprint is only scientific if it says where it could fail.</p>
		<ul>
			<li>
				<strong>One person, one allocation.</strong> The UIA needs an identity that nobody can fake many times. The name
				for this property is Sybil resistance: one human, one stream of HEARTS. It must work without a central registry
				that can exclude people <Cite k="soul" />. maiaCITY's passkey-based vaults are a start, not a proof.
			</li>
			<li>
				<strong>Escape into assets.</strong> Melting money pushes wealth into anything that does not decay
				<Cite k="gesell keynes36" />. The land rule of Section 8.1 closes the largest door. Other stores of value remain,
				such as euros, art or rare objects. theOS must also decide how the City COOP sets the ground rent, and how
				citizens decide what it builds with it.
			</li>
			<li>
				<strong>The rate.</strong> 7 % is a choice, not a law of nature. From fairness between generations, Section 5.3
				suggests 7 to 9 %. The game should test how behaviour changes across that range.
			</li>
			<li>
				<strong>Pool attacks.</strong> Anyone with enough money can push AMM prices for a moment. The pools need
				time-averaged prices, and limits on how fast an Aven follows a price.
			</li>
			<li>
				<strong>Liquidity that never leaves.</strong> Nobody can withdraw from the pools, so nobody can repair a pool by
				moving money out. This is why their code must be right from the start: audited rounding, a guarded pause, and an upgrade
				path that we decide before launch. Equal-weight baskets are proven, but never yet with steady one-sided inflows,
				no withdrawals and melting currencies. The game must test this mix first.
			</li>
			<li>
				<strong>Capture and graceful failure.</strong> A failing COOP must hand its assets to the City COOP without a
				forced sale at low prices. The rule that decides who gets the assets next must itself resist capture: control by
				a small group.
			</li>
			<li>
				<strong>The conditions of fairness.</strong> Proposition 2 holds only under six rules. First, no holder may
				earn more than the rate of demurrage, year after year, on any holding. Arbitrage profits from the protocol pools are such a
				return, so they must flow back to all Avens, or batch trading must remove them. Second, every COOP must accept
				HEARTS from anyone, one for one. A COOP that closes its doors creates scarcity for its first owners. Third,
				theOS must decide how euros can buy MIND, because those purchases bring outside inequality in. Fourth, theOS
				must say what happens to MIND when a person dies. People hold half of all MIND, so this is a real flow. The
				simplest rule sends it to the City COOP. Fifth, COOPs must pay out what they take in. A COOP that keeps its sales in
				its treasury slowly becomes its own owner. In the end-to-end model, if COOPs pay nothing out, people hold only
				0.3 % of all MIND. If COOPs pay out for work and services as much as people spend, people hold half. Sixth, land
				stays with the City COOP. In the end-to-end simulation, private land keeps the Gini index near 0.5; with all land
				in the City COOP, it settles at 0.29.
			</li>
			<li>
				<strong>Long-lived projects.</strong> A treasury's savings melt while it saves, and theOS has no credit. So a
				tidal barrier or a fusion plant needs binding pledges of HEARTS over years before it can start. The game must
				test if Avens fund such projects.
			</li>
			<li>
				<strong>Exchange between people.</strong> People can only invest HEARTS. So two questions need their own
				design: how people earn MINDs for creative work or care work, and how MINDs pass between people.
			</li>
		</ul>
	</section>

	<section id="synthesis">
		<h2><span>12</span>From capitalism to Abundism</h2>
		<p>
			We started with two questions: who gets what is made, and who decides what is made next. Capitalism answered both
			with wages and ownership, and automation now removes that answer. theOS answers them differently: everyone gets an
			equal, daily share of direction and of ownership. That share can only build things. What it builds belongs to those who hold its MIND,
			on land that belongs to everyone. All money melts like the world it measures, so nobody can keep wealth idle and out of reach. The whole
			architecture fits in one line:
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
