# Shared screen controls

The app layout owns diagnostics/title, center controls, sync, and a wrapping stats row. `screenSlot` moves actual control nodes into those hosts, preserving handlers and restoring nodes when a host goes away. Nested titles show only the active final title. A ResizeObserver publishes header clearance, including narrow-screen wraps and native traffic lights.

Games reuse the slots for clocks. Sandbox 7 moves its existing physics toolbar; Sandbox 8 moves its title, simulation controls and stats without a second top bar. Studio moves its working tabs to the center slot and extends to the viewport bottom; the timeline scroll area reserves reachability behind the navigation pill. V2 watering uses the existing bottom dock slot.

Floating light surfaces share `--overlay-paper`, dark green surfaces `--overlay-green`, and embedded Sandbox 8 glass shares `--overlay-alpha` (75%). Text and icons are not faded with container opacity.

Dashboard cover files and the manifest declaration are proposed in AIP-36 (ebd4200d8cbe8f6c4267efe936d7e3ecd3c7f84eca7680474fac3486c34ff924). The two navigation references need that proposal accepted to resolve locally. These are actual running-game captures, with no remote fallback.

Validation: screen/foot lifecycle tests pass (2 tests, 13 assertions); Svelte check has zero errors; Chromium desktop/phone previews checked for overflow and runtime errors. Actual Sandbox 7/8 mount and render checked. The combined native build and user acceptance remain delivery checks.
