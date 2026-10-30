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
 6  Faces       face-runtime draws a node tree and its CSS; the host's applier shows it; events come back as tells
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

- **A Value** is immutable data: JSON with no surprises, that is null, true or false, an integer, a string, an
  array, or a map with string keys. Version 1 has integers only (Samuel, 30 Oct 2026); decimals come when an app needs
  them, with the same encoding as avenDB's. No functions, no references, no cycles, no `undefined`. avenDB calls it a Value
  too; a lowercase value in this file is just a field's data.
- **Canonical bytes**: keys sorted, numbers in one spelling, UTF-8. The same value always has the same bytes. The
  encoding is avenDB's one codec (its architecture, rule 1 and K1): deterministic CBOR (RFC 8949, core deterministic
  encoding) in a strict profile, with JSON as the readable form (Samuel, 30 Oct 2026). It is shared byte for byte, so a Value has one name in
  the actor engine and in avenDB: bytes that don't encode back to themselves are refused, and Lean proves decoding and
  encoding inverse.
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
 actor Doc   <scope>/<id>/<n>           written only by the actor's home kernel
 ├─ def           the definition's name (its hash)
 ├─ state         the latest state, and the journal entry it follows
 └─ journal       one entry per turn: the message it handled, whole; the state hashes; the effects it sent

 inbox Doc   <sender> → <receiver>      written only by the sender's home kernel
 └─ log           the messages from that sender to that receiver, in the sender's order
