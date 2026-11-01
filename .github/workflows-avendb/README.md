# avenDB's workflows, parked

Samuel parked avenDB's release pipeline on 1 Nov 2026, without deleting it: theOS owns the release pipeline and
avenSANDBOX from now on (`theOS/decisions/D-24.json`, the work is `theOS/aip/AIP-2.json`). GitHub runs only the files
in `.github/workflows/`, so these four, moved here, no longer run:

| Workflow | What it did |
|---|---|
| `avensandbox.yml` | On `production` (changes from `main` only): booted the box, ran `bun run up --check`, then released each changed package (avenOS, avenSANDBOX, avenPEER) under a dated version |
| `avensandbox-image.yml` | Built avenSANDBOX's box image (`ghcr.io/myavenceo/aven/sandbox`) when a file it reads changed |
| `avenpeer-image.yml` | Built avenPEER's slim image (`ghcr.io/myavenceo/aven/peer`) when a file it reads changed |
| `avendeploy.yml` | By hand: deployed the Aven Peer and avenOS's released build at aven.maia.city |

What is live stays live: aven.maia.city keeps serving what was last deployed, and the box and peer images already
published stay pullable, so cloud sessions keep starting. Nothing releases, builds an image or deploys until theOS's
own pipeline replaces these (AIP-2).

To switch one back on, move it back and push to `main`:

```bash
git mv .github/workflows-avendb/avendeploy.yml .github/workflows/avendeploy.yml
```

`avensandbox.yml` calls `avenpeer-image.yml` (`workflow_call`), so they come back together.
