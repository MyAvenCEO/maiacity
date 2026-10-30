# The audits of 30 Oct 2026

Six first-principles audits, one per part of avenDB, that Samuel asked for on 30 Oct 2026. They read the specs as they
stood at main `2c1a9890`, so every `path:line` they cite points into that commit. Their synthesis is
[`ARCHITECTURE.md`](../ARCHITECTURE.md), which tracks what has since been fixed or decided. Many findings below are
settled now.

| Audit | Part |
|---|---|
| [`foundation.md`](foundation.md) | The README, production, milestone 2 and the sandbox: avenID's tree, the door, the Aven Peer |
| [`store.md`](store.md) | The store: blobs and refs, files, the chat's chains. Its five security bugs are fixed and live (#1493, #1509) |
| [`docs.md`](docs.md) | The docs layer: Docs, envelopes, segments, snapshots, fit, lenses |
| [`engine.md`](engine.md) | The engine: operations, wants, views, plugins |
| [`caps.md`](caps.md) | avenID caps, attack by attack, before decisions 13 to 20 |
| [`actors.md`](actors.md) | The actor engine, from its branch before #1488 |
