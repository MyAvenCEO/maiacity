# Shots: what each line is shown with

How the words become pictures: the facts that may be shown, how many shots a line gets and how they differ, and the named thing on screen as it is said. Learned on **Day 19 · A city in its own garden** (`scripts/film/day-19-d.mjs`; the weaker first cut `scripts/film/day-19.mjs` shows what not to do).

## Facts on screen

- **Never promise what the world can't show.** Sandbox 4 has **no people**: never narrate people doing things on
  screen. Say what the place gives them ("every home opens onto a wide terrace") and show the place.
- Dome words, spelled right: dome, dome cell, master dome, dome factory. The master dome is **the commons**
  (workshops, young and old learning from each other, the stone theatre) — not where everyone eats.

## Shot grammar

**Every line gets 2–4 shots:** establishing (EWS/WS) → MS → CU/ECU/macro inserts. Vary each:
- **Height:** drone (y 30–150), eye level (1.6), ground macro (0.05–0.3).
- **Lens:** long (fov 10–20) compresses space and gives close-ups from a distance (mango at 12, "picked ripe" at
  10); wide (45–55) shows space.
- **Movement:** push-in, pull-back, lateral dolly, crane, orbit — and never a dead locked-off frame (below).
- **Never cut two same-size shots in a row.** The one exception is a deliberate close-up montage (mango → fig →
  coffee).

## Cut on the spoken word

Every named thing is on screen as it is said: the mango on "mango", the hens on "hens", the bees on "and bees". Use
`cue: [line, 'words']`. `cueAt()` finds the phrase in the take's word timings and throws `cue not found` if the words
don't match the take's text.

## Film what it felt like, not what happened

When nothing much "happens" on the outside, give the inner story something to see: for freedom, floating over the
concrete (lying on a skateboard, a friend pulling); for avoidance, running through the woods with no one chasing
(Tim Runia, `inspire-me/what-changed-not-what-happened/`). The shot is chosen for the feeling of the line, then cued on
its words.
