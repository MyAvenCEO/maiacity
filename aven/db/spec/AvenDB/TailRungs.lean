import AvenDB.TailRuns

/-!
# A rung replays as the place it was

The proof of the replay's rungs (`Tail::rungs` in `policy.rs`, batch 5 of 2026-10-27): a device keeps, beside the
place it steps on from (`TailRuns.lean`), places before it, each with the state it kept there, so that edits a peer
made far behind, which sort before its place, replay only the edits from the last rung before them on, not every edit.

A rung is a place a replay had: its state is what the edits before it made, `kept p s₀` of the edits `p ++ s₀` it
held then. The edits taken since sort after it, so it holds `p ++ s` now, the same edits before it; and every removal
after it is a move, chosen or not. What the edits before the place make turns only on which of them are removals that
stand, on the facts those take away, and on the facts the removals after it hide (`runFrom_congr`); a move hides an
audience alone (`removes_aud`), which an inert replay hides from no edit that stands (`hinertP`), so the state kept
there is the same whatever the edits after it (`kept_rung`). Then stepping on from the rung is stepping on from a tail
there (`V4_tail_replays`): the replay of every edit (`V4_rung_replays`).

A place before a revocation or a root handed on keeps its state too where the edits after it leave the removals chosen
and what each hides from the edits before it as they were (`resolve_from_a_place`): a page of writes drafted before a
revocation replays from the mark before it, not every edit.

Nothing here bounds how far back a rung is. A replay keeps its rungs near its place as states and, further back, a
mark every 4,096 places of its order (`Marks` in `policy.rs`), as bytes its stored view keeps too: each mark is a rung,
the state the edits before it made when it was kept, so `V4_rung_replays` is the law of stepping on from it, and a late
edit costs the edits from the mark before it on, not every edit.
-/

namespace AvenDB

namespace Tails

open Stored Trusted Moves

/-- What the removals chosen among `l`, every one a move, hide from an edit, less its audiences: nothing. -/
theorem plain_hiddenAt_moves {edits rem l : List Edit} (n i : Nat) (x : Edit)
    (hm : ∀ r ∈ l, rem.any (·.id == r.id) = true → isMove r = true) :
    plain (hiddenAt (cutsAt edits rem l n) i x) = [] := by
  unfold plain
  refine List.filter_eq_nil_iff.2 fun f hf => ?_
  unfold hiddenAt at hf
  obtain ⟨c, hc, hfc⟩ := List.mem_flatMap.1 hf
  obtain ⟨⟨r, j⟩, hrj, hsome⟩ := List.mem_filterMap.1 (List.mem_filter.1 hc).1
  have hr : r ∈ l := List.fst_mem_of_mem_zipIdx hrj
  dsimp only at hsome
  split at hsome
  · rename_i hch
    obtain rfl := Option.some.inj hsome
    simp [removes_aud (hm r hr hch) edits f hfc]
  · simp at hsome

/-- **The state a rung keeps**: the edits `p` before a place, held first with `s₀` after them and now with `s`, every
    removal chosen after the place a move then and now, the same removals chosen among `p` taking away what they took,
    and the replay inert then and now, make the same before it. -/
theorem kept_rung {p s₀ s : List Edit}
    (hrem : ∀ x ∈ p, (resolve (p ++ s)).any (·.id == x.id) = (resolve (p ++ s₀)).any (·.id == x.id))
    (hrm : ∀ r ∈ p, (resolve (p ++ s₀)).any (·.id == r.id) = true → removes (p ++ s) r = removes (p ++ s₀) r)
    (hm₀ : ∀ r ∈ s₀, (resolve (p ++ s₀)).any (·.id == r.id) = true → isMove r = true)
    (hm : ∀ r ∈ s, (resolve (p ++ s)).any (·.id == r.id) = true → isMove r = true)
    (hi₀ : runFrom (resolve (p ++ s₀)) (stripTail (p ++ s₀) (resolve (p ++ s₀)) p s₀) {} p.zipIdx = kept p s₀)
    (hi : runFrom (resolve (p ++ s)) (stripTail (p ++ s) (resolve (p ++ s)) p s) {} p.zipIdx = kept p s) :
    kept p s = kept p s₀ := by
  rw [← hi, ← hi₀]
  refine runFrom_congr _ _ _ _ {} p.zipIdx fun q hq => ⟨?_, ?_⟩
  · exact hrem q.1 (List.fst_mem_of_mem_zipIdx hq)
  · unfold stripTail
    rw [hiddenAt_append', hiddenAt_append', hiddenAt_strip, hiddenAt_strip, plain_hiddenAt_moves _ _ _ hm,
      plain_hiddenAt_moves _ _ _ hm₀, cutsAt_congr hrem hrm]

