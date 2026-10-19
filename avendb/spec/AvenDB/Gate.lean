import AvenDB.Claims

/-!
# Who the server takes

Anyone can make a key and sign a genesis with it: key generation can't be stopped. What the server of a vault (avenMAIA,
the device of Maia City's aven) takes onto what it holds can. It takes a new vault only where it welcomes it, in what it
knows once it holds the batch the vault came in (`welcomes`):

- the vault it serves (`home`);
- a human vault that holds a share of `home`, which is the invite it claimed in that batch, or that owns `home`;
- a coop or an aven that a founder owns, directly or through its owners: `home` itself, a vault that owns `home`, or
  one holding a share of `home`'s cap group named Founder (`isFounder`), which only admins get;
- a device vault, which its owner governs and the server took before.

From a batch it drops the geneses of the new vaults it doesn't welcome, again until none is left to drop, and takes the
rest; where a vault it would take stays unwelcome, a genesis it held already that the batch lets stand, it takes nothing
of the batch (`takes`). G1: an invite is claimed once. G2: every vault new to what the server knows is one it welcomes.
-/

namespace AvenDB

/-- The name of the cap group of `home` whose holders may found coops and avens there. -/
def founderName : String := "Founder"

/-- Vault `u` holds a live share of vault `home`. -/
def holdsAny (st : State) (home u : VaultId) : Bool :=
  st.shares.any fun cp => cp.over == home && holdsShare st u cp .read

/-- Vault `u` holds a live share of vault `home` naming one of `home`'s cap groups whose name, in force, is `name`. -/
def holdsGroup (st : State) (home u : VaultId) (name : String) : Bool :=
  st.shares.any fun cp => cp.over == home && holdsShare st u cp .read && match cp.group with
    | some g => (groupAt st home g).any (·.name == name)
    | none => false

/-- Vault `u` may found coops and avens on the server of `home`: it is `home`, it owns `home`, or it holds `home`'s
    Founder group. -/
def isFounder (st : State) (home u : VaultId) : Bool :=
  u == home || owns st u home || holdsGroup st home u founderName

/-- The server of `home` welcomes vault `v` in `st`. -/
def welcomes (st : State) (home v : VaultId) : Bool :=
  v == home ||
  match st.vault? v with
  | none => false
  | some vt =>
    match vt.kind with
    | .human => holdsAny st home v || owns st v home
    | .coop | .aven => st.vaults.any fun u => isFounder st home u.id && owns st u.id v
    | .deviceVault => true

/-- The vaults a peer knows holding `edits ++ b` that it didn't know holding `edits`. -/
def newVaults (edits b : List Edit) : List VaultId :=
  ((view (edits ++ b)).vaults.map (·.id)).filter fun v => ((view edits).vault? v).isNone

/-- One pass of the gate: batch `b` without the geneses of the vaults new to what the server knows that it doesn't
    welcome there. -/
def dropUnwelcome (home : VaultId) (edits b : List Edit) : List Edit :=
  let st := view (edits ++ b)
  let bad := (newVaults edits b).filter fun v => !welcomes st home v
  b.filter fun e => match e.action with
    | .genesis v .. => !bad.contains v
    | _ => true

def admitN (home : VaultId) (edits : List Edit) : Nat → List Edit → List Edit
  | 0, b => b
  | n + 1, b => admitN home edits n (dropUnwelcome home edits b)

/-- What the server of `home`, holding `edits`, takes of batch `batch`: the batch without the geneses it doesn't welcome,
    once no pass drops more (a pass drops a genesis or ends it, so `batch.length` passes do), if it then welcomes every
    new vault; nothing otherwise. -/
def takes (home : VaultId) (edits batch : List Edit) : Option (List Edit) :=
  let b := admitN home edits batch.length batch
  if (newVaults edits b).all (welcomes (view (edits ++ b)) home) then some b else none

/-! ## G1: an invite is claimed once -/

namespace Gating

/-- A share found by its id has that id. -/
theorem share?_id' {st : State} {c : ShareId} {x : Share} (h : st.share? c = some x) : x.id = c := by
  simpa using List.find?_some h

/-- G1 (an invite is claimed once): once a claim of share `c` is accepted, the share names the claiming vault, and no
    claim of it is accepted again, whoever signs it. -/
