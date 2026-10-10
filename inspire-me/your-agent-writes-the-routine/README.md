---
title: Your own AI agent writes the colonists' routines
source: https://www.youtube.com/watch?v=DG3vrL8iiF8
type: video
added: 2026-10-10
categories: [game, ai, code]
hook: >-
  In most colony sims you click a colonist's day together from a menu. In Far Camp you tell your own
  AI agent "collect up to 20 wood whenever the stockpile drops under 10", and it writes the script.
shift:
  from: A game's behaviour is fixed by its makers, and the player clicks through the options they allowed.
  to: The player's own agent connects over MCP and writes the rules as readable script, and the script outlives every lost game.
quote: "Every time the game ends, or you lose, or something happens, you get to keep all of your scripts."
---

## The story

By now everyone has seen a video game made by AI from a single prompt. Most of them look good, and most of them are a one-shot: one prompt, one game, nothing after it.

Far Camp is the opposite. It is a colony simulator its maker has built alone for a few weeks, with a team of agents writing the code, generating the art and inventing the procedural tricks for the world and its sound. Claude Code, Codex and a platform of his own do the work. The tools around it will be open source and, he hopes, community-driven.

It started a year earlier as a proof of concept with one idea: natural language should drive what the colonists do every day. That part worked. The art didn't, because the models of the time drew sub-par assets, and with a full-time job beside it the project went on a shelf.

Then the models learned geometry. This time the stylized assets came quickly, and the project came off the shelf.

Every new world now grows its own plants and creatures, 32 species for now. Half of them come back from earlier playthroughs, so you may spot a blueberry bush you think you know. Eat it without studying it first and you gamble on your memory, because it might be the poisonous one. Everything in a new world has to be observed before it is safe, and a camp of low-intelligence colonists has to build up its wits before it can observe the hard ones.

Pretty art was never going to make it stand out. There are plenty of colony sims, and in the biggest of them you set behaviours with mouse clicks inside the options the designers foresaw. His plan was to bring back his old scripting system and let colonists do nearly anything the game allows.

Nobody wants to learn a new scripting language just to play a game, though.

So the player's own agent does it. Claude Code, or ChatGPT in a browser, anything that speaks MCP can connect to the game. You say what you want in plain words and it writes the script for you, in a language close to Python, so you pick up a little Python as you play. You can also ignore all of it and click your way through like in RimWorld.

The real payoff came later. When a game ends, or the colony dies, the scripts stay. The next camp starts with last game's routines already running, edited and improved, and replaying stops being starting over.

The first camp was humble: a couple of beds, a fire, colonists who feed and water themselves. Cold nights came next, then a shelter, and soon the colony could survive forever, because food and water grew back on their own. Forever is not a game. The next thing he is adding is a stress: eyes circling the camp in the dark, and howls.

The game doesn't decide what the colonists do. Your agent writes it, you read it, and you keep it.

## Beliefs that shift

- *AI makes a game in one prompt.* → The interesting work is a long collaboration: a team of agents building one game over weeks, with its maker steering the design.
- *Custom behaviour means learning a scripting language.* → Say what you want in plain words; your own agent connects over MCP and writes a script you can read, edit and learn from.
- *Losing a run means starting from scratch.* → What you learned lives in your scripts, and they carry over to the next world, along with a few familiar species your memory may get wrong.

## What we learn

- **The agent proposes, the game runs it.** Far Camp lets any MCP agent write colonist scripts. In Sandbox 7 the same split already holds: every rule is QuickJS card code, and a change comes in only as a MIP proposed over the MCP that the admin accepts. A proposal now shows its code as a line diff (#411), so reading proposals teaches the JS, the way his scripts teach Python.
- **Keep what was learned when a run ends.** His scripts survive each death. Our worlds do the same at two levels: a new world starts from the previous world's cards (#400), and each aven starts with a copy of its last brain.
- **Tell the player what is the same and what only looks it.** His half-familiar species punish a memory that's out of date. When an aven's brain enters a new world it is told what changed since its last one (this_world_vs_my_last), so a lesson that was true in World 16 isn't trusted blindly in World 21.
- **Scripts are steadier than a fresh guess every hour.** His colonists run a routine; our avens ask d1 or Qwen again and again. World 15 froze because the models kept picking the middle option. A rule an agent writes once, that anyone can read and test, may beat a model asked every hour.
- **Abundance is not a game.** Far Camp got boring the moment food and water grew back for free. Sandbox 7 sets supply 5 to 25% over need, with rot, dry spells and HEARTS that decay, and Sandbox 5 asks for a cashflow-positive village. The stress has to come from inside the world.
- **Keep both doors open.** His scripting is optional and every routine can still be clicked. Sandbox 5 is played by hand with one action button; Sandbox 7 changes only through an agent. A new player needs one of them to start.
- **Build it in the open.** He builds with a team of agents and plans to hand the tools to a community. Our proposals are the same kind of door: anyone with an agent can propose a rule, and the history shows who changed what.

## Open questions

- Could an aven's brain write its own trading rule as card code, proposed by MIP, instead of answering a question every hour? A Sandbox 7 world could test it against today's brains on the same seed.
- How does Far Camp keep a player's script safe and fair, with a step limit, a sandbox or a list of allowed calls? Our hooks run in QuickJS with validated answers; his video doesn't say.
- The video never names its maker, and the auto transcript gives the platform as "OI" and the models as "Astra, Fable, Opus". Check the channel name and spelling before quoting.
- His first stress is predators at night. What is the first stress a new maiaCITY village meets, before its loans come due?
