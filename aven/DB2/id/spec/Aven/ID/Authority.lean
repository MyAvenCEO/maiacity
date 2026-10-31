import Aven.ID.Revoke

/-! # What an envelope says of its authority (A45; caps, "Checking")

An envelope's body carries, under its key `authority`, the one Value caps reads of it (A45, agreed with the docs
threads): the chain the envelope rests on, by its caps' names, root first and empty on its vault's own authority; the
revocations its writer acknowledges, by their names (`Aven.ID.Revoke`); and, on an actor host's envelope only, the
acting actor (A27, A188). The docs layer carries the Value without reading it (`Aven.DB.Docs.Body`); what it holds is
caps', and `Aven.Architecture` holds the reader's reads to it. It has exactly one of two shapes, with no optional key
and no null (A42):

```
authority: {"acks": [name…], "caps": [name…]}                 any envelope but an actor host's
           {"acks": [name…], "caps": [name…], "actor": Doc}   an actor host's envelope
  caps:  the caps the envelope rests on, root first; [] on its vault's own authority
  acks:  the revocations its writer acknowledges
  actor: the actor the host acts for, by its Doc
```

Keys sort as the codec sorts them, shorter first: `acks`, `caps`, `actor`. Each name is 32 bytes: a cap's
(`Cap.digest`, A30) or a revocation's (`Revocation.digest`); the actor is its Doc's 32-byte id. A reader takes the
names as Revoke's `Reads` (`Reads.ofAuthority`), so the chain an envelope names is the one every revocation is checked
against, and the actor as its `actorOf` (`Authority.actorOf`): nothing about a write's authority is stored twice.

- `ofValue?_value`: a Value written reads back, for names and an actor of 32 bytes;
- `value_ofValue?`: what reads back is written exactly so: each shape has one form;
- `ofValue?_names`: what reads back names only 32-byte names and a 32-byte actor. -/

namespace Aven.ID

open Aven.Core

/-- What an envelope's body says of its authority: the chain it rests on, root first, the revocations it acknowledges,
by name, and the acting actor, on an actor host's envelope only. -/
structure Authority where
  caps : List Hash
  acks : List Hash
  actor : Option DocId
  deriving DecidableEq, Repr

/-- The Value's keys, `acks`, `caps` and `actor` in UTF-8. -/
def acksKey : Bytes := [97, 99, 107, 115]
def capsKey : Bytes := [99, 97, 112, 115]
def actorKey : Bytes := [97, 99, 116, 111, 114]

#guard acksKey == "acks".toUTF8.toList && capsKey == "caps".toUTF8.toList && actorKey == "actor".toUTF8.toList

/-- The Value the body carries under `authority`, keys in the codec's order: `acks`, `caps`, then `actor` if any. -/
def Authority.value (a : Authority) : Value :=
  .map ([(acksKey, .array (a.acks.map Hash.value)), (capsKey, .array (a.caps.map Hash.value))] ++
    (a.actor.map fun d => (actorKey, d.hash.value)).toList)

/-- A name: 32 bytes. -/
def nameValue? : Value → Option Hash
  | .bytes b => if b.length = 32 then some ⟨b⟩ else none
  | _ => none

/-- A list of names. -/
def namesValue? : Value → Option (List Hash)
  | .array vs => vs.mapM nameValue?
  | _ => none

/-- A Doc: its 32-byte id. -/
def docValue? (v : Value) : Option DocId := (nameValue? v).map fun h => ⟨h⟩

/-- The chain and the acknowledgements, each a list of names, with the actor read beside them. -/
def Authority.ofParts (a c : Value) (actor : Option DocId) : Option Authority := do
  some ⟨← namesValue? c, ← namesValue? a, actor⟩

/-- The authority a body carries: exactly `acks` and `caps`, or exactly `acks`, `caps` and `actor`, in the codec's
order, each a list of names and the actor a Doc. -/
def Authority.ofValue? : Value → Option Authority
  | .map [(k₁, a), (k₂, c)] => if k₁ = acksKey ∧ k₂ = capsKey then Authority.ofParts a c none else none
  | .map [(k₁, a), (k₂, c), (k₃, d)] =>
    if k₁ = acksKey ∧ k₂ = capsKey ∧ k₃ = actorKey then (docValue? d).bind fun x => Authority.ofParts a c (some x)
    else none
  | _ => none

