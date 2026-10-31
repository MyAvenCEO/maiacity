# The look

The brand's look: calm, natural and clear. Deep forest green and sage on a warm off-white ground, soft white cards,
an elegant serif for headlines and a clean sans for the rest, with a touch of lime. The game's pictures in
[`style/reference/`](style/reference/) were the first references; the look now follows the brand's UI references, and
no slide uses the game's world as a metaphor. A slide draws the concept itself: a key, a vault and its list of owners,
an arrow for a relation.

The tokens are in [`style/tokens.css`](style/tokens.css); the parts every slide is drawn from in
[`style/slide.css`](style/slide.css).

## The palette

| Token | Value | Where |
|---|---|---|
| Ground | `#f3efe7` | the page |
| Card | `#fffdf9` | cards on the page and on slides |
| Sage, soft | `#e2e6d3` | a slide's panel, a marked row |
| Sage | `#c9d0b0` | a device's vault, brackets |
| Forest | `#1f3d2b`, lit `#3a5a44` | keys, arrows, relation pills, the selected item, a live package's mark |
| Olive, moss | `#4a5a3a`, `#8fa27c` | a public key, coming packages' marks |
| Lime | `#d9e27a` | a tick, a seal's ring, an agent's vault: one accent, used sparingly |
| Blush | `#f4e4d7` | a cap |
| Ink, quiet | `#1d2a21`, `#56634f` | text: 13:1 and 5.6:1 on the ground, 5:1 on the soft sage |

## Shapes

- **Cards:** white, large radius (24 px on the page, 2.4cqw on a slide), a soft green-tinted shadow, no border.
- **Pills:** a record's kind in its tone, a relation's name in forest with cream text, chips and the index's selected
  item.
- **Flat shapes, no outlines.** A shape's lit side is a step lighter, as a hard stop. Nothing is textured or blended.
- **Type:** headlines in Fraunces, everything else in Inter, in sentence case. Both are bundled with avenOS, which
  makes no request off its origin.

## A slide

- A **16:9 frame** that reads as a still: one concept, its headline at the top left, few words.
- **No text under 2.6 % of the frame's width** (2.6cqw): about 9 px on a phone, where the frame is about 356 px wide.
  The box checks it at 390 px (`sandbox/docs.mjs`), and a test checks the CSS (`render/tree.test.js`).
- Text has 4.5:1 against what is under it, and sits either on the panel or on the part that holds it (a card, a pill,
  a chip), never on a placed shape, so what the face-runtime checks is what a reader sees.
- **Every element a layer** with a stable class, so a motion version can animate each one.
- The text that explains it is on the page under the frame, in Markdown. The frame's headline stands for its title,
  and the slide's number is in the page's index.
