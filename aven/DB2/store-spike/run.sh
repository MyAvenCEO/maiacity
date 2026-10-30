#!/bin/sh
# The spike in the box (store-spike/README.md): `bun run up`, `docker compose -p avensandbox stop alice browsers`
# (their keys are borrowed), then `sh store-spike/run.sh fs|s3|memory`. The cast's test seeds, public on purpose.
seed() { printf "avenSANDBOX test signer: %s" "$1" | sha256sum | cut -d" " -f1; }
docker run --rm --network avensandbox_wan -v avensandbox_target:/target:ro -v spike_data:/data \
  -e SPIKE_RELAY_URL=http://aven:3340 -e SPIKE_ALICE_SECRET=$(seed alice-peer) -e SPIKE_LIGHT_SECRET=$(seed bob-peer-light) \
  -e SPIKE_STORE=$1 -e SPIKE_STORE_PATH=/data -e SPIKE_S3_ENDPOINT=http://s3:7070 -e SPIKE_S3_BUCKET=aven \
  -e SPIKE_S3_KEY=avensandbox -e SPIKE_S3_SECRET=avensandbox-test-secret \
  -e SPIKE_SIZE -e SPIKE_WAYS -e SPIKE_PARALLEL -e RUST_LOG \
  ${AVENSANDBOX_IMAGE:?the box image} /target/debug/spike