```

Why two kinds of document, and not inboxes inside the receiver's Doc: in avenDB one Doc has one key and one
grant. A sender that could write into the receiver's Doc could also read its state, its journal and every other
sender's messages. With one inbox Doc per pair, each Doc keeps one writer, and a sender reaches nothing but
its own messages. This is the shape avenDB's chat already has, one chain per device. Later, between devices, the
inboxes from one vault's actors to another's travel together in one Doc per pair of vaults (section 15).

The actor's own Doc still holds its whole history: its journal keeps each handled message whole, so an actor's
record never needs its inbox Docs. They are how messages travel, and once journaled they may later be compacted.

A Doc holds two things:

- **Logs**: append-only, written only by the Doc's writer. Each entry is a record named `(writer, seq)`, where `seq` counts
  the writer's entries in that Doc from 1, with no gaps. That is how Loro names its operations (peer and counter), so a log maps
  onto a Loro list one to one.
- **Fields**: named values that the writer replaces whole (`def`, `state`).

Because every Doc has one writer, concurrent writers never conflict: two senders append to two different inbox
documents. The receiver's journal says in which order it handled them.

Everything is kept: every message and every turn. Compacting old journals and inbox Docs is a later
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
| `fail` | The ask could not be answered: `timeout`, `refused` (no such actor, illegal now, a payload that fails its schema) or `error` (the turn threw or ran out of fuel). Only an ask gets a `fail`. A refused or failed tell is journaled (section 7), and its sender is not told |

| Field | Meaning |
| --- | --- |
| `kind` | One of the four |
| `from`, `to` | Addresses, `<scope>/<id>/<n>` (section 6) |
| `seq` | The message's number in the inbox Doc from `from` to `to`: counted **per pair of actors**, from 1, with no gaps, so a receiver sees a missing one. `(from, to, seq)` names the message; inside its inbox Doc, `seq` alone does |
| `name` | The message's name in the receiver's interface |
| `payload` | A value, checked against the interface's schema for `name` |
| `re` | For `reply` and `fail`: the ask it answers, by its `(from, to, seq)` |
| `deadline` | For `ask`: when it fails if unanswered. 30 s unless the asker says otherwise; at most 10 minutes |
| `run` | The causal chain: every message a turn sends carries the run of the message it handled |
| `cap` | Reserved for capabilities (section 11). Absent in version 1 |

**Reserved fields.** Later steps add fields that version 1 does not use: a message's `cap`, the `now` tier of an
actor's loads in `given`, a definition's `loads`, a Doc's `schema` (the version of its type) and `branch`, and the
address's scope. Version 1 refuses any Value that sets a reserved field, so nothing comes to depend on it missing, and
adding one later changes no shape.

**Sending is appending.** To send, the sender's kernel appends the message to the inbox Doc for that sender and
receiver. In
memory this is a function call; later, between peers, it is the same append, carried by sync. One operation, at every
scale.

**Order is per pair of actors.** Messages from A to B are handled in the order A sent them, because the inbox Doc
from A to B is in A's order. Messages from different senders have no order between them until B's journal records the order in
which B handled them.

**Order between peers.** The same holds local-first and peer to peer, because no message is ever ordered by a CRDT
merge. Each inbox is one writer's append-only log, each entry numbered by `seq` and later chained by hash, so there
is nothing to merge and nothing to conflict. Sync may bring entries late or out of order; the receiver handles entry
`n + 1` only after entry `n`, and a gap waits until sync fills it (`handled_in_order` holds for every schedule, and
a sync's delays are a schedule). What is not promised:

- **No causal order across pairs.** If A tells B `x`, then tells C, and C then tells B `y`, B may handle `y` before
  `x`. A message that must come after another says so in its payload, and the turn waits for it in its state.
- **Offline means later, not lost.** A message to an actor on a device that is away waits in its inbox; a turn never
  waits for it. An ask to it fails with `timeout` at its deadline, and an answer after that is dropped.
- **A gap holds up the pair behind it.** One missing entry holds back the later ones from that sender, until sync or
  a keeper brings it.
- **Moving an actor's home** (A17: the address names no device) needs a handover: the new home continues the actor's
  logs from the last entry of the old one, and the old one writes no more. Specified with avenPEER, later.

**Ask or tell.** The two differ in whether an answer comes back, not in reading or writing. An `ask` is a call: one
question, exactly one `reply` or `fail`. A `tell` is a notice: no answer. A one-off read is an ask. A write that can
be refused (no cap, a schema, a conflict) is an ask too, since its sender needs the outcome. A tell is for what
needs no answer: an event, a notice, a person's decision that comes when it comes.

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

- **Where runtimes come from.** Only the repository. Each is built from source in `aven/runtimes/actor` (section 13), reviewed,
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
| `state-runtime` | A declarative turn: for each message, updates to state (set, merge, append, remove by path) and messages to send. No code, so it always ends | A turn's output | avenVIBES's declarative inbox, where a payload merges into state with no code at all |
| `js-runtime` | JavaScript: `init`, `turn`, `present` | A turn's output, or a face data | QuickJS compiled to WebAssembly. maiaCITY's logic core: a seeded random, a frozen clock, no binary buffers |
| `face-runtime` | A face's `markup` part (an allowlisted tag tree with `$`, `$$`, `$each`, `$on` and components) and its `style` part (tokens, component styles, variants and states as data), with the face data. Two entry points: the style once per definition, shared by every instance, and the tree whenever the data changes | A safe node tree for one viewer, and scoped CSS from allowlisted properties and values only. It checks the face's `a11y` across both: every interactive node has an accessible name and role, and text has enough contrast | avenVIBES's view grammar, style engine and eight states; aven-brands' component library and brands as data; maiaCITY's view engine and Markdown engine, which write every tag themselves. Raw CSS is never accepted |

Later: `markdown-runtime`, `math-runtime`, `three-runtime`, `lean-runtime` (turns written in Lean, with proofs), a logic
runtime if machines ever need rules, and actors written in Rust as WebAssembly.

**The rules of faces**, which face-runtime enforces, after avenVIBES and the component library of
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
- **The brand is data**: tones, roles, scales and tokens. The face-runtime generates every rule from it and from the
  components' styling. It never takes CSS text.

## 6. Layer 4: actors

**A definition** is a value, named by its hash:

| Field | Meaning |
| --- | --- |
| `interface` | The messages it accepts: each a `name`, a `description`, and its payload's type by id; an ask also names its reply's type. Its second part is the machine |
| `sends` | The messages its turns may send, by type id. The router enforces it: an effect whose type, in the receiver's interface, the sender did not declare is refused, as one to no live actor is (section 7); `describe` needs no declaring |
| `machine` | Optional: the interface's second part, a table of phases. If present, the kernel refuses any message the machine does not allow in the current `phase` |
| `turn` | Required: `{ runtime, v, part }` on `state-runtime` or `js-runtime` |
| `faces` | Optional: named faces, each `{ present, markup, style, a11y }`. `present` (optional; without it the markup sees the state) is a part on state- or js-runtime that gives the face data; `markup` and `style` are the parts face-runtime draws, `a11y` the accessible names and roles it checks. Only the runtimes are one; the parts stay apart |
| `init` | The first state |
| `lifetime` | `durable` (the default): the actor lasts until it is retired, and later persists in avenDB. `mounted`: it lives while the face that placed it shows it, and goes when it is unplaced |
| `replaces` | Optional: the name of the definition this one upgrades. Its actors move to the new definition, a lens carrying their state into its shape (section 15), and a cap follows the upgrade only as far as the old interface reached, and only in a vault that has itself adopted the new definition (section 11) |
| `loads` | Later, with avenDB's engine: what the actor needs, in tiers. Devices decide how deep they keep it, and the `now` tier is handed into each turn as part of `given`, so an actor never fetches (section 11). An entry may name a query; installing the actor registers in its vault the sealed index that query needs, by the owners' act (avenDB A26) |

An actor's code and faces are **parts**: values in a format, for the runtime of that format. Actors are mostly JSON;
`js-runtime` is for the turns that need code.

**An actor** is a live instance of a definition: an address `<scope>/<id>/<n>` and its Doc. Its id is the hash of its
definition's name, its spawner's address and the spawner's count, so a replay names the same actors; a face actor's id
is the hash of its placer's address and its place (section 6, placing). `n` is the **incarnation**: the kernel counts
how often each id has been spawned, so an id spawned again, such as a face placed again after it was unplaced, is a
new actor with a new Doc, whose messages count from seq 1 again without being taken for the old one's. The old Doc is
kept, closed. The scope is `local` in version 1; what it names later is open (section 15).

**A component is a definition, and every placed component is an actor.** A definition is the class: a Value, named by
hash, under one schema. A component is a definition whose main part is its face, `faces.main`, like the 53 in aven-brands' library.
Every instance of one that a face places on a screen is a **face actor**: an address, a state and an inbox, like every
actor, with a `mounted` lifetime. A badge with nothing to remember is a face actor whose state is empty; a menu that
opens, a tab that is selected or a field being typed into keeps that in its state. There is one primitive.

A component's definition adds to the fields above:

| Field | Meaning |
| --- | --- |
| `props` | What its placer passes in: its first state, and later a `props` tell whenever they change |
| `events` | Which of its `sends` go to whatever address its placer wires them to (by default the placer) |
| `slots` | The children its placer passes: faces of other actors. A leaf has no slots |
| `name`, `description` | Its name, and why it is the way it is. A `$description` key is documentation at any depth |

**Placing** is spawning. In a face's markup, `$use: { component, props, slots, on }` places a component: on the first
draw the kernel spawns a face actor at an address derived from its placer and its place (and, in `$each`, the item's
key); a later draw with new props sends it a `props` tell; a draw without it retires it, which ends that incarnation. `$use: { actor, face }`
instead shows an existing actor's face, such as a durable task's row, without spawning anything.

**Types, not words.** A message's payload is typed by a **type id**, `<type Doc>/<schema hash>`: the address of one
version in a type Doc, whose Record's id is its schema's hash (K5, avenDB's docs spec). It is the same from version 1
on, where type Docs live in memory like every Doc. Equal schemas in two type Docs are two types; two type ids joined by a
path of lenses are compatible. A message's `name` is a label in one interface, and its `description` is prose for people and models. Neither is ever
matched: whatever links two actors links them by type id.

**Self-description.** Every actor accepts a built-in ask, `describe`, which the kernel answers on its behalf from
its definition, its current phase and the asker's caps (Samuel, 30 Oct 2026). The answer lists what the actor is
(`name`, `description`) and every message the asker may send it now, each with its name, description, payload type
and schema, and its reply's type for an ask. These are its **tool specs**: the same shape a model's tool list takes
(a name, a description, an input schema), so a model's tools are a projection of `describe`, never configured
apart. One answer serves a model asking "what do you do, and how can I use you?", Studio, and another actor. A
plain-language `explain`, a model reading the definition and answering in words, is an ordinary actor built on
`describe`, later.

**Lenses.** A lens is a two-way mapping between two type versions, a Value, with laws: a round trip keeps what both
sides can hold, and a lossy step states its loss. It joins a version to its parent inside one type Doc, and versions
of two different type Docs alike: one concept, everywhere in the stack (Samuel, 30 Oct 2026).

Who publishes and who uses a lens (avenDB A7, extended):

- A lens inside one type Doc is published by whoever may write that type Doc (K5).
- A lens between two type Docs is a Value anyone may write. It takes effect for a Doc or a vault only when its owners
  pin it, as they pin type versions, and only after the checker has held it to its laws.
- A reader uses only the lenses pinned where it reads. For a message, the receiving vault's pins decide: the receiver
  judges.
- The pinned lenses of one place form a forest: a pin that would make a second path between two versions there is
  refused, so every path is unique and the laws hold along it. No peer sees every lens in the world, so there is no
  global forest, only each place's.

Between actors, a message whose type differs from the one the receiver accepts is delivered when a path of lenses
joins them among the lenses the receiver's vault has pinned: the router reads the payload through the path into the
receiver's type, and a reply comes back through
it the other way. The journal entry pins the lenses used, by hash, so a replay reads the same. With no path the
message is refused, as an undeclared one is. Nothing is translated by guessing: no names, no prose.

This replaces Abject's negotiator and self-healing adapters. Where Abject had a model write a proxy at run time, per
pair, as code, a lens is written once, as data: a model may propose one, the checker holds it to the laws, it is frozen by
hash, and a vault's owners pin it (their approval is a tell), after which every actor and reader there reuses it.

**Derived edges.** There is an edge from A to B wherever a type in A's `sends` is a type B's interface accepts, or one
joined to it by lenses pinned in B's vault. The graph is a query over definitions, computed and never stored, so the drawn graph, a planner's input and what the
kernel allows are one rule. Where a placer wires a face actor's `events`, the wire must follow such an edge. This is
Abject's requires and produces, by type id instead of by predicate.

**What is not a message.** Hover, focus and the other states that change only how something looks are CSS, selected
by the browser. Anything the app should know of (a press, an input, a toggle) is an event, and so a message.

**A turn** handles one message:

```
turn(state, message, given) → { state', effects: [tell | ask | reply ...], phase'? }
```

`given` holds the turn's time and random seed, both written in the journal so a replay sees the same (later also the
`now` tier of its loads, reserved).

**A machine** is data: Prolog's facts `transition(Message, From, To)`, and nothing else, written as a Value. The
interface and the machine are one structure in two parts. The interface gives each message its name and schema, the
same in every phase, since caps rely on a message keeping its schema. The machine gives, per phase, the messages
allowed and the phases each may lead to:

```json
{ "initial": "open",
  "phases": { "open": { "finish": ["done"] },
              "done": { "reopen": ["open"] } } }
