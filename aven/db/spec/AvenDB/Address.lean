import AvenDB.Rules

/-!
# Addressable actors: address, interface, call, describe

The one query engine plan, task A2: the primitives Samuel adopted on 27 Oct 2026 (19:40 Berlin), so that adding mini-app
actors, agreements and an ask layer later migrates no stored entry.

- **Self-contained.** An actor is one signed entry that holds everything about itself: its interface, its code or op
  templates, its version and the caps it needs. Its state is its own stored views. Nothing about it lives outside its
  entry, so no peer, server or registry has to be online to describe it or call it.
- **Address.** A vault, an entry and an interface version: Maia City / `chat.send` / v1.
- **Interface.** Methods (a name, the names of its params, the ops it may make and its footprint, the selector of the
  entries it may touch), events, the caps it needs, its version and a description.
- **Call.** `{to, method, args, caller, against}`, where `against` is the interface version the caller was written for:
  the only way to reach an actor.
- **Cap per message.** Every call is checked: each op the method may make must be held by one of the caller's caps over
  the actor's vault, on a slice its footprint lies within (`admit_within_cap`). Being addressable never means being
  reachable: a caller with no cap reaches no method that changes or reads anything (`no_cap_no_reach`).
- **Versions match.** A call written against another interface version is refused (`admit_version`), so an actor's new
  version never runs a call meant for the old one; a lens between versions comes later.
- **describe.** Asked of one address, answered from the actor's own entry alone (`describe_offline`): the same on every
  device that holds the entry, online or not. Discovery is a query over actor entries, never a registry.

Rust: `avendb::address` (the types and `admit`), `engine` ops `describe` and `call`.
-/

namespace AvenDB.Address

/-- An actor's address: its vault, its entry, and the version of the interface a caller means. -/
structure Address where
  vault   : VaultId
  entry   : EntryId
  version : Nat
  deriving DecidableEq, Repr

/-- One method: its name, the names of its params, the ops it may make, and its footprint, the entries it may touch. -/
structure Method where
  name      : String
  params    : List String
  ops       : List Op
  footprint : Selector
  deriving DecidableEq, Repr

/-- What an actor's entry says it is: its version, its methods, the events it raises, the caps it needs to run, and a
    description for whoever calls it. -/
structure Interface where
  version     : Nat
  methods     : List Method
  events      : List String := []
  needs       : List Cap := []
  description : String := ""
  deriving DecidableEq, Repr

/-- A call: the actor, the method, the names of the args it passes, the vault that calls, and the interface version the
    caller was written against. -/
structure Call where
  to      : Address
  method  : String
  args    : List String
  caller  : VaultId
  against : Nat
  deriving DecidableEq, Repr

/-- A method's footprint fits caps: each op it may make is held by a cap whose slice its footprint lies within, as
    `Selector.fits` decides. -/
def Method.fitsCaps (m : Method) (caps : List Cap) : Bool :=
  m.ops.all fun o => caps.any fun c => c.op == o && m.footprint.fits c.slice

/-- What becomes of a call. -/
inductive Verdict where
  | ok (m : Method)
  | wrongVersion
  | noMethod
  | badArgs
  | outsideCap
  deriving DecidableEq, Repr

/-- Admit a call to an actor with interface `i`, from a caller holding caps `caps` over the actor's vault: the versions
    match, the method is one of its methods, the args are its params, each once and none missing, and its footprint
    fits the caps. -/
def admit (i : Interface) (caps : List Cap) (c : Call) : Verdict :=
  if c.against != i.version || c.to.version != i.version then .wrongVersion
  else match i.methods.find? (·.name == c.method) with
    | none => .noMethod
    | some m =>
      if !(c.args.Nodup ∧ c.args.all m.params.contains ∧ m.params.all c.args.contains) then .badArgs
      else if m.fitsCaps caps then .ok m else .outsideCap

/-- A call is admitted only against the interface version the actor has. -/
theorem admit_version {i : Interface} {caps : List Cap} {c : Call} {m : Method} (h : admit i caps c = .ok m) :
    c.against = i.version ∧ c.to.version = i.version := by
  unfold admit at h
  by_cases hv : (c.against != i.version || c.to.version != i.version) = true
  · simp [hv] at h
  · simp only [Bool.or_eq_true, bne_iff_ne, ne_eq, not_or, Decidable.not_not] at hv
    exact hv

/-- An admitted call runs one of the actor's methods, the one it names. -/
theorem admit_method {i : Interface} {caps : List Cap} {c : Call} {m : Method} (h : admit i caps c = .ok m) :
    m ∈ i.methods ∧ m.name = c.method := by
  unfold admit at h
  split at h
  · cases h
  · split at h
    · cases h
    · rename_i m' hf
      split at h
      · cases h
      · split at h
        · cases h
          exact ⟨List.mem_of_find?_eq_some hf, by simpa using List.find?_some hf⟩
        · cases h

theorem admit_fits {i : Interface} {caps : List Cap} {c : Call} {m : Method} (h : admit i caps c = .ok m) :
    m.fitsCaps caps = true := by
  unfold admit at h
  split at h
  · cases h
  · split at h
    · cases h
    · split at h
      · cases h
      · split at h
        · cases h; assumption
        · cases h

/-- Cap per message: every op an admitted call's method may make is held by one of the caller's caps, on a slice its
    footprint lies within. -/
