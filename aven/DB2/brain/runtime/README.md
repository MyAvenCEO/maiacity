# avenRUNTIME

Pure functions named by their hash: frozen WebAssembly modules that run a part from anyone, on every device alike,
without trusting it.

## Owns

- [A runtime](#a-runtime): `run(part, input) → output`, named by its module's hash; its names and its users.
- [The contract and its failures](#the-contract-and-its-failures): what goes in, what comes out, the six failures.
- [The module and its ABI](#the-module-and-its-abi): a module that imports nothing, `alloc` and `run`.
- [The host](#the-host): wasmi with fuel and memory limits; no floats, threads or SIMD; `auto-dispatch`.
- [Where runtimes live](#where-runtimes-live): with their publisher's vault; the bootstrap manifest until Docs run.
- [Frozen bytes, loading by hash, and versions](#frozen-bytes-loading-by-hash-and-versions): appended, never changed,
  always loadable; withdrawals.
- [Pins](#pins): the runtime a verdict runs is the hash an envelope names, pinned in its past.
- [The browser host](#the-browser-host): a runtimes worker of its own, apart from the device key.
- [The node tree and the drawer](#the-node-tree-and-the-drawer): one allowlist, checked on the page by the drawer's
  `checkTree`.
- [face-runtime](#face-runtime): markup and style as data, to a checked tree and typed style.
- [markdown-runtime](#markdown-runtime): GitHub-flavoured Markdown to a checked tree.
- [state-runtime](#state-runtime): a declarative turn that answers with steps, never a whole state.
- [The file registry](#the-file-registry): what a file really is, by its bytes, and how it shows.
- [Hostile parts and files](#hostile-parts-and-files): what holds each threat.
- [Built on aven-codec](#built-on-aven-codec): every runtime crate takes the codec alone.

## Uses

- [avenCORE](../core/README.md#values): Values, the one codec (`aven-codec`) and its JSON form; BLAKE3
  [names](../core/README.md#names) and type ids; the [steps](../core/README.md#targets-and-steps) a write is made of
  (put, patch, remove, edit). The Lean requires `Aven.Core` by path and never defines Values itself.
- [avenDOCS](../docs/README.md#types-schemas-and-fit): typed Docs (the manifest becomes one), and pins (A7), which
  decide the runtime a verdict runs.
- [avenCAPS](../caps/README.md#keep-caps-offers-and-placement): keep caps (A44), which say where a publisher's
  modules are kept.
- [avenSTORE](../store/README.md#blobs-and-refs): blobs (a module is one) and [files](../store/README.md#files),
  `/files/<hash>`.
- [avenPEERS](../peers/README.md#the-peer-and-the-peer-light): the Peer-Light and the native Peer, which compile the
  file registry; [the fetch gate](../peers/README.md#the-fetch-gate), by which a module is fetched by hash once Docs
  run.
- [avenOS](../os/README.md#the-page-and-its-workers): its workers and its one origin; the release that carries the
  browser host and the frozen modules; the page code that holds the runtimes worker and the drawer; the
  [Service Worker](../os/README.md#the-service-worker), which serves a file as the registry decides.
- [avenSANDBOX](../sandbox/README.md#the-check): the box that builds the modules reproducibly and runs every check.

## A runtime

A runtime is a pure function: `run(part, input) → output`. The **part** is what it interprets: an actor's turn, a
face, a plugin's operation, or a file's bytes. The **input** is everything else it needs. Nothing else goes in, and
nothing else comes out. The same module runs on every device and gives the same answer there.

A runtime is named by the BLAKE3 hash of its module's bytes, `b3:<hex>`. A part, a journal entry, a lowered operation
and a cached render all name that hash, never only `name@version`, so each names exactly the code that made it.

**Its users.** Three kinds of user share one contract, one host, one manifest and one allowlist:
- **actors** run their turns and faces on `state-runtime`, `js-runtime` and `face-runtime`
  ([avenACTORS](../actors/README.md)); avenACTORS owns what each actor runtime does for an actor, this package owns
  the runtime;
- **plugins** lower a grammar to core operations ([avenOPS](../ops/README.md)). A plugin is a runtime (K7, A18): its
  lowering is a pure Rust function built twice, natively into the engine and frozen as a module whose hash names the
  lowering, and the check runs every vector through both builds and fails when they differ;
- **files** show through a file runtime, whose part is the file's bytes and whose input is a render's params.

**Names.** One namespace. An actor's runtime is named after its job (`state-runtime`, `js-runtime`, `face-runtime`),
a file runtime after its format (`svg-runtime`, `markdown-runtime`, `text-runtime`, `csv-runtime`, `json-runtime`,
`pdf-runtime`), a plugin's after its plugin (`ontology-runtime`). There is no Prolog runtime: a machine is data
([avenACTORS](../actors/README.md)).

**One package.** `aven/runtimes` has its own Cargo workspace, lockfile, Lean project and check. It depends on no
storage, no network and nothing of avenDB but the codec, so the actor kernel, the engine and avenOS can each use it.

**Decided:** K7, A18, A45; runtimes 1, 2, 7, 8 · **Lean:** `Aven.Runtime.Contract` — `run`, `deterministic`

## The contract and its failures

```
run(part, input) → output | failure        part, input and output are Values
```

- **The part** is in the runtime's format, or the run is `refused`.
- **The input** fits the runtime's input schema, or the run is `badInput`.
- **The output** fits the runtime's output schema and its limit, as encoded in the one codec.
- **A failure** is a Value too, the same on every device:

| Failure | When |
|---|---|
| `badInput` | the input fails its schema, or isn't the one codec's encoding of a Value |
| `outOfFuel` | the run used up its fuel |
| `outOfMemory` | the module's memory would pass its limit |
| `refused` | the part isn't in the runtime's format, breaks one of its limits, or the module trapped otherwise |
| `outputTooLarge` | the output's encoding is longer than the output limit |
| `badOutput` | the answer isn't a result, or the output fails its schema |

A run's **result** is the Value the host hands on: `{"ok": output}` or `{"failure": name}`.

**Limits** are fuel (instructions), memory (bytes) and output (bytes of its encoding). More room never changes an
answer: what runs within some limits gives the same output within larger ones, so a device that allows more agrees
with one that allows less wherever the smaller one answers. A device's clock and randomness never reach a run; where a
compiled library asks for them (QuickJS asks for a clock and random bytes), a shim inside the module answers from the
input alone: a turn's frozen time and seed.

**Decided:** A2, K7, runtimes 6 · **Lean:** `Aven.Runtime.Contract` — `run_ok_fits`, `run_more_room`,
`deterministic`; vectors `contract.json`

## The module and its ABI

A runtime module is WebAssembly, built for `wasm32-unknown-unknown` from one crate of this package (`modules/<name>`,
over `abi`).

- **It imports nothing:** no function, memory, table or global. A check proves it from the module's bytes alone.
- **It exports one memory** with a declared maximum of at most 1,024 pages of 64 KiB (64 MiB). Every module links
  with `--max-memory=67108864`.
- **It exports `alloc` and `run`:**
  - `alloc(len) → ptr`: `len` zeroed bytes the host writes the part or the input into;
  - `run(part_ptr, part_len, input_ptr, input_len) → ptr`: the part and the input, each the one codec's encoding of
    a Value, read from buffers `alloc` gave; `ptr` points to an 8-byte header, the result's pointer and length, each
    a little-endian `u32`, over the result's encoding.
- **Inside the module:** a part or input that doesn't decode is `badInput`; a pointer `alloc` didn't give is
  `refused`. The buffers live in safe Rust; a run frees what it was handed.
- **On the host's side:** the header and the result are read only inside the module's memory. Out of bounds, not a
  Value, or not a result is `badOutput`. A length past the output limit plus the result's few bytes of wrapping is
  `outputTooLarge`, refused before it is read, with the sum checked so it can't wrap.

**Decided:** A89 · **Lean:** `Aven.Runtime.Contract` — `admit_imports_nothing`, `admit_memory` (the ABI
itself needs no theorem: only the contract's Values cross it)

## The host

`aven-runtimes-host` loads a module, admits it and runs it. It runs every runtime in **wasmi** (`=2.0.0`): an
interpreter in safe Rust, the same in tests, natively and in the browser, with no JIT to attack.

- **Fuel** is counted per instruction, so a run stops at the same instruction on every device.
- **Memory** is held by the store's limiter, which traps on a growth past the limit; the memory a module starts with
  is held to the limit too.
- **Admission** before a run: the module validates, imports nothing, exports one memory with a declared maximum
  within 1,024 pages, and exports `alloc` and `run`. Otherwise it is not admitted.
- **Determinism.** What could differ between two hosts is refused before a run. Float instructions are refused (a
  NaN's bits are the one thing WebAssembly leaves to the engine; a runtime's numbers are integers), and so is a second
  memory. SIMD, relaxed SIMD and 64-bit memories don't validate (wasmi is built without them), and wasmi has no
  threads. What is left is integer arithmetic over one memory, the same on every engine.
- **Dispatch.** wasmi is built with `auto-dispatch`: where the target has no tail calls (wasm32 in a browser) it
  dispatches in a loop, and fuel is counted the same either way.
- **Traps:** out of fuel is `outOfFuel`; a growth past the limit is `outOfMemory`; any other trap is `refused`.

A runtime too slow under wasmi is made to do less first (a smaller raster, fewer rows, a lazier parse).

**Decided:** A89; runtimes 5 · **Lean:** `Aven.Runtime.Contract` — `admit_imports_nothing`,
`admit_memory`; refusing floats and a second memory is not in Lean yet

## Where runtimes live

A runtime lives with the vault that publishes it: Aven's vault for the built-ins. Its module is a blob, and its
manifest a typed Doc owned by that vault, kept where the vault's keep caps say and fetched by hash. A runtime runs on
the reader's device, in a worker of its own, apart from the device key.

Until Docs run, git holds both:
- **`manifest.json`, the bootstrap manifest:** every frozen module and every withdrawal, append-only;
- **`frozen/<hex>.wasm`:** each frozen module's bytes, committed and named by its hash. Nothing else sits beside them:
  no sourcemap, no debug build.

**Until Docs run, only from this repository.** A runtime is code that runs on every member's device, so it arrives
only as the rest of the code does:
- built from source in this package, its dependencies pinned exactly, each at its newest stable release when it comes
  in;
- reviewed in a pull request: its crate, its dependencies' diff, its manifest entry and its hostile parts, through the
  security auditor's checklist (`rust-security`, `fuzz-harness`, `cargo-fuzz`);
- frozen by a reproducible build in the box;
- shipped inside what loads it, never on its own: its committed frozen bytes go out in avenOS's release (`@aven/os`:
  the browser host and `frozen/`), each named by its hash, and the file registry in the avenPEER image (the Peer-Light
  and the native Peer). `aven/runtimes` has no dated release of its own; the manifest is its version list.

No member, agent or model adds a runtime at run time, and a peer hands another a module's bytes only by a hash the
receiver's own release lists. Parts are data and come from anyone; runtimes are code.

**The bootstrap manifest's shape:** `{"about": text, "runtimes": [entry, …]}`, an entry either

| Entry | Keys |
|---|---|
| frozen | `name`, `version` (an integer from 1), `hash` (`b3:<hex>`), `limits` {`part`, `fuel`, `memory`, `output`} (bytes but `fuel`), `users` (`actor`, `plugin`, `file`) |
| withdrawn | `withdrawn`: a hash |

There are no floors and no schemas in the manifest: each runtime's schemas are its Lean model's.

**Decided:** A44, A45, A89, A102, A180; runtimes 1 · **Lean:** `Aven.Runtime.Contract` — `listed`,
`loads`

## Frozen bytes, loading by hash, and versions

**Frozen.** `freeze.sh` builds every module as it ships (wasm32, release, in the box, where the toolchain and the
paths are the same on every run) and keeps a new module's bytes in `frozen/`. The check (`freeze.sh --check`, the
host's tests) holds:
- each runtime's newest build to its newest kept bytes;
- every kept file to its name;
- nothing kept that the manifest doesn't name;
- every frozen version, loaded by its hash, to its vectors.

**Versions are appended.** `face-runtime@2` is the second frozen module of `face-runtime`. A version is never rebuilt
or changed: a fix, a new capability, or new bytes from a dependency is the next version, appended beside the old.
The old version's bytes stay in `frozen/`, so it stays loadable by its hash after its source has moved on. The
manifest only appends; an entry never changes.

**Loading by hash.** A host loads bytes only when the manifest lists their hash and their BLAKE3 is that hash, both
checked before a byte is compiled. A compiled module is a cache keyed by its hash.

| Who | Where the module comes from | How it runs |
|---|---|---|
| The actor kernel | Linked as bytes into the kernel's build, from the manifest | `aven-runtimes-host` inside the kernel |
| The engine | A plugin's lowering, built natively into the engine and frozen as a module | The native build, held to the frozen module on every vector |
| avenOS (its own pages) | `/runtimes/frozen/<hex>.wasm` on avenOS's origin, from its release | `aven-runtimes-web` in the runtimes worker ([below](#the-browser-host)) |
| avenOS (shared files) | `/runtimes/<hash>.wasm` on the files origin, from its release | The host in a dedicated worker there ([the file registry](#the-file-registry)) |

**Withdrawals, for what a device runs for itself.** A withdrawal is an appended entry. A withdrawn hash is never
loaded again, and the device's own renders made by it are dropped. A device's own render uses the newest version the
manifest still lists.

**Decided:** A42, A45, A89, A102 · **Lean:** `Aven.Runtime.Contract` — `frozen`,
`loads_listed`, `withdrawn_unlisted`, `withdrawn_not_loaded`, `cache_drops`

## Pins

What others wrote names its runtime by hash: a lowered operation, a checkpoint, a fold. A reader runs exactly the hash
an envelope names, and only when that hash is pinned in the envelope's past: a Doc or a vault pins the runtime hashes
it accepts, as it pins type versions ([avenDOCS](../docs/README.md#types-schemas-and-fit)), and closes a hole by
withdrawing the pin, by its owners' act, in its history. So two readers holding the same past run the same runtime,
or both refuse it, whatever came after; and a withdrawal closes the hash for every envelope after it. A floor that
rose with releases would make a reader re-run an old envelope on a newer version, and disagree with one that hadn't
upgraded: there are no floors.

**Decided:** A7, A18, A42, K7 · **Lean:** `Aven.Runtime.Contract` — `verdict_named`, `readers_agree_pins`,
`withdraw_closes`

## The browser host

avenOS runs runtimes in the **runtimes worker** (`os/web/runtimes/host.js`), a worker of its own, never in the
Peer-Light's worker, which holds the device key.

| | Holds | Can stop |
|---|---|---|
| The page | the parts it shows and their inputs; the drawer | itself |
| The runtimes worker | `aven-runtimes-web`: the host, wasmi, the manifest compiled in, the modules it loaded by hash | itself, and the page's next ask starts it again |
| A runtime module | its own memory, inside the host's, under fuel, memory and output limits | nothing: a trap is its run's failure |
| The Peer-Light's worker | the device key, the store, the network | nothing here: the runtimes never reach it |

- **The ask.** The page calls `runtime(name, part, input)` (`os/web/runtimes/runtimes.js`), with Values in their one
  JSON form, bytes as `{"bytes": hex}`. The worker asks the host for the newest hash the manifest lists for `name`,
  fetches its bytes once from avenOS's own origin, `/runtimes/frozen/<hex>.wasm`, and the host loads them only when
  they are listed and are the hash's. It runs the part and the input under the limits the manifest froze with the
  module and answers `{"ok": output}` or `{"failure": name}`. The page draws only an `ok`; a refused part draws
  nothing.
- **Why a worker of its own.** A module is untrusted code, even interpreted, and it never shares a realm with the
  device key. wasm32 aborts on a panic: a fault in the host stops only this worker, which says so (`fatal`) and ends;
  what was asked of it is refused, and the next ask starts it again. Sync, the store and the key's holder never
  notice.
- **The origin** is avenOS's, shared with the Peer-Light's worker until A15's three origins exist
  ([avenOS](../os/README.md#the-page-and-its-workers)); the runtimes' walls are the worker of its own, a module that
  imports nothing, and fuel.
- **What it runs.** avenOS's own first-party content: avenBRAIN's slides through face-runtime. A shared file never
  runs here (see [the file registry](#the-file-registry)).
- **Its build.** `aven-runtimes-web` is built in this workspace and bound by the same wasm-bindgen as the Peer-Light
  (`=0.2.130`); nothing of avenDB's builds, images or lockfile depends on it. The box builds it and copies `frozen/`
  beside it, and Vite serves both at `/runtimes/`; the release puts both in `dist/runtimes/` (`buildRuntimes`).
- **Checked** in Chromium, WebKit and Firefox (`sandbox/runtimes.mjs`): every slide's part through face-runtime by
  its hash, accepted, the three engines' answers the same byte for byte; a part that isn't a face `refused`; another
  module's bytes, a flipped byte and an unlisted hash refused by the host.

**Decided:** A15, A45 · **Lean:** not in Lean (the host's walls are mechanics, held by the
three-engine check)

## The node tree and the drawer

Everything a runtime gives that becomes DOM is a **node tree**: text, or an element `[tag, [[name, value], …],
[child, …]]`, as a Value. There is **one allowlist** for every tree, faces' and files' alike:

- **Tags** only from the allowlist; never `script`, `style`, `iframe`, `frame`, `object`, `embed`, `link`, `meta`,
  `base`, `form`, `svg`, `math`, `template`, `video`, `audio`, `canvas` or the rest of `forbidden`.
- **Attributes** only from the allowlist, for their tag (global ones, `aria-*`, and per tag: `href` on `a`; `src`,
  `alt`, `width`, `height` on `img`; …); never an `on…` handler in any case, never `style`.
- **URLs** only where a URL belongs: every `src` is a file of the network by its hash, `/files/<64 lowercase hex>`;
  every `href` is `https://`, `mailto:` or a fragment, followed only by a click.
- **Limits:** depth 64, nodes 20,000, text 8 MiB (`treeLimits`).

The allowlist is written once, in Lean, and exported as `tree.json`. Two checks are held to those vectors and nothing
else checks trees: `aven-runtimes-tree` in Rust, for the runtimes, and, on the page, **the drawer's `checkTree`**.

**The drawer** (`os/web/runtimes/draw.js`, avenOS's code, reviewed as a runtime is) is the one piece of trusted page
code that draws what a runtime gives. It trusts nothing it is handed:
- it checks the tree again with `checkTree`, and every style rule against Style's types (`ruleOk`), and refuses the
  whole answer if anything fails;
- it builds the DOM node by node (`createElement`, `setAttribute`, `createTextNode`), never from markup text, into a
  shadow root of its own;
- it writes the CSS itself from the typed rules (`Rule.css`): no CSS text comes from a runtime;
- **a face never draws outside its host:** the host is `display:block;position:relative;overflow:hidden;contain:layout
  paint style;isolation:isolate`, so it is the containing block of every absolute and fixed layer, clips them, and
  keeps every z-index inside; a face can't cover avenOS's own buttons or take their clicks;
- every face sizes border-box (`*,*::before,*::after{box-sizing:border-box}`), as avenOS does;
- a click on a `data-on` node is an event by name; a click on a link goes to the page, which asks before it opens
  anything, and nothing follows a link by itself; `file(hash)` says where a `/files/<hash>` image is read from.

Checked in three engines (`sandbox/drawer.mjs`): the drawer against `tree.json`, and a face with `inset: 0`, a large
translate and a large size drawn beside a button that still takes its click.

**Decided:** A84, A99, A111; runtimes 9 · **Lean:** `Aven.Runtime.Tree` — `check_no_forbidden`,
`no_script`, `check_no_handlers`, `check_urls`, `check_bounded`; vectors `tree.json`

## face-runtime

face-runtime draws a whole face: its markup and its style as data, with its face data, to a checked tree and typed
style. It sits at the package's top level (`face/`), since avenBRAIN's slides use it as much as actors' faces do.

- **Its part** is `[markup, [rule, …]]`. Markup is an array form: `["text", source]`, `["el", tag, [[name, source],
  …], event or null, [markup, …]]`, `["each", path, key path, markup]` (keyed), `["use", place, component, [[name,
  source], …]]`; a source is `["lit", text]`, `["$", path]` or `["$$", path]`. There are no conditionals.
  `data-on` and `data-place` are the runtime's own attributes.
- **Its input** is the face data.
- **Its answer** is `{"tree": tree, "style": [rule, …], "placements": [[place, component, [[name, text], …]], …]}`.
- **A rule** is a selector and typed declarations. A selector is a descendant chain of one to four compounds, each an
  optional allowlisted tag and up to four classes; no pseudo-classes, attribute selectors or other combinators. A
  declaration is typed: placement, size, aspect, margin, padding, gap, border, radius, colours (three bytes), the one
  bundled font, its size and weight, leading, tracking, uppercase, centring, nowrap, a transform of `translateX`,
  `translateY`, `rotate` and `scale` and its origin, and the one arrowhead clip-path. A length is hundredths and a
  unit (`cqw`, `%`, `px`, `em`). No custom properties, no `url()`, no free text. Which rule reaches a node is CSS's
  cascade: more classes, then more tags, then the later rule.

**A face is accepted** (`faceOk`) only when:
- the tree passes the allowlist's check;
- every interactive node has an accessible name, every image an `alt`, and every clickable node that isn't a native
  control a role and a tab stop;
- every rule is of the types, its values in range;
- every text is at least 9 px where a slide is narrowest, 356 px: 2.6cqw;
- every text has enough contrast against what it is drawn on: 4.5:1, 3:1 when large. What a text is drawn on is the
  nearest background above it, or an earlier sibling layer that covers its whole parent (`inset: 0`) with a
  background; a layer placed over only part of the parent isn't seen. Contrast is exact integer arithmetic over one
  table, `linear` (sRGB to linear light, × 10⁷): #767676 on white passes and #777777 fails, as WCAG has it.

A part that doesn't read as a face part, or a face that isn't accepted, is `refused`.

**Decided:** A51, A54, A69; runtimes 2, 9 · **Lean:** `Aven.Runtime.FaceRuntime` — `faceRuntime_ok`;
`Aven.Runtime.Style` — `face_passes_check`, `face_named`, `face_roles`, `face_rules`, `face_size`, `face_contrast`;
`Aven.Runtime.Markup` — `draw_nodes_ok`, `draw_events`, `faceRun_ok`; vectors `face.json`, `face-runtime.json`,
`markup.json`, `contrast.json`

## markdown-runtime

markdown-runtime turns GitHub-flavoured Markdown into a checked tree: CommonMark with GitHub's tables, task lists and
strikethrough, parsed by pulldown-cmark (`=0.13.6`). The parser is mechanics, held by its tests and hostile cases; what
has exact answers is in Lean, and the crate replays it.

- **Its part** is the file's bytes: UTF-8, at most 1 MiB.
- **Raw HTML** is text. **An image** shows only as a file of the network by its hash (`/files/<hash>`); any other
  image is its alt text.
- **Heading ids** are GitHub's (`slug`, `slugs`): lowercase ASCII letters, digits, `-` and `_` kept, a space becomes
  `-`, ASCII punctuation goes, a repeated slug gets `-1`, `-2`, …; letters beyond ASCII are kept, punctuation beyond
  ASCII goes.
- **Links:** a link the allowlist takes stays; any other is rewritten by the first rule whose prefix it starts with,
  and kept only if the result is one the allowlist takes; otherwise its text stays, without a link.
- **Limits:** building stops, and the file is refused, as soon as nesting, nodes or text pass the tree's limits.
  Every answer passes the allowlist's check: a parser bug can make a file download, never put an unchecked node on a
  page.

**Versions.** v1 and v2 are frozen, and answer as they always did; v2 is v1's behaviour, rebuilt on `aven-codec`.
Its input is `{}` or `{"links": [[prefix, replacement], …]}`.

**v3** (in draft #1737) makes what a link in a Markdown document points to the runtime's own:
- **its input** is `{"links": [[prefix, replacement], …], "base": path, "idPrefix": prefix}`, each optional, no other
  key: `{}` is no rules, the root and no prefix;
- **links resolve against their document** before the rules apply: a link with a scheme (`https:`, `glossary:`) is
  never resolved; a fragment alone (`#heading`) gets `idPrefix`; any other is a path, resolved lexically against
  `base` by RFC 3986's `remove_dot_segments`, `..` clamped at the root, its query and fragment kept. No fetch and no
  lookup: `base` names a path, never a place;
- **heading ids carry `idPrefix`,** so two documents on one page never share an id;
- **a soft break is `" "`,** as CommonMark allows, so a paragraph's text is one line;
- **a table's header cell names its column** (`scope="col"`).

The document's owner gives the rules, `base` and `idPrefix` ([avenBRAIN](../README.md) gives its package pages and
the repository's URL); the runtime knows no repository.

**Decided:** A45, A110, A192; runtimes 2, 12 · **Lean:** `Aven.Runtime.Markdown` — `markdown_ok`,
`rewrite_link`; v3's `resolve`, `removeDots_no_dots`, `linkTo_link` pending in #1737; vectors `markdown.json`

## state-runtime

state-runtime runs a declarative turn: no code, so it always ends. Its part is a statechart and a reducer as data, a
list of handlers, each for one message:

- **moves:** the statechart's edges for that message, `from → to`. A handler applies only in a phase it moves from;
  the first that does runs. A part without a machine uses one phase, `""`.
- **updates:** `set`, `merge`, `append` and `remove`, applied in order, each at a path of map fields and array indexes,
  with values from the message's payload, the state before, the turn's time and seed, or a literal.
- **sends:** `tell` and `ask` to the sender or to an address held in the state, and `reply` to the ask being handled.

It names nothing of the actors': a message is its sender's address, its name, its payload and, for an ask, the ask's
id, all Values. **A step answers with steps, never a whole new state:** the writes it commits (`put`, `patch`,
`remove`, and an `edit` that pushes onto a list, each at a path: [avenCORE](../core/README.md)'s steps), its sends as
data, and the phase it moved to. The reducer's updates lower to those steps, and the steps, applied in order, make
exactly the state the updates make. How a turn commits them is [avenACTORS](../actors/README.md)'.

`step` is total and deterministic; under the contract the part and the input are Values, and the fuel is a count of
the part's work.

**Decided:** A19, A37; runtimes 8 · **Lean:** `Aven.Runtime.State` — `step_moves`, `step_refuses`, `step_allowed`,
`get_set`, `get_set_other`, `get_remove`, `set_get`, `merge_get`, `append_get`, `remove_get`, `update_other`,
`lower_apply`, `lowerAll_apply`, `step_writes`, `state_output_fits`, `state_never_badOutput`, `state_more_room`,
`state_run_moves`; vectors `state.json`

## The file registry

One registry says what a file really is and how it shows, and nothing else lists file types. One entry per type; the
registry is the list.

`decideFile(stage, head, size, claim)` gives one decision, from `head`, at most the first 64 KiB of the file's first
chunk:

1. **What the file really is, by its bytes.** A binary type has signatures (bytes at an offset, with a mask: PNG's
   `89 50 4E 47 0D 0A 1A 0A`, JPEG's `FF D8 FF`, `RIFF….WEBP`, `ftyp` boxes for MP4, QuickTime and AVIF, `%PDF-`). A
   file is text when its head is valid UTF-8 without NUL; then a parse decides: an XML prolog or root (`<svg` is SVG;
   an HTML root, `<!DOCTYPE html` or `<script` is HTML), JSON by a bounded parse. Only then may the claimed type or
   the name's extension choose among formats the bytes can't tell apart: Markdown, CSV, TSV, code or plain text. **A
   claim never makes a file more able than its bytes.**
2. **How it shows:** `native` (the browser's own `<img>`, `<audio>` or `<video>`, only for a binary type whose bytes
   say so, within the dimensions its header declares), `runtime` (a named file runtime, whose output a drawer shows),
   `frame` (only PDF, the browser's viewer in a sandboxed frame, until `pdf-runtime`) or `download` (everything else,
   and everything over a limit).
3. **Its limits:** bytes; for `native`, declared dimensions; for `runtime`, fuel, memory and output.
4. **How it is served:** `Content-Type` the sniffed type, never the claimed one; inline only for what the browser
   shows; attachment otherwise; `nosniff` and a sandbox CSP on every answer.
5. **How its renders are cached:** by `(runtime hash, file hash, params)`, on the device, in the files origin's own
   storage, evicted by size, dropped when the runtime is withdrawn, never synced. A reader always renders for itself.

**The choices,** the safer defaults: a JPEG whose start of frame lies past the head downloads; an `ftyp` box's first
byte must be 0; a text file is HTML only when its root is an HTML tag; UTF-16 text downloads.

**One implementation.** The registry is written once in Lean, exported as `table.json` (the data) and
`registry.json` (its vectors). `aven-runtimes-registry` reads it: `no_std`, no allocation, no dependencies, built
natively and for wasm32. The Peer-Light compiles it in: it decides once per file, from its first 64 KiB, and answers
the Service Worker's reads, so `files-sw.js` keeps no list of types; the chat's card is only a label from the claim.
The native Peer compiles it in to give a shared file its sniffed type. A reader never trusts another peer's sniff.

**Where file runtimes run.** In a dedicated worker on the files origin (A15), never on a page's main thread and never
on the safe's origin; the worker has a wall clock as well as fuel, and a file that runs past its deadline downloads.
Only checked data crosses back: a node tree, or a plain Value (pixels `{width, height, rgba}`, or a table `{columns,
rows, total}`) that a small trusted drawer shows. Until the files origin exists, no shared file runs through a runtime:
the registry decides only `native`, `frame` or `download`.

**Decided:** A15, A36, A71; runtimes 3, 4, 10, 12 · **Lean:** `Aven.Runtime.Registry` — `signatures_apart`,
`sniffBinary_unique`, `decide_binary_ignores_claim`, `claim_never_adds`, `scriptable_never_inline`,
`unknown_downloads`, `over_limit_downloads`, `native_img_dims`, `no_runtime_before_origin`, `serve_inline`;
`Aven.Runtime.Contract` — `renderKey_inj`, `cache_drops`; vectors `table.json`, `registry.json` (47 examples, then
200 heads cut and changed from them under random claims)

## Hostile parts and files

Every part and every file is hostile until its runtime has parsed it, and every limit holds before memory or time is
spent (rule 10).

| Threat | What holds it |
|---|---|
| A claim that lies (HTML sent as `image/png`) | The bytes decide; a sandbox CSP and `nosniff` regardless |
| A polyglot (bytes valid as both PNG and HTML) | The sniffed type decides the one path; no type leads to HTML on any origin |
| A decompression bomb | Decoded bytes count against the runtime's memory and output; a native image's declared dimensions are checked first |
| Huge dimensions | The header's dimensions against the registry's limit; for SVG, the params' raster size capped by the pixel limit |
| Deep nesting | A depth limit below each parser's stack; fuel ends the rest |
| Entity expansion | No DTD and no entities: an SVG that declares one is refused |
| A slow path in a parser | Fuel ends the run as `outOfFuel`; the file downloads |
| An output flood | Output bytes, nodes, depth and pixels, limited by the runtime, checked by the host, checked again by the drawer |
| External references | A runtime can't fetch; a file of the same Doc by hash is a separate file, decided on its own; anything else is dropped |
| Data carried out through URLs | No remote image, font or stylesheet, ever; a link opens only by a click, in a new context |
| A bug in a runtime | The WebAssembly wall, then the worker, then the origin, then the drawer's second check |
| A poisoned cache | Renders are keyed by hashes and never synced, so a peer can only poison its own |
| A bad runtime | Only from the repository, reviewed, fuzzed, frozen by hash |

Each runtime's hostile parts cover every row that applies, and its tests assert the exact failure.

**Decided:** runtimes 12; rule 10 · **Lean:** not in Lean (parsers are mechanics, held by hostile parts and fuzzing)

## Built on aven-codec

Every runtime crate that touches a Value (`tree`, `contract`, `abi`, `markdown`, `face`, `host`, `web`) takes
[avenCORE](../core/README.md)'s codec crate alone, `aven-codec` (`../../DB2/codec`), by path: Value, encode, decode,
Hash, blake3 and name_of. None takes `aven-core`. So a module's bytes move only when the codec does, and when they
move, each module gets one new version, appended. The file registry takes no dependency at all. The Lean requires
`Aven.Core` by path and never defines Values itself.

**Decided:** A45, A89, A98 · **Lean:** `Aven.Core` (avenCORE's)

## Status

| Piece | Lean | Rust | TS/JS | State |
|---|---|---|---|---|
| Contract, failures, ABI | `Contract` | `aven-runtimes-contract`, `aven-runtimes-abi` | — | built |
| Native host | `Contract` (`admit`) | `aven-runtimes-host` (#1704) | — | built; floats and a second memory refused in Rust only |
| Bootstrap manifest, frozen bytes | `Contract` | `freeze.sh`, the host's tests (`frozen`, `refusals`) | — | built (#1704, #1719); as blobs and a typed Doc of Aven's vault once Docs run |
| Browser host | — | `aven-runtimes-web` | `host.js`, `runtimes.js` | built (#1719), three engines |
| Node tree and drawer | `Tree` | `aven-runtimes-tree` (#1631) | `draw.js`'s `checkTree` (#1650, #1709, #1723) | built |
| face-runtime | `Markup`, `Face`, `Style`, `FaceRuntime` | `aven-runtimes-face` (#1643, #1691) | — | v1 and v2 frozen; avenBRAIN's slides drawn by it (#1707, #1719) |
| markdown-runtime | `Markdown` | `aven-runtimes-markdown` (#1639) | — | v1 and v2 frozen (#1729); v3 in draft #1737 (A192), with avenBRAIN's pages and glossary drawn by it |
| state-runtime | `State`, `StateExamples` (#1550, #1676) | — | — | Lean only; no crate until actors start |
| File registry | `Registry`, `RegistryExamples` | `aven-runtimes-registry` (#1678, #1689) | `files-sw.js` reads its decision | built, in the Peer-Light and the native Peer |
| On `aven-codec` | — | every crate (#1729) | — | built |

**The bootstrap manifest's entries:**

| Runtime | Version | Hash | |
|---|---|---|---|
| markdown-runtime | 1 | `b3:6ef96e5c…` | frozen |
| face-runtime | 1 | `b3:53c15591…` | frozen |
| markdown-runtime | 2 | `b3:c0f818d4…` | frozen: v1 on `aven-codec` |
| face-runtime | 2 | `b3:b205f86f…` | frozen: v1 on `aven-codec` |
| markdown-runtime | 3 | `b3:c126a344…` | pending in #1737 |

**Planned, not started:**
- the files origin (A15), with avenOS and avenPEERS, then the file runtimes: `text-runtime`, `json-runtime`,
  `csv-runtime` with the table drawer, `svg-runtime` (resvg, one font compiled in) with the pixel drawer, and
  `pdf-runtime` last, after a spike that renders a corpus of real PDFs with each candidate (PDFium, pdf.js's renderer,
  a pure-Rust one) and picks the one closest to the reference;
- performance gates per engine (Chromium, WebKit, Firefox, native), measured in a spike, then held in
  `bun run up --check`;
- `js-runtime` (QuickJS inside wasmi) and state-runtime's crate, as avenACTORS builds them;
- `ontology-runtime`, when the engine has the ontology plugin, by the engine thread;
- hostile corpora and a fuzz target per runtime, run in the box on demand.

**Known gaps (code and Lean):**
- Lean's `admit` checks imports and declared memory only; the refusal of floats and of a second memory is the host's
  Rust alone, held by its hostile modules (audit-core 51).
- The host reads `limits.fuel`, `memory` and `output` from the manifest, never `limits.part`, and Lean's `Limits` has
  no part limit; markdown-runtime holds its own 1 MiB.
- No host checks an entry's `users`.
- `Contract.lean` cites a README section as "Names, versions, hashes and pins" (audit-core 52). Lean doc comments and
  code comments (`draw.js`, `host.js`, `runtimes.js`, `sandbox/runtimes.mjs`, `sandbox/up.mjs`, the registry and tree
  crates, `Contract.lean`, `Tree.lean`, `State.lean`) cite sections of `aven/runtimes/README.md` that are on this page.
- On #1737's branch, `Markdown.lean`'s doc comments call link resolution and the soft break "v2"; they are v3
  (audit-core 53).

## Open questions

- **Who may publish a runtime once Docs run:** only Aven's vault, from this repository and reviewed, or any vault,
  and under what review. Samuel decides.
- **Which `users` label avenOS's own pages load a runtime as:** markdown-runtime is listed for `file`, yet it runs
  avenBRAIN's first-party pages on avenOS's origin; a `page` user, or `file` read as including first-party content.
  The architect decides, with the runtimes thread.