```

A message `finish` reaches the turn only if the current `phase` allows it, and the turn's new `phase` must be one of
the phases it lists; the kernel checks both with a lookup. So the drawn machine and the behaviour cannot drift apart.

Prolog's roles are split (Samuel, 30 Oct 2026). Its facts are this table; there is no Prolog runtime. Its checks run
once, when a definition is admitted: every phase named is declared, the initial phase exists, every message is in the
interface, every phase is reachable from the initial one. That checker is proven correct in Lean once and replays
Lean's vectors, so it can later admit definitions made by people or models with no Lean at run time. Deeper questions
about one definition, such as "can it get stuck?", are Lean proofs in the repository, checked before it is frozen; a
finite table is decided by Lean automatically. Kept from Prolog: facts as data, relations as tuples, "which messages
are legal now" as a query over facts, every check declarative.

## 7. Layer 5: the kernel

The kernel is pure Rust with no I/O (avenDB's rule 2), compiled to WebAssembly for the browser and natively for tests.
Its host feeds it time and events and takes back what it draws. It has four parts:

- **Router.** Appends the message to the inbox Doc from its sender to its receiver. A message to an actor that is not
  live is refused and never appended, so an address not yet spawned never holds messages from before its birth: the
  sending turn's journal entry records that effect as `refused`, and an ask gets `fail(refused)` from the kernel. Its
  `re` names the ask with seq 0, which no sent message has, so it can never be taken for the answer to a real ask.
- **Scheduler.** Picks an actor with unread inbox entries and runs one turn. One actor never runs two turns at once;
  different actors may run in parallel. Across senders, the oldest arrival goes first.
- **Turns.** Each turn runs as shown below.
- **Clock.** The only source of time. It gives each turn its `given.now`, delivers `tick` and `at` messages, and turns an
  ask whose deadline has passed into a `fail`.

```
 inbox entry ─▶ machine allows it now?  payload fits its schema?  ── no ──▶ journaled as refused; an ask gets fail(refused)
                    │ yes
                    ▼
                runtime: turn(state, message, given), with fuel ──▶ output fits its schema?  new phase legal?
                    │ throws, out of fuel, or no                         │ yes
                    ▼                                                    ▼
          journaled as error, state unchanged;             journal: append the turn (message, state hashes,
          an ask gets fail(error)                          given, effects, fuel), then set the state
                                                                         │
                                                                         ▼
                                                           router appends each effect to its inbox Doc
