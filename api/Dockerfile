# One small Bun process. No build step: Bun runs the TypeScript directly.
# Built from the repo root, because the API shares the game's rules in game/ and the code entries in code/.
FROM oven/bun:1.4.4-alpine
WORKDIR /app/api
# The lockfile is required and installed as is: if it does not match package.json the build fails, never resolves afresh
COPY api/package.json api/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY api/src ./src
COPY game /app/game
COPY code /app/code
# game/ imports packages too (game/code/sources/avendb.js: @noble/hashes) and reads the frozen engines the repo ships:
# its modules resolve node_modules from /app upward, so the API's are linked there, and engines.json sits where the repo keeps it
RUN ln -s /app/api/node_modules /app/node_modules
COPY src/lib/sandbox/engines.json /app/src/lib/sandbox/engines.json
# avenDB's WebAssembly, the page's device module, which checks the proof of the code the API runs (H2:
# game/code/sources/feed.js `verifyProof`)
COPY src/lib/avendb/device/avendb_browser.js src/lib/avendb/device/avendb_browser_bg.wasm /app/src/lib/avendb/device/
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
