import Aven.Core

/-! # The safe (D17; R13)

A vault's safe holds its secrets: the device's own keys, the vault's keys, its groups' keys, the Doc keys it has
learned, and later passwords, API tokens and other services' credentials. It is a Doc sealed with its own key, and it
opens only inside a safe runtime: everything else holds handles and asks it to act (rule 34, and `id/caps/README.md`,
"The safe"). Its interface is `unlock`, `lock`, `sign`, `open`, `seal`, `derive`, `use` and `enroll`. Every act but
`unlock` and `lock` waits until a factor the runtime checks has unlocked the safe, and until the asker's `tell` cap
names the act (the safe's rules 3 and 4, D16).

What leaves the safe is a term: a secret in plain, a secret sealed to a key, a signature, a public key, an answer. An
output shows a secret outside the safe runtimes when it holds the secret in plain, or sealed to a Doc's key, since a
host may lend Doc keys to its engine. For any requests, from anyone, in any order:
- `safe_holds`: nothing leaves the safe but signatures, ciphertexts, public keys, answers and lent Doc keys: every
  secret an output shows is a Doc's key;
- `stays_inside`: the device's keys, the vault's keys and credentials never leave it, not even sealed. The vault's keys
  reach a new device only inside the safe;
- `enroll_admitted`: the safe's own key leaves only sealed to the safe runtime of a device the vault admits (the safe's
  rule 2);
- `kept_inside`: a host that keeps Doc keys inside its safe runtime gives no secret in plain (the safe's rule 5);
- `acts_on_cap` and `locked_refuses`: the safe acts only when unlocked, and only on a `tell` cap that names the act.

The cryptography, the cap check, the factors and the services are parameters, taken as sound, as Core takes
signatures. -/

namespace Aven.ID.Safe

open Aven.Core

/-- A secret the safe holds. -/
inductive Secret where
  /-- The device's own keys, made in its safe runtime and never leaving it: its safe-runtime key among them. -/
  | identity (device : String)
  /-- A vault's keys, which its keyring holds. -/
  | vault (name : String)
  /-- A group's key, which its member vaults hold. -/
  | group (name : String)
  /-- The safe's own key, which the safe is sealed with. -/
  | safe
  /-- A Doc's key at an epoch, learned from a stanza. -/
  | doc (doc : DocId) (epoch : Hash)
  /-- A password, an API token, an SSH key: another service's credential. -/
  | credential (name : String)
  deriving DecidableEq, Repr

/-- A Doc's key may be lent to the engine, in memory; identity, vault and safe keys never are (the safe's rule 5). -/
def Secret.lendable : Secret → Bool
  | .doc _ _ => true
  | .identity _ | .vault _ | .group _ | .safe | .credential _ => false

/-- The keys the safe signs with: the device's and a vault's. -/
def Secret.signer : Secret → Bool
  | .identity _ | .vault _ => true
  | .group _ | .safe | .doc _ _ | .credential _ => false

/-- What never leaves the safe through its interface, not even sealed: the device's keys, a vault's keys and
credentials. -/
def Secret.kept : Secret → Bool
  | .identity _ | .vault _ | .credential _ => true
  | .group _ | .safe | .doc _ _ => false

/-- What the safe seals to what (rule 17 and "Epochs"): a Doc's key to a reader, a vault or a group, or to the Doc's
next key (`back`), and a group's key to a member vault. Only the safe is sealed to devices, by `enroll`. -/
def Secret.sealableTo : Secret → Secret → Bool
  | .doc _ _, .vault _ | .doc _ _, .group _ | .group _, .vault _ => true
  | .doc d _, .doc d' _ => d == d'
  | _, _ => false

/-- A stanza: `inner` sealed to the public half of `to`. -/
structure Stanza where
  to : Secret
  inner : Secret
  deriving DecidableEq, Repr

/-- The safe's interface. -/
inductive Op where
  /-- Unlock with a factor the runtime checks: biometrics, or the passkey's PRF (the safe's rule 3). -/
  | unlock (factor : String)
  /-- Lock, when asked or on a timeout. -/
  | lock
  | sign (key : Secret) (msg : Bytes)
  /-- Open a stanza sealed to a key the safe holds, and keep what it seals. -/
  | open (stanza : Stanza)
  /-- Seal a secret the safe holds to a reader's key: a stanza of a key blob or a letter. -/
  | seal (to secret : Secret)
  /-- Derive a subkey of a key the safe holds, by a label: the subkey stays inside, and its public half comes out. -/
  | derive (key : Secret) (label : String)
  /-- Call a service with a credential, for an operation: an agent calls a bank's API with a token it never sees. -/
  | use (credential : String) (call : Bytes)
  /-- Seal the safe to a new device's safe runtime (the safe's rule 2). -/
  | enroll (device : String)
  deriving DecidableEq, Repr

