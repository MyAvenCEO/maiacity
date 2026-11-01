#!/bin/bash
# 'Only from main' (aip-59ad, c1): production takes changes from main of this repository only.
#   HEAD_REF=<head branch> HEAD_REPO=<owner/name of the head> REPO=<owner/name of this repository> theOS/release/from-main.sh
# GitHub's names keep their case as typed (MyAvenCEO/maiacity), so the repositories are compared without case.
set -uo pipefail
head_ref=${HEAD_REF:-} head_repo=${HEAD_REPO:-} repo=${REPO:-}
[ -n "$repo" ] || { echo "from-main.sh: REPO is not set" >&2; exit 2; }
if [ "$head_ref" = main ] && [ "$(printf '%s' "$head_repo" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')" ]; then
	echo "The pull request comes from main of $repo."
	exit 0
fi
echo "::error::production takes changes from main of $repo only; this pull request comes from ${head_repo:-?}:${head_ref:-?}"
exit 1
