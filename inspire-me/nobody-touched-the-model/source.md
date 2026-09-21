Source: https://www.youtube.com/watch?v=LoLYw--s-5w

Note: a Fireship "code report" segment dated 17 September 2026. Below are the claims the
report card is built on, in the order the piece makes them. The sponsor read at the end is
omitted. Some names are rendered phonetically in the auto-transcript and are corrected here.

---

**The premise.** In 1965 the British mathematician I. J. Good — who spent the Second World War
at Bletchley Park alongside Alan Turing — wrote that the first ultra-intelligent machine would
be the last invention humans ever need to make. Once an AI is good enough to improve itself,
each improvement makes it better at improving. This is recursive self-improvement (RSI), and it
has been the field's goal ever since.

**Paper one.** The week before filming, 33 researchers from ByteDance, Tsinghua and other
Chinese labs published a paper titled *The Last AI Built by Humans*, laying out a five-stage
roadmap for RSI whose final stage has the AI rewriting the process it used to improve itself.

**Paper two.** Days later, Google DeepMind and the University of Maryland published a paper the
clip refers to as *Dream RSI*. The claim: by turning an AI's old discovery logs into a
simulator and letting it dream up thousands of new search strategies inside it, the AI got
better at discovering things without anyone touching the model itself.

**The standard loop.** Every recent AI mathematics breakthrough used the process AlphaEvolve
popularised the previous year: take a coding agent, hand it a problem and a scoring function,
then run a loop where it proposes a solution, evaluates it, reads the feedback and tries again
a few thousand times. This produced the Jacobian conjecture result that summer, and was what
OpenAI used on the Navier–Stokes problem earlier that month.

**Exploration policy.** The part of the loop nobody discusses: at every step there is a decision
about what the agent tries next. If one attempt scores slightly better than others, does the
agent build on it or start over with something potentially better? If an attempt crashes before
producing a result, is the idea bad or only the implementation? Until now this policy was
hardcoded by whoever set up the loop.

**The insight.** If you save everything from every attempt — the code it wrote, the score it
got, whether it crashed — you do not need to touch the model again to test a new policy. You
show the new policy the old runs cached on disk and let it decide where it would have gone from
there. Because that costs nothing, the agent can test thousands of different policies against
the same run, keep whichever would have reached the best result in the fewest attempts, deploy
that policy on the next real run, save that run too, and repeat. The paper calls this dreaming.

**The test.** Gemini was pointed at eight problems across algorithm design and mathematics, and
the same setup was run with a fixed policy for comparison. The most notable result: a lasso
solver beating Python's standard machine-learning library in about 300 tries, where the static
policy needed 550 and the previous record holder needed roughly 51,000.

**The prompt.** Described as the most interesting part — it asks the agent to read every past
attempt before writing any code, to stop making tiny tweaks to the same idea repeatedly, and
not to kill any processes.

**Is it RSI?** By Good's definition, no. The model writing each new exploration policy is still
the same Gemini, so it can never find a solution it was not already capable of writing; it just
finds them faster and with fewer wasted attempts.

**The wider point.** That is also true of every AI mathematics breakthrough of the year. The
Jacobian conjecture, Navier–Stokes and progress on the Riemann hypothesis all came from static
models wrapped in a custom harness, with sub-agents, swarms and orchestration doing most of the
heavy lifting. The weights only improve when a human goes back and trains the next model on
what the swarm found. The closing judgement offered: with a human in the loop it might count;
otherwise it is a cool search algorithm with some caching.
