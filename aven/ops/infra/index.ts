// The machine behind api.maia.city — deliberately one of everything:
//   a server (smallest current x86 shared type with at least 2 vCPU / 4 GB),
//   a volume that holds the Postgres data and survives a rebuild,
//   a firewall open on SSH, HTTP and HTTPS, and on UDP for avenDB's iroh endpoints (v1's and the new avenDB's).
//
// Docker arrives through cloud-init; the containers arrive over SSH from the
// API job in .github/workflows/release.yml (made by ops.yml's infra task). No secrets are written here — the
// deploy step writes the .env, and the database password is generated once on
// the server itself and never leaves it.
//
// Auth: HCLOUD_TOKEN (GitHub secret HETZNER_API_KEY).
// SSH:  SSH_PUBLIC_KEY — the public half of the deploy key.
import * as pulumi from "@pulumi/pulumi";
import * as hcloud from "@pulumi/hcloud";

const cfg = new pulumi.Config();
const NAME = "maia-city";

// Hetzner renames its models from time to time, so the type is resolved rather
// than hardcoded. A server that runs on a type that still meets the floor keeps it: Hetzner's "available" means room
// for a new server or a resize, so a type sold out in our location must not fail a deploy that changes nothing
// (2026-10-27: no 16 GB type was available in nbg1 while ours ran on cpx42). Otherwise the cheapest non-deprecated shared
// x86 type that meets the floor and that Hetzner can place in our location right now (a type it has no room for fails
// only after the server is shut down for the resize, 2026-10-27). Set `serverType` in the stack config to override.
const location = cfg.get("location") ?? "nbg1";
const MIN_CORES = cfg.getNumber("minCores") ?? 2;
const MIN_MEMORY_GB = cfg.getNumber("minMemoryGb") ?? 4;
const serverType: pulumi.Output<string> = cfg.get("serverType")
  ? pulumi.output(cfg.get("serverType")!)
  : pulumi
      .all([hcloud.getServerTypesOutput({}), hcloud.getServersOutput({ withSelector: `app=${NAME}` })])
      .apply(([r, running]) => {
        const meets = r.serverTypes.filter(
          (t) =>
            !t.isDeprecated &&
            t.architecture === "x86" &&
            t.cpuType === "shared" &&
            t.cores >= MIN_CORES &&
            t.memory >= MIN_MEMORY_GB,
        );
        const current = running.servers.find((s) => s.name === NAME)?.serverType;
        if (current && meets.some((t) => t.name === current)) return current;
        const fits = meets
          .filter((t) => t.locations.some((l) => l.name === location && l.available && !l.isDeprecated))
          .sort((a, b) => a.memory - b.memory || a.cores - b.cores || a.disk - b.disk || a.name.localeCompare(b.name));
        if (!fits.length)
          throw new Error(
            `No server type with >= ${MIN_CORES} vCPU / ${MIN_MEMORY_GB} GB available in ${location}: ${r.serverTypes.map((t) => t.name).join(", ")}`,
          );
        return fits[0].name;
      });

const volumeSize = cfg.getNumber("volumeSize") ?? 10;

const sshPublicKey = process.env.SSH_PUBLIC_KEY?.trim();
if (!sshPublicKey) throw new Error("SSH_PUBLIC_KEY missing (public half of the deploy key).");

// Registered at creation time as root's key. Rotation does NOT run through here
// — that would replace the server. It runs through the deploy user's
// authorized_keys in the deploy job.
const sshKey = new hcloud.SshKey(`${NAME}-deploy`, { name: `${NAME}-deploy`, publicKey: sshPublicKey });

const firewall = new hcloud.Firewall(`${NAME}-fw`, {
  name: NAME,
  rules: [
    ...[22, 80, 443].map((port) => ({
      direction: "in",
      protocol: "tcp",
      port: String(port),
      sourceIps: ["0.0.0.0/0", "::/0"],
    })),
    // avenDB's server (aven/db/): devices on UDP reach its iroh endpoint straight; each connection proves its device
    // in a hello, and the server hands out only what the device's caps allow
    { direction: "in", protocol: "udp", port: "7401", sourceIps: ["0.0.0.0/0", "::/0"] },
    // its STUN responder (avendb-server/src/stun.rs): browsers learn the address their network shows, to reach each
    // other over WebRTC straight; it answers a Binding request with that address and nothing else
    { direction: "in", protocol: "udp", port: "3478", sourceIps: ["0.0.0.0/0", "::/0"] },
    // its WebTransport listener (avendb-net transports/webtransport.rs): a browser's straight HTTP/3 link to the server,
    // post-quantum TLS under certificates it pins by hash; the relay stays the fallback (Samuel 2026-10-26: a phone's
    // pages took 3-40 s through the relay while the server answered each in under 250 ms)
    { direction: "in", protocol: "udp", port: "7402", sourceIps: ["0.0.0.0/0", "::/0"] },
    // the new avenDB's Aven Peer (aven/DB2/PRODUCTION.md, Part B): peers reach its iroh endpoint straight; its relay
    // rides HTTPS through Caddy at aven.maia.city. avendeploy.yml adds this rule through Hetzner's API too
    { direction: "in", protocol: "udp", port: "7501", sourceIps: ["0.0.0.0/0", "::/0"] },
  ],
});

// First boot only: a `deploy` user, Docker, and somewhere to put the app.
const userData = `#cloud-config
package_update: true
users:
  - name: deploy
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ${sshPublicKey}
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - usermod -aG docker deploy
  - systemctl enable --now docker
  - mkdir -p /opt/${NAME}
  - chown deploy:deploy /opt/${NAME}
`;

const server = new hcloud.Server(
  NAME,
  {
    name: NAME,
    serverType,
    image: "ubuntu-24.04",
    location,
    sshKeys: [sshKey.id],
    firewallIds: [firewall.id.apply(Number)],
    userData,
    publicNets: [{ ipv4Enabled: true, ipv6Enabled: true }],
    labels: { app: NAME },
  },
  {
    // A changed key or a changed cloud-init must never replace a running server.
    ignoreChanges: ["sshKeys", "userData"],
    // A new type resizes it in place; anything that would replace it (and its disk) fails instead.
    protect: true,
  },
);

// The founder registry lives here, not in the container. Separate from the
// server so a rebuild or a resize leaves the data untouched.
const volume = new hcloud.Volume(
  `${NAME}-data`,
  { name: `${NAME}-data`, size: volumeSize, location, format: "ext4", labels: { app: NAME } },
  { protect: true },
);

new hcloud.VolumeAttachment(`${NAME}-data-attach`, {
  volumeId: volume.id.apply(Number),
  serverId: server.id.apply(Number),
  automount: true,
});

export const ipv4 = server.ipv4Address;
export const dataMount = pulumi.interpolate`/mnt/HC_Volume_${volume.id}`;
export const chosenServerType = serverType;
