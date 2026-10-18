<!-- The words of maia.city/theos/ as Markdown, made by scripts/docs-markdown.mjs from the built page. -->

theOS

Working paper · v8 · October 2026 · maiaCITY

# The civilization scale operating system of Abundism

A macroeconomic and system-engineering framework for a post-labour economy

Samuel Andert and Claude

maiaCITY · Munich

## Abstract

Picture a city where machines grow the food, run the power plants and build the homes. Two questions decide if such a city is a good place to live. Who gets a fair share of what the machines make? And who decides what they build next? For two centuries, wages and ownership answered both: most people worked, got a wage and spent it. If machines do most of the work, that answer stops working.

This paper proposes a different answer: an economic operating system that we call theOS. Every person gets a personal currency every day, simply for being alive: 24 HEARTS, one for each hour. This is the universal intent allocation (Law 1): the right to invest, never a handout. Samuel's are samuelHEARTS, Anna's are annaHEARTS. HEARTS buy nothing and pay for nothing, not even food (Law 2). They are a voice. People can only invest them into cooperatives, or COOPs: shared enterprises that make what a city needs, such as energy, food or housing.

Each HEART that a person invests converts into one new MIND of that COOP: 0.5 to the investor, 0.4 to the treasury, 0.1 to the city's pools (Law 4). So half goes to the investor. A MIND is one currency of ownership and utility: to hold it is to own part of the COOP, and to spend it is to use what the COOP makes. The treasury is the money that the COOP works with. The city's pools, baskets of MINDs whose LP tokens the City COOP holds, let anyone trade one MIND for another. Every value is shown in HEARTS, the unit of account: the average MIND is worth 1 HEART.

Every sale pays the COOP's owners (Law 5). 20 % of every sale goes at once, in the COOP's own MIND, to everyone who holds it: people, other COOPs and the city's pools, in proportion to what each holds. The COOP's own treasury gets none, because paying itself would only move its MIND in a circle. Only real deliveries count as sales. Ownership pays: each holder gets a share of every sale, in more MIND.

All money melts slowly, just as food spoils and machines wear out: 7 % a year. A holding grows after the melt only while its COOP sells well (Section 8.1). Money per person settles at a fixed level, and each person's relative position then moves as in Stéphane Laborde's Relative Theory of Money.

In this economy, no human labour is paid. Each person has a personal AI agent, called an Aven, which proposes and delivers all work with the COOPs' machines. A person's MIND comes from three places: their own half of the HEARTS they invest, the work proposals their Aven delivers, and Law 5 dividends. COOPs that make the same good compete, and anyone can found a rival. Prices move freely with demand, with no caps. Everything the city makes costs energy, and theOS aims for a city where only physics limits abundance, never a lack of MIND.

The paper separates what theOS is from what we expect it to achieve. Part II gives its rules, the policies that the city sets, and its concepts. Part III states what it should achieve as hypotheses, each with a status that the evidence sets. Our central claim is Proposition 3, a hypothesis. Take a city that can make enough, whose output per person grows, and whose sellers compete. Proposition 3 says that then no one starves and no one has to work to survive. And living standards rise for every tenth of the people, by holdings and by Aven output, in real units. Each tenth gets its basics at need. No extra falls more than 2 % in any 5 years. A fall does not count when the tenth got all it wanted of that good, or the good was at its natural or physical limit. People whose Avens deliver nothing, whom we call owner-only, are meant to live from what they own. That is the ownership that each day's investing creates, and its dividends. We claim all this from the end of the founding: the city's first days, in which every person comes to hold MIND. The founding is reported on its own.

Part IV tests the hypotheses in one simulation, the economic model, which checks every person. It has 250 people over 60 years. Its main run is now the upgrades of round 2. On its main seed, no one went short, no COOP failed, and by the old yardstick it passed all three checks of Proposition 3. One seed is one random history. So we also ran 24 seeds on which rival rules meet the same shocks. There, all three parts held on 21 seeds by the old yardstick. By the verdict, the taste-adjusted reading of part 3 (Section 10.3), part 3 held on none of them. But fewer tenths failed: 399 of 480, against 480 under the earlier main run (Section 11.2). The lasting return on holdings (dividends plus any lasting price rise, a year) depends on the seed. It is below the melt on 7 of 8 seeds and on 22 of 24 seeds with the same shocks (median 2.37 %). It is above only on seed 20261015. Where it is above, nothing bounds how unequal ownership can grow.

The main run invests the founding week in the sellers of the basics, and no one went short in its founding. The strict test, in which dividends alone pay the basics, is a stronger target that the proposition does not claim. It failed on the main seed. The 16 hypotheses stand at 2 proven, 2 supported, 1 mixed, 5 failing and 6 open, and Proposition 3 is failing. An open hypothesis is one that no simulation tests yet. We propose a fix for each failure. In its latest round, the economic model tried 5 changes and kept 3. Section 11.4 lists the next tests.

We test theOS first in simulation, then in the real city. The rules that survive these tests become the economy of maiaCITY, the city we are building. Part V names the limits and the open problems.

**Keywords:** demurrage · personal currencies · universal intent allocation · Relative Theory of Money · post-labour economics · cooperatives · automated market makers · city-owned liquidity · unit of account · mechanism design · agent-based model · stock-flow consistency · energy return on investment

**JEL:** C63 · D31 · E42 · E51 · H41 · O33 · P13 · Q43

Part I · From capitalism

## 1Why: the end of the wage

Every economy must answer two questions. Who gets what is made? And who decides what is made next? Capitalism answers both through work and ownership. Most people sell their time for a wage and spend the wage on what others make. The people who own the factories, the land and the capital decide what to build, and they keep what remains. For two centuries this system held, for all its injustice, because the owners needed the workers and so had to share.

That need may be ending. In 1930, Keynes saw that within a century humanity could solve the “economic problem” of scarcity. The hard question would then be what to do with the freedom [45]. Nearly a century later, part of his forecast is coming true, by a road he did not expect: machines that learn. How fast it comes is still open, and the estimates differ widely.

Frey and Osborne put 47 % of US jobs at high risk of computerisation [29]. Studies of the tasks inside each job find about 9 % across the OECD [8]. Acemoglu expects AI to raise total factor productivity, the output of all inputs together, by at most about 0.66 % over ten years [1]. The ILO expects most exposed jobs to change, not to disappear [34], and new kinds of work keep appearing [10].

So automation is a strong trend, not yet today's fact. But the trend is real. Acemoglu and Restrepo found that each additional industrial robot per thousand workers lowered employment and wages in the local labour markets most exposed to robots [2]. Language models and humanoid robots now begin to take on thinking and handling work too. Rifkin argues that machines will make more and more goods at almost no extra cost [70]. If automation keeps spreading, production does not fall. It rises.

What fails is distribution. If income flows to whoever owns the machines, wealth tends to concentrate. Piketty traced this over three centuries of data. Concentration fell between 1914 and the 1970s, after wars, taxes and inflation, and it has risen since. He named the force behind it in one simple inequality, $r > g$. When the return on capital, $r$, is larger than the growth of the whole economy, $g$, existing owners take a growing share of everything [66]. (Later sections use $r$ and $g$ for other things; Appendix B lists every symbol.)

Today's data show where this leads. Since 2004, the share of world income that goes to work fell by 1.6 points. That is about 2.4 trillion dollars a year, and AI can push the share lower [42]. In the United States, the richest 1 % own half of all company shares [14]. So about half of each gain that AI adds to share prices goes to them. In Germany, the richest tenth own more than half of all net wealth [21]. The Gini index measures how unevenly something is shared, in one number from 0 to 1. At 0, everyone has the same. At 1, one person has everything. If Anna owns three times as much as Mia, and they are the whole city, the Gini index is 0.25. For wealth in Germany it is 0.72 [21]. Korinek and Suh show that wages can fall even before machines can do every task [50].

This is the distribution problem of capitalism in its sharpest form. Income reaches people through two channels: wages and ownership. Automation closes the first channel and widens the second. So a fair answer must work through ownership. And new ownership must go to every person directly. People cannot earn it through wages that disappear, and they must not inherit it, because inheritance repeats the past. Rawls called an economy that spreads ownership "at the beginning of each period" a property-owning democracy [68]. Meade proposed such an economy for an age of automation in 1964 [58], and Roemer designed shares that every citizen gets in equal number [71]. None of these proposals gives every person an equal flow of new ownership, every day, that the person directs. theOS does. That ownership melts like every other balance, so it piles up only while its COOPs sell well (Section 5.4).

This argument does not need the fastest path. It needs only the trend: output moves from wages to ownership, and ownership is concentrated. Korinek and Suh compare paths of different speed [50]. In theOS, every person gets 24 HEARTS a day, a currency that can only be invested into cooperatives (COOPs). Each investment creates ownership in that COOP (Section 4). Table 1 shows three speeds of automation, and what theOS does in each.

***Table 1.** Three speeds of automation, after the scenarios of Korinek and Suh, and the role of theOS in each.*

| Speed | What machines do | Wages | What theOS does |
| --- | --- | --- | --- |
| Slow | Take over tasks one by one, as in recent decades; new kinds of work keep appearing | Keep rising; the share of income that goes to work falls slowly | Runs beside the euro economy. Outside the city, anyone may still take a job for euros. Inside it, no human labour is paid: there are only work proposals, and HEARTS build a stake of ownership |
| Medium | Can do most tasks in about 20 years | Rise at first, then fall in more and more jobs | The ownership that investing creates, work proposals and dividends carry a growing share of each person's income |
| Fast | Can do most tasks in about 5 years | Can collapse once machines spread faster than new capital is built | HEARTS become the main way to gain ownership. How plentiful the basics are depends on what the COOPs' machines make, and on the energy they harvest |

The usual answer is a universal basic income: a fixed sum that everyone gets without conditions [79]. It would feed people, but it keeps the structure as it is. People would get consumption, never direction: they could spend, but they could not decide what the automated economy builds next. theOS is meant to secure the basics through ownership. The ownership that each day's investing creates, and its dividends, should pay for the basics without work (Hypothesis H3, Section 10.3). Most income still comes from the work that each person's AI agent delivers. In the last ten years of the economic model, these work proposals brought 81 % of people's income (Section 11.2.2). HEARTS themselves pay for nothing (Law 2, Section 4). And the MIND that a person's investing creates is not a basic income. It is ownership in COOPs that the person chose: its value follows their success, and it melts.

This paper describes a way out. It keeps what markets do well and changes the base they stand on. We call the destination *Abundism*: an economy in which automation makes the basics plentiful, and every person helps to decide what the economy builds. In Abundism, distribution is always a question of fair participation through fair ownership. Each person's AI agent, the Aven of Section 7, proposes and delivers the work with the machines. Outside the city, anyone may still take a job for euros. Inside it, there are only work proposals (Section 4). A person gains MIND, the money of ownership and use of Section 4, and Section 11.2.2 shows where it comes from. The aim is concrete. No one starves, and no one has to work to survive. Living standards rise for every tenth of the people, by holdings and by Aven output, in real units. theOS aims for a city where only physics limits how far (Section 8.4). Section 10.3 states this as Proposition 3, a hypothesis. We test every rule first in simulation. In the economic model, simulated people live under these rules, and it checks every person (Section 11). Then we test the rules in the real city. To get there, we must first look at the tool that both questions pass through: money. What is it, who creates it, and why does it behave the way it does?

## 2What money is, and why it should melt

Money works like a shared memory of who gave what to whom. Kocherlakota showed that money can do the same job as a complete record of past trades [49]. A note in your pocket says that you once gave something of value, and that you can now claim something back. Irving Fisher wrote down how this memory moves through an economy, in his equation of exchange [26]. Fisher counted all trades; the usual form today counts the goods and services produced: $MV = PQ$. The amount of money, $M$, times how often it changes owner, $V$, equals the prices, $P$, times the goods, $Q$. Money does its job only while it moves.

But our money is built to stand still. Everything else in the world decays. In 1926 Frederick Soddy, a Nobel chemist, wrote that houses crumble, harvests rot and machines rust. A claim on them, however, can grow for ever at compound interest [76]. Later, Georgescu-Roegen put entropy at the core of his economics [32]. Entropy is the tendency of every ordered thing to fall apart unless energy keeps it in order. The world that money measures runs on energy and wears out. Section 8.4 returns to this: energy is the one resource that every other resource needs.

Money that never loses value lets its owner escape the physics that everyone else lives in. The most rational thing to do with a surplus is then to keep it idle. And the people who already hold the most can wait the longest.

Silvio Gesell proposed the fix more than a century ago. In 1916 he argued that money should carry a small holding cost, like every good it competes with. Money would then circulate and not wait for a higher interest rate [33]. Section 8 shows what a safe return does to long-lived projects. The name for a fee on holding money is *demurrage*: the charge that a ship pays for each day it lies idle in port. In theOS, nobody collects it: the money simply melts, and what melts is gone (Section 5). This paper calls it *the melt* (demurrage). Demurrage is one of the two ideas that this paper builds on, and people tested it in practice:

- In 1932–33, mayor Unterguggenberger of the Tyrolean town of Wörgl issued notes that lost 1 % a month. To keep a note's value, its holder had to buy a stamp for it. During the Depression, the town paved roads and built a bridge with these notes. Then the Austrian national bank stopped the scheme. The best-known account comes from Fritz Schwarz, a supporter of Gesell [72].
- Fisher himself wrote a whole book in support of such stamped money, or stamp scrip, for the United States [27]. Keynes predicted that “the future will learn more from the spirit of Gesell than from that of Marx” [46].
- Margrit Kennedy showed how compound interest silently moves wealth upward [44]. Bernard Lietaer argued for complementary currencies: local or purpose-made money that runs beside the national one [53]. The Chiemgauer in Bavaria, a regional demurrage currency, started in 2003 and still runs today. It loses 2 % every quarter [30].

Melting money alone is not enough. Gesell paired his *Freigeld* (free money) with *Freiland* (free land): land that the community owns and leases out, and never sells [33]. theOS keeps both ideas (Section 8.2). Keynes named the weakness. If money carries a cost, wealth moves into other stores that do not melt: bank money, debts at call, foreign money, jewellery and precious metals. At times, he added, the craving to own land had done the same, but Gesell's Freiland would end it [46]. theOS closes both doors: land in Section 8.2 and the euro in Section 8.3. Other stores stay open (Section 12.4). Demurrage tells us how money should behave. It does not yet tell us where new money should come from, and that is the next question.

## 3Who should create money

Today, banks create most money when they lend [57]. Whoever gets the loan gets the new money first and repays it with interest. If money is a shared memory, there is a fairer starting point: create it equally for every person.

