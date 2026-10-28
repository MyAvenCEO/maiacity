import AvenDB.Gate

/-!
# Whom the server's relay lets in by a pass

A device the server doesn't know yet, a browser with no UDP of its own, reaches the server only through its relay, and
the relay lets it in for ten minutes by a pass its person's passkey signed (`sign::RelayPass`). Whose passes it honours
follows the gate (`Gate.lean`): what the server keeps decides whom it lets in, so the relay's minutes open to the same
people the server takes.

The server signs people up in one of three ways (`Signup`, `AVENDB_SIGNUP`):

- `anyone`: it honours a pass of any passkey, so a person's first device founds their vault through it (P8e);
- `invited`: it honours a pass of a passkey that roots a vault it knows, or one shown with an invite of `home` that no
  vault claimed yet, for the newcomer whose device claims it in those minutes (`Node::claim_invite`);
- `known`: it honours a pass of a passkey that roots a vault it knows, and no other.

While nobody has claimed the server (P8f) it honours any pass, for the device that claims it. With the gate on, a vault
the server knows is one it welcomed (G2), so under `invited` the relay lets in by a pass only the passkeys of vaults the
gate took, and newcomers who hold an open invite (G5). The model abstracts the pass's signatures and its ten minutes as
`sign::RelayPass` checks them: what it decides is whose pass counts.
-/

namespace AvenDB

/-- How the server signs people up: any passkey's pass, a known vault's or an open invite's, or a known vault's alone. -/
inductive Signup where
  | anyone
  | invited
  | known
  deriving DecidableEq, Repr

/-- The passkeys that root a vault in `st`: whose passes count as a vault the server knows (`Lab::roots`). -/
def roots (st : State) : List SignerId := st.vaults.filterMap (·.root)

/-- Share `c` is an invite of `home` that no vault claimed yet: a live share over `home` to an invite key
    (`world::open_invite`). -/
def openInvite (st : State) (home : VaultId) (c : ShareId) : Bool :=
  st.live c && (st.share? c).any fun x => x.over == home && x.who.invite?.isSome

/-- The relay of the server of `home`, knowing `st` and signing people up as `s` says, honours a pass of passkey
    `passkey` shown with invite `invite`, if any: any while nobody has claimed the server (`claimable`) or under
    `anyone`; one that roots a vault the server knows; and under `invited`, one shown with an open invite of `home`
    (`Admission::honours`). -/
def honours (st : State) (home : VaultId) (s : Signup) (claimable : Bool) (passkey : SignerId)
    (invite : Option ShareId) : Bool :=
  claimable || s == .anyone || (roots st).contains passkey || (s == .invited && invite.any (openInvite st home))

namespace Admitting

/-- G5 (the relay follows the gate): a server that signs people up by invite, once claimed, honours a pass only of a
    passkey that roots a vault it knows, or one shown with an invite of `home` that no vault claimed yet. -/
theorem invited_only {st : State} {home : VaultId} {p : SignerId} {i : Option ShareId}
    (h : honours st home .invited false p i = true) :
    (roots st).contains p = true ∨ ∃ c, i = some c ∧ openInvite st home c = true := by
  unfold honours at h
  simp only [Bool.false_or, Bool.or_eq_true, beq_iff_eq, reduceCtorEq, false_or, Bool.and_eq_true,
    true_and] at h
  rcases h with h | h
  · exact .inl h
  · cases i with
    | none => simp at h
    | some c => exact .inr ⟨c, rfl, by simpa using h⟩

/-- G5, closed: a server that signs nobody up, once claimed, honours a pass only of a passkey that roots a vault it
    knows, whatever invite it is shown with. -/
theorem known_only {st : State} {home : VaultId} {p : SignerId} {i : Option ShareId}
    (h : honours st home .known false p i = true) : (roots st).contains p = true := by
  unfold honours at h
  simpa using h

/-- G5, an invite used: once a claim of share `c` is accepted, it is no open invite, so no pass shown with it counts for
    a passkey the server doesn't know. -/
theorem claimed_closed {st : State} {home : VaultId} {c : ShareId} {x : Share} (hx : st.share? c = some x)
    (hw : x.who.invite? = none) : openInvite st home c = false := by
  unfold openInvite
  simp [hx, hw]

end Admitting

end AvenDB
