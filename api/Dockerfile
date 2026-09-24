# One small Bun process. No build step: Bun runs the TypeScript directly.
FROM oven/bun:1.4.2-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production
COPY src ./src
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/index.ts"]