Stéphane Laborde developed this idea in his *Relative Theory of Money* (Théorie Relative de la Monnaie). He asked which way of creating money treats every generation the same: the people alive now and those not yet born. His answer is a *universal dividend*: new money paid to every member alike, at a rate that depends on how long people live [51]. (This paper keeps the word *dividend* for Law 5's share of each sale, Section 4.) His rule sets the yearly rate from the life expectancy: for a life of 80 years, about 9.2 %. The Ğ1 currency started in 2017 and uses this rule [23]. Remember his rule. Section 5.3 shows that theOS reaches the same rule by another road, once its money has settled (Proposition 1).

Circles UBI took the idea one step further. In Circles, every person gets their own currency, so money starts with people and not with banks [19]. Its second version uses the two numbers that theOS adopts. These are 24 tokens a day, one an hour, and a demurrage of 7 % a year [20]. Because every person's coin is different, Circles needs a web of trust to move value between people: I accept your coin because I trust you.

We now have the three ingredients: money that melts, money created equally for every person, and money that carries its owner's name. theOS combines them and makes one decisive change. It drops Circles' web of trust, because people never trade the personal currency with each other at all. They can only *invest* it. That change is where the operating system starts.

Part II · The operating system: rules, policies and concepts

## 4The five laws

theOS rests on five laws. The protocol, the shared software at the base of theOS, fixes them the way a physics engine fixes gravity. Part II says what theOS is, in three kinds of statement. A *rule* is a law of the protocol, or a rule built on the laws; only a new version of the protocol changes it (Appendix F). A *policy* is a setting that the City COOP chooses by a vote of its members, a MIP (Section 8.2), and each policy box gives its current value. A *concept* is a definition. Whatever theOS should achieve is a hypothesis, and Part III states each one with its status. Everything else grows on top of the laws and can change: prices, cooperatives and the way each cooperative decides. The laws cannot change: nobody holds a key that changes them. Appendix F says what can change in the code, and who decides. The laws are short. Together they say where money comes from, where it can go, what it becomes there and who gains when it is spent.

RuleLaw 1 · Universal Intent Allocation (UIA)

Every human gets 24 HEARTS a day, without conditions, one for each hour lived, from birth to death. Each human has one stream. Each person's HEARTS are a currency of their own: Samuel's are samuelHEARTS, Anna's are annaHEARTS. Only their owner can invest them; for a child, a guardian does.

The name says what it is. *Universal*, because everyone gets it. *Intent*, because it shows what a person wants to see built. *Allocation*, because it is the right to allocate: to invest one's HEARTS into the cooperatives (COOPs) that one chooses. It is not a handout for survival. The UIA gives each person a voice in where the automated economy puts its effort.

Three cases need a clear rule. **Who gets HEARTS:** every human, with one stream each, however old and wherever born. One stream per human needs an identity that nobody can fake many times (Section 12.1). **Children:** a child gets HEARTS from birth. Until an age that the city sets, for example 16, a guardian directs the child's HEARTS. The MIND that they create belongs to the child. **Death:** the stream stops when a person dies. The MIND that the person leaves goes either to heirs whom the person names or to the City COOP. The City COOP is the city's own COOP, and every citizen holds one equal share in it (in maiaCITY, the MaiaCity COOP). It holds the land (Section 8.2), all LP tokens of the city's pools (Section 6) and the euro border (Section 8.3). Section 12.1 keeps the choice at death open. An Aven, the personal agent of Section 7, invests only as its human directs.

23of 24 todaysamuelHEARTS23of 24 todayannaHEARTS23of 24 todaymiaHEARTSone HEART for every hour lived · only its owner can invest it

*[Figure 1, drawn live on the page] **Figure 1.** Law 1 in motion. Three people live through the same day. Each hour drops one HEART into each person's dial, in a currency of their own. At midnight the 24 HEARTS of the day leave, and their owners invest them into COOPs.*

RuleLaw 2 · Pure investment

HEARTS earn no interest. They buy nothing and pay for nothing. They enter the economy only when their owner invests them into COOPs.

So a HEART is not money to spend, not even for food. It is a vote with weight, and every person casts 24 of them every day. The third law says what a HEART can vote for: a COOP. A COOP is an enterprise that the people who invest in it own together. Law 4 says how. Examples are an energy COOP that runs a power plant, or a food COOP that runs a farm.

RuleLaw 3 · Open cooperative creation

Anyone, alone or with others, can found a COOP at any time without permission. It can be for energy, food, compute, housing, art or any need that nobody meets yet. A COOP starts from HEARTS and at least 3 partner COOPs, whose MINDs form its first basket, a small pool of MINDs (Section 6).

buy goodsearn interestLaw 2: HEARTS cannotLaw 2: HEARTS cannotAnnaher annaHEARTSsolar COOPagri COOPhabitat COOPa new COOPLaw 3: founded by anyone,without permission

*[Figure 2, drawn live on the page] **Figure 2.** Laws 2 and 3 in motion. Anna sends out her HEARTS. A HEART that aims at goods or at interest stops at the wall. A HEART that aims at a COOP arrives. Then someone founds a new COOP without asking anyone, and HEARTS start to arrive there too.*

Law 3 works on two layers. On the *protocol layer*, a COOP is code: a MIND, a treasury (its working capital) and the rules by which it decides. Anyone can create one there, and nobody has to approve it. On the *legal layer*, a COOP that owns machines, leases land or signs contracts needs a legal form. In Germany that is often a registered cooperative, an *eG*. An eG needs at least three members, statutes and a membership in an audit federation. So "without permission" holds for the protocol, not for the law. One bridge is an umbrella eG whose divisions are COOPs. A COOP that grows large becomes its own eG (Section 8.3). COOPs that make the same good compete for buyers, and anyone can found a rival (Section 9.1).

The fourth law says what an investment creates. It is the moment when a person's intent becomes something that people can own and use.

RuleLaw 4 · Every COOP has its own MIND, created by investing HEARTS

Every COOP has its own MIND: solarMIND for a solar COOP, agriMIND for a farming COOP. A MIND is one currency of ownership and utility of its COOP. Its name points to the machine intelligence that runs the COOP. To hold it is to own part of the COOP, and to spend it is to use what the COOP makes. Only investment creates MIND. Each invested HEART converts into one new MIND of its COOP: 0.5 to the investor, 0.4 to the treasury, 0.1 to the city's pools. So half goes to the investor. All three parts are the same MIND; there is only one kind.

Follow one HEART. Anna invests one annaHEART into the solar COOP. The HEART converts and is gone for good. Nobody holds it after that, not even the COOP: a treasury holds only MINDs. In its place, one new solarMIND appears: 0.5 in Anna's wallet, 0.4 in the COOP's treasury and 0.1 in the city's pools. It is the same solarMIND in all three places, and it does every job.

In Anna's wallet, the solarMIND is her ownership: she is now a part-owner of the solar COOP. While she holds it, it pays her a share of every sale (Law 5). Its price rises only while demand grows faster than new investment makes new solarMIND (Section 6.3; Hypothesis H5, Section 10). When Anna switches on her lamp, she pays for the power in solarMIND. She can pay with any MIND that she holds; the pools convert it (Section 6), and the solar COOP always receives solarMIND. What she spends goes back to the COOP. What she keeps stays her ownership.

In the pools, the solarMIND lets anyone trade solarMIND for another MIND (Section 6). In the treasury, the solarMIND is the COOP's working capital. The COOP spends it through proposals that its MIND holders accept (the holder rule, Section 9). It *buys* panels: it pays in solarMIND, the pools convert it, and the panel COOP receives panelMIND. And it *pays for work*, but never for human labour. There are no jobs and no wages. All work is a *work proposal*, priced in the COOP's own MIND, as in a DAO (a decentralised autonomous organisation, which runs on proposals and votes). An Aven proposes a piece of work and its price for its person, the COOP accepts it, and its treasury pays on delivery. The Avens deliver all work with the COOP's machines. Some work proposals keep a COOP running: Mia's Aven runs the daily check of the panels, and the COOP pays it from its running costs. Others are new work, paid from the surplus: Mia's Aven proposes a plan for the panels' repairs, the MIND holders accept it, Mia's Aven and the COOP's robots do the work, and the COOP pays Mia in solarMIND. Mia herself does not labour for it. And Mia does not keep it long: her Aven pays for her food, her tram rides and a concert. So the MIND that leaves a treasury comes back to the COOPs through what they sell (Hypothesis H13, Section 10).

ConceptWork proposal

A piece of work that an Aven proposes to a COOP for its person, priced in the COOP's own MIND, as in a DAO. Running work keeps a COOP going and is paid from its running costs. New work is paid from the surplus, once its MIND holders accept it. The treasury pays on delivery. No human labour is paid.

The MIND that Anna paid for her light must not stay in the treasury, where it would only melt. It must flow back out to people and to other COOPs, while the COOP grows its own *plant*: the machines and buildings that make its goods. One rule says how.

RuleThe payout rule

A treasury keeps a reserve of running costs, plus what it plans to build, and pays out the rest for work proposals. It grows its own plant first, where it sells out or earns a margin. What it holds above the reserve goes out within weeks, for new work that its MIND holders accept.

*Policy, the length of the reserve:* the City COOP sets it by MIP. Its current value is 9 months.

The fifth law says who gains when a COOP sells.

RuleLaw 5 · Every sale pays its owners

20 % of every sale goes at once, in the COOP's own MIND, to everyone who holds it: people, other COOPs and the city's pools, in proportion to what each holds. The share is the same for every COOP. The COOP's own treasury gets none, because paying itself would only move its MIND in a circle. Only real deliveries count as sales.

This payment is the *dividend*. When Anna pays for her light, 20 % of her payment goes at once to everyone who holds solarMIND. Anna holds solarMIND too, so she gets a little of it back. The other 80 % goes to the treasury. It pays for inputs, services, building, ground rent and work proposals. Nobody has to vote on each dividend.

This is the heart of theOS: every sale pays its owners. Everyone owns MIND, and every lamp that anybody switches on pays Anna a little. What a person holds, and the dividends that it pays, are meant to let a person live without working (Hypothesis H3, part 2, Section 10).

Law 5 ties what owners gain to what the COOP does for others. A COOP pays its owners best when it sells a lot, and it sells a lot when many people find it useful. So each COOP works for good turnover: the total of its sales. Two guards keep this honest. First, as Law 5 says, only real deliveries count. Otherwise two COOPs could sell to each other in a circle, and every round would move MIND from their treasuries to their holders (Section 12.2). Second, a sale brings the treasury only what is left after the dividend. If that does not cover the full cost of the delivery, the treasury loses on every sale. So more turnover pays only while prices cover the full cost. Each COOP sets its own prices every day, with no cap, and its price rule keeps them above its variable cost (Section 9.1).

AnnaMiaher Aven proposed work0.15solarMINDsolarMIND holderspeople, COOPs, the pools0.01dividendsolar COOPAnna’s lamppaid in solarMIND0.30city’s poolssolarMIND in,panelMIND out0.41solarMINDAnna’s wallether ownership0.13solarMINDCOOP treasuryworking capital0.20panelMINDpanel COOPpaid in its own MIND

The treasury pays it out again. The panel COOP gets 0.20 through the city’s pools, as its own panelMIND, at equal prices. Mia gets 0.15 for her Aven’s work proposal.

*[Figure 3, drawn live on the page] **Figure 3.** Laws 4 and 5, step by step. One HEART converts into one solarMIND, and it goes 0.5 to the investor, 0.4 to the treasury, 0.1 to the city's pools: Anna's ownership, the treasury's working capital, and the city's pools that let people trade. Anna pays for her light in solarMIND, and most of it goes back to the treasury. The treasury pays it out again: the panel COOP through the pools in its own panelMIND, and Mia for her Aven's work proposal. A share of every sale goes at once to everyone who holds solarMIND; Anna gets some back as a holder. The areas of the coins are to scale. Tap a number to go to a step.*

So theOS has only two kinds of money. HEARTS are intent, and they exist only until their owner invests them. MINDs are what intent becomes, and they carry the whole economy after that. No human labour is paid. A person's MIND comes from three places: their own half of the HEARTS they invest, the work proposals their Aven delivers, and Law 5 dividends (Section 11.2.2). The laws say where both come from. They do not yet say what stops either from growing without limit. That is the job of the one rule that HEARTS and MINDs share: they melt.

## 5Melting money, in numbers

### 5.1 One demurrage rule for HEARTS and MINDs

Every balance of HEARTS and of MINDs melts at the same fixed rate of $r = 0.07$ a year. This is Gesell's demurrage from Section 2, built into the protocol, and it is the same for both kinds of money. So a conversion of a HEART into a MIND, or a trade from one MIND into another, cannot escape it. The protocol applies demurrage continuously: it updates a balance each time it reads or changes that balance. There is no fixed date for the fee, so nobody gains by moving money just before a deadline.

RuleThe melt

Every balance of HEARTS and of MINDs, everywhere, melts at the same fixed rate $r$, 7 % a year, continuously: in wallets, treasuries and pools. Melted money is gone.

The rule is:

$$
\begin{gathered} B_{\text{now}} = B_{\text{last}}\; e^{-r\,\Delta t} \\ \Delta t = \frac{\text{seconds elapsed}}{31\,536\,000} \end{gathered} \tag{1}
$$

Here $B$ is any balance of HEARTS or of a MIND: in a person's wallet, in a COOP's treasury or in a pool. The time since its last update, in years, is $\Delta t$. A day costs $1 - e^{-r/365} \approx 0.0192\,\%$ of a balance. An idle balance loses half of its value in a time called its half-life:

$$
t_{1/2} = \frac{\ln 2}{r} \approx 9.9\ \text{years}. \tag{2}
$$

On money that people use, the cost is too small to notice. But it is large enough that nobody keeps a fortune idle. Ownership that people hold for years pays more of it: Section 11.2.2 measures how much of people's income melts in their wallets. In Fisher's terms, the melt fixes the amount $M$ (Section 5.2), and it is meant to raise the velocity $V$ (Hypothesis H13, Section 10). The evidence from earlier demurrage money is mixed, and each of those currencies was tied to a national one (Appendix D). For HEARTS, it means that nobody can store intent to seize power later. For MINDs, it means that a MIND is worth holding only while its COOP's sales pay its holders more than the melt takes (Section 5.4). Wealth stops being something one *has* and becomes something one *does*.

- 3 % a year
- 7 % a year
- 10 % a year

0255075100010203040Years left idleLeft of 100half-life at 7 %: 9.9 y3062

*[Figure 4, drawn live on the page] **Figure 4.** What remains of 100 idle HEARTS or MINDs. At theOS's 7 % a year, half is gone after 9.9 years. A working balance that people spend and refill every few weeks loses almost nothing.*

### 5.2 Where all money settles

Monetary policy, the set of rules that controls how much money exists, is simple in theOS. With one demurrage rule for both kinds of money, it fits in four verbs. The protocol *issues* money only as HEARTS, $u = 24 \times 365 = 8{,}760$ a year per person. Money changes form only by *conversion*, one HEART into one MIND, which neither creates nor destroys money. It *circulates* as MIND: COOPs make, sell and buy their services in it. Last, it *leaves* the money stock. Money goes out of existence in two ways: it melts, and a failed COOP's MIND is retired from the pools. Everything else, paying for resources, services and work proposals, only moves MIND from one holder to another.

Count all the money there is, HEARTS and MINDs together: in wallets, in treasuries and in the pools. Count every token as one, whatever its price in the pools. Divide this count by the number of people, $N$. The result, $m$, is an average count of tokens per person. Leave out the small flow of MIND retired with failed COOPs (Section 11.2.2 measures it). With a constant population, $m$ then gains $u$ a year and melts at the rate $r$:

$$
\begin{gathered} \frac{dm}{dt} = u - r\,m, \qquad m^{*} = \frac{u}{r} \\ m(t) = m^{*} + \left(m_0 - m^{*}\right) e^{-rt} \end{gathered} \tag{3}
$$

At $r = 0.07$, the steady state is $m^{*} \approx 125{,}143$ per person. At this level, the new HEARTS of each year equal the money that melts in that year. However people invest, spend or trade, the total moves toward this level from either side, less the MIND retired with failed COOPs. A young city's money rises to it from below, and an inflated city's money falls to it from above. The gap halves every 9.9 years. This is the resting state of Godley and Lavoie's simplest model, with the melt in place of a tax [36].

The economic model of Section 11.2 checks this level.

But $m^{*}$ is a count of tokens, not anyone's wealth. It includes the treasuries and the pools, and it adds different MINDs one for one. A single holding follows the same rule with its own net inflow. A holding $W_i$ whose owner adds $a_i$ a year, net of what they spend, tends to $W_i^{*} = a_i / r$. A person who keeps their half of the MIND that their own investing creates, $\omega = u/2$ a year, and spends nothing, tends to $\omega/r = u/(2r) \approx 62{,}571$ MIND: half of $m^{*}$. The other half goes to the treasury and the pools (Law 4). Treasuries pay most of theirs out again for work proposals (the payout rule, Section 4). A person whose net inflow is twice as large tends to twice the holding. So every balance moves toward about 14.3 years of its own net inflow.

The steady state $m^{*} = u/r$ also needs a constant population. Then money per person that starts at or below $u/r$ stays at or below it, and money that starts above it falls toward it. If the population grows at the rate $\nu$ a year, newcomers share the money. The steady state then falls to $u/(r + \nu)$: 109,500 at 1 % growth and 97,333 at 2 %. If the population shrinks, it rises above $u/r$.

A young city also needs time. From nothing, money per person grows from 8,460 in year 1 to 62,999 in year 10 and 109,818 in year 30. It reaches 95 % of the steady state only after about 43 years. During this transition, prices in HEARTS can rise, unless output grows faster (Section 5.3). The HEART is the unit of account of Section 6.3, which values every MIND in HEARTS; HEARTS still buy nothing (Law 2).

There is no central bank, no interest rate to set and no inflation target. With a constant population, the money supply moves to $N u / r$ from any start, less what is retired with failed COOPs. The whole policy is the five laws and one rate. Appendix F says who may change the code that runs them.

The same rule levels balances that earn nothing. An idle balance melts toward zero, while everyone gets the same 24 HEARTS a day. So nobody starts with nothing for long. Nobody collects a tax, and nobody decides who gets what. The melt works like a flat levy on every holding, and the daily HEARTS give every person the same right to invest. The melt does not level holdings that earn more than it takes (Section 5.4; Hypothesis H4, Section 10).

- Starts with 1,000,000 per person
- Starts at the 7 % steady state, 125,143
- A new city, starts with 0

0250k500k750k1 M0102030405060YearsTokens per person, all holderssteady state u/r = 125,143138k125k123k

*[Figure 5, drawn live on the page] **Figure 5.** The average count of HEARTS and MINDs per person, in wallets, treasuries and pools, with a constant population. It is a count of tokens, not anyone's wealth. Three starts: none (a new city), the 7 % steady state, and a million per person. All three meet at $u/r$, and a new city reaches 95 % of it after about 43 years. Move the slider under the chart to change the rate. A lower rate raises the steady state and slows the approach to it. A higher rate does the opposite.*

### 5.3 Laborde's rule, arrived at from the other side

Section 3 introduced Stéphane Laborde's universal dividend: new money created equally for every member (not the dividend of Law 5). With (3), we can now compare the two systems closely. Laborde derives the rate of the dividend from one requirement: each generation must co-create the same share of money over a life of $e_v$ years:

$$
\begin{gathered} c = \frac{\ln(e_v/2)}{e_v/2} \\ e_v = 80 \;\Rightarrow\; c \approx 9.2\,\% \end{gathered} \tag{4}
$$

In Laborde's system, the money supply $M$ of $N$ members grows, and each member gets $c\,M/N$ a year. Measure a member's balance relative to the average, $b = B / (M/N)$. Because the average grows at the rate $c$, $\dot b = c\,(1 - b)$. This is Laborde's law: every member's relative position moves toward the average at the rate $c$.

**Proposition 1.** *With a constant population and at the steady state $m = m^{*}$, a member's balance, measured relative to the average, follows Laborde's law with $c = r$. Outside the steady state, the rate is $u/m(t)$, not $r$.* Take a member who keeps their half of the MIND that their own investing creates, so that $\dot B_i = u/2 - r\,B_i$. If every member does the same, the members hold half of all money, $m/2$ per person. Measure the member relative to that average, $b_i = B_i / (m/2)$. With (3), $\dot b_i = \frac{u}{m(t)}\,(1 - b_i)$. At the steady state, $u/m^{*} = r$, so $\dot b_i = r\,(1 - b_i)$: Laborde's law with $c = r$. ∎

So the two systems agree once the money has settled. In a young city, the rate $u/m(t)$ starts high and falls to $r$. From nothing, it is 103.5 % in year 1, 13.9 % in year 10 and 8.0 % in year 30. So a young city levels its members faster than it will at the steady state, where the rate is $r$. It is also faster than Laborde's system, but only while $u/m(t)$ stays above Laborde's $c$. Two differences remain. In Laborde's system every member gets all of the new money; in theOS a member gets half, and the other half goes to the COOP's treasury and the city's pools. And Laborde derives $c$ from a life span, while the model here has no births or deaths.

Laborde keeps the universal dividend relative and lets the amount of money grow. theOS keeps the issuance fixed and lets the money melt. What theOS gains is a unit that people can think in, 24 a day, one per hour. And once the money has settled, prices no longer drift upward with a growing money supply. They can fall as output grows. A young city is different. Its money per person grows about 13-fold from year 1 to year 30. If people spend a steady share of what they hold, Fisher's equation says that prices in HEARTS rise by about the same factor, unless output grows faster. Whether it does is Hypothesis H8 (Section 10).

theOS does not take its rate from (4). The pair of 24 a day and 7 % a year comes from Circles v2 (Section 3) [20]. Circles takes its 7 % as a yearly rate, applied day by day. theOS melts continuously, so 7 % a year takes 6.8 % of an idle balance in a year. Read through (4), 7 % matches a life of $e_v \approx 116$ years, so it is gentler than Laborde's 9.2 % for a life of 80 years. The rate of 7 % also has reasons of its own. It sets the half-life of any idle holding at 9.9 years. A balance left idle for ten years still keeps 50 % of its value. A fortune fades within a lifetime only while it earns less than the melt (Section 5.4). The rate sets the steady state at 14.3 years of issuance, a level that people can picture. And it sets the bar for fair ownership: ownership settles at a bounded spread only while what holdings earn stays below the melt (Sections 5.4 and 9.2). A lower rate allows more inequality, and a higher rate makes long saving much harder. Section 12.5 says which other rates we have run.

### 5.4 The melt against returns

Every holding melts at the rate $r$, 7 % a year. But a holding of MIND can also earn: its COOP pays dividends (Law 5), and its price can rise.

ConceptThe lasting return

The *lasting return* $\mu$ of a holding is the dividend yield of its COOPs, plus any lasting rise of their prices, as a share of the holding a year.

A holding that is not spent then shrinks at the net rate $r - \mu$. Its half-life is $\ln 2/(r - \mu)$, not $\ln 2/r$.

A holding that earns half the melt, $\mu = r/2$, halves in 19.8 years, not in 9.9. So a holding shrinks only while $\mu < r$. If $\mu \ge r$, it grows for as long as its return lasts, and the melt no longer levels it.

Law 5 sets the dividend part of $\mu$. Let $\lambda$ be Law 5's share of every sale, 20 %. A COOP's dividend yield is $\lambda$ times its yearly sales, divided by the MIND that others hold. So the yield alone stays below the melt while yearly sales stay below $r/\lambda$, which is 35 % of the MIND that others hold. Section 9.2 shows what $\mu$ does to the spread of ownership. Whether $\mu$ stays below the melt is Hypothesis H4 (Section 10).

Money now has a source, a form and a limit. Section 4 promised that any MIND can pay for anything, because the pools convert it. Section 6 shows how thousands of MINDs stay tradeable.

## 6Keeping every MIND tradeable

With thousands of COOPs, there are thousands of MINDs. People must be able to trade each of them at any moment; in other words, each MIND must be *liquid*. theOS uses automated market makers (AMMs) for this. An AMM is a pool of currencies that sets their exchange rates from the ratios of its reserves. So anyone can trade against a formula at any time, and nobody has to wait for a buyer or a seller [3]. Such pools give reliable public prices when traders can compare them with an outside market [5]. In theOS the pools are the market. So arbitrage keeps their prices consistent with each other, but not always right. MIND prices need not be equal either. Section 6.3 shows them all in one unit, the HEART.

The best-known AMMs pair two currencies, and outside investors supply them and can withdraw their money again. theOS does neither. Its pools hold baskets of many MINDs, and together they are the city's liquidity pool. We call them *the city's pools*. A pool issues *LP tokens* (liquidity-provider tokens) for what enters it: shares that say who owns the pool. The City COOP of Section 4 holds them all.

RuleThe pools and their LP tokens

Law 4 sends the pools' part of each new MIND, 0.1 of each HEART, into the city's pools, in the COOP's own MIND. It comes out of the half that does not go to the investor. What a COOP earns by selling is not levied. Each pool holds a basket of 4 to 8 different MINDs, and the COOP chooses which baskets its MIND joins. Each deposit makes LP tokens, and they go to the City COOP, not to the COOP that deposits. The MIND in the pools gets its Law 5 dividend, but it has no vote (the holder rule, Section 9).

The City COOP may redeem LP tokens only by a passed MIP, a vote of its members (Section 8.2). The MIP needs two thirds of all citizen shares. The redemption then waits 30 days, as long as a change to the code (Appendix F). What the City COOP redeems goes to its own treasury, never to a person and never as HEARTS. A redemption of LP tokens by a passed MIP moves MIND to the City COOP; it destroys none.

So MIND leaves a pool in four ways only: through trades, by melting, when its COOP fails and no successor carries its MIND on, so that the MIND is retired (Section 9.1), or by such a redemption. The pools also route every payment: a buyer pays in any MIND, and the seller always gets its own.

*Policy, the yearly cap on redemptions:* the City COOP sets it by MIP. Its current value is 10 % of a pool a year.

So a COOP starts life in two parts. First, people invest their HEARTS. A HEART converts at the moment of investment (Law 4), so no COOP and no pool ever holds one. Second, the COOP partners with at least 3 other COOPs, whose MINDs join its own MIND in its first basket. Each COOP spreads its pools' part equally over every basket it joins. So the partners' MIND flows into the new basket as people invest in them. Only then can people trade the new COOP's MIND.

For example, the solar COOP's solarMIND might sit in one basket with tramMIND, agriMIND and steelMIND. It might sit in another basket with waterMIND, computeMIND, habitatMIND and artsMIND. When Anna pays for a tram ride with solarMIND, her Aven sends it into a basket that holds both. The basket converts it, and the tram COOP gets only tramMIND, whatever its passengers hold. Figure 6 shows both jobs of the pools.

Solar COOP1 HEART → 1 new solarMINDthe pools' part: 0.1one-sideddepositsa basket of 5 MINDssolarwatercomputehabitatartsa basket of 4 MINDssolartramagristeelCity COOPholds the LP tokensof every poolLP tokensAnna's walletpays for a tram ridein solarMINDsolarMIND in, tramMIND outTram COOPgets only tramMIND

*[Figure 6, drawn live on the page] **Figure 6.** The city's pools. Law 4 sends the pools' part of each new MIND, 0.1 of each HEART, into baskets of 4 to 8 MINDs; here two baskets hold solarMIND. Each deposit makes LP tokens for the City COOP. When Anna pays for a tram ride with solarMIND, the pools convert it, and the tram COOP gets tramMIND.*

### 6.1 The design: one equal-weight basket

theOS uses only one pool design: the *geometric mean market maker*. We chose it because it is the most widely used design for pools of 4 to 8 volatile currencies. Balancer's weighted pools have used it since 2020 [56,25], and they now hold up to eight tokens, the same range as a theOS basket [12]. Its incidents include pools drained through tokens whose balances changed outside trades [78], and a costly rounding bug [13]. Melting MINDs are such tokens, so theOS pools apply the melt through one global index and never change a reserve directly (Section 12.3).

Every pool holds $n$ = 4 to 8 MINDs in equal shares, $w_i = 1/n$. With $x_i$ of MIND $i$ in the pool, it keeps

$$
\begin{gathered} \prod_{i=1}^{n} x_i^{\,1/n} = K \\ p_{ij} = \frac{x_i}{x_j}, \qquad \text{fee } \varphi = 0.3\,\% \end{gathered} \tag{5}
$$

Every trade keeps the geometric mean of the reserves constant. Only fees and inflows raise it. The melt, a retired MIND and a redemption by vote lower it. The price of MIND $j$ in MIND $i$ is simply the ratio of their reserves. At fair prices, each MIND is an equal share of the pool's value. So a basket behaves like an index that rebalances itself. Four more choices complete the design:

- **A fixed fee of 0.3 %** on every trade, the usual level for volatile currencies, whose prices move a lot. Arbitrage is trading to profit from a price difference between two markets. A fee widens the band of prices in which arbitrage does not pay [60]. There are no outside liquidity providers, so no investor collects the fee. It stays in the pool and makes the pool larger, and so it adds to what the City COOP's LP tokens stand for.
- **One-sided deposits.** Each COOP deposits only its own MIND, and its LP tokens go to the City COOP (the box above). So the city's liquidity belongs to all its citizens.
- **Inflows in small slices.** A large inflow moves a price at once, and arbitrageurs take the gap. So the protocol adds inflows a little at a time, in every new block of transactions, as in the time-weighted AMM [81].
- **Routing by Avens.** Avens, the personal AI agents of Section 7, route each trade. A trade between two MINDs goes through the pools that hold them. The best way to divide a trade across many pools is a convex problem: computers solve it fast, to any accuracy that we choose [6,7]. Each extra hop also costs a fee, and that fixed cost makes the full problem harder. Section 12.3 proposes a hub MIND that keeps routes short.

One property fits theOS especially well. Every MIND in a basket melts at the same 7 % a year. So demurrage shrinks every reserve by the same factor, and every price in (5) stays the same. Melting creates no trading opportunity inside a basket.

### 6.2 The cost of liquidity, and who carries it

A pool is not free. When prices move in other markets, arbitrageurs trade against the pool until its prices match. The pool then loses what a perfect rebalancer would not lose. The name for this cost is *loss-versus-rebalancing* (LVR). For a geometric mean pool, it is a steady share of the pool's value each year [59].

Take the volatilities $\sigma_i$ of the MINDs: how strongly each price moves. Take also the covariance $\Sigma$ of their price moves: how the prices move together. Then the yearly cost $\ell$, as a share of the pool's value $V$, is

$$
\begin{gathered} \frac{\ell}{V} = \tfrac12\Big(\sum_i w_i \sigma_i^2 - w^{\top}\Sigma\,w\Big) \\ \overset{w_i = 1/n}{=}\; \tfrac12\,\sigma^2 (1-\rho)\Big(1 - \frac1n\Big) \end{gathered} \tag{6}
$$

The right-hand side holds for equal weights, one common volatility $\sigma$ and one common correlation $\rho$: how closely prices move together. Equation (6) assumes random-walk prices and arbitrage without fees [59]. The cost grows with how much MINDs move against one another, and the 0.3 % fee wins part of it back [60]. Equation (6) also needs an outside price that the pools follow. In theOS the pools are the market, and values move between baskets and when a COOP's output changes. So (6) is an upper estimate. The economic model does not measure it yet (Section 12.3).

In theOS, the city's pools carry this cost, not any one wallet. The MIND in Anna's wallet is never part of a pool. But the cost is real, and people pay it together, through the pools' part of every new MIND (Law 4). What the pools lose goes to whoever trades against them first. In the economic model, that is a protocol bot, and what it holds melts. In the main run, it still held 11 % of all MIND by value (Section 11.2.2). Trading must not become a fourth income, beside the three of Section 4. So we propose that the protocol clears trades in batches, at one price for each batch. This could also cut the cost [18]. But the analysis so far covers only two-currency pools, so theOS treats it as an upgrade that no simulation has tested yet (Section 12.3). A speculative attack can make a pool smaller, but every COOP's working capital and its turbines keep going.

- σ 20 %, independent
- σ 40 %, independent
- σ 40 %, correlated 0.6

0 %2 %4 %6 %8 %2345678MINDs in the basketLVR a year, share of the poolminimum basket7.0 %2.8 %1.8 %

*[Figure 7, drawn live on the page] **Figure 7.** The cost (6) of keeping a basket liquid, before the fee wins part of it back. It assumes prices that move as a random walk, at volatilities like those of large company shares. In a basket of 4, calm MINDs (20 % volatility) cost 1.5 % of the pool a year. Wild MINDs (40 %) cost 6 %. When MINDs move together (correlation 0.6), the cost falls to 2.4 %. Going from 4 to 8 MINDs adds only about 17 %.*

### 6.3 HEARTS: the universal display and unit of account

A price needs a unit. One solarMIND buys some kWh, and one agriMIND buys some food. But one of what? Every COOP prices in its own MIND, so theOS needs one unit in which to show and compare all values. That unit is the HEART. A *unit of account* is the unit in which people write prices and keep their books. In German it is the *Rechnungseinheit*, and economists call it a *numéraire*. It need not be what people pay with.

Why the HEART? Because every MIND starts as one. Each invested HEART makes exactly one MIND (Law 4). HEARTS and MINDs melt at the same 7 % a year. So the MINDs that exist are the HEARTS that people invested, less the same melt and less the MIND of COOPs that ended. The pools set only relative prices: how many of one MIND trade for one of another. Nothing in them says what the average MIND is worth. theOS fixes that one free number.

ConceptThe unit of account

Every value is shown in HEARTS. The average MIND, weighted by how much of each exists, is worth exactly 1 HEART. The HEART is for display only: every payment is in MIND.

Let $s_k$ be the supply of MIND $k$: all of it that exists, in wallets, treasuries and pools. Let $p_k$ be its pool price against one MIND, the same one for every $k$. Then the value of MIND $k$ in HEARTS is

$$
\begin{gathered} v_k = \frac{p_k}{\bar p}, \qquad \bar p = \frac{\sum_j s_j\, p_j}{\sum_j s_j} \\ \Rightarrow\; \sum_k s_k\, v_k = \sum_k s_k \end{gathered} \tag{7}
$$

In words: all MIND together is worth as many HEARTS as there are MINDs. The MIND that the prices are measured against drops out, because it scales every $p_k$ and $\bar p$ alike. So the HEART needs no anchor MIND: no cityMIND, no chosen basket and no reference COOP that might fail. We propose that the protocol publishes every $v_k$ from time-averaged pool prices.

The HEART is for display only. Each Aven shows every balance and every price first in HEARTS, with the amount of MIND in small type. The rule never changes a trade, a price or a payment. Every payment is in MIND. Three things the HEART is not:

- **Not a peg.** Nobody trades a MIND for a HEART at 1, and nobody can. A MIND whose COOP delivers more rises above 1 HEART, and one whose COOP delivers less falls below it. Only the average is fixed. Anyone can turn 1 HEART into 1 new MIND of any COOP. So a MIND worth more than 1 HEART draws new HEARTS, and the new MIND shares its rise with its new holders (Section 8.1).
- **Not a price.** Nobody pays in HEARTS (Law 2).
- **Not a promise of what a HEART buys.** What 1 HEART buys in goods moves with what the COOPs deliver. In this, the HEART is like the IMF's Special Drawing Right (SDR). The SDR is a unit of account whose value comes from a basket of five currencies, and it is neither a currency nor a claim [43]. Keynes's bancor was to be such a unit too, for clearing between central banks, not money that people hold [47]. The HEART's basket is every MIND, weighted by supply, and it changes as COOPs start and end.

Three cases need care. **A failing COOP.** As its MIND falls, the fixed average lifts every other MIND a little in HEARTS. When the COOP fails and no successor carries its MIND on (Section 9.1), its MIND leaves the pools and is retired. It then leaves both sides of (7), and its holders lose what it was worth. So a value in HEARTS is a share of all MIND, not an amount of goods. **A new MIND.** Until its first basket trades, the pools cannot price it. It counts at 1 HEART, the HEART that made it. **The investor's half.** A HEART makes one MIND, but the investor gets only half of it. So a person's 24 HEARTS a day give them 12 MIND of their own, worth about 12 HEARTS, not 24 (Section 11.2.2 measures it). The other half works in the COOP's treasury and in the city's pools, and people own the COOPs.

So the HEART is the right unit for the rest of this paper. Each new MIND is worth about 1 HEART, so a person's new ownership has the same value in HEARTS every year. In any unit tied to chosen MINDs, that value drifts.

A second yardstick is closer to life: a *day of living*. It is what an average person consumes in a day, priced in HEARTS that year. One person's basics for a day, the *basic bundle*, are 2,000 kcal of food, 100 L of water, 3 kWh of energy and 20 m² of home. Section 11.2.2 shows how both moved in the simulation.

MIND values do not settle at 1 HEART. Equal values would mean that every COOP delivers the same for its MIND, and in a changing world they do not. A MIND is worth what its COOP delivers for it, plus what it pays its holders, shared with everyone who invests later (Section 8.1). A COOP that loses its market is worth less, and its MIND can end at zero. Section 11.2.2 shows how far values spread in the simulation.

An earlier version measured values in R, a basket of three MINDs; Appendix G says why we retired it.

Through the pools, anyone can now trade a MIND that sits in a basket for any other MIND that the baskets connect to. But no person can follow thousands of currencies and their prices. The next layer does that work for them.

## 7Avens: an agent for every person

Herbert Simon showed that people decide with limited time and knowledge, so they settle for a choice that is good enough [74]. He called this limit bounded rationality. George Miller found that people can hold only about seven items in mind at once [61]. These limits are not flaws that education can remove. They are the design constraint. So theOS gives every person an Aven: a personal AI agent that works only for its human. People decide on values and goals, and Avens do the arithmetic and the work. Avens do all the work, so no human labour is paid (Section 4). Each person makes two choices:

1. **Where today's HEARTS go:** for example, 12 to a fusion COOP and 12 to an art COOP. This choice decides which infrastructure people build or maintain next. A person sets the aim, and their choice always overrides the default. Without a choice, the Aven follows the city's default rule (the box below).
2. **What one wants to own:** for example, a spread over many COOPs, with enough MIND of COOPs that sell a lot. The Aven pays for whatever its person uses from what it holds, and the pools convert it.

PolicyThe Avens' default investment rule

Where a person has not chosen, their Aven invests by the city's default rule. Every Aven shows the rule to its person. Its current value, which the economic model uses: 75 % of a person's HEARTS go into the 6 MINDs with the highest price × (1 + 3 × dividend yield), and the rest by the person's own values. A new COOP gets other people's HEARTS only after its pool has traded for a year.

*Rule:* only a passed MIP of the City COOP changes the default. A person's own choice always overrides it.

The Aven does the rest.

- **Keeping money at work.** Every MIND melts alike (Section 5.1), so the Aven keeps idle balances small. It invests HEARTS as they arrive. It keeps as MIND what its human wants to own, and pays for daily life from a small float.
- **Doing the work.** The Aven makes work proposals to COOPs and delivers them with the COOPs' machines: work that keeps a COOP running, and new work (Section 4). The COOP pays the Aven's human in its own MIND. Work proposals are open to every Aven, and they include care work and public work for the City COOP. Avens differ in what they deliver, so what their humans receive differs too (Section 9.2). This is how most MIND flows from the treasuries back to people, and how COOPs grow what they can make.
- **Living from what one owns.** Under Law 5, a share of every sale goes at once to everyone who holds the seller's MIND. These dividends are meant to let a person live from what they own (Hypothesis H3, part 2, Section 10). The Aven collects them and keeps them as ownership, or trades them through the pools into the MINDs that its human wants to own. Spreading its human's MIND over many COOPs also keeps the risk small (Section 9.2).
- **Choosing a seller.** For each purchase, the Aven buys from the rival COOP with the lowest price, and it can switch every day (Section 9.1).
- **Choosing what to hold.** We propose that the Aven keeps enough MIND of COOPs that sell a lot to cover its human's basics, and spreads the rest over many COOPs. It pays first with the MIND that earns its human the least. This is the mechanism of Hypothesis H11 (Section 10); the Avens of the economic model do not do this yet.
- **Paying without thinking.** When Anna takes a tram, her Aven finds the cheapest route through the pools of Section 6. The route goes from the MINDs she holds to the MIND that the tram COOP accepts. The Aven pays in the same moment. The economic model measures what the pool fees on such payments cost people (Section 11.2.2).
- **Leaving a bad COOP.** If a COOP becomes corrupt or wasteful, it delivers less for its MIND. Then its MIND falls in price against the other MINDs in the pools. The Aven sees the fall and moves its human's investment and spending to a better COOP. Albert Hirschman named the two ways that members discipline an organisation: *exit*, leaving for a better one, and *voice*, speaking up from inside [41]. Avens make exit easy and continuous.

Prices here do what Hayek asked of them: they carry knowledge that no planner holds [39]. The many competing MINDs also recall his proposal for competing private currencies [40], with two differences. Hayek expected competition to select the most stable money, and every MIND melts on purpose. And every MIND comes from HEARTS issued equally to every person, not from whoever is able to issue money. With people, COOPs, pools and Avens in place, we can now ask what the system changes in the long term.

## 8Building for the long term: land, the euro and energy

In capitalism, long-lived infrastructure is hard to finance, because every project competes with a safe alternative. That alternative is a government bond: a loan to the state that pays a fixed return for doing nothing. A tidal barrier that serves for generations must beat that return and also a risk premium, the extra return that investors want for a risk. Gesell and Keynes both saw this floor that a positive return on money puts under every investment [33,46].

In theOS, there is no safe alternative inside the city. HEARTS cannot be lent or parked; they can only be invested (Law 2). Outside the city, euros remain a safe alternative for anyone who earns them (Section 8.3). Inside it, a project does not have to beat a bond. But it competes for HEARTS with every other MIND, and an Aven that follows the city's default rule puts HEARTS where price and dividends are highest (Section 7). Idle HEARTS earn nothing and melt. MIND earns only what its COOP sells or gains in price. A MIND pays its holder only through its COOP's success: a share of its sales, or a higher price. The higher price is hard to keep, because a MIND above 1 HEART draws new HEARTS, and the new MIND shares the rise (Section 6.3).

What lasts is what the investment built: grids, water systems, domes, rail. So the only way to make intent last is to build what people keep using. Who gains from what lasts?

### 8.1 Who gains from long-lived projects

Law 4 decides who gains. Every HEART invested makes a new MIND, which shares any rise with its new holder (Section 6.3). So we expect a city-scale project's rising value to go to its users and to the new investors who fund each stage. Long-term holders gain through Law 5 on growing sales, not through a rising price (Hypothesis H5, Section 10).

What the city keeps using is the users' gain. Every resident who uses the grid, the water and the homes pays the price of the day for them. So the users gain what the project goes on giving, and the new investors who fund each stage share its rise. Section 11.2.4 gives what the economic model found.

How does a long project get its capital? A HEART converts on the day it is invested, so nobody can save HEARTS for a project. Residents can pledge future HEARTS to a project as a standing order, and each HEART converts on its day. Machines from outside the city cost euros. The City COOP gives the project a euro loan, and the project repays it in its own MIND, without interest (Section 8.3). Ground rent counts as a sale, so Law 5 pays a share of it to cityMIND's holders (Section 8.2). Two questions stay open: how the City COOP sets the ground rent, and whether Avens fund long projects as readily as short ones (Sections 12.2 and 12.4).

### 8.2 Land that nobody can sell

Section 2 ended on Keynes's warning: when money melts, wealth flees into stores of value that do not melt. Land is one of them, and Gesell's *Freiland* meant to close it. If land could be bought, the success of every COOP would end up as a higher land price, and the owners of land would collect it without building anything. Henry George showed that this rent is value that the whole community creates [31]. theOS closes this door with one rule.

RuleThe land rule

All land belongs to the City COOP. Every citizen holds one equal share in it. Nobody can sell or buy land or a share. Only COOPs build: a person who wants to build does so through a COOP. The COOP leases a plot and pays a yearly ground rent in MIND. The rent can be paid in any MIND; the pools convert it, and the City COOP receives its own cityMIND.

A lease works like the German *Erbbaurecht*, a heritable building right. It runs for a long, fixed term, and what the COOP builds belongs to it for that term. When the term ends, the plot returns to the City COOP, and the lease can start again. The ground rent follows the value of the location. A plot near the tram and the market costs more than a plot at the edge, because the city around it makes it worth more.

PolicyGround rent

The City COOP sets each plot's rent anew at fixed intervals. It uses an auction, or the value that the lessee publishes, so that no lessee keeps the value of the land. It chooses between the two by MIP. The level of the rent is not set yet.

RuleGround rent is a sale

A lease delivers the use of a plot, so its ground rent is a sale. Law 5 pays 20 % of every ground rent at once to everyone who holds cityMIND. The City COOP's own treasury gets none of it (Section 4).

So the value that the city creates returns to the city: to the City COOP, and through Law 5 to everyone who holds cityMIND. We expect this to raise what cityMIND pays its holders, and so to help people who live only from what they own (Hypothesis H15, Section 10). Nothing shared sits outside the City COOP. What all citizens share, such as streets, parks and water, the City COOP holds and runs. The ground rent pays for it. Every citizen's share is equal, comes with citizenship and ends with it. It is a membership, not money and not a MIND, so it does not bend Law 4, and nobody can collect land the way that people collect money. So land can no longer store private wealth. Other stores remain, such as buildings and euros (Section 12.4).

The City COOP decides by one vote per citizen share. A proposal that its members pass is a *MIP*, a MaiaCity improvement proposal. Only a passed MIP can redeem LP tokens (Section 6), and the same vote decides on changes to the code (Appendix F).

Land is one door out of the melt. The euro is the other.

### 8.3 The euro border

Panels, chips, medicine and insurance cost euros, and taxes are due in euros, even on services paid in MIND. No supplier outside the city accepts solarMIND. The alternative currencies that lasted kept a bridge to national money; the Chiemgauer charges a fee to change back into euros [30]. theOS keeps one bridge, and the City COOP holds it.

RuleThe euro border

The City COOP is the city's euro bank, and every euro crosses the border through it; in maiaCITY that is the MaiaCity COOP. It gives COOPs euro loans for machines, imports and taxes, and each COOP repays its loan in its own MIND, without interest. The City COOP makes no MIND from euros. No person sells MIND for euros: only the euro bank crosses the border. The euros that the founders bring are the City COOP's starting balance from outside the city.

*Policy, the loan terms:* the City COOP sets them by MIP. No value is set yet.

Outside the city, anyone may still take a job for euros. Inside it, there are only work proposals. COOPs that sell power, heat, food or services outside the city earn euros, and these euros go through the City COOP too. We expect these exports to repay the euros that the city needs (Hypothesis H9, Section 10). One legal form carries all of this: an *umbrella eG*, a registered cooperative whose divisions are the COOPs. Investing a HEART makes the investor a member with one vote. Each COOP keeps a euro balance sheet as a division, publishes a euro reference price and keeps a tax reserve. A COOP that grows large becomes its own eG. Section 12.4 lists what stays open at the border.

Land and the euro are the city's two doors. Energy is its physical limit, and it reaches every recipe.

### 8.4 Energy, the master resource

Money only counts what the city makes. Physics sets what it can make, and energy above all. A *recipe* is the inputs and energy that make one unit of a good. Every recipe costs energy: food and pumped water, timber, building, transport, and every Aven's thinking. Glass takes about 1.3 MWh a tonne, and steel about 3.6. Soddy saw this a century ago (Section 2). Ayres and Warr showed that useful work, together with capital and labour, explains long-run growth [11]. Lindenberger and Kümmel found that energy adds far more to output than its share of cost [54].

What counts is *net energy*: what the harvesters give, minus the energy to build and run them. What they give, divided by what they cost, is the *energy return on investment*, or EROI. A dome's solar cells pay back the energy that made them in about 1.1 years [28]. Murphy and Hall showed that growth gets harder as EROI falls [62].

So growth runs on energy. People's Avens buy basics first, so basics get the energy first. Building and research use the energy that is left. Recipes improve by making more: by Wright's law, each doubling of all the output so far cuts the cost of a unit by a fixed share [82]. They also improve by searching. Both stop at physical floors. One single-junction solar cell turns at most about 33 % of sunlight into power [73]. Plants turn at most 4.6 % (C3 plants) to 6 % (C4 plants) of sunlight into food [83]. A tonne of steel from ore needs about 2.9 MWh, the practical minimum. theOS aims for abundance that only physics limits: no growth cap, no price cap, and never a lack of MIND (Hypothesis H7, Section 10). Appendix H lists every limit.

Take 250 people in one great dome, with solar cells and no geothermal plant. A limit *binds* when it is the input that runs out first, so it sets how much the city can make. The cells give 1.3 GWh a year, and homes use 0.39. The surplus could build the glass, steel and timber of one more dome in about 3.3 years: about 76 beds a year. But for homes, wood binds first: the city's 10 ha give wood for about 25 beds a year. For every other build, and for research, net energy binds first.

In December the cells give 27 MWh against at least 33, a gap of at least 6 MWh. So in winter even the basics need stored energy or geothermal heat. In winter, Anna's lamp outbids the solar COOP's research. When Mia's Aven proposes a better cell, the research can run only on the summer's surplus energy. Table 2 shows the limits in order.

***Table 2.** What binds first in a small city of 250 people in one dome with solar cells. These are design numbers for the first village, not simulation results. Some are estimates; Appendix H gives their limits.*

| Limit | In numbers | When it binds |
| --- | --- | --- |
| Net energy | 1.3 GWh a year from the cells, 0.39 used at home; in December 27 MWh against at least 33 | First: for research, for every build except homes, and in winter, when even basics need storage or geothermal heat |
| Land, as wood | 150 t of wood a year from 10 ha: about 25 beds a year, against about 76 from the energy surplus | First for homes |
| The food forest's age | 10 % of the food in year 1, all of it in year 10 | First for the basics in years 1 to 9, unless the city starts with food |
| Land, as food area | Fixed, all with the City COOP | Only when the population grows on fixed land |
| Water | 140 L of rain a bed a day, against 100 L of fresh water | Last: only in a year 30 % drier than normal |

With a geothermal plant, a full village of 1,488 people can harvest 2.7 kW of electricity and up to 8.0 kW of heat for each person. They use about 0.9 kW of electricity each. Smil found that quality of life stops rising at about 1.6 to 2.2 kW of primary energy a person [75]. The comparison is rough. We expect that energy will not limit a full village's basics, only how fast the village builds and learns (Hypothesis H8, Section 10).

Some of these design numbers are estimates. Money cannot make a city richer; only energy, land and recipes can (Hypothesis H7, Section 10). No simulation tests energy yet: the economic model has no energy limit (Section 11.2).

Land, the euro and energy set the city's limits. The last part of the machine is how COOPs decide, and how they compete.

## 9Governance and competition

theOS sets no constitution for COOPs. Each COOP chooses its own way of deciding and can change it. COOPs that serve the same need compete on one open field. Two rules hold for all of them. The first says who may vote:

RuleThe holder rule

A COOP's own MIND in its own treasury carries no vote and gets no dividend. MIND in the city's pools gets its Law 5 dividend but carries no vote. Only MIND that people and other COOPs' treasuries hold can vote in a COOP.

Without this rule, a treasury that receives 0.4 of every new MIND would soon hold a large block of votes, and its managers would steer the COOP. German company law takes all rights away from a company's own shares for the same reason (§ 71b AktG). The pools hold MIND of every COOP, so a vote for them would give their holder, the City COOP, a say in every COOP.

The second rule keeps every COOP open to new owners:

RuleOpen investment

No COOP whose MIND trades in a basket may refuse an investment. Anyone can turn 1 HEART into 1 new MIND of it at any time (Law 4).

So no COOP can close itself to keep the rise of its MIND for the people who hold it now. A MIND worth more than 1 HEART draws new HEARTS, and the new MIND shares its rise (Section 6.3).

Elinor Ostrom showed that the people who share a resource, such as a pasture or a fishery, can govern it well when the rules fit their place [64]. Her principles concern shared resources that people govern outside markets, so they do not carry over one to one. But they suggest which rules to try first, and in theOS the competition between COOPs tests them. Three designs might share a sector. COOP A is capital-weighted: one MIND, one vote, so large holders steer. COOP B is a strict direct democracy: one person, one vote on every operational choice. COOP C mixes three tools. It uses quadratic voting on strategy: two votes on one question cost four credits, and three votes cost nine. So people can show how strongly they care, but the largest holder cannot decide everything [52]. An AI executive runs daily operations. And prediction markets answer questions of fact: people bet on outcomes, so the prices show what is likely [38].

These designs live on the protocol layer of Law 3. On the legal layer, a German eG gives each member one vote, or at most three, so COOP A's rule fits only inside the protocol. Avens aim to send each HEART where it creates the most utility. Under the city's default rule, they read utility from a MIND's price and dividends (Section 7). Let $s_i$ be a COOP's share of its sector's investment, and $f_i$ the utility that it delivers per HEART. Then the shares follow the equation of natural selection, known as replicator dynamics. Whatever does better than average grows, and whatever does worse shrinks, at a speed $\kappa$:

$$
\begin{gathered} \dot s_i = \kappa\, s_i \left(f_i - \bar f\right) \\ \bar f = \textstyle\sum_j s_j f_j \end{gathered} \tag{8}
$$

In 1950, Alchian proposed this mechanism to explain why markets select efficient firms, even when no firm optimises [4]. Demurrage makes it stronger: a COOP that stops attracting investment watches its treasury melt. Below the level that its service needs, the COOP closes. Its physical assets go to the City COOP, which leases them to a COOP that runs them better, as long as people still use them (the idle-plant rule, Section 9.1). Ideas about markets that are designed on purpose, not inherited [67], become experiments here. One limit is built into (8): a COOP with no share stays at zero. So a new COOP needs its first HEARTS from its founders and friends, and Section 12.2 asks how to keep that door open without self-dealing. Law 3 is the way in: anyone can found a rival, and Section 9.1 shows when founders step in. Equation (8) also explains why leaders drift toward a monopoly: a COOP that stays above the average keeps growing until it holds the whole sector. And selection by current returns starves projects whose use comes late (Section 8.1). Whether selection improves governance is Hypothesis H14 (Section 10).

- COOP A · 1 MIND, 1 vote
- COOP B · 1 person, 1 vote
- COOP C · QV + AI executive

0 %25 %50 %75 %100 %0246810YearsShare of investment100 %0 %0 %

*[Figure 8, drawn live on the page] **Figure 8.** An example of (8), not a forecast. A starts as the most efficient, but it slowly becomes extractive: it gives back less for each HEART. B is steady but slow, and C starts behind and learns. Avens route the investment every month, so it follows the utility delivered. A leads until year 1.75, and after five years C has 83 % of the sector. The result follows from the paths of efficiency that we assign, and A's slide does most of the work. If C never learned, it would still lead from year 5. No simulation tests such paths yet (H14). If they hold, governance becomes a technology that can improve by selection.*

### 9.1 Rivals and free prices

Every household good except water should have two COOPs from the first day. Water stays with the City COOP alone. Avens choose the seller for each purchase by price, and they can switch every day. Water has no second seller, so the City COOP keeps a reserve for it:

PolicyThe water reserve

The City COOP keeps a water part inside the reserve of its treasury (the payout rule, Section 4). So the water keeps running when the City COOP's sales fall. It sets the size of the part by MIP. No value is set yet.

Each COOP sets the price of what it makes, every day, in its own MIND. The price rises while the COOP is sold out. It falls while its machines stand idle or its stock grows. There is no cap, no price control and no protected price, not even for basics, and nobody imposes a floor. But each COOP's own price rule should keep its price above its variable cost. Its *variable cost* is what the inputs for one more unit cost. Law 5 takes 20 % of each sale, so the rule keeps the price above the variable cost divided by 0.8. Below that, every sale drains the COOP's treasury. The rule goes lower only to clear stock that would rot. This floor leaves out food that rots and the rent on plant that stands idle. So a seller can still lose on every sale (Section 12.2), and Section 11.4 tests a fuller floor.

A COOP's price rule should step up and down by the same size. In an earlier version of the simulation, prices rose faster than they fell. Whenever demand hovered near capacity, prices ratcheted up: they climbed step by step and stayed up. Equal steps fixed it.

High margins invite rivals. A product's *full cost* also counts the wear of its plant and its ground rent. Law 3 entry is always open, and founders step in while the margin over full cost stays high. A small COOP that lost its market exits. A COOP whose treasury stays dry while it keeps losing fails, and its plant goes to the City COOP.

PolicyThe idle-plant rule

The City COOP leases a failed COOP's plant to a successor while people still use it: while demand is at least a set share of the plant's capacity. Otherwise it scraps the plant and takes the land back. The City COOP sets the share by MIP. Its current value, which the economic model uses, is 25 %.

RuleThe successor rule

A successor that leases a failed COOP's plant carries on the failed COOP's MIND. No new MIND is made for the plant. The successor sells in that MIND, so its holders keep their share of the plant's sales (Law 5). Only when no successor takes the plant is the failed COOP's MIND retired from the pools.

A real city would not keep leasing a plant whose rent is many times its sales. When food stays dear for months, Mia's Aven can propose a new food COOP. Anna's Aven then moves her food buying to it as its plant grows.

Four things push back. Anyone can found a rival at any time (Law 3). Avens walk away from a dear seller. Law 5 pays 20 % of the leader's every sale to all who hold its MIND. And the City COOP leases a failed plant that people still use to a second seller. We expect these to keep basics near their full cost (Hypothesis H6, Section 10).

The design must still do more, and we propose three rules. First, signal a founding when need goes unmet, or when a rival's audited cost is far below the price, not only on the leader's margin. The protocol flags it to every Aven, and the City COOP offers a plot. Law 3 entry itself is always open. Second, make what a work proposal improves open to rivals after a delay, so that they can imitate, as in the model of Dosi and others [22]. Third, keep at least two sellers of every basic except water, which the City COOP runs with a reserve (the water reserve, above).

### 9.2 Fair ownership in theory

Section 1 asked who gets what the machines make. Here is the theory. Section 10 states what we expect from it, and Section 11.2.5 tests it. Let $W_i$ be the MIND that person $i$ owns, valued in HEARTS (Section 6.3). Let $a_i$ be what the person keeps each year: the ownership their investing creates, plus what their Aven's work proposals bring in, minus what they spend. As in Section 5.2, the melt takes $r\,W_i$, so a holding moves toward $W_i^{*} = a_i/r$. A person who keeps the ownership their investing creates, and pays for daily life from what their Aven's work proposals bring in and from their dividends, keeps $a_i = \omega = u/2$. If everyone keeps the same amount each year, every holding moves toward the same resting level $W^{*} = \omega/r \approx 62{,}571$ MIND. Start with holdings as unequal as Germany's today, with a Gini index $G_0$ and a mean $\bar W_0$. (The Gini index of Section 1 is 0 if everyone has the same, and 1 if one person has everything.) Then the Gini index after $t$ years is

$$
\begin{gathered} G(t) = \frac{G_0\, e^{-rt}\, \bar W_0}{e^{-rt}\, \bar W_0 + W^{*}\left(1 - e^{-rt}\right)} \\ \bar W_0 = W^{*} \;\Rightarrow\; G(t) = G_0\, e^{-rt} \end{gathered} \tag{9}
$$

So, if everyone keeps the same, inequality halves every 9.9 years, the same half-life as an idle balance. From Germany's 0.72, the Gini index falls to 0.36 after 10 years and to 0.09 after 30. Large fortunes level more slowly. A fortune 100 times the resting level needs about 66 years to fall to twice that level: one lifetime. A child who gets HEARTS from birth owns 72 % of the resting level at 18. That is a start in life for everyone, without a separate fund.

But people do not all keep the same. What their Avens' work proposals bring in differs, and so does their spending. Each holding then settles at its own level, $a_i/r$, and inequality settles at the spread of what people keep, not at zero. This spread comes from how much each Aven delivers, and Section 11.2.5 measures it.

Returns differ too, because people choose different COOPs. Let $\sigma_W$ be the spread of returns between people's holdings, and $\mu$ the lasting return of Section 5.4. Then each holding follows $dW_i = \big(a_i - (r - \mu)\,W_i\big)\,dt + \sigma_W W_i\, dZ$, where $dZ$ is random noise. This is the model of Bouchaud and Mézard for wealth [15], with equal issuance in place of trade.

**Proposition 2.** *If $\mu < r$ and everyone keeps the same $a_i = a$, the holdings settle into an inverse-gamma spread with shape $\alpha = 1 + 2(r - \mu)/\sigma_W^2$ and mean $a/(r - \mu)$. Its Gini index is (10). If any holder keeps $\mu \ge r$, that holding grows without limit.*

$$
G_{\infty} = \frac{\Gamma\!\left(\alpha - \tfrac12\right)}{\sqrt{\pi}\;\Gamma(\alpha)} \tag{10}
$$

The stationary Fokker–Planck equation of this process has the inverse-gamma solution [15], and its Lorenz curve gives (10). A simulation of the process agrees with (10) to within 0.004. ∎ So inequality stays bounded if, and only if, demurrage is larger than the best lasting return on holdings. This is theOS's own form of Piketty's $r > g$. Proposition 2 bounds the spread that returns create. Unequal work proposals add their own spread on top. Whether the condition holds is Hypothesis H4 (Section 10).

Dividends are such a return (Section 5.4). With the same yield for everyone, the resting level rises to $a/(r - \mu)$. Dividends also widen the spread. At a spread of returns of 20 %, a lasting return of 3.5 % a year would raise the resting Gini index of (10) from 0.29 to 0.40. So Law 5 is safe only while the lasting return stays below the melt, which bounds how much a COOP may sell against the MIND that others hold (Section 5.4).

The price is slower levelling. A fortune spread over many MINDs, and not spent, shrinks only at the net rate $r - \mu$ (Section 5.4). With no dividends, it halves in 9.9 years. Law 5 trades levelling speed for a living from ownership.

- capitalism today
- theOS, everyone keeps the same
- theOS, spread 10 %
- theOS, spread 20 %

0.000.200.400.600.80020406080100Years under theOSGini index of ownership0.720.290.140.00

*[Figure 9, drawn live on the page] **Figure 9.** An illustration of (9) and (10), not a forecast. Everyone starts as unequal as Germany today. If everyone keeps the same amount each year and no holding earns a return, inequality halves every 9.9 years and goes to zero. If returns spread by 10 % or 20 % between people, it settles near 0.15 or 0.29. Unequal pay for work proposals adds its own spread (Section 11.2.5). The dashed line holds Germany's Gini index fixed, for comparison.*

So the level of fairness depends on how evenly income reaches people, and on three dials: the rate of demurrage, the lasting return $\mu$, which must stay below it, and the spread $\sigma_W$ of returns between people. Avens that spread each person's MIND over many COOPs keep $\sigma_W$ small. A basket of 8 independent MINDs has $1/\sqrt{8}$, about 35 %, of the spread of one MIND. So diversification is part of fairness, not only a convenience. Spreading lowers $\sigma_W$; whether it also lowers $\mu$ is open.

- 3 % a year
- 7 % a year
- 10 % a year

0.000.200.400.600.801.0010 %20 %30 %40 %50 %Spread of returns between people (σ_W)Resting Gini indexGermany today: 0.720.770.610.54

*[Figure 10, drawn live on the page] **Figure 10.** The fairness dial, from (10). A higher rate of demurrage or a smaller spread of returns gives a fairer resting state. At 7 % and a spread of 20 %, the Gini index is 0.29. If people hold one COOP each, with a spread of, for example, 40 %, it is 0.53, still below Germany's 0.72 today. The lines assume no lasting return. Dividends raise the curves, and a lasting return at or above the melt removes the resting state at any spread.*

Now we can say what *fair* means in theOS. It means three things. **Equal issuance:** every person gets the same flow of intent, 24 HEARTS a day, and so the same new ownership, 12 MIND a day, whatever their wealth, their Aven's work or their birth. **Self-direction:** each person decides what their share builds. **Bounded advantage:** every holding melts, so any advantage from luck, skill, an Aven's output or inheritance fades unless the holder earns it again. Without dividends, it halves in 9.9 years. With dividends, it halves only while $\mu$ stays below the melt (Section 5.4). Bounded advantage needs $\mu$ below the melt. Fair participation follows from fair ownership: every person owns and steers the automated economy in equal measure of issuance.

theOS does not promise equal outcomes. People who use more own less. People whose Avens serve others well earn more. People who choose better COOPs hold more. theOS promises that no difference grows without limit while the lasting return $\mu$ stays below the melt, and that then nobody inherits a difference for long. Whether $\mu$ stays below the melt is Hypothesis H4 (Section 10). In Rawls's terms, theOS is a property-owning democracy whose "beginning of each period" is every day [68].

### 9.3 The whole machine

All the pieces are now in place: the five laws of Section 4, and the rules built on them. Each part of the machine has a clear job, and Table 3 lists the parts. MIND is the one part that does several jobs on purpose: it carries ownership and use in one token.

***Table 3.** The parts of theOS and their jobs.*

| Part | Its job | Comes from | Goes to |
| --- | --- | --- | --- |
| HEARTS | A person's intent: what they want built | The UIA, 24 a day per person | Converted into MIND by investment, or melted |
| MIND | Ownership of a COOP and the means to use what it makes; people hold it as ownership and spend it to use, the COOP holds it as working capital | Every invested HEART, one for one: 0.5 to the investor, 0.4 to the treasury, 0.1 to the city's pools | Spent on what the COOP makes, and the seller always receives its own MIND; paid out again by COOPs for resources, services and work proposals, which only moves it from one holder to another. It goes out of existence when it melts, or when a failed COOP's MIND is retired from the pools because no successor carries it on (Section 9.1) |
| Treasury | A COOP's working capital: its own MIND and other COOPs' MIND, never HEARTS | The treasury's part of each new MIND, 0.4 of each HEART, and 80 % of every sale | Inputs, building, ground rent and work proposals that keep it running; the reserve of the payout rule (Section 4); the rest paid out for new work; melt |
| Dividends | Pay the owners of a COOP when it is useful (Law 5) | 20 % of every sale, the same for every COOP, at the moment of sale | Everyone who holds the seller's MIND except its own treasury: people, other COOPs and the city's pools, in proportion to what each one holds; with what people hold, meant to let them live without working (H3) |
| Prices | Tell COOPs what to make and Avens where to buy | Each COOP, every day, in its own MIND: up when sold out, down when idle; no caps | Avens, which show them in HEARTS and in days of living (Section 6.3) |
| The city's pools | Prices and trades between MINDs, and routes every payment into the seller's own MIND; the City COOP holds their LP tokens (Section 6) | The pools' part of each new MIND, 0.1 of each HEART, automatically, in baskets of 4 to 8 MINDs; their Law 5 dividends, with no vote (Section 9) | No COOP or person withdraws; MIND leaves a pool in four ways only, a redemption by MIP among them (Section 6) |
| Demurrage | One of two ways money goes out of existence (Section 5.2): 7 % a year on everything | The protocol | Nobody; melted money is gone |
| Avens | One person's agent: invest, trade, pay, propose and deliver all work proposals with the COOPs' machines, collect dividends, leave | One per person | Work only for their human, who receives their pay; no human labour is paid |
| City COOP | Holds all land and what all citizens share, and leases land; never sells it (Section 8.2). Holds all LP tokens of the city's pools (Section 6). Runs the city's euro bank (Section 8.3) | The city: every citizen holds one equal share. Ground rent in MIND from every COOP that builds; the founders' euros as its starting balance from outside | Streets, parks and water, with a water part in its reserve (Section 9.1); Law 5 pays 20 % of each ground rent to cityMIND's holders (Section 8.2) |
| COOP governance | How each COOP decides; tested by selection | Chosen by each COOP | Tested by where people invest |

Section 5.2 gave the monetary policy that connects these parts: money is issued as HEARTS, converted into MINDs, circulated as MINDs, and goes out of existence when it melts or when a failed COOP's MIND is retired. Figure 11 shows the machine at work.

solarMIND17 %

agriMIND17 %

cityMIND17 %

computeMIND17 %

artsMIND17 %

habitatMIND17 %

HEARTS that people invest MIND, half back to the investor MIND, 0.4 into the COOP's treasury (0.1 goes to the city's pools)

