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
		RATE, UIA_DAY, dailyLoss, halfLife, steadyState, lifeForRate, rtmRate, impermanentLoss,
		idleSeries, convergenceSeries, infraSeries, ilSeries, selectionSeries, fmt
	} from '$lib/theos/model.js';

	// the four series colours, validated together for colour-blind separation on the paper's surface
	const C = ['#c8744f', '#2f6fbf', '#1f7a52', '#8a5fb0'];

	// one rate drives Figures 2 and 3, so a reader can feel what the 7 % does
	let rate = $state(RATE);

	const idle = idleSeries().map((s, i) => ({ id: `r${s.r}`, label: `${Math.round(s.r * 100)} % a year`, color: [C[1], C[0], C[3]][i], points: s.points }));
	const conv = $derived(convergenceSeries(rate).map((s, i) => ({ ...s, color: [C[3], C[1], C[0]][i] })));
	const star = $derived(steadyState(rate));
	const infra = infraSeries().map((s, i) => ({ ...s, color: [C[0], C[1], C[2]][i] }));
	const il = [{ id: 'il', label: 'Impermanent loss', color: C[1], points: ilSeries() }];
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
			['hearts', '4 · HEARTS: money that starts with people'],
			['entropy', '5 · Melting money, in numbers'],
			['coops', '6 · COOPs and MINDs: where value is built'],
			['pol', '7 · Keeping every MIND tradeable'],
			['avens', '8 · Avens: an agent for every person'],
			['infra', '9 · Why building for the long term pays'],
			['governance', '10 · Governance that evolves']
		] },
		{ title: 'Part III · Toward Abundism', sections: [
			['city', '11 · Proving it: first a game, then a city'],
			['limits', '12 · Limitations and open problems'],
			['synthesis', '13 · From capitalism to Abundism'],
			['references', 'References']
		] }
	];
</script>

<svelte:head>
	<title>theOS · The civilizational operating system of Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, protocol-owned liquidity and open market governance, by Samuel Andert." />
</svelte:head>

