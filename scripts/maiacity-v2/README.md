# MaiaCity V2

V2 has its own engine, UI, API routes and `v2_games` row. Migration `0052-maiacity-v2` captures the complete live V1 JSON in an immutable `game_fork_snapshots` row, copies it to V2 and adds seat C. V1 is not updated. The snapshot is captured when the migration runs, not when the source files are copied. No production migration was run during implementation.

On first V2 load, economy version 18 archives the inherited state and starts a fresh two-COOP economy while preserving identities and world progress. P1/P2 each mint 124,800 HEARTS, invest 50,000 in MaiaCOOP and 25,000 in Village COOP, keeping the existing split. Their initial wallets are 49,800 HEARTS, 25,000 maiaMIND and 12,500 villageMIND. The AMM starts at 10,000 maiaMIND / 5,000 villageMIND and uses constant-product pricing with the existing 0.3% swap fee. Village inherits Tribe's housing and equipment; players pay Village rent and Village pays Maia for land. The reset marker prevents a second seed. No live reset was performed during implementation.

Trailer 3's existing Studio timeline is revised in AIP #28, with 50 shots and a 310.77-second duration:
https://maia.city/app/aips/?aip=f6564f7154e7636c8a9152a180af2ab532169e612abe31d2a5ba31564a65c366

An owner must accept that AIP to apply the timeline revision. Deploy the matching V2 world and sync the `actors/elder-woman@1` and `things/water-canister@1` recipes before production playback. Narration clips contain editable text, not recorded voice audio. Studio loads live 3D worlds in every tab, prepares the active world's shots together, and waits at world transitions. Game tree markers remain visible during free play, including at screen edges.

V2 now runs V1's code (Goal 7, 2026-10-28): its engine is V1's rules (game/maiacity-v1/core.js) with V2's config
(game/maiacity-v2/engine.js), and its game screen and world are V1's with V2's edition (src/lib/maiacity-v2/game.js,
src/lib/maiacity-v2/world.js).

To remeasure intro timing locally, open `/games/maiacity-v2/?film&area=A|B|C&remeasure` on a dev server
(`VITE_RECIPE_FEED=dev bun run dev --port 5197`), wait for `window.__world.intro`, and write
`window.__world.intro.schedule()` to `src/lib/maiacity-v2/intro/<seat>.json`.