/-- The acts behind the lock and the cap: all but `unlock` and `lock`. -/
def Op.gated : Op → Bool
  | .unlock _ | .lock => false
  | .sign .. | .open _ | .seal .. | .derive .. | .use .. | .enroll _ => true

/-- A request: who asks, and for what. -/
structure Ask where
  asker : String
  op : Op
  deriving DecidableEq, Repr

/-- What leaves the safe. -/
inductive Out where
  /-- A secret in plain. -/
  | plain (secret : Secret)
  /-- A ciphertext: `secret` sealed to the public half of `to`. -/
  | sealed (to secret : Secret)
  | signature (key : Secret) (msg : Bytes)
  /-- The public half of the subkey of `key` with `label`. -/
  | publicKey (key : Secret) (label : String)
  /-- What a service answered. -/
  | answer (bytes : Bytes)
  | done
  | refused
  deriving DecidableEq, Repr

/-- The secrets an output carries, in plain or sealed. -/
def Out.carries : Out → List Secret
  | .plain x | .sealed _ x => [x]
  | .signature .. | .publicKey .. | .answer _ | .done | .refused => []

/-- The secrets an output shows outside the safe runtimes: one in plain, or one sealed to a Doc's key, which a host may
lend to its engine. -/
def Out.shows : Out → List Secret
  | .plain x => [x]
  | .sealed to x => if to.lendable then [x] else []
  | .signature .. | .publicKey .. | .answer _ | .done | .refused => []