theorem claim_once {st post : State} {sigs : List SignerId} {author : SignerId} {c : ShareId} {v : VaultId}
    {via : List VaultId} (h : applyClaim st sigs author c v via = some post) :
    (∃ x, post.share? c = some x ∧ x.who = .vault v) ∧
      ∀ sigs' author' v' via', applyClaim post sigs' author' c v' via' = none := by
  obtain ⟨x, k, hx, hw, -, -, -, -, -, rfl⟩ := applyClaim_some h
  have hid := share?_id' hx
  have hc : x.claimed c v = { x with who := .vault v } := by
    unfold Share.claimed
    simp [hid, hw, Who.invite?]
  have hpost : (st.claimShare c v).share? c = some { x with who := .vault v } := by
    rw [claimShare_share?, hx, Option.map_some, hc]
  refine ⟨⟨_, hpost, rfl⟩, fun sigs' author' v' via' => ?_⟩
  unfold applyClaim
  rw [hpost]

/-! ## G2: the server takes only vaults it welcomes -/

theorem dropUnwelcome_sublist (home : VaultId) (edits b : List Edit) : (dropUnwelcome home edits b).Sublist b :=
  List.filter_sublist

/-- A pass drops geneses alone. -/
theorem dropUnwelcome_genesis {home : VaultId} {edits b : List Edit} {e : Edit} (he : e ∈ b)
    (hn : e ∉ dropUnwelcome home edits b) : ∃ v k os t r, e.action = .genesis v k os t r := by
  unfold dropUnwelcome at hn
  rw [List.mem_filter, not_and] at hn
  have := hn he
  split at this
  · exact ⟨_, _, _, _, _, by assumption⟩
  · exact absurd rfl this

theorem admitN_sublist (home : VaultId) (edits : List Edit) :
    ∀ n b, (admitN home edits n b).Sublist b
  | 0, _ => .refl _
  | n + 1, b => (admitN_sublist home edits n _).trans (dropUnwelcome_sublist home edits b)

/-- What the gate leaves out of a batch is geneses alone. -/
theorem admitN_genesis (home : VaultId) (edits : List Edit) :
    ∀ n b e, e ∈ b → e ∉ admitN home edits n b → ∃ v k os t r, e.action = .genesis v k os t r
  | 0, _, _, he, hn => absurd he hn
  | n + 1, b, e, he, hn => by
    by_cases hd : e ∈ dropUnwelcome home edits b
    · exact admitN_genesis home edits n _ e hd hn
    · exact dropUnwelcome_genesis he hd

/-- G2 (the server takes only vaults it welcomes): what the server of `home` takes of a batch is the batch without some
    of its geneses, and every vault new to what it knows once it holds them is one it welcomes there: a human vault
    only with a share of `home`, the invite it claimed, a coop or an aven only owned by a founder. -/
theorem takes_welcome {home : VaultId} {edits batch b : List Edit} (h : takes home edits batch = some b) :
    b.Sublist batch ∧ (∀ e ∈ batch, e ∉ b → ∃ v k os t r, e.action = .genesis v k os t r) ∧
      ∀ v ∈ newVaults edits b, welcomes (view (edits ++ b)) home v = true := by
  unfold takes at h
  dsimp only at h
  by_cases hall : (newVaults edits (admitN home edits batch.length batch)).all
      (welcomes (view (edits ++ admitN home edits batch.length batch)) home) = true
  · simp only [hall, ↓reduceIte] at h
    cases h
    exact ⟨admitN_sublist home edits _ _, fun e he hn => admitN_genesis home edits _ _ e he hn,
      fun v hv => List.all_eq_true.1 hall v hv⟩
  · simp [hall] at h

/-- G2, a human vault: the server welcomes a human vault other than `home` only where it holds a share of `home` or owns
    `home`. -/
theorem human {st : State} {home v : VaultId} {vt : Vault} (hv : st.vault? v = some vt) (hk : vt.kind = .human)
    (hne : v ≠ home) (h : welcomes st home v = true) : holdsAny st home v = true ∨ owns st v home = true := by
  unfold welcomes at h
  simp only [hv, hk, Bool.or_eq_true, beq_iff_eq, hne, false_or] at h
  exact h

/-- G2, a coop or an aven: the server welcomes one other than `home` only where a founder owns it. -/
theorem founded {st : State} {home v : VaultId} {vt : Vault} (hv : st.vault? v = some vt)
    (hk : vt.kind = .coop ∨ vt.kind = .aven) (hne : v ≠ home) (h : welcomes st home v = true) :
    ∃ u ∈ st.vaults, isFounder st home u.id = true ∧ owns st u.id v = true := by
  unfold welcomes at h
  simp only [hv, Bool.or_eq_true, beq_iff_eq, hne, false_or] at h
  rcases hk with hk | hk <;> rw [hk] at h <;> simpa [List.any_eq_true] using h

end Gating

end AvenDB
