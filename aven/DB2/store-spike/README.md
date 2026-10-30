# The store upgrade's spike: iroh-blobs or bao-tree

Thread 2 of [the store upgrade](../db/store/README.md#threads), measured in the box on 30 Oct 2026. Thrown away once the
architect has decided; the chosen way moves into the store.

**The task:** a 1 GiB file (BLAKE3's output stream: incompressible), 1024 chunk blobs of 1 MiB and an index (iroh-blobs'
`HashSeq`), moves from Alice Peer's endpoint to a relay-only endpoint with Bob's Peer-Light's key, through the Aven
Peer's relay (`relay:http://aven:3340` is the only path, checked on every run), then the reader seeks to the middle.

- **(a)** iroh-blobs 0.104.0 on our `Store`: [`src/adapter.rs`](src/adapter.rs), an actor answering iroh-blobs' store
  API, started from its `readonly_mem.rs`. `/iroh-bytes/4`, iroh-blobs' own get and provider.
- **(b)** bao-tree 0.17.0 directly: [`src/bao.rs`](src/bao.rs), one bi stream per request (`hash, first chunk, end
  chunk`), answered with the size and the bao encoding; 4 requests in flight for a whole file.

Both endpoints run in one process, [`src/bin/spike.rs`](src/bin/spike.rs) (`run.sh`), in a container on the box's
network; the store on Alice's side is counted as S3 would be asked ([`src/count.rs`](src/count.rs)). The reader keeps
what it fetches in a memory store. Our crates at the box's dev profile, the rest at opt-level 1.

## The numbers

| | (a) iroh-blobs | (b) bao-tree |
|---|---|---|
| 1 GiB through the relay, Alice on a folder | 5.35 s, **201 MB/s** | 5.72 s, 188 MB/s |
| 1 GiB through the relay, served from the box's S3 | 7.70 s, 139 MB/s | 7.08 s, 152 MB/s |
| Seek to the middle, cold (index + chunk), folder / S3 | **10.6 / 11.5 ms**, one request | 14.0 / 18.4 ms, two requests |
| Seek, warm (index held), folder / S3 | 8.3 / 12.9 ms | 6.6 / 10.3 ms |
| S3 GETs: whole file | 1058 (1024 chunks, 34 of the index) | 1025 |
| S3 GETs: cold seek / warm seek | 3 / 2 | 2 / 1 |
| Lines, without comments | **215** (adapter) | 113 (protocol and fetch) |
| wasm added, after wasm-bindgen, release | +1.09 MB (+314 KB gzip) | +0.40 MB (+134 KB gzip) |
| wasm added, the box's dev profile | +1.62 MB (+431 KB gzip) | +0.64 MB (+179 KB gzip) |

The baseline wasm (an endpoint, a Router and our store) is 5.48 MB release, 7.44 MB dev; `wasm-size.sh` measures it.

## What the numbers say

- **Seeking:** (a) asks for the index and the chunk in one request, (b) needs the index first: with the box's ~0 ms
  RTT that is 3 to 7 ms; over a real relay it is one round trip more for (b) on every cold seek.
- **From S3** (a) is slower: iroh-blobs serves a hash sequence's chunks one after another on one stream, so each
  chunk's GET waits for the last. The adapter can read the next chunk ahead; (b) hides it with 4 requests in flight.
- **The index's extra GETs** in (a): iroh-blobs reads a hash sequence 32 hashes at a time, and our `get` returns the
  whole index each time. A small cache of the last index in the adapter makes it 1025, 2 and 1, as (b).
- **What (b) leaves out,** which (a) has: resume and fetching only what is missing, several providers at once, the
  downloader, provider events for the gate (members only, push off), and one request for a whole hash sequence or any
  set of its ranges. (b) grows by each of them.
- **The adapter stays small:** 6 of the 23 requests carry transfer (observe, status, export of bao and of ranges,
  import of bao, list); the rest answer "unsupported" or nothing, since refs and reachability keep blobs, not tags.

## Found on the way

1. **A blob's size:** the contract has no `size`, and iroh-blobs asks for it (observe, status). The adapter reads it
   from `get_range(h, u64::MAX..u64::MAX)`'s `Error::Range { len }`: one stat, a HEAD on S3. A `size` in the
   contract would say it plainly; that is the architect's call (the Store trait).
2. **In a browser our `Store` isn't `Send`,** and iroh's protocol handlers must be. Both ways therefore keep the
   store in a task of its own behind a channel: iroh-blobs' store API already is one; (b) needed it added.
3. **No iroh-blobs constructor for a custom store:** `api::Store::from_sender` is crate-private; the adapter builds it
   with `RefCast` from an `irpc::Client`, which the type derives publicly. It works, and may break in a 0.x release.
4. **Whole or absent holds:** the adapter buffers a fetched chunk until every byte has arrived and checked, then puts
   it once; a partial fetch keeps nothing. A seek held exactly 3 blobs: the index and the two chunks asked for.
