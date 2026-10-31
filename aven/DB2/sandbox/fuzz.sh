#!/bin/sh
# The docs layer's fuzz targets (db/docs/fuzz; db/docs/README.md, "Importing"), in the box, on the image's dated nightly
# ($AVEN_NIGHTLY). From aven/DB2:
#   bun run box sh sandbox/fuzz.sh                 every target, 600 s each
#   bun run box sh sandbox/fuzz.sh envelope 60     one target, for 60 s
# Targets: envelope (any bytes as an envelope), changes (any bytes as the Loro update in a member's signed first
# envelope, so they reach Loro), segment (any bytes as a sealed segment). Each run keeps its corpus in
# db/docs/fuzz/corpus/<target> and any crash in db/docs/fuzz/artifacts/<target>, and ends with libFuzzer's numbers.
set -e
cd db/docs
targets=${1:-"envelope changes segment"}
seconds=${2:-600}
for t in $targets; do
	echo "fuzz: $t for ${seconds}s on ${AVEN_NIGHTLY}"
	cargo "+${AVEN_NIGHTLY}" fuzz run "$t" --fuzz-dir fuzz -- -max_total_time="$seconds" -print_final_stats=1
done