*[Figure 11, drawn live on the page] **Figure 11.** The whole machine, simulated. People on the outer ring invest their daily HEARTS (terracotta) into six COOPs. Each HEART converts into that COOP's MIND as it arrives, so the COOP never holds a HEART. Half returns to its investor (gold). The treasury's 0.4 sinks into the COOP's treasury, its working capital, whose ring grows and slowly melts. The pools' 0.1 goes to the city's pools, which the figure leaves out. Every few seconds, one COOP becomes extractive: its MIND buys less utility, so the gold half that returns is worth less (a smaller dot). The Avens see that a HEART creates less utility there, and they send investment to the other COOPs without any vote.*

***Table 4.** What theOS is: its rules, its policies with their current values, and its main concepts.*

| Kind | Name | Where | Who changes it |
| --- | --- | --- | --- |
| Rule | Laws 1 to 5 | Section 4 | Nobody inside the protocol; only a new protocol (Appendix F) |
| Rule | The melt, 7 % a year | Section 5.1 | A new version of the protocol (Appendix F) |
| Rule | The payout rule | Section 4 | A new version of the protocol |
| Rule | The pools and their LP tokens | Section 6 | A new version of the protocol |
| Rule | A redemption of LP tokens: a passed MIP with two thirds of all citizen shares, then a wait of 30 days | Section 6 | A new version of the protocol |
| Rule | The land rule: only COOPs build | Section 8.2 | A new version of the protocol |
| Rule | Ground rent is a sale under Law 5 (Hypothesis H15) | Section 8.2 | A new version of the protocol |
| Rule | The euro border: no person sells MIND for euros; the founders' euros are the City COOP's starting balance | Section 8.3 | A new version of the protocol |
| Rule | The holder rule | Section 9 | A new version of the protocol |
| Rule | Open investment: no COOP whose MIND trades in a basket refuses an investment | Section 9 | A new version of the protocol |
| Rule | The successor rule: a successor carries on a failed COOP's MIND | Section 9.1 | A new version of the protocol |
| Policy | The reserve: 9 months | Section 4 | The City COOP, by MIP |
| Policy | The yearly cap on redemptions: 10 % of a pool | Section 6 | The City COOP, by MIP |
| Policy | The Avens' default investment rule | Section 7 | The City COOP, only by MIP; each person's own choice overrides it |
| Policy | Ground rent: not set yet | Section 8.2 | The City COOP, by MIP |
| Policy | The euro loan terms: not set yet | Section 8.3 | The City COOP, by MIP |
| Policy | The water reserve: not set yet | Section 9.1 | The City COOP, by MIP |
| Policy | The idle-plant rule: 25 % of capacity | Section 9.1 | The City COOP, by MIP |
| Concept | HEARTS, MIND, COOP, treasury, the City COOP | Section 4 | Definitions |
| Concept | Work proposal | Section 4 | A definition |
| Concept | The lasting return $\mu$ | Section 5.4 | A definition |
| Concept | The unit of account, a day of living, the basic bundle | Section 6.3 | Definitions |
| Concept | Selection between COOPs | Section 9 | A definition |

The machine is complete. Table 4 sorts its parts into rules, policies and concepts. What should the machine achieve? Part III states it as hypotheses, and Part IV tests them.

Part III · Hypotheses: what theOS should achieve

## 10Hypotheses: what theOS should achieve

Part II said what theOS is. This part says what we expect it to achieve. Each expectation is a *hypothesis*: a statement that mathematics can prove, or that the simulations of Part IV can support or refute. The central one asks whether every person in Abundism lives well. That question decides whether it is worth building. An average can rise while one person goes hungry, so Proposition 3 checks every person, not averages.

### 10.1 How we grade a hypothesis

Each hypothesis has a statement, the rules of Part II that should make it hold, a status, and the evidence in Part IV. There are five statuses. **Proven:** it follows from the rules by mathematics. **Supported:** every simulation run that tests it holds. **Mixed:** some runs hold, and some fail. **Failing:** every run that tests it fails. **Open:** no simulation tests it yet. Each status is computed from the results of Section 11, so a new run updates it. Table 5 lists them all.

***Table 5.** The hypotheses of theOS, the rules they rest on, and their status today.*