theorem admit_within_cap {i : Interface} {caps : List Cap} {c : Call} {m : Method} (h : admit i caps c = .ok m) :
    ∀ o ∈ m.ops, ∃ cap ∈ caps, cap.op = o ∧ m.footprint.Within cap.slice := by
  intro o ho
  have hf := admit_fits h
  simp only [Method.fitsCaps, List.all_eq_true, List.any_eq_true, Bool.and_eq_true, beq_iff_eq] at hf
  obtain ⟨cap, hc, hop, hfit⟩ := hf o ho
  exact ⟨cap, hc, hop, fits_sound _ _ hfit⟩

/-- Being addressable is not being reachable: a caller with no cap reaches no method that makes any op. -/
theorem no_cap_no_reach {i : Interface} {c : Call} {m : Method} (h : admit i [] c = .ok m) : m.ops = [] := by
  have hf := admit_fits h
  cases hm : m.ops with
  | nil => rfl
  | cons o os => simp [Method.fitsCaps, hm] at hf

/-! ## describe -/

/-- What a device holds of actor entries: the interface each entry's record says, where it says one. -/
abbrev Held := VaultId → EntryId → Option Interface

/-- `describe`: the interface the address's entry holds, if it is of the version asked for. It reads the entry alone. -/
def describe (held : Held) (a : Address) : Option Interface :=
  (held a.vault a.entry).filter (·.version == a.version)

/-- Two devices that hold the same entry describe its address alike, whatever else either holds, and whether or not any
    peer is reachable: nothing about an actor lives outside its entry. -/
theorem describe_offline (h₁ h₂ : Held) (a : Address) (same : h₁ a.vault a.entry = h₂ a.vault a.entry) :
    describe h₁ a = describe h₂ a := by
  simp [describe, same]

/-- What `describe` answers is the version asked for, read from the entry. -/
theorem describe_sound {held : Held} {a : Address} {i : Interface} (h : describe held a = some i) :
    held a.vault a.entry = some i ∧ i.version = a.version := by
  simp only [describe, Option.filter_eq_some_iff, beq_iff_eq] at h
  exact h

/-- A call goes to the interface its address describes: refused where the device holds no such entry or version, else
    admitted by `admit`. -/
def call (held : Held) (caps : List Cap) (c : Call) : Verdict :=
  match describe held c.to with
  | none => .noMethod
  | some i => admit i caps c

theorem call_described {held : Held} {caps : List Cap} {c : Call} {m : Method} (h : call held caps c = .ok m) :
    ∃ i, describe held c.to = some i ∧ m ∈ i.methods ∧ c.against = i.version ∧
      ∀ o ∈ m.ops, ∃ cap ∈ caps, cap.op = o ∧ m.footprint.Within cap.slice := by
  unfold call at h
  split at h
  · cases h
  · rename_i i hi
    exact ⟨i, hi, (admit_method h).1, (admit_version h).1, admit_within_cap h⟩

-- Chat's send: a member's caps (insert messages of rooms) reach it; a viewer's (read only) don't; a call against v2 of
-- a v1 actor is refused; an unknown method, a missing or an unknown arg are refused
def rooms : Selector := .anyOf [[.typeIn [7]]]
def send : Method := ⟨"send", ["room", "text"], [.insert [.field "messages"] (some .main)], rooms⟩
def chat : Interface := { version := 1, methods := [send], description := "Chat: post to a room" }
def to1 : Address := ⟨1, 42, 1⟩
#guard admit chat [⟨.insert [.field "messages"] (some .main), rooms⟩] ⟨to1, "send", ["room", "text"], 9, 1⟩ == .ok send
#guard admit chat [⟨.insert [.field "messages"] (some .main), .all⟩] ⟨to1, "send", ["text", "room"], 9, 1⟩ == .ok send
#guard admit chat [⟨.read, .all⟩] ⟨to1, "send", ["room", "text"], 9, 1⟩ == .outsideCap
#guard admit chat [⟨.insert [.field "messages"] (some .main), .anyOf [[.typeIn [8]]]⟩] ⟨to1, "send", ["room", "text"], 9, 1⟩ == .outsideCap
#guard admit chat [] ⟨to1, "send", ["room", "text"], 9, 1⟩ == .outsideCap
#guard admit chat [⟨.read, .all⟩] ⟨to1, "send", ["room", "text"], 9, 2⟩ == .wrongVersion
#guard admit chat [⟨.read, .all⟩] ⟨⟨1, 42, 2⟩, "send", ["room", "text"], 9, 1⟩ == .wrongVersion
#guard admit chat [⟨.read, .all⟩] ⟨to1, "delete", [], 9, 1⟩ == .noMethod
#guard admit chat [⟨.read, .all⟩] ⟨to1, "send", ["room"], 9, 1⟩ == .badArgs
#guard admit chat [⟨.read, .all⟩] ⟨to1, "send", ["room", "text", "x"], 9, 1⟩ == .badArgs
#guard admit chat [⟨.read, .all⟩] ⟨to1, "send", ["room", "room", "text"], 9, 1⟩ == .badArgs
#guard describe (fun v e => if v == 1 && e == 42 then some chat else none) to1 == some chat
#guard describe (fun v e => if v == 1 && e == 42 then some chat else none) ⟨1, 42, 2⟩ == none

end AvenDB.Address
