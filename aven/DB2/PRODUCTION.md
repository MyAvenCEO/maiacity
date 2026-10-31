# Production: the first admin, then aven.maia.city

The step between milestone 1 and milestone 2 (Samuel, 30 Oct 2026): production gets one person, its admin, who signs
up with a passkey and so owns Aven; then the Aven Peer goes live at `aven.maia.city`, beside v1 on its server. This
file is its plan, its status and the production runbook.

Its design lives in avenBRAIN: the Peer, its deploy and why production is never wiped in
[avenPEERS](brain/peers/README.md); the register the first signup founds in [avenCAPS](brain/caps/README.md); passkeys,
vaults and MaiaCityGuardian in [avenID](brain/id/README.md).

**Status: done.** Samuel signed up first and claimed the network; Parts A, B and C are live.

## Part A: the admin's passkey (done)

On a host nobody has claimed, avenOS shows one screen, **Sign up**; the first signup claims the network, and everyone
else sees "avenOS · invite only, coming soon". The admin's other browsers become devices of the admin's vault with
**Sign in with your passkey**. Until the cutover's switch, the Aven Peer keeps the claim and each sign-in in its store,
the first generation's way ([`PEERS.md`](PEERS.md#the-clean-slate-cutover), stage 7).

### How it is checked

`bun run up --check` has one step for it: an Aven Peer in production's configuration (no cast, its tree in the box's
S3 under a root of its own, the test guardian), and a Chromium page with Chromium's virtual authenticator
(Playwright, over CDP), which:

1. signs up first, so claims the network, and sees its dashboard; the admin's vault has the passkey and the
   guardian as its owners;
2. tries a second signup with another passkey, and is refused;
3. signs in from a second browser profile with the same passkey, and becomes a second device;
4. restarts the Aven Peer and finds the same tree; wipes its store and finds it unclaimed.

### Not in Part A

Invites and anyone else's signup (milestone 2); more than one passkey per vault, owners k of n, recovery, rotation and
revoking a device; removing MaiaCityGuardian from a vault.

## Part B: aven.maia.city (the runbook)

The image, its tag and how the Aven Peer keeps its key and its store are in
[avenPEERS, Deploy](brain/peers/README.md#deploy).

### Where

v1's server, `maia-city` (Hetzner, Nuremberg), beside v1, touching none of its containers:

| Piece | Where |
|---|---|
| The Aven Peer | its own compose project in `/opt/aven`, the slim `ghcr.io/myavenceo/aven/peer` image |
| The relay and avenOS | `https://aven.maia.city`: v1's Caddy gets one site block, its relay at `/relay`, avenOS's build for the rest. Caddy validates the new config before it reloads, as v1's release did |
| The peer's UDP | port 7501 (v1 holds 7401, 3478 and 7402); its own rule in the firewall `maia-city`, added through Hetzner's API and written into `aven/ops/infra/index.ts` too, so a later Pulumi run keeps it |
| Its store | Hetzner Object Storage in Helsinki, the new bucket `city-maia-aven`, with no object lock, so deletes are real |
| DNS | A and AAAA records for `aven.maia.city`, set by the deploy job through Hetzner's DNS API |

### The deploy

A workflow run by hand (`avendeploy.yml`), in the GitHub environment `production`, which holds its variables. No
required reviewer for now (Samuel, 30 Oct 2026): starting the run is the decision. In order:

1. **Bucket:** `city-maia-aven` made if it is missing, then a probe that a stale `If-Match` and `If-None-Match: *` get
   412 on PUT and DELETE. If Hetzner doesn't honour them, the job says so, and the store leans on the one committer
   alone.
2. **DNS:** reads the zone `maia.city` first, through whichever API holds it (Hetzner has moved DNS into its Cloud
   Console), then sets the records. Without a token it prints the records to set by hand.
3. **Firewall:** the UDP rule.
4. **The peer:** pulls the released image, makes its key if there is none, starts it. The job ends by saying whether
   the network is claimed.
5. **Caddy:** the site block, validated, then reloaded.
6. **Health:** the relay answers over HTTPS, UDP 7501 answers, and the Aven Peer's record is in the bucket.

**Rotating the Aven Peer's key** is one run of the job: a new key, and its device replaced in the tree by the admin.

**The deploy has no `wipe` input,** and nothing else deletes the bucket's objects: production is never wiped
([avenPEERS, Upgrades](brain/peers/README.md#upgrades)). The box keeps its own wipe (`bun run down --wipe`, the
check's restart and wipe).

### Secrets

| Secret | What | Set by |
|---|---|---|
| `AVEN_PEER_GUARDIAN` | MaiaCityGuardian's public half, a variable of the environment `production` (not secret) | Samuel, from `bun run guardian`, which prints a new secret and its public half and writes nothing; the secret stays offline with its holder |
| `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY` | the bucket's credentials | there already |
| `HETZNER_API_KEY` | the firewall rule | there already |
| `HETZNER_DNS_TOKEN` | the DNS records | there already |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | the server, through `.github/actions/prod-ssh` | there already |

Nothing secret goes into a log: the repository and its Actions logs are public.

## Part C: Maia City, the admin coop (done)

The first signup founds the person's vault, Maia City (the admin coop, owned by that vault), Aven (an agent, owned by
Maia City) and the Aven Peer (Aven's device), and the browser as a device of the person's vault. The box's cast
follows it: Alice's vault owns Maia City, which owns Aven. Production's store was wiped once, before anyone had signed
up; that was the last wipe.

## As it runs

- **Claimed:** Samuel signed up first. The tree is his vault (owned by his passkey and MaiaCityGuardian, a full owner
  of every person's vault for now: A42), Maia City, Aven (kind `agent` since #1457, read from the stored statements,
  which never named a kind) and the Aven Peer; his vault has two browsers. A frozen copy of that store's format is
  tested (`id/core/tests/before/`).
- **Until the cutover's switch** the first generation runs: the claim is the first signup, and the guardian, the RP ID
  and the origins come by configuration (`--guardian`, `--rp-id`, `--origin`). At the switch the register's setup Samuel
  signs names them (A11, A13, A28, P18; [`PEERS.md`](PEERS.md#the-clean-slate-cutover), stage 7).
- **The store's conditions:** Hetzner Object Storage answers `If-None-Match: *` on an existing key with 412, but also
  answers a correct `If-Match` with 412, and ignores `If-Match` on DELETE. So production runs `--s3-conditions create`.
- **QAD:** the relay's UDP 7842 uses Caddy's own Let's Encrypt certificate for `aven.maia.city`, copied out of v1's
  Caddy by `deploy/server/qad.sh` at each deploy and daily by cron, which restarts the peer when Caddy has renewed.
- **The browsers:** the check runs avenOS's release build in Chromium, WebKit and Firefox. A browser that keeps no
  storage for the host (Firefox with site data blocked, or always private) is told so, with the reason under it.

## Done when

All met:
- The admin signs up first at `aven.maia.city` with a passkey, so claims it, and sees avenOS's dashboard there, live.
- The admin's vault has MaiaCityGuardian among its owners. A second signup is refused; a second browser of the admin
  signs in with the passkey and becomes a device.
- `bun run up --check` proves the claim, the refusal, the sign-in, the restart and the wipe in the box.
- v1's site, API and peer answer as before.