```

A **journal entry** holds the message it handled, whole; the definition in force; the hash of the runtime that
actually ran (after any floor) and the interpreter's version, which fixes the fuel schedule; `given`; the state hashes
before and after; the effects; the fuel used; and the **outcome**: `done`, `refused` with its reason, or `error` with
its reason. A refused or failed message is journaled too, and leaves the state as it was. Replaying a journal with
what it pins gives the same state.

**Spawning** is an ask to the kernel, which is an actor too: `spawn { def, init }` replies with the new address.
**Retiring** is a tell to it: `retire { address }`. In version 1 any local actor may spawn, but only definitions that
come from the repository. The kernel has no other operations: everything is a message or the clock (Samuel, 30 Oct
2026).

**Doors.** An actor's own data is its own state, changed by its own turn and saved with it, atomically. Every other
Doc is someone else's (law 1), reached only by messages to a **door**: a built-in actor that does I/O for the others.
The doors are the engine (Docs and Records, later), files, and later the model and HTTP. The store is not a door: it
sits inside avenDB, below the engine. A door:

- runs in the host, outside the pure kernel. Its answers arrive as messages, journaled by their receivers, so a replay
  never runs a door again;
- takes one message as one atomic operation: a write that touches several Records is one ask;
- acts only with the cap the message carries, never its own (no confused deputy);
- handles one sender's messages in order, so an actor reads its own writes.

A standing read is not a message: it is the definition's `loads`, handed into each turn and journaled as (Doc,
version, query hash). When a loaded Doc changes, the engine sends the actor one `changed` tell, and its next turn sees
the new data. Turns keep three effects: tell, ask and reply (Samuel, 30 Oct 2026).

**A timeout does not mean "not done".** A write asked of a door may still commit after its ask timed out, as on any
network. The door's answer to a later read is the truth, so a turn that needs to know asks again.

**Approvals are tells.** A turn that needs a person's decision tells the person actor, and the decision comes back as
a tell whenever the person makes it, in minutes or days. An ask is for answers within its deadline (Samuel, 30 Oct
2026).

**Answers.** A `reply` or `fail` reaches the asker as a message named `reply` or `fail`, so a machine can wait for it
(`transition(reply, waiting, done)`). An actor can answer only an ask that was sent to it and is still waiting; any
other reply is dropped, so answers cannot be forged or sent twice.

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
 actor state ─▶ present (state- or js-runtime) ─▶ face data
                                                      │
     markup part + style part + face data ─▶ face-runtime ─▶ node tree    (whenever the data changes)
                                                         ─▶ scoped CSS   (once per definition)
                                                                 │
                         applier: checks the tree again, writes it into the face's shadow root
                                                                 │
         a click on a node with $on ─▶ event by name ─▶ tell from the person ─▶ that face actor's inbox
```