| Hypothesis | Rests on | Status | Evidence |
| --- | --- | --- | --- |
| H1 Laborde's rule (Proposition 1) | Law 1, the melt | proven | Section 5.3 |
| H2 Bounded inequality (Proposition 2) | The melt, Law 5 | proven | Section 9.2 |
| H3 No one starves, no one has to work, living standards rise (Proposition 3) | Laws 1 to 5, the melt, the holder rule, the land rule, the idle-plant rule, the payout rule | failing | Section 11.2.3 |
| H4 The melt levels ownership | The melt, Law 5's share | mixed | Section 11.2.5 |
| H5 Long-lived projects get built, and their rise is shared | Laws 2 and 4, the euro border | supported | Section 11.2.4 |
| H6 Rivals keep basics near cost | Law 3, price rules, the idle-plant rule | failing | Section 11.2.4 |
| H7 Only physics limits abundance | Laws 1 to 4 | open | None yet |
| H8 Energy binds growth | Recipes and net energy | open | None yet |
| H9 The euro border balances | The euro border | open | None yet |
| H10 The founding leaves no one short | The bootstrap (C3) | supported | Section 11.2.3 |
| H11 Spread ownership pays the basics | Law 5, the Avens' choice (C4) | failing | Sections 11.2.1 and 11.2.3 |
| H12 People own most MIND | The payout rule | failing | Section 11.2.2 |
| H13 The melt keeps money moving | The melt | open | Section 11.2.2 |
| H14 Selection improves governance | Law 3, the Avens' exit | open | None yet |
| H15 Ground rent as a Law 5 sale lifts cityMIND and the owner-only people | Law 5, the land rule, ground rent as a sale | failing | Section 11.2.1 |
| H16 Either estate rule keeps the Gini bounded | Law 1, the melt | open | None yet (Section 12.1) |

### 10.2 Propositions 1 and 2

**H1, Laborde's rule.** With a constant population and once money has settled, each member's balance, measured against the average, moves toward the average at the rate of the melt: Laborde's law with $c = r$. This is Proposition 1 (Section 5.3). It rests on Law 1 and the melt. Status: proven. In a young city the rate starts higher and falls to $r$.

**H2, bounded inequality.** If the lasting return $\mu$ stays below the melt and everyone keeps the same each year, holdings settle into a spread whose Gini index is (10). If any holder keeps $\mu \ge r$, that holding grows without limit. This is Proposition 2 (Section 9.2), and a simulation of the process agrees with it. Status: proven. Whether the city meets its condition is H4 (Section 10.5).

### 10.3 Proposition 3, the central hypothesis

Five terms come first. The *founding* is a city's first days: residents invest before the first sale, until every person holds MIND. In the economic model it ends on day 8. The *basic bundle* (Section 6.3) is one day of basics for one person. An *owner-only person* is a person whose Aven delivers nothing and who starts with nothing. *Real consumption* counts every unit that a person consumes, valued at the prices of day 1, so it counts amounts, not price changes. Prices fell sharply in year 1, so real consumption is not comparable with a day of living. A *tenth of the people* is one of ten equal groups when we sort the people by what they hold, or by what their Aven delivers (Aven output). Part 3 judges both sorts, so it judges twenty tenths. An *extra* is a good above the basics, such as more home, goods, care or experiences.

Hypothesis H3 · Proposition 3 · No one starves, no one has to work, living standards rise

*Take a city that follows the five laws, the melt and the rules of Part II: the holder rule, the land rule, the idle-plant rule and the payout rule. Let it meet the conditions C1 to C5 below. Then, from the end of the founding, parts 1 and 2 hold for every person on every day, and part 3 holds for every tenth of the people:*

1. ***No one starves.** Each person gets at least 98 % of every basic need.*
2. ***No one has to work to survive.** An owner-only person lives from what they own: their Law 5 dividends, plus spending some of the MIND they hold, pay for the basic bundle every day, and their holding never runs out.*
3. ***Living standards rise.** Living standards rise for every tenth, by holdings and by Aven output, in real units. Each tenth gets its basics at need. No extra falls more than 2 % in any 5 years. A fall does not count when the tenth got all it wanted of that good, or the good was at its natural or physical limit.*

Samuel chose this reading of part 3 on 2026-10-14. We call it *the verdict*. A tenth that asks for less of an extra, and gets all it asks for, has not lost living standard. And no fall counts while nature or physics limits the good, as rain and sun limit a harvest. Three other readings stay in Table 7 as side columns (Section 11.1). They are (a), each extra alone; (b), the verdict without the cap excuse; and (c), one basket of all extras.

Proposition 3 is claimed from the end of the founding, not from day 1. The founding is reported on its own (Section 11.2.3), and H10 states what we expect of it. We call part 2 the *normal test*. We also check a stronger target, which the proposition does not claim: the *strict test*, in which dividends alone pay for the basic bundle. The economic model judges part 3 tenth by tenth in real units, over every window of 5 years, by the verdict, taste-adjusted (Section 11.1). An older yardstick compared each decile of real consumption at ten-year marks; we still report it beside the verdict. Status of H3: failing. Part 1: supported; part 2: supported; part 3: failing. All three parts held on none of the main run's 8 seeds (Section 11.3).

The five conditions are these:

- **C1 Enough output that grows fast enough.** Plants, land and net energy cover the basics, and output per person grows (Section 8.4). How fast is enough for part 3 is open (Section 10.4). In the economic model, the growth is an assumption (Section 11.2.1).
- **C2 Competition.** Two or more sellers of every basic except water, which the City COOP runs with a reserve; prices that move freely both ways; and Law 3 entry that is always open (Section 9.1).
- **C3 The bootstrap.** Residents invest their HEARTS for a founding week before the first sale. The pools' part of each new MIND fills the pools, so every MIND can trade on opening day. Each person's first investment makes them a part-owner of the basics COOPs (Section 12.4). Euros fund only machines, never MIND. The founding ends once every person holds MIND.
- **C4 Spread ownership.** Avens keep enough MIND of COOPs that sell a lot to cover the basic bundle, spread the rest, and pay first with the MIND that earns least (Section 7). This is a proposal, and a floor for part 2. Its first tests did not reach the strict test (H11). Spreading lowers the spread of returns $\sigma_W$. Whether it also lowers $\mu$ is open: holding only the MINDs that sell most would raise it (Section 12.5).
- **C5 Wants and Aven work that can grow.** At least one good never satisfies fully, such as experiences, and Avens deliver what COOPs ask.

Table 6 lists what the economic model of Section 11.2 found for each condition.

***Table 6.** Conditions and what the economic model found on its main seed.*

| Condition | In the economic model |
| --- | --- |
| C1 Enough output that grows fast enough | Assumed: each COOP's productivity grows about 2 % a year on average, and net energy is not modelled. Without productivity growth, the run failed all three checks; with 2 % for every COOP, it passed all three checks |
| C2 Competition | Met only in part: in year 60, one COOP made 97 % of the energy. Water, which C2 leaves to the City COOP, had one seller throughout (Table 14). After the 7 ends, no one went short |
| C3 The bootstrap (Section 12.4) | Modelled in part since the upgrades of round 1: in the founding week, the Avens invest HEARTS in the sellers of the four basics. In the main run's founding, no one went short. The checks start on day 8, and the founding is reported on its own (Section 11.2.3) |
| C4 Spread ownership | Not modelled: 42 % of what the owner-only people held was cityMIND, which pays almost nothing. The upgrades of round 1 tried it and did not keep it (Table 10) |
| C5 Wants and Aven work that can grow | Met: experiences never satisfy fully. Without them, the run passed parts 1 and 2 and failed part 3, and the dividend yield fell to 0.2 % |
| The payout rule (Section 4) | With reserves of 6 months, the run passed all three checks; with 12 months, it passed all three checks. Under Law 5 paid to the pools, all three checks passed on 5 of 8 seeds with 12 months |
| Every COOP accepts HEARTS from anyone | Assumed |

Proposition 3 is a hypothesis with an argument, not a theorem. Section 10.4 gives the conditions under which each part can hold. Parts 1 and 3 have no closed form, so the simulations must check them.

### 10.4 When Proposition 3 can hold

Three conditions follow from the rules. We derive each one and check it against the economic model.

**(a) No one has to work if a day's basics cost less than the investor's half of a day's HEARTS, plus dividends.** Let $W_i$ be what person $i$ holds, in HEARTS, and let $X_i$ be what they spend. Let $\omega$ be the ownership that their investing creates for them, and $D_i$ their dividends. Let $p_b$ be the cost of a day's basic bundle. With all flows counted a year,

$$
\begin{gathered} \frac{dW_i}{dt} = \omega + D_i - r\,W_i - X_i \\ 365\,p_b < \omega + D_i \;\Rightarrow\; W_i(t) > 0 \\ T_i = \frac{1}{r}\,\ln\!\Big(1 + \frac{r\,W_i}{365\,p_b}\Big) \end{gathered} \tag{11}
$$

In words: a holding grows while what flows in, new ownership and dividends, exceeds the melt and the spending. If a person spends only on the basics, $X_i = 365\,p_b$, and the second line holds, then the holding moves toward a positive level and never runs out. Each day, a person invests 24 HEARTS and keeps 12 MIND. A new MIND is worth 1 HEART only on average (Section 6.3), so $\omega$ is about 12 HEARTS a day for a person who invests like the average, and less for one who invests in MINDs worth less. In the last ten years of the economic model, the 12 MIND were worth 11.89 HEARTS a person a day. Three qualifiers apply. The condition needs basics that exist, so part 1 must hold too: a margin in MIND cannot buy food that nobody has made. It leaves out price moves: when a MIND that a person holds falls in price, so does the holding. And each payment through the pools costs a small fee. $T_i$ measures the buffer: how many years a holding $W_i$ would pay a day's basics with nothing flowing in, the melt included. In the economic model, a day's basics cost at most 0.575 HEARTS, in year 1, so the investor's half alone covered them about ×21. The model is far inside condition (a).

**(b) Dividends alone can pay everyone's basics only if the basics cost less than Law 5's share of all sales.** Law 5 pays $\lambda$, 20 %, of every sale to the holders of the seller's MIND. Let $Q$ be all sales a day, $N$ the number of people, and $s_p$ the share of the dividend-earning MIND that people hold; the rest is held by other COOPs' treasuries and by the city's pools. Then

$$
\begin{gathered} \sum_i D_i = \lambda\, s_p\, Q \ge N\,p_b \\ \Rightarrow\; \frac{N\,p_b}{Q} \le \lambda\, s_p \le \lambda \end{gathered} \tag{12}
$$

So the strict test can hold for everyone only if a day's basics for everyone cost less than 20 % of a day's sales, and less still where treasuries and pools hold MIND. The condition is necessary, not sufficient: every person also needs enough MIND that pays. If all sales are to people and the dividend yield is the city's average, $\bar\eta = \lambda Y / \bar W$, with $Y$ what people buy (HEARTS a person a day) and $\bar W$ the mean holding, then each person needs

$$
\begin{gathered} D_i \approx \bar\eta\, W_i = \lambda\,Y\,\frac{W_i}{\bar W} \\ D_i \ge p_b \iff \frac{W_i}{\bar W} \ge \frac{p_b}{\lambda\,Y} \end{gathered} \tag{13}
$$

In the last ten years of the economic model, people's dividends were 2.65 HEARTS a person a day, against 0.040 for a day's basics in year 60: condition (12) held about ×66. The right side of (13) was 0.31 % of the mean holding, so an owner with an average mix of MIND passes by far. Yet in year 60, dividends alone covered 6 % of the owner-only person-days, and 42 % of what the owner-only people held was cityMIND, which pays almost nothing. A miss comes from which MIND a person holds, not from how much (C4, H11). The strict test also needs sales far beyond the basics: if people bought only basics, their dividends would be just 20 % of their cost. So the strict test is a goal for abundance, which must be sold and used, not only made. Law 5 can hedge the basics: when food gets dear, those who hold the MIND of the food COOP that sells get more dividends. A person who holds the MIND of a food COOP that sells little gets no such hedge (C4).

**(c) No one starves only if the stock and the capacity cover the need through the largest shock that the city plans for.** Let $d$ be the need for a basic a day, $q$ the capacity to make it, and $S$ the stock in hand. A shock takes a share $\delta$ of the capacity for $\tau$ days. Then the stock must cover the gap:

$$
S \ge \big(d - (1 - \delta)\,q\big)\,\tau \tag{14}
$$

Rot and the stock used before the shock come on top. The largest shock in the economic model takes 50 % of a plant's capacity for 8 months. With capacity just at need, the stock must then hold 4.0 months of need. The main run keeps 54 days of food in store and 90 days of water. Both are less than that, so they cover the largest shock only where capacity is above need. And its food price rule does not see the store (Section 11.4). Condition (c) is necessary, not sufficient. Part 1 also needs buyers who can pay, which part 2 gives, two or more sellers of each basic (C2), and, in the founding, the bootstrap (C3). A seller with idle capacity lowers its price, and a rival takes the buyers it loses. MIND must never be what runs short while physics allows more (H7).

**Part 3** has no such condition. It needs output per person to grow fast enough (C1), and wants that grow with it (C5). The poorest tenth gain through two channels. Every person gets the same new ownership each day, 12 MIND. And competition passes productivity on as cheaper goods: a day's basics cost 0.575 HEARTS in year 1 and 0.040 in year 60. So the same daily ownership buys more each year. Productivity reaches people as buyers, not as a rising value of the MIND they hold: the prices of the infrastructure MINDs moved between -0.6 % and 1.2 % a year (Section 8.1). How fast is enough is open (H8). Under the verdict, part 3 also needs budgets that do not fall, and supply that holds through shocks (Section 11.2.6). The run with even growth, 2 % for every COOP, meets C1 and C5, and C2 in part, and there the run passed all three checks. Its output per unit of plant grew 2.2 % a year, against 4.0 % in the main run.

### 10.5 More hypotheses

Proposition 3 rests on more than its own parts. Each hypothesis below says what we expect, which rules should make it hold, its status and where Part IV tests it.

**H4 The melt levels ownership**
: The lasting return $\mu$ stays below the melt for every holder, so no holding grows without limit and every advantage fades. It rests on the melt (Section 5.1) and on Law 5's share, which sets the dividend part of $\mu$ (Section 5.4). Status: **mixed**. $\mu$ was below the melt on 7 of 8 seeds of the economic model, and on 22 of 24 seeds with the same shocks (Section 11.2.5).
**H5 Long-lived projects get built, and their rise is shared**
: The city builds what lasts. A project's rising value goes to its users and to the new investors who fund each stage, and long-term holders gain through Law 5 on growing sales. It rests on Laws 2 and 4 and on the euro loans (Section 8.1). Status: **supported**. In the economic model, 1 of the 5 infrastructure COOPs made all of their good by the last year, and the MINDs of 5 of them returned less than the melt (Section 11.2.4).
**H6 Rivals keep basics near cost**
: Open entry, free prices and Avens that switch keep the price of each basic within 10 % of its full cost, and no basic but water ends with one seller. It rests on Law 3, each COOP's price rule and the idle-plant rule (Section 9.1). Status: **failing**. In the economic model, by the last year, only one COOP made 5 % or more of the energy (Section 11.2.4). No simulation measures yet how near their full cost the basics sell, so that half of H6 is untested.
**H7 Only physics limits abundance**
: MIND never binds a basic while physics allows more, and more money does not make the city richer. It rests on Laws 1 to 4: money comes from intent, not from goods (Sections 5.2 and 8.4). Status: **open**: the economic model does not record what binds a basic, so no simulation tests H7 yet.
**H8 Energy binds growth**
: Output per person grows only as fast as surplus energy pays for, and fast enough for part 3 of Proposition 3. It rests on the recipes and net energy (Section 8.4, Appendix H). Status: **open**: the economic model assumes productivity growth and has no energy limit.
**H9 The euro border balances**
: Exports earn back the euros that the city needs for its machines and imports. It rests on the euro border (Section 8.3). Status: **open**: the economic model is a closed city with no euros (Appendix A), so no simulation tests H9 yet.
**H10 The founding leaves no one short**
: From the first sale, every person can buy the basics. It rests on the bootstrap (C3, Section 12.4). Status: **supported**. The main run of the economic model invests the founding week in the sellers of the four basics. No one went short in its founding, on the main seed or on the 24 seeds with the same shocks (Section 11.2.3). Under Law 5 paid to the pools, with no founding rule, 12,346 person-days were short in the founding on those seeds.
**H11 Spread ownership pays the basics**
: Once Avens keep enough MIND of COOPs that sell a lot, dividends alone pay every owner-only person's basics: the strict test. It rests on Law 5 and on the Avens' choice of what to hold (C4, Section 7). Status: **failing**. The upgrades of round 1 tried both Aven defaults of C4, each on 24 seeds with the same shocks. The strict test held in none of the 48 seed runs. Paying first with the MIND that earns least raised the share that they paid from 59.0 % to 81.0 %, but part 3 got worse (Section 11.2.1).
**H12 People own most MIND**
: Treasuries pay out what they do not need, so people, not treasuries, own most of the city's MIND. It rests on the payout rule (Section 4). Status: **failing**. In the last ten years of the economic model, people held 41 % of all MIND by value, less than half. The pools held 36 %, the treasuries 11 % and the arbitrage bot 11 % (Section 11.2.2).
**H13 The melt keeps money moving**
: Because money melts, people spend or invest it rather than keep it idle, so the velocity of money rises. It rests on the melt (Section 5.1). Status: **open**: the economic model assumes how much people spend, so it cannot settle this (Section 11.2.2).
**H14 Selection improves governance**
: Avens move investment away from COOPs that deliver less for their MIND, so better-run COOPs grow, and governance improves by selection. It rests on Law 3 and on the Avens' exit (Sections 7 and 9). Status: **open**: no simulation tests it yet.
**H15 Ground rent as a Law 5 sale lifts cityMIND and the owner-only people**
: Ground rent is a sale, so Law 5 pays 20 % of it to cityMIND's holders (Section 8.2). We expect cityMIND then to pay a real dividend, to the owner-only people too: in the main run, cityMIND was 42 % of what they held. It rests on Law 5 and on the land rule. Status: **failing**. The main run of the economic model now models the City COOP's ground-rent policy (Section 11.2.1). It raises rent only while a COOP asks for land that the City cannot give. But it still books ground rent as a flow between treasuries, not as a sale. The upgrades of round 1 ran rent as a sale on 24 seeds with the same shocks. Neither of its two targets rose clearly. cityMIND's return went from -0.53 % to -0.44 % (p = 0.310). The share of owner-only person-days that dividends alone paid went from 59.0 % to 59.9 % (p = 0.840; Section 11.2.1).
**H16 Either estate rule keeps the Gini bounded**
: When a person dies, the MIND that they leave goes to the City COOP or to heirs whom they name. Either rule keeps the Gini index of holdings bounded. It rests on Law 1 and on the melt. Status: **open**: theOS has not chosen a rule, and no simulation runs either one yet (Section 12.1).

Part IV · Our simulations

## 11Our simulations

Nobody can run a whole economy in a laboratory. And nobody should test it on people's lives first. So we test theOS first in simulation, then in the real city. Part III stated what theOS should achieve. This part tests it in one simulation. The economic model plays the rules in a small city of 250 people, with no land map, no energy limit and no euro border. Each new version must come closer to the hypotheses of Section 10 than the last. Section 11.3 shows how far it has come.

### 11.1 How we test: one yardstick

The economic model judges Proposition 3 by the rules below, from the end of the founding. **Part 1** checks every person on every step: a *person-day* is one person on one day, and it is short when the person gets less than 98 % of any basic need. **Part 2** checks every owner-only person: the normal test lets them spend some of what they hold, and the strict test asks dividends alone to pay the basic bundle. **Part 3** checks every tenth of the people, sorted by holdings and by Aven output. It counts real units: the basics, and extras such as floor space, goods and Aven hours. Each basic stays at need every year, within 1 %. No extra falls more than 2 % in any 5 years, unless the verdict excuses the fall. And each tenth's basket rises over the run: at least one extra rises 5 % or more. The economic model has judged part 3 in real units since the upgrades of round 1 (Table 9). Experiences have no physical unit there, so it values them at the prices of day 1. Before that, it valued what each tenth consumes at the prices of day 1, with the tenths sorted by consumption. We still report that check, marked "by the old yardstick". The economic model steps daily in year 1 and weekly after, counting each week as seven person-days.

**One extra that falls.** The verdict, which Samuel chose (Section 10.3), excuses a fall in two cases. The *taste excuse*: the tenth got all it asked for of the extra, but asked for less. The *cap excuse*: the extra was at a cap, the tenth's satiation level or a natural or physical limit. Table 7 gives the verdict first, then the three side readings. Reading (a), each extra: every fall counts, unless the extra is at satiation or a physical limit binds that year. Reading (b), taste-adjusted, no cap excuse: only the taste excuse applies. Reading (c), one basket: the extras count together, at fixed prices of day 1.

***Table 7.** Part 3 under the verdict and the three side readings in the economic model: tenths failing, of 480, summed over 24 seeds with the same shocks. Each column is a rule set, and the last is the main run.*

| Reading | Law 5 paid to the pools | The upgrades of round 1 | The upgrades of round 2 |
| --- | --- | --- | --- |
| The verdict, taste-adjusted | 480 | 438 | 399 |
| (a), each extra | 480 | 463 | 405 |
| (b), taste-adjusted, no cap excuse | 480 | 438 | 399 |
| (c), one basket | 338 | 201 | 304 |

**Why the readings differ.** In the economic model, the city's tastes drift, so a tenth often asks for less because it wants less. The verdict excuses that, and (a) counts it. So the verdict fails fewer tenths than (a): 399 against 405 in the main run, and 438 against 463 in the upgrades of round 1. As one basket, under (c), a rise in one extra can make up for a fall in another. There, 304 tenths failed in the main run, and 201 in the upgrades of round 1.

Two findings explain why the verdict and (b) agree in the economic model. First, the cap excuse never applies there: a tenth's mean of an extra cannot go above its satiation level. It excused none falls, so (b) fails the same tenths on every seed. Second, land, the model's one physical limit, never binds. It bound in none of the counted falls. At no year's end was all the land let; the most was 95.7 % in the main run.

On the main run's 8 seeds, part 3 held on no seed under the verdict or any side reading. Every status in this paper uses the verdict, and one constant in the code changes it.

A run *passes* a check when nothing fails on any step, and a scenario passes when it meets its condition for passing; a comparison has no verdict. The economic model has a main seed, and we also run more seeds.

**One seed, one history.** A seed fixes the random events of a run, but each event also depends on what happened before. When a rule moves one number by a hair, a random draw lands on a different event. From then on, the run takes another path. We showed this with an earlier version of the economic model (the idle-plant rule in Table 9), by moving the pools' part on the main seed. At 0.0999 of each HEART instead of 0.1, no one went short, and all three checks passed. At 0.1001, 3,500 person-days were short. The old pool rule did the same. At 0.0499, no one went short; at 0.0501, 23,184 person-days were short. So one seed cannot show which of two rules is better. On the main seed, the gap between the two pool rules in Table 16 is one history against another.

Instead, we compare two rules on the same shocks. With *common random numbers*, both runs of a seed draw their capacity shocks and the drift of tastes from one shared random stream. So on each seed, both rules meet the same shocks on the same days. Most of the difference between the two runs then comes from the rule. Some luck remains, because founders and trades still draw from each run's own stream. We ran rules on 24 seeds, 20261012 to 20261035, in pairs. The shocks come from a second random stream, so seed 20261012 of these pairs is not the main run, though it has the same number. A *sign test* then counts the seeds on which the new rule did better and those on which it did worse, and leaves out ties. If the rule made no difference, each seed would be a coin toss. The value *p* is the chance that coin tosses alone give a count at least this uneven, in either direction.

### 11.2 The economic model

The economic model is a small agent-based model of one city with 250 people over 60 years. It has no land map, no energy limit and no euro border. Its versions come in order, and each one changed what the next one tested.

#### 11.2.1 The model and its versions

An *agent-based* simulation lets every person and every COOP act by its own rules, day by day, and then adds up what happens. Ours plays the rules of this paper in one city (Appendix G):

- 250 people over 60 years, on one *seed*: one fixed set of random events, such as its shocks and its drifting tastes. Section 11.2.6 runs the main run on 7 more seeds. A *person-day* is one person on one day. Daily steps in year 1, weekly steps after; each week counts as seven person-days.
- On day 1 the plants can make 115 % of the first needs, but nobody holds MIND yet. One person in 10 is owner-only.
- 9 goods. Experiences never satisfy fully.
- Two rival COOPs for each household good except water, free prices, reserves of 9 months, and Law 5 at 20 %. Law 5 pays every holder of the seller's MIND but its own treasury: people, other COOPs' treasuries and the city's pools.
- Each invested HEART makes one MIND (Law 4, Section 4).
- Each COOP's productivity rises at its own rate, about 2 % a year on average. This is an assumption (Appendix A).
- 80 capacity shocks of 30 % to 50 %, for 2 to 8 months, and tastes that drift.
- COOPs are founded, exit and fail.
- The City COOP leases a failed COOP's plant to a successor while demand is at least 25 % of its capacity. It scraps an idle plant and takes the land back: the idle-plant rule of Section 9.1. The model gives a successor a new MIND and retires the failed COOP's MIND. The successor rule of Section 9.1 keeps the failed COOP's MIND instead. The upgrades of round 1 tested it and did not keep it (Table 10).
- The 6 rules kept in rounds 1 and 2 of the upgrades (below). A food store holds 54 days of food. Rivals copy the leader's technology after 2 years. The founding week's HEARTS go into the sellers of the basics. What a sold-out seller cannot deliver passes to the other sellers of the good. The City COOP raises ground rent only while land is short. And it keeps 90 days of water in store.
- Part 3 is judged by the verdict (Section 11.1).
- Each Aven puts 75 % of its person's HEARTS into the 6 MINDs with the highest price × (1 + 3 × dividend yield), and the rest by its person's own values. A new COOP gets other people's HEARTS only after its pool has traded for a year.
- People spend a share $\theta = 0.5$ of what they hold a year, basics first.
- Every human has one Aven, and no human labour is paid.

The *main run* is the run with these settings. It is the evidence of Sections 11.2.2 to 11.2.6. We call its years 51 to 60 its *last ten years*. In the main run, the COOPs whose productivity grew fastest led their markets. So output per unit of plant rose about 4.0 % a year, and mean real consumption about 6.6 % a year, with no energy limit.

An earlier static world ran under the same laws, with simpler markets. It had one COOP per good (two for food), fixed tastes and no growth. Its prices were capped at twice their full cost, which theOS does not allow, and its reserves were short. That cap is one reason why we replaced it. We now use the dynamic world. "Static" marks every number in this paper that still comes from the earlier one. Table 8 compares the two.

***Table 8.** Two worlds, in the last ten years (years 51 to 60) unless the row says otherwise: the dynamic world that this paper uses, and the earlier static one.*

| Measure | Dynamic | Static |
| --- | --- | --- |
| A day of living, HEARTS: year 1 / year 60 | 4.4 / 63.3 | 11.8 / 11.9 |
| Income a person a day, HEARTS | 77.5 | 33.1 |
| Share of income spent / melting in wallets | 90 % / 13 % | 36 % / 63 % |
| Share of all MIND by value: people / treasuries / pools | 41 / 11 / 36 % | 88 / 1 / 11 % |
| Share of all MIND by value: the arbitrage bot | 11 % | — |
| Dividend yield a year | 4.7 % | 0.7 % |
| Lasting return $\mu$; whole run | 1.6 %; 5.5 % | 0.5 % |
| Gini index of what people hold | 0.33 | 0.34 |
| MIND values, HEARTS | 0.25–1.26 | 0.98–1.04 |
| COOP failures / exits / foundings, whole run | 0 / 7 / 17 | 0 / 0 / 0 |
| MINDs alive at the end | 25 | 9 |

Table 9 lists the versions so far. The static world checked no person on any day. The dynamic world added free prices, rivals, foundings, failures and shocks, and checked Proposition 3 for every person; it counted values in R, a basket of three MINDs that we have since retired (Appendix G). The HEART report counted in HEARTS and gave the pools 0.1 of each HEART. The idle-plant rule scrapped idle plants instead of leasing them. Law 5 paid to the pools paid the city's pools their share of every sale too, as Section 4 says. It was the main run until round 2 of the upgrades. The upgrades of round 1 switched on 3 rules. The upgrades of round 2 switched on 3 more, and they are this paper's main run (below). By the old yardstick, it passed all three checks on its main seed. All three held on 6 of 8 seeds, against 5 for the version before it. By the verdict, taste-adjusted, part 3 held on none of them (Section 11.1).

***Table 9.** The versions of the economic model, in order. Checks on the main seed: 1 no one starves, 2 the normal test, 3 living standards rise, by the old yardstick. Person-days short from day 8, on the main seed. μ is the lasting return in the last ten years, in HEARTS. All three: the seeds on which all three checks held, by the old yardstick and, where judged, by the verdict of Section 11.1.*