/-- What the safe runtime and the vault give the safe. None of it changes as the safe acts. -/
structure Runtime where
  /-- The runtime's check of a factor. -/
  unlocks : String → Bool
  /-- Whether the asker's `tell` cap names the act: the caps' verdict, checked again before the safe acts (D16). -/
  tells : String → Op → Bool
  /-- The devices the vault's settled tree admits. -/
  admitted : String → Bool
  /-- Whether the host lends Doc keys to its engine, or keeps them inside its safe runtime (the safe's rule 5). -/
  lends : Bool := true
  /-- The services the safe calls with a credential. -/
  service : String → Bytes → Bytes

/-- The safe: whether it is unlocked, and the secrets it holds. -/
structure Safe where
  unlocked : Bool := false
  holds : List Secret
  deriving DecidableEq, Repr

/-- What an unlocked safe does with an act the asker's cap names. -/
def act (r : Runtime) (s : Safe) : Op → Out × Safe
  | .sign k m => (if k.signer && s.holds.contains k then .signature k m else .refused, s)
  | .open st =>
    if s.holds.contains st.to then
      (if st.inner.lendable && r.lends then .plain st.inner else .done, { s with holds := s.holds ++ [st.inner] })
    else (.refused, s)
  | .seal to x => (if s.holds.contains x && x.sealableTo to then .sealed to x else .refused, s)
  | .derive k l => (if s.holds.contains k then .publicKey k l else .refused, s)
  | .use c call => (if s.holds.contains (.credential c) then .answer (r.service c call) else .refused, s)
  | .enroll dv => (if r.admitted dv then .sealed (.identity dv) .safe else .refused, s)
  | .unlock _ | .lock => (.refused, s)

/-- What the safe does with a request, and what it gives back. -/
def handle (r : Runtime) (s : Safe) (a : Ask) : Out × Safe :=
  match a.op with
  | .unlock f => if r.unlocks f then (.done, { s with unlocked := true }) else (.refused, s)
  | .lock => (.done, { s with unlocked := false })
  | op => if s.unlocked && r.tells a.asker op then act r s op else (.refused, s)

/-- Everything a run of requests gives back. -/
def run (r : Runtime) (s : Safe) : List Ask → List Out
  | [] => []
  | a :: as => (handle r s a).1 :: run r (handle r s a).2 as

/-- What holds of `done`, of `refused` and of every act's output holds of every output of every run. -/
theorem run_all {r : Runtime} {P : Out → Prop} (done : P .done) (refused : P .refused)
    (acts : ∀ s op, P (act r s op).1) {s : Safe} {as : List Ask} {o : Out} (m : o ∈ run r s as) : P o := by
  induction as generalizing s with
  | nil => simp [run] at m
  | cons a as ih =>
    simp only [run, List.mem_cons] at m
    rcases m with rfl | m
    · rcases a with ⟨who, op⟩
      cases op <;> simp only [handle] <;> (try split) <;> first | exact done | exact refused | exact acts _ _
    · exact ih m

theorem lendable_kept {x : Secret} (h : x.lendable = true) : x.kept = false := by
  cases x <;> first | rfl | nomatch h

theorem sealable_kept {x to : Secret} (h : x.sealableTo to = true) : x.kept = false := by
  cases x <;> cases to <;> first | rfl | nomatch h

/-- What the safe seals to a Doc's key is a Doc's key. -/
theorem sealable_shows {x to : Secret} (h : x.sealableTo to = true) (l : to.lendable = true) : x.lendable = true := by
  revert h l
  cases x <;> cases to <;> simp [Secret.sealableTo, Secret.lendable]

theorem act_shows (r : Runtime) (s : Safe) (op : Op) : ∀ x ∈ (act r s op).1.shows, x.lendable = true := by
  intro x hx
  cases op with
  | «open» st =>
    obtain ⟨to, inner⟩ := st
    simp only [act] at hx
    split at hx <;> (try split at hx) <;> simp_all [Out.shows]
  | «seal» to y =>
    simp only [act] at hx
    split at hx
    · next h =>
      simp only [Out.shows] at hx
      split at hx
      · next l =>
        simp only [List.mem_singleton] at hx
        subst hx
        simp only [Bool.and_eq_true] at h
        exact sealable_shows h.2 l
      · simp at hx
    · simp [Out.shows] at hx
  | _ => simp only [act] at hx; (try split at hx) <;> simp [Out.shows, Secret.lendable] at hx

theorem act_carries (r : Runtime) (s : Safe) (op : Op) : ∀ x ∈ (act r s op).1.carries, x.kept = false := by
  intro x hx
  cases op with
  | «open» st =>
    obtain ⟨to, inner⟩ := st
    simp only [act] at hx
    split at hx <;> (try split at hx) <;> simp_all [Out.carries, lendable_kept]
  | «seal» to y =>
    simp only [act] at hx
    split at hx
    · next h =>
      simp only [Out.carries, List.mem_singleton] at hx
      subst hx
      simp only [Bool.and_eq_true] at h
      exact sealable_kept h.2
    · simp [Out.carries] at hx
  | _ => simp only [act] at hx; (try split at hx) <;> simp_all [Out.carries, Secret.kept]

theorem act_safe (r : Runtime) (s : Safe) (op : Op) (h : Secret.safe ∈ (act r s op).1.carries) :
    ∃ dv, (act r s op).1 = .sealed (.identity dv) .safe ∧ r.admitted dv = true := by
  cases op with
  | «open» st =>
    obtain ⟨to, inner⟩ := st
    simp only [act] at h
    split at h <;> (try split at h) <;> simp only [Out.carries, List.mem_singleton, List.not_mem_nil] at h <;>
      subst h <;> simp_all [Secret.lendable]
  | «seal» to y =>
    simp only [act] at h
    split at h
    · next c =>
      simp only [Out.carries, List.mem_singleton] at h
      subst h
      simp [Secret.sealableTo] at c
    · simp [Out.carries] at h
  | enroll dv => simp only [act] at h ⊢; split at h <;> simp_all [Out.carries]
  | _ => simp only [act] at h; (try split at h) <;> simp [Out.carries] at h

theorem act_plain {r : Runtime} (keeps : r.lends = false) (s : Safe) (op : Op) (x : Secret) :
    (act r s op).1 ≠ .plain x := by
  cases op <;> simp only [act] <;> (repeat' split) <;> simp_all

/-- For any requests, from anyone, in any order, nothing leaves the safe but signatures, ciphertexts, public keys,
answers and lent Doc keys: every secret an output shows is a Doc's key. -/
theorem safe_holds {r : Runtime} {s : Safe} {as : List Ask} {o : Out} (m : o ∈ run r s as) :
    ∀ x ∈ o.shows, x.lendable = true :=
  run_all (P := fun o => ∀ x ∈ o.shows, x.lendable = true) (by simp [Out.shows]) (by simp [Out.shows])
    (act_shows r) m

/-- The device's keys, the vault's keys and credentials never leave the safe, not even sealed. -/
theorem stays_inside {r : Runtime} {s : Safe} {as : List Ask} {o : Out} (m : o ∈ run r s as) :
    ∀ x ∈ o.carries, x.kept = false :=
  run_all (P := fun o => ∀ x ∈ o.carries, x.kept = false) (by simp [Out.carries]) (by simp [Out.carries])
    (act_carries r) m

/-- The safe's own key leaves only sealed to the safe runtime of a device the vault admits. -/
theorem enroll_admitted {r : Runtime} {s : Safe} {as : List Ask} {o : Out} (m : o ∈ run r s as)
    (h : Secret.safe ∈ o.carries) : ∃ dv, o = .sealed (.identity dv) .safe ∧ r.admitted dv = true :=
  run_all (P := fun o => Secret.safe ∈ o.carries → ∃ dv, o = .sealed (.identity dv) .safe ∧ r.admitted dv = true)
    (by simp [Out.carries]) (by simp [Out.carries]) (act_safe r) m h

/-- A host that keeps Doc keys inside its safe runtime gives no secret in plain. -/
theorem kept_inside {r : Runtime} (keeps : r.lends = false) {s : Safe} {as : List Ask} {o : Out}
    (m : o ∈ run r s as) (x : Secret) : o ≠ .plain x :=
  run_all (P := fun o => ∀ x, o ≠ .plain x) (by simp) (by simp) (act_plain keeps) m x

/-- The safe acts only when unlocked, and only on a `tell` cap that names the act. -/
theorem acts_on_cap {r : Runtime} {s : Safe} {a : Ask} (g : a.op.gated = true) (h : (handle r s a).1 ≠ .refused) :
    s.unlocked = true ∧ r.tells a.asker a.op = true := by
  rcases a with ⟨who, op⟩
  cases op <;> simp only [Op.gated, Bool.false_eq_true] at g <;> simp only [handle] at h <;> split at h <;> simp_all

/-- A locked safe refuses every act. -/
theorem locked_refuses {r : Runtime} {s : Safe} (locked : s.unlocked = false) {a : Ask} (g : a.op.gated = true) :
    (handle r s a).1 = .refused :=
  Decidable.byContradiction fun h => by simp [(acts_on_cap g h).1] at locked

/-- A runtime given as lists, as the vectors give it: the factors that unlock it, the askers whose `tell` caps name
every act, the devices the vault admits, and a stand-in service that answers a call with its bytes reversed. -/
structure Listed where
  factors : List String
  askers : List String
  devices : List String
  lends : Bool := true
  deriving Repr

def Listed.runtime (l : Listed) : Runtime :=
  { unlocks := l.factors.contains, tells := fun who _ => l.askers.contains who, admitted := l.devices.contains,
    lends := l.lends, service := fun _ call => call.reverse }

namespace SafeExamples

def d1 : DocId := ⟨⟨[1]⟩⟩
def e1 : Hash := ⟨[1]⟩
def e2 : Hash := ⟨[2]⟩

/-- Alice's Mac: her face unlocks it, her agent's cap names every act, and her vault admits her phone. -/
def mac : Listed := { factors := ["face"], askers := ["alice-agent"], devices := ["alice-phone"] }

/-- A host that keeps Doc keys inside its safe runtime. -/
def strict : Listed := { mac with lends := false }

/-- Alice's safe on her Mac: the Mac's keys, her vault's, her family group's, `d1`'s key at `e2`, and her bank's
token. -/
def alicesSafe : Safe :=
  { holds := [.identity "alice-mac", .vault "alice", .group "family", .doc d1 e2, .credential "bank"] }

def byAgent (op : Op) : Ask := ⟨"alice-agent", op⟩

/-- Locked, a wrong factor, then her face; Mallory; then what may and may not be signed, opened, sealed, derived, used
and enrolled; locked again. -/
def asks : List Ask :=
  [byAgent (.sign (.vault "alice") [1]), byAgent (.unlock "pin"), byAgent (.unlock "face"),
   byAgent (.sign (.vault "alice") [1]), ⟨"mallory", .sign (.vault "alice") [1]⟩, byAgent (.sign (.doc d1 e2) [1]),
   byAgent (.open ⟨.vault "alice", .doc d1 e1⟩), byAgent (.open ⟨.vault "carol", .doc d1 e1⟩),
   byAgent (.seal (.vault "bob") (.doc d1 e1)), byAgent (.seal (.doc d1 e2) (.doc d1 e1)),
   byAgent (.seal (.vault "bob") (.group "family")), byAgent (.seal (.vault "bob") (.vault "alice")),
   byAgent (.seal (.identity "bob-phone") (.doc d1 e1)), byAgent (.seal (.doc d1 e2) (.vault "alice")),
   byAgent (.derive (.vault "alice") "app"), byAgent (.use "bank" [1, 2]), byAgent (.use "github" [1]),
   byAgent (.enroll "mallory-laptop"), byAgent (.enroll "alice-phone"), byAgent .lock, byAgent (.use "bank" [1, 2])]

/-- What the Mac gives back: `d1`'s key at `e1` is lent once opened; on the strict host only `done` comes back. -/
def macOuts (lent : Out) : List Out :=
  [.refused, .refused, .done, .signature (.vault "alice") [1], .refused, .refused, lent, .refused,
   .sealed (.vault "bob") (.doc d1 e1), .sealed (.doc d1 e2) (.doc d1 e1), .sealed (.vault "bob") (.group "family"),
   .refused, .refused, .refused, .publicKey (.vault "alice") "app", .answer [2, 1], .refused, .refused,
   .sealed (.identity "alice-phone") .safe, .done, .refused]

theorem mac_run : run mac.runtime alicesSafe asks = macOuts (.plain (.doc d1 e1)) := by decide

theorem strict_run : run strict.runtime alicesSafe asks = macOuts .done := by decide

end SafeExamples

end Aven.ID.Safe
