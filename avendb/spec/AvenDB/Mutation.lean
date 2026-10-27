import AvenDB.Address

/-!
# Mutation entries: writes inside a footprint

The one query engine plan, task C2. A mutation is an actor (`Address.lean`) whose methods write: each method's op
templates make writes, and it declares a footprint, the selector of the entries it may touch, and the ops it may make
there. Three nested bounds hold every write a call makes:

1. **The write inside the footprint.** Each write a method makes is to an entry its footprint picks, and each of its
   touches is allowed by one of the method's ops (`inside`). A run that makes any write outside is refused whole
   (`run_inside`, `outside_refused`): a template or a function that reaches further than it declared writes nothing.
2. **The footprint inside the cap.** A call is admitted only where each of the method's ops is held by a cap of the
   caller's whose slice the footprint lies within (`Address.admit_within_cap`).
3. **So the write inside the cap** (`write_within_cap`): every touch of every write an admitted call makes is allowed
   by an op the caller holds a cap for, on a slice that picks the written entry. The rules still judge each write as
   ever (`Rules.lean`, `State.lean`); the footprint is a bound a reader can check before running anything, and the
   reason a refused write never starts.

Functions and flows (`src/lib/avendb/functions.js`, `flows.js`) declare their footprints the same way.

Rust: `avendb::address::Footprint`, the engine's `call` of a mutation.
-/

namespace AvenDB.Mutation

open AvenDB.Address

/-- One write a method made: the written entry's labels, its touches, and whether it is on the main line. -/
structure Write where
  attrs   : Attrs
  touches : List Touch
  main    : Bool
  deriving DecidableEq, Repr

/-- A write lies inside method `m`'s footprint: the footprint picks its entry, and the method's ops allow each of its
    touches. -/
def inside (m : Method) (w : Write) : Bool := m.footprint.matches w.attrs && allowsAll m.ops w.main w.touches

/-- What a run of a method's templates comes to: its writes, or refused at the first write outside its footprint. -/
inductive Run where
  | writes (ws : List Write)
  | outside (w : Write)
  deriving DecidableEq, Repr

def run (m : Method) (ws : List Write) : Run :=
  match ws.find? (fun w => !inside m w) with
  | none => .writes ws
  | some w => .outside w

/-- A run that writes keeps every write inside the footprint. -/
theorem run_inside {m : Method} {ws vs : List Write} (h : run m ws = .writes vs) : vs = ws ∧ ∀ w ∈ ws, inside m w = true := by
  unfold run at h
  split at h
  · rename_i hf
    cases h
    refine ⟨rfl, fun w hw => ?_⟩
    have := List.find?_eq_none.1 hf w hw
    simpa using this
  · cases h

/-- A write outside the footprint refuses the whole run: none of its writes is made. -/
theorem outside_refused {m : Method} {ws : List Write} {w : Write} (hw : w ∈ ws) (ho : inside m w = false) :
    ∀ vs, run m ws ≠ .writes vs := by
  intro vs h
  have := (run_inside h).2 w hw
  rw [ho] at this
  cases this

/-- The write inside the cap: every touch of every write of an admitted call's run is allowed by an op the caller holds
    a cap for, whose slice picks the written entry. -/
theorem write_within_cap {i : Interface} {caps : List Cap} {c : Call} {m : Method} {ws vs : List Write}
    (ha : admit i caps c = .ok m) (hr : run m ws = .writes vs) :
    ∀ w ∈ vs, ∀ t ∈ w.touches, ∃ o ∈ m.ops, o.allows w.main t = true ∧
      ∃ cap ∈ caps, cap.op = o ∧ cap.slice.matches w.attrs = true := by
  intro w hw t ht
  obtain ⟨rfl, hin⟩ := run_inside hr
  have hi := hin w hw
  simp only [inside, Bool.and_eq_true, allowsAll, List.all_eq_true, List.any_eq_true] at hi
  obtain ⟨o, ho, hot⟩ := hi.2 t ht
  obtain ⟨cap, hc, hco, hwithin⟩ := admit_within_cap ha o ho
  exact ⟨o, ho, hot, cap, hc, hco, hwithin w.attrs hi.1⟩

-- Chat's send writes a message row into a room: inside its footprint; the same template aimed at a todo, or setting the
-- room's name, is outside and refused whole, the write before it included
def room : Attrs := ⟨7, 1, 50, 0, []⟩
def todo : Attrs := ⟨8, 1, 51, 0, []⟩
def post : Write := ⟨room, [.insert [.field "messages"]], true⟩
#guard run send [post, post] == .writes [post, post]
#guard run send [post, ⟨todo, [.insert [.field "messages"]], true⟩] == .outside ⟨todo, [.insert [.field "messages"]], true⟩
#guard run send [post, ⟨room, [.set [.field "name"] none], true⟩] == .outside ⟨room, [.set [.field "name"] none], true⟩
#guard run send [⟨room, [.insert [.field "messages"]], false⟩] == .outside ⟨room, [.insert [.field "messages"]], false⟩

end AvenDB.Mutation
