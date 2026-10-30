# The wasm each way adds (store-spike/README.md): `bun run box sh store-spike/wasm-size.sh`.
set -e
for prof in dev release; do
  for f in "" wasm-a wasm-b; do
    cargo build -q -p aven-store-spike --lib --target wasm32-unknown-unknown --profile $prof ${f:+--features $f}
    d=$([ $prof = dev ] && echo debug || echo release)
    mkdir -p /tmp/w && wasm-bindgen --target web --out-dir /tmp/w target/wasm32-unknown-unknown/$d/aven_store_spike.wasm
    echo "$prof ${f:-base} raw=$(stat -c%s target/wasm32-unknown-unknown/$d/aven_store_spike.wasm) bindgen=$(stat -c%s /tmp/w/aven_store_spike_bg.wasm) gz=$(gzip -9c /tmp/w/aven_store_spike_bg.wasm | wc -c)"
  done
done
