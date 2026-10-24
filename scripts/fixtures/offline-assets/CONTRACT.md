# Offline Assets component contract

The real `Assets.svelte` mounts with `world.entriesComplete:false`. Its canonical
local engine boundary (`api.ask`) is synthetic; no account, live store, passkey,
peer or asset source is used. Every external network request is blocked. Only
recipe-scoped `database` and `entry_views` are permitted. A compiled rune-based
session stand-in changes `revision`, proving the component reacts to local changes
without waiting for a broad-world publication. The fixture checks initial local
empty state, explicit unavailable-inventory error, recipe validation refusal and
removal. It does not validate Three.js rendering or native persistence.

Run `bun scripts/test-avendb-offline-assets.mjs` and append `--webkit` for WebKit.
Physical installed-app offline restart remains a separate acceptance check. Native
hash navigation is covered by startup-summary unit tests; this fixture mounts the
actual Assets component, not Shell/SvelteKit routing.
