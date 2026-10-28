#!/bin/sh
# Checks each protocol model against the result its header expects ("// Expected: c0c1a0a0"): one letter and digit per
# query, in order, 0 where the query holds and 1 where Verifpal finds an attack. Needs Verifpal 1.6.5 on the PATH, or
# its path in $VERIFPAL (`cargo install verifpal --version 1.6.5`, with Rust 1.98 or later). The hello takes some six
# minutes, the others under one each.
set -eu
cd "$(dirname "$0")"
verifpal=${VERIFPAL:-verifpal}
failed=0
for model in ${@:-*.vp}; do
	expected=$(sed -n 's|^// Expected: \([ca01]*\)$|\1|p' "$model")
	got=$("$verifpal" verify --result-code "$model" | tail -n 1)
	if [ "$got" = "$expected" ]; then
		echo "$model: $got, as expected"
	else
		echo "$model: $got, where $expected was expected"
		failed=1
	fi
done
exit $failed