theorem namesValue?_map : ∀ {l : List Hash}, (∀ x ∈ l, x.bytes.length = 32) →
    namesValue? (.array (l.map Hash.value)) = some l
  | [], _ => rfl
  | x :: xs, h => by
    have hx := h x (List.mem_cons_self ..)
    have ih := namesValue?_map (l := xs) fun y m => h y (List.mem_cons_of_mem _ m)
    simp only [namesValue?, List.map_cons, List.mapM_cons] at ih ⊢
    simp [Hash.value, nameValue?, hx, ih]

/-- A Value written reads back, for names and an actor of 32 bytes. -/
theorem Authority.ofValue?_value (a : Authority) (h : ∀ x ∈ a.caps ++ a.acks, x.bytes.length = 32)
    (hd : ∀ d ∈ a.actor, d.hash.bytes.length = 32) : Authority.ofValue? a.value = some a := by
  obtain ⟨caps, acks, actor⟩ := a
  have hc := namesValue?_map (l := caps) fun x m => h x (List.mem_append_left _ m)
  have ha := namesValue?_map (l := acks) fun x m => h x (List.mem_append_right _ m)
  cases actor with
  | none => simp [Authority.ofValue?, Authority.value, Authority.ofParts, hc, ha]
  | some d =>
    have hdl : d.hash.bytes.length = 32 := hd d rfl
    simp [Authority.ofValue?, Authority.value, Authority.ofParts, hc, ha, docValue?, Hash.value, nameValue?, hdl]

theorem mapM_mem {α β : Type} {f : α → Option β} :
    ∀ {l : List α} {r : List β}, l.mapM f = some r → ∀ x ∈ r, ∃ a ∈ l, f a = some x
  | [], r, h, x, m => by
    simp only [List.mapM_nil, pure, Option.some.injEq] at h
    subst h
    simp at m
  | a :: as, r, h, x, m => by
    rw [List.mapM_cons] at h
    cases hf : f a with
    | none => simp [hf] at h
    | some b =>
      cases hl : as.mapM f with
      | none => simp [hf, hl] at h
      | some bs =>
        simp only [hf, hl, Option.bind_eq_bind, Option.bind_some, pure, Option.some.injEq] at h
        subst h
        rcases List.mem_cons.mp m with e | m
        · exact ⟨a, List.mem_cons_self .., e ▸ hf⟩
        · obtain ⟨a', ma', ha'⟩ := mapM_mem hl x m
          exact ⟨a', List.mem_cons_of_mem _ ma', ha'⟩

theorem nameValue?_value {v : Value} {x : Hash} (h : nameValue? v = some x) : x.value = v ∧ x.bytes.length = 32 := by
  unfold nameValue? at h
  split at h
  · split at h
    · cases h; exact ⟨rfl, by assumption⟩
    · cases h
  · cases h

/-- A list of names reads back only from the Value it writes. -/
theorem namesValue?_value : ∀ {vs : List Value} {l : List Hash}, vs.mapM nameValue? = some l → l.map Hash.value = vs
  | [], l, h => by
    simp only [List.mapM_nil, pure, Option.some.injEq] at h
    subst h
    rfl
  | v :: vs, l, h => by
    rw [List.mapM_cons] at h
    cases hf : nameValue? v with
    | none => simp [hf] at h
    | some x =>
      cases hl : vs.mapM nameValue? with
      | none => simp [hf, hl] at h
      | some xs =>
        simp only [hf, hl, Option.bind_eq_bind, Option.bind_some, pure, Option.some.injEq] at h
        subst h
        simp [(nameValue?_value hf).1, namesValue?_value hl]

theorem namesValue?_len {v : Value} {l : List Hash} (h : namesValue? v = some l) : ∀ x ∈ l, x.bytes.length = 32 := by
  unfold namesValue? at h
  split at h
  · intro x m
    obtain ⟨v', _, hv⟩ := mapM_mem h x m
    exact (nameValue?_value hv).2
  · cases h

