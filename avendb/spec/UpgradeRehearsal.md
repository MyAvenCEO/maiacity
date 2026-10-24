# Existing-store release rehearsal isolation

`avendb-browser/tests/upgrade_rehearsal.rs` is a manual macOS acceptance fixture, not production migration code. Its ignored existing-account test requires an explicitly marked disposable copy under `/private/tmp`, independently recorded inventory and the existing owner’s Touch ID key. Never point it at an installed store.

Before `disk::open`, Touch ID, or any slot corruption, `copy_root` validates the entire copy recursively using `symlink_metadata`. Every descendant must be a directory or regular file; symbolic links and regular files with multiple hard links are refused. This includes generation directories and derived slots, not only immutable history. Use an independent APFS copy-on-write clone or normal copy, never a hard-link copy. The three `isolation_tests` use disposable paths, require neither an account nor Touch ID, and check a normal tree plus nested slot symlink/hardlink refusal with unchanged targets.

Run the focused fixture checks from `avendb` using the existing serialized Cargo configuration:

```sh
cargo test --profile app --locked --offline -p avendb-browser --test upgrade_rehearsal isolation_tests -- --nocapture
```

This is a preflight against accidental aliasing, not a race-free filesystem sandbox. Keep the copy private and quiescent throughout the rehearsal; another process replacing paths after the check is outside the fixture contract. The check does not prove snapshot consistency: orderly close the source writer, record the baseline, then create and validate the independent copy. Do not run old and new binaries against the same store. The rehearsal’s no-UDP, loopback-only relay configuration prevents the copied identity from joining real peers.

The runtime tests supply filesystem correspondence only; no new Lean theorem or formal filesystem-isolation proof is claimed. Their acceptance does not establish physical-device lifecycle behavior or authorize resetting any installed account.