A screen is a tree of face actors. Each one's face renders into its own shadow root, so its styles stay its own, and
the applier fits each child's root into the place its placer left for it. A click goes to the face actor whose node
was clicked; its turn may send one of its `events` on, to the address its placer wired.

- **Runtimes never touch the DOM.** face-runtime computes a node tree and CSS text from values. Only
  the applier writes the DOM.
- **The applier trusts nothing.** It checks every node and attribute against the same allowlist again, checks every
  URL's scheme, and adds no script. It writes into a shadow root of its own, so a face cannot style or read the page.
- **A click is a message.** The applier turns an event on a node with `$on` into a `tell` from the device's person
  actor to the face actor that owns the node, through the router into its inbox, like every other message. The face shows the change as pending at once
  and drops it if the turn refuses.
- **Nothing leaves through a URL.** The page's CSP limits `img-src`, `font-src` and `media-src` to `'self'` and
  `blob:`, and allows no script but the host's. face-runtime refuses `url()` except a content hash. A link opens only
  through a confirmation the host draws, outside every face.
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
| `list` | Durable. Holds the tasks' addresses. Its face places a field and each task's row | `state-runtime` |
| `task` | Durable. A title and a machine (open, done); its face, `row`, places a checkbox | `js-runtime` |
| `field`, `checkbox` | Components from the library: face actors, mounted while their placer shows them | `state-runtime` |

