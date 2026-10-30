#!/bin/sh
# Lean's test vectors (README, rule 10): each spec's `lake exe vectors` writes its examples and generated cases as
# JSON beside it, in core/spec/vectors, id/spec/vectors and db/spec/vectors, where they are committed. In the box,
# from aven/DB2:
#   bun run box sh sandbox/vectors.sh           writes them
#   bun run box sh sandbox/vectors.sh --check   writes them elsewhere and fails when they differ from what's committed
# `bun run up --check` runs the check.
set -e
stale=0
for spec in core/spec id/spec db/spec; do
  (cd $spec && lake build -q)
  if [ "$1" = "--check" ]; then
    fresh=$(mktemp -d)
    (cd $spec && lake exe vectors "$fresh")
    if ! diff -r -q "$spec/vectors" "$fresh" > "$fresh.diff"; then
      sed "s|$fresh|the model's|" "$fresh.diff"
      stale=1
    fi
    rm -rf "$fresh" "$fresh.diff"
  else
    (cd $spec && lake exe vectors)
  fi
done
if [ $stale = 1 ]; then
  echo "vectors: the committed vectors aren't the model's; regenerate them: bun run box sh sandbox/vectors.sh"
  exit 1
fi
[ "$1" = "--check" ] && echo "vectors: core/spec, id/spec and db/spec are the model's"
exit 0
