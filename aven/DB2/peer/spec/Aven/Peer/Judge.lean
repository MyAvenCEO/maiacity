/-!
# The judge's worker: finding what crashed it

Loro can panic on bytes it should have refused, and wasm32 aborts on a panic, so in the browser the docs layer runs
in a docs worker of its own, one for all open Docs (db/docs/README.md, "Importing", (c); the architect, 31 Oct 2026).
When that worker dies on a page, the page may hold an envelope that kills the judge, or the worker may have died of
something passing (out of memory, a tab killed): one envelope must never be marked unfit for the second.

So the Peer-Light **sifts** the page: a fresh worker, reopened from the store, takes the page's envelopes again one at
a time, in order, each after the ones before it that went through. An envelope that crashes the worker alone is
recorded unfit, by its name, in this device's own store, and is never judged, counted, forwarded or served again; the
worker restarts, and the sifting goes on with the next. The record is local and never travels: another reader judges
for itself (rule 4).

What it proves:
- `sift_alone`: an envelope is marked unfit only when it crashed alone, after exactly what went through before it;
- `sift_fine`: a page whose envelopes each go through alone marks nothing, so a passing fault never marks a valid
  envelope;
- `sift_sub`, `sift_nodup`: only the page's own envelopes are marked, each once (the page's envelopes are distinct).
-/

namespace Aven.Peer.Judge

/-- What one run of the judge did. -/
inductive Run where
  | done
  | crashed
  deriving DecidableEq, Repr

/-- Sifting a page that crashed the judge: `run held e` is what a fresh worker does with `e` after `held` went
through. Returns what is marked unfit, in the page's order. -/
def sift {α : Type} (run : List α → α → Run) : List α → List α → List α
  | _, [] => []
  | held, e :: rest =>
    match run held e with
    | .crashed => e :: sift run held rest
    | .done => sift run (held ++ [e]) rest

variable {α : Type} {run : List α → α → Run}

/-- **Only alone:** whatever is marked crashed a fresh worker alone, after what went through before it. -/
theorem sift_alone : ∀ {held page : List α} {e : α}, e ∈ sift run held page → ∃ h, run h e = .crashed
  | _, [], _, m => by simp [sift] at m
  | held, x :: rest, e, m => by
    unfold sift at m
    split at m
    · next hx =>
      rcases List.mem_cons.mp m with rfl | m
      · exact ⟨held, hx⟩
      · exact sift_alone m
    · exact sift_alone m

/-- **A passing fault marks nothing:** when every envelope goes through alone, nothing is unfit. -/
theorem sift_fine (fine : ∀ h e, run h e = .done) : ∀ (held page : List α), sift run held page = []
  | _, [] => rfl
  | held, e :: rest => by simp [sift, fine, sift_fine fine]

/-- **Only the page's own:** nothing outside the page is marked. -/
theorem sift_sub : ∀ {held page : List α} {e : α}, e ∈ sift run held page → e ∈ page
  | _, [], _, m => by simp [sift] at m
  | held, x :: rest, e, m => by
    unfold sift at m
    split at m
    · rcases List.mem_cons.mp m with rfl | m
      · exact List.mem_cons_self ..
      · exact List.mem_cons_of_mem _ (sift_sub m)
    · exact List.mem_cons_of_mem _ (sift_sub m)

/-- **Each once:** a page of distinct envelopes has each marked at most once. -/
theorem sift_nodup : ∀ {held page : List α}, page.Nodup → (sift run held page).Nodup
  | _, [], _ => List.nodup_nil
  | held, x :: rest, nd => by
    have ⟨nx, nr⟩ := List.nodup_cons.mp nd
    unfold sift
    split
    · exact List.nodup_cons.mpr ⟨fun m => nx (sift_sub m), sift_nodup nr⟩
    · exact sift_nodup nr

/-! ## Examples -/

/-- Envelope 2 kills the judge whatever went before; 4 only after 3 went through. -/
def example_run (held : List Nat) (e : Nat) : Run :=
  if e = 2 ∨ (e = 4 ∧ 3 ∈ held) then .crashed else .done

#guard sift example_run [] [1, 2, 3, 4, 5] = [2, 4]
#guard sift example_run [] [1, 4, 3] = []
#guard sift (fun _ _ => Run.done) [] [1, 2, 3] = []

end Aven.Peer.Judge
