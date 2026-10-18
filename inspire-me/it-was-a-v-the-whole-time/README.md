---
title: It was a V the whole time
originalTitle: Former OpenAI Researcher Makes a MASSIVE AI Discovery
source: https://www.youtube.com/watch?v=2mE6bbjVazE
type: video
author: TheAIGRID
authorUrl: https://www.youtube.com/@TheAiGrid
published: 2026-10-17
added: 2026-10-18
categories: [ai, code]
hook: >-
  For years, the most famous neuron in AI fired on cats and on cars, and it proved that the inside of a
  model is a junk drawer. Then a researcher looked at it for a few seconds and asked what one thing it could be.
shift:
  from: The inside of an AI is a tangle of neurons that each hold random, unrelated ideas, so nobody can read it directly.
  to: Most neurons have one job that grew outward step by step, like branches. With better tools you can read them, and finding out what a model does becomes normal science.
quote: "It was a V the whole time."
quoteBy: Nick Cammarata
---

## The story

A neuron that fires on cats' faces and on the fronts of cars. For years, that was the picture of how lost we are inside AI.

The companies that build models know how to train them. They don't know what happens inside when a model answers. A model is billions of tiny switches that nobody labelled, because the model set them itself by reading. If you can't see inside, you can't check whether it is honest, or whether it has picked up a dangerous habit that hasn't shown yet. The field that tries to look is called interpretability.

And for years it held a depressing belief. Many neurons seemed to have several unrelated jobs, which the field calls polysemantic. In the last layer of an old image model, Inception V1, almost none could be read. The explanation was superposition: a model has more ideas than neurons, so it crams unrelated ideas into the same neuron, like a drawer you fill with whatever fits. If that is true, looking at a neuron tells you almost nothing. So researchers stopped reading neurons and trained a second model, a sparse autoencoder, to untangle the first. The numbers agreed with the gloom. In 2023, Anthropic gave the typical neuron in a small language model a score of zero out of 14. An OpenAI project the same year could explain about 1.7% of neurons.

Nick Cammarata started that OpenAI project. Cammarata co-wrote "Zoom In" with Chris Olah in 2020 and works today at Goodfire, a lab that does nothing but this. After months of finding neuron after neuron that was clean, Cammarata went back to the cat-and-car neuron, which Cammarata had looked at hundreds of times, and for once asked: what one thing could this be?

A V. The pointed face of a cat, with its ears and chin. The front of a car, with the grille and the bonnet sloping to a point. The neuron also fired on V-shaped flames and on the V of water spraying from a fireboat. Push it the other way and the strongest opposite was an O, something round, exactly where the V points. A random mix of cats and cars would need no opposite. A V detector does. The sparse autoencoder, the tool meant to untangle it, split the V into a cat piece and a car piece, so it made the neuron look more tangled than it was. The famous circuit that seemed to hide a car inside dog neurons, which Cammarata and Olah had published, turned out to be about pose: car and dogs all faced the camera.

So why did the neurons look like a mess? Cammarata trained the old model again and watched one neuron as it learned. It began on yellow rapeseed fields, some of them with a dog sitting in the field. It reached for other things in those photos: green and yellow round things like tennis balls, dogs in grass, then shaggy dogs with a tennis ball, and at last broccoli. At the end it was tennis balls, terriers and broccoli, and the fields were almost gone. Seen only at the end, it is nonsense. Watched as it grew, each step follows from the last one.

The rest was bad tools. In the deep layers, the method that draws what a neuron "wants to see" found that dog features made almost anything fire, so neurons looked like they were secretly about dogs. Explanations were graded on whether they predicted firing, not on whether they were true. With better tools and a more modern design, and no bigger model or new data, Cammarata says 99% of the neurons in that last layer are now easy to read, at every size across a 300-fold range. Give the model fewer neurons and it doesn't cram. Each neuron just covers a broader idea, cars in general, and with more neurons the broad ideas split. That is a tree, not a drawer.

Then the chatbots. In Qwen3-32B, an open model, about 90% of neurons had one main job, about 7% had two related ones, and 2 to 4% are not understood yet. A neuron grew from the letters "iy" to "DIY" to "do it yourself", which has no "iy" in it at all. One that seemed to fire on commas was tracking whether the sentence so far was about Colorado. Turn it up and the model wants to plan a hike. Remove only the strongest signals in a few neurons and the model says Psalm 23 is not a known work, and invents a Declaration of Independence for a Republic of Luzang. Bigger models may even be easier: a small town has no financial district, but in New York you find it on a map in a minute.

