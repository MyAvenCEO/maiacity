# iPhone post-unlock restart: evidence interpretation

Source review found no automatic browser-session reload call in the current
session lifecycle. The automatic `location.reload()` is confined to native Mac
bridge-status recovery. Browser worker failures reject calls and terminate the
worker; that path does not navigate or reload the document. This does not prove
the physical iPhone restart is fixed or identify an operating-system cause.

The existing sanitized, 64-event local journal now presents an interpretation:
same-document lock; explicit app reload request; app unloading navigation;
new document with a recorded exit; or unexplained document restart. Durable
boundaries remain usable when the browser drops sessionStorage. Missing exit
signals never establish memory pressure. No account information, URLs, errors,
credentials or additional telemetry are collected. No unlock/security behavior
changes and no data reset.

Validation: 14 Bun tests / 41 assertions passed across restart-evidence.test.js
and lifecycle.test.js; LifecycleReport compiled with Svelte. Physical iPhone
reproduction plus its exported event journal remain necessary for attribution.
