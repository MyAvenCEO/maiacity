# Backups: a snapshot of each vault

The server keeps every vault in one place, its shelf in its bucket (`maiacity-avendb`), and that shelf holds what is
true now. Backups keep each vault apart, as it was on many days, so a vault comes back as it was on any day kept. They
go in **one bucket of snapshots** (`maiacity-avendb-snapshots`, hel1), with **a folder for each vault**, all managed
by avenMAIA's server.

The rules are in Lean first (`spec/AvenDB/Backup.lean`, B1 to B9), the Rust core is tested against the vectors
(`spec/vectors/backups.json`), and the network code against real nodes and a real Hetzner bucket.

## What a snapshot holds

A vault's snapshot is what the vault needs, of the edits the server holds (`snapshot`):

- the logs of its entries and audiences;
- the logs of every share over it, issued by it or naming it, and of every share those rest on;
- the logs of the vault and of every vault those edits name, up their owners, so a restore checks every chain with
  nothing else;
- the McEliece keys those edits name, and the files its writes bring, every piece of each.

It is the answer a peer gives (`respond`, T19), asked for the whole vault rather than for one device. The server holds
only ciphertext, and a snapshot holds the same ciphertext: nothing is opened to back it up.

## How a backup works

A backup reuses the sync primitives, as a device asks a peer by frontiers:

1. It reads the folder's newest manifest. The manifest names, of what it restores, the frontier of each log and the
   edits outside every closed part (`asks_by_frontiers`).
2. It takes the vault's snapshot, and of it the edits beyond those frontiers (`plan`, `beyond`): what `respondSince`
   sends a device that asks with them (B7).
3. It writes those edits as one new **pack**, in the very format a node keeps its own edits in, and names the newest
   manifest's packs again. A day nothing changed writes no pack.
4. It copies the McEliece keys and the blobs of the files that the folder lacks, each checked against its BLAKE3 hash
   as it streams. A blob the folder holds already is never copied again (B2).
5. It writes the snapshot's **root**, the iroh HashSeq of every blob it names, so a snapshot is one hash, as an iroh
   collection is.
6. It writes the **manifest** last. Nothing counts until the bucket has it: a backup cut short leaves blobs that the
   next one reuses.

Once the newest manifest names 64 packs, the next backup is made **whole**: one pack of the whole snapshot, so a
restore never reads more than 64 packs (B8). A backup is also made whole when the newest manifest restores an edit the
snapshot no longer has.

## The bucket

```
index/<vault>                      a mark for each vault with a folder
server/device.key                  the server's device secret, so a restored server is the same device
vaults/<vault>/blobs/<hash>/<part>  packs, keys, file pieces and roots, in 8 MiB parts
vaults/<vault>/outboards/<hash>-<size>
vaults/<vault>/snapshots/<time>    one manifest per snapshot, its time in 16 hex digits
```

Each vault's folder is sealed under a key of its own, derived from the server's seal (`AVENDB_BUCKET_SEAL`) and the
vault's id, and every object is bound to its name: nothing opens in another vault's folder or under another name. As
the folders are sealed apart, blobs are deduplicated inside a folder, never across folders.

The bucket has Object Lock, in compliance mode for 7 days: every version of every object stays at least 7 days, even
if a key is stolen. Nothing the server does to its own shelf touches the bucket of snapshots, and nothing deletes in
it but retention.

## Retention

Each backup is followed by retention (`keeps`, B5), counted in UTC from 1970:

- every snapshot of the last 48 hours;
- the newest of each day for 30 days;
- the newest of each week for 26 weeks;
- the newest of each month, forever (a month is 30 days);
- and always the newest snapshot.

Retention deletes the manifests it lets go of, then every blob no kept snapshot names. Every snapshot it keeps restores
exactly as before (B4). The deleted versions stay 7 more days by Object Lock.

## When it runs

| How | What it does |
|---|---|
| Each day at 03:00 UTC | The server backs up every vault it knows, then runs retention. |
| `docker kill -s USR1 maia-city-avendb` | The same, now (or as soon as the run under way ends). |
| `avendb-server snapshots` | Lists each vault's snapshots, from the bucket alone. |
| `avendb-server drill [--at <time>]` | Rehearses a restore of every vault, each into a new node of its own, from the bucket alone. Fails unless each comes back whole. |
| `avendb-server restore --into <folder> [--at <time>]` | After a disaster: restores every vault into a new, empty folder, with the server's device secret. It never touches the live server's shelf. |

A time is seconds since 1970, or a day, `YYYY-MM-DD`, meaning the end of that day in UTC. Each vault then comes back as
its newest snapshot at that time.

The server's environment:

| Variable | Default | What it says |
|---|---|---|
| `AVENDB_SNAPSHOTS` | unset (no backups) | The bucket of snapshots. |
| `AVENDB_SNAPSHOTS_ENDPOINT`, `_REGION`, `_ACCESS_KEY`, `_SECRET_KEY` | the server's bucket's | Where it is, and the key to it. |
| `AVENDB_SNAPSHOTS_AT` | `03:00` | When each day the backup runs, in UTC. |
| `AVENDB_SNAPSHOTS_DIR` | `avendb-snapshots` in the temporary folder | Where uploads are staged. |

The seal is always the server's (`AVENDB_BUCKET_SEAL`), so there is nothing new to keep safe. The server refuses a
bucket of snapshots that is its own bucket: the snapshots always live apart from what they back up.

## Restoring

- **A drill** (`rehearse`) restores a snapshot onto a new shelf and starts a node on it as a new device, so it never
  stands in for the live server. It checks that the node took back every edit, each signature and chain checked again
  as at any start (`Lab::restore_backup`), that it holds every log as the manifest names it (B9), and every file
  whole.
- **A restore after a disaster** (`restore_all`) puts every vault's snapshot onto one new shelf, in a new, empty
  folder, with the server's device secret. A server started on that folder (`AVENDB_DATA`, with no bucket) is the same
  device. Its devices then bring it whatever came after the snapshot, as they sync. A restore never writes to the live
  server's shelf, so it can't wipe or roll back what the live server holds by accident: switching the server over is
  a deliberate step of its own.
- **Jumping back.** An entry already keeps every write, so one entry's old version is one click in the app. A snapshot
  jumps the whole vault back: read it as it was in a drill, or restore it after a disaster. Rolling a live vault back
  for everyone needs the owner's keys (the server is blind), so that is a later owner action in the app.

## Tests

- `crates/avendb`: the snapshot, the plan by frontiers and retention, against `vectors/backups.json`.
- `crates/avendb-net/tests/backup.rs`: three days of backups, each snapshot rehearsed in a node of its own, Carol's Mac
  reading both files from the restored node over iroh, the oldest snapshot without what came after, a backup made
  whole, and retention.
- `crates/avendb-server/tests/backup.rs`, the full recovery test: every vault over three days, a drill, a restore as
  the same device and a device reading the files from it, each step timed. It runs against the real test bucket
  (`maiacity-avendb-snapshots-test`, hel1) from `.github/workflows/avendb-backups.yml`, under a prefix and a seal of
  its own, with a film of two pieces (a gigabyte and 64 MiB); without that bucket, in a folder.
- The same workflow drills every vault of the live bucket of snapshots on a GitHub runner each Monday, from the bucket
  alone. It only reads.

## Not in this build

- The backup settings as an entry in avenMAIA's vault (time of day, retention, vaults left out), signed and versioned.
- avenMAIA's MCP tools (`backup_now`, `snapshots`, `restore_rehearsal`, `restore` with a Maia City owner's approval).
- A Backups card in The OS.
- A second location for the bucket of snapshots.
