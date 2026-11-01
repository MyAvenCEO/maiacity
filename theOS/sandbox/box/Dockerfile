# avenSANDBOX's image, owned by theOS (theOS/aip/AIP-2.json, D-24, D-33): every tool theOS's checks are built and run
# with, never our code. The base images are pinned by digest and every tool by version; the apt packages (the
# base's Ubuntu noble) and the rustup and elan installers are not, so a rebuild may take their newer patches. Its build context is this folder alone, and its tag is the hash of this
# folder and of .github/workflows/avensandbox-image.yml, which builds it on every push that changes either; theOS/sandbox/
# run.sh pulls it and runs a command inside it with theOS/ mounted, the same in a cloud session, on a runner and on a Mac.
# avenDB's own step (compiling its third-party crates into the image) stayed behind: it comes back for theOS's own
# crates when theOS has a Cargo workspace.

FROM ghcr.io/versity/versitygw:v1.10.0@sha256:89cad13cc981986ee284cbafea4613f9533ce6fd5f37a2c96c4c4fb8adb3a316 AS versitygw
RUN cp "$(command -v versitygw)" /versitygw

FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:47b510dd9230bf0b9bfc9b20102241e577ea7a99334ab4c3ca19f19770e9b8ea

ARG RUST_VERSION=1.99.1
ARG WASM_BINDGEN_VERSION=0.2.130
ARG BUN_VERSION=1.4.4
ARG ELAN_VERSION=v4.2.4
ARG LEAN_VERSION=v4.35.0
ARG RUST_NIGHTLY=nightly-2026-10-30
ARG CARGO_FUZZ_VERSION=0.13.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates xz-utils \
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

# versitygw: S3 over a folder, with conditional writes on PUT and DELETE (If-Match, If-None-Match). Kept with every tool
# (D-33), for a store tested against S3 in the box. The build fails here if the binary can't run on this base.
COPY --from=versitygw /versitygw /usr/local/bin/versitygw
RUN versitygw --help > /dev/null

# clang and llvm: crates that compile C for the wasm32 target (ring, under iroh) need clang, which gcc can't replace.
# Kept with every tool (D-33). A layer of its own near the end, so the layers above stay cached.
RUN apt-get update \
    && apt-get install -y --no-install-recommends clang llvm \
    && rm -rf /var/lib/apt/lists/* \
    && clang --version > /dev/null && llvm-ar --version > /dev/null

# The fuzzer: libFuzzer's sanitizers need a nightly, pinned by date, used only by `cargo fuzz`; every build and test
# stays on the stable toolchain above. Kept with every tool (D-33). cargo-fuzz itself builds on
# stable. A layer of its own near the end, so the layers above stay cached.
ENV AVEN_NIGHTLY=${RUST_NIGHTLY}
RUN rustup toolchain install "${RUST_NIGHTLY}" --profile minimal \
    && cargo install cargo-fuzz --version "${CARGO_FUZZ_VERSION}" --locked \
    && rm -rf /opt/cargo/registry /opt/cargo/git \
    && cargo fuzz --version


WORKDIR /work
