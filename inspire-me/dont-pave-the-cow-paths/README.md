---
title: Don't pave the cow paths, build the road for the machine
source: https://www.youtube.com/watch?v=3199TC7Pt_o
type: video
added: 2026-10-16
categories: [ai, code, coop]
hook: >-
  In May a monorepo took 2,500 merges a day. By September it took 30,000. Git couldn't keep up, so
  seven people and their AI built a new source control system in five months.
shift:
  from: To gain from AI, give every worker an agent and keep the tools, reviews and approvals you already have.
  to: The tools, reviews and approvals were built for human speed. The gain comes from redesigning each process for machines, and that also changes what people still do.
quote: "Automate the coordination before you fire the coordinators."
---

## The story

In May 2026, Anthropic merged about 2,500 code changes a day into its monorepo, the single giant repository that holds its projects. By September it was more than 30,000 a day: twelve times as many in four months. The reason was Claude, its own AI, writing far more of the company's code than at almost any other company. So Anthropic hit the limits of everyone's tools first.

The first wall was source control, the system that records every change and merges everyone's work. The standard tool is Git, and Git was made for human programmers. Each person keeps a full copy of the repository and its whole history on their own computer, so they can work offline. For almost every repository in the world, that is still the right design.

Not for this one. A compressed copy of the monorepo is more than 25 gigabytes, and the test machines check it out about 25 million times a day. As full clones, that would be more than 600 petabytes moved every day. The engineers tried every trick Git has, shallow clones and sparse checkouts among them. At the peak they ran several hundred Git mirrors, and it still wasn't enough.

Then they noticed something. Git assumes every client is a person who might go offline at any moment. Almost none of their clients were people any more. They were AI agents and test jobs, and those are always online. The offline-first design that makes Git so good for humans was holding them back.

So they stopped patching Git and built their own system, Scion. The server does the heavy work: it answers every question about history, makes the commits and does the merges. An agent fetches only the files it needs, when it needs them, and a commit costs as much as the change, not as much as the whole repository. Scion runs on 200 times less infrastructure than the old mirrors, and a checkout takes seconds instead of minutes.

A team of seven built it, along with a new code review tool and half a dozen other systems, and moved the whole monorepo over in five months while all that growth went on. Claude helped build it. Every engineer on the team says Claude codes better than they do. Their work became understanding how the systems fit together, making the design decisions and, very often, telling Claude no.

They changed review too. Reviewers now check the intent of a change instead of reading every line. They dropped the global lock on the merge queue, so changes no longer wait their turn but merge at the same time, with more testing after the merge and before anything is deployed. When two changes collide, Claude usually fixes the conflict faster than a person could spot it. Writing code is no longer the bottleneck. The bottleneck is the infrastructure around it, and all of that was built for human scale.

There is an old saying: don't pave the cow paths. When a town grows along the trails cows wore into a field, it is easy to pave the trails. The right thing is to ask where the roads should go. Git is a brilliant cow path. Anthropic didn't make it faster. It asked what source control would look like if it were built for machines first. That kind of thinking is still rare. Even an org chart drawn on a blank sheet still assumes every box holds a person.

History says why it matters. In 1987 the economist Robert Solow wrote that you can see the computer age everywhere but in the productivity statistics. Companies had bought computers and kept working the same way. Factories did the same with electricity: they swapped the steam engine for one big electric motor, kept the shafts and belts, and for decades gained almost nothing. Agentic coding is at that point now. Give every engineer an agent, and if the code still squeezes through human-speed tools and habits, most of the gain is lost. Reading every line all day doesn't remove the bottleneck. It moves it from typing to reading. Economists call the delay the productivity J-curve: a dip while a company reorganises, then a steep rise.

For work, this is how post-labour arrives inside a company. Not as mass layoffs, at least not at first, but as compaction: output keeps rising while the number of people stays flat or shrinks. What do people still bring? He counts four things: accountability, long-term goals, relationships and trust, and the know-how nobody has written down yet. AI is already working on the last one.

