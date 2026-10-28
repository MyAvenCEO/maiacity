import AvenDB.State

/-!
# Agents as sessions on their person's device

An agent on a Mac (agentClaude, agentCodex, …) is a device of its coop's aven, avenMAIA for Maia City, with a key of its
own. It runs no node of its own: its person's device (theOS's) keeps the one store, the one copy of each log and the
one replay, and serves the agent as a session (Samuel 2026-10-21: "plan them as session (but using our system cap
groups logic)"; the aven's rights come from Maia City's cap groups, every session of the aven holding all of them).

Nothing of the rules changes. A session's write is an edit its own key signs, as every device's: its host prepares it
on its replay and hands it to the session to sign, and every peer checks it by its author, the session's key, against
what the aven may do, as before. The host neither signs for the session nor gives it any right of its own.

What changes is who reads for it. A session holds no keys of the vaults' audiences: its host opens the entries for it,
and its host is its person's device, which opens more than the aven may read (its person's own vault, everything the
person owns). So a session reads an entry only where its own key opens it too (`sessionOpens`): never more than a
device of its aven reads (`sessionOpens_session`), never more than its host (`sessionOpens_host`), and, where the host
opens all the session opens, as its person's device opens all of its coop and so all the coop shares with its aven,
exactly what a device of the aven of its own would read (`sessionOpens_eq`).
-/

namespace AvenDB

/-- Device `d` opens entry `en`: it opens the current key of the entry's audience, and the entry's key in its current
    stay at that audience's epoch. -/
def opensEntry (st : State) (d : SignerId) (en : Entry) : Bool :=
  knows st [.signer d] (st.curKey (.audience en.vault en.audience)) && knows st [.signer d] (entryKey st en)

/-- Session `s` on host device `host` reads entry `en`: the host opens it, and so does the session's own key. -/
def sessionOpens (st : State) (host s : SignerId) (en : Entry) : Bool :=
  opensEntry st host en && opensEntry st s en

/-- A session reads no entry its own key doesn't open: nothing its host holds beyond its aven's reach. -/
theorem sessionOpens_session {st : State} {host s : SignerId} {en : Entry} (h : sessionOpens st host s en = true) :
    opensEntry st s en = true := by
  simp only [sessionOpens, Bool.and_eq_true] at h
  exact h.2

/-- A session reads only what its host holds open: it reads off its host's one replay, and nowhere else. -/
theorem sessionOpens_host {st : State} {host s : SignerId} {en : Entry} (h : sessionOpens st host s en = true) :
    opensEntry st host en = true := by
  simp only [sessionOpens, Bool.and_eq_true] at h
  exact h.1

/-- Where the host opens every entry the session's key opens, the session reads exactly what a device of its aven of
    its own would. -/
theorem sessionOpens_eq {st : State} {host s : SignerId} {en : Entry}
    (covers : opensEntry st s en = true → opensEntry st host en = true) :
    sessionOpens st host s en = opensEntry st s en := by
  unfold sessionOpens
  cases hs : opensEntry st s en with
  | false => simp
  | true => simp [covers hs]

/-- The entries a session reads among `st`'s, in their order: those its own key opens, kept where its host opens them. -/
def sessionReadable (st : State) (host s : SignerId) : List EntryId :=
  (st.entries.filter (sessionOpens st host s)).map (·.id)

/-- Where its host covers it, a session's entries are those a device of its aven of its own reads, in the same order. -/
theorem sessionReadable_eq {st : State} {host s : SignerId}
    (covers : ∀ en ∈ st.entries, opensEntry st s en = true → opensEntry st host en = true) :
    sessionReadable st host s = (st.entries.filter (opensEntry st s)).map (·.id) := by
  unfold sessionReadable
  congr 1
  apply List.filter_congr
  intro en hen
  exact sessionOpens_eq (covers en hen)

end AvenDB
