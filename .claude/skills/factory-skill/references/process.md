# Process numbers

How to turn a one line request into stations with numbers a process engineer would accept.
Every value here is a typical starting point, not a quote for a specific plant. Put the value
you use and why in the station's `note`.

## Pick the scope

- Name the product variant ("250 W rear hub motor", "4680 cylindrical cell", "butter croissant 60 g").
- Name the boundary: where raw material arrives and what leaves (a pallet, a case, a crated unit).
- Long dwell steps measured in days (fermentation, cell ageing, concrete curing) belong outside the
  hall or must be stated as simplified out. Say so in the spec comment and in your answer.

## Cycle time, batch, dwell

| kind of step | model it as | typical |
|---|---|---|
| machine that processes one unit at a time | `ct` per unit, `cv` 0.02 to 0.06 | CNC part 2 to 20 min, press stroke 0.3 to 2 s per hit, robot weld 30 to 120 s |
| manual assembly | `ct` per unit, `cv` 0.1 to 0.2 | bench assembly 1 to 10 min, wiring harness 5 to 15 min |
| test | `ct`, `yield` 0.95 to 0.995 | EOL electrical 30 to 120 s, flight test 3 to 5 min, vibration 1 to 3 h |
| batch (load, process, unload together) | `ct` per batch + `batch` | chamber oven 30 to 60 min, mixer 10 to 15 min, TVAC 12 to 24 h |
| continuous dwell (units ride through) | `ct` = dwell time, `perMachine` = units inside one machine | tunnel oven 15 to 20 min, spiral cooler 20 to 40 min, proofer 60 to 90 min, pasteurizer 15 to 25 min, cell formation 8 to 20 h |
| web or roll process | `ct` per tray or roll equivalent | coater 40 to 80 m/min, calender, slitter |

## Breakdowns

`mtbf` counts busy seconds between failures, `mttr` the repair. Availability A = MTBF / (MTBF + MTTR).

| equipment | MTBF | MTTR |
|---|---|---|
| press, stamping | 4 to 8 h | 15 to 30 min |
| winder, high speed automation | 2 to 5 h | 10 to 20 min |
| CNC | 8 to 40 h | 20 min to 2 h |
| robot cell | 5 to 10 h | 10 to 20 min |
| filler, seamer, packer | 3 to 6 h | 10 to 15 min |
| ovens, tanks, chambers | 30 to 300 h | 40 min to 6 h |
| manual benches | none | none |

## Calendar

Discrete assembly: 2 shifts of 8 h. Process industries (cells, chemicals, glass, bakeries at scale):
3 shifts. State it.

## Sizing

`machines = CEIL(rate_in x ct / (batch x A x targetUtil))`, where `rate_in` is demand divided by
the yield of the station and every station after it. targetUtil 0.85 is a sensible default; use 0.75
for highly variable manual work and 0.9 for very stable automation. The runtime applies it for
`servers: 'auto'`; set a number only when the user names one ("we have 3 CNCs").

## Tokens

If takt per unit is under about 5 s, a token is a carrier: a tray, a case, a tote. Pick the carrier
the real line uses. The HUD multiplies back to units.

## Reading check.mjs

- A station at 95 % busy + down with 0 % starved and machines before it blocked: the constraint.
- A station mostly blocked: the next station is slower or its buffer is too small.
- A station mostly starved: upstream supplies it below its capacity.
- High down share on the constraint: availability is the lever, not another machine.
- Throughput well above target: sizing headroom (targetUtil). Fine, say so.