A person types into the field: each keystroke is a tell to the field's face actor, which keeps the text in its own
state. Enter, or the button inside the field's own face, makes the field send its `submit {text}` event, which the
list's face wired to `list` as `add`; `list` asks `kernel` to spawn a `task`. Ticking a task's checkbox makes the
checkbox send its `check` or `uncheck` event, which the row wired to the task's `finish` or `reopen`, legal only as its
machine allows, and the row redraws. Every message and turn stays in the actors' Docs, in memory.

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
    and the receiver drops it if it already has it, by its `seq` in that inbox.
12. **One primitive.** A component is a definition, its class; every placed component is a face actor. An actor's
    lifetime, durable or mounted, decides whether it persists.

## 11. Later: peers, avenDB, capabilities

Each later step replaces a layer's implementation, not its interface:

| Later | What changes |
| --- | --- |
| **Persistence** | Each actor's Doc becomes one avenDB Doc under one schema (`def`, `state`, `journal`), its journal a Loro list whose entries keep their names `(writer, seq)`. Each inbox Doc becomes one avenDB Doc, written only by the sender's home device and readable by the receiver's home, like the chat's chain per device. Each Doc has one key and one writer, and commits atomically; law 11 covers the sends that cross Docs |
| **Lifetimes** | Durable actors persist; mounted face actors stay in memory and go with their face. Whether their journals are kept after that is decided with compaction |
| **Wants** | The definition's `loads` (section 6): avenDB's engine keeps them current and hands the `now` tier into each turn |
| **Peers** | An actor lives on one peer, its home, which routing finds; whether the address's scope names the home or a vault is open (section 15). Sending stays "append to the receiver's inbox log", now carried between peers by avenDB's sync. When the home is away, a keeper peer holds the inbox. Keepers are blind and see as little as possible: outside a segment only the Doc, the key epoch and the padded length; they hand out entries by arrival order, to readers who prove they hold the key (avenID caps, D13). There is no bus in the middle, and no gossip for messages |
| **Live delivery** | For speed, `message` and `ack` frames on `aven/db/1` deliver an append directly, point to point, ahead of sync. The receiver drops duplicates by their `seq` in the inbox |
| **Capabilities** | Caps are held by vaults, and the kernel holds them for its actors: actors hold no keys, and the signer of every write is a device. A message gains a `cap` field beside `run`, the cap it acts under; a turn's effects carry that cap or a narrower one, and an actor uses its own standing cap only for messages its definition declares as its own. A tell cap names messages of an interface, which the definition's hash pins. The inbox Doc from A to B belongs to A's vault and is written by A's home device; B's vault reads it, and B's router checks the cap: checked twice. Across an upgrade, a definition names the one it `replaces`: a tell cap follows the upgrade while every message it names keeps its schema, and a message that is new or changed is not covered until it is granted. `replaces` is a claim anyone can write, so it moves a cap only when the vault that granted the cap has adopted the new definition; a look-alike elsewhere inherits nothing. An actor narrowing its cap for one message is not a grant; every grant needs its vault's owners' approval for now (avenID caps, D14). A cap targets an address, an address with `below: true` (it and every actor it spawned), or every actor of a definition in a vault, and may go to a group of vaults. The inbox Doc from A to B comes into being when B grants A a tell cap, together with B's read cap. Where an actor lives decides who can read it: a keeper is blind for actors it does not host, and face actors never live on the Aven Peer. Decided as avenID caps D16, in `aven/DB2/id/caps` |
| **Compaction** | Old journal and inbox entries folded into snapshots, once we decide what may be forgotten |

## 12. Not in the engine

| Left out | Why |
| --- | --- |
| Capabilities, signatures, encryption | avenID's caps spec (`aven/DB2/id/caps`), designed in its own thread |
| Network and avenDB | Later (section 11); the Doc interface is the seam |
| Composites and skills | A composite is an actor whose turn tells other actors. No kernel concept, no members field, no merge law. "Skill" is a product word for such an actor |
| Studio, planner, `requires` / `produces` contracts, registry | Apps or actors that read definitions, later |
| The model, HTTP, files and the engine | Doors: built-in actors, each added when something needs it (section 7). The store is avenDB's, below the engine |
| A plain-language `explain`, learning | Later: actors built on `describe` and the journal. Self-healing adapters are lenses (section 6) |