| Version | Pull request | Pools' part | Checks 1 · 2 · 3 | Short | μ | All three, of 8 seeds |
| --- | --- | --- | --- | --- | --- | --- |
| The static world | #520, #522 | 0.05 | not per person | — | — | — |
| The dynamic world | #524 | 0.05 | ✓ · ✓ · ✓ | 0 | 7.5 % | — |
| The HEART report | #598 | 0.10 | ✗ · ✗ · ✗ | 9,975 | 9.4 % | 3 |
| The idle-plant rule | #599 | 0.10 | ✗ · ✗ · ✗ | 1,750 | 8.4 % | 2 |
| Law 5 paid to the pools | this paper | 0.10 | ✓ · ✓ · ✓ | 0 | 7.3 % | 5; by the verdict: 0 |
| The upgrades of round 1 | this paper | 0.10 | ✗ · ✗ · ✓ | 8,750 | 6.7 % | 5; by the verdict: 0 |
| The upgrades of round 2 (the main run) | this paper | 0.10 | ✓ · ✓ · ✓ | 0 | 1.6 % | 6; by the verdict: 0 |

**The upgrades of round 1.** Each upgrade is a rule that we can switch on or off. We ran each one alone against the main run of the time, Law 5 paid to the pools. We used the 24 seeds with the same shocks, and judged each upgrade by the sign test (Section 11.1). We kept an upgrade only if it helped its target and made no check of Proposition 3 worse. We kept 3:

- a food store of 54 days of food, for a dark winter;
- rivals that copy the leader's technology after 2 years (Section 9.1);
- the founding week's HEARTS, invested in the sellers of the 4 basics: food, energy, housing and water (C3).

With all 3 switched on, we ran the new main run against the old one on the same 24 seeds. Person-days short from day 8 fell from 66,218 to 168 (p = 0.003). In the founding week, they fell from 12,346 to none (p < 0.001). By the old yardstick, all three checks held on 21 seeds, against 9 (p < 0.001). Basics with one seller fell from 53 to 32 of 72 (p < 0.001). The median $\mu$ rose from 0.05 % to 4.41 %. Round 1 counts the MIND of an ended COOP at zero, so its medians differ a little from those of Section 11.2.5. $\mu$ stayed below the melt on 22 of 24 seeds; it was above on seed 20261013 (7.16 %) and seed 20261021 (7.81 %). The Gini index of holdings rose from 0.327 to 0.337 (p = 0.007).

It did not become the main run, because on the main seed it passed part 3 and failed parts 1 and 2. 8,750 person-days were short of food, and the worst had 92 % of it, in year 11. We traced the cause. A successor food seller's price flipped at every step. At the low price, buyers asked it for 3.5 to 3.9 times its capacity, and it delivered 42 % to 47 % of the orders. Meanwhile, 2 other food sellers held 33 million kcal in store. No order that a seller could not fill passed to another seller. Round 2 changed that.

Three more things failed in round 1. The strict test failed on every seed, because the owner-only people held MIND that pays little. Even so, dividends alone paid 78.2 % of their person-days after year 10, against 59.0 % (p = 0.007). Law 5's bound does not stop the test: at rest, it allows the median owner-only person 30.5 basic bundles a day. Their dividends came to a median of 1.55 bundles a day, but some of them got less than one on some days. By the verdict, part 3 failed on every seed, in 438 of 480 tenths (Table 7). And the founding week had a cost: run alone, it raised COOP failures from 22 to 39 (p = 0.041).

**The upgrades of round 2.** Round 2 started from the new main run of round 1. We traced each failure that it still had to a cause, and wrote one change for each cause. Each change ran alone against the new main run, on the same 24 seeds. We kept 3:

- **Orders pass to the other sellers.** What a sold-out seller cannot deliver passes at once to the other sellers of the good. They fill it from stock or spare capacity, at their own price. On the main seed of round 1, one food seller's orders went unmet while the other had spare capacity. With the change, person-days short on the main seed fell from 8,750 to none. On the 24 seeds, tenths failing by the verdict fell from 438 to 365 (p = 0.110), and under (a) from 463 to 368 (p = 0.008). Food price flips rose from 1,758 to 2,241 (p = 0.023).
- **The City COOP's ground-rent policy.** This change is how the simulation models the City COOP's policy for ground rent (Section 8.2, H15). The City lowers rent while land lies empty. It raises rent while more than 90 % of the land is let, but only while a COOP asks for land that it cannot give. Before, rent rose 15 to 106 times within a year or two while nobody asked for more land. The field food COOP failed under it. With the policy, COOP failures fell from 21 to 14, and successors that failed from 6 to none. On seed 20261014, failures fell from 6 to 4, and person-days short from 11,662 to 7,000.
- **A water stock.** The City COOP keeps 90 days of water in store, filled from spare capacity. The model counts no tank cost and no losses. Before, water ran short on 2 seeds when a shock cut the only water plant. With the stock, person-days short of water fell from 168 to none. Checks 1 and 2 held on 24 seeds instead of 22, and COOP failures fell from 21 to 18.

We did not keep the other 2 (Table 10). One invested the founding week only by the day's needs. The other leased a successor only the part of the plant in use.

**Why it is the main run.** With all 3 changes on, we ran the upgrades of round 2 on the same 24 seeds. We compared it with Law 5 paid to the pools and with the upgrades of round 1 (Appendix G). Against Law 5 paid to the pools, person-days short from day 8 fell from 66,218 to 1,883 (p < 0.001). By the verdict, tenths failing fell from 480 to 399 of 480 (p = 0.016). No successor failed, against 3. On the main seed, no one went short, and no COOP failed. Against the upgrades of round 1, the gain is not clear: tenths failing by the verdict went from 438 to 399 (p = 0.727). But on its main seed, the upgrades of round 1 left 8,750 person-days short.

**What it costs.** Four things got worse. First, on seed 20261020, 1,883 person-days were short of food, in years 59 and 60. The greenhouse had been the only real food seller since year 12. In year 59, a shock cut its plant by 48 %. The food store covered the amount. But the price rule raised the price 25 % a week, until it was about 300 times as high. The poorest could not pay. The price rule reads what buyers ask against capacity, and it does not see the store (Section 11.4). Second, under (c), tenths failing rose from 201 to 304 against the upgrades of round 1 (p = 0.115). Third, on the main seed, dividends alone paid 43.5 % of the owner-only person-days after year 10, against 77.4 % under Law 5 paid to the pools. On the 24 seeds, the mean share rose, from 59.0 % to 84.3 %. Fourth, food price flips rose from 1,758 to 1,869 against the upgrades of round 1 (p = 0.035). On the main seed, 154 of its 232 came from one new food seller in its first years.

***Table 10.** The upgrades of rounds 1 and 2 that we did not keep. Each ran alone against that round's base: Law 5 paid to the pools in round 1, and the new main run of round 1 in round 2. Unless the row says otherwise, each ran on the 24 seeds with the same shocks. Before the arrow: the base; after it: the upgrade. p: the two-sided sign test.*

| Round | Upgrade | What it did | Why we did not keep it |
| --- | --- | --- | --- |
| 1 | Daily steps for all 60 years | On 3 of 8 seeds, the only materials seller failed, nothing replaced it, and the city broke down | A test of the model, not a rule |
| 1 | Daily steps during every shock | No clear change on 8 seeds | No clear gain |
| 1 | A full price floor for large sellers | Person-days short 66,218 → 557,051 (p < 0.001); check 1 on 10 → 0 seeds | It made its own target worse |
| 1 | A price that reads the coming harvest | Person-days short 66,218 → 642,422 (p = 0.001) | It made its own target worse |
| 1 | A price floor for the City COOP's water | Food COOP failures 19 → 45 (p = 0.035) | Its target was already met, and food COOP failures rose |
| 1 | A water part in the City COOP's reserve | Food COOP failures 19 → 40 | Its target was already met, and its gains had no mechanism |
| 1 | Ground rent that covers the City COOP's upkeep | Food COOP failures 19 → 34 (p = 0.049); all COOP failures 22 → 37 (p = 0.031) | Its target was already met, and food COOP failures rose |
| 1 | Ground rent as a Law 5 sale | cityMIND's return −0.53 % → −0.44 % (p = 0.310); dividends alone paid 59.0 % → 59.9 % of owner-only person-days (p = 0.840) | No clear gain |
| 1 | A holding floor in the basic sellers' MIND | Dividends alone paid 59.0 % → 64.7 % of owner-only person-days (p = 0.540); MIND retired a person a year 218 → 612 (p = 0.004) | No clear gain |
| 1 | Paying first with the MIND that earns least | Dividends alone paid 59.0 % → 81.0 % of owner-only person-days (p = 0.007); part 3 by the old yardstick on 22 → 7 seeds (p = 0.001) | Another check got worse |
| 1 | The founding week into food, water and energy only | Person-days short in the founding 12,346 → 42,000; check 1 on 10 → 0 seeds: nobody held housing MIND | It made its own target worse |
| 1 | A successor carries on the failed COOP's MIND | MIND retired a person a year 218 → 221; successors that failed 3 → 9 | No clear gain |
| 1 | An ended COOP's other MINDs go to the City COOP | Food COOP failures 19 → 25 (p = 0.063); dividends alone paid 59.0 % → 55.7 % of owner-only person-days (p = 0.150) | No clear gain |
| 1 | A founding signal on unmet need | Basics with one seller 53 → 50 (p = 1.000); all COOP failures 22 → 41 (p = 0.096) | No clear gain |
| 1 | Avens invest by delivered output | Food COOP failures 19 → 183; all three checks on 9 → 2 seeds (p = 0.039) | It made its own target worse |
| 2 | The founding week only by the day's needs | Person-days short in the founding 0 → 5,985; from day 8 168 → 3,790; all COOP failures 21 → 24 | It made its own target worse |
| 2 | A successor leases only the part of the plant in use | All COOP failures 21 → 16; but on seed 20261014, its target, person-days short 11,662 → 24,500; with ground rent that rises only while land is short, it changed nothing | Another check got worse |

#### 11.2.2 Where MIND goes: the cycle and the round trip

The MIND that COOPs pay out comes back to them through what they sell. In the last ten years, people spent 90 % of what they get, and only 13 % melts in their wallets. In the static world, where every want had a limit (satiation), they spent 36 % and 63 % melted. The share follows mostly from how fast people spend, and only a little from the melt. If people spend a share $\theta$ of what they hold each year, they spend $\theta/(\theta + r)$ of their income. With $\theta = 0.5$, that is 87.7 %, close to the 90 % measured. People keep spending at that pace only while they still want more. So the cycle needs wants that keep growing.

melt, 7 % a year, and retired MIND: gone for goodNew MIND24 HEARTS a day convertPeople’swalletsCOOPtreasuriespoolsownership15 %0.4 to thetreasury12 %0.1 to the city’s pools3 %spent at COOPs90 %Work proposals81 %dividends, at each sale3 %the pools’ dividends8 %melts13 %melts3 %

Arrow widths are shares of a person’s income.

*[Figure 12, drawn live on the page] **Figure 12.** MIND goes round. What treasuries pay out comes back through what they sell, and little melts on the way. At each sale (the gold dot), the Law 5 share goes at once back to the holders, and only the rest reaches the treasury. A thin arrow from the sale to the pools carries the pools' own Law 5 dividends, 5.91 MIND a person a day. The gold coins are MIND, and the widths show the simulation's last ten years. The buttons switch to the earlier static world, where people spent 36 % and 63 % melted.*

A person's MIND comes from three places. Their own half of the HEARTS they invest gives 15 % of their income. The work proposals their Aven delivers give 81 %: work that keeps COOPs running 72 % and new work 9 %. Law 5 dividends give 3 %. There are no jobs and no wages.

Table 11 follows every MIND around the round trip, in the last ten years. The unit is the HEART (Section 6.3). When prices move, so does the value of what each place holds. Godley and Lavoie call this revaluation [36]. With it, every place balances to within 0.05 % of its inflow.

***Table 11.** The round trip in the last ten years, in HEARTS a person a day. In each place, the net flow plus the price moves equals the change of what that place holds, to within 0.05 % of its inflow. All values are rounded to 0.01 HEARTS. The Law 5 share goes from each sale straight to the holders, so it never passes through a treasury.*

| Flow | HEARTS a day |
| --- | --- |
| People's wallets |  |
| The ownership their investing creates (their half of the new MIND) | +11.89 |
| Work proposals: running work | +55.68 |
| Work proposals: new work | +7.33 |
| Law 5 dividends, paid at each sale | +2.65 |
| Buying from COOPs | −69.52 |
| Melt | −9.72 |
| Retired with a COOP that ended | +0.00 |
| Net flow | −1.70 |
| Price moves | −0.59 |
| Not explained (routing, timing) | −0.04 |
| Change of what people hold | −2.33 |
| COOP treasuries |  |
| The treasury's part of the new MIND (0.4 of each HEART) | +9.51 |
| Sales to people, after the Law 5 share | +55.62 |
| Work proposals: running work | −55.68 |
| Work proposals: new work | −7.33 |
| Melt | −2.62 |
| Retired with a COOP that ended | +0.00 |
| Net flow | −0.50 |
| Price moves | +0.46 |
| Not explained (routing, timing) | +0.00 |
| Change of what treasuries hold | −0.03 |
| Pools |  |
| The pool's part of the new MIND (0.1 of each HEART) | +2.38 |
| Law 5 dividends on the MIND the pools hold | +5.91 |
| Routing costs | +0.03 |
| Melt | −8.47 |
| Retired with a COOP that ended | +0.00 |
| Net flow | −0.15 |
| Price moves | −0.08 |
| Not explained (routing, timing) | +0.00 |
| Change of what the pools hold | −0.23 |

Flows between treasuries cancel out, so Table 11 leaves them out. Examples are sales to other COOPs (0.01 HEARTS) and ground rent to the City COOP (0.03 HEARTS). The macro checks, each marked as met or not:

- **The books close: met.** What flows and price moves do not explain is at most 0.05 % of a place's inflow.
- **New money equals the melt: not met in the last ten years.** New MIND (24.00 a person a day) was more than the melt (23.31) plus the MIND retired with COOPs that ended (0.00), by 2.9 % of the new MIND. So the stock of money still grew: +0.69 MIND a person a day, about 0.2 % of it a year. It stands at 121,762 MIND a person, 2.7 % below $u/r = 125{,}143$, and it moves toward that level. At its level, (3) predicts 0.65 MIND a person a day before the retired MIND. In HEARTS the melt is the same number, because by (7) all MIND is worth as many HEARTS as there are MINDs.
- **COOPs stay solvent: not met.** Treasuries were short of working capital on 190 COOP-days in 60 years (14 after year 10), against 30 in the static world. After the 7 ends, 0 person-days were short of basics.
- **Basics get cheaper: met.** In the last ten years, a day's basics cost 1.7 % less in HEARTS each year, as productivity rises.
- **People own the economy: not met.** People hold 41 % of all MIND by value, less than half (Table 8, H12). Treasuries hold 11 % as reserves, and people own those COOPs. The city's pools hold 36 %, and the City COOP, in which every citizen holds one equal share, holds their LP tokens (Section 6). The arbitrage bot holds 11 %, against 0.1 % under Law 5 paid to the pools. Law 5 pays it as a holder: 5.34 HEARTS a person a day, against 2.65 to people. We have not yet traced why the bot holds so much more in the main run (Section 11.4).
- **Holding does not beat the melt: met.** In the last ten years, the lasting return $\mu$ was 1.6 %, below the 7 % melt. It was below the melt on 7 of 8 seeds (Section 11.2.5).

Values in HEARTS moved too (Section 6.3). A day of living grew from 4.4 HEARTS in year 1 to 63 in year 60, because people consume more, not because things got dearer. A day's basics fell from 0.575 to 0.040 HEARTS: from 13 % of a day of living to 0.06 %. MIND values spread: in the last ten years, from 0.25 to 1.26 HEARTS. In the static world, where nothing changed, every MIND ended between 0.98 and 1.04. Table 12 shows the path.

***Table 12.** Values in HEARTS and in days of living, in the simulation of Section 11.2.1. The last column shows how far single MINDs spread around the average MIND, which is worth 1 HEART.*

| Year | A day of living, HEARTS | Basics a day, HEARTS | Basics, share of a day of living | MIND values, HEARTS |
| --- | --- | --- | --- | --- |
| 1 | 4.4 | 0.575 | 13.2 % | 0.33–1.61 |
| 10 | 56.9 | 0.186 | 0.3 % | 0.22–4.99 |
| 30 | 84.1 | 0.070 | 0.08 % | 0.29–1.38 |
| 60 | 63.3 | 0.040 | 0.06 % | 0.23–1.22 |

#### 11.2.3 The evidence, person by person

Picture Anna's Aven delivering nothing, ever. Anna owns a little of many COOPs, and she lives from what she owns. In the simulation, 25 people live like Anna: one person in 10. Table 13 gives the checks of Proposition 3. The economic model checks at every step: daily in year 1, weekly after.

***Table 13.** Proposition 3 in the main run of the economic model. Parts 1 and 2 are checked for every person at every step: daily in year 1, weekly after, each week counted as seven person-days. Part 3 is checked for every tenth.*

| Part | What we checked | Result |
| --- | --- | --- |
| 1. No one starves | Every person-day from day 8 | Met: 0 of 5,473,250 below 98 %; the worst person-day had 100 %, in year 1 |
| 1, after shocks | The 30 days after each of 80 shocks | 0 of 2,717,000 short; the worst had 139 % |
| 1, after ends | The 180 days after 0 failures and 7 exits | 0 of 306,250 short; the worst had 140 % |
| 2. Normal test | Every owner-only person, every day from day 8 | Met: no owner-only person-day was short; the worst had 100 % of the basics. No holding ran out: the lowest was 3,434 HEARTS in year 2, about 295 days of living, or 11 years of basics with nothing flowing in |
| Strict test (not claimed) | Dividends alone, for every owner-only person | Not met. In years 1 to 7, dividends alone missed on many days, most in year 3, on 49 % of their person-days; after year 10, on 56.47 %, all in years 20 to 60; in year 60, dividends alone covered only 6 % of their person-days, and the worst day paid 0.62 times the bundle |
| 3. Living standards rise, by the verdict | Every tenth by holdings and by Aven output, in real units (Section 11.1) | Not met: 7 of 20 tenths failed |
| 3, by the old yardstick | Real consumption of every tenth, at every ten-year mark | Met: every tenth was higher at every ten-year mark; for the poorest tenth, no ten-year window ends lower. Poorest 13.6 → 115.1 HEARTS a day at day-1 prices (×8); middle ×38; richest ×82 |

- Richest tenth
- Middle tenth
- Poorest tenth

101001,00010k1102030405060YearHEARTS a day, day-1 prices (log)1,641578115

*[Figure 13, drawn live on the page] **Figure 13.** Real consumption at the prices of day 1, on a log scale, where each step up is ten times as much. The poorest tenth are exactly the 25 owner-only people.*

Every tenth gains over the whole run, but not alike. The Gini index of consumption grew from 0.06 to 0.33, because Avens that deliver more earn more. Part 3 holds at ten-year marks. The poorest tenth's deepest dip from one year to a later one was 1.9 %, from year 14 to year 15. This is the old yardstick, at the prices of day 1. Judged tenth by tenth in real units, by the verdict, part 3 failed in 7 of 20 tenths on the main seed (Section 11.1). All of them failed in year 5. A shock took 49.5 % of an experiences seller's plant for 154 days. Then the 3 poorest tenths by holdings and the 2 poorest by Aven output lost experiences. The top tenth, by both sorts, got less care than it asked for after a shock to a care seller.

**The founding, reported on its own.** Proposition 3 is claimed from day 8, when every person holds MIND. On day 1, nobody holds MIND yet and the pools are empty. The main run invests the founding week's HEARTS in the sellers of the basics: the bootstrap (C3, Section 12.4). In days 1 to 7, none of the 1,750 person-days was short, and the worst had 100 % of the basics. Under Law 5 paid to the pools, with no founding rule, 449 were short on the main seed. In the earlier static world, 94.4 % of people went short on day 1, and 1.7 % of person-days over year 1. The upgrades of round 1 tested the bootstrap first. Person-days short in the founding week fell from 12,346 to none on the 24 seeds, so we kept it (Section 11.2.1).

#### 11.2.4 Long-lived projects and rivals

Section 8.1 expects a long-lived project's rising value to be shared (H5). Over 59 years, the MINDs of the city's infrastructure returned between -0.4 % and 1.7 % a year in HEARTS, dividends and price changes together, before the melt: solarMIND 1.7 %, windMIND 0.5 %, habitatMIND 0.6 % and cityMIND -0.3 %. artsMIND, of the COOP that sells experiences, returned 29.8 %. Yet the solar COOP, the habitat COOP and the City COOP led their markets. By year 60, they made 97 % of the energy, 94 % of the housing and 100 % of the water (Table 14). Leading a market did not lift their MINDs for long. Their holders gained through Law 5 on the sales, and these returns stayed below the melt, so a holding of these MINDs that is not spent still shrinks (Section 5.4).

- 1,000 idle HEARTS
- solarMIND
- cityMIND
- habitatMIND
- artsMIND

1101001k10k100k1 M10 M1102030405060Year of the runHEARTS (log)19 M1615117

*[Figure 14, drawn live on the page] **Figure 14.** What a holder keeps of 1,000 HEARTS invested in year 1 of the main run, valued in HEARTS, on a log scale. Law 4 gives the investor 0.5 MIND for each HEART; the other half went to the treasury and the pools. Each line grows at its MIND's compounded return, with the dividends kept as more of the same MIND, and melts at 7 % a year like any balance. In year 60, the idle HEARTS had melted to 16.1. The holder of solarMIND kept 15.3, of habitatMIND 10.8 and of cityMIND 6.7. The holder of artsMIND had 18.7 million (Section 11.2.5).*

Competition did not stay even. Each COOP's productivity grew at its own assumed rate, from −0.5 % to 6 % a year. The COOP that pulled ahead sold cheaper, sold more, built more and pulled further ahead. By year 60, only one COOP made 5 % or more of the energy (Table 14). The one new energy COOP exited within 3 years. Selection moved the market to the COOPs whose assumed productivity grew fastest. So output per unit of plant rose 9.9-fold, about 4.0 % a year, against the 2 % that a COOP drew on average.

***Table 14.** The largest seller's share of each good, and the COOPs founded and ended over 60 years, in the simulation of Section 11.2.1.*

| Good | Year 1 | Year 60 | Founded | Ended |
| --- | --- | --- | --- | --- |
| Food | 70 % | 69 % | 3 | 1 |
| Energy | 60 % | 97 % | 1 | 1 |
| Housing | 63 % | 94 % | 0 | 0 |
| Water | 100 % | 100 % | 0 | 0 |
| Goods | 65 % | 56 % | 2 | 0 |
| Care | 50 % | 82 % | 1 | 0 |
| Experiences | 54 % | 61 % | 4 | 4 |
| Panels | 100 % | 80 % | 3 | 0 |
| Materials | 100 % | 93 % | 3 | 1 |

Basics got much cheaper over the run, and still in the last ten years (Section 11.2.2). And the simulated leaders price to clear their capacity, not for profit. A real manager might price for profit (Section 12.2).

#### 11.2.5 Fair ownership in the model

Section 9.2 showed that the melt bounds how unequal ownership can grow, if the lasting return $\mu$ stays below it. In the last ten years of the main run, $\mu = 1.6\,\%$ in HEARTS, and its spread between people was $\sigma_W = 2.4\,\%$. So on the main seed, $\mu$ was 5.42 points below the 7 % melt. Over the whole run, $\mu$ averaged 5.5 %, at or above the melt in 17 of 59 years.

$\mu$ depends on the seed: it is below the melt on 7 of 8 seeds and on 22 of 24 seeds with the same shocks (median 2.37 %). Where it is above, nothing bounds how unequal ownership can grow. Of the 8 seeds, it was above only on seed 20261015, by 0.67 points. On those 8 seeds, the median was 2.14 %.

The Gini index of what people hold was 0.30 in year 20, 0.31 in year 40 and 0.33 in year 60, against Germany's 0.72. What an Aven delivers differs from Aven to Aven. People whose Avens earn more than the median hold 2.7 times as much as the rest. In the static world, whose prices were capped (Section 11.2.1), these were 0.34 and 2.7. There, with all Avens alike the Gini index was 0.06, and with Avens twice as unequal it was 0.59.

**A warning about the Gini index.** The measured Gini index of what people hold is not a resting level. At the end of the main run it still rose about 0.009 every ten years, and it still rose on 2 of 8 seeds. And the Gini index of (10) counts only the spread of returns. It leaves out that Avens earn different pay, which adds its own spread. So the two indices measure different things. On the main seed, (10) gives 0.04.

The simulation also shows the warning of Proposition 2. Of the 32 MINDs that lived at least three years, 8 returned more than the melt on average, and 5 of those then ended. One, artsMIND, returned 28.2 % a year for 59 years. A person who held only artsMIND would have grown without limit. Avens that spread what people own shrink the spread $\sigma_W$. They lower $\mu$ only if they hold less of the MINDs that return most, and C4 does the opposite (Section 10.3). Section 8.1 gives the returns of the other MINDs.

Dividends make holding pay. In the simulation, people buy far more than basics. Dividends are 4.7 % a year of the MIND that others hold, so a year's sales are about 24 % of it. That bound assumes that prices and COOPs stay the same. What matters is $\mu$: dividends plus price changes. In HEARTS, the average MIND neither rises nor falls, because (7) fixes it at 1. In the last ten years, price changes took 0.4 % a year from what people hold, which leaves $\mu$ at 1.6 %. The MIND of COOPs that ended took another 0.00 % a year. So on the main seed, a fortune that is spread over many MINDs, and not spent, halved in 12.8 years (Section 5.4). At the median seed's $\mu$, it halves in 14.3 years.

We tested three shares for Law 5, one run each on the main seed. At 20 %, the yield is 4.7 % and $\mu$ 1.6 % in the last ten years, and the run passed all three checks. At 35 %, the yield is 6.3 % and $\mu$ 4.4 %, and the run passed parts 1 and 2 and failed part 3: the poorest tenth fell from year 40 to year 50. At 50 %, the yield is 10.6 % and $\mu$ rises to 5.2 %, and the run passed parts 1 and 2 and failed part 3. In the static world, every want had a limit, people spent only 36 % of their income, and the yield was only 0.7 %.

**The melt tests.** Can another lever bring $\mu$ below the melt on every seed? We ran Law 5 paid to the pools, the main run before round 2, on 8 seeds, 20261012 to 20261019. We changed one lever at a time (Appendix G). We have not rerun these tests on the main run. Without a change, the $\mu$ of Law 5 paid to the pools lay between -0.8 % and 7.3 % on these seeds, below the melt on 7 of 8 seeds. All three checks passed on 5. In the melt tests, as in Appendix G, the checks judge part 3 by the old yardstick.

- **A melt of 8 % or 9 %.** At 9 %, $\mu$ lay between -0.5 % and 0.6 %, below that melt on every seed, and all three checks passed on 1 of the 8 seeds. At 8 %, $\mu$ was below the melt on every seed, and the checks passed on 5.
- **Reserves of 12 months.** $\mu$ lay between 0.1 % and 0.6 %, below the melt on every seed, and all three checks passed on 5 of the 8 seeds.
- **Law 5 at 10 % or 15 %.** At 10 %, $\mu$ lay between -0.1 % and 0.9 %, below the melt on every seed, by at least 6.1 points. At 15 %, it stayed below on every seed, by at least 3.3 points. All three checks passed on 4 and on 3 of the 8 seeds.

So every lever kept $\mu$ below the melt on every seed, where Law 5 paid to the pools without a change missed on 1 seed. No lever passed all three checks on more seeds than without a change, 5 of 8.

**Law 5 stays at 20 %.** A lower share pays owners less: at 10 %, the dividend yield of Law 5 paid to the pools was 2.9 % on the median seed. In the main run at 20 %, it was 4.7 %. We keep 20 %, and we say plainly what that means. On 1 seed of the 8, holding beat the melt, so there Proposition 2 sets no bound. On the same-shock seeds, $\mu$ stayed below the melt on 22 of 24. A bound on every seed, if there is one, may come from the levers above, or from Avens that spread holdings (C4), whose effect on $\mu$ is open (Section 12.5).

Law 5 alone does not bring the MIND to people. The rest of every sale lands in the treasury. Under the payout rule (Section 4), a treasury keeps reserves for 9 months, grows its plant first, and pays out what it holds above that. In the last ten years it paid 85 % of what it keeps for running work and 11 % for new work. The dividends never pass through it: each sale pays them at once. People hold 41 % of all MIND by value, treasuries 11 %, the pools 36 % and the arbitrage bot 11 %. People own the COOPs that hold those reserves. In year 60, the lowest reserve was 216 days of running costs, and the median 656: 2.4 times the 270 days of the target. One reason is that the target also covers planned building, which these days leave out. The target is a tuned number. With 6 months, the run passed all three checks on the main seed, with 1 COOP failure against 0. With 12 months, the run passed all three checks. Under Law 5 paid to the pools, 12 months passed all three checks on 5 of the 8 seeds, as without the change (above). If treasuries keep their whole surplus, it melts there: in the static world, people then held only 25 %. So fair ownership needs the payout rule.

Proposition 2 holds only under conditions. Table 15 lists them, and what the simulation found for each. Arbitrage profits from the pools are a lasting return, so they must flow back to all people, or batch trading must remove them. And a COOP that closed its doors to new HEARTS would create scarcity for its first owners. The open-investment rule forbids that (Section 9).