/-- **Resolve from a place** (Goal 9, 2026-10-29; written, not yet built): what the edits `p` before a place make
    turns only on which of them are removals that stand and on what the removals chosen after them hide from each of
    them, not on whether those are moves. So a place before a revocation or a root handed on keeps its state where the
    edits after it changed neither: none of the new edits says who may do what or is a removal, so the same removals
    are chosen (`V2_removals_read_trust`) and each takes away what it took (`removes` reads the grants alone). That is
    `on_rung`'s rung or mark before the last revocation in `policy.rs`, which `kept_rung` (every removal after the
    place a move) left out: 45 replays of every edit on one Mac's catch-up, a page drafted before a revocation each. -/
theorem resolve_from_a_place {p s₀ s : List Edit}
    (hrem : ∀ x ∈ p, (resolve (p ++ s)).any (·.id == x.id) = (resolve (p ++ s₀)).any (·.id == x.id))
    (hhid : ∀ q ∈ p.zipIdx, hiddenAt (stripTail (p ++ s) (resolve (p ++ s)) p s) q.2 q.1 =
      hiddenAt (stripTail (p ++ s₀) (resolve (p ++ s₀)) p s₀) q.2 q.1)
    (hi₀ : runFrom (resolve (p ++ s₀)) (stripTail (p ++ s₀) (resolve (p ++ s₀)) p s₀) {} p.zipIdx = kept p s₀)
    (hi : runFrom (resolve (p ++ s)) (stripTail (p ++ s) (resolve (p ++ s)) p s) {} p.zipIdx = kept p s) :
    kept p s = kept p s₀ := by
  rw [← hi, ← hi₀]
  exact runFrom_congr _ _ _ _ {} p.zipIdx fun q hq => ⟨hrem q.1 (List.fst_mem_of_mem_zipIdx hq), hhid q hq⟩

/-- **V4r (a late page replays from a rung)**: a device that kept, at a place it had, `p` before it, the state `k`
    the edits `p ++ s₀` it held then made there, and holds `p ++ s` now, every removal after the place a move, and
    receives edits `fresh` that sort after it, knows what replaying every edit would tell it by replaying only `s'`
    from `k`, where stepping on from a tail at that place would (`V4_tail_replays`). -/
theorem V4_rung_replays (held fresh p s₀ s s' : List Edit) (k : State) (hk : (kept p s₀).1 = k)
    (hrem : ∀ x ∈ p, (resolve (p ++ s)).any (·.id == x.id) = (resolve (p ++ s₀)).any (·.id == x.id))
    (hrm₀ : ∀ r ∈ p, (resolve (p ++ s₀)).any (·.id == r.id) = true → removes (p ++ s) r = removes (p ++ s₀) r)
    (hm₀ : ∀ r ∈ s₀, (resolve (p ++ s₀)).any (·.id == r.id) = true → isMove r = true)
    (hm : ∀ r ∈ s, (resolve (p ++ s)).any (·.id == r.id) = true → isMove r = true)
    (hi₀ : runFrom (resolve (p ++ s₀)) (stripTail (p ++ s₀) (resolve (p ++ s₀)) p s₀) {} p.zipIdx = kept p s₀)
    (ho : order held = p ++ s) (ho' : order (held ++ fresh) = p ++ s')
    (hids : ((p ++ s).map Edit.id).Nodup) (hids' : ((p ++ s').map Edit.id).Nodup)
    (hrems : s'.filter Edit.isRemoval = s.filter Edit.isRemoval)
    (hmoves : ∀ x ∈ s, x.isRemoval = true → x.action.isTrust = false)
    (hchosen : ∀ x ∈ s, x.isRemoval = true → x ∈ resolve (p ++ s))
    (hcands : cands (p ++ s') = cands (p ++ s))
    (hrm : ∀ r ∈ p ++ s, r.isRemoval = true → removes (p ++ s') r = removes (p ++ s) r)
    (hstands : ∀ x ∈ s, x.isRemoval = true → (tailRun p s s').2.any (·.id == x.id) = true)
    (hinertP : runFrom (resolve (p ++ s)) (stripTail (p ++ s) (resolve (p ++ s)) p s) {} p.zipIdx = kept p s)
    (hinertT : runFrom (resolve (p ++ s)) (strip (cutsAt (p ++ s') (resolve (p ++ s)) s' p.length)) (kept p s).1
      (s'.zipIdx p.length) = tailRun p s s') :
    view (held ++ fresh) =
      (runFrom (resolve (p ++ s)) (cutsAt (p ++ s') (resolve (p ++ s)) s' p.length) k (s'.zipIdx p.length)).1 := by
  have h := (V4_tail_replays held fresh p s s' ho ho' hids hids' hrems hmoves hchosen hcands hrm hstands hinertP
    hinertT).1
  rw [h]
  unfold tailRun
  rw [kept_rung hrem hrm₀ hm₀ hm hi₀ hinertP, hk]

end Tails

end AvenDB
