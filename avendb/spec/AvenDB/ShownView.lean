/-!
# Showings kept on the shelf

What a device shows of an entry (its items and its history) is judged from the entry's writes in their order, the
bodies of them it opened, its vault's lane and the cap groups in force (`Inputs`), and from nothing else (`show`). The
device hashes those into the entry's print (`print`, the Rust "lab shown" hash in `show_items`). A device keeps each
entry's showing on its shelf as a content-addressed blob under its print (`Kept`), so the next time it opens it takes
the showing whose print is the print of the entry's inputs as they are then, and judges anew only the entries whose
print changed (`openShown`). This is the index gate (`ShelfIndex.lean`) for a derivation that is no fold over the log:
the print plays the stamp.

- SV1: where no two inputs have one print (`Sound`), taking an honest kept showing gives the showing judged anew,
  whether its print matches or not (`SV1_open`); with none kept, it judges anew (`SV1_open_none`).
- SV2: whatever a crash leaves, the showing the device finds is one it kept, or none (a torn blob reads as none); every
  one it ever kept is honest, so it opens the showing judged anew (`SV2_crash`), of every entry at once (`SV2_vault`).
- SV3: a device keeps only what judged an entry whole: not a showing judged in part, whose tip covers fewer of its writes
  (a budgeted step, `Showing::part`), nor one written from an owner's base overlay rather than judged of the log
  (`store.based`), nor one judged against a replay that lags the log (mid catch-up, `Lab::standing`). So every showing it
  keeps is honest (`SV3_keep_honest`), and SV2 holds of what it keeps (`SV3_open_kept`).
-/

namespace AvenDB.ShownView

variable {W L G P S : Type}

/-- What judging an entry reads: its writes in their order, which of them it opened the bodies of, its vault's lane
    and the cap groups in force. -/
structure Inputs (W L G : Type) where
  writes : List W
  opened : W → Bool
  lane : L
  groups : G

/-- A showing kept on the shelf: the print it is kept under and what it shows. -/
structure Kept (P S : Type) where
  print : P
  shown : S

/-- No two inputs have one print: the print is a hash with no collision. -/
def Sound (print : Inputs W L G → P) : Prop :=
  ∀ a b, print a = print b → a = b

/-- A kept showing is honest: it is the showing judged anew of inputs whose print it is kept under. -/
def Honest (judge : Inputs W L G → S) (print : Inputs W L G → P) (k : Kept P S) : Prop :=
  ∃ i, k.print = print i ∧ k.shown = judge i

/-- What a device opens of an entry: the kept showing where its print is the print of the entry's inputs now, else
    the showing judged anew. -/
def openShown [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P) (now : Inputs W L G) :
    Option (Kept P S) → S
  | some k => if k.print = print now then k.shown else judge now
  | none => judge now

/-- SV1: taking an honest kept showing gives the showing judged anew. -/
theorem SV1_open [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P) (hs : Sound print)
    (now : Inputs W L G) (k : Kept P S) (hk : Honest judge print k) :
    openShown judge print now (some k) = judge now := by
  obtain ⟨i, hp, hsh⟩ := hk
  simp only [openShown]
  split
  · rename_i h
    rw [hsh, hs _ _ (hp.symm.trans h)]
  · rfl

theorem SV1_open_none [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P) (now : Inputs W L G) :
    openShown judge print now none = judge now := rfl

/-- SV2: whatever a crash leaves of what the device kept, it opens the showing judged anew. -/
theorem SV2_crash [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P) (hs : Sound print)
    (kept : List (Kept P S)) (hk : ∀ k ∈ kept, Honest judge print k) (found : Option (Kept P S))
    (hf : ∀ k, found = some k → k ∈ kept) (now : Inputs W L G) :
    openShown judge print now found = judge now := by
  cases found with
  | none => rfl
  | some k => exact SV1_open judge print hs now k (hk k (hf k rfl))

/-- SV2 of a vault: each entry opened by what the device found kept of it is each entry judged anew. -/
theorem SV2_vault {E : Type} [DecidableEq P] (judge : Inputs W L G → S) (print : Inputs W L G → P) (hs : Sound print)
    (kept : List (Kept P S)) (hk : ∀ k ∈ kept, Honest judge print k) (entries : List E)
    (inputs : E → Inputs W L G) (found : E → Option (Kept P S)) (hf : ∀ e k, found e = some k → k ∈ kept) :
    entries.map (fun e => openShown judge print (inputs e) (found e)) = entries.map (fun e => judge (inputs e)) := by
  apply List.map_congr_left
  intro e _
  exact SV2_crash judge print hs kept hk (found e) (hf e) (inputs e)

/-- How a showing came to be: judged of the first `upTo` of the entry's writes (fewer where a budget cut it), written
    from an owner's base overlay or not, and against a replay that stood for the whole log or lagged it. -/
structure Made where
  upTo : Nat
  based : Bool
  standing : Bool

/-- What judging made: the showing judged anew of the inputs with only the writes it got to. A showing written from a
    base overlay is some other showing (`overlay`), no judgment of the log. -/
def made (judge : Inputs W L G → S) (overlay : Inputs W L G → S) (i : Inputs W L G) (m : Made) : S :=
  if m.based then overlay i else judge { i with writes := i.writes.take m.upTo }

/-- Whether a device keeps a showing it made: only of every write, of the log, against the replay of the whole log. -/
def keeps (i : Inputs W L G) (m : Made) : Bool :=
  decide (i.writes.length ≤ m.upTo) && !m.based && m.standing

/-- SV3: every showing a device keeps is honest, kept under the print of the inputs it judged. -/
theorem SV3_keep_honest (judge : Inputs W L G → S) (overlay : Inputs W L G → S) (print : Inputs W L G → P)
    (i : Inputs W L G) (m : Made) (hk : keeps i m = true) :
    Honest judge print ⟨print i, made judge overlay i m⟩ := by
  simp only [keeps, Bool.and_eq_true, decide_eq_true_eq, Bool.not_eq_true'] at hk
  obtain ⟨⟨hlen, hb⟩, _⟩ := hk
  refine ⟨i, rfl, ?_⟩
  simp only [made, hb, Bool.false_eq_true, ite_false, List.take_of_length_le hlen]

/-- SV3 then SV2: opening what a device kept, by these rules, of any inputs now, is the showing judged anew. -/
theorem SV3_open_kept [DecidableEq P] (judge : Inputs W L G → S) (overlay : Inputs W L G → S)
    (print : Inputs W L G → P) (hs : Sound print) (i : Inputs W L G) (m : Made) (hk : keeps i m = true)
    (now : Inputs W L G) :
    openShown judge print now (some ⟨print i, made judge overlay i m⟩) = judge now :=
  SV1_open judge print hs now _ (SV3_keep_honest judge overlay print i m hk)

end AvenDB.ShownView