It isn't settled. Cammarata calls the essay a working hypothesis, about 85% sure, with the language-model paper still being written and the trillion-parameter models nowhere near solved. Within days someone had Claude check the Colorado neuron and found it fired just as strongly on code for Tornado, a Python library. Roman Yampolskiy warned that reading a model also helps a model edit itself.

The claim that survives is smaller and stranger. The neurons were never a junk drawer. They grew, and their mixes are clues. In Cammarata's words, the goal is to become another reader: everything in a network was built to be read by the parts after it. If we read it the way it reads itself, finding out what a model does becomes normal science. Guess, test, fill in the map.

## Beliefs that shift

- *A neuron that fires on unrelated things holds random ideas.* → It usually grew there one step at a time. Trace the steps and the mix becomes a clue to how the model connects ideas.
- *To understand a model you need a second model to untangle it.* → The untangling tool can split one clean idea in two. Read the neurons first, with tools that are tuned and graded on what is true.
- *Bigger models will be harder to understand.* → Size can bring order. Ideas get their own neurons, the way a big city has a financial district a small town never needs.

## Key numbers

| What | Number, as the video gives it |
|---|---|
| Typical neuron, Anthropic, 2023 | 0 out of 14 on its readability score |
| Neurons explained, OpenAI project, 2023 | about 1.7% |
| Last layer of the old image model, now | 99% easy to read, across a 300-fold range in size |
| Qwen3-32B, first audit | about 90% one job, 7% two related jobs, 2–4% not understood |
| Cammarata's own confidence | about 85% |
| Goodfire's raise | $150 million at a $1.25 billion valuation |

## What we learn

- **Open weights are the ones you can read.** The audit ran on Qwen3-32B because anyone can open it. A rented closed model can only be watched from the outside. Our research note on running Liquid's d1-3B on an M1 through llama.cpp makes the same point for maiaCITY: a COOP that owns its inference hardware and runs open weights can look inside the model it depends on.
- **Signing a proposal checks the output, not the intent.** In theOS, an Aven bundles a change as a proposal and people sign it under declarative policies. That is the outside check, and the video notes that the newest models can often tell when they are being tested. Readable neurons would add the x-ray. Until then, keep the human signature on every change.
- **Watch it grow, keep the history.** The tennis-ball, terrier and broccoli neuron only makes sense across its training. That is why avenDB keeps every version and variant of an asset as one entry with its history: a strange end state can be traced back one step at a time instead of being judged as it stands.
- **A city specialises as it grows.** The financial district only exists in the big city. Our hexes work the same way: one hex is a settlement that does a bit of everything, and at seven hexes a village has a centre that holds the geothermal plant. Specialised parts are easier to find and to check.
- **Grade by truth, not by a good guess.** Old explanations scored well when they predicted firing, even when they were wrong. The Tornado finding came from asking Claude to hunt for a counterexample. Our report cards already put every unchecked claim into Open questions. An agent's next step can be to look for the case that breaks a claim before anyone quotes it.
- **Reading a model is also editing it, so an edit is a proposal.** Turning the Colorado neuron up changed what the model wanted. A COOP-owned model edited that way changes behaviour as much as a rule change does. It should go through an AIP like any other change, signed by people, never by the Aven it changes.

## Open questions

- Every number here comes from a video about an essay, and the language-model paper isn't out yet. Check the 99%, the 90%, the 1.7%, the zero out of 14 and Goodfire's raise against Cammarata's essay "Neural networks are already clean" (2026-10-15) before quoting them.
- The captions are YouTube's automatic ones. Several names (people quoted from X) are probably mis-heard, so source.md leaves them as heard. Check before naming anyone else.
- Could we audit the small open model we would run on the Mac ourselves? A first look at a few neurons of d1-3B would show whether this works below 32 billion parameters and what it costs.
- Cammarata cares partly because agents never asked to be created, and helping them understand themselves is the least we can do. In theOS every Aven is owned by one human. Does an Aven get to read itself?
