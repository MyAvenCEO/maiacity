# avenSANDBOX's image: the tools, never our code (aven/DB2/SANDBOX.md, "Tools in the image, our code outside it").
# Every version is pinned at its newest stable release. The image's tag is the first 16 hex digits of this file's
# SHA-256 (.github/workflows/avensandbox-image.yml, aven/DB2/sandbox/up.mjs), so a change here is a new box. Only
# GitHub builds it, on every push that changes this file; `bun run up` only pulls it.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

ARG RUST_VERSION=1.99.1
ARG WASM_BINDGEN_VERSION=0.2.129
ARG BUN_VERSION=1.4.4
ARG ELAN_VERSION=v4.2.4
ARG LEAN_VERSION=v4.35.0

# clang and llvm: ring, under iroh, compiles C for the Peer-Light's wasm32 target, which gcc can't
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates xz-utils clang llvm \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo ELAN_HOME=/opt/elan \
    PATH=/opt/cargo/bin:/opt/elan/bin:$PATH

RUN arch=$(uname -m) \
    && curl -fsSL -o /tmp/rustup-init "https://static.rust-lang.org/rustup/dist/${arch}-unknown-linux-gnu/rustup-init" \
    && chmod +x /tmp/rustup-init \
    && /tmp/rustup-init -y --no-modify-path --profile minimal --default-toolchain "${RUST_VERSION}" \
        --target wasm32-unknown-unknown --component rustfmt,clippy \
    && rm /tmp/rustup-init

RUN cargo install wasm-bindgen-cli --version "${WASM_BINDGEN_VERSION}" --locked \
    && rm -rf /opt/cargo/registry /opt/cargo/git

RUN npm install -g "bun@${BUN_VERSION}"

# Lean's toolchain itself, not only elan: elan fetches a toolchain on first use, from GitHub's release storage,
# which a cloud session's network doesn't reach.
RUN arch=$(uname -m) \
    && curl -fsSL "https://github.com/leanprover/elan/releases/download/${ELAN_VERSION}/elan-${arch}-unknown-linux-gnu.tar.gz" \
        | tar -xz -C /tmp \
    && /tmp/elan-init -y --no-modify-path --default-toolchain "leanprover/lean4:${LEAN_VERSION}" \
    && rm /tmp/elan-init \
    && elan toolchain install "leanprover/lean4:${LEAN_VERSION}" \
    && lean --version

WORKDIR /work
