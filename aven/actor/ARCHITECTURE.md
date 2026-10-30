# Actor architecture

The single source of truth for avenACTOR, the actor engine in `aven/actor`. It is built from first principles, from
the bottom up: each layer uses only the layers below it. The learnings behind each choice are in
[`README.md`](README.md). Where the two disagree, this file wins.

Version 1 is a standalone app, in memory: a minimal todo app on one device, with no network, no avenDB and no
capabilities. Every layer is shaped so that later the same actors run peer to peer, persist everything in avenDB Docs,
and are guarded by capabilities from [avenID's caps spec](../DB2/id/caps/README.md), without changing the
layers above.

1. [The layers](#1-the-layers)
2. [Layer 0: Values](#2-layer-0-values)
3. [Layer 1: Docs](#3-layer-1-docs)
4. [Layer 2: messages](#4-layer-2-messages)
5. [Layer 3: runtimes](#5-layer-3-runtimes)
6. [Layer 4: actors](#6-layer-4-actors)
7. [Layer 5: the kernel](#7-layer-5-the-kernel)
8. [Layer 6: faces and the host](#8-layer-6-faces-and-the-host)
9. [Layer 7: the version 1 app](#9-layer-7-the-version-1-app)
10. [Laws](#10-laws)
11. [Later: peers, avenDB, capabilities](#11-later-peers-avendb-capabilities)
12. [Not in the engine](#12-not-in-the-engine)
13. [The package](#13-the-package)
14. [Version 1, step by step](#14-version-1-step-by-step)
15. [Decisions](#15-decisions)

## 1. The layers

```
 7  App         the version 1 todo app: definitions and their parts
 6  Faces       view-runtime and css-runtime draw a node tree; the host's applier shows it; events come back as tells
 5  Kernel      router, scheduler, turns, clock: pure Rust with no I/O, compiled to WebAssembly
 4  Actors      a definition (a Value), its Doc, and its turns
 3  Runtimes    pure functions over values: frozen WebAssembly modules named by hash, run with fuel
 2  Messages    tell, ask, reply, fail: Values appended to an inbox Doc, one per sender and receiver
 1  Docs        one writer each; their records named (writer, seq): Loro-shaped, in memory in version 1
 0  Values      immutable JSON, named by the BLAKE3 hash of its canonical bytes
 ── later ──    links between peers (frames on aven/db/1), Docs in avenDB, capabilities (aven/DB2/id/caps)
```

Each layer has one job. Nothing reaches past the layer directly below it.

## 2. Layer 0: Values

- **A Value** is immutable data: JSON with no surprises, that is null, true or false, a finite number, a string, an
  array, or a map with string keys. No functions, no references, no cycles, no `undefined`. avenDB calls it a Value
  too; a lowercase value in this file is just a field's data.
- **Canonical bytes**: keys sorted, numbers in one spelling, UTF-8. The same value always has the same bytes.
- **A name** is the BLAKE3 hash of a Value's canonical bytes, 64 lowercase hex characters. Definitions, parts and
  runtimes are named this way, so what a name names never changes.

Only Values cross a wall: between layers, into and out of runtimes, between the kernel and the host, and later between
peers.

## 3. Layer 1: Docs

**One actor is one Doc**, and every Doc has exactly one writer. avenDB calls it a Doc: mutable, named by its id, a
head over Values. An actor's Doc holds everything about it: its definition, its state, and every turn it took, each
with the message it handled, whole. Messages travel in **inbox Docs**, one for each sender and receiver, written only
by the sender.

```
 actor Doc   <home>/<id>                written only by the actor's home kernel
 ├─ def           the definition's name (its hash)
 ├─ state         the latest state, and the journal entry it follows
 └─ journal       one entry per turn: the message it handled, whole; the state hashes; the effects it sent

 inbox Doc   <sender> → <receiver>      written only by the sender's home kernel
 └─ log           the messages from that sender to that receiver, in the sender's order
```

Why two kinds of document, and not inboxes inside the receiver's Doc: in avenDB one Doc has one key and one
grant. A sender that could write into the receiver's Doc could also read its state, its journal and every other
sender's messages. With one inbox Doc per pair, each Doc keeps one writer, and a sender reaches nothing but
its own messages. This is the shape avenDB's chat already has, one chain per device.

The actor's own Doc still holds its whole history: its journal keeps each handled message whole, so an actor's
record never needs its inbox Docs. They are how messages travel, and once journaled they may later be compacted.

A Doc holds two things:

- **Logs**: append-only, written only by the Doc's writer. Each entry is a record named `(writer, seq)`, where `seq` counts
  the writer's entries from 1. That is how Loro names its operations (peer and counter), so a log maps
  onto a Loro list one to one.
- **Fields**: named values that the writer replaces whole (`def`, `state`).

Because every Doc has one writer, concurrent writers never conflict: two senders append to two different inbox
documents. The receiver's journal says in which order it handled them.

Everything is kept: every message, every turn, every trace. Compacting old journals and inbox Docs is a later
decision.

In version 1 Docs live in memory, behind a small interface: append to a log, read a log from a position, set and
get a field, take a snapshot. Later the same interface is an avenDB Doc, with Loro underneath (section 11).

## 4. Layer 2: messages

A message is a value. There are four kinds:

| Kind | Meaning |
| --- | --- |
| `tell` | Do or know this. No answer is expected |
| `ask` | Answer this by a deadline. Exactly one `reply` or `fail` comes back |
| `reply` | The answer to an ask |
| `fail` | The ask could not be answered: `timeout`, `refused` (no such actor, illegal now, a payload that fails its schema) or `error` (the turn threw or ran out of fuel) |

| Field | Meaning |
| --- | --- |
| `kind` | One of the four |
| `from`, `to` | Addresses, `<home>/<id>` |
| `seq` | The sender's count. `(from, seq)` names the message, and is its entry name in the inbox Doc |
| `name` | The message's name in the receiver's interface |
| `payload` | A value, checked against the interface's schema for `name` |
| `re` | For `reply` and `fail`: the ask it answers |
| `deadline` | For `ask`: when it fails if unanswered. 30 s unless the asker says otherwise; at most 10 minutes |
| `run` | The causal chain: every message a turn sends carries the run of the message it handled |

**Sending is appending.** To send, the sender's kernel appends the message to the inbox Doc for that sender and
receiver. In
memory this is a function call; later, between peers, it is the same append, carried by sync. One operation, at every
scale.

**Order is per pair of actors.** Messages from A to B are handled in the order A sent them, because the inbox Doc
from A to B is in A's order. Messages from different senders have no order between them until B's journal records the order in
which B handled them.

## 5. Layer 3: runtimes

**A runtime is a pure function from values to values**, frozen as a WebAssembly module and named by its hash:

```
run(part, input) → output        every one a value; nothing else goes in or comes out
```

The hard rule: **a runtime runs any part, from anyone (a person, a model, a peer), without trusting it, and never
reaches the host.** A runtime module imports nothing that reaches the host: no clock, no randomness, no network, no
storage, no DOM. Where a compiled engine expects system calls (QuickJS built for WebAssembly asks for a clock and
random bytes), the kernel answers them with a deterministic shim: the turn's frozen time, the turn's seed, and nothing
else. Everything a runtime needs comes in `input`; everything it does goes out as `output`. Sandboxing is the runtime's job and
the WebAssembly boundary's, not the part's.

- **Where runtimes come from.** Only the repository. Each is built from source in `aven/actor/runtimes`, reviewed,
  frozen, named by its hash and never changed. A new capability is a new version beside the old ones. A part names the
  version it was made for. A version that closes a hole raises the runtime's **floor**, and a part naming an older
  version runs on the floor.
- **How they run.** The kernel runs each runtime inside itself, in a pure-Rust WebAssembly interpreter with fuel
  metering (such as wasmi). Fuel is counted per instruction, so a runtime stops at the same point on every device, and
  the engine is the same in tests, natively and in the browser.
- **What every runtime declares**: its name, version and hash, its floor, the schema of its input and of its output
  (the kernel checks both), its fuel and memory limits, and whether its output may be journaled.

**The runtimes of version 1**, each rewritten from scratch, with the learnings in [`README.md`](README.md):

| Runtime | Part it runs | Gives back | Takes from |
| --- | --- | --- | --- |
| `json-runtime` | A declarative turn: for each message, updates to state (set, merge, append, remove by path) and messages to send. No code, so it always ends | A turn's output | avenVIBES's declarative inbox, where a payload merges into state with no code at all |
| `js-runtime` | JavaScript: `init`, `turn`, `present`, `preview` | A turn's output, or a view model | QuickJS compiled to WebAssembly. maiaCITY's logic core: a seeded random, a frozen clock, no binary buffers |
| `prolog-runtime` | A machine: fact-only Prolog with a real term parser | Whether the machine is well formed, and which messages are legal in a state | avenOS's `machine.ts`, without its comma splitting (README, weak spot 12) |
| `view-runtime` | A view: an allowlisted tag tree with `$`, `$$`, `$each`, `$on` and components | A safe node tree for one viewer | avenVIBES's view grammar; aven-brands' component library; maiaCITY's view engine and Markdown engine, which write every tag themselves |
| `css-runtime` | A style: tokens, component styles, variants and states as data | Scoped CSS text, from allowlisted properties and values only | avenVIBES's style engine and its eight states; aven-brands' brands as data. Raw CSS is never accepted |

Later: `markdown-runtime`, `math-runtime`, `three-runtime`, `lean-runtime`, and actors written in Rust as WebAssembly.

**The rules of faces**, which view-runtime and css-runtime enforce, after avenVIBES and the component library of
aven-brands (`brands/CEO/design-system/src/brand/actors`: 53 components, each a JSON Value). Components themselves are
definitions, and every placed one is an actor (section 6).

- **A placement is checked.** An unknown prop, slot or variant is an error, never silently ignored. A face sees only
  its own state and props, never its placer's.
- **Variants are axes that answer different questions**: what the thing means, what shape it has, how big it is.
  A danger icon button is `variant: danger` and `shape: icon`, never a variant of its own.
- **Anything true only for a moment is a state, not a variant.** There are eight: default, hover, focus, active,
  disabled, loading, error, selected. The runtime fixes their selectors (focus is `:focus-visible`, loading is
  `aria-busy`, selected is `aria-selected`, `aria-pressed` or `aria-current`). An interactive component must declare
  hover, focus, active and disabled, and the library fails to load without them.
- **Styles stay inside their face.** A component's custom properties are declared on itself, never globally. It sizes
  by container queries, never by the viewport; the only media query is `prefers-reduced-motion`.
- **The brand is data**: tones, roles, scales and tokens. The css-runtime generates every rule from it and from the
  components' styling. It never takes CSS text.

## 6. Layer 4: actors

**A definition** is a value, named by its hash:

| Field | Meaning |
| --- | --- |
| `interface` | The messages it accepts, each with a JSON schema for its payload; an ask also names its reply's schema |
| `machine` | Optional: a `prolog-runtime` part. If present, the kernel refuses any message the machine does not allow in the current `phase` |
| `turn` | Required: `{ runtime, v, part }` on `json-runtime` or `js-runtime` |
| `faces` | Optional: named faces, each a `present` function plus a `view-runtime` part and a `css-runtime` part |
| `init` | The first state |
| `lifetime` | `durable` (the default): the actor lasts until it is retired, and later persists in avenDB. `mounted`: it lives while the face that placed it shows it, and goes when it is unplaced |
| `replaces` | Optional: the name of the definition this one upgrades. Its actors move to the new definition, and a cap follows the upgrade only as far as the old interface reached (section 11) |
| `loads` | Later, with avenDB's engine: what the actor needs, in tiers. Devices decide how deep they keep it, and the `now` tier is handed into each turn as part of `given`, so an actor never fetches (section 11) |

An actor's code and faces are **parts**: values in a format, for the runtime of that format. Actors are mostly JSON;
`js-runtime` is for the turns that need code.

**An actor** is a live instance of a definition: an address `<home>/<id>` and its Doc. Its id is the hash of its
definition's name, its spawner's address and the spawner's count, so a replay names the same actors.

**A component is a definition, and every placed component is an actor.** A definition is the class: a Value, named by
hash, under one schema. A component is a definition whose main part is its face, like the 53 in aven-brands' library.
Every instance of one that a face places on a screen is a **face actor**: an address, a state and an inbox, like every
actor, with a `mounted` lifetime. A badge with nothing to remember is a face actor whose state is empty; a menu that
opens, a tab that is selected or a field being typed into keeps that in its state. There is one primitive.

A component's definition adds to the fields above:

| Field | Meaning |
| --- | --- |
| `props` | What its placer passes in: its first state, and later a `props` tell whenever they change |
| `events` | The messages it sends out, to whatever address its placer wires them to (by default the placer) |
| `slots` | The children its placer passes: faces of other actors. A leaf has no slots |
| `view`, `styling`, `a11y` | Its face's parts: its tag tree for view-runtime, its styling for css-runtime, its accessible names and roles |
| `name`, `description` | Its name, and why it is the way it is. A `$description` key is documentation at any depth |

**Placing** is spawning. In a face's view, `$use: { component, props, slots, on }` places a component: on the first
draw the kernel spawns a face actor at an address derived from its placer and its place (and, in `$each`, the item's
key); a later draw with new props sends it a `props` tell; a draw without it retires it. `$use: { actor, face }`
instead shows an existing actor's face, such as a durable task's row, without spawning anything.

**What is not a message.** Hover, focus and the other states that change only how something looks are CSS, selected
by the browser. Anything the app should know of (a press, an input, a toggle) is an event, and so a message.

**A turn** handles one message:

```
turn(state, message, given) → { state', effects: [tell | ask | reply ...], phase'? }
```

`given` holds the turn's time and random seed, both written in the journal so a replay sees the same.

**A machine** is a short list of facts:

```prolog
state(open).  state(doing).  state(done).
initial(open).
% transition(Message, From, To)
transition(start,  open,  doing).
transition(finish, doing, done).
transition(reopen, done,  open).
```

A message `start` reaches the turn only if `transition(start, phase, To)` exists for the actor's current `phase`, and
the turn's new `phase` must be that `To`. So the drawn machine and the behaviour cannot drift apart.

## 7. Layer 5: the kernel

The kernel is pure Rust with no I/O (avenDB's rule 2), compiled to WebAssembly for the browser and natively for tests.
Its host feeds it time and events and takes back what it draws. It has four parts:

- **Router.** Appends the message to the inbox Doc from its sender to its receiver. It answers an unknown
  receiver, or a payload that fails its schema, with a `fail`.
- **Scheduler.** Picks an actor with unread inbox entries and runs one turn. One actor never runs two turns at once;
  different actors may run in parallel. Across senders, the oldest arrival goes first.
- **Turns.** Each turn runs as shown below.
- **Clock.** The only source of time. It gives each turn its `given.now`, delivers `tick` and `at` messages, and turns an
  ask whose deadline has passed into a `fail`.

```
 inbox entry ─▶ machine allows it now?  payload fits its schema?  ── no ──▶ fail(refused) to the sender
                    │ yes
                    ▼
                runtime: turn(state, message, given), with fuel ──▶ output fits its schema?  new phase legal?
                    │ throws, out of fuel, or no                         │ yes
                    ▼                                                    ▼
          fail(error) to the sender;                       journal: append the turn (message, state hashes,
          the journal records the failure                  given, effects, fuel), then set the state
                                                                         │
                                                                         ▼
                                                           router appends each effect to its inbox Doc
```

A journal entry holds the message's name `(from, seq)`, the state hashes before and after, `given`, the effects, the
fuel used and the outcome. Replaying a journal on the same runtimes gives the same state.

**Spawning** is an ask to the kernel, which is an actor too: `spawn { def, init }` replies with the new address. In
version 1 any local actor may spawn, but only definitions that come from the repository.

**Asking** never blocks:

```
 A                                 kernel and clock                                 B
 │ ask(B, "quote", p, 30 s) ──────────▶│ ─────────────────────────────────────────────▶│
 │ phase: waiting                      │ deadline set                                  │ turn
 │                                     │◀────────────────────── reply(re = the ask) ───│
 │◀─────────────── reply ──────────────│
       or, with no reply by the deadline: fail(timeout); a reply after that is dropped
```

## 8. Layer 6: faces and the host

The host is the page. It runs the kernel in a worker, and holds one small piece of trusted code of its own, the
**applier**, written once in the repository.

```
 actor state ─▶ present (js- or json-runtime) ─▶ view model
                                                     │
          view part + view model ─▶ view-runtime ─▶ node tree ─┐
          css part              ─▶ css-runtime  ─▶ scoped CSS ─┤
                                                               ▼
                         applier: checks the tree again, writes it into the face's shadow root
                                                               │
         a click on a node with $on ─▶ event by name ─▶ tell from the person ─▶ that face actor's inbox
```

A screen is a tree of face actors. Each one's face renders into its own shadow root, so its styles stay its own, and
the applier fits each child's root into the place its placer left for it. A click goes to the face actor whose node
was clicked; its turn may send one of its `events` on, to the address its placer wired.

- **Runtimes never touch the DOM.** view-runtime and css-runtime compute a node tree and CSS text from values. Only
  the applier writes the DOM.
- **The applier trusts nothing.** It checks every node and attribute against the same allowlist again, checks every
  URL's scheme, and adds no script. It writes into a shadow root of its own, so a face cannot style or read the page.
- **A click is a message.** The applier turns an event on a node with `$on` into a `tell` from the device's person
  actor to the face actor that owns the node, through the router into its inbox, like every other message. The face shows the change as pending at once
  and drops it if the turn refuses.
- **Updates are deltas.** After each turn the applier receives only the nodes that changed.

## 9. Layer 7: the version 1 app

The app is nothing but actor instances on the engine. It has no code of its own beyond its definitions and their
parts, which are Values: the engine, the runtimes and the host are generic and know nothing about todos. Starting the
app spawns one `list`; each task is one more actor instance, spawned on demand. Standalone, in memory, in one page:

| Actor | Definition | Runtime |
| --- | --- | --- |
| `person` | The device's person: clicks come from it | built in |
| `kernel` | Spawns actors; is asked like any other | built in |
| `clock` | Ticks and deadlines | built in |
| `list` | Durable. Holds the tasks' addresses. Its face places a field, a button, and each task's row | `json-runtime` |
| `task` | Durable. A title and a machine (open, doing, done); its face, `row`, places a checkbox | `js-runtime`, `prolog-runtime` |
| `field`, `button`, `checkbox` | Components from the library: face actors, mounted while their placer shows them | `json-runtime` |

A person types into the field and presses the button. The press goes to the button's face actor, which sends its
`press` event to `list` as `add {title}`, as the list's face wired it; `list` asks `kernel` to spawn a `task`. Ticking a
task's checkbox sends `toggle` to that task, legal only as its machine allows, and its row redraws. Every message, turn and trace stays in the actors' Docs, in memory.

## 10. Laws

1. **Only messages.** Actors interact only by messages. Nothing reads or writes another actor's Doc.
2. **One door.** Every message, from a person, a click, an actor or the clock, goes through the router into an inbox.
   Nothing calls a turn directly.
3. **One at a time.** An actor handles one message at a time. Different actors run in parallel.
4. **No waiting.** A turn never waits. An answer or a timeout arrives as a later message, so nothing deadlocks.
5. **Pure turns.** A turn is deterministic and does no I/O. Time and randomness come in as `given`; everything it does
   goes out as effects.
6. **Every ask is answered once**, by a `reply` or a `fail`, by its deadline.
7. **One actor, one record.** An actor's Doc holds its definition, its state and every turn with the message it
   handled, whole. Every Doc has one writer; messages travel in inbox Docs, one per sender and receiver.
   Everything is kept.
8. **The journal is the truth.** Replaying it on the same runtimes gives the same state, anywhere.
9. **Runtimes compute; the host only draws.** A runtime imports nothing that reaches the host. Runtimes come only
   from the repository.
10. **Laws are code.** The kernel checks them. Never prompts, and never a reading of a part's source.
11. **Commit, then send.** A turn's state and journal entry commit together, in one write to the actor's Doc.
    Its effects are recorded in that entry and sent from it. A send lost in a crash is sent again from the journal,
    and the receiver drops it if it already has it, by `(from, seq)`.
12. **One primitive.** A component is a definition, its class; every placed component is a face actor. An actor's
    lifetime, durable or mounted, decides whether it persists.

## 11. Later: peers, avenDB, capabilities

Each later step replaces a layer's implementation, not its interface:

| Later | What changes |
| --- | --- |
| **Persistence** | Each actor's Doc becomes one avenDB Doc under one schema (`def`, `state`, `journal`), its journal a Loro list whose entries keep their names `(writer, seq)`. Each inbox Doc becomes one avenDB Doc, written only by the sender's home device and readable by the receiver's home, like the chat's chain per device. Each Doc has one key and one writer, and commits atomically; law 11 covers the sends that cross Docs |
| **Lifetimes** | Durable actors persist; mounted face actors stay in memory and go with their face. Whether their journals are kept after that is decided with compaction |
| **Wants** | The definition's `loads` (section 6): avenDB's engine keeps them current and hands the `now` tier into each turn |
| **Peers** | An actor lives on one peer, its home; its address names that peer's iroh `EndpointId`. Sending stays "append to the receiver's inbox log", now carried between peers by avenDB's sync. When the home is away, a keeper peer holds the inbox. There is no bus in the middle, and no gossip for messages |
| **Live delivery** | For speed, `message` and `ack` frames on `aven/db/1` deliver an append directly, point to point, ahead of sync. The receiver drops duplicates by `(from, seq)` |
| **Capabilities** | Caps are held by vaults, and the kernel holds them for its actors: actors hold no keys, and the signer of every write is a device. A message gains a `cap` field beside `run`, the cap it acts under; a turn's effects carry that cap or a narrower one, and an actor uses its own standing cap only for messages its definition declares as its own. A tell cap names messages of an interface, which the definition's hash pins. The inbox Doc from A to B belongs to A's vault and is written by A's home device; B's vault reads it, and B's router checks the cap: checked twice. Across an upgrade, a definition names the one it `replaces`: a tell cap follows the upgrade while every message it names keeps its schema, and a message that is new or changed is not covered until it is granted. Designed in avenID's caps spec, not here |
| **Compaction** | Old journal and inbox entries folded into snapshots, once we decide what may be forgotten |

## 12. Not in the engine

| Left out | Why |
| --- | --- |
| Capabilities, signatures, encryption | avenID's caps spec (`aven/DB2/id/caps`), designed in its own thread |
| Network and avenDB | Later (section 11); the Doc interface is the seam |
| Composites and skills | A composite is an actor whose turn tells other actors. No kernel concept, no members field, no merge law. "Skill" is a product word for such an actor |
| Studio, planner, `requires` / `produces` contracts, registry | Apps or actors that read definitions, later |
| The model, the store, HTTP and other doors | Actors, each added when something needs it |
| `explain`, learning, self-healing adapters | Later |

## 13. The package

`aven/actor`, its own package, Rust only, its crates members of the repository's one Cargo workspace:

```
aven/actor/
  README.md          the learnings
  ARCHITECTURE.md    this file
  spec/              the Lean model, Aven.Actor, and the vectors it exports
  core/              the kernel: Values, Docs, messages, router, scheduler, clock, the runtime host
  runtimes/
    json/  js/  prolog/  view/  css/     one crate each, built to WebAssembly, frozen by hash
  host/              the page's side: the worker that runs the kernel, and the applier
  components/        the component library: definitions with faces, after aven-brands
  app/todo/          the version 1 app: its definitions and parts
```

## 14. Version 1, step by step

Test-first, as avenDB works: the Lean model and its theorems, then Rust tests that replay its vectors, then the code.

1. **Lean** (`spec`): values, logs, messages, turns, asks, the journal. Theorems: messages from one actor to another are
   handled in order; every ask gets exactly one answer by its deadline; a message is handled once; a turn never waits;
   replaying a journal gives the same state; a machine refuses every illegal message.
2. **Layers 0 to 2** (`core`): Values and names, the in-memory Doc, messages, with the vectors.
3. **Runtimes**: `prolog-runtime` and `json-runtime` first, then `js-runtime`; each with hostile parts that try to get
   out, run too long or blow up, which must fail.
4. **The kernel** (`core`): router, scheduler, turns, clock, spawning; native tests replay the vectors.
5. **Faces**: `view-runtime`, `css-runtime`, the applier, events as tells.
6. **The app**: the todo app in a page, the kernel in a worker.

What version 1 is not: no network, no avenDB, no capabilities, no encryption, no composites, no Studio, no planner.

## 15. Decisions

Decided (Samuel, 30 Oct 2026):

- Its own package, `aven/actor`, in Rust only, compiled to WebAssembly.
- Actors are mostly JSON, with JavaScript where code is needed, run by on-demand runtimes such as QuickJS.
- The runtimes are rewritten from scratch and named `<format>-runtime`. They run untrusted parts securely and never
  reach the host.
- Version 1 is a standalone, in-memory todo app: no network, no avenDB, no capabilities.
- Frames as JSON lines when the network comes; ids derived from definition, spawner and count; only definitions from
  the repository are spawned.
- Everything about an actor lives in its own Doc, shaped for Loro, and everything is kept.

Decided here, on those grounds:

- Order is per pair of actors, and the receiver's journal fixes the order of handling (section 4).
- Inboxes are documents of their own, one per sender and receiver, each written only by the sender, so every document
  keeps one writer and one key; the actor's journal keeps each handled message whole (section 3). Taken from the
  avenDB engine thread's review of this design.
- Asks default to 30 s, at most 10 minutes. Machines are in version 1. One person actor per device. The first app is
  the todo app (section 9).
- Runtimes run inside the kernel in a pure-Rust WebAssembly interpreter with fuel. If one proves too slow there, it
  moves to the host's own WebAssembly engine, with fuel counters added when it is frozen.
- The in-memory Doc is plain Rust behind the Doc interface, simple to model in Lean. Loro comes with
  avenDB's documents.
- Faces render into shadow roots through the applier. Opaque frames are for runtimes that run scripts in the page,
  which version 1 has none of.

- A component is a definition, its class; every placed component is a face actor, with a mounted lifetime
  (Samuel, 30 Oct 2026). Faces follow the rules of aven-brands' component library and avenVIBES (section 5).

Open: nothing for version 1.
