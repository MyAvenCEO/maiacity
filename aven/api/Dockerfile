# One small Bun process. No build step: Bun runs the TypeScript directly.
# Built from the repo root, because the API shares the game's rules in maia/content/game/ and the code entries in
# maia/content/code/. The image keeps the repo's layout under /app, so what their modules import is where it is in the repo.
FROM oven/bun:1.4.4-alpine
WORKDIR /app/aven/api
# The lockfile is required and installed as is: if it does not match package.json the build fails, never resolves afresh
COPY aven/api/package.json aven/api/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY aven/api/src ./src
COPY maia/content/game /app/maia/content/game
COPY maia/content/code /app/maia/content/code
# maia/content/game/ imports packages too (maia/content/game/code/sources/avendb.js: @noble/hashes) and the frozen engines
# the repo ships (aven/kernel/engines.js, which reads aven/kernel/sandbox/engines.json): its modules resolve node_modules
# from /app upward, so the API's are linked there, and the engines sit where the repo keeps them
RUN ln -s /app/aven/api/node_modules /app/node_modules
COPY aven/kernel/engines.js /app/aven/kernel/engines.js
COPY aven/kernel/sandbox/engines.json /app/aven/kernel/sandbox/engines.json
# avenDB's WebAssembly, the page's device module, which checks the proof of the code the API runs (H2:
# maia/content/game/code/sources/feed.js `verifyProof`)
COPY aven/db/page/device/avendb_browser.js aven/db/page/device/avendb_browser_bg.wasm /app/aven/db/page/device/
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
