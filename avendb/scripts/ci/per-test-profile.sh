#!/bin/sh
# A cargo target runner for avendb-assurance.yml's coverage job: nextest runs every test as a process of its own, as
# `<binary> <test name> --exact --nocapture`; this names that process's coverage profile after the binary and the test,
# so each test's lines can be told apart (scripts/test-value.mjs). Listing runs and anything else share one name.
set -eu
bin=$1
shift
name=
case " $* " in
*" --list "*) ;;
*) for a in "$@"; do case $a in --*) ;; *) name=$a; break ;; esac; done ;;
esac
stem=$(basename "$bin" | sed 's/-[0-9a-f]\{16\}$//')
# nextest names the binary and the test itself (`avendb::engine`, `a_test`); the file name keeps them, ':' as '~'
binary=${NEXTEST_BINARY_ID:-$stem}
name=${NEXTEST_TEST_NAME:-$name}
if [ -n "$name" ]; then
	export LLVM_PROFILE_FILE="$AVENDB_PROFILES/$(printf '%s__%s' "$binary" "$name" | tr ':' '~').profraw"
else
	export LLVM_PROFILE_FILE="$AVENDB_PROFILES/_other/%p.profraw"
fi
exec "$bin" "$@"
