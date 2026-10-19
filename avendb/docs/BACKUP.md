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

Hetzner fails a request now and then, so the server tries each request to the bucket of snapshots up to 4 times, a
second apart, then two, then four, and says each failure in its log.

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

## The daily check

The snapshots will hold terabytes, so nothing restores them all to check them: that would read every byte each time,
from Hetzner to wherever it runs, and need room for all of it. After each day's backup the server checks every folder
from the bucket alone, restoring nothing (`Folder::check`):

1. **The listing, every day.** Each kept snapshot's manifest and root read whole and name the same blobs, and the
   bucket holds every blob they name, its outboard and each of its parts, by listing the bucket alone: a blob gone
   shows the same day, and costs no read of its bytes.
2. **The edits, every day.** The newest snapshot's packs and McEliece keys are read and given back to a new device in
   memory, each edit checked again as a node checks what it takes back as it starts (`Lab::restore_backup`): it must
   give back every edit the manifest holds, each log as the manifest names it (B9). This is the part of a restore that
   could go wrong in ways a listing can't see, and it reads megabytes, not the files.
3. **The files, a little each day.** Each blob of the files is read on one day in 30 (`AVENDB_SNAPSHOTS_READ_DAYS`),
   by its hash, part by part past the cache, and checked against its BLAKE3 hash: every byte is read once a month, a
   thirtieth of it each day.

A folder that isn't whole is said as an error in the server's log, with what is missing or changed. A blob deleted by
mistake shows in the next day's listing, while the bucket still keeps its version (Object Lock, 7 days). A full restore
is rehearsed by the recovery test (below), on test data.

## When it runs

| How | What it does |
|---|---|
| Each day at 03:00 UTC | The server backs up every vault it knows, runs retention, then checks every folder. |
| `docker kill -s USR1 maia-city-avendb` | The same, now (or as soon as the run under way ends). |
| `avendb-server snapshots` | Lists each vault's snapshots, from the bucket alone. |
| `avendb-server check [--read-all]` | Checks every folder as the daily run does, or reading every blob. Fails unless each is whole. |
| `avendb-server restore --into <folder> [--at <time>]` | After a disaster: restores every vault into a new, empty folder, with the server's device secret. It never touches the live server's shelf. |

A time is seconds since 1970, or a day, `YYYY-MM-DD`, meaning the end of that day in UTC. Each vault then comes back as
its newest snapshot at that time.

The server's environment:

| Variable | Default | What it says |
|---|---|---|
| `AVENDB_SNAPSHOTS` | unset (no backups) | The bucket of snapshots. |
| `AVENDB_SNAPSHOTS_ENDPOINT`, `_REGION`, `_ACCESS_KEY`, `_SECRET_KEY` | the server's bucket's | Where it is, and the key to it. |
| `AVENDB_SNAPSHOTS_AT` | `03:00` | When each day the backup runs, in UTC. |
| `AVENDB_SNAPSHOTS_READ_DAYS` | `30` | In how many days the check reads every blob of the files once; `0` reads none. |
| `AVENDB_SNAPSHOTS_DIR` | `avendb-snapshots` in the temporary folder | Where uploads are staged. |

The seal is always the server's (`AVENDB_BUCKET_SEAL`), so there is nothing new to keep safe. The server refuses a
bucket of snapshots that is its own bucket: the snapshots always live apart from what they back up.

## Restoring

- **A rehearsal** (`rehearse`) restores a snapshot onto a new shelf and starts a node on it as a new device, so it
  never stands in for the live server. It checks that the node took back every edit, each signature and chain checked again
  as at any start (`Lab::restore_backup`), that it holds every log as the manifest names it (B9), and every file
  whole.
- **A restore after a disaster** (`restore_all`) puts every vault's snapshot onto one new shelf, in a new, empty
  folder, with the server's device secret. A server started on that folder (`AVENDB_DATA`, with no bucket) is the same
  device. Its devices then bring it whatever came after the snapshot, as they sync. A restore never writes to the live
  server's shelf, so it can't wipe or roll back what the live server holds by accident: switching the server over is
  a deliberate step of its own.
- **Jumping back.** An entry already keeps every write, so one entry's old version is one click in the app. A snapshot
  jumps the whole vault back: read it as it was in a rehearsal, or restore it after a disaster. Rolling a live vault back
  for everyone needs the owner's keys (the server is blind), so that is a later owner action in the app.

## Tests

- `crates/avendb`: the snapshot, the plan by frontiers and retention, against `vectors/backups.json`.
- `crates/avendb-net/tests/backup.rs`: three days of backups, the check, each snapshot rehearsed in a node of its
  own, Carol's Mac reading both files from the restored node over iroh, the oldest snapshot without what came after, a
  backup made whole, retention, and the check finding a blob gone and two changed.
- `crates/avendb-server/tests/backup.rs`, the full recovery test: every vault over three days, the check, a rehearsal,
  a restore as the same device and a device reading the files from it, and a part gone that the day's check finds by
  the listing, each step timed. It runs against the real test bucket (`maiacity-avendb-snapshots-test`, hel1) from
  `.github/workflows/avendb-backups.yml`, under a prefix and a seal of its own, with a film of two pieces (a gigabyte
  and 64 MiB); without that bucket, in a folder. No live snapshot ever leaves Hetzner.

## Not in this build

- The backup settings as an entry in avenMAIA's vault (time of day, retention, vaults left out), signed and versioned.
- avenMAIA's MCP tools (`backup_now`, `snapshots`, `restore_rehearsal`, `restore` with a Maia City owner's approval).
- A Backups card in The OS.
- A second location for the bucket of snapshots.
