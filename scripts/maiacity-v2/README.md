# MaiaCity V2

V2 has its own engine, UI, API routes and `v2_games` row. Migration `0052-maiacity-v2` captures the complete live V1 JSON in an immutable `game_fork_snapshots` row, copies it to V2 and adds seat C. V1 is not updated. The snapshot is captured when the migration runs, not when the source files are copied. No production migration was run during implementation.

On first V2 load, economy version 18 archives the inherited state and starts a fresh two-COOP economy while preserving identities and world progress. P1/P2 each mint 124,800 HEARTS, invest 50,000 in MaiaCOOP and 25,000 in Village COOP, keeping the existing split. Their initial wallets are 49,800 HEARTS, 25,000 maiaMIND and 12,500 villageMIND. The AMM starts at 10,000 maiaMIND / 5,000 villageMIND and uses constant-product pricing with the existing 0.3% swap fee. Village inherits Tribe's housing and equipment; players pay Village rent and Village pays Maia for land. The reset marker prevents a second seed. No live reset was performed during implementation.

Trailer 3's existing Studio timeline is revised in AIP #28, with 50 shots and a 310.77-second duration:
https://maia.city/app/aips/?aip=f6564f7154e7636c8a9152a180af2ab532169e612abe31d2a5ba31564a65c366

An owner must accept that AIP to apply the timeline revision. Deploy the matching V2 world and sync the `actors/elder-woman@1` and `things/water-canister@1` recipes before production playback. Narration clips contain editable text, not recorded voice audio. Studio loads live 3D worlds in every tab, prepares the active world's shots together, and waits at world transitions. Game tree markers remain visible during free play, including at screen edges.

To remeasure intro timing locally:

```sh
VITE_RECIPE_FEED=dev bun run dev --port 5197
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' bun scripts/maiacity-v2/bake-intro.mjs --base http://localhost:5197 A B C
```
