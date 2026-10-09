---
title: A city gets rich from what flows in, not from what it taxes
source: https://www.youtube.com/watch?v=ijemGGq-Qao
type: video
added: 2026-10-09
categories: [game, money, coop]
hook: >-
  Every city builder ends the same way: a treasury so full that nobody opens the budget screen
  again. One indie developer wants to take that ending away from you.
shift:
  from: A city gets rich by filling its treasury. Zone, build, collect taxes, repeat.
  to: Taxes only move money around inside. Wealth is what flows in and what gets made, and a tight budget with visible rules is what makes a player go after it.
quote: "Think before you move. This isn't a dollhouse."
---

## The story

In almost every city builder, the money problem solves itself. Build a road, zone some land, wait, collect taxes, repeat, and within an hour the treasury is so full that the budget screen never gets opened again.

James is building a gridless city builder, and in part five of his devlog he stops to ask why that is. He watches his kids play these games and finish every session drowning in money. The loop feels lovely. It also ends in endless sprawl, because the only lever that ever pays is more houses.

His answer starts with a line most games blur. Making money is the government filling its treasury: property tax, sales tax, fines and fees, bonds, the water bill, land sales. Generating wealth is money flowing in from outside, through exported goods and services, visitors, universities and agencies, ports and rail junctions, research labs and the startups around them.

A treasury can be full in a city that is getting poorer.

So he sets out to make money tight. Anyone who has sat on a city council will tell you the budget is always short, and he wants the player to feel that, to play almost like chess: a few big moves, each one thought through, and bad decisions you have to live with. Rimworld and Dwarf Fortress taught a generation that losing can be fun.

Tightness needs a reason inside the simulation, and his reason is the developer. Every building is put up by a firm with its own cash, equity and loans. Before it buys a parcel it runs a pro forma, a projected financial statement for a building that doesn't exist yet, to answer one question: if I build here, will I make money? When the numbers turn, the firm stalls, holds a fire sale or exits, and the land waits for the next buyer.

That one rule rewrites the start of a city. Roads, utilities, surveyors and zoning clerks all cost money up front, so a new city opens in debt, and its first real cash arrives when developers buy the land, long before any tax. It also rewrites the bulldozer. Every home keeps a record of what was paid for it: the land, the construction, the impact fees, the taxes. You can still flatten a suburb for a football stadium. You will pay every one of those owners back.

A tight game can easily turn cruel, though. Global recessions, inflation and world markets are realistic, and no single city can fix any of them. His design pillar is blunt: every problem must come with a way to fix it. So they stay out. Goods can still be sold to other cities, but no world market sets their price.

What holds the rest together is a rule layer. Every decision passes through scoped policies, citywide or for one district or for a few months, that add up to a verdict: zoning, moratorium, impact fee, then a permit or a refusal. The rules are kept as plain lists, not code passed from function to function, so they stay safe and fast. Even the currency belongs to the player. Pick a symbol, call it pounds, or James dollars.

Then he plays. He is in the red within minutes, because operating costs kept ticking while he was away. A beachfront block he hoped would become a hotel turns into offices, because his factories need offices to run them. He cuts road maintenance to zero and potholes appear and slow the traffic down. And by the end of the demo his budget is climbing steadily again. It is still too easy to make money, he admits, and the work isn't done.

The money in a city was never its wealth. It's the scoreboard. Wealth is what flows in and what gets made, and the game only gets worth playing once the scoreboard is tight, every rule can be seen, and the only way up is to make something someone else wants.

## Beliefs that shift

- *A full treasury means a rich city.* → The treasury is money moving around inside. Wealth is value that flows in or gets made, and a city can tax itself rich on paper while it gets poorer.
- *A city builder is more fun when money comes easy.* → Easy money ends in sprawl. A tight budget turns every build into a move you have to live with, and losing becomes part of the fun.
- *More realism means more frustration.* → Simulate what the player can fix (developers, land, rules, debt) and leave out what they can't (recessions, inflation, world markets).

## Making money vs generating wealth

| Making money (the treasury) | Generating wealth (from outside) |
| --- | --- |
| Property tax, usually the biggest single source | Exported goods: manufacturing, farming, raw resources |
| Sales and consumption tax, like VAT | Exported services: finance, tech, consulting, insurance, film |
| Local income, payroll and business taxes | Tourism: visitors spending money earned elsewhere |
| Fines and fees | Government spending: bases, universities, agencies |
| Municipal bonds, how a city borrows | Retirement and remittance flows |
| Public enterprise revenue: water, power | Logistics hubs: ports, rail junctions, airports |
| Land sales and leases; tourism and congestion charges | Knowledge centres: universities, research, startups |

## What we learn

- **Mint money per person, not per tax.** In Sandbox 7 every aven gets 24 HEARTS a day and loses 7% a year to decay. Money comes from being alive in the valley, not from a treasury taking its cut, and the decay keeps it from piling into the glut James is fighting.
- **With no outside market, wealth has to be real.** Our valley has no euros and no world market, the same call James makes. Ten avens trading water, fruit, vegetables, legumes and chicken on an hourly order book can only get richer by growing more and losing less to rot. HEARTS just carry the messages.
- **Run a pro forma before you build.** James's developers ask "if I build here, will I make money?" Each aven's brain asks a small version every three game days: try one change, keep it only if the stretch paid better. The settlers game's goal, a cashflow-positive village carrying loans at 1% a month over 15 years, is a pro forma for a whole village.
- **Capex and opex, in real units.** Sandbox 5 already splits every factory stage into build, keep and make recipes in tonnes and MWh. Build is capex, keep is opex, and the 25,000-gold geothermal plant is the one big capex every village center carries.
- **Rules as cards, changed by proposal.** His verdict accumulator runs every decision through scoped policies kept as data. Our worlds go one step further: every rule is card code in a QuickJS sandbox that changes only by a proposal the admin accepts. A rule that hurts can be read, and a fix can be proposed, which is his pillar that every problem must come with a fix.
- **Give the destructive move its real price.** He records what each home paid so bulldozing has a cost. A village whose food forest covers 58% of its land needs the same: cutting a stretch of forest for a factory should show the years of growth it throws away.
- **Keep the world small enough to own.** He leaves nations and national debt out to keep the game a city or a region. Our worlds are standalone capsules, each with its own HEARTS and its own brains, for the same reason.

## Open questions

- His developers bring a new city its first cash by buying land. maiaCITY doesn't sell its land, so what is a new village's first inflow: only minting, or something from outside?
- With HEARTS minted to everyone and no outside market, can a valley "generate wealth" in his sense, or only grow its stock of goods? A Sandbox 7 stat could show goods grown vs eaten vs rotted per day.
- He hints at trade with other cities and embargoes later. Trade between two of our villages would be the first outside flow; how should HEARTS cross between worlds that are capsules today?
- The list of city revenue sources comes without numbers, and the video names its maker only as James. Check the shares and the channel name before quoting.