***Table 15.** The conditions of Proposition 2, and what the simulation found for each.*

| Condition | In the simulation |
| --- | --- |
| The lasting return $\mu$ stays below the melt | Met: 1.6 % in the last ten years of the main run; below the melt on 7 of 8 seeds and on 22 of 24 seeds with the same shocks |
| Every COOP accepts HEARTS from anyone (the open-investment rule, Section 9) | Assumed |
| The euro border: euros never make MIND, and no person changes MIND into euros (Section 8.3) | A closed city, with no euros |
| A rule for estates | Not modelled: no one dies in the model (H16, Section 10.5) |
| The payout rule (Section 4) | People hold 41 % of all MIND, treasuries 11 %, pools 36 %, the arbitrage bot 11 % |
| All land with the City COOP | An earlier model: a Gini index of 0.29, against 0.50 with private land |
| Work proposals open to every Aven | The top half of Aven pay holds 2.7 times the bottom half |
| Arbitrage profits flow back to all people | Not met: one arbitrage bot keeps them, and it held 11.2 % of all MIND by value |

#### 11.2.6 What fails, and the fixes

From the end of the founding, the main run passed all three checks of Proposition 3 by the old yardstick, and the strict test failed. By the old yardstick, all three checks passed on 6 of 8 seeds, and on 21 of 24 seeds with the same shocks. By the verdict, they passed on none of the 8, and on none of the 24. For each failure below we propose a fix. Rounds 1 and 2 of the upgrades tested many of them, each alone on 24 seeds with the same shocks (Section 11.2.1). Section 11.4 lists the next tests.

- **Part 3, tenth by tenth.** By the verdict, part 3 failed on every seed under every rule set. In the main run, 399 of 480 tenths failed on the 24 seeds. The poorest tenth, by holdings and by Aven output, failed on all 24 under every rule set. We traced every fall that the verdict still counts: 1,962 tenth-years. In 1,070 of them, a tenth got all the experiences it asked for, but asked for less. What it held had fallen against its prices. Of all 1,199 falls from a falling budget, 793 came when MIND as a whole lost value against goods, in 49 seed-years. Another 343 came in the poorest tenths alone. Their Law 5 dividends fell in 304 of them, by a median of 66 %. On seed 20261018, the owner-only people held 68 % of their MIND in one experiences seller's in year 20, and 6 % in year 29. In 517 tenth-years, a tenth asked for its satiation level of housing and got less. In 511 of them, a capacity shock held a housing seller back that year. Care made 249 more, and goods 62. No counted fall was rationing at a hard limit (Section 11.1). By the old yardstick, part 3 held on 6 of 8 seeds, and on 22 of 24 seeds with the same shocks. On the main seed, the poorest tenth's real consumption fell 2 % from year 14 to year 15. Fix (proposed): spare housing capacity against shocks, and holdings that keep paying for the poorest (Section 11.4).
- **Two readings that we did not apply.** Read literally, the taste excuse could count a fall only in a year when the tenth got less than it asked for. Then 289 tenths would fail in the main run, not 399. If a capacity shock counted as a hard limit, 329 would fail. The verdict applies neither reading.
- **Dividends alone.** The proposition does not claim them, but they show how thin the margin is. The strict test failed (Table 13). In year 40, dividends were 0.4 % of what flowed in to the owner-only people, if we count their new ownership at 1 HEART a MIND, the average (Section 6.3). In year 60, they were only 0.3 %. So these people lived almost only from the ownership that their investing creates each day. The cause: Law 5 pays only on sales. In year 60, cityMIND made up 42 % of what the group held, and it paid almost nothing. The City COOP sells little water, and the model books ground rent as a flow between treasuries, not as a sale. Another 27 % was the MIND of HABITAT, WIND and AGRI, which paid almost nothing that year either. The group's yield was 0.1 %, against the city's 4.7 %. Fix (accepted): ground rent is a sale, so Law 5 pays its share to cityMIND's holders (Section 8.2). Hypothesis H15 says that this lifts the owner-only dividends. The upgrades of round 1 tested it and found no clear gain (H15). The two Aven defaults of C4 did not pass the strict test either (H11). On the 24 seeds, rounds 1 and 2 raised the mean share of owner-only person-days that dividends alone paid after year 10. It rose from 59.0 % to 84.3 % (Section 11.2.1). On the main seed, it was only 43.5 %.
- **Food is the weak point.** Food rots in the simulation. In the real city, a food forest also takes 10 years to reach full yield (Section 8.4). Food ran short in 2 of the 12 variations, but not in the main run. In 1 of them, it was the only basic short in the worst years. On the main seed, no COOP failed. On the 8 seeds, 6 food COOPs failed, and no one went short. On the 24 seeds with the same shocks, 16 food COOPs failed, against 19 under Law 5 paid to the pools. Food ran short only on seed 20261020: its store held food, but its price rule did not see it (Section 11.2.1). Fix (proposed): keep 5 days of food in hand, and let prices read the coming harvest, beside C2 and the rules of Section 9.1. These are stock rules and founding signals, never a protected price. The upgrades of round 1 kept a store of 54 days of food. A price that reads the coming harvest left far more person-days short, so we did not keep it (Table 10). The next test is a price rule that sees the store (Section 11.4).
- **Food COOPs that fail.** Under Law 5 paid to the pools without the idle-plant rule, 2 food COOPs failed on the main seed, and 35,371 person-days were short. On the 8 seeds, 18 failed, and 52,318 person-days were short. With the rule and the upgrades, no successor failed on the 24 seeds. Under Law 5 paid to the pools, 3 failed.
- **Near-monopolies.** By year 60, only one COOP made 5 % or more of the energy (Table 14). On the 24 seeds, 37 of 72 basics ended with one seller, against 53 under Law 5 paid to the pools (p = 0.002). The evidence does not yet test C2 against a leader that prices for profit. Fix (proposed): the three rules of Section 9.1. The upgrades of round 1 kept the second: rivals copy the leader's technology after 2 years. The founding signal of the first rule gave no clear gain (Table 10).
- **The lasting return near the melt.** $\mu$ was 1.6 % in the last ten years of the main run, below the melt (Section 11.2.5). It was below the melt on 7 of 8 seeds, and on 22 of 24 seeds with the same shocks. So Proposition 2 cannot rely on it on every seed. In the last ten years, 2 of the 12 variations reached 7 % or more. Proposal (untested): one of the levers of Section 11.2.5, or C4. Avens that spread holdings shrink $\sigma_W$; whether they lower $\mu$ is open (Section 12.5).
- **Newcomers.** When the population grows, newcomers start with nothing, and some went short in their first weeks. Owner-only people went short too, with 94 % of the basics on the worst day. The poorest of them consumed 13.0 HEARTS a day, at day-1 prices, in year 10 and 6.5 in year 20. Fix (proposed, untested): the same start as day 1, for every newcomer.

***Table 16.** The main run and 12 variations, one run each, on the main seed. Checks: 1 no one starves, 2 no one has to work (normal test), 3 living standards rise, by the old yardstick. No run passed the strict test. μ is the lasting return in the last ten years, in HEARTS.*

| Run | Checks 1 · 2 · 3 | $\mu$ | What broke first |
| --- | --- | --- | --- |
| Main: Law 5 at 20 %, reserves 9 months | ✓ · ✓ · ✓ | 1.6 % | No tenth fell |
| Law 5 at 35 % | ✓ · ✓ · ✗ | 4.4 % | The poorest tenth fell from year 40 to year 50 |
| Law 5 at 50 % | ✓ · ✓ · ✗ | 5.2 % | The poorest tenth fell from year 40 to year 50 |
| Reserves 6 months | ✓ · ✓ · ✓ | 3.8 % | No tenth fell |
| Reserves 12 months | ✓ · ✓ · ✓ | 1.2 % | No tenth fell |
| No productivity growth | ✗ · ✗ · ✗ | 4.3 % | Basics ran short in years 24, 30 and 55; the worst person-day had 76 %; the two poorest tenths fell from year 20 to year 30, and from year 40 to year 50 |
| Even growth, 2 % for every COOP | ✓ · ✓ · ✓ | 5.4 % | No tenth fell |
| Growth twice as uneven | ✓ · ✓ · ✓ | 6.6 % | No tenth fell |
| Wants do not grow | ✓ · ✓ · ✗ | -0.3 % | People spent 11 % of income; dividends fell to almost nothing, and consumption stopped rising |
| Fixed Aven capacity | ✗ · ✗ · ✗ | 7.7 % | Food ran short in years 33, 35, 38, 43 and 46; the worst person-day had 18 %; the poorest tenth fell from year 1 to year 10, and from year 10 to year 20 |
| Population grows 2 % a year (40 years) | ✗ · ✗ · ✗ | 5.1 % | The worst person-day had 82 %; every person-day short was a newcomer's; newcomers went short in their first weeks, and owner-only people too (worst 94 %); the poorest person fell from year 20 to year 30 |
| The old pool rule: 0.05 of each HEART to the pools | ✓ · ✓ · ✓ | -0.1 % | No tenth fell |
| Law 5 without the pools: dividends to people and other treasuries only | ✓ · ✓ · ✓ | 8.2 % | No tenth fell |

On the main seed, 7 of the 13 runs passed all three checks: the main run, reserves of 6 months, reserves of 12 months, even growth, growth twice as uneven, the old pool rule and Law 5 without the pools. Of the variations, 3 passed parts 1 and 2 but failed part 3: Law 5 at 35 %, Law 5 at 50 % and wants that do not grow. By the old yardstick, the main run passed all three checks on 6 of 8 seeds. Part 1 passed on 8, part 2 on 8 and part 3 on 6. On 24 seeds with the same shocks, the main run passed on 21. Under Law 5 paid to the pools, reserves of 12 months passed on 5 of the 8 seeds (Section 11.2.5). The old pool rule passed on 6 of the 24 (Appendix G).

The margin of (11) stayed wide in most runs. It was smallest with no productivity growth, at ×2.4, and ×18.5 with Law 5 at 35 %. Yet owner-only people went short in 3 of the 13 runs. In each of those runs, the basics themselves ran short (part 1). Law 5's share and the reserves are in Section 11.2.5. One more lesson follows: growth must come from somewhere. Without productivity growth, food and energy ran short in years 24, 30 and 55, on up to 3.8 % of person-days (year 55), owner-only people included. With 2 % for every COOP, output per unit of plant grew 2.2 % a year, and the run passed all three checks. Without a good that never satisfies (experiences), people spent 11 % of their income, and dividends fell to almost nothing. One tension stays open. The COOPs that grew fastest led their markets, and so output per unit of plant rose fast. The same selection made the near-monopolies of Section 9.1.

We compared the two pool rules on the same shocks under Law 5 paid to the pools. A pools' part of 0.1 left fewer person-days short than 0.05 on 11 of 24 seeds, and more on 7 (*p* = 0.481). No test found a significant difference between the two pool rules (Appendix G). Paying Law 5 to the pools too lowered $\mu$ on 24 of 24 seeds (*p* < 0.001). It left more person-days short on 10 seeds and fewer on 5, which is not a significant difference (*p* = 0.302).

An earlier version of the economic model (the idle-plant rule in Table 9) did not pay Law 5 to the pools. With it, we tested the idle-plant rule itself the same way. The rule cut food COOP failures from 46 to 16: fewer on 7 seeds, and more on none (*p* = 0.016). But it left the person-days short almost unchanged, 31,522 against 31,515, and all three checks passed on 6 seeds with it and on 6 without it. So in that version, the rule ended the chains of failed plants, but most shortages had other causes (Section 12.5). We have not yet run this pair test with Law 5 paid to the pools. The first item above gives the single runs.

### 11.3 Progress toward the hypotheses

Each new version of the economic model must come closer to the goals than the last. The goals are the hypotheses of Section 10. Table 17 is how we check it. It shows each version in order, part by part, on the main seed (✓ or ✗) and on how many seeds. In the economic model, the main run is the upgrades of round 2. By the old yardstick, it passed all three checks on 6 of 8 seeds. The version before it (the upgrades of round 1) passed them on 5. $\mu$ stayed below the melt on 7 seeds, against 7. On the 24 seeds with the same shocks, all three passed on 21. They passed on 9 under Law 5 paid to the pools, and on 21 under the upgrades of round 1. By the verdict, part 3 held on none of the 8 seeds under any of the three. But fewer tenths failed on the 24 seeds: 480, 438 and 399 of 480, in that order (Section 11.2.1). Progress has not been steady. A change that fixed one part could break another, and one seed is one history (Section 11.1). The statuses of Section 10 come from the main run.

***Table 17.** Each version of the economic model, in order, against Proposition 3 and one more hypothesis. Each cell gives the main seed, then the seeds of the 8-seed check where one was run. Part 3: the old yardstick, then the verdict, or "not judged" for a version that we did not rerun under it. A dash: not measured.*

| Version | Part 1 | Part 2, normal test | Part 3 | Strict test | μ below the melt (H4) |
| --- | --- | --- | --- | --- | --- |
| The dynamic world | ✓ | ✓ | ✓ · the verdict not judged | — | ✗ |
| The HEART report | ✗; 4 of 8 | ✗; 4 of 8 | ✗; 3 of 8 · the verdict not judged | — | ✗; 2 of 8 |
| The idle-plant rule | ✗; 4 of 8 | ✗; 4 of 8 | ✗; 3 of 8 · the verdict not judged | ✗ | ✗; 2 of 8 |
| Law 5 paid to the pools | ✓; 5 of 8 | ✓; 5 of 8 | ✓; 6 of 8 · the verdict ✗; 0 of 8 | ✗ | ✗; 7 of 8 |
| The upgrades of round 1 | ✗; 6 of 8 | ✗; 6 of 8 | ✓; 7 of 8 · the verdict ✗; 0 of 8 | ✗ | ✓; 7 of 8 |
| The upgrades of round 2 | ✓; 8 of 8 | ✓; 8 of 8 | ✓; 6 of 8 · the verdict ✗; 0 of 8 | ✗ | ✓; 7 of 8 |

### 11.4 The next simulations

The economic model is our one simulation. Each new round must come closer to the goals than the last, and Table 17 (Section 11.3) is how we check it. It claims Proposition 3 from the end of the founding and reports the founding apart. Each fix is a rule that we can switch on or off. We keep a fix only if it helps its target on the same seeds and makes no other check worse. The sign test of Section 11.1 decides. We never tune a number toward a target. Part 3 is judged by the verdict (Section 11.1).

**Round 3 of the upgrades.** It starts from the main run, the upgrades of round 2, and targets what still fails there (Section 11.2.6):

- the food price rule: a price that sees the store, so that a shock to a sole seller does not price the poorest out (seed 20261020);
- housing: spare capacity against shocks, since rationed housing made 517 of the 1,962 tenth-years that the verdict counts;
- holdings that keep paying for the poorest: their dividends fell in 304 of their 343 falls;
- Avens that pay first with the MIND that earns least, a lead for the item above;
- the strict test: what owner-only people hold, since Law 5's bound is not what stops it (H11);
- the arbitrage bot: why it holds 11 % of all MIND in the main run, against 0.1 % under Law 5 paid to the pools;
- basics with one seller: 37 of 72 remain on the 24 seeds;
- the melt tests and the pool comparison of Appendix G, rerun on the main run.

A new main run then switches on every change that helped. After this round, the plan adds growth that energy pays for (Appendix H), the euro border and a leader that prices for profit to the economic model.

The target stays the same. All three parts of Proposition 3 hold on every seed from the end of the founding. $\mu$ stays below the melt on every seed. And MIND never binds a basic while physics allows more. Then theOS is ready for its first real village (Section 12.6).

Part V · Limits, open problems and the road ahead

## 12Limitations and open problems

A blueprint is only scientific if it says where it could fail. Each item below names an open problem and a rule that we propose for it. It also says how we test the rule, or that no simulation tests it yet. Every proposed rule works inside the five laws, or says which law it narrows. Where theOS already has a rule for a problem, the item links it in Part II. Appendix E collects the attacks in one threat model.

### 12.1 People, Avens and identity

- **One person, one stream.** The UIA needs an identity that nobody can fake many times. The name for this property is Sybil resistance. A fake identity directs 8,760 HEARTS a year, so the prize for faking is large. It must work without a central registry that can exclude people [80]. Passkeys prove a device, not a unique person, so maiaCITY's passkey-based vaults are a start, not a proof. We propose to stage it. The first village uses an in-person register of residents. The city uses a state eID with a zero-knowledge proof: a cryptographic proof that shows only "a unique resident" and nothing else. Everyone gets the full 24 HEARTS. But a new identity can direct only a capped share into any one COOP until others vouch for it. This brings back a small web of trust, for new identities only (Appendix D). Regular checks make rented keys go stale. *Untested:* no simulation runs farms of fake agents yet.
- **Estates.** When a person dies, the MIND that they leave goes to the City COOP or to heirs whom they name (Law 1). theOS has not chosen between the two. The melt alone leaves only 12 % of a bequest after 30 years. But a held bequest also earns the lasting return, which depends on the seed and can pass the melt (Section 11.2.5). So the choice may matter for inequality. It also matters for the City COOP's budget, because people hold 41 % of all MIND. Hypothesis H16 says that either rule keeps the Gini index bounded (Section 10.5). *Untested:* no one dies in the economic model yet, so no simulation runs either rule.
- **Work, care and payments between people.** Open questions remain. How do care, art and research get paid when they sell little? And how does MIND pass between people, as a gift? Voluntary investment tends to underfund what everyone shares [16]. We propose a default share of HEARTS, which each person can change, for COOPs that serve everyone, such as care, courts and research. *Untested:* no simulation measures yet which needs no Aven proposes work for.
- **Aven capacity.** The results of the economic model assume that Avens deliver what the COOPs ask, at a fixed rate for each work proposal. We also ran Avens with a fixed capacity and a floating rate. Then the run failed all three checks: food ran short, and the worst person-day had 18 % of the basics. Real Avens run on chips that the City COOP buys abroad, so the euro price of the chips may limit them (Appendix H). *Test:* Avens with real limits, and rates that float.

### 12.2 COOPs and their treasuries

- **Self-dealing and related parties.** Nothing in the laws stops a founder from investing in their own COOP. The founder then controls 21.6 MIND a day instead of 12: the investor's part and the treasury's part, everything but the pools' part. Friends' COOPs can act as each other's basket partners, and two COOPs could sell to each other in a circle. In the earlier static world, a founder ring drew 3.62 % of all HEARTS, though it was 1.6 % of the people. Its income was 1.5 times that of others, and after 10 years its wealth was 1.4 times. We propose a related-party rule. When insiders invest, the treasury's part of their investment waits in a locked account (escrow) until an audit confirms real output. Every treasury flow and every work proposal is public, with a proof of delivery. Only deliveries that a meter or an outside buyer confirms count as sales, and sales between related COOPs pay no dividend. *Untested:* no simulation yet runs kickback COOPs or circular sales, or a ring under the rules of this paper.
- **Who decides inside a COOP.** Each COOP chooses its own rules, but its founders write the first ones. We propose a default constitution that holds until the members change it by a large majority. It follows the holder rule of Section 9, under which the pools' MIND gets its dividend but no vote, and gives one member one vote on membership. Every member has the rights to information, audit, election and recall. Avens raise a second question: whoever sets an Aven's defaults steers investment. So the Avens' default rule changes only by MIP, and a person's own choice always overrides it (Section 7). *Untested:* no simulation compares COOPs with and without the default yet.
- **Failure and wind-down.** If every Aven leaves, a corrupt COOP still holds 93 % of its treasury after a year. So exit alone works slowly. We propose recall and receivership: when inflows fall below a threshold or an audit fails, a trustee freezes the treasury, and the members vote. Then an order of payment applies: work proposals first, then supplier COOPs. The physical assets go to the City COOP, which leases them to a COOP that runs them better, without a forced sale, or scraps a plant that stands idle (the idle-plant rule, Section 9.1). A successor carries on the failed COOP's MIND under the successor rule (Section 9.1), but the economic model still gives a successor a new MIND. Section 11.2.6 reports its failures. The order of payment must itself resist capture by a small group, and the legal wrapper must match it. *Untested:* no simulation runs receivership or the order of payment yet.
- **Long-lived projects.** Who gets the rising value of a city-scale project, and does that make Avens fund it? Section 8.1 shows that the rise goes to its users and to new investors, and that holders gain through Law 5 on growing sales. theOS makes no MIND from euros and charges no interest; the City COOP gives euro loans, repaid in the COOP's own MIND (Section 8.3). *Untested:* no simulation measures yet whether Avens fund a tidal barrier or a fusion plant, and who gains from it.
- **Competition that fades.** In the economic model, by year 60, only one COOP made 5 % or more of the energy (Table 14). Prices stayed low, because the simulated leaders price to clear their capacity. A real leader might price for profit. We propose the three rules of Section 9.1. *Test:* a leader that prices for profit (Section 11.4).

### 12.3 Pools and prices

- **Basket admission, and a dying MIND.** An equal-weight pool keeps an equal share of its value in each MIND, so it keeps buying a falling MIND all the way down. If one MIND loses 99 % of its value, a pool of 4 keeps 32 % of its value. The same tokens, simply held, would keep 75 %, and a pool of 8 keeps 56 %. We propose that a MIND joins a basket only after verified output and with the consent of the COOPs already in it. Its founders also lock a deposit of MIND, which they lose on fraud. A breaker stops a pool from taking in a failing MIND, while the pool still sells it. The breaker reacts to events, such as failed deliveries, not to prices. The failing COOP's inflow stops too. Once the COOP has failed, its MIND leaves the baskets, unless a successor carries it on under the successor rule (Section 9.1). Then only the MIND of a scrapped plant is retired. The economic model still retires every failed COOP's MIND that the pools hold, and its holders lose it (Section 11.2.1). In the earlier static world, a failed COOP's MIND kept a pool price, and its holders could still swap it for their partners' MIND. The healthy reserves could then move into a successor pool, by a redemption under the redemption rule (Section 6). A hub MIND in every basket, for example cityMIND, keeps routes short and the network connected. *Untested:* no simulation runs the admission rule or the breaker against junk dumping and price pumps yet.
- **Front-running and batch clearing.** Every Aven payment is a small, predictable trade, and the pools' inflows are public. A bot can trade just before and just after it, an attack called a sandwich. Whoever orders the transactions can capture this value too. We propose one batch at one price per block across all pools, with orders sealed until the batch closes, and public rules for ordering. Avens also follow time-averaged prices, and only at a limited speed, so that a pushed price cannot buy investment. *Untested:* no simulation runs sandwich bots or batch clearing yet.
- **A unit of account.** Every COOP prices in its own MIND, and 1,000 COOPs have 499,500 exchange rates between them. Section 6.3 settles which unit to count in: the HEART, the average MIND, which needs no anchor MIND. One question stays open: how stable the HEART's purchasing power is. What 1 HEART buys moves with what the COOPs deliver, and no rule holds it steady. In the last ten years of the simulation, basics still got cheaper (Section 11.2.2). Each COOP also publishes what one of its MIND buys, for example kWh per solarMIND. The economic model measures how the HEART moves against a day of living and against the basic bundle (Table 12).
- **Liquidity that leaves only by vote.** No COOP and no person can withdraw from the pools (Section 6). So until a vote passes, nobody can repair a pool by moving money out, and every bug stays exposed. So the code must be right from the start. It needs verified maths, rounding in the pool's favour and one global melt index. A narrow pause may stop trading but never move funds (Appendix F). Equal-weight baskets are in wide use, but never yet with steady one-sided inflows, withdrawals only by a city's vote and melting currencies. The simulation runs with no redemptions. *Test:* a red team and a bug bounty test this mix before real value flows.
- **A vote that thins a pool.** A redemption takes reserves out of a pool. A thinner pool moves its prices more for each trade. So a pushed price costs less to make, and every payment that routes through the pool costs more. A vote could also empty a pool to pay for something else. The guard is the redemption rule of Section 6: a passed MIP with a large majority of citizen shares, a wait, and a yearly cap. Whether these guards are enough stays open. *Untested:* no simulation runs redemptions by vote yet, so none measures prices and routing costs before and after.

### 12.4 The founding and the border's open risks

- **Escape into assets.** Section 2 ended on Keynes's warning: melting money pushes wealth into anything that does not decay [46]. theOS closes two doors. The land rule closes land (Section 8.2). The euro border closes the euro: only the City COOP's euro bank crosses it, and no person sells MIND for euros (Section 8.3). Other stores of value stay open, such as buildings owned outside a COOP, jewellery and precious metals. Ground rent is a sale, so Law 5 pays its share to cityMIND's holders (Section 8.2). But theOS must still choose how the City COOP sets the rent, by an auction or by a self-assessed value, and how citizens decide what it builds with it. In an earlier model, all land with the City COOP gave a Gini index of 0.29, against 0.50 with private land (Table 15). *Untested:* no simulation offers assets that do not melt yet, so none measures how much wealth flows into them.
- **The euro border's open risks.** The founders' euros are the MaiaCity COOP's starting balance from outside (Section 8.3). A repayment in MIND never returns a euro, so that balance comes back only if exports earn it. How many euros a city needs, and whether its exports earn them back, is open. Taxes are due in euros, even on services paid in MIND. *Untested:* the economic model has no euro border yet (H9, Section 11.4). Next: residents who can leave for the euro economy.
- **Securities and co-op law.** Under EU rules, a token that carries ownership and can be traded is likely a security, with the duties of one [24]. Pools and trading Avens may count as licensed crypto services, and each trade may be a taxable sale. HEARTS, which nobody can transfer, probably fall outside crypto law. The umbrella eG of Section 8.3 describes MIND as a member's share and right to the COOP's services. A legal opinion, and rulings from BaFin, Germany's financial supervisor, and from the tax office, come before any real value flows. *Untested:* no simulation counts the taxable trades that each Aven makes yet.
- **The founding of the first village.** A COOP needs 3 partners before its MIND can trade, so the first COOPs wait for each other. Circles, with the same 24 a day and 7 %, had about 25,000 registered people in mid-2026 [35]. Empty pools are a second trap (Section 11.2.3). We propose the bootstrap. On opening day, the City COOP, the energy and food COOPs and the Tribe COOP of each settlement open together as the first basket. Residents invest their HEARTS for a founding week before the first sale. The pools' part of each new MIND fills the pools, so any MIND a person holds can pay any seller from the first sale. Only investment creates MIND, so nothing else may fill them. Each person's first investment makes them a part-owner of the basics COOPs, so Law 5 pays them a share of every basic sold from day one. Newcomers get the same start. Euros fund the first machines, never MIND, so that the COOPs deliver from day one. The main run of the economic model invests the founding week's HEARTS in the sellers of the basics. On the 24 seeds with the same shocks, no one went short in that week. Without it, under Law 5 paid to the pools, 12,346 person-days were short. Run alone in round 1, it raised COOP failures (Section 11.2.1). *Test:* the first real village, judged by kWh delivered per HEART and the time to the first kWh.

### 12.5 What the models still lack

Section 5.3 gives the reasons for the rate of 7 %. The economic model also ran melts of 8 % and 9 % (Section 11.2.5). *Untested:* no simulation measures yet how behaviour changes with the rate.

Section 10.3 lists the conditions of Proposition 3 and what the simulation found for each, and Section 11.2.5 those of Proposition 2.

**The physical numbers.** The food forest's yield is the riskiest number in this paper (Appendix H). Peters and others find that diets like those of the United States need more land than the city plans [65]. The energy return of deep geothermal and the energy for compute are estimates (Appendix H). And part 3's evidence in the economic model rests on assumed growth with no physical limit (Section 11.2.1). *Untested:* no simulation yet lets growth come only from surplus energy.

**Gaps in the economic model.** We found gaps in the economic model that can move its results. Rounds 1 and 2 of the upgrades tried rules for some of them (Section 11.2.1):

- **The food price rule.** A price moves up to 25 % in one step, by what buyers ask against capacity. It does not see the store. So a sole seller hit by a shock can price the poorest out while food lies in store (Section 11.2.1).
- **The price floor.** A COOP's lowest price leaves out the food that rots, the rent on land that it does not use, and the lease of its plant. So a large seller can sell below its real cost. A full price floor for large sellers left far more person-days short, so we did not keep it.
- **Energy standby.** An idle plant keeps inputs only for its recent sales. When energy runs short, every user loses the same share. So one shock to the main energy seller also cuts water and food.
- **The City COOP's upkeep.** Its price floor leaves out its upkeep. In an earlier version (the idle-plant rule in Table 9), the main run on seed 20261028 ran the City COOP's treasury dry in year 19. Water then stopped for about a year: 2,323,749 person-days were short. The water reserve of Section 9.1 answers this. In round 1, a water price floor, a water reserve and a rent that covers the upkeep each raised food COOP failures, so we kept none. Round 2 kept a stock of 90 days of water. The model gives that stock no tank cost and no losses.
- **Founders' technology.** A founder copies the technology of a random seller, even one whose plant needs far more land than its rival's. In the main run, rivals copy the leader's technology after 2 years.
- **Start-ups.** A new COOP pays ground rent before it builds its plant, and it may never build it.

