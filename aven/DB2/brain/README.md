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
| [`style/slide.style.json`](style/slide.style.json) | The slide as style data: its ground, its type, its labels and dotted paths |
| [`style/reference/`](style/reference/) | The first references, from the game |
| [`id/`](id/README.md) | avenID's page: its story, and its slides in `id/slides/` |
| [`render/`](render/) | Contrast, as Face.lean computes it, and its test |
| [`art/`](art/) | The objects drawn in code, their images by hash, and the slide layouts |

The first references, from the game (the look has since moved to the brand's UI, [`STYLE.md`](STYLE.md)):
- `scenes.webp`: First Settlers, Mountain Quarry Outpost, Coastal Solar Village, Thriving Abundance City;
- `places-and-domes.webp`: Desert Oasis Settlement, Alpine Forest Valley, inside the Food Forest Dome, inside the
  Solar Factory Dome;
- `asset-library.webp`: domes, trees, rocks, logs, a settler and a rover;
- `first-settlers-ui.webp`: the game's screen, with its resource bar, controls and minimap;
- `resource-icons.webp`: timber, stone, water, solar, tools and the rest.

## A slide

One concept, in files under `<package>/slides/`, named by the slide's id:

- **`<id>.html`, the picture.** A 16:9 slide of allowlisted HTML: the face-runtime's node-tree allowlist
  (`aven/runtimes/spec/Aven/Runtime/Tree.lean`), so no `svg`, `style` or `script` and no inline `style`, and
  classes only. Every element is a layer with a stable class, so a motion version can move each one later.
- **`<id>.style.json`, where each layer stands.** The face-runtime's style data (`Style.lean`), one rule per line:
  classes only, every length in `cqw` or `%`, a colour as `{ "bytes": "rrggbb" }`. It is the only source of the
  slide's style. The objects are images by hash (`art/img/`), drawn in code (`art/objects.mjs`).
- **`<id>.part.json`, the whole face part.** Its markup in `FaceRuntime.lean`'s forms and every rule it needs,
  `style/slide.style.json`'s first: what avenOS draws. `art/slides.mjs` writes it from the `.html` and the
  `.style.json`, which stay its sources and the tests' references.
- **`<id>.md`, its text.** Markdown, shown on the page under the slide. `[vault](glossary:vault)` links a term to the
  glossary.

A slide is listed in `packages.json` under its package, in its place in the story. `art/slides.mjs` builds each
slide's tree itself (`art/face.mjs`), so nothing parses its `.html`. `art/slides.test.js` reads every part: one
figure, every element a named layer, its rules of Style and none under 2.6cqw, its images drawings by hash, its
`.html` a preview of its tree (`bun test brain`). Whether the face-runtime takes it is the host test `slides`.

## How avenOS draws it

The content is first-party, from the repo, bundled at build time (`os/web/brain`), and none of it is parsed as HTML
on the page:

- **Markdown** goes through the frozen markdown-runtime, in the same worker, with the brain's link rules
  (`os/web/brain/brain.js`), and `Node.svelte` draws its tree.
- **A slide is a face.** Its part, `<id>.part.json`, goes through the frozen face-runtime, loaded by its hash in
  avenOS's runtimes worker, a worker of its own (`aven/runtimes`, README, "The browser host"). face-runtime checks the
  tree against the allowlist, every rule's range, the text's size and contrast, and that it can be read aloud, and answers the tree and
  the style; a part it refuses draws nothing, and the slide says why (`data-refused`). The drawer
  (`os/web/runtimes/draw.js`) checks both again, builds the slide node by node into a shadow root of its own and
  writes its CSS there from the rules. No slide style is in avenOS's own sheets, and none of avenOS's reaches a slide.
  The drawer asks avenOS where each `/files/<hash>` drawing is, and avenOS serves the brain's own from its bundle.

## Drawing

The objects are drawn in code: [`art/objects.mjs`](art/objects.mjs), with the paint kit in
[`art/paint.mjs`](art/paint.mjs). `AVEN_CHROMIUM=<a Chromium> bun brain/art/render.mjs` renders each to a transparent
PNG in `art/img/`, named by the BLAKE3 hash of its bytes, as the network names its files, and lists them in
`art/images.json`. `bun brain/art/slides.mjs` lays out avenID's slides and writes, for each, its markup, its style data and its face
part; the rules every slide shares, `style/slide.style.json`, are written by hand. A test holds every rule to `ruleOk`,
every font size to 2.6cqw or more, each part to its markup and style, and the runtimes' vector for "A key signs"
(`face.json`) to the CSS the drawer writes from the brain's own rules. A slide shows
a drawing as `<img src="/files/<hash>">`, the only image the allowlist takes. The images and the slides' files are generated: edit the objects and the layouts, then run them.

## Releases

A change here ships with avenOS: `aven/DB2/brain` is one of avenOS's paths in `.github/workflows/avensandbox.yml`.