<main class="paper">
	<header class="masthead">
		<p class="brand">theOS</p>
		<p class="kind">Working paper · v5 · October 2026 · maiaCITY</p>
		<h1>The civilizational operating system of Abundism</h1>
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
			carried as one currency that is its protocol, its ownership and its utility at once. Half goes to the investor
			and half to the cooperative, and the same MIND is what the cooperative creates, sells and buys its services
			with. Third, all money slowly melts, losing {pct(RATE * 100)} of its value a year, just as
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
			in Section 12. Demurrage tells us how money should behave. It does not yet tell us where new money should come
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
			asked which rule for creating money treats every generation the same, the living and those not yet born. His
			answer is a <em>universal dividend</em>: new money paid to every member alike, which grows the money supply by a
			yearly rate <Tex tex="c" /> tied to how long people live <Cite k="laborie" />. The Ğ1 currency has run on this
			rule since 2017 <Cite k="duniter" />.
		</p>
		<p>
			Circles UBI took the idea one step further and gave every person their own personal currency, minted at one token
			an hour, so that money starts with people rather than with banks <Cite k="circles" />. Its second version lets
			balances decay at 7 % a year, joining Gesell's melting to Laborie's dividend. Because every person's coin is
			different, Circles moves value between people through a web of trust: I accept your currency because I trust
			you, and payments travel along chains of such trust.
		</p>
		<p>
			We now have the three ingredients: money that melts, money created equally for every person, and money that
			carries its owner's name. theOS combines them and makes one decisive change. It drops Circles' web of trust,
			because the personal currency is never traded between people at all. It can only be <em>invested</em>. That
			change is where the operating system begins.
		</p>
	</section>

	<p class="partline" id="part-2">Part II · The operating system</p>

	<section id="hearts">
		<h2><span>4</span>HEARTS: money that starts with people</h2>
		<p>
			theOS rests on four laws, fixed in its base protocol the way a physics engine fixes gravity. Everything else,
			prices, cooperatives and governance, grows on top of them and can change; the laws cannot. We introduce them one at
			a time, as the story needs them. The first two say where money comes from.
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
			what a person wants to see built. <em>Allocation</em>, because it is handed out, not earned. It is not a survival
			handout but a share in steering where the automated economy puts its effort. That is why the second law is needed.
		</p>
		<div class="law">
			<p class="lawname">Law 2 · Pure investment</p>
			<p>
				HEARTS earn no interest and cannot buy goods directly. They enter the economy only by being invested into
				cooperatives.
			</p>
		</div>
		<p>
			A HEART is therefore not spending money. It is a vote with weight, cast every day by every person. Before we see
			what it is invested into, we look at what happens to HEARTS over time, because they melt.
		</p>
	</section>

	<section id="entropy">
		<h2><span>5</span>Melting money, in numbers</h2>
		<h3>5.1 Continuous decay</h3>
		<p>
			Every HEART, and every other currency in theOS, loses value at a fixed rate of <Tex tex="r = 0.07" /> a year: this
			is Gesell's demurrage, built into the protocol. The decay is applied continuously, every time a balance is
			touched, so there is no settlement date to game and no moment where moving money just before a cut-off pays:
		</p>
		<Tex display tex={String.raw`B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t}, \qquad \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \tag{1}`} />
		<p>
			Here <Tex tex="B" /> is a balance and <Tex tex={String.raw`\Delta t`} /> the time since it was last touched, in
			years. A day costs <Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a
			balance, and an idle balance halves in
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{2}`} />
		<p>
			The cost is too small to notice on money that is being used and large enough that nobody keeps a fortune idle.
			In Fisher's terms, demurrage raises the velocity <Tex tex="V" /> rather than the amount <Tex tex="M" />. Wealth
			stops being something one <em>has</em> and becomes something one <em>does</em>.
		</p>
		<figure>
			<LineChart
				title="An idle balance of 100 HEARTS over 40 years, at 3, 7 and 10 % demurrage"
				series={idle}
				x={{ min: 0, max: 40, ticks: [0, 10, 20, 30, 40], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years left idle' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => fmt(v, tip ? 1 : 0), label: 'HEARTS left of 100' }}
				refs={[{ axis: 'x', at: halfLife(), label: `half-life at 7 %: ${fmt(halfLife(), 1)} y` }]}
			/>
			<figcaption>
				<strong>Figure 1.</strong> What is left of 100 idle HEARTS. At theOS's 7 % a year, half is gone after
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
				surface: time held along one axis, the demurrage rate along the other, the height what is left of one HEART.
				The terracotta line is the rate set by the slider, which also drives Figure 3. Drag to turn it.
			</figcaption>
		</figure>
		<h3>5.2 The steady state: a self-levelling money supply</h3>
		<p>
			Now put the two flows together. HEARTS flow in through the UIA,
			<Tex tex={String.raw`u = ${UIA_DAY} \times 365 = ${tn(UIA_DAY * 365)}`} /> a year, and flow out through
			demurrage. The balance of a person who neither invests nor receives anything else follows
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dB}{dt} = u - rB, \qquad B^{*} = \frac{u}{r} \\ B(t) = B^{*} + \left(B_0 - B^{*}\right) e^{-rt} \end{gathered} \tag{3}`} />
		<p>
			At <Tex tex="r = 0.07" /> the steady state is <Tex tex={String.raw`B^{*} \approx ${tn(steadyState())}`} /> HEARTS.
			Every balance is drawn toward it from either side, the newborn's from below and the hoard's from above, and the
			gap halves every {fmt(halfLife(), 1)} years. Nobody is taxed and nobody is redistributed to; the levelling is a
			property of the rule itself. The money supply of <Tex tex="N" /> people can never exceed
			<Tex tex={String.raw`N u / r`} />, so the daily allocation can never inflate without limit.
		</p>
		<p>
			Because HEARTS can only be invested, <Tex tex={String.raw`B^{*}`} /> is the most uninvested intent anyone can
			ever pile up, not a fortune: a person who invests every day holds almost none. Section 10 shows that the same
			bound holds for all money in theOS, HEARTS and MINDs together.
		</p>
		<figure>
			<LineChart
				title="Balances under the UIA and demurrage converge to the same steady state"
				series={conv}
				x={{ min: 0, max: 60, ticks: [0, 10, 20, 30, 40, 50, 60], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1_000_000, ticks: [0, 250_000, 500_000, 750_000, 1_000_000], fmt: (v, tip) => (tip ? fmt(v) : v >= 999_500 ? '1 M' : v ? `${fmt(v / 1000)}k` : '0'), label: 'HEARTS held' }}
				refs={[{ axis: 'y', at: star, label: `steady state u/r = ${fmt(star)}` }]}
			/>
			<figcaption>
				<strong>Figure 3.</strong> Three members under the same rule: a newborn with nothing, a member at the
				average, and one who starts with a million HEARTS. If none of them invests, they meet at <Tex tex="u/r" />. Move the
				slider under Figure 2: a lower rate raises the steady state and slows the convergence, a higher one does the
				opposite. Real balances are lower, because HEARTS leave as they are invested; the rule sets the ceiling.
			</figcaption>
		</figure>
		<h3>5.3 The same rule as the Relative Theory of Money</h3>
		<p>
			Section 3 introduced Laborie's universal dividend. He derives its rate from the requirement that each generation
			co-create the same share of money over a life of <Tex tex={String.raw`e_v`} /> years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{4}`} />
		<p>
			<strong>Proposition 1.</strong> <em>theOS with a fixed allocation <Tex tex="u" /> and demurrage
			<Tex tex="r" /> is the Relative Theory of Money with <Tex tex="c = r" />, written in a different unit.</em> In
			Laborie's system the money supply <Tex tex="M" /> of <Tex tex="N" /> members grows, and each member receives
			<Tex tex={String.raw`c\,M/N`} />. Measure a member's balance relative to the average,
			<Tex tex={String.raw`x = B / (M/N)`} />. Since the average grows at rate <Tex tex="c" />,
			<Tex tex={String.raw`\dot x = c - c\,x = c\,(1 - x)`} />. In theOS, measure the balance relative to the steady
			state, <Tex tex={String.raw`b = B/B^{*}`} />. From (3), <Tex tex={String.raw`\dot b = r - r\,b = r\,(1 - b)`} />.
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
			So far HEARTS only arrive and melt. They become useful when they are invested, and that is where value is built.
		</p>
	</section>

	<section id="coops">
		<h2><span>6</span>COOPs and MINDs: where value is built</h2>
		<p>
			A HEART has to be invested somewhere. In theOS that somewhere is a cooperative, or COOP: an enterprise owned by the
			people who invest in it and use it, such as an energy COOP running a power plant or a food COOP running a farm.
			The third law keeps the field open.
		</p>
		<div class="law">
			<p class="lawname">Law 3 · Open cooperative creation</p>
			<p>
				Anyone, alone or together, can found a COOP at any time without permission, for energy, food, compute, housing,
				art, or any need not yet met.
			</p>
		</div>
		<p>
			The fourth law says what an investment creates. It is the heart of the system, because it is the moment a
			person's intent turns into something that can be owned and used.
		</p>
		<div class="law">
			<p class="lawname">Law 4 · Every COOP has its own MIND, created by investing HEARTS</p>
			<p>
				Every COOP has its own MIND: SOLARmind for a solar COOP, AGRImind for a farming COOP. A MIND is the COOP's
				shared intelligence, its automated capacity to make something, carried as one currency that is three things
				at once: the COOP's protocol, ownership of it, and the right to use it. MIND comes into being only through
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
			back into the treasury. And it <em>buys</em> what it needs from other COOPs with it. Value is built wherever
			people send their HEARTS, and it is used through the MINDs those HEARTS created.
		</p>
		<p>
			MINDs melt at the same 7 % a year as HEARTS, so a COOP's currency is worth holding only while the COOP keeps
			producing. That raises a practical question. If every COOP has its own currency, how does Anna pay for a tram ride
			with SOLARmind, and how does the solar COOP pay the steel COOP in STEELmind for a new turbine? A small part of
			each treasury is the answer.
		</p>
	</section>

	<section id="pol">
		<h2><span>7</span>Keeping every MIND tradeable</h2>
		<p>
			With thousands of COOPs there are thousands of MINDs, and each must be exchangeable at any moment, or
			<em>liquid</em>. theOS uses automated market makers (AMMs) for this. An AMM is a pool holding two currencies
			that sets their exchange rate from the ratio of its reserves, so anyone can trade at any time against a formula
			instead of waiting for a buyer or seller <Cite k="uniswap" />. Such pools have been shown to give reliable public
			prices <Cite k="angeris" />. In theOS every pool pairs two MINDs, for example SOLARmind and TRAMmind. A pool holding <Tex tex="x" /> of one
			MIND and <Tex tex="y" /> of the other keeps
		</p>
		<Tex display tex={String.raw`x \cdot y = k, \qquad p = \frac{x}{y} \tag{5}`} />
		<p>
			Whatever the trades, the product of the two reserves stays constant, and the price follows from their ratio. In
			ordinary decentralised finance, outside <em>liquidity providers</em> deposit the two currencies into these pools
			and carry <em>impermanent loss</em>: when the price moves by a factor <Tex tex="p" />, their deposit is worth less
			than if they had simply kept the two currencies,
		</p>
		<Tex display tex={String.raw`\mathrm{IL}(p) = \frac{2\sqrt{p}}{1 + p} - 1. \tag{6}`} />
		<p>
			In theOS nobody outside the COOPs provides this reserve. Law 4 already gave every COOP a treasury of its own MIND.
			Most of it stays working capital; the COOP puts only a small portion into pools, paired against the MINDs of
			other COOPs, so that its currency can be swapped for theirs. No HEARTS ever sit in a pool, because every HEART was
			converted into MIND the moment it was invested. Because the COOPs themselves, not outside traders, own these
			reserves, this is called <em>protocol-owned liquidity</em>.
		</p>
		<figure>
			<SplitFlow />
			<figcaption>
				<strong>Figure 4.</strong> One HEART invested into a COOP is converted into one MIND and is gone. Half of
				that MIND goes to the investor, half to the COOP's treasury, its working capital; both are the same MIND.
				Only a small portion of the treasury goes into pools against other COOPs' MINDs.
			</figcaption>
		</figure>
		<p>
			Impermanent loss does not disappear; it moves onto the COOP's books, where it is an operating cost of keeping its
			currency liquid, like wear on a machine. Because only a small portion of the treasury sits in pools, a price swing
			touches only that portion. The MIND in Anna's wallet is never part of a pool, and a speculative attack thins a pool
			while the COOP's working capital and its turbines keep going.
		</p>
		<figure>
			<LineChart
				title="Impermanent loss of a constant-product pool against the price move"
				series={il}
				endLabels={false}
				x={{ min: 0.1, max: 10, log: true, ticks: [0.1, 0.25, 0.5, 1, 2, 4, 10], fmt: (v, tip) => `${tip ? 'Price ×' : '×'}${fmt(v, v < 1 ? 2 : tip ? 2 : 0)}`, label: 'Price change between the two MINDs (log scale)' }}
				y={{ min: -45, max: 0, ticks: [0, -10, -20, -30, -40], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Loss against holding' }}
				refs={[{ axis: 'y', at: impermanentLoss(2) * 100, label: `price ×2 or ÷2: ${fmt(impermanentLoss(2) * 100, 1)} %`, end: true, below: true }]}
			/>
			<figcaption>
				<strong>Figure 5.</strong> Impermanent loss from (6). A doubling or halving of one MIND's price against the other costs the pool
				5.7 % against simply holding; a tenfold move costs 42.5 %. In theOS this is a cost the COOP carries, never
				the individual.
			</figcaption>
		</figure>
		<p>
			Every MIND can now be exchanged for every other through the pools. But no person can follow thousands of
			currencies and their prices. The next layer takes that work away.
		</p>
	</section>

	<section id="avens">
		<h2><span>8</span>Avens: an agent for every person</h2>
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
				pools of Section 7 from the MINDs she holds to the one the tram COOP accepts, and pays in the same moment.
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
		<h2><span>9</span>Why building for the long term pays</h2>
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
		<h2><span>10</span>Governance that evolves</h2>
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
		<h3>10.1 The whole machine: one role each, one monetary policy</h3>
		<p>
			All the pieces are now on the table. The four laws, in one place:
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
					<tr><td>MIND</td><td>A COOP's intelligence: its protocol, ownership and utility in one; held by people as their share and access, by the COOP as working capital</td><td>Every invested HEART, one for one: half to the investor, half to the COOP's treasury</td><td>Used to create, sell and buy the COOP's services, a small part held in pools, or melted</td></tr>
					<tr><td>AMM pools</td><td>Price and exchange between MINDs</td><td>A small part of COOP treasuries, MIND against MIND</td><td>Never holds HEARTS</td></tr>
					<tr><td>Demurrage</td><td>The only way money leaves: 7 % a year on everything</td><td>The protocol</td><td>Nobody; melted money is gone</td></tr>
					<tr><td>Avens</td><td>One person's arithmetic: invest, swap, pay, leave</td><td>One per person</td><td>Work only for their human</td></tr>
					<tr><td>COOP governance</td><td>How each COOP decides; improved by selection</td><td>Chosen by each COOP</td><td>Tested by where HEARTS flow</td></tr>
				</tbody>
			</table>
		</div>
		<p>
			This also makes theOS's monetary policy complete and short. Money is <em>issued</em> only as HEARTS, at
			<Tex tex="u" /> per person a year. It changes form only by <em>conversion</em>, one HEART into one MIND,
			which neither creates nor destroys money. It <em>circulates</em> as MIND: a COOP creates, sells and buys its
			services in it, and pays other COOPs by swapping through the pools. And it <em>leaves</em> only by demurrage. With
			<Tex tex="H" /> all HEARTS and <Tex tex="M" /> all MINDs held by <Tex tex="N" /> people and their COOPs,
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{d(H + M)}{dt} = N u - r\,(H + M) \\ H + M \;\to\; \frac{N u}{r} = N \cdot ${tn(steadyState())} \end{gathered} \tag{9}`} />
		<p>
			Whatever people invest, spend or trade, the total amount of money settles at
			{fmt(steadyState())} per person, the same level as (3). There is no central bank, no interest rate to set and
			no inflation target: the policy is the four laws and one rate. Figure 8 shows the machine running.
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
		<h2><span>11</span>Proving it: first a game, then a city</h2>
		<p>
			A theory of a whole economy cannot be tested in a laboratory, and it should not be tested on people's lives first.
			maiaCITY therefore proves theOS in two steps. The first is a game: a world in which AI agents with their own needs
			and goals live, trade and invest under exactly the rules of this paper. Every rule is a parameter that can be
			measured, changed through an open proposal and played again, so the claims of Sections 5 to 10 become experiments
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
					<tr><td>Markets</td><td>Small AMM pools of MIND against MIND, owned by the COOPs</td><td>Avens route every purchase through the pools</td></tr>
					<tr><td>Agents</td><td>AI agents with memory and goals, later joined by human players</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Governance</td><td>Rule changes as open proposals, measured world by world</td><td>COOPs choose their own governance and compete (Section 10)</td></tr>
				</tbody>
			</table>
		</div>
		<h3>11.1 A roadmap in four steps</h3>
		<ol>
			<li><strong>Continuous decay.</strong> Run Eq. (1) in the game and measure how agents' behaviour changes with the rate.</li>
			<li><strong>HEARTS into MINDs.</strong> Let agents found several cooperatives, each with its own MIND, treasury and pools, and watch which ones survive.</li>
			<li><strong>Human intents.</strong> Let people make the two daily choices of Section 8 and leave the rest to their Aven, so humans and AI agents share one economy.</li>
			<li><strong>The first real village.</strong> One village centre with its energy, food and housing cooperatives, run on the rules that survived the game.</li>
		</ol>
		<p>
			Before the city is built, the game must also answer the questions this paper cannot yet answer.
		</p>
	</section>

	<section id="limits">
		<h2><span>12</span>Limitations and open problems</h2>
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
				<strong>Pool attacks.</strong> AMM prices can be pushed for a moment by anyone with enough money. COOPs need
				time-averaged prices and limits on how fast an Aven follows a price.
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
		<h2><span>13</span>From capitalism to Abundism</h2>
		<p>
			We began with two questions: who gets what is made, and who decides what is made next. Capitalism answered both
			with wages and ownership, and automation is taking that answer away. theOS answers them differently. Everyone
			receives an equal, daily share of direction. That share can only build things, and what it builds belongs to those
			who built it. All money melts like the world it measures, so nothing can be hoarded out of reach. The whole
			architecture fits in one line:
		</p>
		<Tex display tex={String.raw`\left(\mathrm{HEARTS} + \mathrm{MINDS}\right) \cdot \mathrm{ACTION} = \mathrm{ABUNDANCE} \tag{10}`} />
		<p>
			<strong>HEARTS</strong> are human intention, issued equally to everyone, every day. <strong>MINDS</strong> are
			what that intention becomes: the shared intelligence of the cooperatives, their protocol, ownership and utility
			in one.
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
			<strong>Cite as:</strong> Andert, S. (2026). theOS: The civilizational operating system of Abundism. A macroeconomic and
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
