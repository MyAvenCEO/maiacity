import Aven.ID.Revoke

/-! # What an envelope says of its authority (A45; caps, "Checking")

An envelope's body carries, under its key `authority`, the one Value caps reads of it (A45, agreed with the docs
threads): the chain the envelope rests on, by its caps' names, root first and empty on its vault's own authority; and
the revocations its writer acknowledges, by their names (`Aven.ID.Revoke`). The docs layer carries the Value without
reading it (`Aven.DB.Docs.Body`); what it holds is caps', and `Aven.Architecture` holds the reader's reads to it.

```
authority: {"acks": [name…], "caps": [name…]}
  caps:  the caps the envelope rests on, root first; [] on its vault's own authority
  acks:  the revocations its writer acknowledges
```

Keys sort as the codec sorts them, `acks` before `caps`. Each name is 32 bytes: a cap's (`Cap.digest`, A30) or a
revocation's (`Revocation.digest`). A reader takes them as Revoke's `Reads` (`Reads.ofAuthority`), so the chain an
envelope names is the one every revocation is checked against, and nothing about a write's authority is stored twice.

- `ofValue?_value`: a Value written reads back, for names of 32 bytes;
- `value_ofValue?`: what reads back is written exactly so: the Value has one form;
- `ofValue?_names`: what reads back names only 32-byte names. -/

namespace Aven.ID

open Aven.Core

/-- What an envelope's body says of its authority: the chain it rests on, root first, and the revocations it
acknowledges, by name. -/
structure Authority where
  caps : List Hash
  acks : List Hash
  deriving DecidableEq, Repr

/-- The Value's keys, `acks` and `caps` in UTF-8. -/
def acksKey : Bytes := [97, 99, 107, 115]
def capsKey : Bytes := [99, 97, 112, 115]

#guard acksKey == "acks".toUTF8.toList && capsKey == "caps".toUTF8.toList

/-- The Value the body carries under `authority`, keys in the codec's order: `acks` before `caps`. -/
def Authority.value (a : Authority) : Value :=
  .map [(acksKey, .array (a.acks.map Hash.value)), (capsKey, .array (a.caps.map Hash.value))]

/-- A name: 32 bytes. -/
def nameValue? : Value → Option Hash
  | .bytes b => if b.length = 32 then some ⟨b⟩ else none
  | _ => none

/-- A list of names. -/
def namesValue? : Value → Option (List Hash)
  | .array vs => vs.mapM nameValue?
  | _ => none

/-- The authority a body carries: exactly the two keys, in the codec's order, each a list of names. -/
def Authority.ofValue? : Value → Option Authority
  | .map [(k₁, a), (k₂, c)] => if k₁ = acksKey ∧ k₂ = capsKey then do some ⟨← namesValue? c, ← namesValue? a⟩ else none
  | _ => none

theorem namesValue?_map : ∀ {l : List Hash}, (∀ x ∈ l, x.bytes.length = 32) →
    namesValue? (.array (l.map Hash.value)) = some l
  | [], _ => rfl
  | x :: xs, h => by
    have hx := h x (List.mem_cons_self ..)
    have ih := namesValue?_map (l := xs) fun y m => h y (List.mem_cons_of_mem _ m)
    simp only [namesValue?, List.map_cons, List.mapM_cons] at ih ⊢
    simp [Hash.value, nameValue?, hx, ih]

/-- A Value written reads back, for names of 32 bytes. -/
theorem Authority.ofValue?_value (a : Authority) (h : ∀ x ∈ a.caps ++ a.acks, x.bytes.length = 32) :
    Authority.ofValue? a.value = some a := by
  have hc := namesValue?_map (l := a.caps) fun x m => h x (List.mem_append_left _ m)
  have ha := namesValue?_map (l := a.acks) fun x m => h x (List.mem_append_right _ m)
  simp [Authority.ofValue?, Authority.value, hc, ha]

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

/-- What reads back is written exactly so: the authority's Value has one form. -/
theorem Authority.value_ofValue? {v : Value} {a : Authority} (h : Authority.ofValue? v = some a) : a.value = v := by
  unfold Authority.ofValue? at h
  split at h
  · rename_i k₁ va k₂ vc
    split at h
    · rename_i keys
      obtain ⟨e₁, e₂⟩ := keys
      subst e₁ e₂
      cases hc : namesValue? vc with
      | none => simp [hc] at h
      | some cs =>
        cases ha : namesValue? va with
        | none => simp [hc, ha] at h
        | some as =>
          simp only [hc, ha, Option.bind_eq_bind, Option.bind_some, Option.some.injEq] at h
          subst h
          unfold namesValue? at hc ha
          split at hc
          · split at ha
            · simp [Authority.value, namesValue?_value hc, namesValue?_value ha]
            · cases ha
          · cases hc
    · cases h
  · cases h

theorem namesValue?_len {v : Value} {l : List Hash} (h : namesValue? v = some l) : ∀ x ∈ l, x.bytes.length = 32 := by
  unfold namesValue? at h
  split at h
  · intro x m
    obtain ⟨v', _, hv⟩ := mapM_mem h x m
    exact (nameValue?_value hv).2
  · cases h

/-- What reads back names only 32-byte names. -/
theorem Authority.ofValue?_names {v : Value} {a : Authority} (h : Authority.ofValue? v = some a) :
    ∀ x ∈ a.caps ++ a.acks, x.bytes.length = 32 := by
  unfold Authority.ofValue? at h
  split at h
  · rename_i k₁ va k₂ vc
    split at h
    · cases hc : namesValue? vc with
      | none => simp [hc] at h
      | some cs =>
        cases ha : namesValue? va with
        | none => simp [hc, ha] at h
        | some as =>
          simp only [hc, ha, Option.bind_eq_bind, Option.bind_some, Option.some.injEq] at h
          subst h
          intro x m
          rcases List.mem_append.mp m with m | m
          · exact namesValue?_len hc x m
          · exact namesValue?_len ha x m
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

#guard Authority.ofValue? (Authority.value ⟨[⟨List.replicate 32 1⟩], []⟩) = some ⟨[⟨List.replicate 32 1⟩], []⟩
#guard Authority.ofValue? (Authority.value ⟨[⟨List.replicate 31 1⟩], []⟩) = none
#guard Canon (Authority.value ⟨[⟨List.replicate 32 1⟩, ⟨List.replicate 32 2⟩], [⟨List.replicate 32 3⟩]⟩)

namespace AuthorityExamples

/-- A name for the examples: the hash of a word. -/
def nm (s : String) : Hash := blake3 s.toUTF8.toList

/-- Values under `authority`, each with what caps reads of it, written by hand (`authority.json`). Every one is a
canonical Value, so each is refused here, by its shape, and never by the codec. -/
def cases : List (String × Value × Option Authority) := [
  ("on its vault's own authority: no caps, no acks", (⟨[], []⟩ : Authority).value, some ⟨[], []⟩),
  ("a chain of two caps, root first", (⟨[nm "root cap", nm "device cap"], []⟩ : Authority).value,
    some ⟨[nm "root cap", nm "device cap"], []⟩),
  ("one cap and two revocations acknowledged",
    (⟨[nm "cap"], [nm "revocation 1", nm "revocation 2"]⟩ : Authority).value,
    some ⟨[nm "cap"], [nm "revocation 1", nm "revocation 2"]⟩),
  ("caps without acks", .map [(capsKey, .array [(nm "cap").value])], none),
  ("a third key", .map [(acksKey, .array []), (capsKey, .array []), ("more".toUTF8.toList, .array [])], none),
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
