/-!
# A page of posts, off the index of each vault

The Universe reads the posts everyone may read, the newest first, a page at a time (`posts`, the query entry
`query-posts`, A3). Each vault's posts are rows of its shared index, ordered by their creation (`QueryView.lean`'s
window order, keyed by the creation, then the entry), so a page is read with a keyset cursor: the `n` newest posts
older than the last one shown (`before`), never a position counted from the newest.

A device holds the posts of many vaults. It reads at most `n` of each vault's posts after the cursor, off that
vault's index, and takes the page from those alone. That loses nothing: a post on the page of all the vaults is on
the page of its own vault (`P1_part`, `P1_parts`), since fewer posts lie above it there. And it shows nothing too
new: every post on a page after a cursor is older than the cursor (`P3_cursor`), so the next page never repeats one.
A page is taken from what each part gave by the same rule (`P2_within`): a post on the page of all is on the page of
the parts' pages. The authors and the files a post shows are read for the page's posts alone; they decide nothing
here.

Keys are natural numbers: a greater key is a newer post. Rust: `avendb::world::posts_page` (a page of candidates)
and `avendb-net`'s `posts_page` (the candidates off each vault's index and the tail after it).
-/

namespace AvenDB.PostsPage

/-- Key `x` comes after cursor `k`: older than it, or any key where there is no cursor. -/
def before (k : Option Nat) (x : Nat) : Bool :=
  match k with
  | none => true
  | some c => decide (x < c)

/-- The keys of `S` newer than `x` and after cursor `k`: those a page shows above `x`. -/
def above (k : Option Nat) (S : List Nat) (x : Nat) : List Nat :=
  S.filter (fun y => decide (x < y) && before k y)

/-- Key `x` is on the page of `n` keys of `S` after cursor `k`: it is in `S`, after the cursor, and fewer than `n`
keys of `S` after the cursor are newer. -/
def onPage (n : Nat) (k : Option Nat) (S : List Nat) (x : Nat) : Bool :=
  S.contains x && before k x && decide ((above k S x).length < n)

/-- What a part gives: its keys on its own page. -/
def page (n : Nat) (k : Option Nat) (S : List Nat) : List Nat :=
  S.filter (onPage n k S)

theorem above_append (k : Option Nat) (A B : List Nat) (x : Nat) :
    above k (A ++ B) x = above k A x ++ above k B x := by
  simp [above, List.filter_append]

/-- **P1** A key on the page of two parts together is on the page of the part that holds it. -/
theorem P1_part (n : Nat) (k : Option Nat) (A B : List Nat) (x : Nat)
    (h : onPage n k (A ++ B) x = true) (hx : x ∈ A) : onPage n k A x = true := by
  simp only [onPage, Bool.and_eq_true, decide_eq_true_eq] at h ⊢
  refine ⟨⟨?_, h.1.2⟩, ?_⟩
  · simpa using hx
  · have := h.2
    rw [above_append, List.length_append] at this
    omega

theorem P1_part_right (n : Nat) (k : Option Nat) (A B : List Nat) (x : Nat)
    (h : onPage n k (A ++ B) x = true) (hx : x ∈ B) : onPage n k B x = true := by
  simp only [onPage, Bool.and_eq_true, decide_eq_true_eq] at h ⊢
  refine ⟨⟨?_, h.1.2⟩, ?_⟩
  · simpa using hx
  · have := h.2
    rw [above_append, List.length_append] at this
    omega

/-- **P1** for any number of parts: a key on the page of all the vaults is on the page of one of them, the one
that holds it. -/
theorem P1_parts (n : Nat) (k : Option Nat) :
    ∀ (parts : List (List Nat)) (x : Nat), onPage n k parts.flatten x = true →
      ∃ p ∈ parts, onPage n k p x = true
  | [], x, h => by simp [onPage] at h
  | p :: ps, x, h => by
    have hin : x ∈ p ++ ps.flatten := by
      simp only [onPage, Bool.and_eq_true, List.contains_iff_mem] at h
      simpa using h.1.1
    rw [List.flatten_cons] at h
    rcases List.mem_append.mp hin with hp | hps
    · exact ⟨p, by simp, P1_part n k p _ x h hp⟩
    · obtain ⟨q, hq, hq'⟩ := P1_parts n k ps x (P1_part_right n k p _ x h hps)
      exact ⟨q, by simp [hq], hq'⟩

/-- A key on a part's page is in the part's page list. -/
theorem mem_page (n : Nat) (k : Option Nat) (S : List Nat) (x : Nat) (h : onPage n k S x = true) :
    x ∈ page n k S := by
  simp only [page, List.mem_filter]
  refine ⟨?_, h⟩
  simp only [onPage, Bool.and_eq_true, List.contains_iff_mem] at h
  exact h.1.1

theorem page_sublist (n : Nat) (k : Option Nat) (S : List Nat) : (page n k S).Sublist S :=
  List.filter_sublist

theorem above_sublist (k : Option Nat) {S T : List Nat} (h : S.Sublist T) (x : Nat) :
    (above k S x).Sublist (above k T x) :=
  h.filter _

/-- **P2** A key on the page of two parts is on the page of their pages: the page taken from what each part gave
keeps it, and nothing the parts dropped puts it off. -/
theorem P2_within (n : Nat) (k : Option Nat) (A B : List Nat) (x : Nat)
    (h : onPage n k (A ++ B) x = true) : onPage n k (page n k A ++ page n k B) x = true := by
  have hx : x ∈ A ++ B := by
    simp only [onPage, Bool.and_eq_true, List.contains_iff_mem] at h
    exact h.1.1
  have hin : x ∈ page n k A ++ page n k B := by
    rcases List.mem_append.mp hx with ha | hb
    · exact List.mem_append_left _ (mem_page n k A x (P1_part n k A B x h ha))
    · exact List.mem_append_right _ (mem_page n k B x (P1_part_right n k A B x h hb))
  have hsub : (page n k A ++ page n k B).Sublist (A ++ B) :=
    (page_sublist n k A).append (page_sublist n k B)
  have hle := (above_sublist k hsub x).length_le
  simp only [onPage, Bool.and_eq_true, decide_eq_true_eq, List.contains_iff_mem] at h ⊢
  exact ⟨⟨hin, h.1.2⟩, Nat.lt_of_le_of_lt hle h.2⟩

/-- **P3** Every key on a page after cursor `c` is older than `c`: the next page never shows the cursor or a key
newer than it again. -/
theorem P3_cursor (n : Nat) (c : Nat) (S : List Nat) (x : Nat) (h : onPage n (some c) S x = true) : x < c := by
  simp only [onPage, before, Bool.and_eq_true, decide_eq_true_eq] at h
  exact h.1.2

/-- A page holds at most `n` keys where no key is held twice. -/
theorem page_le (n : Nat) (k : Option Nat) (S : List Nat) (x : Nat) (h : onPage n k S x = true) :
    (above k S x).length < n := by
  simp only [onPage, Bool.and_eq_true, decide_eq_true_eq] at h
  exact h.2

-- two vaults, the newest three, then the three after key 6
#guard page 3 none ([9, 4, 1] ++ [8, 6, 2]) = [9, 8, 6]
#guard page 3 none (page 3 none [9, 4, 1] ++ page 3 none [8, 6, 2]) = [9, 8, 6]
#guard page 3 (some 6) ([9, 4, 1] ++ [8, 6, 2]) = [4, 1, 2]
#guard page 3 (some 6) (page 3 (some 6) [9, 4, 1] ++ page 3 (some 6) [8, 6, 2]) = [4, 1, 2]

end AvenDB.PostsPage
