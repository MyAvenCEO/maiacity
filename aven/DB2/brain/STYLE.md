# The look

An illustrated asset sheet, like the game's resource icons ([`style/reference/`](style/reference/)): hand-drawn
objects on a warm cream ground, each with its name under it in bold navy capitals. The slides and the docs pages
around them share it.

The objects are drawn in code ([`art/objects.mjs`](art/objects.mjs), with the kit in [`art/paint.mjs`](art/paint.mjs))
and rendered to images, so every one is reproducible and its own layer. The tokens are in
[`style/tokens.css`](style/tokens.css), the slide in [`style/slide.css`](style/slide.css).

## The objects

- **Hand-drawn.** A soft dark-brown outline that wobbles a little, as a pen does; straight edges stay straight, and
  corners are only a little rounded.
- **Volume from light.** Every surface is a gradient lit from the top left, with a highlight where the light falls.
- **Paper grain** over every surface, and **a soft mauve shadow** to the lower right.
- **Real materials:** turned wood, brass, red wax, paper, iron bands, painted wood, glass, slate.
- **Iconic, not to scale:** a stamp is as big as a chest, so that each reads.

## Metaphors

Each concept gets the object that explains it. A metaphor is never the claim: the claim is in the text, exact to the
spec. Its words keep to the glossary's senses too: a signature is a **signature mark**, never a seal (sealed means
encrypted), and a thing on a slide is drawn as a **card**, never a record (a Record is avenDB's).

| Concept | Object |
|---|---|
| a key | a signet stamp: only the one who keeps it can press its mark |
| a signature | a signature mark pressed in red wax on a letter |
| a public key | a card with the mark's imprint, for anyone to hold a mark against |
| checking | a magnifying glass, then a green tick |
| a vault | a strongbox with a brass nameplate; its owner's mark on the plate |
| a coop's vault (Maia City) | a green guild chest |
| an agent's vault (Aven) | a robot helper |
| a device | a phone; its own key a little signet shut in a glass case on its screen |
| a passkey | a fingerprint glowing on the phone |
| a device cap | a permit badge on a lanyard, bearing the vault's signature mark |
| a cap | a pass with its stub, bearing its issuer's signature mark |

## The palette

| Colour | Values | Where |
|---|---|---|
| Cream | `#f8eee2`, a slide `#fcf5ea`, a card `#fffaf2` | the ground |
| Navy | `#23324a`, quiet `#4a5468` | titles, labels, text: 11:1 and 6.6:1 on the cream |
| Ochre | `#c4923f`, its ink `#7d4f12` | dotted paths and their names |
| Teal ink | `#245a61` | links |
| The objects' own | wood `#a8683f`, brass `#e2b14f`, wax `#c4473a`, paper `#f4ead7`, slate `#46515c`, teal `#5a9294`, green `#6f8f5a` | in the drawings |

## A slide

- A **16:9 slide** that reads as one picture: one concept, its title in bold navy at the top left, few words.
- **Objects** with their names under them, bold uppercase navy. **A dotted ochre path** with an arrowhead is a
  relation, its name over it.
- **No text under 2.6 % of the slide's width** (2.6cqw): about 9 px on a phone, where a slide is about 356 px wide.
  The box checks it at 390 px (`sandbox/docs.mjs`), and a test checks the CSS (`render/tree.test.js`).
- Text has 4.5:1 against what is under it, and sits on the ground, never on a drawing.
- **Every element a layer** with a stable class, so a motion version can move each one.
- The text that explains it is on the page under the slide, in Markdown.

## The pages

The docs pages are the same sheet: the cream ground, bold navy titles, and on the dashboard each package as one of
the drawings with its name under it, like an asset library.
