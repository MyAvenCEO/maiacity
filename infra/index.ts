// The machine behind api.maia.city — deliberately one of everything:
//   a server (smallest current x86 shared type with at least 2 vCPU / 4 GB),
//   a volume that holds the Postgres data and survives a rebuild,
//   a firewall open on SSH, HTTP and HTTPS.
//
// Docker arrives through cloud-init; the containers arrive over SSH from the
// deploy job in .github/workflows/api.yml. No secrets are written here — the
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
// than hardcoded: the cheapest non-deprecated shared x86 type that still meets
// the floor. Set `serverType` in the stack config to override.
const MIN_CORES = cfg.getNumber("minCores") ?? 2;
const MIN_MEMORY_GB = cfg.getNumber("minMemoryGb") ?? 4;
const serverType: pulumi.Output<string> = cfg.get("serverType")
  ? pulumi.output(cfg.get("serverType")!)
  : hcloud.getServerTypesOutput({}).apply((r) => {
      const fits = r.serverTypes
        .filter(
          (t) =>
            !t.isDeprecated &&
            t.architecture === "x86" &&
            t.cpuType === "shared" &&
            t.cores >= MIN_CORES &&
            t.memory >= MIN_MEMORY_GB,
        )
        .sort((a, b) => a.memory - b.memory || a.cores - b.cores || a.disk - b.disk || a.name.localeCompare(b.name));
      if (!fits.length)
        throw new Error(
          `No server type with >= ${MIN_CORES} vCPU / ${MIN_MEMORY_GB} GB: ${r.serverTypes.map((t) => t.name).join(", ")}`,
        );
      return fits[0].name;
    });

const location = cfg.get("location") ?? "nbg1";
const volumeSize = cfg.getNumber("volumeSize") ?? 10;

const sshPublicKey = process.env.SSH_PUBLIC_KEY?.trim();
if (!sshPublicKey) throw new Error("SSH_PUBLIC_KEY missing (public half of the deploy key).");

// Registered at creation time as root's key. Rotation does NOT run through here
// — that would replace the server. It runs through the deploy user's
// authorized_keys in the deploy job.
const sshKey = new hcloud.SshKey(`${NAME}-deploy`, { name: `${NAME}-deploy`, publicKey: sshPublicKey });

const firewall = new hcloud.Firewall(`${NAME}-fw`, {
  name: NAME,
  rules: [22, 80, 443].map((port) => ({
    direction: "in",
    protocol: "tcp",
    port: String(port),
    sourceIps: ["0.0.0.0/0", "::/0"],
  })),
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
