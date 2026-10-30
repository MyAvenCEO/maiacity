import Aven.ID.Invite

/-! # Every person signs in with their passkey

Since a browser store from an older avenOS resets once (#1474), every person needs a way back on a new browser that
is not a new invite: a second join would found a second vault for the same human. So a sign-in is open to every person
whose vault the tree holds, the claimant and every member (`Aven.ID.Invite`, "Sign-ins"). Its passkey is found by its
assertion, among the passkeys that own a person's vault here (`passkeys`), and the new browser is a device of exactly
that passkey's vault.

Theorems: a sign-in adds one device, to the signing passkey's own vault, named after it, and changes no vault there was
(`signIn_adds`); a passkey that owns no vault here can't sign in (`signIn_stranger`); a counter that doesn't count up is
refused, per passkey, and a sign-in moves only its own passkey's counter (`signIn_counts`); the door admits the new
browser (`signIn_admits`), and still admits exactly what `admits_iff` says. -/

namespace Aven.ID
namespace Members

/-- The people whose vaults the tree holds, each by their passkey, their vault and their name: the claimant, then
every member. -/
def holders (m : Members) : List (String × String × String) :=
  (m.founding.claim.map fun c => (c.passkey, c.person, c.name)).toList ++ m.joins.map fun j => (j.passkey, j.person, j.name)

/-- The passkeys that own a person's vault here. -/
def passkeys (m : Members) : List String := m.holders.map (·.1)

variable {m m' : Members}

theorem withFounding_ok {r : Except ClaimError Founding} (h : m.withFounding r = .ok m') :
    ∃ s, r = .ok s ∧ m' = { m with founding := s } ∧ m'.tree.WF := by
  unfold withFounding at h
  split at h
  · cases h
  next s =>
  split at h
  · cases h
  next hc =>
  cases h
  exact ⟨s, rfl, rfl, (Tree.check_iff _).mp hc⟩

theorem check_of_toBool {rp : Relying} {ch key : String} {a : Assertion} (h : (a.check rp ch key).toBool = true) :
    a.check rp ch key = .ok () := by
  cases e : a.check rp ch key with
  | ok u => rfl
  | error => simp [e, Except.toBool] at h

/-- The passkey `signerOf` finds made the assertion: the claimant's (`none`), or a member's join's, when the
claimant's didn't. -/
theorem signerOf_none {c : Claim} {i : SignIn} (h : m.signerOf c i = .ok none) :
    i.assertion.check m.founding.rp (challengeOf i.text) c.passkey = .ok () := by
  unfold signerOf at h
  split at h
  · next e => exact e
  · split at h <;> cases h
  · cases h

theorem signerOf_some {c : Claim} {i : SignIn} {j : Join} (h : m.signerOf c i = .ok (some j)) :
    j ∈ m.joins ∧ i.assertion.check m.founding.rp (challengeOf i.text) j.passkey = .ok () ∧
      i.assertion.check m.founding.rp (challengeOf i.text) c.passkey = .error .badSignature := by
  unfold signerOf at h
  split at h
  · cases h
  · next e =>
    split at h
    · next j' f =>
      cases h
      have t := List.find?_some f
      exact ⟨List.mem_of_find?_eq_some f, check_of_toBool t, e⟩
    · cases h
  · cases h

theorem getLastD_snoc : ∀ (a : Nat) (l : List Nat) (x : Nat), (a :: (l ++ [x])).getLast?.getD 0 = x
  | _, [], _ => rfl
  | _, b :: l, x => by
    have := getLastD_snoc b l x
    simpa [List.getLast?_cons_cons] using this

theorem counts_up {p : String} {i : SignIn} (h : ¬ m.countsBack p i = true) :
    (i.assertion.counter = 0 ∧ m.lastCounter p = 0) ∨ m.lastCounter p < i.assertion.counter := by
  simp only [countsBack, Bool.and_eq_true, Bool.or_eq_true, bne_iff_ne, ne_eq, decide_eq_true_eq] at h
  omega

theorem signedInVaults_append (x : MemberSignIn) : ∀ (seen l : List MemberSignIn),
    signedInVaults seen (l ++ [x]) = signedInVaults seen l ++ [signedInVault (seen ++ l) x]
  | seen, [] => by simp [signedInVaults]
  | seen, s :: l => by simp [signedInVaults, signedInVaults_append x (seen ++ [s]) l]

/-- What a sign-in taken did, case by case: the claimant's goes to `Aven.ID.Claim`, a member's is kept here; either way
its browser is new, its passkey made the assertion, and that passkey's counter counted up. -/
theorem acceptSignIn_cases {i : SignIn} (h : m.acceptSignIn i = .ok m') :
    ∃ c, m.founding.claim = some c ∧ m.knows [i.device] [i.deviceKey] = false ∧ m'.tree.WF ∧
      ((i.assertion.check m.founding.rp (challengeOf i.text) c.passkey = .ok () ∧
          ((i.assertion.counter = 0 ∧ m.lastCounter c.passkey = 0) ∨ m.lastCounter c.passkey < i.assertion.counter) ∧
          m' = { m with founding := { m.founding with signIns := m.founding.signIns ++ [i] } }) ∨
        ∃ j ∈ m.joins, i.assertion.check m.founding.rp (challengeOf i.text) j.passkey = .ok () ∧
          i.assertion.check m.founding.rp (challengeOf i.text) c.passkey = .error .badSignature ∧
          ((i.assertion.counter = 0 ∧ m.lastCounter j.passkey = 0) ∨ m.lastCounter j.passkey < i.assertion.counter) ∧
          m' = { m with signIns := m.signIns ++ [⟨j, i⟩] }) := by
  unfold acceptSignIn at h
  split at h
  · cases h
  next c hc =>
  split at h; · cases h
  split at h; · cases h
  next nk =>
  split at h
  · cases h
  · next sj =>
    split at h; · cases h
    next nc =>
    obtain ⟨s, e, rfl, w⟩ := withFounding_ok h
    obtain ⟨c', hc', rfl, _, _⟩ := Founding.acceptSignIn_ok e
    exact ⟨c, hc, by simpa using nk, w, .inl ⟨signerOf_none sj, counts_up nc, rfl⟩⟩
  · next j sj =>
    split at h; · cases h
    next nc =>
    split at h
    · cases h
    next hw =>
    cases h
    obtain ⟨mem, ok, bad⟩ := signerOf_some sj
    exact ⟨c, hc, by simpa using nk, (Tree.check_iff _).mp hw, .inr ⟨j, mem, ok, bad, counts_up nc, rfl⟩⟩

theorem submitSignIn_accept {sender : String} {i : SignIn} (h : m.submitSignIn sender i = .ok m') :
    m.acceptSignIn i = .ok m' := by
  unfold submitSignIn at h
  split at h; · cases h
  split at h; · cases h
  exact h

/-- The claimant's vault is the tree's first, and the coop's owner. -/
theorem founding_vaults (c : Claim) (hc : m.founding.claim = some c) :
    m.founding.vaults = ⟨c.person, c.vaultName, .person, m.founding.founders c.passkey⟩ ::
      ⟨m.founding.coop, m.founding.coopName, .coop, [.vault c.person]⟩ :: ⟨m.founding.network, networkName, .agent,
      [.vault m.founding.coop]⟩ :: ⟨m.founding.peer, peerName, .device, [.vault m.founding.network]⟩ ::
      ⟨c.device, c.browser 1, .device, [.vault c.person]⟩ ::
      m.founding.signIns.mapIdx fun k i => ⟨i.device, c.browser (k + 2), .device, [.vault c.person]⟩ := by
  simp [Founding.vaults, hc]

/-- A sign-in adds one device to the signing passkey's own vault, named after its person, and nothing else: its
passkey owns a person's vault here, the claimant's or a member's, and made the assertion; the new browser goes in
among the vaults, acts for that vault, and no vault there was changes. -/
theorem signIn_adds {sender : String} {i : SignIn} (h : m.submitSignIn sender i = .ok m') :
    ∃ p person name n, (p, person, name) ∈ m.holders ∧ i.assertion.signer = p ∧
      (∃ pre post, m.tree.vaults = pre ++ post ∧
        m'.tree.vaults = pre ++ [⟨i.device, browserName name n, .device, [.vault person]⟩] ++ post) ∧
      m'.tree.WF ∧ m'.tree.KeyOwns p person ∧ m'.tree.actsFor i.device = some person ∧
      ∀ x ∈ m.tree.ids, m'.tree.get? x = m.tree.get? x := by
  obtain ⟨c, hc, nk, w, cases⟩ := acceptSignIn_cases (submitSignIn_accept h)
  simp only [knows, Bool.or_eq_false_iff, List.any_eq_false] at nk
  have nd : i.device ∉ m.tree.ids := fun mp => nk.1 i.device mp (by simp)
  -- the browser, the person's vault and the shape of the tree, from either case
  suffices key : ∃ p person name n, (p, person, name) ∈ m.holders ∧
      i.assertion.check m.founding.rp (challengeOf i.text) p = .ok () ∧
      (⟨person, name ++ "'s vault", .person, m.founding.founders p⟩ : Vault) ∈ m'.tree.vaults ∧
      ∃ pre post, m.tree.vaults = pre ++ post ∧
        m'.tree.vaults = pre ++ [⟨i.device, browserName name n, .device, [.vault person]⟩] ++ post by
    obtain ⟨p, person, name, n, mh, ok, mp, pre, post, e, e'⟩ := key
    have old := Tree.get?_insert e e' (by simpa using nd)
    have gd := Tree.get?_of_mem w.nodup (v := ⟨i.device, browserName name n, .device, [.vault person]⟩)
      (by rw [e']; simp)
    have gp := Tree.get?_of_mem w.nodup mp
    refine ⟨p, person, name, n, mh, (check_ok ok).2.2.2.2.1, ⟨pre, post, e, e'⟩, w,
      ⟨_, gp, by simp [Founding.founders, Vault.ownerKeys, Owner.key?]⟩, ?_, old⟩
    simp [Tree.actsFor, gd, Vault.ownerVaults, Owner.vault?]
  rcases cases with ⟨ok, _, rfl⟩ | ⟨j, mj, ok, _, _, rfl⟩
  · refine ⟨c.passkey, c.person, c.name, m.founding.signIns.length + 2, by simp [holders, hc], ok, ?_,
      m.founding.vaults, m.joins.flatMap (joinedVaults m.founding) ++ signedInVaults [] m.signIns, by simp [tree, vaults],
      ?_⟩
    · simp [tree, vaults, Founding.vaults, Founding.founders, hc, Claim.vaultName]
    · simp [tree, vaults, Founding.vaults, Founding.founders, hc, List.mapIdx_append, Claim.browser] <;> rfl
  · refine ⟨j.passkey, j.person, j.name, (m.signIns.filter (·.member.person == j.person)).length + 2,
      by simp [holders]; exact .inr ⟨j, mj, rfl, rfl, rfl⟩, ok, ?_, m.tree.vaults, [], by simp, ?_⟩
    · simp only [tree, vaults, List.mem_append, List.mem_flatMap]
      exact .inl (.inr ⟨j, mj, by simp [joinedVaults]⟩)
    · simp [tree, vaults, signedInVaults_append, signedInVault]

/-- A passkey that owns no vault here can't sign in: not before its join, and never a stranger's. -/
theorem signIn_stranger {sender : String} {i : SignIn} (h : i.assertion.signer ∉ m.passkeys) :
    ∀ m', m.submitSignIn sender i ≠ .ok m' := by
  intro m' s
  obtain ⟨p, person, name, _, mh, e, _⟩ := signIn_adds s
  exact h (e ▸ List.mem_map.mpr ⟨_, mh, rfl⟩)

/-- Counters are kept per passkey: a sign-in is taken only when its passkey's counter counted up (or it and the last
are both 0, as a synced passkey keeps it), it becomes that passkey's last counter, and no other passkey's moves. -/
theorem signIn_counts {sender : String} {i : SignIn} (h : m.submitSignIn sender i = .ok m') :
    ((i.assertion.counter = 0 ∧ m.lastCounter i.assertion.signer = 0) ∨
      m.lastCounter i.assertion.signer < i.assertion.counter) ∧
    m'.lastCounter i.assertion.signer = i.assertion.counter ∧
    ∀ q, q ≠ i.assertion.signer → m'.lastCounter q = m.lastCounter q := by
  obtain ⟨c, hc, _, _, cases⟩ := acceptSignIn_cases (submitSignIn_accept h)
  rcases cases with ⟨ok, up, rfl⟩ | ⟨j, _, ok, bad, up, rfl⟩
  · have s := (check_ok ok).2.2.2.2.1
    rw [s]
    refine ⟨up, ?_, fun q nq => ?_⟩
    · simp [lastCounter, hc, Founding.lastCounter, getLastD_snoc]
    · simp [lastCounter, hc, Ne.symm nq]
  · have s := (check_ok ok).2.2.2.2.1
    rw [s]
    have ne : c.passkey ≠ j.passkey := fun e => by rw [e, ok] at bad; cases bad
    refine ⟨up, ?_, fun q nq => ?_⟩
    · simp [lastCounter, hc, ne]
    · by_cases qc : c.passkey = q
      · simp [lastCounter, hc, qc]
      · simp [lastCounter, hc, qc, Ne.symm nq]

/-- The door admits the new browser: a member's, as the coop's member, the claimant's, as the vault that owns the
coop. -/
theorem signIn_admits {sender : String} {i : SignIn} (h : m.submitSignIn sender i = .ok m') :
    m'.admits i.deviceKey = true := by
  obtain ⟨c, hc, _, w, cases⟩ := acceptSignIn_cases (submitSignIn_accept h)
  obtain ⟨p, person, name, n, mh, _, _, _, _, acts, _⟩ := signIn_adds h
  refine (admits_iff w).mpr ⟨i.device, person, ?_, acts, ?_⟩
  · rcases cases with ⟨_, _, rfl⟩ | ⟨j, _, _, _, _, rfl⟩
    · simp [publics, Founding.publics, hc]
    · simp [publics]
  · simp only [holders, hc, Option.map_some, Option.toList_some, List.mem_append, List.mem_singleton,
      Prod.mk.injEq, List.mem_map] at mh
    rcases mh with ⟨_, rfl, _⟩ | ⟨j, mj, _, rfl, _⟩
    · -- the claimant's vault owns the admin coop
      refine .inr (.inr (.owns ?_))
      have mc : (⟨m'.founding.coop, m'.founding.coopName, .coop, [.vault c.person]⟩ : Vault) ∈ m'.tree.vaults := by
        have hc' : m'.founding.claim = some c := by
          rcases cases with ⟨_, _, rfl⟩ | ⟨_, _, _, _, _, rfl⟩ <;> simpa using hc
        simp [tree, vaults, Founding.vaults, hc']
      have g := Tree.get?_of_mem w.nodup mc
      have cc : m'.coop = m'.founding.coop := rfl
      rw [cc]
      simp [Tree.Owns, Tree.ownersOf, g, Vault.ownerVaults, Owner.vault?]
    · exact .inr (.inl (by
        rcases cases with ⟨_, _, rfl⟩ | ⟨_, _, _, _, _, rfl⟩ <;>
          simp [memberOf, members, coop] <;> exact ⟨j, mj, rfl⟩))

end Members
end Aven.ID
