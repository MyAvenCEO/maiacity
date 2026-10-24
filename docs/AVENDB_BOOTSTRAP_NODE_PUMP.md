# Node pump for bounded owner suffixes — candidate

The Node now owns a background task that finishes a staged authenticated suffix
without requiring the user to issue mutations or poll an engine operation. It
checks once at startup, then uses a dedicated notification when a mutation creates
pending work or changes the signed log while work remains. Each turn enters the
existing fair background Lab scheduler, where foreground operations overtake queued
background work. Browser admission yields a real worker event-loop boundary; the
pump also yields between continuing turns. It waits on Notify when idle or locked,
and normal lifecycle admission/shutdown owns its work.

A materialization turn wakes the reactive size channel even when signed-log size
is unchanged, including the final turn. It also wakes existing announcer/saver
paths. No peer role or authority changes: core admission still validates every
suffix and current owner entitlement. Durable writable admission is a separate
receipt gate owned by the saver integration.

Dependency: core `owner_bases_pending(on) -> bool` must report unlocked and any
remaining cursor; `advance_owner_bases(on) -> bool` reports work remaining after a
turn. The aggregate accessor is supplied by the concurrent bounded-core fix.

Regression candidate `bootstrap_pump_finishes_suffix_without_foreground_mutations`
starts with 40 suffix writes, confirms more than one bounded turn, and waits using
pure reads for correct final content. Cargo execution is pending the shared queue.

Review limits: the current batch of 32 is per anchor, not an aggregate limit across
all 16 anchors. Initial suffix collection and anchor ciphertext cloning remain
outside that admission-operation bound. This pump cannot preempt one core turn;
those bounds must not be described as a measured frame-time guarantee.
