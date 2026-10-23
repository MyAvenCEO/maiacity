import Std

/-!
Legacy reply-pipeline accounting, not transport throughput or durable acceptance.
Ticks are monotone. The first interval begins BEFORE asking for the first page;
subsequent boundaries are observed after processing and pipelined lookahead join.
Request preparation, sparse ranges, keys and files are separate. Concurrent pulls
can overlap: summed service intervals are not device wall-clock time. Runtime
clock placement and payload classification require correspondence tests.
-/
namespace AvenDB.TransferAccounting

def elapsed (start finish : Nat) : Nat := finish - start

theorem first_wait_included (start arrived finished : Nat)
    (ordered : start ≤ arrived) (processed : arrived ≤ finished) :
    elapsed start finished = elapsed start arrived + elapsed arrived finished := by
  unfold elapsed
  omega

theorem intervals_partition (start middle finish : Nat)
    (ordered : start ≤ middle) (ended : middle ≤ finish) :
    elapsed start middle + elapsed middle finish = elapsed start finish := by
  unfold elapsed
  omega

-- The old origin, after first arrival, necessarily omits first-request elapsed.
theorem arrival_origin_undercounts (start arrived finished : Nat)
    (waited : start < arrived) (processed : arrived ≤ finished) :
    elapsed arrived finished < elapsed start finished := by
  unfold elapsed
  omega

-- Two fully overlapping service intervals must not be added as wall-clock time.
example : elapsed 0 100 + elapsed 0 100 ≠ elapsed 0 100 := by decide

-- Offered-but-not-new is not a duplicate classifier: rejection is also possible.
example : 10 - 4 = 3 + 3 := by decide

end AvenDB.TransferAccounting