And the pattern reaches far beyond code. Approvals sit in an inbox for a week. Meetings exist only to pass information along. Contracts pile up on a lawyer's desk. Papers wait months for peer review. All of these were built around how fast people read and how many hours they work, and most of the time goes into coordination: passing information and waiting for an answer. His rule: automate the coordination before you fire the coordinators.

He defines post-labour economics as the point where human labour is no longer the binding limit on what gets done. People still work. The amount of work done just no longer depends on how many people there are, or on how fast they read and type. So find every process built around the speed of a person, and ask what it would look like if it were built for a machine. That is where the next tenfold gain will come from.

## Beliefs that shift

- *Give everyone an AI agent and the gains follow.* → The gains wait behind tools and habits built for people. Swapping the engine and keeping the belts gives you Solow's paradox again.
- *Good review means reading every line.* → At machine speed, line-by-line reading just moves the bottleneck. Review the intent, let changes merge at the same time and test after the merge.
- *Post-labour means mass layoffs.* → It starts as compaction: output grows tenfold while the team stays the same size, and people's work moves to judgement, goals, trust and saying no.

## Key numbers

| What | Number, as the video gives it |
|---|---|
| Merges into the monorepo a day | about 2,500 in May 2026; more than 30,000 in September |
| Compressed working copy | more than 25 GB |
| Checkouts by test machines a day | about 25 million (600+ PB a day as full Git clones) |
| Git mirrors at the peak | several hundred |
| Scion's infrastructure | 200 times less than the old mirrors; checkouts in seconds, not minutes |
| Team and time | 7 people; the whole monorepo moved in 5 months |
| Other companies hitting the same limits | expected within 6 to 12 months |

## What we learn

- **maiaCITY already runs on the fire hose.** Pull request numbers went from #172 on 3 October to #788 on 16 October, and main took 111 merges on 13 October alone. Most of that code is written by Claude sessions in project threads. Samuel's own job looks like the Scion team's: the design decisions, strict rules such as the theOS laws, and telling Claude no.
- **We dropped the merge lock early.** The repository has no PR CI. A thread marks its own PR ready and merges it, and Samuel's standing rule is never to block shipping on long tests: screenshot, merge, test later. On the Mac, a watcher pulls main every minute so nobody rebuilds by hand. That is the same choice as concurrent merges with testing after the merge.
- **Review the intent, not the lines.** Every PR here opens with a Before and an After, and the thread hands Samuel a screenshot of the result, not the diff. That is close to the review Anthropic switched to.
- **theOS doesn't pave the org chart's cow path.** Even a blank-sheet org chart still puts a person in every box. In theOS there are no classic jobs inside the city. All work is a work proposal priced in MIND that an Aven proposes and delivers, and the paper gives every COOP an AI executive. The organisation is designed for machines first, and people own it.
- **His four human jobs have a home in theOS.** Accountability and long-term goals sit in proposals (MIPs) that a person accepts or rejects. Relationships and trust sit in COOP ownership and every citizen's share in the City COOP. Unwritten know-how is what the Avens' lessons in Sandbox 7 try to write down.
- **Compaction needs a pipe to every home.** Output that grows while headcount stays flat is the case from [the post-labour article](/blog/inspire-me/a-pipe-to-every-home/): the gain reaches people only through what they own, not through wages.
- **Expect the J-curve.** Sandbox 7 ran dozens of worlds, many of them ending in deaths, before its price rule held. That dip was the reorganising, not a sign that the idea failed.

## Open questions

- The narrator isn't named. His own definition of post-labour economics and his earlier "fire hose of code" prediction suggest the same channel as [the post-labour article](/blog/inspire-me/a-pipe-to-every-home/). Check the channel before adding an author.
- Every number about Scion comes from the video. None has a source here, so check them against Anthropic's own write-up before quoting.
- Our own cow path: each video still arrives by Samuel copying its transcript by hand, because YouTube is blocked from the cloud. Could his Mac fetch the transcript and hand it over, so no person passes it along?
- At thirty thousand changes a day, a single person accepting every MIP would be the new merge lock. Which proposals could pass on their own checks, and which need a person's yes?