theorem docValue?_value {v : Value} {d : DocId} (h : docValue? v = some d) :
    d.hash.value = v ∧ d.hash.bytes.length = 32 := by
  unfold docValue? at h
  cases hn : nameValue? v with
  | none => simp [hn] at h
  | some x =>
    simp only [hn, Option.map_some, Option.some.injEq] at h
    subst h
    exact ⟨(nameValue?_value hn).1, (nameValue?_value hn).2⟩

/-- What the parts read back to: the lists they were written from, the actor beside them, and only 32-byte names. -/
theorem Authority.ofParts_some {a c : Value} {act : Option DocId} {x : Authority}
    (h : Authority.ofParts a c act = some x) :
    Value.array (x.acks.map Hash.value) = a ∧ Value.array (x.caps.map Hash.value) = c ∧ x.actor = act ∧
      ∀ y ∈ x.caps ++ x.acks, y.bytes.length = 32 := by
  unfold Authority.ofParts at h
  cases hc : namesValue? c with
  | none => simp [hc] at h
  | some cs =>
    cases ha : namesValue? a with
    | none => simp [hc, ha] at h
    | some as =>
      simp only [hc, ha, Option.bind_eq_bind, Option.bind_some, Option.some.injEq] at h
      subst h
      refine ⟨?_, ?_, rfl, fun y m => ?_⟩
      · unfold namesValue? at ha
        split at ha
        · simp [namesValue?_value ha]
        · cases ha
      · unfold namesValue? at hc
        split at hc
        · simp [namesValue?_value hc]
        · cases hc
      · rcases List.mem_append.mp m with m | m
        · exact namesValue?_len hc y m
        · exact namesValue?_len ha y m

/-- What reads back is written exactly so: each shape of the authority's Value has one form. -/
theorem Authority.value_ofValue? {v : Value} {a : Authority} (h : Authority.ofValue? v = some a) : a.value = v := by
  unfold Authority.ofValue? at h
  split at h
  · split at h
    · rename_i keys
      obtain ⟨e₁, e₂⟩ := keys
      subst e₁ e₂
      obtain ⟨ha, hc, hact, -⟩ := Authority.ofParts_some h
      simp [Authority.value, ha, hc, hact]
    · cases h
  · split at h
    · rename_i keys
      obtain ⟨e₁, e₂, e₃⟩ := keys
      subst e₁ e₂ e₃
      rename_i vd
      cases hd : docValue? vd with
      | none => simp [hd] at h
      | some d =>
        simp only [hd, Option.bind_some] at h
        obtain ⟨ha, hc, hact, -⟩ := Authority.ofParts_some h
        simp [Authority.value, ha, hc, hact, (docValue?_value hd).1]
    · cases h
  · cases h

/-- What reads back names only 32-byte names, and a 32-byte actor. -/
theorem Authority.ofValue?_names {v : Value} {a : Authority} (h : Authority.ofValue? v = some a) :
    (∀ x ∈ a.caps ++ a.acks, x.bytes.length = 32) ∧ ∀ d ∈ a.actor, d.hash.bytes.length = 32 := by
  unfold Authority.ofValue? at h
  split at h
  · split at h
    · obtain ⟨-, -, hact, hn⟩ := Authority.ofParts_some h
      exact ⟨hn, by simp [hact]⟩
    · cases h
  · split at h
    · rename_i vd _
      cases hd : docValue? vd with
      | none => simp [hd] at h
      | some d =>
        simp only [hd, Option.bind_some] at h
        obtain ⟨-, -, hact, hn⟩ := Authority.ofParts_some h
        exact ⟨hn, by simp [hact, (docValue?_value hd).2]⟩
    · cases h
  · cases h

/-- What caps reads of envelopes whose bodies carry their authority: the vault each writes for, and the chain and
acknowledgements each body names. A body that names none rests on its vault's own authority and acknowledges nothing. -/
def Reads.ofAuthority (vault : Envelope → String) (auth : Envelope → Option Authority) : Reads :=
  { vault, caps := fun e => ((auth e).map (·.caps)).getD [], acks := fun e => ((auth e).map (·.acks)).getD [] }

