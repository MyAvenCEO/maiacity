# Bounded actual network audit — 23 October 2026, 20:33–20:35 CEST

All requested executable Mac/server probes completed with verified TLS, exact expected payload lengths, and no account, vault, passkey, or stored application payload access. These are short sequential HTTP samples of current paths, **not avenDB sync throughput, sustained maxima, or measured link utilization**. Current network configuration was left unchanged. No packages were installed, no services restarted, and no live store was opened.

| Actual path | Payload | Total request time | End-to-end Mbps | MiB/s |
|---|---:|---:|---:|---:|
| Cloudflare → Mac |67,108,864 bytes|7.853501 s|68.36|8.15|
| Mac → Cloudflare, synthetic random upload |16,777,216 bytes|4.386038 s|30.60|3.65|
| Cloudflare → production host |67,108,864 bytes|0.654467 s|820.32|97.79|
| Production host → Cloudflare, synthetic random upload |16,777,216 bytes|2.750025 s|48.81|5.82|
| Current Maia public WASM → Mac, one HTTP 206 range |8,388,608 bytes|1.074244 s|62.47|7.45|
| Physical iPhone |Not measured|—|—|—|
| Physical iPad |Not measured|—|—|—|

Mac probe timestamps: 18:33:41.688–18:33:56.150 UTC. Production-host timestamps: 18:34:23.490–18:34:27.550 UTC. Maia range plus manifest discovery: 18:35:31.345–18:35:32.826 UTC. Three fresh empty requests took 860.222/370.951/442.167 ms on Mac and 106.901/110.217/131.485 ms on the host; these include DNS/TCP/TLS/server response and are **not ICMP RTTs**.

Each transfer had a 15-second limit and fresh cache-busted URL, no-cache request and identity encoding. Downloads were discarded; uploads came only from a private temporary random-byte file removed after the request. The synthetic helper was reused from `scripts/diagnostics/network-probe.py`; its default hardcoded `production-server` label was overridden to `Mac` by the local wrapper. Both synthetic runs completed all five requests. The extra public-file check was capped to one 8 MiB Range, required HTTP 206/exact length, and bounded manifest discovery to 256 KiB (actual 86,954 bytes). It measured `_app/immutable/assets/avendb_browser_bg.DHwV_lES.wasm` from release `06fe0685dd4a4160ec0ef32100c503583717be1c`.

