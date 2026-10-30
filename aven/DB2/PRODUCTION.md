# Production: the first admin, then aven.maia.city

The step between milestone 1 and milestone 2 (Samuel, 30 Oct 2026). Production gets one person, its admin, who signs
up with a passkey and so owns Aven. Then the Aven Peer goes live at `aven.maia.city`, beside v1 on its server.
Everyone else waits for milestone 2's invites: until then, signup is closed once the admin is in.

Only what this plan names gets built. Two parts, in order, each a task thread of its own.

## Part A: the admin's passkey

### What a person sees

On a host whose Aven Peer nobody has claimed yet, avenOS shows one screen: **Sign up**, a button that makes a
passkey. The claim is just the first signup (Samuel, 30 Oct 2026): no code. Once claimed:

- the admin's browser is a Peer-Light of the admin's vault, and avenOS opens on its dashboard as in the box;
- on another browser, **Sign in with your passkey** makes that browser a new device of the admin's vault;
- everyone else sees "avenOS · invite only, coming soon". Nobody else can sign up.

### The tree becomes data

In the box the tree is the cast, fixed. In production it is kept by the Aven Peer through its store:

- **Before the claim,** the tree holds Aven, a network vault with no owner yet, and the Aven Peer, its device. The
  Aven Peer's key is made on the server at its first start ([Part B](#the-aven-peers-key)).
- **The claim** adds the admin's person vault, owned by its passkey and by MaiaCityGuardian ([below](#maiacityguardian));
  makes it Aven's owner; and adds the claiming
  browser as a device of the admin's vault. One signed statement, stored as a blob, with the ref `claim` set from
  nothing to it by compare-and-set. A second claim finds the ref taken and is refused, even racing the first.
- **Each later sign-in** adds a device, a statement signed by the passkey, stored the same way under its own ref.
- **A restart** reads the tree back from the store. A wipe of the store makes the network unclaimed again.

### MaiaCityGuardian

The master recovery key, named MaiaCityGuardian (Samuel, 30 Oct 2026): an additional owner of every person's vault,
added when the vault is founded, so it is the way back in beside the passkeys. A person can remove it, as any owner,
once owners can be changed (milestone 3).

- **One Ed25519 key.** Its secret, 32 bytes, is made and kept offline by its holder and is never on a server, in the
  repository or in GitHub. Whoever holds it owns every person's vault that has it.
- **Its public half comes by configuration:** `--guardian HEX`, or `AVEN_PEER_GUARDIAN`. A peer without one founds
  vaults without it. Nothing of it is compiled in.
- **`bun run guardian`** makes one: it prints the secret and the public half and writes nothing.
- **In the box** it is a test key from the cast's rule, `sha256("avenSANDBOX test signer: maia-city-guardian")`.

### Lean first

`Aven.ID` grows by:

- **A passkey owner key:** a key of its own suite, ECDSA P-256 as WebAuthn makes it. Like Ed25519, its signature is
  taken as sound: it verifies for exactly what its key signed.
- **What a WebAuthn assertion must say:** `clientDataJSON`'s type, challenge and origin; `authenticatorData`'s RP ID
  hash and its user-present and user-verified flags. Pure checks, with examples that break each one.
- **Unclaimed and claimed:** a network vault may lack an owner only before its claim. A claim makes a well-formed
  tree whose admin is the claimant's vault. Theorems: a server is claimed at most once; after the claim, Aven's owner
  is the claimant's vault and no device governs anything; a sign-in adds a device and changes no owner; with a
  guardian configured, every person's vault founded has it among its owners.
- **Vectors** (`id/spec/vectors/passkeys.json`, `claims.json`): assertions and what each check says; claim and
  sign-in traces with every resulting tree. aven-id's tests and the check load them (README rule 10).

### The code

- **`aven-id`:** WebAuthn assertions checked (ES256 only, the algorithm every authenticator has), the statements of a
  claim and a sign-in, and the tree read back from them. The passkey's public key comes from the browser's
  `getPublicKey()` at creation (attestation `none`), so no CBOR is parsed.
- **The Aven Peer:** new flags `--rp-id`, `--origin` and `--guardian`, and the tree kept in its store instead of the
  cast's.
- **The Peer-Light and avenOS:** the claim and sign-in screens; the browser's device key is made in the browser and
  kept in its OPFS.
- **The passkey's RP ID is `maia.city`** in production, so avenOS can later move to `maia.city` itself without anyone
  making a new passkey. In the box it is `localhost`.

### How it is checked

