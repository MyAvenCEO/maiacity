<script>
	// @ts-nocheck — plain JS, kept loose on purpose
	import 'katex/dist/katex.min.css';
	import Tex from '$lib/theos/Tex.svelte';
	import Cite from '$lib/theos/Cite.svelte';
	import LineChart from '$lib/theos/LineChart.svelte';
	import Circulation from '$lib/theos/Circulation.svelte';
	import DecaySurface from '$lib/theos/DecaySurface.svelte';
	import SplitFlow from '$lib/theos/SplitFlow.svelte';
	import { REFS } from '$lib/theos/refs.js';
	import {
		RATE, UIA_DAY, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate,
		idleSeries, convergenceSeries, infraSeries, lvrSeries, selectionSeries, fmt
	} from '$lib/theos/model.js';

	// the four series colours, validated together for colour-blind separation on the paper's surface
	const C = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0'];

	// one rate drives Figures 2 and 3, so a reader can feel what the 7 % does
	let rate = $state(RATE);

	const idle = idleSeries().map((s, i) => ({ id: `r${s.r}`, label: `${Math.round(s.r * 100)} % a year`, color: [C[1], C[0], C[3]][i], points: s.points }));
	const conv = $derived(convergenceSeries(rate).map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] })));
	const star = $derived(steadyState(rate));
	const infra = infraSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const lvr = lvrSeries().map((s, i) => ({ ...s, color: [C[2], C[0], C[1]][i] }));
	const sel = selectionSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));

	const pct = (v, d = 0) => `${fmt(v, d)} %`;
	// a number inside TeX: its thousands comma must not read as punctuation
	const tn = (v, d = 0) => fmt(v, d).replace(/,/g, '{,}');
	const ev = lifeForRate(RATE);
	const advantage = Math.exp((0.07 - 0.01) * 50);

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
			Picture a city where machines grow the food, run the power plants and build the homes. Two questions decide
			whether such a city is a good place to live: who gets a fair share of what the machines make, and who decides what
			they build next? For two centuries the answer to both was the wage. People worked, were paid and spent. When
			machines do the work, that answer stops working.
		</p>
		<p>
			This paper proposes another answer, an economic operating system we call theOS. It rests on three simple ideas.
			First, every person receives their own personal currency every day, simply for being alive: {UIA_DAY} HEARTS, one
			for every hour. Samuel's are SamuelHEARTS, Anna's are AnnaHEARTS. HEARTS are not spending money but a voice: they
			can only be invested into cooperatives, shared enterprises that make what a city needs, such as energy, food or
			housing. Second, each invested HEART is converted into one unit of that cooperative's MIND: its shared intelligence,
			carried as one currency of ownership and utility: holding it is a share in the cooperative, spending it uses
			what the cooperative makes. Half goes to the investor and half to the cooperative's treasury, and a tenth of
			every treasury flows into liquidity pools that belong to the protocol itself, so that every MIND can always be
			traded for every other. Third, all money slowly melts, losing {pct(RATE * 100)} of its value a year, just as
			food spoils and machines wear out, so wealth keeps moving instead of being hoarded.
		</p>
		<p>
			We then show what follows from these rules. Money enters only as HEARTS, changes form only by investment, and
			leaves only by melting, so the total amount of money settles at a fixed level per person, and every balance is
			drawn toward it: nobody stays rich by sitting still and nobody starts with nothing for long. The rule turns out to be mathematically the same as
			Stéphane Laborie's Relative Theory of Money. Long-lasting infrastructure becomes the best place to put money, and
			cooperatives compete on how well they are run. A personal AI agent, an Aven, does the arithmetic for each person,
			so that taking part takes two simple choices a day.
		</p>
		<p>
			We will prove theOS in two steps: first in a game, where AI agents live under its rules and every rule can be
			measured and changed, and then for real, as the economy of maiaCITY, the city we are building.
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
			Every economy has to answer two questions. Who gets what is made? And who decides what is made next? Capitalism
			answers both through work and ownership. Most people sell their time for a wage and spend it on what others
			produce; those who own the factories, the land and the capital decide what is built, and keep what is left over.
			For two centuries this arrangement, for all its injustice, held together, because the owners needed the workers
			and so had to share.
		</p>
		<p>
			That need is ending. Keynes saw in 1930 that within a century the “economic problem” of scarcity could be
			solved, and that the hard question would become what to do with the freedom <Cite k="keynes30" />. Ninety-six
			years later the forecast is arriving through a door he did not draw. Frey and Osborne estimated that 47 % of US
			employment was at high risk of computerisation <Cite k="frey" />; Acemoglu and Restrepo measured that each
			additional industrial robot per thousand workers lowered employment and wages in the towns that adopted them
			<Cite k="acemoglu" />. Language models and humanoid robots now reach into the thinking and handling work that was
			left. As machines make more goods at almost no extra cost <Cite k="rifkin" />, production does not fall. It rises.
		</p>
		<p>
			What fails is distribution. If income flows to whoever owns the machines, wealth concentrates without limit.
			Piketty documented this for the twentieth century under the simple inequality <Tex tex="r > g" />: when the
			return on capital, <Tex tex="r" />, is larger than the growth of the whole economy, <Tex tex="g" />, those who
			already own take a growing share of everything <Cite k="piketty" />. The usual answer is a universal basic income,
			a fixed sum paid to everyone without conditions <Cite k="parijs" />. It would feed people, but it leaves the
			structure intact: people would receive consumption, never direction. They could spend, but they could not decide
			what the automated economy builds next.
		</p>
		<p class="thesis">
			This paper describes a way out that keeps what markets do well and changes what they rest on. We call the
			destination <em>Abundism</em>: an economy in which automation makes the basics plentiful and every person shares in
			deciding what is built. To get there, we first have to look at the tool both questions run through, money:
			what it is, who creates it, and why it behaves the way it does.
		</p>
	</section>

	<section id="money">
		<h2><span>2</span>What money is, and why it should melt</h2>
		<p>
			Money is a shared memory of who has contributed what to whom <Cite k="kocherlakota" />. A note in your pocket says
			that you once gave something of value and may now claim something back. Irving Fisher wrote down how this memory
			moves through an economy in his equation of exchange <Cite k="fisher11" />:
			<Tex tex="MV = PQ" />. The amount of money, <Tex tex="M" />, times how often it changes hands, <Tex tex="V" />,
			equals the prices, <Tex tex="P" />, times the goods traded, <Tex tex="Q" />. Money only does its job while it moves.
		</p>
		<p>
			Yet our money is built to stand still. Everything else in the world decays. Frederick Soddy, a Nobel chemist,
			pointed out in 1926 that houses crumble, harvests rot and machines rust, while a claim on them can grow for ever
			at compound interest <Cite k="soddy" />. Georgescu-Roegen later made entropy, the tendency of every ordered thing
			to run down unless energy keeps it up, the core of his economics <Cite k="georgescu" />. Money that never decays
			lets its owner step outside the physics everyone else lives in. The most rational use of a surplus becomes to sit
			on it, and the people who already hold the most can wait the longest.
		</p>
		<p>
			The fix was proposed more than a century ago. Silvio Gesell argued in 1916 that money should carry a small holding
			cost, like every good it competes with, so that it circulates instead of waiting for a higher interest rate
			<Cite k="gesell" />. Such a fee on holding money is called <em>demurrage</em>, the word for the charge a ship pays
			for every day it lies idle in port. It is the central idea this paper builds on, and it has been tested:
		</p>
		<ul>
			<li>
				In the Tyrolean town of Wörgl in 1932–33, mayor Unterguggenberger issued notes that lost 1 % a month unless a
				stamp was bought for them. During the depression the town paved roads and built a bridge with them, until the
				Austrian national bank stopped the scheme <Cite k="schwarz" />.
			</li>
			<li>
				Fisher himself wrote a book-length case for such stamp scrip in the United States <Cite k="fisher33" />, and
				Keynes predicted that “the future will learn more from the spirit of Gesell than from that of Marx”
				<Cite k="keynes36" />.
			</li>
			<li>
				Margrit Kennedy showed how compound interest silently moves wealth upward <Cite k="kennedy" />, and Bernard
				Lietaer argued for complementary currencies, local or purpose-made money that runs beside the national one
				<Cite k="lietaer" />. The Chiemgauer in Bavaria has run a regional demurrage currency since 2003, losing 2 % a
				quarter <Cite k="gelleri" />.
			</li>
		</ul>
		<p>
			Gesell also warned that melting money alone is not enough: wealth that cannot sit in money flees into land, so he
			paired his <em>Freigeld</em> (free money) with <em>Freiland</em>, land held in common. We return to that warning
			in Section 11. Demurrage tells us how money should behave. It does not yet tell us where new money should come
			from, which is the next question.
		</p>
	</section>

	<section id="dividend">
		<h2><span>3</span>Who should create money</h2>
		<p>
			Today most money is created by banks when they lend. Whoever gets the loan gets the new money first, and pays it
			back with interest. If money is a shared memory, there is a fairer starting point: create it equally for every
			person.
		</p>
		<p>
			Stéphane Laborie worked this out in his <em>Relative Theory of Money</em> (Théorie Relative de la Monnaie). He
			asked which way of creating money treats every generation the same, the living and those not yet born. His
			answer is a <em>universal dividend</em>: new money paid to every member alike, at a rate set by how long people
			live <Cite k="laborie" />. The Ğ1 currency has run on this rule since 2017 <Cite k="duniter" />. Keep his rule
			in mind; Section 5.3 shows that theOS arrives at exactly the same place by another road.
		</p>
		<p>
			Circles UBI took the idea one step further: every person gets their own currency, one token an hour, so that
			money starts with people rather than with banks, and its balances decay at 7 % a year <Cite k="circles" />.
			Because every person's coin is different, Circles needs a web of trust to move value between people: I accept
			your coin because I trust you.
		</p>
		<p>
			We now have the three ingredients: money that melts, money created equally for every person, and money that
			carries its owner's name. theOS combines them and makes one decisive change. It drops Circles' web of trust,
			because the personal currency is never traded between people at all. It can only be <em>invested</em>. That
			change is where the operating system begins.
		</p>
	</section>

	<p class="partline" id="part-2">Part II · The operating system</p>

	<section id="laws">
		<h2><span>4</span>The four laws</h2>
		<p>
			theOS rests on four laws, fixed in its base protocol the way a physics engine fixes gravity. Everything else,
			prices, cooperatives and their governance, grows on top of them and can change; the laws cannot. They are short,
			and together they say where money comes from, where it may go and what it becomes there.
		</p>
		<div class="law">
			<p class="lawname">Law 1 · Universal Intent Allocation (UIA)</p>
			<p>
				Every human receives {UIA_DAY} HEARTS a day, unconditionally, one for every hour lived, in a currency of their
				own: Samuel's are SamuelHEARTS, Anna's are AnnaHEARTS. Only their owner can invest them.
			</p>
		</div>
		<p>
			The name says what it is. <em>Universal</em>, because everyone receives it. <em>Intent</em>, because it expresses
			what a person wants to see built. <em>Allocation</em>, because it is the right to allocate: to invest one's HEARTS
			into the COOPs one chooses. It is not a survival handout but a share in steering where the automated economy puts
			its effort.
		</p>
		<div class="law">
			<p class="lawname">Law 2 · Pure investment</p>
			<p>
				HEARTS earn no interest and cannot buy goods directly. They enter the economy only by being invested into
				cooperatives.
			</p>
		</div>
		<p>
			A HEART is therefore not spending money. It is a vote with weight, cast every day by every person. The third law
			says what it can be cast for: a cooperative, or COOP, an enterprise owned by the people who invest in it and use
			it, such as an energy COOP running a power plant or a food COOP running a farm.
		</p>
		<div class="law">
			<p class="lawname">Law 3 · Open cooperative creation</p>
			<p>
				Anyone, alone or together, can found a COOP at any time without permission, for energy, food, compute, housing,
				art, or any need not yet met.
			</p>
		</div>
		<p>
			The fourth law says what an investment creates. It is the moment a person's intent turns into something that can
			be owned and used.
		</p>
		<div class="law">
			<p class="lawname">Law 4 · Every COOP has its own MIND, created by investing HEARTS</p>
			<p>
				Every COOP has its own MIND: SOLARmind for a solar COOP, AGRImind for a farming COOP. A MIND is the COOP's
				shared intelligence, its automated capacity to make something, carried as one currency of ownership and
				utility: holding it is a share in the COOP, spending it is how one uses what the COOP makes. MIND comes into
				being only through
				investment: every HEART invested into a COOP is converted into one new MIND of that COOP, half to the
				investor and half to the COOP's treasury. Both halves are the same MIND; there is only one kind.
			</p>
		</div>
		<p>
			Follow one HEART. Anna invests one AnnaHEART into the solar COOP. The HEART is converted: it disappears for good,
			and nobody holds it afterwards, not even the COOP. In its place one new SOLARmind appears: half in Anna's
			wallet and half in the COOP's treasury. It is the same SOLARmind in both places, and it does every job. In
			Anna's wallet it is her share in the solar COOP and her right to draw its electricity. In the treasury it is the
			COOP's working capital: the COOP <em>creates</em> with it, paying for panels, steel and upkeep. The COOP
			<em>sells</em> its services in it: when Anna switches on a lamp, she spends a little SOLARmind, and it flows
			back into the treasury. And it <em>buys</em> what it needs from other COOPs with it.
		</p>
		<p>
			So there are exactly two kinds of money in theOS. HEARTS are intent, and they exist only until they are invested.
			MINDs are what intent becomes, and they carry the whole economy after that. The laws say where both come from.
			They do not yet say what stops either from piling up. That is the job of the one rule HEARTS and MINDs share:
			they melt.
		</p>
	</section>

	<section id="entropy">
		<h2><span>5</span>Melting money, in numbers</h2>
		<h3>5.1 One decay rule for HEARTS and MINDs</h3>
		<p>
			Every HEART and every MIND loses value at the same fixed rate of <Tex tex="r = 0.07" /> a year. This is Gesell's
			demurrage from Section 2, built into the protocol, and it is the same for both kinds of money, so converting a
			HEART into a MIND, or one MIND into another, never escapes it. The decay is applied continuously, every time a
			balance is touched, so there is no settlement date to game and no moment where moving money just before a
			cut-off pays:
		</p>
		<Tex display tex={String.raw`B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t}, \qquad \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \tag{1}`} />
		<p>
			Here <Tex tex="B" /> is any balance, of HEARTS or of a MIND, in a person's wallet or a COOP's treasury, and
			<Tex tex={String.raw`\Delta t`} /> the time since it was last touched, in years. A day costs
			<Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a balance, and an idle
			balance halves in
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{2}`} />
		<p>
			The cost is too small to notice on money that is being used and large enough that nobody keeps a fortune idle.
			In Fisher's terms, demurrage raises the velocity <Tex tex="V" /> rather than the amount <Tex tex="M" />. For
			HEARTS it means intent cannot be hoarded for a later power grab; for MINDs it means a COOP's currency is worth
			holding only while the COOP keeps producing. Wealth stops being something one <em>has</em> and becomes something
			one <em>does</em>.
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
				<strong>Figure 1.</strong> What is left of 100 idle HEARTS or MINDs. At theOS's 7 % a year, half is gone after
				{fmt(halfLife(), 1)} years; a working balance that turns over every few weeks barely feels it.
			</figcaption>
		</figure>
		<figure class="wide">
			<DecaySurface {rate} />
			<div class="control">
				<label for="rate">Demurrage rate <strong>{pct(rate * 100, 1)}</strong> a year</label>
				<input id="rate" type="range" min="0.01" max="0.15" step="0.005" bind:value={rate} />
			</div>
			<figcaption>
				<strong>Figure 2.</strong> The whole family of decay curves <Tex tex={String.raw`B(t, r) = e^{-rt}`} /> as one
				surface: time held along one axis, the demurrage rate along the other, the height what is left of one HEART or MIND.
				The terracotta line is the rate set by the slider, which also drives Figure 3. Drag to turn it.
			</figcaption>
		</figure>
		<h3>5.2 Where all money settles</h3>
		<p>
			With one decay rule for both kinds of money, theOS's whole monetary policy fits in four verbs. Money is
			<em>issued</em> only as HEARTS, <Tex tex={String.raw`u = ${UIA_DAY} \times 365 = ${tn(UIA_DAY * 365)}`} /> a
			year per person. It changes form only by <em>conversion</em>, one HEART into one MIND, which neither creates nor
			destroys money. It <em>circulates</em> as MIND: COOPs create, sell and buy their services in it. And it
			<em>leaves</em> only by melting. Count all the money there is, HEARTS and MINDs together, in wallets and in
			treasuries, and divide by the number of people <Tex tex="N" />. This money per person, <Tex tex="m" />, gains
			<Tex tex="u" /> a year and melts at <Tex tex="r" />:
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dm}{dt} = u - r\,m, \qquad m^{*} = \frac{u}{r} \\ m(t) = m^{*} + \left(m_0 - m^{*}\right) e^{-rt} \end{gathered} \tag{3}`} />
		<p>
			At <Tex tex="r = 0.07" /> the steady state is <Tex tex={String.raw`m^{*} \approx ${tn(steadyState())}`} /> per
			person. However people invest, spend or trade, all money is drawn toward it from either side, a young city's from
			below and an inflated one's from above, and the gap halves every {fmt(halfLife(), 1)} years. There is no central
			bank, no interest rate to set and no inflation target: the money supply can never exceed
			<Tex tex={String.raw`N u / r`} />, and the policy is the four laws and one rate.
		</p>
		<p>
			The same rule levels people. Every balance that sits still melts toward nothing while everyone receives the same
			{UIA_DAY} HEARTS a day, so nobody stays rich by holding and nobody starts with nothing for long. Nobody is taxed and
			nobody is redistributed to; the levelling is a property of the rule itself.
		</p>
		<figure>
			<LineChart
				title="Money per person, HEARTS and MINDs together, converges to the same steady state from any start"
				series={conv}
				x={{ min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1_000_000, ticks: [0, 250_000, 500_000, 750_000, 1_000_000], fmt: (v, tip) => (tip ? fmt(v) : v >= 999_500 ? '1 M' : v ? `${fmt(v / 1000)}k` : '0'), label: 'Money per person' }}
				refs={[{ axis: 'y', at: star, label: `steady state u/r = ${fmt(star)}` }]}
			/>
			<figcaption>
				<strong>Figure 3.</strong> All money per person, HEARTS and MINDs counted together, from three starts: a
				new city with none, a city at the steady state, and one flooded with a million per person. They meet at
				<Tex tex="u/r" />. Move the slider under Figure 2: a lower rate raises the steady state and slows the
				convergence, a higher one does the opposite.
			</figcaption>
		</figure>
		<h3>5.3 Laborie's rule, arrived at from the other side</h3>
		<p>
			Section 3 met Stéphane Laborie's universal dividend, money created equally for every member. With (3) in hand we
			can now compare the two exactly. Laborie derives the dividend's rate from the requirement that each generation
			co-create the same share of money over a life of <Tex tex={String.raw`e_v`} /> years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{4}`} />
		<p>
			<strong>Proposition 1.</strong> <em>theOS with a fixed allocation <Tex tex="u" /> and demurrage
			<Tex tex="r" /> is the Relative Theory of Money with <Tex tex="c = r" />, written in a different unit.</em> In
			Laborie's system the money supply <Tex tex="M" /> of <Tex tex="N" /> members grows, and each member receives
			<Tex tex={String.raw`c\,M/N`} />. Measure a member's balance relative to the average,
			<Tex tex={String.raw`x = B / (M/N)`} />. Since the average grows at rate <Tex tex="c" />,
			<Tex tex={String.raw`\dot x = c - c\,x = c\,(1 - x)`} />. In theOS, measure money per person relative to the
			steady state, <Tex tex={String.raw`b = m/m^{*}`} />. From (3), <Tex tex={String.raw`\dot b = r - r\,b = r\,(1 - b)`} />.
			The two are the same equation. ∎
		</p>
		<p>
			Laborie keeps the dividend relative and lets the amount of money grow; theOS keeps the dividend fixed and lets
			the money melt. Every member's relative position evolves identically. What theOS gains is a unit people can reason
			in, 24 a day, one per hour, and prices that do not drift upward as the money supply grows. Inverting (4) at
			<Tex tex="c = 0.07" /> gives <Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years, so theOS's rate is gentler
			than Laborie's for an 80-year life, a conservative choice that keeps a decade of savings meaningful.
		</p>
		<p>
			Money now has a source, a form and a limit. One practical question is left. If every COOP has its own MIND, how
			does Anna pay for a tram ride with SOLARmind, and how does the solar COOP pay the steel COOP in STEELmind for a
			new turbine? The liquidity pools are the answer.
		</p>
	</section>

	<section id="pol">
		<h2><span>6</span>Keeping every MIND tradeable</h2>
		<p>
			With thousands of COOPs there are thousands of MINDs, and each must be exchangeable at any moment, or
			<em>liquid</em>. theOS uses automated market makers (AMMs) for this. An AMM is a pool of currencies that sets
			their exchange rates from the ratios of its reserves, so anyone can trade at any time against a formula instead
			of waiting for a buyer or seller <Cite k="uniswap" />; such pools give reliable public prices
			<Cite k="angeris" />. The best-known AMMs pair two currencies and are filled by outside investors who can take
			their money out again. theOS does neither. Its pools hold baskets of many MINDs, and they belong to the protocol
			itself.
		</p>
		<div class="law">
			<p class="lawname">The liquidity rule</p>
			<p>
				A tenth of every COOP's treasury flows automatically into liquidity pools. Each pool is a basket of 4 to 12
				different MINDs, and the COOP chooses which baskets its MIND joins. The pools belong to the protocol, not to
				any COOP. What enters a pool can never be withdrawn; it leaves only by being traded out.
			</p>
		</div>
		<p>
			So a COOP is born in two parts. People invest HEARTS, which creates its MIND and fills its treasury. And it
			partners with at least three other COOPs, whose MINDs join its own in its first basket. Only then is its MIND
			tradeable: the solar COOP's SOLARmind might sit in one basket with TRAMmind, AGRImind and STEELmind, and in
			another with WATERmind, COMPUTEmind, HABITATmind and ARTmind. No HEARTS ever sit in a pool, because every HEART
			was converted into MIND the moment it was invested.
		</p>
		<figure>
			<SplitFlow />
			<figcaption>
				<strong>Figure 4.</strong> One HEART invested into a COOP is converted into one MIND and is gone. Half of
				that MIND goes to the investor, half to the COOP's treasury, its working capital; both are the same MIND. A
				tenth of the treasury flows on into the protocol's pools, baskets of 4 to 12 MINDs, and never comes back out.
			</figcaption>
		</figure>
		<h3>6.1 The basket: a weighted geometric mean</h3>
		<p>
			A basket of many currencies needs a formula that works for any number of them. The proven one is the
			<em>geometric mean market maker</em>, run in production by Balancer's weighted pools since 2020
			<Cite k="balancer evans" />. A pool holding <Tex tex={String.raw`x_i`} /> of MIND <Tex tex="i" />, each with a
			weight <Tex tex={String.raw`w_i`} />, keeps
		</p>
		<Tex display tex={String.raw`\begin{gathered} \prod_{i=1}^{n} x_i^{\,w_i} = k, \qquad \sum_i w_i = 1 \\ p_{ij} = \frac{x_i / w_i}{x_j / w_j} \end{gathered} \tag{5}`} />
		<p>
			Every trade keeps the weighted product constant, and the price of MIND <Tex tex="j" /> in MIND
			<Tex tex="i" /> follows from their reserves and weights. Such a pool behaves like an index that rebalances
			itself: at fair prices each MIND makes up exactly its weight of the pool's value. Trades between any two MINDs
			can be routed through many pools at once, a problem that is convex and solved exactly
			<Cite k="angerisMulti routing" />. One property fits theOS especially well. Every MIND in a basket melts at the
			same 7 % a year, so demurrage shrinks every reserve by the same factor and leaves every price in (5) unchanged:
			melting creates no trading opportunity inside a basket.
		</p>
		<h3>6.2 The cost of liquidity, and who carries it</h3>
		<p>
			A pool is not free. When prices move elsewhere, arbitrageurs trade against the pool until its prices catch up,
			and the pool loses what a perfect rebalancer would not. This is called <em>loss-versus-rebalancing</em> (LVR),
			and for a geometric mean pool it is a steady share of the pool's value a year <Cite k="lvr" />. With the
			volatilities <Tex tex={String.raw`\sigma_i`} /> of the MINDs and the covariance <Tex tex={String.raw`\Sigma`} />
			of their price moves,
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{\ell}{V} = \tfrac12\Big(\sum_i w_i \sigma_i^2 - w^{\top}\Sigma\,w\Big) \\ \overset{w_i = 1/n}{=}\; \tfrac12\,\sigma^2 (1-\rho)\Big(1 - \frac1n\Big) \end{gathered} \tag{6}`} />
		<p>
			The right-hand side holds for <Tex tex="n" /> equal weights, a common volatility <Tex tex={String.raw`\sigma`} />
			and a common correlation <Tex tex={String.raw`\rho`} />. The cost grows with how much MINDs move against one
			another and only a little with the size of the basket. In theOS it is carried by the protocol's pools, never by a
			person: the MIND in Anna's wallet is never part of a pool, and a speculative attack thins a pool while every
			COOP's working capital and its turbines keep going. The cost can also be cut. If trades against a pool are
			collected and cleared together at one price, arbitrageurs compete the gain away; this batch design, the
			function-maximising AMM, removes LVR and sandwich attacks in theory <Cite k="fmamm" /> and has run for two-MIND
			pairs as CoW AMM since 2024 <Cite k="cowamm" />.
		</p>
		<figure>
			<LineChart
				title="Yearly loss-versus-rebalancing of an equal-weight basket against its number of MINDs"
				series={lvr}
				x={{ min: 2, max: 12, ticks: [2, 4, 6, 8, 10, 12], fmt: (v, tip) => (tip ? `${fmt(v)} MINDs` : `${v}`), label: 'MINDs in the basket' }}
				y={{ min: 0, max: 8, ticks: [0, 2, 4, 6, 8], fmt: (v, tip) => `${fmt(v, tip ? 2 : Number.isInteger(v) ? 0 : 1)} %`, label: 'LVR a year, share of the pool' }}
				refs={[{ axis: 'x', at: 4, label: 'minimum basket' }]}
			/>
			<figcaption>
				<strong>Figure 5.</strong> The cost (6) of keeping a basket liquid, before any batch trading. Calm MINDs
				(20 % volatility) cost 1.5 % of the pool a year in a basket of four; wild ones (40 %) cost 6 %; when MINDs move
				together (correlation 0.6) the cost falls to 2.4 %. Going from 4 to 12 MINDs adds only about a fifth.
			</figcaption>
		</figure>
		<p>
			Every MIND can now be exchanged for every other through the pools. But no person can follow thousands of
			currencies and their prices. The next layer takes that work away.
		</p>
	</section>

	<section id="avens">
		<h2><span>7</span>Avens: an agent for every person</h2>
		<p>
			Herbert Simon showed that people can weigh only a few options at a time <Cite k="simon" />. This bounded
			rationality is not a flaw to be educated away; it is the design constraint. theOS therefore gives every person an
			Aven, a personal AI agent that works only for its human. People decide on values and goals; Avens do the
			arithmetic. Each person makes two choices:
		</p>
		<ol>
			<li>
				<strong>Where today's HEARTS go:</strong> for example 12 to a fusion COOP and 12 to an art COOP. This decides
				which infrastructure is built or maintained next.
			</li>
			<li>
				<strong>The life one wants to draw on:</strong> a mix of MINDs, for example 40 % AGRImind, 30 % SOLARmind and
				30 % COMPUTEmind. The Aven swaps the MINDs its human holds into that mix through the pools.
			</li>
		</ol>
		<p>The Aven does the rest.</p>
		<ul>
			<li>
				<strong>Keeping money at work.</strong> Every currency melts at the same rate, so exchanging one for another
				cannot escape demurrage. What the Aven can do is keep idle balances small: it invests HEARTS as they arrive and
				holds MINDs close to what is about to be used.
			</li>
			<li>
				<strong>Paying without thinking.</strong> When Anna takes a tram, her Aven finds the cheapest route through the
				pools of Section 6 from the MINDs she holds to the one the tram COOP accepts, and pays in the same moment.
			</li>
			<li>
				<strong>Leaving a bad COOP.</strong> If a COOP turns corrupt or wasteful, it delivers less for its MIND, and its
				MIND falls against the other MINDs in the pools. The Aven sees that a HEART invested there now buys less use
				and moves its human's investment and spending to a better COOP. Albert
				Hirschman named the two ways members discipline an organisation: <em>exit</em>, leaving for a better one, and
				<em>voice</em>, speaking up from inside <Cite k="hirschman" />. Avens make exit effortless and continuous.
			</li>
		</ul>
		<p>
			Prices here do what Hayek asked of them, carrying knowledge no planner holds <Cite k="hayek45" />, and the many
			competing MINDs come close to his proposal for competing private currencies <Cite k="hayek76" />, with one
			difference: every MIND is created from HEARTS issued equally to every person, not by whoever can. With people,
			COOPs, pools and Avens in place, we can ask what the system changes about the long term.
		</p>
	</section>

	<section id="infra">
		<h2><span>8</span>Why building for the long term pays</h2>
		<p>
			Long-lived infrastructure is hard to finance in capitalism because every project competes with a safe
			alternative: a government bond, a loan to the state that pays a fixed return for doing nothing. A 50-year tidal
			barrier must beat that return and a risk premium on top. Gesell and Keynes both saw this floor that a positive
			return on money puts under every investment <Cite k="gesell keynes36" />.
		</p>
		<p>
			In theOS there is no safe alternative. Idle HEARTS lose 7 % a year, and the MINDs an investment creates melt at
			the same rate, so no balance anywhere earns a return for doing nothing. What lasts is what the investment built.
			Comparing the use a project keeps delivering, which changes at its real rate <Tex tex="g" />, with intent left
			idle gives a factor
		</p>
		<Tex display tex={String.raw`\begin{gathered} A(T) = e^{(g + r)\,T} \\ g = -1\,\%,\ r = 7\,\%,\ T = 50 \;\Rightarrow\; A \approx ${tn(advantage, 1)} \end{gathered} \tag{7}`} />
		<p>
			A project that merely keeps its usefulness, or even loses 1 % of it a year, is worth about twenty times more than
			idle HEARTS over half a century. The discount rate, how much less a future benefit counts than a present one, turns
			negative, and the long future becomes worth more, not less. Investment flows toward what keeps being used: grids,
			water systems, domes, rail.
		</p>
		<figure>
			<LineChart
				title="1,000 HEARTS over 50 years, left idle or built into infrastructure"
				series={infra}
				x={{ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], fmt: (v, tip) => fmt(v), label: 'Value left of 1,000' }}
			/>
			<figcaption>
				<strong>Figure 6.</strong> The same 1,000 HEARTS, left idle under 7 % demurrage or invested into
				infrastructure whose use holds its real value (0 %) or slowly wears (−1 %). After 50 years the idle HEARTS
				keep 3 %; the wearing project still delivers 61 % of its first-year use.
			</figcaption>
		</figure>
		<p>
			Long-lived COOPs need to be run well for decades. The last part of the machine is how they are governed.
		</p>
	</section>

	<section id="governance">
		<h2><span>9</span>Governance that evolves</h2>
		<p>
			theOS prescribes no constitution for cooperatives. Each COOP chooses and changes its own way of deciding, and COOPs
			that serve the same need compete on one open field. Elinor Ostrom showed that commons, resources a community
			shares such as a pasture or a fishery, are governed well by the people who use them when the rules fit their place
			<Cite k="ostrom" />. In theOS her design principles become hypotheses that the market tests. Three designs might
			share a sector:
		</p>
		<ul>
			<li><strong>COOP A</strong>, capital-weighted: one token, one vote. Large holders steer.</li>
			<li><strong>COOP B</strong>, strict direct democracy: one person, one vote on every operational choice.</li>
			<li>
				<strong>COOP C</strong>, quadratic voting on strategy, where casting <Tex tex="n" /> votes on one question costs
				<Tex tex="n^2" />, so people can show how strongly they care without the largest holder deciding everything
				<Cite k="qv qf" />; an AI executive for daily operations; and prediction markets, where people bet on outcomes
				so that prices reveal what is likely, for questions of fact <Cite k="hanson" />.
			</li>
		</ul>
		<p>
			Avens send each HEART where it buys the most use. If <Tex tex="s_i" /> is a COOP's share of its sector's HEARTS and
			<Tex tex="f_i" /> the use it delivers per HEART, the shares follow the equation of natural selection, known as
			replicator dynamics: whatever does better than average grows, whatever does worse shrinks,
		</p>
		<Tex display tex={String.raw`\begin{gathered} \dot s_i = k\, s_i \left(f_i - \bar f\right) \\ \bar f = \textstyle\sum_j s_j f_j \end{gathered} \tag{8}`} />
		<p>
			Alchian proposed this mechanism in 1950 to explain why markets select efficient firms even when no firm optimises
			<Cite k="alchian" />. Demurrage sharpens it: a COOP that stops receiving HEARTS watches its treasury melt. Below the
			level its service needs, it winds down and its physical assets return to the commons, to be taken up by a COOP
			that runs them better. Ideas about markets designed on purpose rather than inherited <Cite k="radical" /> become
			experiments here.
		</p>
		<figure>
			<LineChart
				title="Share of a sector's HEARTS flow for three cooperatives with different governance over ten years"
				series={sel}
				x={{ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Share of flow' }}
			/>
			<figcaption>
				<strong>Figure 7.</strong> An illustration of (8), not a forecast. A starts most efficient but drifts toward
				extraction, B is steady but slow, C starts behind and learns. With Avens routing every month, the flow
				follows the utility delivered: A leads in the first year, loses the lead in the second, and after five
				years C carries most of the sector. Governance becomes a technology that improves by selection.
			</figcaption>
		</figure>
		<h3>9.1 The whole machine</h3>
		<p>
			All the pieces are now on the table. The four laws of Section 4, once more:
		</p>
		<ol class="laws">
			<li><strong>Universal Intent Allocation.</strong> Every person receives 24 personal HEARTS a day, one per hour.</li>
			<li><strong>Pure investment.</strong> HEARTS earn no interest and buy nothing; they can only be invested.</li>
			<li><strong>Open cooperative creation.</strong> Anyone can found a COOP, at any time, without permission.</li>
			<li><strong>Every COOP has its own MIND, created by investing HEARTS.</strong> One HEART converts into one MIND, half to the investor, half to the COOP's treasury as working capital.</li>
		</ol>
		<p>
			On top of them, each part of the machine has exactly one job. Table 1 lists them; nothing in theOS does two of
			these jobs, and no job is done twice.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 1.</strong> The parts of theOS and their roles.</caption>
				<thead>
					<tr><th>Part</th><th>Its one job</th><th>Comes from</th><th>Goes to</th></tr>
				</thead>
				<tbody>
					<tr><td>HEARTS</td><td>A person's intent: what they want built</td><td>The UIA, 24 a day per person</td><td>Converted into MIND by investment, or melted</td></tr>
					<tr><td>MIND</td><td>Ownership of a COOP and use of what it makes; held by people as their share and access, by the COOP as working capital</td><td>Every invested HEART, one for one: half to the investor, half to the COOP's treasury</td><td>Used to create, sell and buy the COOP's services, a tenth of every treasury into the pools, or melted</td></tr>
					<tr><td>Liquidity pools</td><td>Price and exchange between MINDs; owned by the protocol, by no COOP</td><td>10 % of every treasury, automatically, in baskets of 4 to 12 MINDs</td><td>Never withdrawn; MIND leaves a pool only by being traded out</td></tr>
					<tr><td>Demurrage</td><td>The only way money leaves: 7 % a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's arithmetic: invest, swap, pay, leave</td><td>One per person</td><td>Work only for their human</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; improved by selection</td><td>Chosen by each COOP</td><td>Tested by where HEARTS flow</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			Section 5.2 gave the monetary policy that ties these parts together: issued as HEARTS, converted into MINDs,
			circulated as MINDs, and melted. Figure 8 shows the machine running.
		</p>
		<figure class="wide">
		<Circulation />
		<figcaption>
				<strong>Figure 8.</strong> The whole machine, simulated. People on the outer ring send their daily HEARTS
				(terracotta) into six COOPs. Every HEART that lands is invested and creates that COOP's MIND: half returns to
				its investor (gold), half sinks into the COOP's treasury, its working capital, whose ring grows and slowly
				melts. No HEART survives the landing. Every few seconds one COOP turns extractive and gives back less for
				each HEART; the Avens see that a HEART buys less use there and route around it, without anyone voting. Rates are sped up so the decay can be seen.
			</figcaption>
		</figure>
	</section>

	<p class="partline" id="part-3">Part III · Toward Abundism</p>

	<section id="city">
		<h2><span>10</span>Proving it: first a game, then a city</h2>
		<p>
			A theory of a whole economy cannot be tested in a laboratory, and it should not be tested on people's lives first.
			maiaCITY therefore proves theOS in two steps. The first is a game: a world in which AI agents with their own needs
			and goals live, trade and invest under exactly the rules of this paper. Every rule is a parameter that can be
			measured, changed through an open proposal and played again, so the claims of Sections 5 to 9 become experiments
			instead of hopes. The early worlds already run the first layer: 24 HEARTS a day that melt at 7 % a year, and
			cooperatives that collect what is invested in them. The second step is the real city: the rules that survive the
			game become the economy of maiaCITY as it is built.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 2.</strong> Each part of theOS, first in the game, then in the city.</caption>
				<thead>
					<tr><th>Element</th><th>In the game</th><th>In the city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>Every agent receives 24 personal HEARTS a day, only investable</td><td>Every resident receives 24 personal HEARTS a day, one identity per person</td></tr>
					<tr><td>Demurrage</td><td>Continuous, Eq. (1), on HEARTS and MINDs</td><td>The same rule, fixed in the protocol</td></tr>
					<tr><td>Cooperatives</td><td>Agents found COOPs and invest HEARTS into their MINDs</td><td>An energy COOP for a village's geothermal plant, a food COOP for its food forest, a housing COOP for its domes</td></tr>
					<tr><td>Markets</td><td>Protocol-owned baskets of 4 to 12 MINDs, fed with 10 % of every treasury</td><td>Avens route every purchase through the pools</td></tr>
					<tr><td>Agents</td><td>AI agents with memory and goals, later joined by human players</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Governance</td><td>Rule changes as open proposals, measured world by world</td><td>COOPs choose their own governance and compete (Section 9)</td></tr>
				</tbody>
			</table>
		</div>
		<h3>10.1 A roadmap in four steps</h3>
		<ol>
			<li><strong>Continuous decay.</strong> Run Eq. (1) in the game and measure how agents' behaviour changes with the rate.</li>
			<li><strong>HEARTS into MINDs.</strong> Let agents found several cooperatives, each with its own MIND, treasury and pools, and watch which ones survive.</li>
			<li><strong>Human intents.</strong> Let people make the two daily choices of Section 7 and leave the rest to their Aven, so humans and AI agents share one economy.</li>
			<li><strong>The first real village.</strong> One village centre with its energy, food and housing cooperatives, run on the rules that survived the game.</li>
		</ol>
		<p>
			Before the city is built, the game must also answer the questions this paper cannot yet answer.
		</p>
	</section>

	<section id="limits">
		<h2><span>11</span>Limitations and open problems</h2>
		<p>A blueprint is only scientific if it says where it could fail.</p>
		<ul>
			<li>
				<strong>One person, one allocation.</strong> The UIA needs identity that no one can fake many times over, known
				as Sybil resistance: one human, one stream of HEARTS, without a central registry that can exclude people
				<Cite k="soul" />. maiaCITY's passkey-based vaults are a start, not a proof.
			</li>
			<li>
				<strong>Escape into assets.</strong> Gesell's warning from Section 2: melting money pushes wealth into land and
				anything else that does not decay <Cite k="gesell" />. theOS must decide how land, and other stores of value
				outside the protocol, are held in common or carry the same decay.
			</li>
			<li>
				<strong>The rate.</strong> 7 % is a choice, not a law of nature. Section 5.3 suggests 7 to 9 % from
				generational fairness; the game should test how behaviour changes across that range.
			</li>
			<li>
				<strong>Pool attacks.</strong> AMM prices can be pushed for a moment by anyone with enough money. The pools
				need time-averaged prices and limits on how fast an Aven follows a price.
			</li>
			<li>
				<strong>Liquidity that never leaves.</strong> Pools nobody can withdraw from cannot be fixed by moving money
				out, so their code must be right from the start: audited rounding, a guarded pause, and an upgrade path
				decided before launch. Batch trading is proven for two-currency pools; clearing baskets of 4 to 12 MINDs in
				batches still has to be shown, first in the game.
			</li>
			<li>
				<strong>Capture and graceful failure.</strong> A failing COOP must return its assets to the commons without a
				fire sale, and the rule for who takes them over must itself resist capture.
			</li>
			<li>
				<strong>Exchange between people.</strong> With HEARTS only investable, how people are rewarded in MINDs for
				creative or care work, and how MINDs pass between people, needs its own design.
			</li>
		</ul>
	</section>

	<section id="synthesis">
		<h2><span>12</span>From capitalism to Abundism</h2>
		<p>
			We began with two questions: who gets what is made, and who decides what is made next. Capitalism answered both
			with wages and ownership, and automation is taking that answer away. theOS answers them differently. Everyone
			receives an equal, daily share of direction. That share can only build things, and what it builds belongs to those
			who built it. All money melts like the world it measures, so nothing can be hoarded out of reach. The whole
			architecture fits in one line:
		</p>
		<Tex display tex={String.raw`\left(\mathrm{HEARTS} + \mathrm{MINDS}\right) \cdot \mathrm{ACTION} = \mathrm{ABUNDANCE} \tag{9}`} />
		<p>
			<strong>HEARTS</strong> are human intention, issued equally to everyone, every day. <strong>MINDS</strong> are
			what that intention becomes: the shared intelligence of the cooperatives, ownership and utility in one.
			<strong>ACTION</strong> is the conscious act of turning the one into the other. Neither intention without capacity nor capacity without intention builds
			anything; only the product does, within the limits of one planet <Cite k="raworth" />.
		</p>
		<p>
			In capitalism, human action was sold by the hour so that people could survive. In Abundism, survival is the
			baseline the machines provide, and human action becomes steering: deciding, every day and together, what the
			city builds next. maiaCITY will prove it first as a game, and then for real.
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