## 13. The package

`aven/actor`, its own package, Rust only, with its own Cargo workspace, lockfile, Lean project and check. Lean and the
Rust tests run in avenSANDBOX's box, whose image already holds the Lean toolchain. The actor is
universal: it depends on no storage backend, so it does not live inside avenDB's workspace (`aven/DB2`). avenDB is one
backend behind the Doc interface (section 11), and the root workspace excludes `aven/actor` as it excludes `aven/DB2`:

```
aven/actor/
  README.md          the learnings
  ARCHITECTURE.md    this file
  spec/              the Lean model, Aven.Actor, and the vectors it exports
  core/              the kernel: Values, Docs, messages, router, scheduler, clock, the runtime host
  host/              the page's side: the worker that runs the kernel, and the applier
  components/        the component library: definitions with faces, after aven-brands
  app/todo/          the version 1 app: its definitions and parts
```

The runtimes are built in `aven/runtimes`, the one home of every runtime (Samuel, 30 Oct 2026): state, js and
face in `aven/runtimes/actor/{state,js,face}`, one crate each, built to WebAssembly and frozen by hash. This file still
says what they do: their parts, the turn's contract, determinism and fuel.

## 14. Version 1, step by step

Test-first, as avenDB works: the Lean model and its theorems, then Rust tests that replay its vectors, then the code.