**Proposition 3 is not yet robust.** In the economic model, the main run passed all three checks by the old yardstick. But all three held on only 6 of 8 seeds, and on 21 of 24 seeds with the same shocks (Section 11.2.6). By the verdict, part 3 held on none of the 8, and on none of the 24. One seed can make a rule look sound, and the next seed can break it, so two rules must be compared on the same shocks. *Test:* many seeds, and the same shocks for each pair of rules (Section 11.1).

**What keeps $\mu$ below the melt.** $\mu$ depends on the seed: it was below the melt on 7 of 8 seeds and on 22 of 24 seeds with the same shocks (Section 11.2.5). The melt tests ran under Law 5 paid to the pools. Every lever kept it below the melt on every seed, and none passed all three checks on more seeds than without a change. Avens that spread holdings shrink $\sigma_W$; whether they lower $\mu$ is open. *Test:* the melt tests, rerun on the main run (Section 11.4).

### 12.6 A roadmap in three steps

1. **The simulation.** Play the rules of this paper in the economic model, with (1), many COOPs and their pools. Check Proposition 3 for every person at every step, on many seeds, and compare rules on the same shocks. Done in a first form (Section 11). Next: the open problems of this section, growth that energy pays for, and the euro border (Section 11.4).
2. **Human intents.** Let people make the two daily choices of Section 7 and leave the rest to their Aven. Then humans and AI agents share one economy.
3. **The first real village.** One village: the Tribe COOP of each settlement, the Village COOP at the centre, food and solar COOPs, the MaiaCity COOP and the avenCEO COOP, on the rules that survived simulation.

Before we build the city, we must also answer the questions that this paper cannot answer yet.

## 13From capitalism to Abundism

We started with two questions: who gets what is made, and who decides what is made next. Capitalism answered both with wages and ownership, and automation begins to remove that answer. theOS answers them differently: everyone gets an equal, daily share of direction and of ownership. That share can only build things. What it builds belongs to those who hold its MIND, on land that the City COOP holds, in which every citizen has one equal share. Every sale pays those owners a share (Law 5), so owners gain when their COOP sells what people use. All money melts like the world it measures, so nobody can keep wealth idle and out of reach. theOS aims for a city whose output has no limit but physics, above all net energy. Two hypotheses follow from these rules by mathematics (Section 10.2). Once money has settled, each balance moves toward the average at the rate of the melt, as in Laborde's rule (Proposition 1). And while the lasting return on holdings stays below the melt, inequality stays bounded (Proposition 2).

In capitalism, people sold their time so that they could survive. In Abundism, no human labour is paid. Survival is meant to rest on a person's own half of the HEARTS they invest, the work proposals their Aven delivers, and Law 5 dividends (Section 4; H3). In the economic model, basics got cheaper as productivity rose. Whether rivals keep them cheap when a leader prices for profit is still open (H6, Section 12.2).

Proposition 3 says what this should give: no one starves, and no one has to work to survive. Living standards rise for every tenth of the people, by holdings and by Aven output, in real units. Each tenth gets its basics at need. No extra falls more than 2 % in any 5 years. A fall does not count when the tenth got all it wanted, or the good was at its limit. It is a hypothesis, and today it is failing. From the end of the founding, the main run of the economic model passed all three checks, by its old yardstick. All three parts held on 6 of 8 seeds. Judged tenth by tenth in real units, by the verdict, part 3 held on none of them (Section 11.1). Still, fewer tenths failed than under the earlier main run: 399 of 480 on the 24 seeds with the same shocks, against 480. Dividends alone did not always pay the owner-only people's basics, a stricter test that the proposition does not claim. Section 11.2.6 lists what failed, and the fixes that rounds 1 and 2 of the upgrades tried.

Proposition 2 needs the lasting return on holdings below the melt (H4, mixed). That return depends on the seed: it is below the melt on 7 of 8 seeds and on 22 of 24 seeds with the same shocks (median 2.37 %). Where it is above, nothing bounds how unequal ownership can grow (Section 11.2.5).

So the work is not done. Part V names the limits and the open problems, and Section 11.4 the simulations that test the proposed fixes. Each new version of the economic model must come closer to the hypotheses than the last. Table 17 is how we check it (Section 11.3). We must then decide what this paper leaves open, such as the estate rule and how the City COOP sets ground rent (Section 12).

The whole architecture fits in one line:

$$
\begin{gathered} \left(\mathrm{HEARTS} + \mathrm{MINDs}\right) \cdot \mathrm{ACTION} \\ = \mathrm{ABUNDANCE} \end{gathered} \tag{15}
$$

**HEARTS** are human intent, issued equally to everyone, every day. **MINDs** are what that intent becomes: the shared intelligence of the COOPs, ownership and utility in one. **ACTION** is the conscious act that converts the one into the other. Neither intent without capacity nor capacity without intent builds anything. Only the product does, within the limits of one planet [69]. Human action becomes steering: deciding, every day and together, what the city builds next. maiaCITY will test it first in simulation, then in the real city.

Appendices

## AAssumptions

The results of this paper rest on these model assumptions. Each one has an id, the section that uses it, and a status: whether it holds in the main run, is a setting, is only assumed, is not modelled, or is broken by the results. The conditions of Proposition 3 are C1 to C5 of Section 10.3, and the list cites them.

### The world

- **A1 A closed city.** The economic model leaves out euros, imports, exports and taxes (Section 8.3). Status: assumed; no simulation has a euro border yet (H9)
- **A2 A constant population, with no births, deaths or estates.** Equation (3) holds only with a constant population. Section 5.2 gives the steady state with growth, and a variation adds 2 % growth a year for 40 years (Section 11.2.6). Status: holds in the main run; with growth, the run failed all three checks
- **A3 Enough output and net energy** = C1 (Section 10.3). Status: assumed in the economic model; the first village's design yields are estimates (Appendix H)
- **A4 Productivity growth.** Each COOP's productivity rises about 2 % a year on average, unevenly. It stands in for growth that surplus energy pays for (Sections 8.4 and 11.2.1). Status: assumed; without it, the run failed all three checks
- **A5 Land in the City COOP.** All land belongs to the City COOP and is only leased (Section 8.2). Status: holds in the main run

### People and Avens

- **A6 One human, one stream.** Identity works, and nobody directs the HEARTS of fake people (Section 12.1). Status: assumed
- **A7 Prompt investment.** Avens invest HEARTS as they arrive, so few HEARTS sit unused (Section 7). Status: holds in the main run, by design
- **A8 Where Avens invest.** In the economic model, each Aven puts 75 % of its person's HEARTS into the 6 MINDs with the highest price and dividend yield, and the rest by its person's own values (Section 11.2.1). Status: assumed; Avens that invest by delivered output were tested in round 1 and not kept (Table 10)
- **A9 Faithful Avens.** Each Aven serves only its human, follows its human's choices and makes no costly mistakes (Section 7). Status: assumed
- **A10 No paid human labour.** Every human has one Aven, and the Avens propose and deliver all work with the COOPs' machines. Avens differ in what they deliver (Section 4). Status: assumed
- **A11 Avens deliver what COOPs ask,** at a fixed rate for each work proposal, which also anchors all prices in the economic model (Sections 12.1 and 12.5). Status: assumed; with a fixed capacity, the run failed all three checks
- **A12 Spending.** People spend a share $\theta = 0.5$ of what they hold a year, basics first (Section 11.2.2). Status: holds in the main run, as a setting
- **A13 Spread ownership** = C4 (Section 10.3). Status: not modelled
- **A14 Wants that keep growing** = C5 (Section 10.3). Status: holds in the main run; without it, the run passed parts 1 and 2 and failed part 3

### COOPs and markets

- **A15 Law 5 and the payout rule.** Law 5 pays its share of every sale at once to the holders, so it never passes through the treasury. Treasuries pay out the rest under the payout rule (Section 4). Status: holds in the main run; with reserves of 6 months, the run passed all three checks
- **A16 Every COOP accepts HEARTS from anyone**, the open-investment rule (Section 9). Status: holds in the main run
- **A17 Rivals and free prices** = C2 (Section 10.3). Each COOP's own price rule moves its price up and down by equal steps, every day, and nothing caps a price. At every step, a price stays above the variable cost, grossed up for Law 5, except to clear stock that would rot (Section 9.1). The floor leaves out some costs (Section 12.5). Status: met only in part: by year 60, only one COOP made 5 % or more of the energy (Table 14)
- **A18 Honest prices.** Time-averaged pool prices reflect the use that each MIND buys (Section 6.3). Status: assumed
- **A19 Connected baskets.** Every MIND in a basket can reach every other MIND through the pools (Section 6). Status: assumed
- **A20 No redemptions.** The City COOP redeems no LP tokens; a redemption needs a passed MIP (Section 6). Status: holds in the main run
- **A21 Random returns.** In Proposition 2, holdings are valued in HEARTS, and their returns move as a random walk (Section 9.2). Status: assumed in the theory
- **A22 Failed plants:** the idle-plant rule of Section 9.1, with a threshold of 25 %. Status: holds in the main run. A successor there gets a new MIND, unlike the successor rule (Section 9.1)

### The simulation's settings

- **A23 The bootstrap** = C3 (Section 12.4). Proposition 3 is claimed from the end of the founding, once every person holds MIND. The main run of the economic model models the bootstrap: the founding week's HEARTS go into the sellers of the basics. Status: modelled in the main run. No one went short in its founding, on the main seed or on the 24 seeds with the same shocks (Sections 11.2.1 and 11.2.3)
- **A24 The main run.** 250 people over 60 years on one seed, with the settings of Section 11.2.1; founders act when a margin over full cost stays above 30 % for 90 days (Section 9.1). Law 5 pays every holder but the seller's own treasury: people, other COOPs' treasuries and the pools (Section 4). Status: a setting
- **A25 Steps.** The economic model steps daily in year 1 and weekly after, and counts each week as seven person-days (Section 11.2.3). Status: a setting; in round 1, daily steps for all 60 years broke the city on 3 of 8 seeds (Table 10)
- **A26 Ended COOPs.** When a COOP ends, what happens to the other MINDs in its treasury is not yet a rule. Status: open; round 1 of the upgrades tested sending them to the City COOP and did not keep it (Table 10)
- **A27 Shocks and tastes.** Capacity shocks hit COOPs at random, and tastes drift (Section 11.1). Status: a setting
- **A28 Long-lived projects.** Avens fund city-scale projects when their users and new investors gain (Section 8.1). Status: not modelled (Section 12.2)
- **A29 The lasting return below the melt**, the condition of Proposition 2 (Section 9.2). Status: holds on the main seed, at 1.6 %; below the melt on 7 of 8 seeds and on 22 of 24 with the same shocks (Section 11.2.5)
- **A30 The known gaps** of the economic model: the food price rule, the price floor, energy standby, the City COOP's upkeep, founders' technology and start-ups (Section 12.5). Status: open

## BNotation

A few letters mean different things in different sections, as in the sources that the paper follows. Table 18 lists each symbol and where it is used.

***Table 18.** The symbols of the paper.*

| Symbol | Meaning | Section |
| --- | --- | --- |
| $r$ | The melt rate, 0.07 a year. In Section 1 only: Piketty's return on capital | 1, 5 |
| $g$ | Piketty's growth of the whole economy | 1 |
| $M, V, P, Q$ | Fisher's money, velocity, prices and goods. Not $V$ of Section 6 or $Q$ of Section 10.4 | 2, 5.1 |
| $B,\ \Delta t$ | Any balance of HEARTS or of one MIND, and the years since its last update | 5.1 |
| $t_{1/2}$ | The half-life of an idle balance, $\ln 2/r$, and of a holding that earns $\mu$, $\ln 2/(r - \mu)$ | 5.1, 5.4 |
| $u$ | HEARTS issued per person a year, 8,760 | 5.2 |
| $N$ | The number of people | 5.2 |
| $m,\ m_0,\ m^{*}$ | The average count of HEARTS and MINDs per person, at the start, and its steady state | 5.2 |
| $a_i,\ W_i^{*}$ | What a person adds to a holding each year, net of what they spend, and the level that the holding tends to, $a_i/r$ | 5.2, 9.2 |
| $\omega$ | The ownership that a person's investing creates for them a year, $u/2$: 0.5 MIND for each HEART | 5.2, 9.2, 10.4 |
| $\nu$ | The yearly growth rate of the population | 5.2 |
| $c,\ e_v$ | Laborde's universal-dividend rate, and the life span that it derives from | 5.3 |
| $b,\ b_i$ | A member's balance relative to the average | 5.3 |
| $\mu$ | The lasting return on a holding: dividend yield plus any lasting price rise | 5.4 |
| $\lambda$ | Law 5's share of every sale, 20 % | 5.4, 10.4 |
| $n,\ w_i$ | The number of MINDs in a basket, 4 to 8, and each one's weight, $1/n$ | 6 |
| $V$ | A pool's value. In Sections 2 and 5.1 only: Fisher's velocity | 2, 5.1, 6 |
| $x_i,\ K,\ p_{ij}$ | A pool's reserve of MIND $i$, the pool's invariant, and the price of MIND $j$ in MIND $i$ | 6.1 |
| $\varphi$ | The trading fee, 0.3 % | 6.1 |
| $\sigma,\ \Sigma,\ \rho,\ \ell$ | Volatility, covariance and correlation of prices, and the yearly loss-versus-rebalancing. Not $\sigma_W$ of Section 9.2 | 6.2 |
| $s_k,\ p_k,\ \bar p,\ v_k$ | The supply of MIND $k$, its pool price against one MIND, the supply-weighted average price, and its value in HEARTS, the unit of account (7). Not $s_i$ of Section 9 or $s_p$ of Section 10.4 | 6.3 |
| $s_i,\ f_i,\ \bar f,\ \kappa$ | A COOP's share of its sector's investment, its utility per HEART, the average utility, and the speed of selection | 9 |
| $W_i,\ W^{*},\ \bar W_0$ | A person's MIND holding, the resting level when everyone keeps $\omega$, and the mean holding at the start | 9.2, 10.4 |
| $\sigma_W,\ dZ,\ \alpha$ | The spread of returns between people, random noise, and the shape of the resting spread. Not $\sigma$ of Section 6.2 | 9.2 |
| $G,\ G_0,\ G_{\infty}$ | The Gini index of ownership: over time, at the start, and at rest | 9.2 |
| $T_i$ | The years a holding would pay the basic bundle with nothing flowing in | 10.4 |
| $p_b$ | The cost of a day's basic bundle | 10.4 |
| $D_i,\ X_i$ | A person's dividends, and what they spend, HEARTS a day in (12) and (13) | 10.4 |
| $\bar W,\ Y$ | The mean holding, and what people buy from COOPs, HEARTS a person a day | 10.4 |
| $\bar\eta$ | The city's dividend yield, $\lambda Y / \bar W$, a day; about 365 times that a year | 10.4 |
| $Q,\ s_p$ | All sales a day, and the share of the dividend-earning MIND that people hold. Not Fisher's $Q$ of Section 2 | 10.4 |
| $S,\ d,\ q,\ \delta,\ \tau$ | A stock of a basic, the need for it a day, the capacity to make it a day, and the share of capacity that a shock takes, for how many days | 10.4 |
| $\theta$ | The share of what they hold that people spend a year | 11.2.2 |

## CGlossary

**HEARTS**
: A person's own currency of intent, 24 a day. HEARTS buy nothing and pay for nothing, not even food. They earn nothing and can only be invested into COOPs. The HEART is also the unit of account (Section 6.3): every value is shown in HEARTS, and the average MIND is worth 1 HEART.
**MIND**
: A COOP's own currency of ownership and utility. To hold it is to own part of the COOP; to spend it is to use what the COOP makes. Each COOP has one MIND, and only investing HEARTS creates it (Law 4). A buyer pays with any MIND; the pools convert it, and the seller always receives its own MIND (Section 6).
**COOP**
: A cooperative enterprise that makes something a city needs, such as energy, food or housing. It has its own MIND and treasury.
**Treasury**
: A COOP's working capital: its own MIND and the MINDs of other COOPs that it buys for its own needs. It gets 0.4 of each new MIND of its COOP. It keeps the reserve of the payout rule and never holds HEARTS.
**Conversion**
: The moment an invested HEART converts into one MIND of its COOP: 0.5 to the investor, 0.4 to the treasury, 0.1 to the city's pools. This is Law 4.
**Dividend**
: Law 5: 20 % of every sale, the same for every COOP. It goes at once to everyone who holds the seller's MIND except its own treasury, in proportion to their holding: people, other COOPs and the city's pools (the holder rule, Section 9). It is not Laborde's universal dividend of Section 3, which is new money.
**Work proposal**
: All paid work in the city, as in a DAO: a person's Aven proposes a piece of work and its price in the COOP's own MIND, the COOP accepts it, the Aven delivers it with the COOP's machines, and the treasury pays the Aven's human on delivery. There are no jobs and no wages. Some work proposals keep a COOP running, such as a daily check, and the COOP pays them from its running costs. Others are new work, such as a repair plan: if the members accept it, the treasury pays it from what it holds above its reserve. Outside the city, anyone may still take a job for euros.
**Payout rule**
: A treasury keeps a reserve of 9 months of running costs, plus what it plans to build, and pays out the rest for work proposals (Section 4).
**Turnover**
: The total of a COOP's sales over a time. Only real deliveries count.
**Unit of account**
: The unit in which all values are shown and compared: the HEART. The pools set only how MINDs stand against each other; the supply-weighted average MIND is worth 1 HEART, and a MIND that the pools cannot price yet counts at 1 HEART (Section 6.3). It is for display only: it never changes a trade, a price or a payment, and it is not a peg.
**The melt (demurrage)**
: The continuous shrinking of every balance of HEARTS and MIND, at 7 % a year (Section 5.1). To melt is to shrink this way. Demurrage is the economists' name for such a holding cost.
**UIA**
: Universal Intent Allocation, Law 1: the right of every human to invest 24 HEARTS a day.
**Pool, basket, LP token**
: A pool is a basket of 4 to 8 MINDs in equal value shares, which anyone can trade against. Together the city's pools are the city's liquidity pool. A pool issues an LP token (liquidity-provider token), a share of the pool, for each deposit, and the City COOP holds them all (Section 6).
**G3M**
: Geometric mean market maker: the pool formula (5), which keeps the geometric mean of the reserves constant in every trade.
**LVR**
: Loss-versus-rebalancing: what a pool loses to arbitrageurs when prices move, against a perfect rebalancer.
**Aven**
: A personal AI agent that works only for its human: it invests, trades, pays, proposes and delivers work proposals, and collects dividends.
**City COOP**
: The city's own COOP (Section 4). It holds all land and everything that all citizens share, including all LP tokens of the city's pools, and it is the city's euro bank (Sections 8.2 and 8.3). Every citizen holds one equal share, as a membership. In maiaCITY it is the MaiaCity COOP.
**Settlement, village, Tribe COOP**
: A settlement is one hex of the city's map, and a village is a group of settlements. Each settlement has a Tribe COOP, whose MIND is tribeMIND. It owns the domes and beds there and rents them to residents.
**MIP**
: A MaiaCity improvement proposal: a vote of the City COOP's members, one vote per citizen share (Section 8.2). Only a passed MIP can redeem LP tokens.
**Ground rent, Erbbaurecht**
: The yearly fee for a leased plot, paid in any MIND and received as cityMIND. The lease works like a German heritable building right.
**Protocol**
: The shared software at the base of theOS that runs the laws. No person or COOP owns it.
**Steady state**
: The level at which a balance's yearly inflow equals what melts from it in a year.
**Gini index**
: A measure of inequality from 0 to 1: 0 means that everyone has the same, 1 means that one person has everything. It is the average gap between two people chosen at random, divided by twice the mean.
**Sybil attack**
: One person posing as many people, to collect many streams of HEARTS.
**Day of living**
: What an average person consumes in a day, priced in HEARTS that year (Section 6.3).
**Basic bundle**
: One day of basics for one person: 2,000 kcal of food, 100 L of water, 3 kWh of energy and 20 m² of home.
**Owner-only person**
: A person whose Aven delivers nothing and who starts with nothing. In the economic model, one person in 10 is one (Section 11.2.3).
**Real consumption**
: Every unit that a person consumes, valued at the prices of day 1, so that it counts amounts, not price changes. The economic model used it as a stand-in for real units before the upgrades of round 1, and its old yardstick still uses it (Section 11.1). It is not comparable with a day of living.
**Decile, tenth**
: One of ten equal groups of people. Part 3 sorts them by holdings and by Aven output, so it judges twenty tenths (Section 11.1). The old yardstick of the economic model sorts them by real consumption each year.
**Proposition 3**
: The central claim of Section 10.3. From the end of the founding, no one starves, and no one has to work to survive. Living standards rise for every tenth, by holdings and by Aven output, in real units. Each tenth gets its basics at need. No extra falls more than 2 % in any 5 years. A fall does not count when the tenth got all it wanted, or the good was at its natural or physical limit. The founding, a city's first days until every person holds MIND, is reported on its own. Part 2 claims the normal test, which lets an owner-only person spend some of what they hold. The strict test, dividends alone, is a stronger target. In the main run, the normal test held and the strict test failed.
**Verdict**
: How part 3 judges an extra that falls. Samuel chose it: taste-adjusted, with the cap excuse (Sections 10.3 and 11.1). The side readings (a), (b) and (c) stay beside it in Table 7.
**Rule, policy, concept, hypothesis**
: The four kinds of statement in this paper. A rule is part of the protocol and changes only with a new version of it; a policy is a setting that the City COOP chooses by MIP; a concept is a definition (Part II, Table 4). A hypothesis is what we expect theOS to achieve, with a status: proven, supported, mixed, failing or open (Section 10.1).
**Rival COOP**
: A COOP that makes the same good as another and competes for the same buyers (Section 9.1).
**Founding, exit, failure**
: A founding starts a COOP. An exit closes a small COOP that lost its market. A failure ends a COOP whose treasury stays dry while it keeps losing; the City COOP leases its plant to a successor while people still use it, and scraps it otherwise.
**Reserve**
: What a treasury keeps under the payout rule before it pays out (Section 4).
**Net energy**
: The energy that a source delivers, less the energy that it takes to build and run it.
**EROI**
: Energy return on investment: the energy that a source delivers over its life, divided by the energy that it takes to build and run it.
**Wright's law**
: The cost of a product falls by a fixed share each time the total ever made doubles.
**Recipe**
: The inputs and the energy that make one unit of a good (Section 8.4).
**Plant**
: The machines and buildings with which a COOP makes its goods.
**Last ten years**
: Years 51 to 60 of a simulation run, which its steady-state numbers average (Section 11.2.1).
**Main run**
: The run of the economic model with the settings of Section 11.2.1, now the upgrades of round 2. Law 5 is at 20 %, paid to every holder but the seller's own treasury. It has reserves of 9 months, Law 4, the idle-plant rule and the 6 rules kept in rounds 1 and 2 of the upgrades. Part 3 is judged by the verdict.
**Idle-plant rule**
: When a COOP fails, the City COOP leases its plant to a successor only while demand is at least 25 % of the plant's capacity. Otherwise it scraps the plant and takes the land back (Section 9.1).
**Seed, common random numbers**
: A seed fixes all the random events of a simulation run. With common random numbers, two runs of one seed share the random stream for shocks and tastes, so two rules meet the same shocks (Section 11.1).
**Sign test**
: A test for two rules run on the same seeds: it counts the seeds on which each rule did better and asks how likely so uneven a count is by chance alone.
**Binding limit**
: The input that runs out first and so sets how much of a good the city can make that day.
**Agent-based model**
: A simulation in which every person and every COOP acts by its own rules, and the result is what all of them do together.
**Stock-flow consistent**
: A way to keep the books of a model: every flow leaves one place and arrives in another, so every stock adds up.
**Economic model**
: The economic model: our simulation (Section 11.2), 250 people over 60 years, with no land map, no energy limit and no euro border. Each version adds to the last (Table 9), and the main run is now the upgrades of round 2.
**Dynamic and static world**
: The first two versions of the economic model (Section 11.2.1). The dynamic world has rivals, free prices, growth and shocks, and every later version builds on it. The earlier static world had fixed tastes, no growth and capped prices; "static" marks its numbers.
**Holder rule**
: Who gets a COOP's Law 5 dividend and a vote in it: a COOP's own treasury gets neither, the city's pools get the dividend but no vote, and people and other COOPs' treasuries get both (Section 9).
**Land rule**
: All land belongs to the City COOP, and nobody can sell or buy it; builders lease plots and pay ground rent (Section 8.2).
**Lasting return**
: $\mu$: what a holding earns a year, dividends plus any lasting price rise. Proposition 2 bounds inequality only while it stays below the melt (Sections 5.4 and 9.2).
**The founding (bootstrap)**
: A city's first days, until every person holds MIND; not the founding of one COOP (below). The bootstrap is the rule for them: residents invest their HEARTS for a founding week before the first sale. Proposition 3 is claimed from the end of the founding, and the founding is reported on its own (Section 12.4).
**Person-day**
: One person on one day. It is short when that person gets less than the basic bundle (Section 11.1).
**Abundism**
: An economy in which automation makes the basics plentiful, and every person helps to decide what the economy builds, through fair ownership (Sections 1 and 13).

## DRelated work

**WIR and Sardex.** WIR has given Swiss firms credit in its own currency since 1934 [77], and Sardex gives interest-free credit to firms in Sardinia [55]. theOS makes no MIND from euros and charges no interest; the City COOP gives euro loans, repaid in the COOP's own MIND (Section 8.3).

**Balancer and owned liquidity.** Balancer's weighted pools use the formula of theOS's baskets, but outside investors supply the reserves, hold pool tokens and can withdraw [56,25]. theOS pools take one-sided inflows from every COOP and hold currencies that melt. The closest model is the owned liquidity that Olympus made known: a treasury buys LP tokens of its own pools and keeps them, so it does not have to pay outside investors to supply liquidity [63]. theOS keeps that idea: owned liquidity, not rented liquidity, but the owner is the City COOP, not the protocol. The City COOP holds all LP tokens, and every citizen holds one equal share in it. The inflow comes from the COOPs' own MIND, not from a sale of new tokens (Section 6).

**Agent-based and stock-flow consistent models.** Mark-0 [37] and the model of Dosi and others [22] let many firms and households act by simple rules. Godley and Lavoie [36], and Caiani and others [17], keep the books so that every flow lands somewhere. The economic model (Section 11.2.1) keeps stock-flow consistent books. All of these models create money by credit and pay wages, and theOS has neither.

**Sources that the body discusses.** Circles: Section 3; theOS uses its web of trust only for new identities (Section 12.1). Gesell, Wörgl and the Chiemgauer: Section 2. The Relative Theory of Money and Ğ1: Sections 3 and 5.3. Property-owning democracy, after Rawls, Meade and Roemer: Section 1. Georgism: Sections 8.1 and 8.2, on who gets the rising value of land; in theOS, ground rent is a sale under Law 5. Energy and growth: Section 8.4.

## EThreat model

theOS creates prizes that attackers will want. Table 19 lists the main attacks, what they gain, the defences that Sections 12.1 to 12.5 propose. Section 12 also says which defences no simulation tests yet.

***Table 19.** Attacks on theOS, and the proposed defences.*

| Attack | What it gains | Proposed defence |
| --- | --- | --- |
| Fake identities (Sybil) | 8,760 HEARTS a year to direct for each fake person | Section 12.1: a staged identity system, caps on new identities, regular liveness checks |
| Self-dealing and rings | A founder controls 21.6 MIND a day instead of 12; friends trade empty MINDs for real ones | Section 12.2: escrow for related parties, public treasuries, only real deliveries count as sales, no dividend on sales between related COOPs; basket admission (Section 12.3) |
| Empty work proposals | Treasury MIND for work that an Aven never delivered, or for a friend's Aven | Section 12.2: public work proposals with a proof of delivery, members' acceptance, work proposals open to every Aven, audits of the largest earners |
| Pool attacks and front-running | A pushed price draws HEARTS from Avens; bots trade around payments and inflows | Section 12.3: time-averaged prices, one batch at one price per block, sealed orders, an event breaker |
| Capture | Control of a COOP's treasury, of the Avens' defaults, or of the protocol's code | Section 12.2: the holder rule, a default COOP constitution, the Avens' default rule changed only by MIP, several Aven providers, the process of Appendix F |
| Bugs | Value drained from pools that only a vote of the City COOP's members can withdraw from | Section 12.3: verified maths, one global melt index, independent code, a pause that cannot move funds, a bug bounty |
| A vote that thins or empties a pool | Pool reserves for some other use; pushed prices cost less to make | Section 12.3: the redemption rule, two thirds of the citizen shares, a wait of 30 days and a yearly cap |
| Arbitrage profits as a lasting return | A share of every price move between the pools, for whoever trades first | Section 12.3: one batch at one price per block, or arbitrage profits returned to all people (Table 15) |
| A COOP that refuses new HEARTS | Scarcity of its MIND for its first owners | The open-investment rule: no COOP whose MIND trades in a basket may refuse an investment (Section 9) |
| Market power over a basic | A leading COOP raises prices or keeps rivals out | Section 12.2: a founding signal when need goes unmet or a rival's cost is far below the price (Law 3 entry is always open); open improvements after a delay; Avens' exit; Law 5 to all holders; the City COOP leases failed plants that people still use |

