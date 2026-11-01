#!/bin/bash
# theOS's health check (aip-59ad, c3), from the runner. Caddy answers a missing path with index.html and 200 (avenOS's
# block), so a status is not enough: each page and doc must be byte for byte the file in the deployed tree. The Aven
# Peer's paths must answer as they did before the deploy (d-56), and answer at all: a peer already down is red too.
#   health.sh before <base> <file>            keeps the Aven Peer's answers (/ping, /healthz: status; /aven.json: status and body)
#   health.sh after <base> <tree> <file>      compares the pages with <tree> and the Aven Peer's answers with <file>
set -uo pipefail
mode=${1:?before or after}; base=${2:?the base URL}
peer() { for p in /ping /healthz /generate_204 /aven.json; do
	body=$(curl -sS --max-time 15 -o - -w '\n%{http_code}' "$base$p" 2> /dev/null || printf '\nnone')
	code=${body##*$'\n'}; body=${body%$'\n'*}
	if [ $p = /aven.json ]; then echo "$p $code $(printf '%s' "$body" | sha256sum | cut -c1-16)"; else echo "$p $code"; fi
done; }
if [ "$mode" = before ]; then peer > "${3:?the file}"; cat "$3"; exit 0; fi
tree=${3:?the tree}; file=${4:?the file}
red=0
row() { echo "| $1 | $2 |"; [ "$3" = ok ] || red=1; }
echo "| check | result |"; echo "| --- | --- |"
for p in / /docs/index.html /avenCEO/index.html /brain/index.html /brain/ids.json /aip/aip-59ad.json; do
	f=$tree$p; [ "$p" = / ] && f=$tree/index.html
	got=$(mktemp); code=$(curl -sS --max-time 15 -o "$got" -w '%{http_code}' "$base$p" 2> /dev/null || echo none)
	if [ ! -f "$f" ]; then row "$p" "not in the tree" red
	elif [ "$code" = 200 ] && cmp -s "$got" "$f"; then row "$p" "200, the tree's bytes" ok
	else row "$p" "$code, not the tree's bytes" red; fi
	rm -f "$got"
done
now=$(peer)
while read -r line; do
	p=${line%% *}
	code=$(cut -d' ' -f2 <<< "$line")
	if [ "$p" != /aven.json ] && [ "$code" != 200 ] && [ "$code" != 204 ]; then row "$p" "not answering before the deploy either: $code" red; continue; fi
	if grep -qxF "$line" <<< "$now"; then row "$p" "as before: ${line#* }" ok; else row "$p" "was ${line#* }, now $(grep "^$p " <<< "$now" | cut -d' ' -f2-)" red; fi
done < "$file"
exit $red