1. **Lean** (`spec`, `Aven.Actor`): values, logs, messages, turns, asks, the journal. Theorems: messages from one actor to another are
   handled in order; every ask gets exactly one answer by its deadline; a message is handled once; a turn never waits;
   replaying a journal gives the same state; a machine refuses every illegal message; a face placed again is a new
   incarnation, whose messages are never taken for the old one's.
   Proven so far, for every trace and every schedule: `handled_in_order`, `replays`, `machine_sound`, `spawn_fresh`,
   `answers_at_most_once`, `ask_answered_or_waiting`, `ask_not_overdue`, `wellFormed_sound` (the admission check)
   and `phase_reachable` (a live actor is always in a reachable, declared phase). Also: `describe_exact` and
   `send_declared_tell`/`send_declared_ask` (types, `sends` and `describe`). It builds on `Aven.Core` (Values, the codec,
   hashes, type ids: one definition each). Its vectors, `spec/vectors/kernel.json` (`lake exe vectors`), are traces
   from the empty kernel and the kernel after them, over four test definitions the Rust tests implement natively.
   And `answered_by_deadline`: once the clock passes an ask's own deadline, it has its answer. `spec/vectors/traces.json`
   adds 40 generated traces, drawn from a fixed seed against the kernel so far.
   The runtimes' grammars too (Samuel, 30 Oct 2026), in their home, `aven/runtimes/spec`: state-runtime's
   statechart and updates are the runtimes thread's `Aven.Runtime.State` (#1550), with the laws that an update
   touches only its path (`get_set`, `get_set_other`, `get_remove`). `Aven.Runtime.Markup`: face-runtime's markup
   (`$`, `$$`, `$each` keyed, `$on`, `$use`, no conditionals) drawn onto the node tree, with `draw_nodes_ok` (every
   drawn node passes the applier's allowlist, for any markup and data), `draw_events` (a face can send only the
   events its markup names; `data-on` and `data-place` are the runtime's own) and `faceRun_ok`; vectors
   `markup.json`. `Aven.Actor.Runtimes` joins them to actors: `face_actor_checked` (a face actor's face passes the
   applier's check before it is drawn); `stateTurn`, a state part as a turn, whose sends become effects or refuse
   the turn; `stateTurn_phase` and `runTurn_state` (it moves only where its machine allows, and the kernel takes
   every answer, so `machine_sound` covers it); and `partMachine` with `fits_machine` (the machine a statechart
   draws, which it always fits). The kernel hands the current phase to every turn.
2. **Layers 0 to 2** (`core`): Values and names, the in-memory Doc, messages, with the vectors.
3. **Runtimes**: `state-runtime` first, then `js-runtime`; each with hostile parts that try to get
   out, run too long or blow up, which must fail.
4. **The kernel** (`core`): router, scheduler, turns, clock, spawning; native tests replay the vectors.
5. **Faces**: `face-runtime`, the applier, events as tells.
6. **The app**: the todo app in a page, the kernel in a worker.

What version 1 is not: no network, no avenDB, no capabilities, no encryption, no composites, no Studio, no planner.

## 15. Decisions

Decided (Samuel, 30 Oct 2026):

- Its own package, `aven/actor`, in Rust only, compiled to WebAssembly, with its own Cargo workspace: the actor is
  universal and depends on no storage backend, avenDB included (section 13).
- Actors are mostly JSON, with JavaScript where code is needed, run by on-demand runtimes such as QuickJS.
- The runtimes are rewritten from scratch and named `<job>-runtime` after what their part does (every part is JSON, so `json-runtime` named nothing; the declarative turn runs on `state-runtime`, code on `js-runtime`, and a face, its markup and its style, on
  one `face-runtime`, which never takes CSS and only gives it; "view" keeps the engine's sense). They run untrusted parts securely and never
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

- The caps seam (section 11), agreed with avenID's caps thread: actors hold no keys and the kernel holds them; a
  `cap` beside `run` that only narrows per hop, never mixed with an actor's standing cap; tell caps on message names;
  the inbox Doc A→B in A's vault; a definition names the one it `replaces` (Samuel, 30 Oct 2026; caps D16).

- Every address carries an incarnation; `seq` counts per pair of actors; only an ask gets a `fail`, and every refusal
  and error is journaled; a journal entry pins the definition, the runtime that ran and the fuel schedule (sections 4,
  6 and 7). From the first-principles audit (`aven/DB2/ARCHITECTURE.md`).

- Hosting an actor on the Aven Peer is an explicit read cap per actor, shown to its owner; a member's own Peer is the
  default home (avenDB A16). Modelled in `Aven.Actor.Hosting`: a host reads exactly what its valid hosting caps,
  shown to the actor's owner, cover (`hosting_explicit`), nothing without one (`no_hosting_without_cap`), and one
  load's cap reads only that load (`per_target`). Every runtime lives in `aven/runtimes` (section 13). (Samuel, 30 Oct 2026.)

- avenDB's A17, parts 1, 2 and 4 (Samuel, 30 Oct 2026): an address names a vault-scoped id and an incarnation, never
  a device, and the home is only where to route; a message is stored once and referenced by its hash; an actor's
  history is its Doc's own Loro history, each turn one commit of Loro operations, with Loro's snapshots as its
  checkpoints, and loads journaled as (Doc, version, query hash). Version 1 keeps the same shape in memory: an
  operation log and snapshots behind the Doc interface.
- avenDB's A17, part 3 (Samuel, 30 Oct 2026): every actor keeps its own inbox, its own queue, read position and order
  of handling. Between devices, messages are carried in one Doc per pair of vaults, written only by the sending
  vault's home device, holding the messages of all its actors, each addressed to one actor; within one home, none.
  The order from one actor to another stays the order sent (section 4). In version 1, in memory, the carrier is not
  modelled: each pair of actors is one inbox log.
- avenDB's A17, part 5 (Samuel, 30 Oct 2026): a definition is a version of an actor type; `replaces` names the
  version before it, and a lens carries the actor's state from the old version's shape into the new one's (K5).
- Machines are data, merged with the interface; no Prolog runtime; their checker proven in Lean, and deeper
  properties of a definition proven in Lean in the repository (section 6).
- Every actor answers a built-in `describe` ask with its tool specs; definitions declare `sends`, enforced by the
  kernel; edges between actors are derived by type id, never by name or prose (section 6; Samuel, 30 Oct 2026).
- Lenses, universally: one concept joining versions of one type and of different type Docs, kept a forest so paths
  stay unique; actors' messages cross types through them, and they replace Abject's negotiator and self-healing
  adapters (section 6; Samuel, 30 Oct 2026).
- Values are integers only in version 1, in avenDB's one codec (section 2): deterministic CBOR (Samuel, 30 Oct 2026).

Open, none of it blocking version 1 (the audit's findings, mostly avenDB's proposal A17, awaiting Samuel):

- **The kernel's authority:** a narrow device vault for the actor host; click caps scoped to what the placer wired;
  who may spawn, and a bound on placement depth; a budget per run, and backpressure.
- **Performance gates** for wasm inside wasm, fuel across engines, and a shadow root per face.
