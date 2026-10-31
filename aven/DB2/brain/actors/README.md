# avenACTORS

Behaviour: actors that keep their state in a Doc of their own and change it only by handling one message at a time,
in pure turns, under caps.

## Owns

- [An actor](#an-actor): a definition and a live instance with its own Doc.
- [Definitions as versions](#definitions-as-versions): a definition is a version of an actor type.
- [Addresses](#addresses): a vault-scoped id and an incarnation, never a device.
- [Messages](#messages): tell, ask, reply and fail; order per pair; stored once, by hash.
- [Inboxes and carrier Docs](#inboxes-and-carrier-docs): each actor's own inbox; one carrier Doc per pair of vaults.
- [Turns as commits](#turns-as-commits): a turn is one commit of the actor's Doc; its journal is the Doc's log.
- [Loads](#loads): what an actor reads without asking, handed into each turn and journaled as versions.
- [The actor kernel](#the-actor-kernel): router, scheduler, turns and clock; spawning, doors and asks.
- [Face actors](#face-actors): every placed component is an actor.
- [Hosting is an explicit read cap](#hosting-is-an-explicit-read-cap): a home reads only what its owner granted.
- [Actor hosts write only under their actors' chains](#actor-hosts-write-only-under-their-actors-chains): the
  kernel's half of A27: what it hands the actor host's device to sign, and the cap a message carries.
- [The model in Lean](#the-model-in-lean): `Aven.Actor`, its modules and its vectors.

## Uses

- [avenCORE](../core/README.md#values): Values and the one codec; [names](../core/README.md#names) and type ids;
  [envelopes](../core/README.md#envelopes) and [logs](../core/README.md#logs); ops, calls and
  [steps](../core/README.md#targets-and-steps).
- [avenDOCS](../docs/README.md#a-doc-and-its-genesis): Docs (an actor's Doc, a carrier Doc);
  [type Docs](../docs/README.md#types-schemas-and-fit) and pins (A7); [lenses](../docs/README.md#lenses);
  [checkpoints](../docs/README.md#checkpoints).
- [avenID](../id/README.md#devices): device keys and [vaults](../id/README.md#vaults); an actor host's device and its
  own vault.
- [avenCAPS](../caps/README.md#chains): caps, chains and attenuation links;
  [device caps and actor hosts](../caps/README.md#device-caps-and-actor-hosts), the reader's half of A27; letters and
  the letterbox ([where caps live](../caps/README.md#where-caps-live));
  [the reader's verdict](../caps/README.md#the-readers-verdict).
- [avenRUNTIME](../runtime/README.md#state-runtime): state-runtime and its steps, `js-runtime`,
  [face-runtime](../runtime/README.md#face-runtime), [the runtime host](../runtime/README.md#the-host),
  [pins](../runtime/README.md#pins) and [the drawer](../runtime/README.md#the-node-tree-and-the-drawer).
- [avenOPS](../ops/README.md#the-want-queue): wants (an actor's loads) and `changed`; the engine as a door.
- [avenPEERS](../peers/README.md#gossip-per-group): delivery of a carrier Doc's envelopes, live on its group's topic
  and by [sync between readers](../peers/README.md#sync-by-version-between-readers); finding an actor's home.
- [avenOS](../os/README.md#the-page-and-its-workers): the page that runs the kernel in a worker and draws faces.

## An actor

"Actor" here means a software actor: an addressable unit with an inbox. The people and animals of maiaCITY's worlds
are another thing with the same word.

An actor is a running **definition** with its own **Doc**, at an **address** that names no device. It holds state
and changes it only by handling one message at a time. Everything happens by a message: there is one verb, `tell`;
an ask is a tell with a reply address and a deadline; a reply or a fail is a tell to that address. Authority is a cap
([avenCAPS](../caps/README.md)). The truth is the **journal**, the ordered record of messages and turns; everything
else is a cache or a view of it.

What other systems call a skill, an agent, a workflow, a composite, a service or a tool actor is an actor, its role a
convention in its definition. A composite is an actor whose turn tells other actors: there is no members field and no
merge law. A tool is a message in an actor's interface that the caller's caps allow. A planner is a pure function
whose plan is data. Effects in the world (the engine, files, the model, HTTP) are
[doors](#the-actor-kernel).

**One actor, one record.** An actor's Doc holds its definition's name, its state and every turn it took. Nothing reads
or writes another actor's Doc: actors interact only by messages. Actors are mostly JSON; `js-runtime` is for turns
that need code.

**The package.** `aven/actor` is its own package, Rust only, with its own Cargo workspace, lockfile, Lean project and
check. It depends on no storage backend: avenDB is one backend behind the Doc interface.

**Decided:** A17, K9; actors §15 · **Lean:** `Aven.Actor.Basic` (addresses, messages, definitions, journal entries)

## Definitions as versions

A **definition** is a Value, named by its hash: the class. It is a version of an **actor type**, a type Doc
([avenDOCS](../docs/README.md)); `replaces` names the version before it, and a lens carries an actor's state from the
old version's shape into the new one's. Who may publish a version is whoever may write the type Doc.

| Field | Meaning |
|---|---|
| `interface` | The messages it accepts: each a `name`, a `description` and its payload's type by id; an ask also names its reply's type. Its second part is the machine |
| `sends` | The messages its turns may send, by type id. The router refuses an effect whose type the sender didn't declare; `describe` needs no declaring |
| `machine` | Optional: a table of phases, per phase the messages allowed and the phases each may lead to |
| `turn` | Required: `{runtime, v, part}` on `state-runtime` or `js-runtime` |
| `faces` | Optional: named faces, each `{present, markup, style, a11y}`: `present` a part on state- or js-runtime that gives the face data, `markup` and `style` the parts face-runtime draws |
| `init` | The first state |
| `lifetime` | `durable` (the default: it lasts until retired, and persists) or `mounted` (it lives while the face that placed it shows it) |
| `replaces` | Optional: the definition this one upgrades |
| `loads` | What it reads without asking ([Loads](#loads)) |

A definition's code and faces are **parts**: Values in a format, for the runtime of that format
([avenRUNTIME](../runtime/README.md)).

**Types, not words.** A payload is typed by a **type id**, `<type Doc>/<schema hash>`. A message's `name` is a label
in one interface and its `description` prose for people and models; neither is ever matched. A message whose type
differs from the one the receiver accepts is delivered when a path of [lenses](../docs/README.md#lenses) joins them
among those the receiving vault has pinned: the router reads the payload through the path, and a reply comes back
through it. The journal entry pins the lenses used, by hash. With no path, the message is refused. **Edges** between
actors are derived, never stored: from A to B wherever a type in A's `sends` is one B's interface accepts, or one
joined to it by lenses pinned in B's vault. The drawn graph, a planner's input and what the kernel allows are one
rule.

**A machine is data:** `{"initial": phase, "phases": {phase: {message: [phase, …]}}}`. A message reaches the turn
only if the current phase allows it, and the turn's new phase must be one it lists. A definition is admitted only when
its machine is well formed: every phase named is declared, the initial phase exists, every message is in the
interface, every phase is reachable. The checker is proven once, so it can admit definitions made by people or models
with no Lean at run time; deeper questions about one definition ("can it get stuck?") are Lean proofs in the
repository, before it is frozen.

**`describe`.** Every actor answers a built-in ask, `describe`, which the kernel answers for it from its definition,
its current phase and the asker's caps: what it is, and every message the asker may send it now, each with its name,
description, payload type and schema, and its reply's type. These are its tool specs, so a model's tool list is a
projection of `describe`, never configured apart.

**Decided:** A7, A17, K5; actors §15 · **Lean:** `Aven.Actor.Machines` — `wellFormed_sound`, `phase_reachable`;
`Aven.Actor.Describe` — `describe_exact`, `send_declared_tell`, `send_declared_ask`

## Addresses

An address is `<scope>/<id>/<n>`:
- **the scope** is the actor's vault: an address names a vault-scoped id, never a device. The actor's **home**, the
  peer it lives on, only routes; a member's own Peer is the default home;
- **the id** is the hash of its definition's name, its spawner's address and the spawner's count, so a replay names
  the same actors; a face actor's id is the hash of its placer's address and its place (and, in `each`, the item's
  key);
- **`n` is the incarnation:** how often the id had been spawned. An id spawned again, such as a face placed again
  after it was unplaced, is a new actor with a new Doc, whose messages count from 1 again without being taken for the
  old one's. The old Doc is kept, closed.

Moving an actor's home is a handover: the new home continues the actor's logs from the old one's last entry, and the
old one writes no more.

**Decided:** A17; actors §15 · **Lean:** `Aven.Actor.Theorems` — `spawn_fresh`

## Messages

| Kind | Meaning |
|---|---|
| `tell` | Do or know this. No answer is expected |
| `ask` | Answer this by a deadline: exactly one `reply` or `fail` comes back. 30 s unless the asker says otherwise, at most 10 minutes |
| `reply` | The answer to an ask |
| `fail` | The ask couldn't be answered: `timeout`, `refused` (no such actor, illegal now, a payload that fails its schema) or `error` (the turn threw or ran out of fuel). Only an ask gets a `fail`; a refused or failed tell is journaled, and its sender isn't told |

| Field | Meaning |
|---|---|
| `kind` | One of the four |
| `from`, `to` | Addresses |
| `seq` | Its number from `from` to `to`, counted per pair of actors from 1 with no gaps, so a receiver sees a missing one; `(from, to, seq)` names the message |
| `name` | Its name in the receiver's interface |
| `payload` | A Value, checked against the interface's type for `name` |
| `re` | For `reply` and `fail`: the ask it answers, by its `(from, to, seq)` |
| `deadline` | For `ask` |
| `run` | The causal chain: every message a turn sends carries the run of the message it handled |
| `cap` | The chain it acts under ([below](#actor-hosts-write-only-under-their-actors-chains)) |

**Stored once, by hash.** A message is stored once and named by its hash everywhere else (rule 2).

**Order is per pair of actors.** Messages from A to B are handled in the order A sent them. The receiver handles
entry `n + 1` only after entry `n`, and a gap waits until sync fills it, so the order holds for every schedule. What is
not promised:
- **no causal order across pairs:** if A tells B `x`, then tells C, and C tells B `y`, B may handle `y` first; a
  message that must come after another says so in its payload, and the turn waits for it in its state;
- **offline means later, not lost:** a message waits in its inbox, and a turn never waits for it; an ask to an actor
  that is away fails with `timeout` at its deadline, and an answer after that is dropped;
- **a gap holds up the pair behind it,** until sync or a keeper brings it.

**Ask or tell.** An ask is a call: a one-off read, or a write that can be refused (no cap, a schema, a conflict),
since its sender needs the outcome. A tell is a notice: an event, or a person's decision that comes when it comes.

**Decided:** A17; rule 2; actors §15 · **Lean:** `Aven.Actor.Theorems` — `handled_in_order`; `Aven.Actor.Deadlines`
— `seq_unique`

## Inboxes and carrier Docs

**Every actor keeps its own inbox:** its queue, its read position and its order of handling. Within one home there is
no carrier.

**Between vaults, one carrier Doc per pair of vaults.** An actor's message to an actor of another vault is an
envelope in the **carrier Doc** of the two vaults, holding the messages of all their actors, each addressed to one
actor:
- it belongs to the vault that opened contact; the other vault holds `read` and `tell` on it
  ([avenCAPS](../caps/README.md));
- it is born with the first letter through the letterbox; letters only start it, and after that the pair talks in the
  carrier Doc, never by letters;
- each vault's messages are written by its home device; from one actor to another they stay in the order sent;
- its readers are its group, so it is delivered as any Doc's envelopes are: live on its group's topic, caught up by
  reconciliation ([avenPEERS](../peers/README.md)); a direct connection is only a faster path for the same sync, and
  a keeper holds it while a home is away. There is no bus in the middle.

**The receipt is the receiver's turn.** The turn that handles a message names it by hash, which is the sender's
receipt; there is no delivery `ack` frame. A receiver drops a message it already handled, by its `seq`.

**Decided:** A17, A33, A42, K11; caps D16 · **Lean:** not in Lean yet (version 1 models one inbox log per pair of
actors, in memory)

## Turns as commits

```
turn(state, message, given) → { state', effects: [tell | ask | reply …], phase'? }
```

`given` holds the turn's time and random seed, and the `now` tier of its [loads](#loads). A turn is pure:
deterministic, with no I/O; everything it does goes out as effects. It never waits: an answer or a timeout arrives as
a later message.

**An actor's history is its Doc's log.** A turn is one commit: one envelope on the actor's Doc, in its log
([avenCORE](../core/README.md#logs)). Its writes are steps (put, patch, remove, edit at a path), never a whole new
state: state-runtime answers with them ([avenRUNTIME](../runtime/README.md#state-runtime)), and they are the footprint
caps check. What travels of an actor's state is a checkpoint of its Doc
([avenDOCS](../docs/README.md#checkpoints)).

**A journal entry** holds:
- the message it handled, by hash;
- the definition in force;
- the hash of the runtime that ran (the one the part names, pinned) and the interpreter's version, which fixes the
  fuel schedule;
- `given`, its loads as versions ([Loads](#loads));
- the state's hashes before and after; the effects; the fuel used;
- the **outcome:** `done`; `described` (a `describe` the kernel answered, which is no turn); `refused` with its
  reason; or `error` with its reason. A refused or failed message is journaled too, and leaves the state as it was.

**Commit, then send.** A turn's state and journal entry commit together, in one write to the actor's Doc. Its effects
are recorded in that entry and sent from it; a send lost in a crash is sent again from the journal, and the receiver
drops it if it already has it.

**The journal is the truth.** Replaying it on the runtimes it pins gives the same state, anywhere.

**Decided:** A17, A37, K9; rule 2; actors §15 · **Lean:** `Aven.Actor.Theorems` — `replays`, `machine_sound`;
`Aven.Actor.Runtimes` — `stateTurn_phase`, `runTurn_state`, `fits_machine`

## Loads

A standing read is not a message. An actor's definition names its **loads**: its wants, in tiers
([avenOPS](../ops/README.md#the-want-queue)), which the engine keeps current where the actor lives. Each turn is
handed the `now` tier of them in `given`, so an actor never fetches. What it is handed is its loads ∩ its run's caps:
a load grants nothing.

- **Journaled as versions:** a turn's journal entry records its loads as (Doc, version, query hash), never as data,
  so a replay reads the same versions and nothing loaded is copied into the journal.
- **Changes arrive as a tell:** when a loaded Doc moves, the engine tells the actor `changed`, and its next turn sees
  the new data.
- **An entry may name a query:** installing the actor registers in its vault the sealed index that query needs, by
  the vault owners' act (A26).

**Decided:** A9, A17, A26, K4, K9 · **Lean:** not in Lean yet (version 1 has no loads)

## The actor kernel

The **actor kernel** is the trusted part that runs actors: pure Rust with no I/O, compiled to WebAssembly for the
browser and natively for tests. It is not avenCORE. The page feeds it time and events and takes back what it draws.

- **Router.** Appends a message to its receiver's inbox. A message to an actor that isn't live is refused and never
  appended: the sending turn's journal entry records the effect as `refused`, and an ask gets `fail(refused)`, whose
  `re` names seq 0, which no sent message has.
- **Scheduler.** Picks an actor with unread messages and runs one turn. One actor never runs two turns at once;
  different actors may run in parallel; across senders, the oldest arrival goes first.
- **Turns.** The machine allows the message now and the payload fits its type, or it is journaled as refused. The
  runtime runs with fuel in the runtime host; an output that fails its schema, a phase the machine doesn't allow, a
  throw or running out of fuel is journaled as an error, the state unchanged.
- **Clock.** The only source of time: each turn's `given.now`, `tick` and `at` messages, and the fail of an ask
  whose deadline passed.
- **Spawning** is an ask to the kernel, which is an actor too: `spawn {def, init}` replies with the new address.
  **Retiring** is a tell: `retire {address}`. In version 1, only definitions from the repository are spawned. The
  kernel has no other operation: everything is a message or the clock.

**Doors.** An actor's own data is its state. Every other Doc is reached by a message to a **door**: a built-in actor
that does I/O for the others, such as the engine ([avenOPS](../ops/README.md)), files, and later the model and HTTP.
A door runs outside the pure kernel, and its answers arrive as messages, journaled by their receivers, so a replay
never runs a door again. It takes one message as one atomic operation, acts only with the cap the message carries,
never its own, and handles one sender's messages in order, so an actor reads its own writes. A timeout doesn't mean
"not done": a door's answer to a later read is the truth. The store is not a door: it sits below the engine.

**Asks never block.** An answer reaches the asker as a message named `reply` or `fail`, so a machine can wait for it.
An actor can answer only an ask sent to it and still waiting; any other reply is dropped, so answers can't be forged or
sent twice. Every ask is answered once, by its deadline. **Approvals are tells:** a turn that needs a person's
decision tells the person actor, and the decision comes back as a tell, in minutes or days.

**Laws are code.** The kernel checks them; never prompts, and never a reading of a part's source.

**Decided:** actors §15 · **Lean:** `Aven.Actor.Kernel` — `Kernel.step`, `Def.admit`; `Aven.Actor.Asks` —
`answers_at_most_once`, `ask_answered_or_waiting`, `ask_not_overdue`; `Aven.Actor.Deadlines` — `answered_by_deadline`

## Face actors

**A component is a definition whose main part is its face** (`faces.main`), and every placed component is a **face
actor**: an address, a state and an inbox like every actor, with a `mounted` lifetime. A badge with nothing to
remember is a face actor whose state is empty; a menu that opens or a field being typed into keeps that in its state.
There is one primitive.

A component's definition adds `props` (what its placer passes in, and a `props` tell whenever they change), `events`
(which of its `sends` go where its placer wires them, along a derived edge), `slots` (the faces of other actors its
placer passes; a leaf has none), and a `name` and `description`.

- **Placing is spawning.** `use` in a face's markup places a component: the first draw spawns a face actor at an
  address derived from its placer and its place, a later draw with new props sends it a `props` tell, and a draw
  without it retires it, ending that incarnation. `use` with an actor instead shows an existing actor's face, spawning
  nothing.
- **A click is a message.** An event on a node with `data-on` becomes a `tell` from the device's **person actor** to
  the face actor that owns the node, through the router into its inbox. Hover, focus and the other states that change
  only how something looks are CSS, not messages.
- **A face never reaches the page.** face-runtime computes the tree and its style; only the drawer
  ([avenRUNTIME](../runtime/README.md)) writes the DOM, into each face's own shadow root.
- **The rules of faces:** an unknown prop, slot or variant is an error; a face sees only its own state and props;
  variants are axes (meaning, shape, size); anything true only for a moment is one of eight states (default, hover,
  focus, active, disabled, loading, error, selected), and an interactive component declares hover, focus, active and
  disabled; a brand is data, never CSS text.

**Decided:** actors §15 · **Lean:** `Aven.Actor.Runtimes` — `face_actor_checked`

## Hosting is an explicit read cap

An actor lives on one peer, its home; a member's own Peer is the default. A peer that hosts an actor for someone
else, the Aven Peer included, reads nothing by hosting it. It reads only what its **hosting caps** grant, and each is
shown to the actor's owner.

A hosting cap is one of [avenCAPS](../caps/README.md)' caps, not a sort of its own: its issuer is the actor's owner,
its holder the hosting peer's vault, and every line of its grant is `core/1`'s `read`, on the actor's own Doc or on
one of its loads. One load's cap reads only that load. Face actors never live on the Aven Peer, and a keeper is blind
for the actors it doesn't host.

**Decided:** A16; rule 7 · **Lean:** `Aven.Actor.Hosting` — `hosting_explicit`, `no_hosting_without_cap`,
`per_target`, `invalid_cap_reads_nothing`

## Actor hosts write only under their actors' chains

Actors hold no keys. Every write an actor makes is signed by its actor host's one device, whose device cap is the
union of its hosted actors' standing caps: only the outer bound. The actor host's device vault, its device cap, the
Aven Peer's chain, the attenuation link and what a reader checks are avenCAPS'
([device caps and actor hosts](../caps/README.md#device-caps-and-actor-hosts), [chains](../caps/README.md#chains)).
This is the kernel's half: what it hands the device to sign, and the cap a message carries.

**A write.** For each write, the kernel hands the actor host's device a write that:
- **names the acting actor;**
- **carries the chain its handled message carried, as it came.** An actor's narrowing for one write is never appended
  as a link, which would need its owners' approval (D14): it is the write's own calls, which the reader checks against
  the chain;
- **never claims the vault's own authority,** so "the signer's vault owns the Doc" never lets a kernel write past an
  actor's grant.

So when a reader accepts that chain, nothing in it reaches a Doc or allows a call beyond the chain's root, the
authority the caller started with: an actor writes nothing its caller couldn't, and the device cap never widens it.

**A message.** A cap that travels on in a message narrows by an attenuation link. The chain a message carries is its
handled message's chain plus at most one attenuation, and the kernel makes an attenuation only when the narrowed
grant lies within both the handled message's own cap and its parent in the chain; otherwise the message goes without
one. When a reader accepts the chain, nothing in it, the attenuation included, reaches beyond the root.

**Who checks what.** The reader checks the owner-approved bound: every grant approved, every attenuation within its
parent (avenCAPS). The kernel holds each message's narrowing within the handled message's own cap, which a reader
can't check after a standing delegation to another vault, since there the attenuation's parent in the chain is the
delegation. A message to an actor on another vault's actor host carries its chain only as provenance (avenCAPS).

**Decided:** A27, A28; caps D14, D16 · **Lean:** `Aven.Actor.Signing` — `signs_by_chain`, `write_names_actor`,
`write_keeps_chain`, `actor_within_chain`, `actor_calls_within`; `Aven.Actor.Messaging` —
`attenuation_within_message`, `message_within_root`

## The model in Lean

`Aven.Actor`, in `aven/actor/spec`: Lean 4.35.0, no `sorry`. It requires `Aven.Core` (Values, the codec, hashes,
type ids), avenRUNTIME's `Aven.Runtime` (the contract, the allowlist, state-runtime and face-runtime) and avenCAPS'
`Aven.ID` (caps) by path, and defines none of them again: actors build on runtimes and caps, never the reverse. Its
theorems hold for every trace and every schedule.

| Module | What it states |
|---|---|
| `Basic` | Addresses, messages, effects, `given`, machines, definitions, journal entries |
| `Kernel` | The kernel as a function of events: send, handle, tick, spawn, retire; admission (`Def.admit`) |
| `Theorems` | Order per pair, replay, machines, fresh spawns |
| `Asks`, `Deadlines` | Every ask answered once, by its deadline; a seq names one message |
| `Machines` | The admission checker, and every live actor in a reachable, declared phase |
| `Describe` | `describe`, and effects only of declared types |
| `Runtimes` | state-runtime's step as a turn, and face-runtime's answer as a face actor's |
| `Hosting` | A16's hosting caps |
| `Signing`, `Messaging` | A27's kernel half: writes by chain, messages by attenuation |

**Vectors** (`lake exe vectors`, in `spec/vectors/`): `kernel.json`, traces from the empty kernel and the kernel after
them over four test definitions the Rust tests implement natively; `traces.json`, 40 traces generated from a fixed
seed.

**Decided:** actors §15 · **Lean:** `Aven.Actor`

## Status

| Piece | Lean | Rust | TS/JS | State |
|---|---|---|---|---|
| Kernel, messages, asks, machines, `describe` | `Aven.Actor` (#1504, #1544) | — | — | Lean only; vectors `kernel.json`, `traces.json` |
| Hosting (A16) | `Hosting` (#1565) | — | — | Lean only |
| Actor hosts and chains (A27, kernel half) | `Signing` (#1617, #1623, #1681), `Messaging` (#1628) | — | — | Lean only; the reader's half is avenCAPS' (#1619, #1624, #1626) |
| Turns as steps (A37) | `Runtimes`, with state-runtime's `State` (#1676) | — | — | Lean only |
| Carrier Doc (A33) | — | — | — | written down (#1685); for milestone 3 |
| Version 1: the todo app in memory | — | — | — | not started; actor code waits for its go |

**Version 1** is a standalone todo app on one device, in memory: no network, no avenDB, no caps, no encryption, no
composites. Its actors are `person`, `kernel` and `clock` (built in), `list` (state-runtime), `task` (js-runtime, with
an open/done machine) and the components `field` and `checkbox`. The order: layers 0 to 2 in `core` (Values, the
in-memory Doc, messages) with the vectors; then `state-runtime`, then `js-runtime`, each with hostile parts that must
fail; the kernel; faces (face-runtime, the drawer, events as tells); the app, its kernel in a worker. Version 1 refuses
every Value that sets a field kept for later (a message's `cap`, the `now` tier, `loads`, a Doc's `schema` and
`branch`, the address's vault scope), so nothing depends on it missing; its scope is `local`.

**Known gaps (code and Lean):**
- The carrier Doc, receipts by hash and the journal as an avenDB Doc's log aren't modelled: the Lean's inboxes are one
  log per pair of actors, and its journal entries hold the message whole.
- Performance gates for WebAssembly inside WebAssembly, fuel across engines and a shadow root per face are not
  measured.
- `no_confused_deputy`, which `ARCHITECTURE.md`'s stress test cites (row 22), is not in Lean on main; the kernel's half
  of it is `actor_within_chain` and `actor_calls_within`.

## Open questions

- **How an address names its vault:** a vault is named by 32 bytes (L15); how an address and a cap's target encode
  it. avenACTORS decides, with avenID.
- **The kernel's own authority:** click caps scoped to what the placer wired; who may spawn, and a bound on placement
  depth; a budget per run, and backpressure. Samuel decides, on avenACTORS' proposal.
- **Compaction:** which journal and carrier entries may be folded into checkpoints, and whether a mounted face
  actor's journal is kept after it is unplaced. Samuel decides.
- **Moving an actor's home:** the handover's protocol. avenACTORS decides, with avenPEERS.
- **The word "kernel":** the actor kernel keeps it, or takes another name so it never meets avenCORE's. The architect
  decides.
