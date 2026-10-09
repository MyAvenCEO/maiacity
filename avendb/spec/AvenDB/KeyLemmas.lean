import AvenDB.Props

/-!
# Keys

The proofs of the key theorems (T5, T6, T7, T24), stated as in `Theorems.lean`.
-/

namespace AvenDB.Keys

theorem T5_confidentiality (edits : List Edit) (h : Holder) (k : KeyFam) (e : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.scoped k e)) : EverReads (trace {} edits) h k := by
  sorry

theorem T6_forward_secrecy {st : State} (hr : Reachable st) (h : Holder) {k : KeyFam} (hkf : k ∈ keyFams st)
    (hk : Knows st (h.start st) (st.curKey k)) : MayOpen st h k := by
  sorry

theorem T7_blind_server (edits : List Edit) (srv : SignerId)
    (hblind : ∀ v, EverReads (trace {} edits) (.signer srv) (.seed v) →
      ∀ st ∈ trace {} edits, ∀ k, readsV st v k = true → k.vault = v)
    {k : KeyFam} (hk : ¬ EverReads (trace {} edits) (.signer srv) (.seed k.vault)) {e : Nat}
    (h : Knows (replay {} edits) [.signer srv] (.scoped k e)) : ∃ st ∈ trace {} edits, publicKey st k = true := by
  sorry

theorem T24_entry_keys {st : State} (hr : Reachable st) (h : Holder) {en : Entry} (hen : en ∈ st.entries)
    (hk : Knows st (h.start st) (entryKey st en)) : MayOpen st h (.cell en.vault en.cell) := by
  sorry

theorem T24_entry_history (edits : List Edit) (h : Holder) (e : EntryId) (s : Option EditId) (g : Nat)
    (hk : Knows (replay {} edits) (h.start (replay {} edits)) (.entry e s g)) :
    ∃ st ∈ trace {} edits, ∃ en ∈ st.entries, en.id = e ∧
      ∃ x ∈ en.stays.map (·.2), EverReads (trace {} edits) h (.cell en.vault x) := by
  sorry

end AvenDB.Keys
