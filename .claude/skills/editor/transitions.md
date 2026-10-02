# Transitions: how one shot hands over to the next

Hard cuts are the default. Everything else is chosen for what it does to the viewer, here and there, never on every
cut — and **each transition keeps one meaning for the whole film** (Kirk Baxter: in *Gone Girl* a fade to black always
meant a jump back in time).

## Hard cuts only

**No dissolves. Never black frames between cuts.** Fade up only at the very start and out only at the very end.
The cut types:
- **Scale smash:** ECU → EWS (dew → the whole cell before dawn).
- **Smash cut, warm ↔ cold,** into and out of the low.
- **Match cut on shape:** solar-cell lattice → dome; geodesic node → the whole dome.
- **Cut on action:** the move continues across the cut, in the same direction.
- **Cut on the music's swell.**
- **J-cuts:** the next scene's sound starts about 0.5 s before its picture.

## Cinematic transitions (here and there, never on every cut)

- **Match on motion:** the flight ends moving east, the sunrise shot goes on pushing east.
- **Whip pan:** `whip(path, { out })` flicks the end of one shot sideways, `whip(path, { into })` the start of the
  next, the same way round; give both `blur: 6` so the hard cut hides inside the smear. Use it to jump between places.
- **One continuous drone flight** for the hook: `fly([[pos, aim], …])`, a Catmull-Rom path through several points
  (up out of the forest floor, over the canopy, out to the overview).
- **Time-lapse in a shot:** `hour` → `hourTo` moves the sun during the shot (sunrise 5.05 → 5.4); `fov` → `fovTo`
  zooms.
- **Smash cut** into the low, with a hit on the cut (`sound-designer`).

**Sound matches the picture:** you hear the geese when you see them (`sound-designer`).

> The render (the Mac app, `vault/crates/vault-render`) cuts hard: shots that meet on V1 never crossfade.
> `scripts/film/assemble.mjs` is the older, pre-studio cut and still dissolves — don't use it for new films. Still
> check every render for black frames.

## The catalogue

What the masters use, what each does, and when it turns into a cliché. Our render cuts hard (shots that meet on V1
never crossfade): a dissolve or a fade other than the film's first and last would have to be built first.

| Transition | What it does | Use it when | A cliché when | Example |
|---|---|---|---|---|
| Hard cut | an instant change, invisible when motivated | the default; on the thought | the new shot adds nothing | everything |
| Match on action | hides the join inside a movement | one action across two angles | a mechanical overlap stutters (Murch) | classical continuity |
| Graphic match | links two ideas through one shape | a big leap in time or idea | a shape rhyme with no idea behind it | *2001*: the bone becomes a satellite |
| Sound bridge, sound match | sound carries us between spaces, or from the world into a mind | into a memory, a vision, another world | the pun is the whole point | *Apocalypse Now*: ceiling fan ↔ helicopter blades |
| J cut | the next scene heard before it is seen: anticipation | scene entries; a voice leading the picture | every cut split, mushy edges | dialogue and documentary practice |
| L cut | the sound lingers while we watch the words land | reactions | reflexive on every line | *Top Gun: Maverick*: Rooster's line over Maverick's face |
| Smash cut | an abrupt jolt in tone or volume | contradiction, shock, waking up; into our low | to prop up a flat scene | *Last Crusade*: "he'll blend in" → Brody lost in a bazaar |
| Jump cut | the same frame, time removed: energy | a talking head, compression, unease | removing ums with no rhythm | *Breathless*; YouTube's talking heads |
| Cross-cut | two lines at once: suspense, comparison, quickening towards a meeting | two strands that will collide | strands that never touch each other | *Inception*, *Dunkirk* |
| Cutaway, insert | the detail; cover; Kuleshov meaning | covering a voice edit; showing what is seen | illustrating every noun literally | Kuleshov's bowl of soup |
| Montage | compresses time or a process | building, travel, change | the formula training montage | *Rocky* |
| Whip pan | a blur that bridges two places and hides a cut | joining places at speed | on every scene change | Chazelle, Edgar Wright; LifeOfRiza's handheld-to-tripod whip |
| Hidden cut | a dark foreground or a move hides the join: one continuous take | immersion in unbroken time | when the oner matters more than the story | *Rope*, *1917* |
| Dissolve | time passing, a change of place, memory, a dream; slows the rhythm | real elapsed time, a memory, the end | as default glue: a slideshow | *Citizen Kane*; *Psycho*'s drain → eye |
| Fade to/from black | a full stop; a chapter; a time jump | the end; one fixed meaning | mid-scene; mixed meanings | *1917*'s single blackout |
| Freeze frame | stops time: a moment becomes a portrait | a life-defining beat; an ending | the 1970s TV episode ending | *The 400 Blows*, *Goodfellas* |
| Speed ramp | stretches a peak inside one shot | perception, impact | on every action beat | *The Matrix* |
| Cut on the beat | locks picture to music: propulsion | montage, musical sequences | every cut on the downbeat | *Baby Driver*, *Whiplash* |

## Eisenstein's montage methods

- **Metric:** shot lengths by formula, shrinking to accelerate.
- **Rhythmic:** the content sets the length too; acceleration by packing more intensity into the same time (the Odessa
  Steps, where the pram takes over from the boots).
- **Tonal:** the images' emotional dominant (*Potemkin*'s fog in the port).
- **Overtonal:** all of these together.
- **Intellectual:** a collision that makes a concept (*Strike*: workers and slaughtered cattle).

## Transitions between Samuel's room and the worlds

Cheap in 3D, so ration them — a device repeated becomes a tic:
- J-cut the real room's sound into the rendered world (Murch's fan into helicopters).
- An iPhone whip into a rendered whip (`whip(path, { into })`).
- The 3D camera crossing a dark doorframe (*Rope*'s jacket backs) for a hidden cut.
- A match from the real bedroom to its rendered twin at the same pose — then the twin's walls open onto the world.
- The fade to black only for the end or a time jump, with that one meaning.

Sources: Baxter (provideocoalition.com/art-of-the-cut-with-kirk-baxter-a-c-e-on-cutting-gone-girl-in-premiere); Murch
(provideocoalition.com/aotc-murch-films; cinemontage.org/walter-murch-apocalypse-now); Eisenstein, "The Fourth
Dimension in Cinema" (torch.ox.ac.uk); Wikipedia: Match cut, Smash cut, Jump cut, Cross-cutting, J cut, Dissolve, Freeze
frame, Whip pan, Speed ramping.
