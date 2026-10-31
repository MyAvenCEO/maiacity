# The look

The maiaCITY look, from Samuel's references in [`style/reference/`](style/reference/): a calm settlement game seen
from above. The tokens are in [`style/tokens.css`](style/tokens.css); the parts every slide is drawn from in
[`style/slide.css`](style/slide.css). What Samuel agrees is marked with his name and the date; the rest is a proposal.

## The ground

- **Warm cream**, `--brain-cream` `#fbf1e1`, with large, faint low-poly **facets** a shade or two darker
  (`--brain-facet`, `--brain-facet-deep`). Facets are big and few, at the edges of the frame, never behind the subject.
- A **plot** is a soft rounded lot, `--brain-plot`, with a thin gold line: a place that belongs to someone.

## The objects

- **Flat low-poly, seen from above at an angle.** Every object is a few flat faces, no textures, no blends.
- **Light from the top left.** A face towards the light is the colour's `-light`, a face away from it its `-deep`, as
  hard stops in a gradient. Shadows fall to the lower right, soft and warm (`--brain-shadow`).
- **A thin dark warm outline** (`--brain-ink`) round every object, drawn by the `drawn` layer.
- Objects are iconic, not to scale: a key is as big as it needs to be to read.

## The palette

Sampled from the references (the values are in `tokens.css`):

| Colour | Light / mid / deep | Where |
|---|---|---|
| Teal | `#78a0a3` `#588087` `#3f646b` | water; avenID's mark |
| Terracotta | `#dca183` `#c98a6c` `#a5675a` | rocks, spires; avenDB's mark |
| Conifer green | `#6f8270` `#56695b` `#405246` | conifers; avenPEER's mark |
| Sage | `#aeb495` `#939a7c` | round trees, fields |
| Ochre | `#efcf9f` `#dbb17d` `#b98a59` | timber domes, a key, the glossary's mark |
| Glass blue | `#aac5d6` `#7d9db6` | glass domes, solar panels; avenOS's mark |
| Lattice white | `#fcf7ef` `#e8dfd3` `#d3c7ba` | geodesic domes |
| Ink | `#3b322b`, quiet `#6c5847` | outlines and text: 11.9:1 and 5.6:1 on the cream |

## The chrome

- **A panel:** rounded, off-white (`--brain-panel`), a thin gold border (`--brain-gold`), a soft lift.
- **A path:** a dotted ochre line (`--brain-path`) between two things, ending in a dot at each. It shows a relation.
- **A tag:** the relation's name, a small chip on its path: `OWNS`.
- **Titles** in a serif, Fraunces. **Labels** in small uppercase sans, Inter, spaced out. Both are bundled with
  avenOS, which makes no request off its origin.

## A slide

- A **16:9 frame** that reads as a still: one concept, its title in a panel at the top left, few labels.
- **Every element a layer** with a stable class, so a motion version can animate each one.
- The text that explains it is on the page under the frame, in Markdown, never crowded into the picture.
- Text in the frame has 4.5:1 against what is under it.

## The world as metaphor

| In the system | On a slide |
|---|---|
| a vault | a dome, a home, on its plot |
| a person | a settler |
| a device | a settler's tool |
| a key | a key, held by whoever keeps it |
| a relation | a dotted path, named on its tag |
| a coop (Maia City) | a settlement of domes |
