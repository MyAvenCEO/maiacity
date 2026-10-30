# Actor architecture

The single source of truth for the next actor implementation. The learnings and reasons behind each choice are in
[`README.md`](README.md). Where the two disagree, this file wins.

Two concerns are deliberately left to their own packages and threads: **capabilities and encryption**
([`../ID/caps/README.md`](../ID/caps/README.md)) and **persistence and sync** in avenDB
([`../DB2/db/engine/README.md`](../DB2/db/engine/README.md)). This design leaves a seam for each and builds neither.

1. [The model in one picture](#1-the-model-in-one-picture)
2. [Words](#2-words)
3. [Laws](#3-laws)
4. [One peer](#4-one-peer)
5. [Between peers: no bus in the middle](#5-between-peers-no-bus-in-the-middle)
6. [A turn](#6-a-turn)
7. [Asking](#7-asking)
8. [A click](#8-a-click)
9. [Formats](#9-formats)
10. [Machines (Prolog facts)](#10-machines-prolog-facts)
11. [Runtimes](#11-runtimes)
12. [Persistence, later](#12-persistence-later)
13. [Not in the kernel](#13-not-in-the-kernel)
14. [Version 1](#14-version-1)
15. [Decisions](#15-decisions)

## 1. The model in one picture

```
  Definition (named by hash)                                       Actor (on this peer or another)
    interface: the messages it takes                                 ▲
    machine:   which are legal when (optional)                       │ tell / ask / reply / fail
    parts:     its turn, its faces ──▶ runtimes                      │
        │                                                            │
        └── spawn ──▶ Actor ─────────────────────────────────────────┘
                       address, state, mailbox
                         │
                         └──▶ one turn at a time ──▶ Journal (the truth; state is a cache of it)
```

There are actors and messages. An actor handles one message at a time, in a turn that is a pure function. Everything
an actor does, it does by returning messages for the kernel to send. Everything that happened is in the journal.

## 2. Words

| Word | Meaning |
| --- | --- |
| **Definition** | What an actor is: its interface, an optional machine and its parts. Immutable, named by its BLAKE3 hash; a new version is a new hash |
| **Actor** | A live instance of a definition: an address, a state and a mailbox. It lives on exactly one peer |
| **Message** | The only way anything happens. Four kinds: `tell`; `ask` (a tell that expects one answer by a deadline); `reply` and `fail` (the answer) |
| **Mailbox** | An actor's queue of messages, handled one at a time in arrival order |
| **Turn** | Handling one message: `turn(state, message, given) → { state', effects }`, pure and deterministic |
| **Effect** | A message the turn returns for the kernel to send |
| **Journal** | The ordered record of an actor's turns: each message, the state hash before and after, and the effects |
| **Part** | Content in one format for one runtime: the turn's code, a face, a doc |
| **Runtime** | A frozen, sandboxed engine of one kind that runs parts without trusting them |
| **Face** | A part that shows an actor's state to a person and emits events by name |
| **Peer** | A device, a Peer-Light in a browser, or the Aven Peer. Each runs the kernel |
| **Kernel** | Per peer: the router, the mailboxes, the deciding runtimes, the journals and the link. The only trusted code. Rust only: one crate, built into the native Peer and the Peer-Light |

That is the whole vocabulary of version 1. Section 13 lists what is deliberately not in it.

## 3. Laws

1. **Only messages.** Actors interact only by messages. Nothing reads or writes another actor's state.
2. **One door.** Every message, whether from a person, a click, another actor, another peer or the clock, goes
   through the router into a mailbox. Nothing calls a turn directly.
3. **One at a time.** An actor handles one message at a time, in arrival order. Different actors run in parallel.
4. **No waiting.** A turn never waits. An answer or a timeout arrives as a later message, so nothing deadlocks and
   nothing needs a lock.
5. **Pure turns.** A turn is deterministic and does no I/O. Time, randomness and data come in as `given`; everything
   it wants done goes out as effects.
6. **Every ask is answered once.** By its deadline the asker receives exactly one `reply` or one `fail`.
7. **The journal is the truth.** Replaying an actor's journal on the same runtime gives the same state, on any peer.
8. **No bus in the middle.** Each peer routes its own messages; a message for an actor on another peer goes straight
   to that peer.
9. **Code is content; runtimes run it.** A part runs only on a frozen runtime of its kind. Sandboxing is the
   runtime's job. Runtimes come only from the repository.
10. **Laws are code.** What may happen is checked by the kernel, never by prompts and never by reading a part's source.

## 4. One peer

```
┌──────────────────────────── one peer: a device, a Peer-Light or the Aven Peer ────────────────────────────┐
│                                                                                                            │
│   Face (showing runtime, in a frame) ── event by name ──▶ the person's actor ── tell ──┐                   │
│                                                                                        ▼                   │
│                                           ┌──────────┐ ──▶ Mailbox A ──▶ turn ──▶ Journal A ──┐           │
│   Link ◀──── other peers' links ─────────▶│  Router  │ ──▶ Mailbox B ──▶ turn ──▶ Journal B ──┤           │
│   (frames on aven/db/1, over iroh)        └──────────┘ ◀──────── effects ◀────────────────────┘           │
│                                                ▲                                                           │
│                                              Clock: time and deadlines arrive as messages                  │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Rust only.** The kernel is one Rust crate with a pure core and no I/O (avenDB rule 2), built into the native
  Peer and, as WebAssembly, into the Peer-Light. The page keeps only what draws: faces on showing runtimes, which
  talk to the kernel by messages.
- **Router.** Delivers a message to a local mailbox, or hands it to the link for the actor's peer. It refuses a
  message for an unknown actor, or one the actor's machine does not allow now, with a `fail` to the sender. Later it
  is also where capabilities are checked.
- **Mailboxes.** One per actor. The scheduler takes the next message of any actor that is not mid-turn.
- **Runtimes.** The turn runs on a deciding runtime (section 11).
- **Journal.** Each turn is committed whole (message, state hash before and after, effects) before its effects are
  sent. In version 1 it is kept in memory.
- **Clock.** The only source of time. It delivers `tick` and `at` messages, gives each turn its `given.now`, and turns
  an ask whose deadline passed into a `fail`.

## 5. Between peers: no bus in the middle

```
  Alice's Mac (Peer)                          Bob's browser (Peer-Light)                 Aven Peer (server)
  ┌──────────────┐    direct QUIC, hole-punched     ┌──────────────┐                     ┌──────────────┐
  │ Router       │◀────────────────────────────────▶│ Router       │                     │ Router       │
  │  its actors  │                                  │  its actors  │                     │  its actors  │
  └──────┬───────┘                                  └──────┬───────┘                     └──────┬───────┘
         │                                                 │                                    │
         └─────────── through our relay where there is no direct path (a browser always) ───────┘
                                       the relay forwards bytes; it routes no messages
```

avenOS's `MessageBus` was one object every message passed through. Between peers that would be a server everyone
depends on. Here there is none:

- **Each actor lives on one peer, its home.** Its address names it: `<peer>/<actor>`, where `<peer>` is the home
  peer's iroh `EndpointId`.
- **Each peer routes its own messages.** A message for a local actor goes to its mailbox; one for another peer goes
  over that peer's link.
- **Links are frames on `aven/db/1`.** avenDB has one protocol of its own behind one ALPN (`aven/DB2/README.md`,
  rule 9), so messages are two new frames on it, `message` and `ack`, not a second protocol. A link is one iroh
  connection between two peers. It is direct when iroh can punch through, and goes through our relay otherwise; a
  browser always uses the relay. The door that admits members to the relay and to every peer's hook already decides
  who may connect.
- **In order, once.** Messages from one actor to another arrive in the order sent: one stream per direction keeps
  that. The receiving peer acks a message once it is in the mailbox (later: in the journal). The sender keeps unacked
  messages and sends them again after a reconnect, and the receiver drops any it has seen by `(from, seq)`. Delivery
  is at least once, handling exactly once.
- **Not gossip.** Gossip is broadcast, best effort, and its topics tell every member who listens. It stays what it is
  in avenDB today: presence and the members' room. Messages go point to point.
- **When the other peer is away.** In version 1 a tell waits in the sender's outbox until the link is back, and an ask
  fails at its deadline. Later, an actor's inbox becomes an avenDB log that a keeper such as the Aven Peer holds for
  it, delivered by sync (section 12).
- **The Aven Peer is a peer.** It hosts its own actors and, later, keeps inboxes. It is not a bus.

## 6. A turn

```
 message ──▶ Router: known actor?  allowed by its machine now? ── no ──▶ fail(refused) to the sender
                │ yes
                ▼
             Mailbox ──▶ runtime: turn(state, message, given) ──▶ { state', effects }
                              │ throws, or runs out of work                │
                              ▼                                            ▼
                     fail(error) to the sender,              Journal: commit message, state hashes, effects
                     nothing committed                                     │
                                                                           ▼
                                                                 Router sends the effects
```

- `given` holds `now` and a random seed for this turn, both recorded in the journal, so a replay sees the same.
- The turn's work is counted in ticks, never in time, so every peer agrees where it stops.
- A turn that throws or runs out of work commits nothing. The message gets a `fail` if it was an ask; a tell that
  fails is recorded as failed.

## 7. Asking

```
 A                               Router and Clock                              B
 │ ask(B, "quote", p, 10 s) ────────▶│ ──────────────────────────────────────▶│
 │ machine: waiting                  │ deadline set                           │ turn
 │                                   │◀─────────────── reply(re = the ask) ───│
 │◀────────────── reply ─────────────│
 │ machine: back to where it was
                    or, with no reply by the deadline:
 │◀───────────── fail(timeout) ──────│        a reply after that is dropped
```

The asker's machine names the state it waits in. It may handle other messages meanwhile, as its machine allows.
Because nothing waits, two actors asking each other cannot deadlock.

## 8. A click

```
 Face ── event "toggle" {id} ──▶ host ── tell, from the person ──▶ Router ──▶ Mailbox(todo) ──▶ turn ──▶ Journal
  ▲        shown as pending at once                                                                       │
  └───────────────────────────── the new state, pushed to the face ◀────────────────────────────────────┘
```

A click is never a call. The face emits an event by name. The host turns it into a `tell` from the person's actor,
and it takes the same door as every other message. The face may show the change as pending at once, as avenDB-old
painted pending writes, and drops it without a trace if the turn refuses it. The actor usually lives on the same
device, so the round trip is one turn.

## 9. Formats

**A message**

| Field | Meaning |
| --- | --- |
| `kind` | `tell`, `ask`, `reply` or `fail` |
| `from`, `to` | Addresses, `<peer>/<actor>` |
| `seq` | The sender's count, per receiver: order and duplicates |
| `name` | The message's name in the receiver's interface |
| `payload` | Plain JSON, checked against the interface's schema for `name` |
| `re` | For `reply` and `fail`: the ask it answers |
| `deadline` | For `ask`: when it fails if unanswered |
| `run` | The causal chain it belongs to, carried into every message a turn sends |

Later, from the caps package: who signed it, and the proof that they may.

**A definition**

| Field | Meaning |
| --- | --- |
| `interface` | The messages it takes, each with a JSON schema for its payload; an ask also names its reply's schema |
| `machine` | Optional: Prolog facts saying which messages are legal in which state (section 10) |
| `parts` | `turn` (required): `{ runtime, v, code }`; `faces` (optional): parts for showing runtimes |
| `init` | The first state, or the turn's `init` |
| `loads` | Later, with avenDB's engine: what it needs, in tiers, kept current by sync and handed in as `given` |

## 10. Machines (Prolog facts)

A machine is a short list of facts, in the fact-only Prolog that avenOS's `libs/aven-actors/src/machine.ts` reads: no
rules, no lists, ground facts only. maiaCITY has no reader yet; it is small enough to write anew, with a real term
parser instead of splitting on commas (README, weak spot 12).

```prolog
state(open).  state(doing).  state(done).
initial(open).

% transition(Message, From, To)
transition(start,  open,  doing).
transition(finish, doing, done).
transition(reopen, done,  open).
```

A query with variables finds every fact that matches. `transition(M, open, To)` answers `M = start, To = doing`. A
constant must match exactly, so `transition(finish, open, To)` finds nothing.

The kernel uses this for one thing. The actor's state carries its machine state as `phase`. A message `M` reaches the
turn only if some `transition(M, phase, To)` exists, and the turn's new `phase` must be that `To`. Anything else is
refused before or after the turn. So the drawing of the machine and the behaviour cannot drift apart.

## 11. Runtimes

An actor's behaviour and its faces are parts, and parts mean nothing until a runtime runs them. A runtime runs any
part, written by anyone (a person, a model, a peer), without trusting it. Sandboxing is the runtime's job. Runtimes
come only from the repository: reviewed, frozen, named by hash, served by our hosts and checked against their hash
before they start. A part never brings its own runtime, and no actor or model can change one.

| Class | What it gives back | It must be | Kinds |
| --- | --- | --- | --- |
| **Deciding** | State and effects (and later, artifacts) | Deterministic: work counted in ticks, a seeded random, a frozen clock | Hosted by the Rust kernel, the same in the Peer and the Peer-Light (which engine: section 15, question 2); later `lean` |
| **Showing** | What a person sees, and events by name | Contained: it shows and emits, nothing more | `view`, `vibe`, `markdown`, `math`, the frozen libraries (three, d3, MCP Apps) |

Only deciding runtimes produce what a journal keeps. A showing runtime's events become messages through the one door.

Every runtime kind declares: its kind, version, hash and the commit it is kept at; its floor (the oldest version a
part may still run on, raised when a version closes a hole); its input schema; its output schema and the host's
checker for it; its limits in work, memory and size; whether it is deterministic; its walls; and the hostile probes
it passes in every browser engine we ship. A part names the runtime it was made for, `{ runtime: 'logic', v: 2 }`,
and runs on that version or on the floor.

Deciding runtimes run inside the Rust kernel, with no doors, so the native Peer and the Peer-Light run the very same
engine and a journal replays the same on both. Showing runtimes run in the page as `aven/kernel/sandbox` runs them: a
worker in a frame with no origin, a second lock on the worker, never on the page's thread. A general-purpose process such as
Bun or Node never runs untrusted code; untrusted native code would need a wall at the operating-system level, as a
runtime kind of its own. The lessons behind these rules are in [`README.md`](README.md), section 9.

## 12. Persistence, later

Version 1 keeps everything in memory. Later, everything goes into avenDB, with no store of its own:

| What | In avenDB as |
| --- | --- |
| Definitions | Entries named by hash, like recipes |
| Actors | An entry each: address, definition hash, home peer, latest state snapshot |
| Journals | One log per actor, appended by its home peer's one writer |
| Inboxes | One log per actor that senders append to, kept by a keeper peer for when the home peer is away |
| Runs | Derived from the journals: every message carries its run |
| Wants | A definition's `loads`: the engine keeps them current and hands the `now` tier into each turn, so an actor never fetches |

The seam is the journal's interface: append a committed turn, read from a position, take a snapshot. Version 1
implements it in memory; avenDB implements it later.

## 13. Not in the kernel

Kept out on purpose, so the kernel stays small. Each is either an actor, an app, or a later package:

| Left out | Why |
| --- | --- |
| Capabilities, signatures, encryption | Their own package and thread (`aven/ID/caps`). The router has the place where the check goes |
| Persistence and sync | avenDB's engine (`aven/DB2/db/engine`). The journal's interface is the seam |
| Composites and skills | A composite is an actor whose turn tells other actors. It needs no kernel concept, no members field and no merge law. "Skill" is a product word for such an actor |
| Studio | An app that writes definitions. It is an actor, not part of the kernel |
| Planner, solver, `requires` / `produces` contracts | Discovery and planning are actors that read definitions, later |
| Registry | Later a query over avenDB entries. In version 1 a peer knows the actors it hosts and the addresses it is given |
| The model, the store, HTTP and other doors | Actors, each added when something needs it |
| `explain`, learning, self-healing adapters | Actors or apps, later |
| A tool list for a model | A model actor projects actors' interfaces, later |

## 14. Version 1

What it is: the kernel on one peer, then on two, in memory, test-first.

1. **A Lean model** of router, mailbox, turn, ask and journal. Its theorems: messages between two actors arrive in
   order; every ask gets exactly one answer by its deadline; a duplicate is handled once; a turn never waits;
   replaying a journal gives the same state. Its examples go out as vectors the Rust tests replay (avenDB rule 10).
2. **One peer, in memory, in Rust:** router, mailboxes, scheduler, the deciding runtime, an in-memory journal, the
   clock, tell, ask, reply and fail, and machines.
3. **Faces:** an actor's face on the view runtime, with clicks as tells through the mailbox and pending paint.
4. **Two peers** in avenSANDBOX: `message` and `ack` frames on `aven/db/1`, direct and through the relay, with reconnect
   and duplicates dropped.

What it is not: no capabilities, no encryption, no persistence, no composites, no Studio, no planner.

## 15. Decisions

**Decided**

- **Rust only** for the kernel (Samuel, 30 Oct 2026).
- **In memory** in version 1; everything persists in avenDB later (section 12).
- **No capabilities or encryption** in this design; they are their own package and thread.
- **No composites, Studio or planner** in the kernel (section 13).

**Open**, each with the answer this design would take if no one decides otherwise:

| # | Question | Default |
| --- | --- | --- |
| 1 | Where the crate lives: in avenDB's workspace beside `db/core` and `id/core` (as `aven/DB2/actor/core`), or as its own package outside `aven/DB2`? And is it a milestone of avenDB's plan, or its own plan? | `aven/DB2/actor/core`, as its own milestone in avenDB's plan |
| 2 | The deciding runtime in Rust: a pure-Rust WebAssembly interpreter with fuel (such as wasmi), the same in native and in the Peer-Light; or QuickJS embedded through C bindings; or both, QuickJS compiled to WebAssembly and run by the interpreter | The WebAssembly interpreter with fuel |
| 3 | Are actors' parts written in Rust too (compiled to WebAssembly), or may they be JavaScript, which is what a model or a person most often writes? | Rust first; JavaScript as a second frozen runtime (QuickJS compiled to WebAssembly) |
| 4 | Faces: avenVIBES data, maiaCITY's view runtime (HTML, already probed), or both? And how the page reaches its Peer-Light's kernel | maiaCITY's view runtime; the page reaches the kernel through the Peer-Light's worker, by messages |
| 5 | Frame encoding on `aven/db/1`: JSON lines as today (at most 64 KB), or binary | JSON lines |
| 6 | Actor ids: random, or derived from the definition hash, the spawner and its count | Derived, so a replay names the same actors |
| 7 | Spawning before capabilities exist: who may spawn what | Only the peer's own code, from definitions in the repository |
| 8 | Order: per pair of actors, or per pair of peers | Per pair of actors |
| 9 | Ask deadlines: the default and the longest | 30 s by default, at most 10 min |
| 10 | Tells to an absent peer: how many wait in the outbox, and what happens past that | 1,000 per peer; past that the sender's tell fails |
| 11 | Interface schemas: which subset of JSON Schema the kernel checks | `type`, `properties`, `required`, `enum`, `items`, `minimum` / `maximum`, `maxLength`, `maxItems` |
| 12 | Machines in version 1, or only once an actor needs one | In version 1; they are small |
| 13 | Who a click is from before accounts exist: one person actor per device | One per device |
| 14 | The first actors: a todo list (a machine and a face) on one peer, then a chat between two peers? | Yes |
| 15 | The Lean model's home: a namespace `Aven.Actor` in avenDB's Lean project, or a project of its own | `Aven.Actor` beside `Aven.DB` and `Aven.ID` |
| 16 | A name for the package, since `maia/content/actors` already means people and animals | avenACTORS, in `aven/DB2/actor` |
| 17 | Moving an actor to another peer | Not in version 1; later by handing over the journal head and the address |
