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

	// one rate drives Figures 3 and 4, so a reader can feel what the 7 % does
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

	const sections = [
		['why', '1 · Why: the distribution crisis'],
		['lineage', '2 · A century of melting money'],
		['laws', '3 · How: five laws of the protocol'],
		['entropy', '4 · Demurrage as economic entropy'],
		['avens', '5 · The Aven layer'],
		['infra', '6 · The infrastructure paradox'],
		['pol', '7 · Protocol-owned liquidity'],
		['governance', '8 · Open market governance'],
		['city', '9 · What: from game to city'],
		['limits', '10 · Limitations and open problems'],
		['synthesis', '11 · The Abundism synthesis'],
		['references', 'References']
	];
</script>

<svelte:head>
	<title>theOS · The Operating System for Abundism · maiaCITY</title>
	<meta name="description" content="theOS: a macroeconomic and system-engineering framework for a post-labour economy. Universal intent allocation, continuous demurrage, protocol-owned liquidity and open market governance, by Samuel Andert." />
</svelte:head>

<main class="paper">
	<header class="masthead">
		<p class="kind">Working paper · v5 · October 2026 · maiaCITY</p>
		<h1>theOS: The Operating System for Abundism</h1>
		<p class="subtitle">A macroeconomic and system-engineering framework for a post-labour economy</p>
		<p class="author">Samuel Andert</p>
		<p class="affil">maiaCITY · Munich</p>
	</header>

	<section class="abstract" aria-label="Abstract">
		<h2>Abstract</h2>
		<p>
			When machines do most of the work, wages stop being a way to share what is made. This paper describes theOS, a
			monetary and organisational protocol designed for that world. Every person receives {UIA_DAY} HEARTS a day, a
			universal <em>intent</em> allocation that can only be invested into open cooperatives (COOPs). Each investment
			mints the cooperative's own utility currency, its MIND, split equally between the investor and the cooperative's
			treasury, which uses it as protocol-owned liquidity. All balances decay continuously at {pct(RATE * 100)} a year.
			We show that this demurrage turns the money supply into a self-levelling system in which every balance converges
			to the same steady state of {fmt(steadyState())} HEARTS with a half-life of {fmt(halfLife(), 1)} years, that it is
			formally equivalent to Laborie's Relative Theory of Money with a rate <Tex tex="c = r" />, that it inverts the
			discounting problem of long-lived infrastructure, and that it lets cooperatives compete as an evolutionary
			market of governance designs. Personal AI agents (Avens) hide the resulting complexity behind two human
			choices a day. theOS is specified as an upgrade to maiaCITY's own game economy (Sandbox 7), where it can be
			tested with AI agents before it becomes the economy of a real city.
		</p>
		<p class="keywords">
			<strong>Keywords:</strong> demurrage · universal dividend · Relative Theory of Money · post-labour economics ·
			cooperatives · automated market makers · protocol-owned liquidity · mechanism design
		</p>
		<p class="keywords"><strong>JEL:</strong> E42 · E51 · H41 · O33 · P13</p>
	</section>

	<nav class="toc" aria-label="Contents">
		<h2>Contents</h2>
		<ol>
			{#each sections as [id, label] (id)}
				<li><a href="#{id}">{label}</a></li>
			{/each}
		</ol>
	</nav>

	<figure class="wide">
		<Circulation />
		<figcaption>
			<strong>Figure 1.</strong> The loop of theOS, simulated. People on the outer ring send their daily HEARTS
			(terracotta) into six cooperatives. Every HEART that lands is minted into that cooperative's MIND and split
			50/50: one half returns to its investor (gold), the other sinks into the treasury, whose ring grows and slowly
			melts. Every few seconds one cooperative turns extractive; the Avens see that a HEART buys less there and route
			around it, without anyone voting. Rates are sped up so the decay can be seen.
		</figcaption>
	</figure>

	<section id="why">
		<h2><span>1</span>Why: the distribution crisis</h2>
		<p>
			For two centuries the wage has done two jobs at once. It paid people for their work, and it was the main
			channel through which the output of an economy reached the households that consume it. Keynes saw in 1930 that
			these two jobs would one day come apart: within a century, he wrote, the “economic problem” of scarcity could be
			solved, and the hard question would become what to do with the freedom <Cite k="keynes30" />. Ninety-six years
			later the forecast is arriving through a door Keynes did not draw. Frey and Osborne estimated that
			47 % of US employment was at high risk of computerisation <Cite k="frey" />; Acemoglu and Restrepo measured that
			each additional industrial robot per thousand workers lowered the employment-to-population ratio and wages in
			the commuting zones that adopted them <Cite k="acemoglu" />. Language models and humanoid robotics now reach into
			the cognitive and manual work that was left.
		</p>
		<p>
			Production does not fall when labour leaves it; it rises. What fails is distribution. If income flows to
			whoever owns the machines, and the return on that capital outruns growth, wealth concentrates without limit, as
			Piketty documented for the twentieth century under the simple inequality <Tex tex="r > g" /> <Cite k="piketty" />.
			A universal basic income is the standard answer <Cite k="parijs" />, but a cash transfer funded by taxing the
			owners leaves the structure intact: people receive consumption, never direction. They can spend, but they cannot
			decide what the automated economy builds next.
		</p>
		<p>
			There is a second, older failure underneath. Frederick Soddy, a Nobel chemist, pointed out in 1926 that real
			wealth obeys the laws of thermodynamics while debt obeys compound interest: houses crumble, harvests rot, machines
			rust, but a claim on them can grow for ever <Cite k="soddy" />. Georgescu-Roegen later made entropy the core of
			his economics <Cite k="georgescu" />. Money that does not decay lets its owner step outside the physics everyone
			else lives in, and the most rational use of a surplus becomes to sit on it.
		</p>
		<p class="thesis">
			theOS starts from these two observations. It replaces the wage as the distribution channel with a daily
			allocation of <em>steering</em> rather than spending power, and it puts money back under the same entropy as the
			things it stands for. The rest of this paper explains how those two moves fit together, why they are stable,
			and what is still unknown.
		</p>
	</section>

	<section id="lineage">
		<h2><span>2</span>A century of melting money</h2>
		<p>
			Nothing in theOS is invented from nothing. Its parts have been proposed, tested and argued over for more than a
			century; what is new is their combination and the agents that make them usable.
		</p>
		<dl class="lineage">
			<dt>Silvio Gesell, 1916</dt>
			<dd>
				<em>Freigeld</em>: money should carry a holding cost, like every good it competes with, so that it circulates
				instead of waiting for a higher interest rate. Gesell paired it with <em>Freiland</em>, common ownership of
				land, because otherwise wealth simply flees from money into soil <Cite k="gesell" />.
			</dd>
			<dt>Wörgl, 1932–33</dt>
			<dd>
				In the Tyrolean town of Wörgl, mayor Unterguggenberger issued labour certificates that lost 1 % a month unless
				stamped. During the depression the town paved roads and built a bridge with them, until the Austrian national
				bank stopped the scheme <Cite k="schwarz" />.
			</dd>
			<dt>Irving Fisher, 1933; John Maynard Keynes, 1936</dt>
			<dd>
				Fisher, the author of the equation of exchange <Tex tex="MV = PQ" /> <Cite k="fisher11" />, wrote a book-length
				case for stamp scrip in the United States <Cite k="fisher33" />. Keynes devoted part of chapter 23 of the
				<em>General Theory</em> to Gesell and predicted that “the future will learn more from the spirit of Gesell than
				from that of Marx” <Cite k="keynes36" />.
			</dd>
			<dt>Kennedy, Lietaer, Gelleri, 1995–2009</dt>
			<dd>
				Margrit Kennedy showed how compound interest silently transfers wealth upward <Cite k="kennedy" />; Bernard
				Lietaer argued for complementary currencies alongside national money <Cite k="lietaer" />. The Chiemgauer in
				Bavaria has run a regional demurrage currency since 2003, losing 2 % a quarter <Cite k="gelleri" />.
			</dd>
			<dt>Stéphane Laborie, 2010</dt>
			<dd>
				The <em>Relative Theory of Money</em> (Théorie Relative de la Monnaie) asks what monetary rule treats every
				generation symmetrically, the living and those not yet born. Its answer: every member co-creates the same share
				of money, a universal dividend that grows the money supply by a rate <Tex tex="c" /> tied to life expectancy
				<Cite k="laborie" />. The Ğ1 currency has run on it since 2017 <Cite k="duniter" />. Section 4 shows that theOS is
				the same rule written in a fixed unit.
			</dd>
			<dt>Ostrom, Hirschman, Weyl, 1970–2022</dt>
			<dd>
				Elinor Ostrom showed that commons are governed well by the people who use them when the rules fit their place
				<Cite k="ostrom" />. Albert Hirschman named the two ways members discipline an organisation, exit and voice
				<Cite k="hirschman" />. Quadratic voting and quadratic funding gave voice a price that protects minorities
				<Cite k="qv qf" />, and <em>Radical Markets</em> and the work on soulbound identity explored markets that are
				designed rather than inherited <Cite k="radical soul" />.
			</dd>
			<dt>Automated market makers, 2018–</dt>
			<dd>
				Constant-product pools let anyone trade against a formula instead of an order book <Cite k="uniswap" />, and
				were later shown to be reliable price oracles <Cite k="angeris" />. They are what makes thousands of small
				currencies liquid without a human market maker for each.
			</dd>
		</dl>
	</section>

	<section id="laws">
		<h2><span>3</span>How: five laws of the protocol</h2>
		<p>
			theOS fixes five rules in its base protocol, the way a physics engine fixes gravity. Everything else (prices,
			cooperatives, governance) emerges on top of them and can change; these cannot.
		</p>
		<ol class="laws">
			<li>
				<strong>Universal Intent Allocation (UIA).</strong> Every human receives {UIA_DAY} HEARTS a day,
				unconditionally, one per hour lived. It is not a survival handout: it is an inalienable share in steering where
				the automated economy puts its effort.
			</li>
			<li>
				<strong>Pure investment.</strong> HEARTS cannot earn interest and cannot buy goods directly. They enter the
				economy only by being invested into cooperatives.
			</li>
			<li>
				<strong>The 50/50 commons split.</strong> Investing one HEART into a COOP mints that COOP's own currency, its
				MIND (SOLARmind, AGRImind and so on). Half goes to the investor as INVESTORmind, personal equity and the right
				to use what the COOP produces; half goes to the COOP's treasury as TREASURYmind, protocol-owned liquidity.
			</li>
			<li>
				<strong>Open cooperative creation.</strong> Anyone, alone or together, can found a COOP at any time without
				permission, for energy, food, compute, housing, art, or any need not yet met.
			</li>
			<li>
				<strong>MINDs as utility currencies.</strong> To use what a COOP produces (drawing electricity, eating from its
				food network) one spends that COOP's MIND. A COOP's currency is a claim on its output, not on its profit.
			</li>
		</ol>
		<p>
			Two quantities follow from these rules. HEARTS are the intent of people; MINDs are the productive capacity of
			cooperatives. Both decay at the same rate, which is the subject of the next section.
		</p>
	</section>

	<section id="entropy">
		<h2><span>4</span>Demurrage as economic entropy</h2>
		<h3>4.1 Continuous decay</h3>
		<p>
			Every HEART and every MIND loses value at a hardcoded rate of <Tex tex="r = 0.07" /> a year. The decay is applied
			continuously, every time a balance is touched, so there is no settlement date to game and no moment where moving
			money just before a cut-off pays:
		</p>
		<Tex display tex={String.raw`B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t}, \qquad \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \tag{1}`} />
		<p>
			A day costs <Tex tex={String.raw`1 - e^{-r/365} \approx ${fmt(dailyLoss() * 100, 4)}\,\%`} /> of a balance, and an
			idle balance halves in
		</p>
		<Tex display tex={String.raw`t_{1/2} = \frac{\ln 2}{r} \approx ${fmt(halfLife(), 1)}\ \text{years}. \tag{2}`} />
		<p>
			The cost is small enough that nobody notices it on a working balance and large enough that nobody keeps a
			fortune idle. Wealth stops being something one <em>has</em> and becomes something one <em>does</em>: in the
			terms of Fisher's equation <Tex tex="MV = PQ" />, demurrage raises the velocity <Tex tex="V" /> rather than the
			quantity <Tex tex="M" />.
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
				<strong>Figure 2.</strong> What is left of 100 idle HEARTS. At theOS's 7 % a year, half is gone after
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
				<strong>Figure 3.</strong> The whole family of decay curves <Tex tex={String.raw`B(t, r) = e^{-rt}`} /> as one
				surface: time held along one axis, the demurrage rate along the other, the height what is left of one HEART.
				The terracotta line is the rate set by the slider, which also drives Figure 4. Drag to turn it.
			</figcaption>
		</figure>

		<h3>4.2 The steady state: a self-levelling money supply</h3>
		<p>
			Combine the inflow of the UIA, <Tex tex={String.raw`u = ${UIA_DAY} \times 365 = ${tn(UIA_DAY * 365)}`} /> HEARTS a
			year, with the outflow of demurrage. The balance of a member who neither spends nor receives anything else
			follows
		</p>
		<Tex display tex={String.raw`\begin{gathered} \frac{dB}{dt} = u - rB, \qquad B^{*} = \frac{u}{r} \\ B(t) = B^{*} + \left(B_0 - B^{*}\right) e^{-rt} \end{gathered} \tag{3}`} />
		<p>
			At <Tex tex="r = 0.07" /> the steady state is <Tex tex={String.raw`B^{*} \approx ${tn(steadyState())}`} /> HEARTS.
			Every balance converges to it from either side, the newborn's from below and the hoard's from above, and the
			gap halves every {fmt(halfLife(), 1)} years. Nobody is taxed and nobody is redistributed to; the levelling is a
			property of the rule itself. The money supply of a population of <Tex tex="N" /> people is bounded at
			<Tex tex={String.raw`N u / r`} />, so the UIA can never inflate without limit.
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
				<strong>Figure 4.</strong> Three members under the same rule: a newborn with nothing, a member at the
				average, and one who starts with a million. With no spending at all they meet at <Tex tex="u/r" />. Move the
				slider under Figure 3: a lower rate raises the steady state and slows the convergence, a higher one does the
				opposite. Real balances also move with spending and income; the rule sets where they are pulled.
			</figcaption>
		</figure>

		<h3>4.3 Equivalence with the Relative Theory of Money</h3>
		<p>
			Laborie's RTM grows the money supply <Tex tex="M" /> of <Tex tex="N" /> members by a universal dividend
			<Tex tex={String.raw`\mathrm{DU} = c \, M/N`} /> per period <Cite k="laborie" />. He derives the rate from the
			requirement that each generation co-create the same share of money over a life of <Tex tex={String.raw`e_v`} />
			years:
		</p>
		<Tex display tex={String.raw`\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx ${fmt(rtmRate(80) * 100, 1)}\,\% \end{gathered} \tag{4}`} />
		<p>
			<strong>Proposition 1.</strong> <em>theOS with a fixed allocation <Tex tex="u" /> and demurrage
			<Tex tex="r" /> is the RTM with <Tex tex="c = r" />, written in a different unit.</em> In RTM, measure a member's
			balance relative to the average, <Tex tex={String.raw`x = B / (M/N)`} />. Each member receives
			<Tex tex={String.raw`c\,M/N`} /> while the average grows at rate <Tex tex="c" />, so
			<Tex tex={String.raw`\dot x = c - c\,x = c\,(1 - x)`} />. In theOS, measure the balance relative to the steady
			state, <Tex tex={String.raw`b = B/B^{*}`} />. From (3), <Tex tex={String.raw`\dot b = r - r\,b = r\,(1 - b)`} />.
			The two are the same differential equation. ∎
		</p>
		<p>
			RTM expresses money in a growing quantity and keeps the dividend relative; theOS keeps the dividend fixed and
			lets the quantity melt. The relative positions of every member evolve identically. What theOS gains is a unit
			people can reason in (24 a day, one per hour), and prices that do not drift upward as the money supply grows.
			Inverting (4) at <Tex tex="c = 0.07" /> gives <Tex tex={String.raw`e_v \approx ${tn(ev)}`} /> years: theOS's rate
			is gentler than Laborie's generational symmetry for an 80-year life, a conservative choice that keeps
			savings for a decade meaningful. Whether 7 % or Laborie's ≈ 9 % is right for a city is an empirical question
			for the game (Section 9).
		</p>
	</section>

	<section id="avens">
		<h2><span>5</span>The Aven layer: zero cognitive load</h2>
		<p>
			A world of thousands of cooperative currencies would be unusable by people. Herbert Simon's bounded rationality
			<Cite k="simon" /> is not a flaw to be educated away; it is the design constraint. theOS therefore puts a personal
			AI agent, an Aven, between every human and the market. Humans act on values and goals; Avens do the arithmetic.
		</p>
		<h3>5.1 Two human choices a day</h3>
		<ol>
			<li>
				<strong>The HEARTS allocation:</strong> where today's 24 HEARTS go, for example 12 to FUSIONcoop and 12 to
				ARTcoop. This decides which infrastructure is built or maintained next.
			</li>
			<li>
				<strong>The MIND target portfolio:</strong> the lifestyle mix one wants to be able to draw on, for example
				40 % AGRImind, 30 % SOLARmind and 30 % COMPUTEmind.
			</li>
		</ol>
		<h3>5.2 What the Aven does</h3>
		<ul>
			<li>
				<strong>Keeping money at work.</strong> Because every token decays at the same rate, swapping cannot escape
				demurrage. What the Aven can do is keep idle balances small: it invests HEARTS as they arrive, holds MINDs
				close to what is about to be used, and leaves nothing waiting.
			</li>
			<li>
				<strong>Seamless consumption.</strong> When its human draws water or takes a tram, the Aven finds the cheapest
				route through the AMM pools to the MIND that service needs and settles in the same moment.
			</li>
			<li>
				<strong>Exit without effort.</strong> If a COOP turns corrupt or inefficient, its MIND buys less per HEART on
				the open pools. The Aven sees the worse rate and routes its human's investment and consumption to a better COOP.
				This is Hirschman's <em>exit</em> made frictionless and continuous <Cite k="hirschman" />; it is what Figure 1
				shows when a cooperative turns red.
			</li>
		</ul>
		<p>
			Prices here do what Hayek asked of them, carrying knowledge no planner holds <Cite k="hayek45" />, and the many
			competing MINDs are close to his proposal for competing private monies <Cite k="hayek76" />, with one difference:
			the base unit is issued equally to every person, not by whoever can.
		</p>
	</section>

	<section id="infra">
		<h2><span>6</span>The infrastructure paradox, inverted</h2>
		<p>
			Long-lived infrastructure is hard to finance in capitalism because every project competes with a safe
			alternative: a government bond that pays a positive return for doing nothing. Any 50-year tidal barrier must
			beat that, and a risk premium on top. Gesell and Keynes both saw the floor that a positive return on money puts
			under every investment decision <Cite k="gesell keynes36" />.
		</p>
		<p>
			In theOS the safe alternative melts. Holding HEARTS idle yields <Tex tex="-7\,\%" /> a year, so a project with a
			real return <Tex tex="g" /> beats holding money by a factor
		</p>
		<Tex display tex={String.raw`\begin{gathered} A(T) = e^{(g + r)\,T} \\ g = -1\,\%,\ r = 7\,\%,\ T = 50 \;\Rightarrow\; A \approx ${tn(advantage, 1)} \end{gathered} \tag{5}`} />
		<p>
			A project that merely preserves its usefulness, or even loses 1 % of it a year, is about twenty times better than
			cash over half a century. The discount rate of a demurrage economy is negative, and the long future becomes
			worth more, not less. Capital looks for physical anchors that keep being used: grids, aquifers, domes, rail.
		</p>
		<figure>
			<LineChart
				title="1,000 HEARTS of purchasing power over 50 years, idle or built into infrastructure"
				series={infra}
				x={{ min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000], fmt: (v, tip) => fmt(v), label: 'Value left of 1,000' }}
			/>
			<figcaption>
				<strong>Figure 5.</strong> The same 1,000 HEARTS of purchasing power, left idle under 7 % demurrage or built
				into infrastructure that holds its real value (0 %) or slowly wears (−1 %). After 50 years the idle sum keeps
				3 %; the wearing project keeps 61 %.
			</figcaption>
		</figure>
	</section>

	<section id="pol">
		<h2><span>7</span>Protocol-owned liquidity</h2>
		<p>
			Each MIND needs a market so Avens can route through it. theOS uses constant-product automated market makers
			<Cite k="uniswap" />: a pool holding <Tex tex="x" /> HEARTS and <Tex tex="y" /> TREASURYmind keeps
		</p>
		<Tex display tex={String.raw`x \cdot y = k, \qquad p = \frac{x}{y} \tag{6}`} />
		<p>
			In ordinary decentralised finance, private liquidity providers fund these pools and carry impermanent loss: when
			the price moves by a factor <Tex tex="p" />, their share is worth less than if they had simply held the two
			tokens,
		</p>
		<Tex display tex={String.raw`\mathrm{IL}(p) = \frac{2\sqrt{p}}{1 + p} - 1. \tag{7}`} />

		<figure>
			<SplitFlow />
			<figcaption>
				<strong>Figure 6.</strong> One HEART through the 50/50 commons split. Half of the minted MIND goes to the
				investor; the other half stays with the COOP and is paired with the HEART itself in the COOP's own pool.
				Nobody outside the COOP provides its liquidity.
			</figcaption>
		</figure>

		<p>
			The 50/50 split changes who carries that loss. Every COOP owns half of its MIND supply and receives every HEART
			invested in it, which is exactly what it needs to seed and own its pool. Impermanent loss does not disappear; it
			moves onto the COOP's balance sheet, where it is booked as an operating cost of keeping its currency liquid, like
			wear on a machine. An investor's INVESTORmind is never part of a pool and is never diluted by a swing. A
			speculative attack thins the COOP's pool while its turbines keep turning.
		</p>
		<figure>
			<LineChart
				title="Impermanent loss of a constant-product pool against the price move"
				series={il}
				endLabels={false}
				x={{ min: 0.1, max: 10, log: true, ticks: [0.1, 0.25, 0.5, 1, 2, 4, 10], fmt: (v, tip) => `${tip ? 'Price ×' : '×'}${fmt(v, v < 1 ? 2 : tip ? 2 : 0)}`, label: 'Price change of the MIND against HEARTS (log scale)' }}
				y={{ min: -45, max: 0, ticks: [0, -10, -20, -30, -40], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Loss against holding' }}
				refs={[{ axis: 'y', at: impermanentLoss(2) * 100, label: `price ×2 or ÷2: ${fmt(impermanentLoss(2) * 100, 1)} %`, end: true, below: true }]}
			/>
			<figcaption>
				<strong>Figure 7.</strong> Impermanent loss from (7). A doubling or halving of a MIND's price costs the pool
				5.7 % against simply holding; a tenfold move costs 42.5 %. In theOS this is a cost the COOP carries, never
				the individual.
			</figcaption>
		</figure>
	</section>

	<section id="governance">
		<h2><span>8</span>Open market governance</h2>
		<p>
			theOS prescribes no constitution for cooperatives. Each COOP chooses and changes its own governance, and COOPs
			serving the same need compete on one open field. Three designs might share a sector:
		</p>
		<ul>
			<li><strong>COOP A</strong>, capital-weighted: one token, one vote. Large holders steer.</li>
			<li><strong>COOP B</strong>, a strict demarchy <Cite k="burnheim" />: one person, one vote on every operational choice.</li>
			<li>
				<strong>COOP C</strong>, quadratic voting on strategy <Cite k="qv" /> with an AI executive for daily
				operations, and prediction markets for questions of fact <Cite k="hanson" />.
			</li>
		</ul>
		<p>
			Avens send each HEART where it buys the most utility. If <Tex tex="s_i" /> is a COOP's share of the sector's
			flow and <Tex tex="f_i" /> the utility it delivers per HEART, the shares follow replicator dynamics,
		</p>
		<Tex display tex={String.raw`\dot s_i = k\, s_i \left(f_i - \bar f\right), \qquad \bar f = \textstyle\sum_j s_j f_j, \tag{8}`} />
		<p>
			the mechanism Alchian proposed in 1950 for why markets select efficient firms even when no firm optimises
			<Cite k="alchian" />. Demurrage sharpens the selection: a COOP that stops receiving HEARTS watches its treasury
			melt at 7 % a year. Below the level its service needs, it winds down and its physical assets return to the
			commons, to be taken up by a COOP that runs them better. Ostrom's design principles <Cite k="ostrom" /> become
			hypotheses that the market tests, not rules a regulator imposes.
		</p>
		<figure>
			<LineChart
				title="Share of a sector's HEARTS flow for three cooperatives with different governance over ten years"
				series={sel}
				x={{ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v, tip) => (tip ? `Year ${fmt(v, 1)}` : `${v}`), label: 'Years' }}
				y={{ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v, tip) => `${fmt(v, tip ? 1 : 0)} %`, label: 'Share of flow' }}
			/>
			<figcaption>
				<strong>Figure 8.</strong> An illustration of (8), not a forecast. A starts most efficient but drifts toward
				extraction, B is steady but slow, C starts behind and learns. With Avens routing every month, the flow
				follows the utility delivered: A leads in the first year, loses the lead in the second, and after five
				years C carries most of the sector. Governance becomes a technology that improves by selection.
			</figcaption>
		</figure>
	</section>

	<section id="city">
		<h2><span>9</span>What: from game to city</h2>
		<p>
			theOS is not only a proposal on paper. maiaCITY's own economy game, Sandbox 7, already runs its first
			layer: AI Avens with their own minds trade food and water for HEARTS in a valley, every Aven mints 24 HEARTS a
			night, every HEART decays at 7 % a year, field investments flow into a Maia City COOP that pays a dividend, and
			every rule change is a Maia Improvement Proposal (MIP) that is accepted or rejected before a new world starts. More than thirty worlds
			have been played and analysed. theOS is the upgrade path for that game, and the game is the laboratory for the
			city.
		</p>
		<div class="table-wrap">
			<table>
				<caption><strong>Table 1.</strong> From Sandbox 7 today to theOS in the game, and then in the city.</caption>
				<thead>
					<tr><th>Element</th><th>Sandbox 7 today</th><th>theOS in the game</th><th>theOS in the city</th></tr>
				</thead>
				<tbody>
					<tr><td>Allocation</td><td>24 HEARTS minted per Aven per night</td><td>24 HEARTS a day, only investable</td><td>UIA for every resident, one identity per person</td></tr>
					<tr><td>Demurrage</td><td>7 % a year, charged nightly</td><td>Continuous, Eq. (1), on HEARTS and MINDs</td><td>Same rule, set in the protocol</td></tr>
					<tr><td>Cooperatives</td><td>One Maia City COOP ledger (field CAPEX and OPEX, dividend)</td><td>Open COOP founding, one MIND each, 50/50 split</td><td>ENERGYcoop (a village's geothermal plant), AGRIcoop (the food forest), HABITATcoop (domes)</td></tr>
					<tr><td>Markets</td><td>Hourly order book per good</td><td>AMM pools owned by each COOP</td><td>Avens route every purchase through the pools</td></tr>
					<tr><td>Agents</td><td>10 AI Avens with memory and goals</td><td>Avens with a human's two intents</td><td>One Aven per resident, on their own device</td></tr>
					<tr><td>Governance</td><td>MIPs adopted by the world's admin</td><td>Per-COOP governance of its own choosing</td><td>The evolutionary matrix of Section 8</td></tr>
				</tbody>
			</table>
		</div>
		<h3>9.1 A roadmap in four steps</h3>
		<ol>
			<li><strong>Continuous decay in the game.</strong> Replace the nightly charge with Eq. (1) and measure whether Avens' behaviour changes.</li>
			<li><strong>MINDs and the 50/50 split.</strong> Turn the Maia City COOP into the first of several cooperatives, each with its own MIND and pool, and let Avens found new ones.</li>
			<li><strong>Human intents.</strong> Let players set the two daily choices of Section 5 and leave the rest to their Aven, so humans and AI agents play in the same economy.</li>
			<li><strong>The first real village.</strong> One village centre with its energy, food and housing cooperatives, run on the rules that survived the game.</li>
		</ol>
	</section>

	<section id="limits">
		<h2><span>10</span>Limitations and open problems</h2>
		<p>A blueprint is only scientific if it says where it could fail. These are the questions theOS has not yet answered.</p>
		<ul>
			<li>
				<strong>One person, one allocation.</strong> The UIA needs Sybil-resistant identity: one human, one stream of
				HEARTS, without a central registry that can exclude people <Cite k="soul" />. maiaCITY's passkey-based vaults
				are a start, not a proof.
			</li>
			<li>
				<strong>Escape into assets.</strong> Gesell knew that demurrage money pushes wealth into land and anything else
				that does not decay <Cite k="gesell" />. theOS must decide how land, and other stores of value outside the
				protocol, are held in common or carry the same entropy.
			</li>
			<li>
				<strong>The rate.</strong> 7 % is a choice, not a law of nature. Section 4.3 suggests ≈ 7–9 % from
				generational symmetry; the game should test how behaviour changes across that range.
			</li>
			<li>
				<strong>Pool attacks and oracles.</strong> AMM prices can be pushed for a moment by anyone with capital. COOPs
				need time-weighted prices and limits on how fast an Aven's routing follows a price.
			</li>
			<li>
				<strong>Governance capture and graceful failure.</strong> A COOP's bankruptcy must return its assets to the
				commons without a fire sale, and the rule for who takes them over must itself resist capture.
			</li>
			<li>
				<strong>Consumption between people.</strong> With HEARTS only investable, what a person earns for creative or
				care work in MINDs, and how MINDs pass between people, needs its own design.
			</li>
		</ul>
	</section>

	<section id="synthesis">
		<h2><span>11</span>The Abundism synthesis</h2>
		<p>The architecture of theOS fits in one line:</p>
		<Tex display tex={String.raw`\left(\mathrm{HEARTS} + \mathrm{MINDS}\right) \cdot \mathrm{ACTION} = \mathrm{ABUNDANCE} \tag{9}`} />
		<p>
			<strong>HEARTS</strong> are human vitality and intention, issued equally to everyone, every day.
			<strong>MINDS</strong> are collective intelligence and the automated infrastructure of the cooperatives.
			<strong>ACTION</strong> is the conscious act of directing the one into the other. Neither intent without
			capacity nor capacity without intent builds anything; only the product does.
		</p>
		<p>
			In the old economy, human action was sold by the hour so that people could survive. In theOS, survival is the
			baseline the machines provide, and human action becomes steering: deciding, every day and together, what the
			city builds next. Money that melts like the world it measures, an equal share of direction for every person, and
			cooperatives that must keep earning trust: that is the operating system. maiaCITY will run it first as a game,
			and then for real.
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
			<strong>Cite as:</strong> Andert, S. (2026). theOS: The Operating System for Abundism. A macroeconomic and
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

	.lineage dt {
		margin-top: 1rem;
		font-family: var(--font-body);
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--terracotta);
	}

	.lineage dd {
		margin: 0.2rem 0 0;
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
