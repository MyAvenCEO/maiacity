# aven/runtimes: the plan

`aven/runtimes` is the one home of every runtime in avenDB. A runtime is the shared primitive of
[`ARCHITECTURE.md`](../DB2/ARCHITECTURE.md#the-primitives-everything-shares): a pure function named by its hash, from
this repository, `run(part, input) → output`. Three kinds of users need runtimes, and today their plans live apart:

1. **Actors** run their parts on `state-runtime`, `js-runtime` (QuickJS inside wasmi) and `face-runtime`, specified
   in [`aven/actor/ARCHITECTURE.md`](../actor/ARCHITECTURE.md)
   (section 5) and built here, in `aven/runtimes/actor/*`.
2. **The engine's plugins** lower a grammar to core operations
   ([`db/engine`](../DB2/db/engine/README.md#the-core-and-its-plugins)). **A18** proposes that a plugin is a runtime
   whose output is core operations, its lowering pinned by its hash.
3. **File runtimes** (new) show shared files without trusting them: an SVG, a Markdown note, a CSV, a PDF.

This file is a plan, written on 30 Oct 2026 (Samuel: "just plan them, don't start them"). Nothing here is built yet: no
crate, no Lean file, no change to the box. It says what comes later and in what order, and records Samuel's answers to
its questions ([Decisions](#decisions)). The words are those of [`GLOSSARY.md`](../DB2/brain/GLOSSARY.md).

## Contents

1. [Why one home](#why-one-home)
2. [The runtime contract](#the-runtime-contract)
3. [Names, versions, hashes and floors](#names-versions-hashes-and-floors)
4. [Only from the repository](#only-from-the-repository)
5. [The package](#the-package)
6. [Loading by hash](#loading-by-hash)
7. [The file registry: one source of truth](#the-file-registry-one-source-of-truth)
8. [Where file runtimes run](#where-file-runtimes-run)
9. [Two kinds of output, and the drawers](#two-kinds-of-output-and-the-drawers)
10. [Hostile files and their limits](#hostile-files-and-their-limits)
11. [What Lean states](#what-lean-states)
12. [Performance gates](#performance-gates)
13. [The first file runtimes, in order](#the-first-file-runtimes-in-order)
14. [Moving the actors' runtimes and the plugins in](#moving-the-actors-runtimes-and-the-plugins-in)
15. [The order of work](#the-order-of-work)
16. [Decisions](#decisions)

## Why one home

The three users want the same thing from a runtime:
- the same module on every device;
- run without trusting its part;
- named by its hash, so a journal, a lowered operation or a cached render names exactly the code that made it.

Today each would build that alone: the kernel's runtime host in `aven/actor/core`, run-time plugins "later behind the
same interface" in the engine (D1), and a list of safe file types written twice in avenOS. One home gives one
contract, one loader, one import check, one review rule and one Lean model. The three users differ only in what their
parts are and where their output goes.

## The runtime contract

```
run(part, input) → output | failure        part, input and output are Values; nothing else goes in or comes out
```

- **The part** is what the runtime interprets: an actor's JavaScript, a machine, a view, a plugin operation, or, for a
  file runtime, **the file's bytes**. The file is the part, in its format, for the runtime of that format.
- **The input** is everything else it needs, as a Value: a turn's state, message and given; a plugin operation's
  params; a file render's params (width in pixels, theme, page, row window).
- **The output** fits the runtime's output schema, or the run fails. Two kinds exist for files
  ([below](#two-kinds-of-output-and-the-drawers)).
- **A failure** is one of `outOfFuel`, `outOfMemory`, `outputTooLarge`, `badInput` (the input fails its schema),
  `badOutput` (the output fails its schema) and `refused` (the part is not in the runtime's format, or breaks one of
  its limits). A failure is a Value too, and the same on every device.

**What a runtime module is:**
- WebAssembly, built for `wasm32-unknown-unknown`, from one crate in this package.
- **It imports nothing.** Not a function, not a memory, not a table, not a global. Where a compiled library expects
  system calls (QuickJS asks for a clock and random bytes), the shim that answers them is linked *inside* the module
  and reads only its input: the turn's frozen time and seed. The actor spec's "imports nothing that reaches the host"
  becomes "imports nothing", which a check can prove from the module's bytes alone.
- It exports one memory and one ABI: `alloc(len) → ptr`, and `run(part_ptr, part_len, input_ptr, input_len) → ptr`
  to a result of `(tag, ptr, len)`. Part, input and output cross as bytes in rule 1's one codec, deterministic CBOR
  ([ARCHITECTURE](../DB2/ARCHITECTURE.md#the-rules-across-all-parts), A2), whose byte strings carry a file's bytes,
  pixels and buffers; the host decodes and checks them against the schemas.
- It declares its maximum memory in the module, and the host refuses one that declares more than its limit.

**What every runtime declares,** in its manifest entry, frozen with it:

| Field | Meaning |
|---|---|
| `name` | `<format>-runtime` or `<job>-runtime` ([Names](#names-versions-hashes-and-floors)) |
| `version` | An integer, counting up from 1 |
| `hash` | `b3:<hex>` of the module's bytes |
| `floor` | The oldest version still run; a part naming an older one runs on the floor |
| `input`, `output` | The hashes of its input and output schemas (JSON Schema, `additionalProperties: false`) |
| `limits` | Part bytes, fuel, memory pages, output bytes, and the output's own measures (nodes, depth, pixels) |
| `journal` | Whether its output may be journaled (actors) or must stay a cache (files) |
| `users` | `actor`, `plugin`, `file`: who may load it |

**The host** checks before, during and after a run:
- before: the module's hash, that it imports nothing, its declared memory, the part's size, the input's schema;
- during: fuel per instruction and memory growth, in the interpreter;
- after: the output's size, its schema, and the output's own limits (a node tree against the allowlist, pixels
  against their dimensions).

## Names, versions, hashes and floors

- **Names** (decision 2). Actors' runtimes are named after their job: `state-runtime`, `js-runtime` and
  `face-runtime`. One face-runtime draws a whole face: its data, `markup` and `style` in, a checked node tree and
  scoped CSS out, with a11y, contrast included, checked across both (Samuel, 30 Oct 2026). There is no Prolog
  runtime: a machine is data, a table of phases checked by the kernel's admission checker (Samuel, 30 Oct 2026).
  File runtimes are named after their format: `svg-runtime`, `markdown-runtime`, `text-runtime`, `csv-runtime`,
  `json-runtime` and `pdf-runtime`. A plugin's runtime is named after its plugin: `ontology-runtime`. All share one
  namespace, so no two runtimes ever have one name. `json-runtime` is free since the actors' declarative turn became
  `state-runtime`.
- **Versions.** `svg-runtime@3` is the third frozen module of `svg-runtime`. A version is never rebuilt or changed. A
  new capability or a fix is the next version, beside the old ones.
- **Hashes.** What names the code is the hash. A part, a journal entry, a lowered operation and a cached render all
  name the hash, never only `name@version`.
- **Floors.** A version that closes a hole raises its runtime's floor. Actors and plugins whose parts name an older
  version run on the floor, as the actor spec has it. A file render always uses the newest version the registry names
  for its type, so a file runtime's floor matters only to caches: a render made below the floor is dropped.
- **The catalogue** (engine glossary) maps a runtime's name to its versions and hashes in each vault. Its built-in
  entries come from this package's manifest; a vault can't add a runtime the manifest doesn't hold
  ([Only from the repository](#only-from-the-repository)).

## Only from the repository

A runtime is code that runs on every member's device, so it arrives only the way the rest of the code does:
- **built from source in this package,** with its dependencies pinned exactly, each at its newest stable release when
  it comes in (DB2 rule 13);
- **reviewed in a pull request:** its crate, its dependencies' diff, its manifest entry and its hostile corpus. Every
  new runtime and every new dependency of one goes through the security auditor's checklist (the `security-auditor`
  skill: `rust-security`, `fuzz-harness`, `cargo-fuzz`);
- **frozen** by a reproducible build: the box builds the module, and the check fails when its hash differs from the
  manifest's. The manifest is append-only, and the check refuses an edit to a frozen entry;
- **shipped** with the release that carries it, never fetched from a peer, a URL or a Doc. A peer may hand another peer
  a module's bytes only by a hash that the receiver's own release already lists.

No member, agent or model ever adds a runtime at run time. Parts are data and come from anyone; runtimes are code and
come only from here.

## The package

Its own package with its own Cargo workspace, lockfile, Lean project and check, as `aven/actor` is. It depends on no
storage, no network and no avenDB, so the actor kernel, the engine and avenOS can each use it; the root workspace
excludes it as it excludes `aven/DB2`.

```
aven/runtimes/
  README.md          this plan
  spec/              Lean: Aven.Runtime, and the vectors it exports (the contract, the registry, the node tree)
  manifest.json      every frozen runtime: name, version, hash, floor, schemas, limits, users (append-only)
  host/              aven-runtimes-host: load by hash, refuse imports, fuel, memory, schemas, output limits
                     (native for the Peer, the kernel and the engine; wasm for a browser worker)
  freeze/            the reproducible build and the checks: no imports, declared memory, hash = manifest
  registry/          aven-runtimes-registry: the file registry, the sniffer, decide(); built native and to wasm
  tree/              built: the node-tree allowlist, shared by every runtime that draws and the applier
  contract/          built: the contract's failures, limits, results and render keys
  markdown/          built: markdown-runtime, the first file runtime (the docs need it first)
  face/              built: face-runtime, markup and style as data to a checked tree; here, not under actor/, since
                     it comes before actors and serves the docs wiki as much as actors' faces
  formats/           file runtimes still to come, one crate each, wasm32: text/ json/ csv/ svg/ pdf/
  actor/             actors' runtimes when they move in: state/ js/
  plugins/           plugin runtimes when they move in: ontology/
  drawers/           the trusted host code that draws checked output: tree (the applier), pixels, table
  hostile/           hostile parts and files per runtime, and the fuzz targets
```

Each runtime crate has one job, a size limit per file (DB2 rule 11), and a test that replays its Lean vectors.

## Loading by hash

| Who | Where the module comes from | How it runs |
|---|---|---|
| The actor kernel (`aven/actor/core`) | Linked as bytes into the kernel's build, from the manifest | `aven-runtimes-host` inside the kernel, in wasmi |
| The engine (`aven/DB2/db/engine`) | A plugin's lowering is Rust built twice: natively into the engine, and frozen as wasm | The native build runs; the check proves it equals the frozen module on every vector ([below](#moving-the-actors-runtimes-and-the-plugins-in)) |
| avenOS (file runtimes) | Static assets of avenOS's release, at `/runtimes/<hash>.wasm` on the files origin | `aven-runtimes-host` compiled to wasm, in a dedicated worker on the files origin ([below](#where-file-runtimes-run)) |

Every loader checks the module's BLAKE3 against the hash it asked for before it compiles a byte, and refuses a hash
the manifest doesn't list. A compiled module is a cache keyed by its hash.

## The file registry: one source of truth

Today the list of what may show inline is kept twice: `passive` in
[`files-sw.js`](../DB2/os/web/public/files-sw.js) and `kind()` in [`Chat.svelte`](../DB2/os/web/apps/Chat.svelte),
held in step by a comment (security fix #1493; [`store`](../DB2/store/README.md#what-a-file-may-run)). Both trust
the type the sender claims. **One registry replaces both,** with one entry per file type, and nothing else lists
types.

### What it decides

For each file, from its first bytes, its size and its claimed type, `decide` gives one **decision**:

1. **What the file really is,** by its bytes. Each binary type has signatures (bytes at an offset, with a mask: PNG's
   `89 50 4E 47 0D 0A 1A 0A`, JPEG's `FF D8 FF`, `RIFF….WEBP`, `ftyp` boxes for MP4 and AVIF, `%PDF-`). Text types have
   no magic: a file is text when its head is valid UTF-8 (or UTF-16 with a BOM) without NUL, and then a parse decides
   among them: an XML prolog or root element (`<svg` is SVG; anything with an HTML root, `<!DOCTYPE html` or `<script`
   is HTML), JSON by a bounded parse. Only then may the claimed type, or the name's extension, choose among formats the
   bytes can't tell apart: Markdown, CSV, TSV, code or plain text. **A claim never makes a file more able than its
   bytes:** a PNG claimed as HTML is a PNG, and HTML claimed as PNG is HTML, which downloads.
2. **How it shows:**
   - `native`: in the browser's own decoder, through `<img>`, `<audio>` or `<video>`. Those decoders are sandboxed
     and hardware-accelerated, and we never rewrite a codec. Only for binary types whose bytes say so, and within
     the dimensions their headers declare (PNG's IHDR, JPEG's SOF, GIF's screen, WebP's VP8 header, AVIF's `ispe`);
   - `runtime`: through a named file runtime, whose output a drawer shows;
   - `frame`: the browser's own viewer in a sandboxed frame. Only PDF, only until `pdf-runtime`;
   - `download`: everything else, and everything over a limit.
3. **Its limits:** the file's bytes; for `native`, its declared dimensions; for `runtime`, fuel, memory and output
   size, as the runtime declares them or tighter.
4. **How it is served** by the Service Worker: `Content-Type` (the sniffed type, never the claimed one), inline or
   attachment, and the same `nosniff` and `Content-Security-Policy: sandbox; …` on every answer as today. A file shown
   through a runtime is served only to the runtime's worker, as `application/octet-stream`.
5. **How its renders are cached:** by `(runtime hash, file hash, params hash)`, as a cache on the device (README rule
   5): kept in the files origin's own storage, evicted by size, dropped when its runtime falls below the floor, never
   synced, never part of a file Record. A reader always re-renders; nobody receives another's render as truth.

### Its shape

One entry per type; the registry is the list, with a version of its own.

```json
{ "type": "image/svg+xml",
  "detect": { "text": "xml", "root": "svg" },
  "show": { "runtime": "svg-runtime", "output": "pixels" },
  "limits": { "bytes": 4194304, "fuel": 2000000000, "memory": 268435456, "pixels": 16777216 },
  "serve": "worker",
  "cache": true }

{ "type": "image/png",
  "detect": { "signature": [ { "at": 0, "bytes": "89504e470d0a1a0a" } ] },
  "show": { "native": "img" },
  "limits": { "bytes": 67108864, "pixels": 67108864 },
  "serve": "inline",
  "cache": false }
```

`decide(registry, head, size, claimed) → { type, show, limits, serve }`, with `head` at most the first 64 KiB of the
first chunk, enough for every signature, header and text test, and `download` whenever
nothing matches.

### How everyone reads it

The registry is written once, in Lean (`Aven.Runtime.Registry`), with its examples beside it. `lake exe` exports it as
`registry.json` with its vectors, and `bun run up --check` fails when the export differs from what's committed (DB2
rule 10). Then **one implementation** reads it: `aven-runtimes-registry`, a small Rust crate with the JSON compiled
in, built twice:
- **natively and into the Peer-Light,** which sniffs a file when it is shared, records the sniffed type beside the
  claimed one in the file Record, and answers the Service Worker's reads with the sniffed type;
- **to a wasm module that imports nothing** (a pure function itself, though trusted), which the Service Worker and
  the chat load: the worker before every first answer for a file, the chat to pick how a file shows. Thin JS glue in
  each passes the head, the size and the claim, and takes the decision.

A reader never trusts a sniff another peer recorded; it sniffs again on read. So `passive` and `kind()` go, and the
Service Worker, the chat and the Peer-Light can't disagree, because they run the same bytes. Their tests replay the
same vectors. **The chat thread's native list** (images, audio, video and PDF inline with the browser's players, in
flight on 30 Oct 2026) is the registry's first content, unchanged in behaviour, before any runtime exists.

## Where file runtimes run

- **In a dedicated worker,** never on a page's main thread. The worker holds `aven-runtimes-host` (wasm) and the
  frozen modules; it receives a file's bytes from the Service Worker and the params from the page, and posts back the
  output, or a failure.
- **On the files origin,** never on the safe's: caps D17 and rule 13 ([caps](../DB2/id/caps/README.md#the-safe)),
  A15's three origins (avenOS, the safe, files). A runtime that imports nothing can't reach a key, the network or
  the DOM even on the safe's origin; the origin is the second wall, for a bug in the host's glue or in a drawer.
- **The worker has a wall clock as well as fuel.** Fuel stops a runtime at the same instruction on every device; the
  page also ends a worker that runs past its deadline (an interpreter bug, a host bug), and the file falls back to
  `download`.
- **Only checked data crosses back** to avenOS's page: a node tree or a plain Value, re-checked there by its drawer.
  No frame, no URL, no script.

Until the files origin exists, no file runtime ships. The registry (with `native`, `frame` and `download` only) ships
first, since it needs none.

## Two kinds of output, and the drawers

A file runtime's output is only one of two things.

1. **An allowlisted node tree,** the same tree actors' faces give: elements and attributes from one allowlist
   (`tree/`), text as text, URLs only of allowed schemes and never pointing off the network. The applier draws it into a
   shadow root and checks it again as it does for faces. Markdown, text and code, JSON and the CSV preview give trees.
2. **A plain Value** that a small trusted drawer shows:
   - **pixels:** `{width, height, rgba}`, drawn to a canvas with `putImageData`. SVG gives pixels: rasterized, an
     SVG never reaches the DOM, where its scripts, styles, links and external references would come with it;
   - **a table:** `{columns, rows, total}`, drawn as a virtualized table of text cells (a large CSV).

**The drawers** are host code in `drawers/`, written once, reviewed like a runtime, small, and fed only checked output:
the **tree** drawer is the applier; the **pixel** drawer is a canvas; the **table** drawer is one component. What needs
the GPU or a native codec stays in a drawer, and what parses hostile bytes stays in a runtime.

## Hostile files and their limits

Every file is hostile until its runtime has parsed it, and every limit holds before memory or time is spent (rule
10).

| Threat | What holds it |
|---|---|
| A claim that lies (HTML sent as `image/png`) | The bytes decide; the claim only chooses among text formats. Served with `nosniff` and a sandbox CSP regardless |
| A polyglot (bytes valid as both PNG and HTML) | The sniffed type decides the one path; no type ever leads to HTML on any origin |
| A decompression bomb (zlib in PNG and SVGZ, Deflate in PDF) | Decoded bytes count against memory and output limits inside the runtime; a native image's declared dimensions are checked before it reaches the decoder |
| Huge dimensions (a 100,000 × 100,000 SVG or PNG) | The header's dimensions against the registry's limit for `native`; for SVG the params give the raster size, capped by the output's pixel limit |
| Deep nesting (JSON, XML, Markdown block quotes and lists) | Each parser has a depth limit below its stack; fuel ends the rest |
| Entity expansion (billion laughs in SVG) | No DTD and no entities: an SVG that declares one is refused |
| Fuel exhaustion (a slow path in a parser) | Fuel per instruction ends the run as `outOfFuel`; the file shows as a download |
| Output floods (a million nodes, a 1 GB pixel buffer) | Output bytes, nodes, depth and pixels are limited by the runtime, checked by the host, and checked again by the drawer |
| External references (SVG `<image href>`, `<use>` across files, fonts; Markdown images; PDF links and embedded files) | A runtime can't fetch: it imports nothing. A reference to another file of the same Doc by hash becomes a separate file, decided on its own; anything else is dropped. Links in a tree keep only allowed schemes (`https:`, `mailto:`) and are never followed without a click |
| Data carried out through URLs (a tracking pixel, a link with secrets in it) | No remote image, ever; a link opens only by a click, in a new context, with `noopener` and `noreferrer` |
| A bug in a runtime | The wasm wall, then the worker, then the files origin, then the drawer's second check |
| A bug in a native decoder | The browser's own sandbox; we limit the formats and dimensions we hand it |
| A poisoned cache | Renders are keyed by hashes and never synced, so a peer can only poison its own |
| A bad runtime | Only from the repository, reviewed, fuzzed against its hostile corpus, frozen by hash |

Each runtime's hostile corpus (`hostile/<format>/`) has one file per row that applies, and its test asserts the exact
failure. A fuzz target per runtime runs in the box on demand and in the goal's CI.

## What Lean states

`Aven.Runtime`, in [`spec/`](spec), is written: core Lean 4.35.0, no packages and no `sorry`, on `Aven.Core`'s Values,
codec and hashes, which it requires by path (`aven/DB2/core/spec`) and never defines itself. The box builds and checks
it with the other specs (`bun run box sh sandbox/vectors.sh --check`, which `up --check` runs). It models the contract
and the decisions, not the parsers.

- **The contract** (`Contract`). A runtime's meaning is its answer for a part and an input, both Values, with what it
  costs in fuel and memory; the host's `run` checks the input's schema, the limits, and the output's schema and size,
  the length of its encoding in the one codec. `run` takes nothing else, so a device's clock and randomness never
  reach it (`deterministic`). Theorems:
  - `run_ok_fits`: every answer fits its schema, and its encoding its output limit;
  - `run_more_room`: more fuel, memory or output room never changes an answer;
  - `resolve_ge_floor`, `resolve_named`: a part runs on the version it names, or on the floor;
  - `admit_imports_nothing`, `admit_memory`: a module is admitted only when it imports nothing at all and declares a
    maximum memory within the limit;
  - `frozen`: the manifest only appends, so a frozen entry never changes; `loads_listed`: a host loads only bytes
    whose hash the manifest lists;
  - `renderKey_inj`: a render's cache key is the name of the Value `[runtime hash, file hash, params]`, so two keys
    with one name are one key, for a hash without collisions: a cached render is never handed out for another runtime,
    file or params.

  A run's result crosses as a Value, `{"ok": output}` or `{"failure": name}`.
- **The registry as a function** (`Registry`, its examples in `RegistryExamples`). `decideFile st head size claim`
  gives the type, the mode (`native`, `frame`, `runtime` or `download`, with the runtime's limits), how the Service
  Worker serves it, and its headers. Theorems:
  - `signatures_apart` (checked by the kernel over the whole table) and `sniffBinary_unique`: no bytes match two types'
    signatures, so the table's order doesn't matter;
  - `decide_binary_ignores_claim` and **`claim_never_adds`**: a file the browser shows (natively or framed) shows so
    whatever its sender claims;
  - `scriptable_never_inline`: HTML, XML and SVG are never served inline, whatever their bytes or claim;
  - `unknown_downloads`, `over_limit_downloads`;
  - `native_img_dims`: a native image's own header declares dimensions within its pixel limit;
  - `no_runtime_before_origin`: before the files origin, nothing runs (decision 3);
  - `serve_inline`: inline only for what the browser shows, and then as the sniffed type.

  Its 47 examples are real heads and hostile ones: a PNG claimed as HTML, HTML and an SVG claimed as PNGs, a
  PNG with HTML after its header, a PDF claimed as an image, XHTML behind a prolog, a 100,000 × 100,000 PNG, cut
  headers, NUL bytes, broken UTF-8, UTF-16, an ELF binary. The vectors add 200 heads cut and changed at random from
  them, under random claims.
- **The node-tree allowlist** (`Tree`). `check` is the applier's check: every node against the allowlist, and the
  tree within depth, node and text limits. Theorems: `check_no_forbidden` and `no_script` (no script, style, frame,
  object, form or SVG element), `check_no_handlers` (no `on…` attribute in any case, no `style`), `check_urls` (every
  `src` is a file of the network by its hash, every `href` is `https:`, `mailto:` or a fragment), `check_bounded`.
  27 examples, a `javascript:` link, a remote pixel, a `data:` image, an `ONLOAD` and a style attribute's `url()` among
  them.
- **The face-runtime's output** (`Face`). Markup and style together: the tree, and a style that is data (a class name
  and typed colours, size and weight per rule), from which the CSS text is generated. `faceOk` accepts it when the tree
  passes `check`, and a11y holds across both: `face_passes_check`, `face_named` (every interactive node has an
  accessible name), `face_roles` (a clickable non-control has a role and a tab stop), `face_alt`, `face_contrast` (every
  text has 4.5:1 against the background the style resolves under it, 3:1 when large) and `face_classes`. Contrast is
  exact integer arithmetic over one table, `linear` (sRGB to linear light, × 10⁷), which the vectors export: #767676
  on white passes and #777777 fails, as WCAG has it.
- **A face's style, typed** (`Style`, its examples in `StyleExamples`). What a slide needs, and avenBRAIN's slides are
  written in: a rule is a selector, a descendant chain of one to four compounds (an allowlisted tag, up to four
  classes), and typed declarations: placement, size, aspect, border, colours, the one bundled font, size, weight,
  leading, tracking, uppercase, centring, a transform of translate, rotate and scale, and the one arrowhead clip-path.
  No custom properties, no `url()`, no free text: `StyleRule.css` writes the CSS. Which rule reaches a node is CSS's
  cascade (classes, then tags, then the later rule). `styledOk` accepts a styled face when the tree passes `check`,
  every rule is in range (`styled_rules`), every text is at least 9 px where a slide is narrowest, 356 px, so 2.6cqw
  (`styled_size`), every text has enough contrast against what it is drawn on (`styled_contrast`: the nearest
  background above it, or an earlier sibling layer covering the whole parent), and names and `alt`s are there
  (`styled_named`). The examples are avenBRAIN's slide "A key signs", its layers and the shared slide rules, and 17
  faces the checks take or refuse. The face-runtime moves to it next, and its crate and the drawer with it.
- **state-runtime** (`State`, its examples in `StateExamples`). The grammar of a state part: a statechart and a
  reducer as data, one handler per message with its moves (`from → to`), its updates (`set`, `merge`, `append`,
  `remove` at a path of fields and indexes) and its sends (`tell`, `ask`, `reply`). A runtime is a pure
  `run(part, input)` the kernel calls, so it names nothing of the actors': a message is a sender's address, a name, a
  payload and an ask's id, all Values, and a step gives back the new state, its sends as data and the phase it moved
  to. `Aven.Actor` maps them to its effects and joins the step to its kernel and its machines; actors build on
  runtimes, never the reverse. `step` is total and deterministic; under the contract (`stateRuntime`) the part and
  the input are Values, the fuel a count of the part's work. Theorems:
  - `step_moves`: a step that answers took one of the part's moves for that message and phase; otherwise it refuses;
  - `step_allowed`: under a machine's transitions the part `fits`, the move is one they allow;
  - **an update touches only its path:** `get_set`, `get_set_other`, `get_remove` (for a path that ends at a field:
    removing an array's item moves the later ones up), and per update `set_get`, `merge_get`, `append_get`,
    `remove_get` and `update_other`; maps stay in the codec's order, so every state is an allowed Value;
  - `state_output_fits`, `state_never_badOutput`, `state_more_room`, `state_run_moves`.

  24 examples: the todo app's task and list, refusals in the wrong phase, paths that don't fit, a tell to something
  that isn't an address, fuel, memory and output limits, and inputs and parts that aren't ones.
- **Determinism, practically.** Lean can't see a wasm module, so the vectors carry it: each runtime's examples are
  exported with their outputs' hashes, and the check runs every vector in the native host and in all three browser
  engines and compares hashes. A float result must be bit-identical, so the host canonicalizes NaNs as it reads an
  output, and a runtime whose vectors differ between engines fails the check. This comes with the first runtime.
- **The cache key** is in the contract (`renderKey_inj`); a cache entry is dropped when its runtime falls below the
  floor.

**The vectors** (`spec/vectors/`, one vector per line): `table.json` (the registry and its signatures, the data the
registry crate compiles in), `registry.json`, `tree.json` and `face.json` (each tree and face with its encoding, a face
with each rule's CSS text), `contract.json` (each failure and an answer as encoded, render keys and their BLAKE3 names)
`state.json` (a part, an input and limits, and the result, all in the one codec) and `contrast.json` (`linear`,
then pairs of colours). A tree crosses as a Value: text as text, an element as
`[tag, [[name, value], …], [child, …]]`; a face as `{"tree", "style"}`; every example's is an allowed Value of the
codec. The parsers themselves stay outside Lean, as mechanics (rule 10): their hostile
corpora and fuzzing hold them.

**Choices the model made,** accepted as the safer defaults (the architect, 30 Oct 2026):
- The head is the first 64 KiB. A JPEG whose start of frame lies past it (a large EXIF block) downloads.
- An `ftyp` box's first byte must be 0 (it is always small), so MP4 and AVIF can't overlap a signature at offset 0.
- A text file is HTML only when its root is an HTML tag, as WHATWG's sniffing reads it; a Markdown note that mentions
  `<script>` further down stays Markdown, and its runtime draws it as text.
- UTF-16 text downloads; only UTF-8 is text.

## Performance gates

Measured first, then fixed, the way the store's opfs gates were: a spike in the box measures each runtime in the
native host and in Chromium, WebKit and Firefox, and its numbers become per-engine gates in `bun run up --check`.
The starting proposal, to be measured, for a cold run (module compiled and cached, file in the store):

| Runtime | Workload | Chromium, WebKit | Firefox | Native |
|---|---|---|---|---|
| any | instantiate a cached module | 20 ms | 40 ms | 5 ms |
| `text-runtime` | 1 MiB of code to a tree, the first 2,000 lines | 50 ms | 100 ms | 20 ms |
| `json-runtime` | 1 MiB to a collapsed tree | 100 ms | 200 ms | 40 ms |
| `csv-runtime` | 10 MiB, the first 1,000 rows and the row count | 200 ms | 400 ms | 80 ms |
| `markdown-runtime` | 200 KiB of GitHub-flavoured Markdown | 50 ms | 100 ms | 20 ms |
| `svg-runtime` | a 10 KiB icon at 512 × 512 | 50 ms | 100 ms | 20 ms |
| `svg-runtime` | a 1 MiB map at 2048 × 2048 | 2 s | 4 s | 800 ms |

Every runtime runs in wasmi (decision 5): an interpreter in safe Rust, the same everywhere, with no JIT to attack and
fuel that stops at the same instruction on every device. It costs perhaps ten times a JIT for parsing and more for
rasterizing. A runtime that misses its gate is made to do less (a smaller raster, fewer rows, a lazier parse) before
anything else; running modules on the host's own WebAssembly engine with injected fuel counters stays a later
decision of its own, taken only with the measurements in hand.

## The first file runtimes, in order

1. **What the chat needs next,** giving trees, a table or pixels:
   - `text-runtime`: plain text and code: UTF-8 (UTF-16 by its BOM), lines with numbers, long files to their first
     lines; highlighting comes in a later version;
   - `json-runtime`: JSON as a collapsible tree, with a depth limit;
   - `csv-runtime`: CSV and TSV, delimiter and quoting detected, a table Value of the first rows and the total;
   - `markdown-runtime`: CommonMark with GitHub's tables and task lists, raw HTML shown as text, links with allowed
     schemes only, images only as other files of the same Doc by hash;
   - `svg-runtime`: SVG rasterized to pixels, with resvg compiled to wasm: no DTD, no scripts, no external
     references, one font compiled into the module for text.
2. **`pdf-runtime` last.** Until then, a PDF keeps the browser's own viewer in a sandboxed frame where the engine
   renders one there, and downloads where it doesn't (as [`store`](../DB2/store/README.md#what-a-file-may-run) has it
   today). A PDF renderer in wasm is the largest runtime by far. The one that renders most beautifully wins
   (decision 10): a spike renders a corpus of real PDFs with each candidate and compares them to the reference.

Later: `gltf-runtime` and a trusted scene drawer for maiaCITY's 3D assets (not needed for now, Samuel, 30 Oct 2026), on
the same contract, its output a scene graph Value. `audio-runtime` and `video-runtime` never, since native players are
the right answer; `math-runtime`, `lean-runtime` and `three-runtime` as the actor spec lists them, on the same contract.

## Moving the actors' runtimes and the plugins in

**The actors' runtimes** are specified in `aven/actor/ARCHITECTURE.md` and not built yet. Decided (Samuel, 30 Oct 2026;
questions 1 and 8): they are built here from their first line, in `aven/runtimes/actor/*`, with `aven-runtimes-host` as
the kernel's runtime host, and the actor spec's section 13 points here instead of to `aven/actor/runtimes`. avenACTORS
keeps owning what each actor runtime does, its parts and its schemas; this package owns the contract, the host, the
import check, the manifest and the node-tree allowlist they share with file runtimes. avenACTORS agrees, and the order
of its version 1 (state first, then js, then face) stays its own.

**The plugins** are built-in Rust, versioned with the engine (engine D1), and A18 makes each a runtime. Both hold:
- a plugin's lowering is a pure Rust function in `aven/runtimes/plugins/<name>`, with no I/O;
- it is built natively and linked into the engine, which runs it at native speed inside the one writer;
- it is also frozen as a wasm module, whose hash is the lowering's name (A18's "an envelope carries the lowered
  hash");
- the check runs every vector through both builds and fails if they differ, so the native code means exactly what
  the frozen module means;
- loading a plugin at run time stays unneeded: every plugin is still from the repository.

The ontology plugin moves in after its first version exists in the engine, by the engine thread, which owns its
grammar and its Lean model.

## The order of work

Each step is Lean first, then Rust tests that replay its vectors, then code, as every part of avenDB works. Nothing
starts until Samuel says so (plan only).

1. **Lean `Aven.Runtime`:** the contract, the registry and its vectors, the node-tree allowlist.
2. **The registry, alone** (`registry/`): the crate, its wasm, the Service Worker and the chat reading it, `passive`
   and `kind()` gone, the Peer-Light recording sniffed types. Behaviour as the chat thread left it; the security gain
   is that bytes, not claims, decide. `sandbox/inline.mjs` and `sandbox/dome.mjs` extend to lying claims and
   polyglots.
3. **The host and the freeze** (`host/`, `freeze/`): wasmi with fuel and memory limits, the import check, the
   manifest, the reproducible build; hostile modules that import, grow memory, loop and flood output, which must fail.
4. **The files origin** (A15), with avenOS and avenPEER's planning: the runtime worker, the Service Worker serving it.
5. **Trees:** the allowlist crate and the applier as the tree drawer; `text-runtime`, `json-runtime`,
   `markdown-runtime`.
6. **Values:** the table drawer and `csv-runtime`; the pixel drawer and `svg-runtime`. The performance spike runs
   here, and its gates go into the check.
7. **PDF:** the spike, then `pdf-runtime`; the `frame` mode retires.
8. **Moves:** the actors' runtimes as avenACTORS builds them (from step 3 on), the ontology plugin when the engine has
   it.

## Decisions

Samuel answered the plan's twelve questions on 30 Oct 2026. Where he left one to us ("do what's best"), the choice is
the safer one, and it is marked so.

1. **One home.** Every runtime (actors', plugins', files') lives in `aven/runtimes`, its own workspace, with one
   contract, one host and one manifest. *Yes.*
2. **Names.** File runtimes are named after their format (`svg-runtime`), actors' after their job (`state-runtime`,
   `js-runtime`, `face-runtime`), plugins' after their plugin, all in one
   namespace. *Yes;* the glossary and the actor spec use these names.
3. **No file runtime before the files origin** (A15). The registry ships first, with `native`, `frame` and `download`
   only. *Yes.*
4. **One implementation of the registry.** The registry is one Rust crate, also built to wasm, which the Service
   Worker and the chat load, so the same code decides everywhere, instead of a Rust reader and a JS reader that could
   drift apart. *Ours: the wasm.* The generated JSON stays as the data and the vectors.
5. **wasmi everywhere.** *Ours, the more secure:* an interpreter has no JIT to attack, and its fuel is the same on
   every device. A runtime too slow there is made to do less first; a faster engine is a decision of its own later.
6. **Byte strings in Values.** *Decided by A2* ("CBOR is good"): the one codec is deterministic CBOR, whose byte strings
   carry file bytes, pixels and buffers in Values.
7. **Plugins as runtimes, built twice:** native in the engine, frozen as wasm whose hash names the lowering, with
   the check proving them equal. *Yes;* it reconciles D1 (built-in Rust) with A18.
8. **The actors' runtimes are born here,** in `aven/runtimes/actor/*`, with avenACTORS still owning what they do.
   *Yes;* avenACTORS agrees.
9. **One node-tree allowlist and one applier,** here, used by faces and files alike. *Ours: yes,* since a second
   allowlist would be the two-lists problem again.
10. **The PDF renderer:** *the most beautiful one.* A spike renders a corpus of real PDFs (text, fonts, vector
    drawings, images, forms) with each candidate that runs in wasm (PDFium, pdf.js's renderer, a pure-Rust one) and
    picks the one closest to the reference, within the runtime's limits.
11. **Frozen modules are rebuilt, not committed.** *Ours:* the repository holds the source and the manifest's hashes,
    the box rebuilds each module the same way every time and the check compares hashes, and releases carry the bytes,
    so no unreviewable binary sits in the repository.
12. **Nothing outside the network in a render:** no remote image, font or stylesheet, ever; links only by a click.
    *Yes,* a law of the registry.
