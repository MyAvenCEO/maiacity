# v1's workflows, parked

Samuel switched v1's GitHub workflows off on 29 Oct 2026, without deleting them. GitHub runs only the files in
`.github/workflows/`, so these three, moved here, no longer run:

| Workflow | What it did |
|---|---|
| `ci.yml` | Checked every pull request into `main`; its "CI required" was `main`'s required check |
| `release.yml` | On every push to `main`, redeployed v1: the site (maia.city), the API (api.maia.city) and avenDB's peer (avendb.maia.city) |
| `ops.yml` | Uptime every 10 minutes, the cloud sessions' dev cache, backups' recovery test, infrastructure, rollback and the other tasks by hand |

The site, the API and the peer keep running as they were last deployed. Nothing redeploys them, nothing checks that
they are up, and rollback is gone, until a workflow is moved back.

What ran instead, avenDB's pipeline, is parked too since 1 Nov 2026 ([`../workflows-avendb/`](../workflows-avendb/README.md)):
theOS owns the release pipeline from now on.

To switch one back on, move it back and push to `main`:

```bash
git mv .github/workflows-v1/ops.yml .github/workflows/ops.yml
```

`ci.yml` and `release.yml` call each other (`workflow_call`), so they come back together.