`bun run up --check` adds one step: an Aven Peer in production's configuration (no cast, its tree in the box's S3
under a root of its own, the test guardian), and a Chromium page with Chromium's virtual authenticator
(Playwright, over CDP), which:

1. signs up first, so claims the network, and sees its dashboard; the admin's vault has the passkey and the
   guardian as its owners;
2. tries a second signup with another passkey, and is refused;
3. signs in from a second browser profile with the same passkey, and becomes a second device;
4. restarts the Aven Peer and finds the same tree; wipes its store and finds it unclaimed.

### Not in Part A

Invites and anyone else's signup (milestone 2); more than one passkey per vault, owners k of n, recovery, rotation
and revoking a device (milestone 3); removing MaiaCityGuardian from a vault (milestone 3).

## Part B: aven.maia.city

### Where

v1's server, `maia-city` (Hetzner, Nuremberg), beside v1, touching none of its containers:

| Piece | Where |
|---|---|
| The Aven Peer | its own compose project in `/opt/aven`, the slim `ghcr.io/myavenceo/aven/peer` image |
| The relay and avenOS | `https://aven.maia.city`: v1's Caddy gets one site block, its relay at `/relay`, avenOS's build for the rest. Caddy validates the new config before it reloads, as v1's release did |
| The peer's UDP | port 7501 (v1 holds 7401, 3478 and 7402); its own rule in the firewall `maia-city`, added through Hetzner's API and written into `aven/ops/infra/index.ts` too, so a later Pulumi run keeps it |
| Its store | Hetzner Object Storage in Helsinki, the new bucket `city-maia-aven`, with no object lock, so deletes are real |
| DNS | A and AAAA records for `aven.maia.city`, set by the deploy job through Hetzner's DNS API |

### The Aven Peer's key

Made on the server at the first deploy, in a file only the peer reads, and never copied anywhere. The job prints only
its public half. Rotating it is one run of the job: a new key, and the tree's device record replaced by the admin.
Revoking a device by a signed act of its vault comes in milestone 3.

### The slim image

`ghcr.io/myavenceo/aven/peer`: the `aven-peer` binary built in the box's image, copied onto a minimal base. GitHub
builds it, and the push to `production` releases it as `@aven/peer@<version>` beside avenOS's build. The box's `aven`
and `alice` can run it too, so what is tested is what ships.

### The deploy

A workflow run by hand (`avendeploy.yml`), in the GitHub environment `production`, which holds its variables. No
required reviewer for now (Samuel, 30 Oct 2026): starting the run is the decision. In order:

1. **Bucket:** `city-maia-aven` made if it is missing, then a probe that a stale `If-Match` and `If-None-Match: *` get
   412 on PUT and DELETE. If Hetzner doesn't honour them, the job says so, and the store leans on the one writer alone.
2. **DNS:** reads the zone `maia.city` first, through whichever API holds it (Hetzner has moved DNS into its Cloud
   Console), then sets the records. Without a token it prints the records to set by hand.
3. **Firewall:** the UDP rule.
4. **The peer:** pulls the released image, makes its key if there is none, starts it. The claim is the first
   signup, so Samuel signs up right after the first deploy; the job ends by saying whether the network is claimed.
   Claimed by anyone else, its store is wiped and the deploy runs again.
5. **Caddy:** the site block, validated, then reloaded.
6. **Health:** the relay answers over HTTPS, UDP 7501 answers, and the Aven Peer's record is in the bucket.

### Secrets

| Secret | What | Set by |
|---|---|---|
| `AVEN_PEER_GUARDIAN` | MaiaCityGuardian's public half, a variable of the environment `production` (not secret) | Samuel, from `bun run guardian` |
| `HETZNER_S3_ACCESS_KEY`, `HETZNER_S3_SECRET_KEY` | the bucket's credentials | there already |
| `HETZNER_API_KEY` | the firewall rule | there already |
| `HETZNER_DNS_TOKEN` | the DNS records | there already |
| `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` | the server, through `.github/actions/prod-ssh` | there already |

Nothing secret goes into a log: the repository and its Actions logs are public.

## Done when

- The admin signs up first at `aven.maia.city` with a passkey, so claims it, and sees avenOS's dashboard there, live.
- The admin's vault has MaiaCityGuardian among its owners. A second signup is refused; a second browser of the admin signs in with the passkey and becomes a device.
- `bun run up --check` proves the claim, the refusal, the sign-in, the restart and the wipe in the box.
- v1's site, API and peer answer as before.
