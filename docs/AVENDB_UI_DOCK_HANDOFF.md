# Sync status and shared app dock

UI-only release, independent of pending Rust bootstrap work.

- Layout owns the dock and its host; no ad-hoc body host. Mounted actions queue until the host exists, unregister when destroyed, and move to a replacement host.
- Navigation is normal flow below the stack. Status, transient notices, profile menu, ledger mint action and renderer progress/readout participate in it. Tall stacks scroll within the safe-area viewport without displacing navigation. Full-screen modal/dialog/game surfaces remain independent.
- Foreground status counts mounted pending query windows and current asset reads. Cancelled/unmounted/device-replaced windows clear observations. No identities or query data retained. Local responses do **not** establish complete manifest/discovery/file readiness; unknown status says “View completeness unknown.” Completed mounted local reads say “Local view loaded” without claiming peer discovery complete; missing/error responses say “Local view unavailable.” Expanded status has only two short availability explanations; verbose coverage details live in diagnostics.
- Background status remains announced **log** coverage (API does not expose an entry-only total). “Up to date” applies to incoming announced logs; expanded details retain outgoing acknowledgment and file-completeness limitations. No global-history percentage masquerades as view progress.

Validation: 21 focused Bun regressions passed (query-window lifecycle, status registry, layout-host lifecycle); five modified Svelte components compile. Headless Chrome geometry fixture passed 320×568, 390×844 and 1024×768 with status, long notice and profile menu simultaneously above navigation. Run `bun scripts/checks/app-dock.mjs` (CHROME_PATH optionally overrides installed Chrome).

Remaining: genuine authoritative per-manifest completeness is not supplied by current deployed engine; physical iPhone/iPad acceptance and actual rendered app visual inspection remain delivery checks. Passive recent diagnostic samples are separate from these mounted-window counters.

Follow-up coverage: Sparks/Artifacts picked and capture controls, shared sandbox walking hint and world notices, MaiaCity V1/V2 tour/mint controls and errors, and the probe's pinned preview now use the same host. Existing game cinematic mint-control hiding is preserved explicitly across the portal. Corner HUD controls, joysticks and full-screen modal surfaces are unchanged. Seven changed Svelte components compile.