theorem Reads.ofAuthority_caps {vault : Envelope → String} {auth : Envelope → Option Authority} {e : Envelope}
    {a : Authority} (h : auth e = some a) :
    (Reads.ofAuthority vault auth).caps e = a.caps ∧ (Reads.ofAuthority vault auth).acks e = a.acks := by
  simp [Reads.ofAuthority, h]

/-- The actor an envelope's body names (A27, A188), as a reader's `actorOf` reads it: none unless its authority has the
actor host's shape. -/
def Authority.actorOf (auth : Envelope → Option Authority) (e : Envelope) : Option DocId := (auth e).bind (·.actor)

#guard Authority.ofValue? (Authority.value ⟨[⟨List.replicate 32 1⟩], [], none⟩) =
  some ⟨[⟨List.replicate 32 1⟩], [], none⟩
#guard Authority.ofValue? (Authority.value ⟨[⟨List.replicate 31 1⟩], [], none⟩) = none
#guard Canon (Authority.value ⟨[⟨List.replicate 32 1⟩, ⟨List.replicate 32 2⟩], [⟨List.replicate 32 3⟩], none⟩)

namespace AuthorityExamples

/-- A name for the examples: the hash of a word. -/
def nm (s : String) : Hash := blake3 s.toUTF8.toList

/-- Values under `authority`, each with what caps reads of it, written by hand (`authority.json`). Every one is a
canonical Value, so each is refused here, by its shape, and never by the codec. -/
def cases : List (String × Value × Option Authority) := [
  ("on its vault's own authority: no caps, no acks", (⟨[], [], none⟩ : Authority).value, some ⟨[], [], none⟩),
  ("a chain of two caps, root first", (⟨[nm "root cap", nm "device cap"], [], none⟩ : Authority).value,
    some ⟨[nm "root cap", nm "device cap"], [], none⟩),
  ("one cap and two revocations acknowledged",
    (⟨[nm "cap"], [nm "revocation 1", nm "revocation 2"], none⟩ : Authority).value,
    some ⟨[nm "cap"], [nm "revocation 1", nm "revocation 2"], none⟩),
  ("an actor host's envelope: a chain of one cap, naming its actor (A188)",
    (⟨[nm "host cap"], [], some ⟨nm "actor"⟩⟩ : Authority).value, some ⟨[nm "host cap"], [], some ⟨nm "actor"⟩⟩),
  ("caps without acks", .map [(capsKey, .array [(nm "cap").value])], none),
  ("a third key that isn't the actor",
    .map [(acksKey, .array []), (capsKey, .array []), ("more".toUTF8.toList, .array [])], none),
  ("an actor without caps", .map [(acksKey, .array []), (actorKey, (nm "actor").value)], none),
  ("an actor of 31 bytes", .map [(acksKey, .array []), (capsKey, .array []), (actorKey, .bytes (List.replicate 31 1))],
    none),
  ("an actor as text", .map [(acksKey, .array []), (capsKey, .array []), (actorKey, .text "actor".toUTF8.toList)],
    none),
  ("a fourth key after the actor", .map [(acksKey, .array []), (capsKey, .array []),
    (actorKey, (nm "actor").value), ("zzzzz".toUTF8.toList, .array [])], none),
  ("a name of 31 bytes", .map [(acksKey, .array []), (capsKey, .array [.bytes (List.replicate 31 1)])], none),
  ("a name of 33 bytes", .map [(acksKey, .array [.bytes (List.replicate 33 1)]), (capsKey, .array [])], none),
  ("a name as text", .map [(acksKey, .array []), (capsKey, .array [.text "cap".toUTF8.toList])], none),
  ("caps as one name, not a list", .map [(acksKey, .array []), (capsKey, (nm "cap").value)], none),
  ("an empty map", .map [], none),
  ("a list, not a map", .array [], none),
  ("null", .null, none)]

#guard cases.all fun (_, v, a) => Authority.ofValue? v == a
#guard cases.all fun (_, v, _) => Canon v

end AuthorityExamples

end Aven.ID