Exactly one existing server workflow was dispatched: [run 40004363430](https://github.com/MyAvenCEO/maiacity/actions/runs/40004363430), main `06fe0685dd4a4160ec0ef32100c503583717be1c`. The actual `One bounded probe, running on the server` step ran and passed, as did artifact publication. Before dispatch, recent runs showed no active duplicate and the remote main workflow, probe, and pinned-SSH action were byte-identical to the inspected local copies. Workflow runs the script through trusted SSH stdin with `timeout 110s`; five-minute job bound, no deploy/restart/store operation. The previous completed run 39967030928 at 14:08 UTC remains historical evidence, not this run's result.

Executed commands:

```sh
python3 /private/tmp/avendb-network-mac-rerun.py
gh workflow run network-audit.yml --repo MyAvenCEO/maiacity --ref main
gh run view 40004363430 --repo MyAvenCEO/maiacity --json headSha,status,conclusion,jobs,url
gh run download 40004363430 --repo MyAvenCEO/maiacity --name server-network-40004363430 --dir /private/tmp/avendb-server-audit-40004363430
```

The separate public-file command used `curl --fail --connect-timeout 5 --max-time 15 --max-filesize 8388608 --range 0-8388607 --header 'Cache-Control: no-cache' --header 'Accept-Encoding: identity' --output /dev/null --write-out '%{json}'` on the manifest-discovered HTTPS URL (actual command uses separate flag/value arguments). No cookies, authorization headers, or TLS bypass.

Committed evidence: [sanitized raw measurements](evidence/avendb-network-2026-10-23.json). This retains every sample's exact byte counts, timing fields, HTTP version/status, TLS result, completion flags, original source SHA-256, source commit, and workflow metadata. Numeric values are copied without rounding; rates above are display-rounded. Private addresses, credentials, request headers, and account/vault data are absent. The committed helper and workflow are the same scripts used for these samples; their exact source hashes are included.

No synchronized avenDB useful-byte/wall-clock measurement was taken; therefore no utilization percentage or sync improvement is claimed. Variation from the 15:51–16:08 CEST samples is not by itself a production regression: these are short HTTP requests to different paths/at different times. In particular the host upload was 48.81 Mbps here versus 414.56 Mbps earlier; this run records that outcome without repeating until a preferable number appears.

For physical iPhone/iPad, use the existing [bounded diagnostic page](https://maia.city/diagnostics/network/) on each actual device, select its device label and note Wi-Fi/cellular/VPN, press Start and keep the page foregrounded, then share its local Copy/Save JSON. The page uses at most 40 MiB download + 8 MiB random upload plus 256 KiB manifest discovery; it cancels when backgrounded. No authenticated remote browser surface for those physical devices was available in this audit, so their bandwidth is still open and must not be inferred from Mac peer-sync counters or desktop emulation. Results are not automatically uploaded anywhere.

Release/restart checks are separate: [no-reset acceptance sequence](AVENDB_RELEASE_ACCEPTANCE.md).


## Physical Home Screen PWA samples — 2026-10-24

Both user-provided runs completed in standalone mode on deployed revision23286402. The user identified the first as iPad although its selector remained iPhone. Connection type was not supplied. Sanitized evidence: [mobile network measurements](evidence/avendb-mobile-network-2026-10-24.json).

| Device | Cloudflare download | Cloudflare upload | Maia range download | Maia headers |
|---|---:|---:|---:|---:|
| iPad |54.25Mbps|23.71Mbps|129.80Mbps|35ms|
| iPhone |196.08Mbps|71.32Mbps|105.35Mbps|19ms|

Each Maia request received8MiB with HTTP206; download32MiB and upload8MiB completed. Cloudflare and Maia are different paths/protocols/sample sizes, so their rates are not interchangeable maxima. Small-entry10–20second delays are not explained by these HTTP capacity samples alone. Actual accepted unique-edit throughput and end-to-end latency remain unmeasured. Short diagnostic completion proves the panel is usable on both devices, not that the repeated iPhone unlock symptom is permanently resolved.

## Hosted runtime and bounded network sample — 24 October 2026, 12:41 CEST

[Audit run 40086908338](https://github.com/MyAvenCEO/maiacity/actions/runs/40086908338) completed from source `a06022dcc392774492f68e0366c2559b1754fede`. This identifies the diagnostic scripts, **not the running peer version**. All guest collectors completed without errors. The existing workflow used pinned SSH trust, performed read-only guest/provider checks and bounded synthetic transfers, and did not deploy, restart services, or open application payloads. Sanitized evidence: [hosted measurements](evidence/avendb-hosted-audit-2026-10-24.json). Raw artifact SHA-256 values are retained; process IDs are removed. No credentials, account/vault content, or private addresses are included.

| Actual path | Payload | Total request time | End-to-end Mbps | MiB/s |
| --- | ---: | ---: | ---: | ---: |
| Cloudflare → hosted peer machine | 67,108,864 bytes | 0.493496 s | 1087.89 | 129.69 |
| Hosted peer machine → Cloudflare | 16,777,216 bytes | 0.299704 s | 447.83 | 53.39 |

Both transfers completed with HTTP 200 and verified TLS. Three fresh empty requests took 117.563 / 111.668 / 102.789 ms including DNS/TCP/TLS/HTTP; these are not ICMP RTTs. Download body-only rate was 1608.27 Mbps, which excludes request setup and must not replace the end-to-end figure. These single-stream bounded samples do not measure avenDB useful-byte throughput or utilization. Aggregate provider traffic likewise cannot determine sync efficiency.

The hosted avenDB container was running with image ID `sha256:86478a8ff7bc4bf95e68a4c5d9a0c42d8837f054142da12f0c8031664812026f`. Its OCI revision label was null, so its actual source commit remains **unknown**. The internal feed health endpoint answered: uptime 15,862 seconds, no current recorded panic, zero starts during the last hour. Docker's lifetime restart counter was 6; OOMKilled was false. This does not establish external relay availability, bucket-write readiness, or application sync convergence; backup completeness was unknown.

At this instant the machine had 3.73 GiB physical RAM, 1.21 GiB available, no swap, and 16.47 GiB disk available. avenDB RSS was 1.315 GiB; container usage was 1.342 GiB; API Docker usage was 628.7 MiB. Short interval CPU samples were 91% and 96% idle with zero iowait; load averages were 0.53 / 0.34 / 0.28. avenDB's reported 4 GiB limit exceeds host physical RAM and is not a guaranteed usable allowance while other processes share the host.

Historical pressure remains relevant: cumulative host `oom_kill=95`; the previous recorded avenDB run ended `killed`, last reporting zero machine-free memory and approximately 2.65 GiB RSS. Neither counter identifies a current OOM, nor does it attribute all 95 historical kills to avenDB. Current run OOM kills were 0.

### Image provenance limits

The API container's raw OCI revision label is `744846f844374847c902b5e7fd59b4342a51ef99`, distinct from the last successful deployment workflow SHA `23286402ee4b88dfdb36441fdd1123a9a48cac36`. **Do not report the label as the API application's actual commit.** Direct source inspection at both `23286402` and the current integration shows that `api/Dockerfile` starts from `oven/bun:1.4.2-alpine` and sets no project revision LABEL; `.github/workflows/api.yml` tags with `${github.sha}` but supplies no revision labels. An inherited base-image label is possible, but its origin was not independently checked. Likewise `avendb/Dockerfile.server` and `.github/workflows/avendb.yml` set no revision label; the missing label therefore provides no deployment-failure evidence. The diagnostic only collects image ID and OCI label, not Config.Image/tag. Resolve image tag/digest provenance through trusted inspection before claiming a deployed source revision.

Remaining: final-release exact image/source identity, external health and bucket readiness, actual useful avenDB bytes and entry latency on Mac/iPhone/iPad, preserved data through offline/reconnect, and physical iPhone reload stability. This audit closes the current host capacity/headroom observation only.
