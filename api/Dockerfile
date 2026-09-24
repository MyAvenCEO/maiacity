# One small Bun process. No build step: Bun runs the TypeScript directly.
# Built from the repo root, because the API shares the game's rules in game/.
FROM oven/bun:1.4.2-alpine
WORKDIR /app/api
COPY api/package.json api/bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production
COPY api/src ./src
COPY game /app/game
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
