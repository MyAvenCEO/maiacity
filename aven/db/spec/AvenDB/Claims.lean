import AvenDB.Props

/-!
# Claims

What a claim does (`applyClaim`): it turns the one share that names an invite key into the claiming vault's, and changes
nothing else: no vault, no entry, no write, no key, and no share but that one, whose every other field stays.
-/

namespace AvenDB

/-- An accepted claim of share `c` by vault `v`: the share was live and named an invite key, which signed; the edit's
    author acts for `v` through the owners it names; `v` is a vault there is, other than the one the share is over; and
    the share names `v` now. -/
theorem applyClaim_some {st post : State} {sigs : List SignerId} {author : SignerId} {c : ShareId} {v : VaultId}
    {via : List VaultId} (h : applyClaim st sigs author c v via = some post) :
    ∃ x k, st.share? c = some x ∧ x.who = .invite k ∧ st.live c = true ∧ k ∈ sigs ∧
      actsVia st author via v = true ∧ (st.vault? v).isSome = true ∧ v ≠ x.over ∧ post = st.claimShare c v := by
  unfold applyClaim at h
  cases hx : st.share? c with
  | none => simp [hx] at h
  | some x =>
    rw [hx] at h
    dsimp only at h
    cases hw : x.who with
    | invite k =>
      rw [hw] at h
      dsimp only at h
      split at h
      · cases h
      · rename_i h1
        split at h
        · cases h
        · rename_i h2
          cases h
          simp only [Bool.or_eq_true, Bool.not_eq_true', not_or, Bool.not_eq_false, List.contains_iff_mem] at h1
          simp only [Bool.or_eq_true, not_or, Bool.not_eq_true, Option.isNone_eq_false_iff, beq_eq_false_iff_ne,
            ne_eq] at h2
          exact ⟨x, k, rfl, hw, h1.1.1, h1.1.2, h1.2, h2.1, h2.2, rfl⟩
    | vault _ => rw [hw] at h; cases h
    | everyone => rw [hw] at h; cases h
    | device _ => rw [hw] at h; cases h

@[simp] theorem claimed_id (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).id = x.id := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_over (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).over = x.over := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_level (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).level = x.level := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_wide (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).wide = x.wide := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_select (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).select = x.select := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_ops (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).ops = x.ops := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_parent (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).parent = x.parent := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_issuer (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).issuer = x.issuer := by
  unfold Share.claimed; split <;> rfl
@[simp] theorem claimed_group (c : ShareId) (v : VaultId) (x : Share) : (x.claimed c v).group = x.group := by
  unfold Share.claimed; split <;> rfl

/-- A claim leaves every share that names no invite key as it is. -/
theorem claimed_self {c : ShareId} {v : VaultId} {x : Share} (h : x.who.invite? = none) : x.claimed c v = x := by
  unfold Share.claimed; simp [h]

/-- A share a claim changed named an invite key, and names the claiming vault now. -/
theorem claimed_who (c : ShareId) (v : VaultId) (x : Share) :
    (x.claimed c v).who = x.who ∨ (x.who.invite?.isSome = true ∧ x.id = c ∧ (x.claimed c v).who = .vault v) := by
  unfold Share.claimed
  split
  · rename_i h
    simp only [Bool.and_eq_true, beq_iff_eq] at h
    exact .inr ⟨h.2, h.1, rfl⟩
  · exact .inl rfl

/-- A claim names a vault, so a share it changed names no device, as before. -/
@[simp] theorem claimed_isDevice (c : ShareId) (v : VaultId) (x : Share) :
    (x.claimed c v).who.isDevice = x.who.isDevice := by
  unfold Share.claimed
  split
  · rename_i h
    simp only [Bool.and_eq_true] at h
    cases hw : x.who <;> simp_all [Who.invite?, Who.isDevice, Who.device?]
  · rfl

/-- A share that names a device after a claim is the share it was. -/
theorem claimed_device {c : ShareId} {v : VaultId} {x : Share} {d : SignerId} (h : (x.claimed c v).who = .device d) :
    x.claimed c v = x := by
  revert h
  unfold Share.claimed
  split
  · intro h; cases h
  · intro _; rfl

/-- A share that names everyone after a claim is the share it was. -/
theorem claimed_everyone {c : ShareId} {v : VaultId} {x : Share} (h : (x.claimed c v).who = .everyone) :
    x.claimed c v = x := by
  revert h
  unfold Share.claimed
  split
  · intro h; cases h
  · intro _; rfl

/-- A claim leaves everything but the shares as it was. -/
theorem claimShare_vaults (st : State) (c : ShareId) (v : VaultId) : (st.claimShare c v).vaults = st.vaults := rfl
theorem claimShare_shares (st : State) (c : ShareId) (v : VaultId) :
    (st.claimShare c v).shares = st.shares.map (Share.claimed c v) := rfl
theorem claimShare_revoked (st : State) (c : ShareId) (v : VaultId) : (st.claimShare c v).revoked = st.revoked := rfl
theorem claimShare_entries (st : State) (c : ShareId) (v : VaultId) : (st.claimShare c v).entries = st.entries := rfl
theorem claimShare_writes (st : State) (c : ShareId) (v : VaultId) : (st.claimShare c v).writes = st.writes := rfl

/-- A claim keeps every share's id, in order. -/
theorem claimShare_ids (st : State) (c : ShareId) (v : VaultId) :
    (st.claimShare c v).shares.map (·.id) = st.shares.map (·.id) := by
  simp [claimShare_shares, List.map_map, Function.comp_def]

/-- A claim keeps which shares are live. -/
theorem claimShare_live (st : State) (c : ShareId) (v : VaultId) : (st.claimShare c v).live = st.live := by
  funext x
  simp [State.live, claimShare_shares, claimShare_revoked, List.any_map, Function.comp_def]

/-- Looking a share up after a claim finds it as the claim left it. -/
theorem claimShare_share? (st : State) (c : ShareId) (v : VaultId) (x : ShareId) :
    (st.claimShare c v).share? x = (st.share? x).map (Share.claimed c v) := by
  simp only [State.share?, claimShare_shares, List.find?_map]
  congr 1
  simp [Function.comp_def]

end AvenDB
