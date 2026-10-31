# avenBRAIN

The documentation of the whole system, told from first principles for a reader with no background: a wiki of pages,
each built from slides that explain one concept at a time, and the one global glossary. avenOS shows it under **Docs**
(`#/docs`), to anyone, signed in or not: it is as public as the repo.

Its look is in [`STYLE.md`](STYLE.md), its language in [`VOICE.md`](VOICE.md), and
every term in [`GLOSSARY.md`](GLOSSARY.md).

## What is here

| Path | What |
|---|---|
| [`docs.json`](docs.json) | The catalogue: one item per package on the docs dashboard, its page and its slides |
| [`GLOSSARY.md`](GLOSSARY.md) | The one glossary, every term with its one meaning (moved here from `aven/DB2`) |
| [`STYLE.md`](STYLE.md), [`VOICE.md`](VOICE.md) | The look and the language |
| [`style/tokens.css`](style/tokens.css) | The palette, type and chrome as tokens, sampled from the references |
| [`style/slide.css`](style/slide.css) | The frame and the parts every illustration is drawn from |
| [`style/reference/`](style/reference/) | The first references, from the game |
| [`id/`](id/README.md) | avenID's page: its story, and its slides in `id/slides/` |
| [`render/`](render/) | Markdown and slide markup to a checked node tree, and its tests |

The first references, from the game (the look has since moved to the brand's UI, [`STYLE.md`](STYLE.md)):
- `scenes.webp`: First Settlers, Mountain Quarry Outpost, Coastal Solar Village, Thriving Abundance City;
- `places-and-domes.webp`: Desert Oasis Settlement, Alpine Forest Valley, inside the Food Forest Dome, inside the
  Solar Factory Dome;
- `asset-library.webp`: domes, trees, rocks, logs, a settler and a rover;
- `first-settlers-ui.webp`: the game's screen, with its resource bar, controls and minimap;
- `resource-icons.webp`: timber, stone, water, solar, tools and the rest.

## A slide

One concept, in three files under `<package>/slides/`, named by the slide's id:

- **`<id>.html`, the still.** A 16:9 frame of allowlisted HTML: the face-runtime's node-tree allowlist
  (`aven/runtimes/spec/Aven/Runtime/Tree.lean`), so no `svg`, `style` or `script` and no inline `style`, and
  classes only. Every element is a layer with a stable class, so a motion version can move each one later.
- **`<id>.css`, where each layer stands.** Class rules only, every length in `cqw` (a hundredth of the frame's width).
  The parts themselves (a key, an arrow, a vault's record) are in `style/slide.css`, shared by every slide.
- **`<id>.md`, its text.** Markdown, shown on the page under the still. `[vault](glossary:vault)` links a term to the
  glossary.

A slide is listed in `docs.json` under its package, in its place in the story. `render/tree.test.js` checks every
slide against the allowlist and that every element has a class (`bun test brain/render`).

## How avenOS draws it

Until the runtimes exist, avenOS draws the brain with its own Svelte (`os/web/docs`): the content is first-party, from
the repo, bundled at build time. Both kinds of text become the node tree the runtimes will hand over, and one
component draws it, never parsing HTML on the page:

- Markdown through `render/markdown.js`, the markdown-runtime's job: GitHub's Markdown as the brain writes it, raw
  HTML as text, links rewritten or dropped;
- a slide's markup through `render/tree.js`, which parses it and checks it against the allowlist, as the face-runtime
  will.

So the face-runtime and the markdown-runtime can take a slide over without a rewrite of the slide. The runtimes thread
builds both as code (31 Oct 2026); once they and the tree drawer land, the pages switch to them.

## What the runtimes plan lacks

The face-runtime's style is data: a class name, and typed colours, size and weight per rule
([`aven/runtimes/README.md`](../../runtimes/README.md)). The style uses more than that. As input for the runtimes plan,
the CSS a slide needs:

| Property | Used for |
|---|---|
| `clip-path` (`polygon`, `inset`) | an arrow's head, a fingerprint's rings |
| `transform` (`rotate`, `translateX`, `scale`) and `transform-origin` | a key at an angle, scaled down in a list, centred labels |
| `filter` (`drop-shadow`) | the soft shadow under a card or a part |
| `linear-gradient` with hard stops | a key's lit side |
| `position: absolute`, `inset`, `left`, `top`, `width`, `height` | where each layer stands in the frame |
| `container-type: inline-size` and `cqw` lengths | a still that scales as one picture |
| `aspect-ratio` | the 16:9 frame |
| `border`, `border-radius` | cards, pills, a seal's ring, a bracket |
| `letter-spacing`, `text-transform`, `white-space`, `text-align`, `font` | the uppercase labels, notes and the serif titles; no text under 2.6cqw |
| `display: flex`, `gap`, `display: inline-block` | a row of chips; a record's field names |
| `box-shadow`, `overflow` | panels |
| `animation`, `@keyframes`, `transition` | not used yet: the motion version of a slide will |

The node tree needs nothing beyond the allowlist: `figure`, `div`, `span`, `p`, `b`, `h2` and `header`, with `class`,
`role` and `aria-label`.

## Releases

A change here ships with avenOS: `aven/DB2/brain` is one of avenOS's paths in `.github/workflows/avensandbox.yml`.
