# The look

The maiaCITY look, from the references in [`style/reference/`](style/reference/). They set the look only:
**no metaphors from the game**. A slide draws the concept itself (a key, a vault and its list of
owners, an arrow for a relation), never a dome, a settler or a settlement standing for it.

The tokens are in [`style/tokens.css`](style/tokens.css); the parts every slide is drawn from in
[`style/slide.css`](style/slide.css).

## The ground

- **Warm cream**, `--brain-cream` `#fbf1e1`, with large, faint low-poly **facets** a shade or two darker
  (`--brain-facet`, `--brain-facet-deep`). Facets are big and few, at the edges of the frame, never behind the subject.

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
| Teal | `#78a0a3` `#588087` `#3f646b` | a vault's slab; avenID's mark |
| Terracotta | `#dca183` `#c98a6c` `#a5675a` | avenDB's mark |
| Conifer green | `#6f8270` `#56695b` `#405246` | avenPEER's mark |
| Sage | `#aeb495` `#939a7c` | the architecture's mark |
| Ochre | `#efcf9f` `#dbb17d` `#b98a59` | a key; the glossary's mark |
| Glass blue | `#aac5d6` `#7d9db6` | avenOS's mark |
| Ink | `#3b322b`, quiet `#6c5847` | outlines and text: 11.9:1 and 5.6:1 on the cream |

## The chrome

- **A panel:** rounded, off-white (`--brain-panel`), a thin gold border (`--brain-gold`), a soft lift.
- **An arrow:** a relation from one thing to another, in ink, its name above it in small uppercase: `OWNS`.
- **A record:** a thing the system keeps (a vault), drawn as a card on a low-poly slab, with its fields in it.
- **Titles** in a serif, Fraunces. **Labels** in small uppercase sans, Inter, spaced out. Both are bundled with
  avenOS, which makes no request off its origin.

## A slide

- A **16:9 frame** that reads as a still: one concept, its title in a panel at the top left, few labels.
- **Every element a layer** with a stable class, so a motion version can animate each one.
- The text that explains it is on the page under the frame, in Markdown, never crowded into the picture.
- Text in the frame has 4.5:1 against what is under it.
