# Scheduler integration fixture registration

The release net suite passed 281/282 tests; the scheduler integration fixture
waited for exactly eight total queued background operations. A real Node also
owns background work, so the total can exceed eight while all fixture tasks are
correctly queued. The timeout then dropped the release channel, causing a
secondary panic in the intentionally blocked closure.

The fixture now acknowledges each of its registrations through a test-only
Tokio task-local notification emitted by the actual scheduler acquisition path.
It deliberately queues an additional maintenance operation to reproduce the
aggregate-count mismatch. There is no production scheduling change and no
increase in timeout.

The real Node reader and writer must still run before all eight catch-up tasks
finish. Cancelling the blocking operation's async caller must retain its active
turn, all fixture work must remain queued until explicit release, and all eight
history operations must eventually finish. The written document is checked
through a final Node read.

Validation: extracted actual scheduler source compiled with rustc against the
existing Tokio/n0-future artifacts; all three scheduler unit tests passed,
including the new registration-with-unrelated-work regression. Rust parsing and
`git diff --check` passed. The actual Node integration test and release suite
remain for the shared compiler owner to run; no Cargo was run in this branch.
