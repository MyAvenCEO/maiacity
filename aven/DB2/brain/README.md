# avenBRAIN

The documentation of the whole system, told from first principles for a reader with no background: a wiki of pages,
each built from slides that explain one concept at a time, and the one global glossary. avenOS shows it as **Brain**
(`#/brain`), to anyone, signed in or not: it is as public as the repo.

Its look is in [`STYLE.md`](STYLE.md), its language in [`VOICE.md`](VOICE.md), and
every term in [`GLOSSARY.md`](GLOSSARY.md).

## What is here

| Path | What |
|---|---|
| [`packages.json`](packages.json) | The package list: one item per package on Brain's dashboard, its page and its slides |
| [`GLOSSARY.md`](GLOSSARY.md) | The one glossary, every term with its one meaning (moved here from `aven/DB2`) |
| [`STYLE.md`](STYLE.md), [`VOICE.md`](VOICE.md) | The look and the language |
| [`style/tokens.css`](style/tokens.css) | The palette, type and chrome as tokens, sampled from the references |
| [`style/slide.css`](style/slide.css) | The slide: its ground, its type, its labels and dotted paths |
| [`style/reference/`](style/reference/) | The first references, from the game |
| [`id/`](id/README.md) | avenID's page: its story, and its slides in `id/slides/` |
| [`render/`](render/) | Markdown and slide markup to a checked node tree, links, contrast, and their tests |
| [`art/`](art/) | The objects drawn in code, their images by hash, and the slide layouts |

The first references, from the game (the look has since moved to the brand's UI, [`STYLE.md`](STYLE.md)):
- `scenes.webp`: First Settlers, Mountain Quarry Outpost, Coastal Solar Village, Thriving Abundance City;
- `places-and-domes.webp`: Desert Oasis Settlement, Alpine Forest Valley, inside the Food Forest Dome, inside the
  Solar Factory Dome;
- `asset-library.webp`: domes, trees, rocks, logs, a settler and a rover;
- `first-settlers-ui.webp`: the game's screen, with its resource bar, controls and minimap;
- `resource-icons.webp`: timber, stone, water, solar, tools and the rest.

## A slide

One concept, in three files under `<package>/slides/`, named by the slide's id:

- **`<id>.html`, the picture.** A 16:9 slide of allowlisted HTML: the face-runtime's node-tree allowlist
  (`aven/runtimes/spec/Aven/Runtime/Tree.lean`), so no `svg`, `style` or `script` and no inline `style`, and
  classes only. Every element is a layer with a stable class, so a motion version can move each one later.
- **`<id>.css`, where each layer stands.** Class rules only, every length in `cqw` (a hundredth of the slide's width).
  The objects are images by hash (`art/img/`), drawn in code (`art/objects.mjs`).
- **`<id>.md`, its text.** Markdown, shown on the page under the slide. `[vault](glossary:vault)` links a term to the
  glossary.

A slide is listed in `packages.json` under its package, in its place in the story. `render/tree.test.js` checks every
slide against the allowlist and that every element has a class (`bun test brain/render`).

## How avenOS draws it

Until the runtimes exist, avenOS draws the brain with its own Svelte (`os/web/brain`): the content is first-party, from
the repo, bundled at build time. Both kinds of text become the node tree the runtimes will hand over, and one
component draws it, never parsing HTML on the page:

- Markdown through `render/markdown.js`, the markdown-runtime's job: GitHub's Markdown as the brain writes it, raw
  HTML as text, links rewritten or dropped;
- a slide's markup through `render/tree.js`, which parses it and checks it against the allowlist, as the face-runtime
  will.

So the face-runtime and the markdown-runtime can take a slide over without a rewrite of the slide. The runtimes thread
builds both as code (31 Oct 2026); once they and the tree drawer land, the pages switch to them.

## What the runtimes plan lacks

The face-runtime's style is data: typed rules per class ([`aven/runtimes/README.md`](../../runtimes/README.md)). The
slides' CSS is written in the subset agreed with the runtimes thread, which `render/tree.test.js` holds it to: class
and tag selectors, plain values, no custom properties and no `url()`. Beyond colours, sizes and weights, it needs:

| Property | Used for |
|---|---|
| `position`, `inset`, `left`, `top`, `width`, `height` | where each layer stands |
| `container-type: inline-size` and `cqw` lengths | a slide that scales as one picture |
| `aspect-ratio` | the 16:9 slide |
| `transform` (`rotate`, `translateX`) and `transform-origin` | dotted path segments, arrowheads, centred labels |
| `border` (`dotted`), `border-radius` | dotted paths, the slide's corners |
| `clip-path: polygon(…)` | an arrowhead |
| `font-family`, `font-size`, `font-weight`, `line-height`, `letter-spacing`, `text-transform`, `text-align`, `white-space` | labels and titles; no text under 2.6cqw |
| `animation`, `@keyframes` | not used yet: the motion version will move the layers |

The node tree needs the allowlist's `img`, by hash: `figure`, `img`, `div`, `p`, `h2` and `header`, with `class`,
`src`, `alt`, `role` and `aria-label`.

## Drawing

The objects are drawn in code: [`art/objects.mjs`](art/objects.mjs), with the paint kit in
[`art/paint.mjs`](art/paint.mjs). `AVEN_CHROMIUM=<a Chromium> bun brain/art/render.mjs` renders each to a transparent
PNG in `art/img/`, named by the BLAKE3 hash of its bytes, as the network names its files, and lists them in
`art/images.json`. `bun brain/art/slides.mjs` lays out avenID's slides and writes their markup and CSS, and each sheet again as
the face-runtime's style data (`<id>.style.json`, `style/slide.style.json`, by `render/style.js`, which reads only the
agreed subset and throws on anything else). A test holds each `.style.json` to its sheet, and the runtimes' vector for
"A key signs" to the brain's own rules. A slide shows
a drawing as `<img src="/files/<hash>">`, the only image the allowlist takes; avenOS resolves the brain's own from its
bundle (`os/web/brain/brain.js`). Both outputs are generated: edit the objects and the layouts, then run them.

## Releases

A change here ships with avenOS: `aven/DB2/brain` is one of avenOS's paths in `.github/workflows/avensandbox.yml`.
