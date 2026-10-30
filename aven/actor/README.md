# aven/actor

What three systems that built an actor architecture taught us, reduced to first principles. Status: **discovery**.
There is no code here yet. The design itself is [`ARCHITECTURE.md`](ARCHITECTURE.md), the single source of truth for
the next implementation; where the two disagree, it wins.

Authority (accounts, signers, owners, capabilities, access control) is avenID's caps spec,
[`../DB2/id/caps/README.md`](../DB2/id/caps/README.md), beside avenID's signing and vault infrastructure. This document
links to it wherever authority comes up.

"Actor" here means a software actor: an addressable unit with a mailbox. The people and animals of the worlds
(`maia/content/actors`, the actor skill) are a different thing with the same word.

1. [The goal](#1-the-goal)
2. [Where we looked](#2-where-we-looked)
3. [How the avenOS actor system works](#3-how-the-avenos-actor-system-works)
4. [What avenVICTORIO changed](#4-what-avenvictorio-changed)
5. [What Abject adds](#5-what-abject-adds)
6. [What maiaCITY already has](#6-what-maiacity-already-has)
7. [Weak spots we must not repeat](#7-weak-spots-we-must-not-repeat)
8. [First principles: what each concept is for](#8-first-principles-what-each-concept-is-for)
9. [What runtimes taught us](#9-what-runtimes-taught-us)
10. [The design](#10-the-design)

## 1. The goal

One small trusted kernel that admits, runs and supervises actors written by anyone (a person, a model, a peer) on
demand, fully generic, without trusting them:

- what an actor can do is limited by the capabilities it holds;
- what it did can be checked by replaying its journal;
- what matters waits for a person's signature.

## 2. Where we looked

| Source | Version read | What it is |
| --- | --- | --- |
| avenOS (`MyAvenCEO/avenOS`) | `main` 8310bc3, 16 Sep 2026 | The desktop app: an in-app actor mesh (`libs/aven-actors`, `app/src/lib/actors`), a durable server runner (`services/actor-runner`) and Skill Studio |
| avenVIBES (`MyAvenCEO/avenVIBES`) | b893b15, 30 Aug 2026 | The UI engine avenOS's actors paint with: views as JSON, rendered into a shadow root |
| aven-brands (`MyAvenCEO/aven-brands`) | 88a8427, 4 Sep 2026 | avenCEO's and avenYMA's brands as data, and the component library avenCEO's site is built from: 53 components as JSON, rendered by avenVIBES |
| avenVICTORIO | `main` e1c15a8, 23 Sep 2026 | A restaurant's team app. It ported the avenOS mesh to a server on 15 Sep and changed it in 192 commits over nine days of real use |
| Abject (`mempko/abject`, abject.world) | v0.16.1, 27 Oct 2026 | An open-source "Abject-oriented OS" whose ideas avenOS borrowed and named deviations from |
| maiaCITY | this repository | The deterministic logic core and the view host in `aven/kernel/sandbox`; avenDB's rules in `aven/DB2` |

Everything below comes from reading code and documents. None of it was run for this document. Paths in sections 3 to
5 are relative to the repository they name.

## 3. How the avenOS actor system works

### 3.1 The actor

An actor is a **manifest** (plain data), a **mailbox** and private **state** (`libs/aven-actors/src/actor.ts`). The
manifest names the actor, lists its methods with JSON schemas for their arguments, and may carry:

- `requires` / `produces`: Prolog-style contracts such as `todo_intent(I)` → `todo(T)`;
- `machine`: the actor's state machine as a `.pl` file;
- `logic`: its behaviour as JavaScript source, run in a sandbox;
- `view` and `style`: its face as JSON;
- `capabilities`: the host functions its sandbox may call.

The mailbox handles one message at a time, in arrival order. A handler that throws is retried once, then returns a
structured `ok:false` result. A method that declares `event: { send }` needs no handler: one generic adapter turns
the call into that event for the sandboxed logic. The todo actor is pure configuration
(`app/src/lib/actors/todo.config.ts`), built by one generic actor class.

### 3.2 The bus

`MessageBus` (`libs/aven-actors/src/bus.ts`) has three ways in:

| Sender | Call | What happens |
| --- | --- | --- |
| The model, by a tool call | `dispatch(from, method, payload)` | Finds the actor that handles the method and puts the message in its mailbox |
| An actor announcing a fact | `emit(predicate, payload)` | Delivers to every actor whose `requires` unifies with the fact |
| A click in a view | `uiEvent(from, actor, event)` | Feeds the event straight into the actor's logic |

The model's tool list is derived from the registered actors (`toolSpecs()`): register an actor and the model can
call it. A method with `hitl: '<label>'` is **held**: it runs only after a physical button press, voice cannot
confirm it, and confirming is not a tool.

### 3.3 Contracts and the derived graph

Contracts are matched by **unification** (`term.ts`): uppercase arguments are variables, lowercase are constants, so
`status(offen)` never reaches a consumer of `status(erledigt)`. The flow graph is never stored; `edges()` derives it
wherever one actor produces what another requires, so the drawn graph and the routing use one rule. A composite's
interface is derived from its members by the **merge law**: it requires what its members require and do not
themselves produce, and produces everything they produce (`compositeInterface`, `actor.ts:77`).

### 3.4 State machines

Each actor may carry a fact-only Prolog state machine (`machine.ts`): `state/1`, `initial/1`, `transition/3`,
`guard/2`, `cycle/2`, and its outside contracts as `requires/1` and `produces/1`. The todo machine
(`app/src/lib/actors/todo-machine.pl`) is injected into the sandboxed logic, which refuses any status change that is
not a declared transition. The same file draws the actor's diagram. Window, chat, listener and speaker each carry one.

### 3.5 Logic in a sandbox

`logic` runs in QuickJS compiled to WebAssembly (`sandbox.ts`), in a context with nothing in it: no `fetch`, no
`import`, no timers. Four entry points cross the boundary as JSON:

- `initState(source)`: the first state;
- `reduce(state, event)`: the next state, plus `said` (a sentence for the model) and `record` (data for the UI);
- `shape(state, rawModelText)`: the only place raw model output is parsed. Garbage returns `null` and the state
  stays as it was;
- `cap(name, payload)`: a host capability, granted only if the manifest lists it. The runtime is asyncified, so an
  async host call pauses the VM.

Each call gets about 1 s of VM time (wall clock, `FUEL_MS`) and 32 MB of memory.

### 3.6 Views

A view is JSON in avenVIBES's small vocabulary (`tag`, `class`, `text`, `$each`, `$on`, `$` for state, `$$` for the
current list item), with no conditionals: the view computes nothing. `$on` sends a message back to the actor rather
than running code. The engine renders into a shadow root behind a tag allowlist, rejects raw CSS, checks URL schemes
and sanitises markdown. The same view can be rendered to an HTML string at build time. In the app,
`AvenVibeEngine.svelte` mounts any actor's view, re-renders when `actor.state` changes, and turns clicks into
`bus.uiEvent`. Two windows (list and Kanban) are two views of one actor's state.

### 3.7 One request end to end

1. The listener emits `utterance(T)`, which reaches the chat actor.
2. The model sees the derived tools and calls `todo_create {titles:["milk"]}`.
3. `dispatch` puts it in the todo actor's mailbox. The adapter turns it into `CREATE`, and the sandboxed `reduce` runs,
   checked against the `.pl`.
4. The new state reaches the view, which re-renders.
5. The reply streams out as `delta(D)` emits, which the speaker plays.

A click sends `TOGGLE` through the same `reduce`, so voice and mouse share one code path.

### 3.8 The durable half

The same manifests drive planned, persisted work:

- **Registry** (`registry.ts`): versioned definitions, factory offers (actors that can be started on demand) and live
  instances. IDs have the shape `authority:kind:namespace:name@version`, with authorities `id.aven` (identity),
  `os.aven` (runtime) and `ceo.aven` (product).
- **Authorization** (`authorization.ts`): a per-person view of the registry, checked again at four moments: discover,
  plan, spawn, invoke.
- **Planner** (`planner.ts`): `solve()` is a bounded uniform-cost search (24 steps, 2,000 states) from facts to a goal
  fact. It returns a plan as data and executes nothing. A physical plan binds each step to the cheapest target and
  places the whole run `local` or `server`.
- **Observation solver** (`observation-solver.ts`): plans only from facts already committed and re-plans after every
  batch. The document lane (OCR, classification, invoice extraction) runs on it.
- **Executor** (`executor.ts`): per step it checks, spawns, checks again, delivers one envelope, releases the actor
  and publishes the outputs before moving on. It accepts only single-item slots and runs steps one after another.
- **Runner** (`services/actor-runner`): runs in Postgres move through `accepted → planning → running → succeeded`, or
  `waiting_for_input`, `failed`, `cancelled`. A running worker holds a 30 s lease renewed every 5 s. A run whose lease
  expired is failed as `EXECUTION_UNCERTAIN` and never replayed, so a side effect cannot happen twice by accident.
- **Studio** (`studio/v2.ts`): a `studio.skill@2` is a small program of steps with named, typed ports, compiled to a
  plan without search. Only `invoke`, nested `skill` and "run if present" execute today, and only one generic actor
  (`email-brief`) runs end to end.

### 3.9 What the history shows

The board (`libs/aven-board/board`) records the design path: an Abject-inspired primitive (0126), real mailboxes and
`emit` (0127), faces as data and all logic in QuickJS (0130, with its deviations from Abject named), the statechart
per actor and manifest-as-data (0143, 0147), the merge law (0148). Several larger steps were built and then removed:

- a Negotiator, a Composer and a recipe engine, rejected on 14 Aug as too complex;
- multi-instance actors (0133), later stripped;
- proof execution (`goal_run`, `satisfy`), gone from the code.

Their own review (`docs/actor-planner-architecture-review.md`, 5 Sep) found real planner defects and a runner without
step-by-step durability, and recommended "evolution, not replacement".

## 4. What avenVICTORIO changed

avenVICTORIO took the avenOS pattern one to one and moved it to a server with many users. It is the only place the
architecture met daily use, and it changed most of what matters:

| avenOS | avenVICTORIO |
| --- | --- |
| Actors live in browser memory, so a reload forgets everything | Everything on the bus is persisted: runs, every envelope, held questions, conversation, actor state, goals |
| Methods carry no permission | Every method names the capability its caller must hold, and a method that names none can be called by nobody. The model sees only tools the current person may use. Clicks are checked too, and a click on a held method is held as well |
| Nobody owns an action | Every run belongs to a person and acts with their rights. Viewing the app as another person narrows the rights |
| Held actions are closures in memory | Held actions are stored as data and come back after a restart |
| A goal is done when the model says so | A goal is a metric with a target. A method like `plan_next` returns the next calls, so a goal advances by itself and the model is needed only for language |
| Rules live in prompts | Laws (what an actor may be) are code checked against every manifest; cases (what this house means) are editable data. "A guard the guarded can edit is worth nothing" |
| An actor carries its own face | A skill has no face. A separate window draws it, and each person sees their own projection (`viewFor(who)`) |
| Actors are code | Actors are database rows, with draft, activate, rollback, and hot reload that keeps the address |
| `ask()` is documented, not built | `ask()` works, with manifest prose as the fallback |

The human gate grew up. A question goes to one named person or to anyone holding a capability. An answer can be
partial, with a state per item ("take / rather not / cannot"). A question says what silence means. The same thing is
never asked twice, each person gets at most one card, and an open card is redrawn when the facts change. An answer in
words withdraws the card: words are a correction, not a decision.

Two avenOS mechanisms were dropped in practice. `emit` routing is gone; `requires`/`produces` only draw the graph.
`shape()` is gone; the model's text is parsed elsewhere.

The lesson that repeats through its history: **a rule written in the prompt fails, then becomes a door in code.** It
happened with withheld tools, with methods only a goal may call, and with routing decided in code instead of by the
model.

## 5. What Abject adds

Abject (short for AI object) makes everything an object with a mailbox, including the registry, the factory, the
model and every window. Every object answers `ask` in plain language. Ideas we do not have yet:

1. **Mailboxes do not block on their handlers.** A handler waiting for a reply does not stop the next message; code
   that must not interleave takes an explicit lock, and a request times out after 30 s unless progress events reset
   it. This avoids the deadlocks in section 7.
2. **Identity comes from the transport, never from the payload.** The receiving side sets `authenticatedPeerId`;
   "a value from the wire is never trusted".
3. **Authority comes from where code runs, not from what it declares.** Built-in objects are trusted, generated ones
   are not, and privileged handlers admit only built-in callers.
4. **Capability objects.** HTTP, files, shell and storage are objects behind a permission broker with autonomy levels
   (`ask`, `read`, `edit`, `full`) and a ceiling set by the workspace. One dialog broker asks the person: the first
   answer wins from any device, and with no one to ask, the answer is no.
5. **"Compression, not abstraction".** `ask` derives its answer from the running source every time instead of a
   manifest written once, and the asked object can ask back.
6. **It learns.** An agent predicts what a step will do, acts, and a reviewer later compares prediction and outcome.
   Lessons become facts and Alexander-style patterns with evidence counts, and matching patterns are woven into the
   next plan. "A loop without memory is a treadmill. A loop with memory is a ratchet."
7. **Goals run as sprints.** A ScrumMaster asks each agent for an approach or a pass, tasks go onto a shared board,
   and an observer fails a goal after 30 minutes without progress.
8. **Supervision with snapshots.** A killed object comes back knowing what it knew; a dead worker thread is rebuilt.
   The main thread holds only the bus, the registries and the sockets.
9. **Self-healing adapters.** When two objects speak different messages, a model writes a proxy between them and
   rewrites it above a 10 % error rate. avenOS rejected this as too complex, which is right until we host actors
   from outside.
10. **Contracts always on** (pre-conditions, post-conditions, invariants), and Smalltalk-style dependents for
    watching another object change.

Where our sources are stronger: a deterministic planner instead of model-run sprints; measured goals instead of the
model's judgment; avenDB's identity, shares and proofs instead of per-peer keys alone.

## 6. What maiaCITY already has

- **Frozen runtimes, one list** (`aven/kernel/sandbox/engines.json`, `engines.js`): every engine a host of ours runs
  untrusted code on, by kind, each version named by the BLAKE3 hash of its file and never changed or removed:
  - `logic`: QuickJS with limits counted in work ("ticks"), not time; `Math.random` seeded by the caller; `Date` frozen
    at the caller's `now`; binary buffers removed. The same code with the same input gives the same answer on every
    device (`logic.js`);
  - `view` and `view-worker`: views from anyone (HTML, our components, template marks, an optional draw script and
    optional logic) in a frame with no origin; the draw script runs in a worker on a copy of the DOM
    (`ViewHost.svelte`, `view-host.js`);
  - `lib-three`, `lib-d3`, `lib-mcp-apps`: the only libraries a draw script may import, frozen too, with no CDN;
  - `math`: KaTeX, whose MathML passes a checker element by element before anything is drawn (`math-host.js`,
    `mathml.js`);
  - `box`: the asset box, where a three.js recipe named by its hash is built with its declared parameters and handed
    back as plain data (`maia/content/assets/box/engine.js`).

  Beside them, the Markdown engine (`maia/site/lib/markdown/index.js`) writes every tag itself from an allowlist, so
  nothing in Markdown can run, load or lead anywhere. [`ARCHITECTURE.md`](ARCHITECTURE.md) (section 5) rewrites these
  as the runtimes of the actor model.
- **avenDB's rules** (`aven/DB2/README.md`): pure protocol cores as state machines without I/O; no step without
  progress; react to changes, never to states; derived state is a cache keyed by its inputs and code version; only a
  person's or an agent's act writes; Lean is the source of truth and the tests derive from it.

- **Actors that declare what they load** (avenDB-old: `aven/db/page/actors.js`,
  `maia/content/game/code/sources/actors.js`, `aven/db/spec/AvenDB/Interest.lean`). An app is an actor: an entry of the
  Maia City vault ("Actor, v3", evolved from "Manifest, v2"), changed only by proposal. Its `loads` is a tree of
  Interests in four tiers: what the screen shows `now`, what the person opens `next`, the `later` rest of the screen's
  data, and the `idle` rest kept offline. An Interest uses the selector grammar of capabilities ("so caps and wants stay
  one concept"), with slots bound by the route or the selection (`$room`, `$timeline`), a window on long logs, a
  `follow` depth, and a signal that orders it (viewport, playhead, camera). An actor's `loads` may hold another actor,
  which never pulls its parts above the tier it sits in. Proven: tiers and signals only order and never add or withhold
  an entry, a slot nobody bound wants nothing, and an Interest grants nothing. The query and sync learnings are in
  [`../DB2/db/research/E1-avendb-old-engine.md`](../DB2/db/research/E1-avendb-old-engine.md), which avenDB's one engine
  spec, [`../DB2/db/engine/README.md`](../DB2/db/engine/README.md), takes up.

What we lack is the layer beside it: mailboxes, messages between actors, capabilities per message, a journal, and the
lifecycle of actors made on demand. Those avenDB-old actors only load; their `interface`, `needs` and `code` are still
empty.

## 7. Weak spots we must not repeat

Each item names where it was seen. Items from avenVICTORIO are described as patterns; that repository is private and
its details are not repeated here.

**Security**

1. **Hidden is not refused.** A method left out of the model's tool list must also be refused at the door. A model can
   name a method it was never shown (seen in avenVICTORIO).
2. **Identity in the payload.** "Who decided" was read from the message body, so a sender could claim to be someone
   else (avenVICTORIO).
3. **Identity guessed from context.** The person behind a call was inferred from whatever message was in flight, so
   two overlapping users could swap rights. With no owner found, the store acted with every right (avenVICTORIO).
4. **A gate declared but not enforced.** No avenOS method declares `hitl`, so `todo_delete` runs at once while the
   system prompt says destructive actions are held (`app/src/lib/chat/chat.svelte.ts:82`). Studio's automation tools
   are not held either.
5. **Laws checked by text matching.** Admission laws that read actor source with regular expressions can be evaded
   by an actor written at runtime (avenVICTORIO).
6. **Arguments not validated.** Tool arguments reach handlers without a check against their JSON schema
   (`libs/aven-actors/src/bus.ts:242`).
7. **Rights cached past revocation.** A person's capabilities were cached until a restart (avenVICTORIO).

**Correctness and concurrency**

8. **Clicks bypass the mailbox.** `uiEvent` calls the logic directly (`bus.ts:225`; also in avenVICTORIO), and the
   state is read before the sandbox runs, so a click and a message can overwrite each other.
9. **Mailboxes wait for the whole handler.** A cycle of requests deadlocks, and long handlers serialize everything
   behind them (both repositories).
10. **One sandbox lane for the whole server.** A slow host call inside one actor's logic blocks every other actor's
    logic (avenVICTORIO).
11. **Silent retry of side effects.** A throwing handler is retried once whatever its declared idempotency
    (`actor.ts:482`).
12. **A flat term parser.** Arguments are split on every comma, so nested terms break (`term.ts:23`). `emit`
    addresses an actor by its template name, which reaches only the first instance (`bus.ts:194`).
13. **A sandbox that is not deterministic.** Fuel is wall-clock time, and `Date` and `Math.random` are live
    (`sandbox.ts:67`; also in avenVICTORIO), so a replay can differ.
14. **Decorative state machines.** Where a status is set directly, the `.pl` and the behaviour drift apart
    (avenVICTORIO's goals).
15. **Planner defects.** Several goals could be satisfied with inconsistent bindings, and an unknown observation could
    be used as known (avenOS's own review).

**Durability**

16. **Forgetting.** avenOS's actors and held actions live only in page memory; held actions are closures.
17. **No step journal.** The runner saves admission and the final result but no step-by-step record, has no fencing,
    and a cancel does not stop work already running (avenOS's own review).
18. **A ledger written without waiting** for the database, and never trimmed (avenVICTORIO).

**The model and its tools**

19. **Every tool, every round.** Each round sends every method as a tool, which costs tokens and confuses the model
    (both repositories).
20. **Rules in prose.** Tool descriptions and guidance text carry rules that code should hold (both).
21. **Shared state in prompts.** An actor's summary described whoever touched it last, and went into everyone's prompt
    (avenVICTORIO).
22. **A wrong tool name ends the turn** instead of returning an error to the model
    (`app/src/lib/chat/chat.svelte.ts:738`). The system prompt also hard-codes tool names, against "tools are derived".

**Concepts and ergonomics**

23. **"Skill" has six meanings** in avenOS: a drawn graph, a product definition, a Studio program, a catalog entry,
    artifact types and an intent overlay.
24. **Logic as untyped strings.** Actor programs are long JavaScript template strings, with no types, lint or editor
    help (both).
25. **Designed but unused.** Composition by members and multiple instances exist in code without real use.
26. **Documents that contradict the code** (several in avenOS).

**Scale and cost**

27. **Everything serialized** on one bus, one database connection and one sandbox lane, with every change broadcast to
    every open tab (avenVICTORIO). One mailbox serializes all model calls (both).

## 8. First principles: what each concept is for

Strip each concept to the job it does; where two concepts do the same job, keep one. Four things remain.

| Essential | Its one job |
| --- | --- |
| **Actor** | Holds state and changes it only by handling one message at a time. A definition (immutable, named by hash) is its class; an instance is a live one |
| **Message** | The only way anything happens. There is one verb, `tell`. An `ask` is a tell with a reply address and a deadline; a `reply` or `fail` is a tell to that address |
| **Capability** | The right to send a kind of message to an actor. The only authority there is ([caps](../DB2/id/caps/README.md)) |
| **Journal** | The ordered record of messages and turns. The truth; everything else is a cache or a view of it |

Everything else in the sources is one of these four, or a role an actor plays:

| Seen in the sources as | What it really is |
| --- | --- |
| Skill, agent, workflow, composite, Studio skill, tool actor, service | An actor. Its role is a convention in its definition, not a kind the kernel knows |
| Tool | A message in an actor's interface that the run's capabilities allow. The tool list is a projection, not a concept |
| Intent, goal | An actor whose state is a target and its progress. "Done" is a measurement |
| Chat, conversation | An actor that turns a person's words into messages |
| Window, face, vibe, component | A component is a definition whose main part is its face; every placed one is a face actor, mounted while it is shown ([`ARCHITECTURE.md`](ARCHITECTURE.md), section 6) |
| Planner, solver | A pure function from contracts to a plan, which is data. It is an actor only so it can be addressed |
| Registry, factory, supervisor | The kernel's own duties; a registry is later a query over avenDB |
| Model, store, clock, HTTP, files, push | Door actors: the only holders of effects in the real world |
| `emit` routing, `dispatch`, UI events, releasing a held call | One verb, `tell` to an address. Matching contracts is a registry query that picks addresses, not a router |
| Human gate, permission prompt, access request, approving a new goal | An `ask` addressed to a person. For authority it is a co-signature ([caps](../DB2/id/caps/README.md)) |
| `shape()` (parsing model text) | Handling the model's `reply` in an ordinary turn |
| `cap()` host calls inside logic | Effects returned by the turn, or reads handed in with the message |
| `requires`/`produces`, input and output slots, Studio ports | Typed messages on the interface. Contracts for discovery and planning are later actors, not the kernel |
| `.pl` machine, reducer guards | The machine says which messages are legal now; the logic computes the next state |
| `record` and `wire`, `said` | The reply is data. Prose for a model is rendered from it by whoever needs prose |
| `ask()` / interview | `explain`: a message an actor may answer from its definition, source and state; later, not the kernel |
| Metrics, `measure` | A read-only ask |
| Run ledger, trace, activity feed, held-envelope store, actor state table | The journal and views of it |
| Derived state, snapshots | Caches of the journal or of the store |
| Cases, lessons, patterns | Knowledge facts with evidence |
| Supervision retry | A policy keyed on the interface's declared idempotency |
| Merge law, members | Not needed: a composite is an actor whose turn tells other actors |
| Manifest, `loads`, keep share, query held by a view | The actor's declared wants: its dependencies, which the sync engine brings. A want grants nothing |
| `logic`, `view`, `style`, face, vibe, draw script, Markdown, LaTeX, recipe, chart | Parts: content in a format, for the runtime of that kind ([`ARCHITECTURE.md`](ARCHITECTURE.md), section 5) |
| Sandbox, logic core, view engine, math host, asset box, Markdown engine | Runtimes: frozen engines that run any part without trusting it |
| Skill (the composite) vs actor (the leaf) | No second kind. A composite is an actor that tells other actors; "skill" is a product word for one ([`ARCHITECTURE.md`](ARCHITECTURE.md), section 12) |

## 9. What runtimes taught us

From maiaCITY's runtimes in `aven/kernel/sandbox`:

1. **Two walls.** A worker inside a frame with no origin (`sandbox="allow-scripts"` without `allow-same-origin`):
   no cookie, storage, passkey or page of ours; a policy that allows no connection; every device feature off from one
   deny list (`policy.js`). Then a second lock removes every way out a worker has (`lockdown.js`), because browsers
   differ in what the first wall covers.
2. **Never on the page's thread.** Code that never stops cannot freeze the page, not even in Safari.
3. **Checked before it starts.** The runtime's bytes are checked against their hash and handed in whole; the shell
   can load nothing else.
4. **Rooms.** One worker per piece of code, so one part can neither see nor answer another's jobs, and a crash or an
   overrun ends only its room.
5. **Out comes plain data,** checked on the host's side: MathML element by element, Markdown's tags against an
   allowlist, a view's HTML cleaned, an asset's card against its schema.
6. **Work, not time.** Limits count work, so every device agrees; the clock is a backstop for built-in calls that do
   much work between checks.
7. **Degrade to the safe thing.** LaTeX that cannot be typeset shows as its source; raw HTML in Markdown shows as
   text.
8. **Isolate the bad one.** A math batch that overruns is asked again in halves, until the formula that overran is
   alone and given up.
9. **No CDN.** The libraries a draw script may import are frozen runtimes too.
10. **Probes in real browsers.** Hostile parts aim at a canary in Chromium and WebKit (`aven/kernel/probes.mjs`;
    Firefox is not probed yet). WebKit compiled WebAssembly despite the frame's policy, and Safari let a frame with
    no origin open its cache storage: a wall that holds in one engine is not taken to hold in another.

From the other sources: avenOS ran QuickJS on the page's thread with a wall-clock limit, and rendered avenVIBES views
in the page's own shadow root, trusting a validator. That is acceptable only for a showing runtime with no script
whose renderer writes every tag itself from an allowlist, as maiaCITY's Markdown engine does. avenVIBES renders the
same view to a string at build time and to the DOM at run time; two runtimes for one format must give the same result,
and a test holds them to it. Abject runs other languages as WebAssembly with only three imports (send a message, log,
read the clock).

From aven-brands' component library (`brands/CEO/design-system/src/brand/actors`, `actors.ts`) and avenVIBES's
`states.ts`:

1. **One component type,** with `props`, `events` and `slots`; a leaf has no slots. avenVIBES calls the definition an
   `ActorDef` and each placement an actor instance with its own address. That is kept: a component is a definition,
   and every placed component is a face actor.
2. **Variants are axes** that answer different questions: what a button means, its shape, its size. Before the split,
   a destructive icon button could not be expressed.
3. **A moment is a state, not a variant.** `unavailable` and `success` were variants that meant states; eight states
   with fixed selectors replaced them.
4. **The state contract is checked at load.** An interactive component that does not declare hover, focus, active and
   disabled fails the build, because those states never show in a screenshot of the resting component.
5. **Scope everything to the component.** Its custom properties are declared on itself, not at the root, so two brands
   on one page cannot overwrite each other. It sizes by container queries; the library has no viewport media query.
6. **A brand is data.** The generator, utilities and scanner know no particular brand. Generated CSS is committed,
   so a hex edited anywhere but the brand's definition shows as drift.
7. **Decisions travel with the component.** `$description` keys at any depth say why each choice was made.

## 10. The design

The design that follows from all of this is [`ARCHITECTURE.md`](ARCHITECTURE.md), the single source of truth for the
next implementation. It builds the engine bottom-up from what the first principles above require: values, documents,
messages, runtimes, actors, the kernel and faces, with version 1 as a standalone todo app in memory. Capabilities and encryption, persistence, composites, Studio
and planning are left to their own packages or to later actors.
