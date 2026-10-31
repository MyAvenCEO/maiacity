# avenPEER's slim image, ghcr.io/myavenceo/aven/peer (PRODUCTION.md, "The slim image"): the `aven-peer` binary,
# built in the box's own image, copied onto a minimal base. What ships is the node, never the box. Its build context is
# aven/DB2, cut down by peer.Dockerfile.dockerignore to the workspace's crates. Built only on GitHub
# (.github/workflows/avenpeer-image.yml), for amd64 and arm64, and tagged with a hash of its inputs (deploy/tag.mjs).

# The box, by digest: the workflow resolves the checkout's box (sandbox/box/tag.mjs) and passes it, so the compiler,
# the crates and their sources are exactly those every peer in the box is tested with.
ARG BOX
FROM ${BOX} AS build
WORKDIR /src
COPY . .
# aven/runtimes' file registry, which the Peer takes by path (`../../../runtimes/registry`): the workflow's named
# context `registry` (.github/workflows/avenpeer-image.yml)
COPY --from=registry . /runtimes/registry
# The box's registry holds every crate the lockfile names, so nothing is downloaded.
RUN cargo build --release --locked --offline -p aven-peer \
    && strip -o /aven-peer target/release/aven-peer

# Distroless cc (glibc, libgcc, CA certificates, no shell), Debian 13, as its user nonroot (65532), pinned by digest
# at its newest release (30 Oct 2026).
FROM gcr.io/distroless/cc-debian13:nonroot@sha256:3ee00291cf386ec52a552e6a858d555debd74776eb4bfa53fa3df2cd6677515e
COPY --from=build /aven-peer /usr/local/bin/aven-peer
LABEL org.opencontainers.image.source=https://github.com/myavenceo/maiacity \
      org.opencontainers.image.description="avenPEER: the aven-peer node; --relay makes it the Aven Peer"
ENTRYPOINT ["/usr/local/bin/aven-peer"]
