#!/bin/sh
# Lean's test vectors (README, rule 10): each spec's `lake exe vectors` writes its examples and generated cases as
# JSON beside it, in core/spec/vectors, id/spec/vectors and db/spec/vectors, and outside aven/DB2 in
# aven/runtimes/spec/vectors, where they are committed. aven/actor/spec is built, and checked the same way once it
# exports vectors. The specs outside aven/DB2 are at /aven/<name>/spec in the box (sandbox/up.mjs, `specVolumes`);
# one that isn't there yet is skipped. In the box, from aven/DB2:
#   bun run box sh sandbox/vectors.sh           writes them
#   bun run box sh sandbox/vectors.sh --check   writes them elsewhere and fails when they differ from what's committed
# `bun run up --check` runs the check.
set -e
stale=0
checked=""
for spec in core/spec id/spec db/spec /aven/runtimes/spec /aven/actor/spec; do
  [ -f "$spec/lakefile.toml" ] || continue
  (cd $spec && lake build -q)
  # a spec without a `vectors` program is only built
  grep -q '^name = "vectors"' "$spec/lakefile.toml" || continue
  checked="$checked $spec"
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
[ "$1" = "--check" ] && echo "vectors: the model's in$checked"
exit 0