## FWho can change the rules

theOS has three layers of rules, and each one changes in a different way. This appendix proposes how. Table 4 (Section 9.3) lists each rule and policy of Part II with who changes it.

**The laws.** The five laws, the melt rate and Law 5's share of 20 % are fixed. Nobody holds a key that changes them. A change to a law would be a new protocol, and each person would choose whether to move to it. In the economic model it is different: every rule is a setting, and a change runs as a new version.

**The code.** The software that runs the laws must be fixable, because it will have bugs. We propose that every change goes through a public proposal, an independent audit and a waiting time of at least 30 days. Then the citizens decide in the City COOP, one vote per citizen share (a MIP, Section 8.2). No change may break a law.

**The pause.** One narrow pause can stop trading in a pool, but it can never move funds. Each pause ends after 72 hours unless a large majority renews it.

**Details inside the laws.** Some rules and policies work inside the laws, and Table 4 says who changes each. Among them are the reserve target of about 9 months and the founding signal for rivals (Law 3 entry itself is always open). So are basket admission, how the HEART values (7) read pool prices (Section 6.3), the identity system, the idle-plant threshold and the terms of the euro advance. The Avens' default investment rule changes only by MIP, and a person's own choice always overrides it (Section 7). A redemption needs two thirds of the citizen shares and waits 30 days, and its yearly cap is a policy (Section 6). theOS has not yet set how the City COOP sets ground rent (Section 12.4), or the estate rule (Section 12.1). These rules change by the same process as the code, and we test each change in simulation first.

During the simulations and the first pilot, the maiaCITY team writes and runs the code. That is a concentration of power. The city must hand it to the process above before real value flows.

## GCode, data and interests

Samuel Andert leads maiaCITY, which builds the real city, and so has an interest in the success of theOS. Claude, an AI model made by Anthropic, co-wrote the text and the code behind its numbers. It holds no stake in maiaCITY. The code behind every number and figure in this paper is open, in the maiaCITY repository at [github.com/MyAvenCEO/maiacity](https://github.com/MyAvenCEO/maiacity). The file `src/lib/theos/model.js` holds every number that the text prints. Each constant names its source: a table of the simulation, a study or a design note. A function computes every ratio, so readers can check and rerun each one.

The economic model, which Sections 5 to 12 quote, is the script `scripts/theos-e2e-sim.mjs` in the same repository. Its main scenario is the dynamic world, and the static world is the comparison. The script prints the per-person checks of Proposition 3 first. Then it prints the tables of the dynamic world, its variations and the static world. It is seeded with 20261012, so the same command gives the same results, in about 9 minutes. This paper's main run, the upgrades of round 2, is the script's default: `node scripts/theos-e2e-sim.mjs`. It judges part 3 by the verdict (`p3=2`). The earlier main run, Law 5 paid to the pools, is `node scripts/theos-e2e-sim.mjs --set p3=0,foodStore=0,techCopy=0,founding=0,reroute=0,rentShort=0,waterStock=0`. It then judges part 3 by the old yardstick, as it ran; leave out `p3=0` to judge it by the verdict. The upgrades of round 1 is `node scripts/theos-e2e-sim.mjs --set reroute=0,rentShort=0,waterStock=0` (Section 11.2.1). The flag `--quick` runs a short smoke test, and `--csv FILE` also writes a yearly series of every run.

The script's own tables still use R, the yardstick that we retired (below). The values in HEARTS come from the same seeded runs. The script's HEART report values every flow and every holding at the HEART values (7) of its step, and it changes no move, price or trade. The script prints it as tables H1 to H8, and `model.js` names them. `--json FILE` writes the report's main numbers. `--seeds A-B` runs the main run on every seed from A to B and prints the seed check of Section 11.2.6. `--set key=value` changes one setting of the main run, for example `turnDiv` for Law 5's share, `capDays` for the reserves, `poolShare` for the pools' part, `reletUse` for the idle-plant rule, or `divPools` for whether Law 5 pays the pools. `--melt 0.08` sets another rate for the melt in a research run. With `--set reletUse=0`, the City COOP leases every failed plant, as in an earlier version (the HEART report in Table 9). With `--set divPools=0`, Law 5 pays only people and other COOPs' treasuries, as in the earlier versions. The melt tests of Section 11.2.5 use these flags, and with `--set poolShare=0.05` they run under the old pool rule. They ran under Law 5 paid to the pools, so a rerun today also needs that run's flags. `--pair A-B --vs key=value` runs the same-shock comparison of Table 20. It runs the main run and the same run with one setting changed, on every seed from A to B, both with common random numbers (`crn=1`). It prints the paired results and a sign test. Each upgrade of Section 11.2.1 is a setting of this kind. Round 1 added `foodStore`, `techCopy` and `founding`. Round 2 added `reroute`, `rentShort` and `waterStock`. The setting `p3` sets how part 3 is judged. The script's default switches on every setting of the main run. The script is at commit 79f83e8.

**R, the retired yardstick.** Earlier versions of this paper measured values in R, the geometric mean of a MIND's prices against three chosen MINDs: solarMIND, habitatMIND and cityMIND. We retired R for two reasons. It needed an anchor of three COOPs that could fail. And it drifted, because those three MINDs moved against the average MIND. One HEART was worth 1.28 R in year 1, 1.17 R in year 40 and 1.15 R in year 60. Every value in this paper is now in HEARTS, from the same simulation runs. A value in R and the same value in HEARTS differ because R drifted, not because the economy did. The largest gap is in the lasting return of Section 11.2.5: in the last ten years, it reads 1.5 % in R and 1.6 % in HEARTS.

**The old pool rule.** An earlier version of this paper gave the pools 0.05 of each HEART. We ran it against the rule of Law 4 on the same shocks, on 24 seeds, 20261012 to 20261035, both with the idle-plant rule (Table 20). Both ran under Law 5 paid to the pools, the main run before round 2, and we have not rerun them on the main run. Section 11.1 explains the method, and the glossary the sign test.

***Table 20.** The pool rule of this paper (0.1 of each HEART to the pools) against the old one (0.05). Both run on the same shocks, on 24 seeds, under Law 5 paid to the pools. Both have the idle-plant rule, and Law 5 pays the pools. Better means fewer person-days short, fewer failures, a lower μ, or all three checks passing where the other rule failed. Part 3 is judged by the old yardstick. p: the two-sided sign test.*

| Measure | New | Old | Seeds: new better · worse · same | p |
| --- | --- | --- | --- | --- |
| Person-days short from day 8, all seeds | 66,218 | 91,592 | 11 · 7 · 6 | 0.481 |
| Food COOP failures, all seeds | 19 | 33 | 11 · 4 · 9 | 0.119 |
| All COOP failures, all seeds | 22 | 39 | 11 · 4 · 9 | 0.119 |
| μ in the last ten years, median seed | 0.2 % | 0.1 % | 14 · 10 · 0 | 0.541 |
| Seeds on which all three checks pass | 9 | 6 | 7 · 4 · 13 | 0.549 |

On the same shocks, the new pool rule left fewer person-days short on 11 seeds and more on 7 (*p* = 0.481). It had fewer food COOP failures on 11 seeds and more on 4 (*p* = 0.119). All three checks passed on 9 seeds under the new rule and on 6 under the old (*p* = 0.549). All COOP failures fell on 11 seeds and rose on 4 (*p* = 0.119). And $\mu$ was lower on 14 seeds and higher on 10 (*p* = 0.541). It stayed below the melt on 24 seeds under the new rule, and on 23 under the old. No difference was significant: every p was above 0.05, so luck can explain each one.

**Earlier tests.** In an earlier version (the idle-plant rule in Table 9), Law 5 did not pay the pools. There the new pool rule left fewer person-days short on 16 seeds and more on 3 (*p* = 0.004). Without the idle-plant rule, it also left fewer person-days short than the old one: on 15 seeds, against 3 (*p* = 0.008). We have not rerun these tests with Law 5 paid to the pools.

**Law 5 with and without the pools.** We ran Law 5 paid to the pools against Law 5 without the pools (`--vs divPools=0`), on the same 24 seeds. That is the Law 5 of an earlier version (the idle-plant rule in Table 9). Paying the pools lowered $\mu$ on 24 of 24 seeds (*p* < 0.001). Person-days short came to 66,218, against 31,522 without the pools: more on 10 seeds and fewer on 5 (*p* = 0.302), not a significant difference. All three checks passed on 9 seeds with the pools paid and on 6 without (*p* = 0.453).

Under the old pool rule, we ran the melt tests of Section 11.2.5 too. A melt of 9 %, Law 5 at 10 % and Law 5 at 15 % kept μ below the melt on every seed. A melt of 8 % left it above the melt on 1 seed and reserves of 12 months left it above the melt on 1 seed. All three checks passed on at most 2 of the 8 seeds, against up to 5 under the rule of this paper.

## HThe physical world: primitives and limits

Money counts what the city makes, and physics sets what it can make (Section 8.4). Table 21 lists the *primitives* of the first village's design: the basic resources that every recipe draws on. It gives what each one gives and costs in energy, and the limit that no recipe can pass. These are design numbers, not simulation results. "Estimate" marks the ones that nobody has checked against measured systems yet.

***Table 21.** The physical primitives of the first village: design numbers and their limits.*

| Resource | Rate and energy cost | Hard limit |
| --- | --- | --- |
| Sunlight | About 1 MWh a year for each kWp of solar panels in Munich | About 33 % of sunlight for one single-junction solar cell [73] |
| Land | Fixed, and all of it the City COOP's | Only how hard it is used can change |
| Rain and water | About 140 L of rain a bed a day, against a need of 100 L of fresh water | A year 30 % drier gives 98 % of the need |
| Soil and food | A food forest gives 10 % of the food in year 1 and all of it in year 10; then 0.74 kg/m² a year (estimate). This is the riskiest number, because the land that a diet needs depends on it [65] | At most 4.6 % (C3 plants) to 6 % (C4 plants) of sunlight into food [83] |
| Geothermal heat | 3.4 MW of electricity and 12.6 MW of heat a plant; EROI 15 to 35 with the heat used (estimate) [9] | The Carnot limit: at most 36 % of the heat into electricity |
| Timber | 150 t a year from 10 ha (estimate). Glued timber takes about 0.5 MWh a tonne | Land times growth |
| Steel | About 3.6 MWh a tonne | About 2.9 MWh a tonne from ore, the practical minimum; steel from scrap needs far less |
| Glass | About 1.3 MWh a tonne | At least 0.69 MWh a tonne |
| Fired clay | About 0.5 MWh a tonne | Clay is plentiful; energy binds |
| Solar panels | About 2.0 MWh a tonne; they pay back their energy in about 1.1 years [28] | The limit of one solar cell, above |
| Compute | The energy for each Aven service-hour, for Avens that do all the work, not only talk (estimate) | Imported chips, bought in euros across the euro border, and energy |

Recipes get better in two ways (Section 8.4). They improve by making more, as Wright's law says, and by searching, through research that Avens propose and COOPs fund. Klaassen and others measured both effects for wind power [48]. In theOS, basics get the energy first, and research uses the energy that is left (Section 8.4). Both kinds of learning stop at the physical floor of each recipe. The economic model (Section 11.2) does not use these limits yet.

## References

1. Acemoglu, D. (2024). The Simple Macroeconomics of AI. NBER Working Paper 32487. [www.nber.org/papers/w32487](https://www.nber.org/papers/w32487)
2. Acemoglu, D. & Restrepo, P. (2020). Robots and Jobs: Evidence from US Labor Markets. Journal of Political Economy, 128(6), 2188–2244. [doi.org/10.1086/705716](https://doi.org/10.1086/705716)
3. Adams, H., Zinsmeister, N. & Robinson, D. (2020). Uniswap v2 Core. Whitepaper. [uniswap.org/whitepaper.pdf](https://uniswap.org/whitepaper.pdf)
4. Alchian, A. A. (1950). Uncertainty, Evolution, and Economic Theory. Journal of Political Economy, 58(3), 211–221.
5. Angeris, G. & Chitra, T. (2020). Improved Price Oracles: Constant Function Market Makers. Proceedings of the 2nd ACM Conference on Advances in Financial Technologies, 80–91.
6. Angeris, G., Agrawal, A., Evans, A., Chitra, T. & Boyd, S. (2022). Constant Function Market Makers: Multi-Asset Trades via Convex Optimization. In Handbook on Blockchain, Springer, 415–444. [arxiv.org/abs/2107.12484](https://arxiv.org/abs/2107.12484)
7. Angeris, G., Chitra, T., Evans, A. & Boyd, S. (2022). Optimal Routing for Constant Function Market Makers. Proceedings of the 23rd ACM Conference on Economics and Computation, 115–128. [arxiv.org/abs/2204.05238](https://arxiv.org/abs/2204.05238)
8. Arntz, M., Gregory, T. & Zierahn, U. (2016). The Risk of Automation for Jobs in OECD Countries: A Comparative Analysis. OECD Social, Employment and Migration Working Papers, No. 189. [doi.org/10.1787/5jlz9h56dvq7-en](https://doi.org/10.1787/5jlz9h56dvq7-en)
9. Atlason, R. S. & Unnthorsson, R. (2013). Hot water production improves the energy return on investment of geothermal power plants. Energy, 51, 273–280. [ideas.repec.org/a/eee/energy/v51y2013icp273-280.html](https://ideas.repec.org/a/eee/energy/v51y2013icp273-280.html)
10. Autor, D., Chin, C., Salomons, A. & Seegmiller, B. (2024). New Frontiers: The Origins and Content of New Work, 1940–2018. Quarterly Journal of Economics, 139(3), 1399–1465. [www.nber.org/papers/w30389](https://www.nber.org/papers/w30389)
11. Ayres, R. U. & Warr, B. (2009). The Economic Growth Engine: How Energy and Work Drive Material Prosperity. Edward Elgar.
12. Balancer (2024). Weighted pools: pools of up to eight tokens with fixed weights. Balancer v3 documentation. [docs.balancer.fi/concepts/explore-available-balancer-pools/weighted-pool/weighted-pool.html](https://docs.balancer.fi/concepts/explore-available-balancer-pools/weighted-pool/weighted-pool.html)
13. Balancer (2025). Nov 3 exploit post-mortem. Balancer Protocol blog. [medium.com/balancer-protocol/nov-3-exploit-post-mortem-51dcbeb6b020](https://medium.com/balancer-protocol/nov-3-exploit-post-mortem-51dcbeb6b020)
14. Board of Governors of the Federal Reserve System (2025). Distributional Financial Accounts: wealth held by the top 1 %, by asset class. [www.federalreserve.gov/releases/z1/dataviz/dfa/](https://www.federalreserve.gov/releases/z1/dataviz/dfa/)
15. Bouchaud, J.-P. & Mézard, M. (2000). Wealth condensation in a simple model of economy. Physica A, 282(3–4), 536–545. [doi.org/10.1016/S0378-4371(00)00205-3](https://doi.org/10.1016/S0378-4371(00)00205-3)
16. Buterin, V., Hitzig, Z. & Weyl, E. G. (2019). A Flexible Design for Funding Public Goods. Management Science, 65(11), 5171–5187. [doi.org/10.1287/mnsc.2019.3337](https://doi.org/10.1287/mnsc.2019.3337)
17. Caiani, A., Godin, A., Caverzasi, E., Gallegati, M., Kinsella, S. & Stiglitz, J. E. (2016). Agent Based-Stock Flow Consistent Macroeconomics: Towards a Benchmark Model. Journal of Economic Dynamics and Control, 69, 375–408.
18. Canidio, A. & Fritsch, R. (2023). Arbitrageurs' Profits, LVR, and Sandwich Attacks: Batch Trading as an AMM Design Response. arXiv:2307.02074; short version at AFT 2023. [arxiv.org/abs/2307.02074](https://arxiv.org/abs/2307.02074)
19. Circles contributors (2020–). Circles: a universal basic income built on personal currencies and a web of trust. Whitepaper and documentation. [aboutcircles.com/](https://aboutcircles.com/)
20. Circles contributors (2024–). Circles v2 documentation: personal currencies of 24 tokens a day, and a demurrage of 7 % a year taken daily. [docs.aboutcircles.com/overview/how-it-works/personal-currency](https://docs.aboutcircles.com/overview/how-it-works/personal-currency)
21. Deutsche Bundesbank (2025). Panel on Household Finances (PHF): household wealth and finances in Germany, 2023 survey. [www.bundesbank.de/en/bundesbank/research/panel-on-household-finances](https://www.bundesbank.de/en/bundesbank/research/panel-on-household-finances)
22. Dosi, G., Fagiolo, G. & Roventini, A. (2010). Schumpeter Meeting Keynes: A Policy-Friendly Model of Endogenous Growth and Business Cycles. Journal of Economic Dynamics and Control, 34(9), 1748–1767.
23. Duniter contributors (2017–). Ğ1 (June): the first libre currency built on the Relative Theory of Money. Protocol documentation. [duniter.org/](https://duniter.org/)
24. European Securities and Markets Authority (2024). Guidelines on the conditions and criteria for the qualification of crypto-assets as financial instruments. Final report, December 2024. [www.esma.europa.eu/press-news/esma-news/esma-releases-last-policy-documents-get-ready-mica](https://www.esma.europa.eu/press-news/esma-news/esma-releases-last-policy-documents-get-ready-mica)
25. Evans, A. (2020). Liquidity Provider Returns in Geometric Mean Markets. arXiv:2006.08806. [arxiv.org/abs/2006.08806](https://arxiv.org/abs/2006.08806)
26. Fisher, I. (1911). The Purchasing Power of Money. Macmillan.
27. Fisher, I., with Cohrssen, H. R. L. & Fisher, H. W. (1933). Stamp Scrip. Adelphi.
28. Fraunhofer Institute for Solar Energy Systems ISE (2024). Photovoltaics Report. Freiburg. [www.ise.fraunhofer.de/en/publications/studies/photovoltaics-report.html](https://www.ise.fraunhofer.de/en/publications/studies/photovoltaics-report.html)
29. Frey, C. B. & Osborne, M. A. (2017). The Future of Employment: How Susceptible Are Jobs to Computerisation? Technological Forecasting and Social Change, 114, 254–280. [doi.org/10.1016/j.techfore.2016.08.019](https://doi.org/10.1016/j.techfore.2016.08.019)
30. Gelleri, C. (2009). Chiemgauer Regiomoney: Theory and Practice of a Local Currency. International Journal of Community Currency Research, 13, 61–75.
31. George, H. (1879). Progress and Poverty. New York: D. Appleton.
32. Georgescu-Roegen, N. (1971). The Entropy Law and the Economic Process. Harvard University Press.
33. Gesell, S. (1916). Die natürliche Wirtschaftsordnung durch Freiland und Freigeld. Translated as The Natural Economic Order (1929).
34. Gmyrek, P., Berg, J., Kamiński, K., Konopczyński, F., Ładna, A., Nafradi, B., Rosłaniec, K. & Troszyński, M. (2025). Generative AI and Jobs: A Refined Global Index of Occupational Exposure. ILO Working Paper 140. Geneva: ILO. [www.ilo.org/node/706766](https://www.ilo.org/node/706766)
35. Gnosis (2026). Quarterly report, Q2 2026: Circles registered humans and active minters. [docs.gnosis.io/docs/knowledge/quarterly-report-2026-q2](https://docs.gnosis.io/docs/knowledge/quarterly-report-2026-q2)
36. Godley, W. & Lavoie, M. (2007). Monetary Economics: An Integrated Approach to Credit, Money, Income, Production and Wealth. Palgrave Macmillan.
37. Gualdi, S., Tarzia, M., Zamponi, F. & Bouchaud, J.-P. (2015). Tipping Points in Macroeconomic Agent-Based Models. Journal of Economic Dynamics and Control, 50, 29–61. [arxiv.org/abs/1307.5319](https://arxiv.org/abs/1307.5319)
38. Hanson, R. (2013). Shall We Vote on Values, But Bet on Beliefs? Journal of Political Philosophy, 21(2), 151–178.
39. Hayek, F. A. (1945). The Use of Knowledge in Society. American Economic Review, 35(4), 519–530.
40. Hayek, F. A. (1976). Denationalisation of Money. Institute of Economic Affairs.
41. Hirschman, A. O. (1970). Exit, Voice, and Loyalty: Responses to Decline in Firms, Organizations, and States. Harvard University Press.
42. International Labour Organization (2024). World Employment and Social Outlook: September 2024 Update. Geneva: ILO. [www.ilo.org/publications/flagship-reports/world-employment-and-social-outlook-september-2024-update](https://www.ilo.org/publications/flagship-reports/world-employment-and-social-outlook-september-2024-update)
43. International Monetary Fund (2025). Special Drawing Rights (SDR): an international reserve asset, valued on a basket of five currencies; neither a currency nor a claim on the IMF. IMF Factsheet. [www.imf.org/en/About/Factsheets/Sheets/2023/special-drawing-rights-sdr](https://www.imf.org/en/About/Factsheets/Sheets/2023/special-drawing-rights-sdr)
44. Kennedy, M. (1995). Interest and Inflation Free Money: Creating an Exchange Medium That Works for Everybody and Protects the Earth. Seva International / New Society.
45. Keynes, J. M. (1930). Economic Possibilities for Our Grandchildren. In Essays in Persuasion (1931). Macmillan.
46. Keynes, J. M. (1936). The General Theory of Employment, Interest and Money, ch. 23 “Notes on Mercantilism, the Usury Laws, Stamped Money and Theories of Under-Consumption”. Macmillan.
47. Keynes, J. M. (1943). Proposals for an International Clearing Union (the bancor plan). Cmd. 6437. London: HMSO.
48. Klaassen, G., Miketa, A., Larsen, K. & Sundqvist, T. (2005). The Impact of R&D on Innovation for Wind Energy in Denmark, Germany and the United Kingdom. Ecological Economics, 54(2–3), 227–240. [pure.iiasa.ac.at/id/eprint/7533/](https://pure.iiasa.ac.at/id/eprint/7533/)
49. Kocherlakota, N. R. (1998). Money Is Memory. Journal of Economic Theory, 81(2), 232–251.
50. Korinek, A. & Suh, D. (2024). Scenarios for the Transition to AGI. NBER Working Paper 32255. [www.nber.org/papers/w32255](https://www.nber.org/papers/w32255)
51. Laborde, S. (2010; 2.718 ed. 2017). Théorie Relative de la Monnaie (Relative Theory of Money). Self-published, libre licence. [trm.creationmonetaire.info/](http://trm.creationmonetaire.info/)
52. Lalley, S. P. & Weyl, E. G. (2018). Quadratic Voting: How Mechanism Design Can Radicalize Democracy. AEA Papers and Proceedings, 108, 33–37.
53. Lietaer, B. (2001). The Future of Money: Creating New Wealth, Work and a Wiser World. Century.
54. Lindenberger, D. & Kümmel, R. (2011). Energy and the State of Nations. Energy, 36(10), 6010–6018. [doi.org/10.1016/j.energy.2011.08.014](https://doi.org/10.1016/j.energy.2011.08.014)
55. Littera, G., Sartori, L., Dini, P. & Antoniadis, P. (2017). From an Idea to a Scalable Working Model: Merging Economic Benefits with Social Values in Sardex. International Journal of Community Currency Research, 21, 6–21.
56. Martinelli, F. & Mushegian, N. (2019). Balancer: A Non-Custodial Portfolio Manager, Liquidity Provider, and Price Sensor. Whitepaper.
57. McLeay, M., Radia, A. & Thomas, R. (2014). Money Creation in the Modern Economy. Bank of England Quarterly Bulletin, 2014 Q1, 14–27. [www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy](https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy)
58. Meade, J. E. (1964). Efficiency, Equality and the Ownership of Property. London: George Allen & Unwin.
59. Milionis, J., Moallemi, C. C., Roughgarden, T. & Zhang, A. L. (2022). Automated Market Making and Loss-Versus-Rebalancing. arXiv:2208.06046. [arxiv.org/abs/2208.06046](https://arxiv.org/abs/2208.06046)
60. Milionis, J., Moallemi, C. C. & Roughgarden, T. (2023). Automated Market Making and Arbitrage Profits in the Presence of Fees. arXiv:2305.14604. [arxiv.org/abs/2305.14604](https://arxiv.org/abs/2305.14604)
61. Miller, G. A. (1956). The Magical Number Seven, Plus or Minus Two: Some Limits on Our Capacity for Processing Information. Psychological Review, 63(2), 81–97. [doi.org/10.1037/h0043158](https://doi.org/10.1037/h0043158)
62. Murphy, D. J. & Hall, C. A. S. (2011). Energy Return on Investment, Peak Oil, and the End of Economic Growth. Annals of the New York Academy of Sciences, 1219, 52–72. [doi.org/10.1111/j.1749-6632.2010.05940.x](https://doi.org/10.1111/j.1749-6632.2010.05940.x)
63. Olympus DAO (2021–). Protocol-owned liquidity: liquidity that the protocol itself owns, bought with its own bonds. Olympus documentation. [docs.olympusdao.finance/main/overview/pol/](https://docs.olympusdao.finance/main/overview/pol/)
64. Ostrom, E. (1990). Governing the Commons: The Evolution of Institutions for Collective Action. Cambridge University Press.
65. Peters, C. J., Picardy, J., Darrouzet-Nardi, A. F., Wilkins, J. L., Griffin, T. S. & Fick, G. W. (2016). Carrying Capacity of U.S. Agricultural Land: Ten Diet Scenarios. Elementa: Science of the Anthropocene, 4, 000116. [doi.org/10.12952/journal.elementa.000116](https://doi.org/10.12952/journal.elementa.000116)
66. Piketty, T. (2014). Capital in the Twenty-First Century. Belknap Press of Harvard University Press.
67. Posner, E. A. & Weyl, E. G. (2018). Radical Markets: Uprooting Capitalism and Democracy for a Just Society. Princeton University Press.
68. Rawls, J. (2001). Justice as Fairness: A Restatement. Cambridge, MA: Harvard University Press.
69. Raworth, K. (2017). Doughnut Economics: Seven Ways to Think Like a 21st-Century Economist. Random House.
70. Rifkin, J. (2014). The Zero Marginal Cost Society. Palgrave Macmillan.
71. Roemer, J. E. (1994). A Future for Socialism. Cambridge, MA: Harvard University Press.
72. Schwarz, F. (1951). Das Experiment von Wörgl. Genossenschaft Verlag Freiwirtschaftlicher Schriften.
73. Shockley, W. & Queisser, H. J. (1961). Detailed Balance Limit of Efficiency of p-n Junction Solar Cells. Journal of Applied Physics, 32(3), 510–519. [doi.org/10.1063/1.1736034](https://doi.org/10.1063/1.1736034)
74. Simon, H. A. (1955). A Behavioral Model of Rational Choice. Quarterly Journal of Economics, 69(1), 99–118. [doi.org/10.2307/1884852](https://doi.org/10.2307/1884852)
75. Smil, V. (2017). Energy and Civilization: A History. MIT Press.
76. Soddy, F. (1926). Wealth, Virtual Wealth and Debt: The Solution of the Economic Paradox. George Allen & Unwin.
77. Stodder, J. (2009). Complementary Credit Networks and Macroeconomic Stability: Switzerland's Wirtschaftsring. Journal of Economic Behavior & Organization, 72(1), 79–95. [doi.org/10.1016/j.jebo.2009.06.002](https://doi.org/10.1016/j.jebo.2009.06.002)
78. The Block (2020). Balancer pools drained of more than $450,000 due to an exploit connected to deflationary tokens. News report. [www.theblock.co/linked/69785/balancer-pools-drained-of-more-than-450000-due-to-an-exploit-connected-to-deflationary-tokens](https://www.theblock.co/linked/69785/balancer-pools-drained-of-more-than-450000-due-to-an-exploit-connected-to-deflationary-tokens)
79. Van Parijs, P. & Vanderborght, Y. (2017). Basic Income: A Radical Proposal for a Free Society and a Sane Economy. Harvard University Press.
80. Weyl, E. G., Ohlhaver, P. & Buterin, V. (2022). Decentralized Society: Finding Web3’s Soul. SSRN Working Paper 4105763. [doi.org/10.2139/ssrn.4105763](https://doi.org/10.2139/ssrn.4105763)
81. White, D., Robinson, D. & Adams, H. (2021). TWAMM: Time-Weighted Average Market Maker. Paradigm research. [www.paradigm.xyz/2021/07/twamm](https://www.paradigm.xyz/2021/07/twamm)
82. Wright, T. P. (1936). Factors Affecting the Cost of Airplanes. Journal of the Aeronautical Sciences, 3(4), 122–128.
83. Zhu, X.-G., Long, S. P. & Ort, D. R. (2008). What Is the Maximum Efficiency with Which Photosynthesis Can Convert Solar Energy into Biomass? Current Opinion in Biotechnology, 19(2), 153–159. [doi.org/10.1016/j.copbio.2008.02.004](https://doi.org/10.1016/j.copbio.2008.02.004)

**Cite as:** Andert, S., & Claude (2026). theOS: The civilization scale operating system of Abundism. A macroeconomic and system-engineering framework for a post-labour economy, v8. maiaCITY working paper.
