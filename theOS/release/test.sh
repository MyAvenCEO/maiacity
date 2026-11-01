#!/bin/bash
# theOS's release test (aip-59ad, c1). Checkpoint 1:
#  1. 'Only from main': passes for main of this repository (in any case of its name), fails for another branch, a
#     fork's main, or no head at all.
#  2. The workflow (.github/workflows/theos.yml): its three required jobs are named exactly as production's ruleset
#     names them (d-c219), none needs another and none skips but on a draft (a skipped job counts as passed), the pull
#     request trigger is production with no paths filter, push runs on production, no check reads a secret, the deploy
#     runs only on a push with both checks green, in the environment production, with the two deploy secrets alone,
#     and every action is pinned by commit.
#  3. Checkpoint 2, in a temporary folder: deploy.sh and undo.sh write only the new build and the links, refuse a
#     broken archive or one without index.html, change nothing for the same tree, undo to theOS's build before or to
#     avenOS; health.sh, against a local server, is red on the dashboard in place of a file, a changed /aven.json, a
#     silent /ping.
#  4. 'avenSANDBOX' refuses a box that is not published, and passes this commit's box (only with --box: it pulls the
#     box).
#   theOS/release/test.sh [--box]
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$here" rev-parse --show-toplevel)
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
fm() { HEAD_REF=$1 HEAD_REPO=$2 REPO=MyAvenCEO/maiacity "$here/from-main.sh" > /dev/null 2>&1; }

fm main MyAvenCEO/maiacity && ok "from main of this repository: passes" || bad "from main of this repository failed"
fm main myavenceo/maiacity && ok "the repository's name in another case: passes" || bad "the repository's name in another case failed"
fm claude/x MyAvenCEO/maiacity && bad "another branch passed" || ok "another branch: fails"
fm main someone/maiacity && bad "a fork's main passed" || ok "a fork's main: fails"
fm '' '' && bad "no head passed" || ok "no head: fails"

python3 - "$repo/.github/workflows/theos.yml" <<'PY' && ok "the workflow: names, no needs, triggers, the checks read no secret, the deploy (push, both checks, production, two secrets), pinned actions" || fails=$((fails + 1))
import re, sys, yaml
path = sys.argv[1]
text = open(path).read()
w = yaml.safe_load(text)
on = w.get(True) or w.get('on')
errors = []
names = {k: j.get('name') for k, j in w['jobs'].items()}
want = {'Only from main', 'avenSANDBOX', 'theOS'}
if not want <= set(names.values()): errors.append(f'job names {sorted(names.values())} are not {sorted(want)}')
allowed = {"github.event_name == 'pull_request' && !github.event.pull_request.draft", "github.event_name == 'push' || !github.event.pull_request.draft"}
for k, j in w['jobs'].items():
    if j.get('name') in want and j.get('needs'): errors.append(f'{k} needs {j["needs"]}')
    if j.get('name') in want and j.get('if') not in allowed: errors.append(f'{k} runs only if {j.get("if")!r}: a required job may skip only a draft')
pr = on.get('pull_request') or {}
if pr.get('branches') != ['production']: errors.append(f'pull_request branches {pr.get("branches")}')
if 'paths' in pr or 'paths-ignore' in pr: errors.append('pull_request has a paths filter')
if (on.get('push') or {}).get('branches') != ['production']: errors.append('push is not on production')
for k, j in w['jobs'].items():
    used = sorted(set(re.findall(r'secrets\.([A-Z_]+)', yaml.safe_dump(j))))
    if j.get('name') in want and used: errors.append(f'{k} reads secrets {used}')
deploy = [j for j in w['jobs'].values() if j.get('name') not in want]
if len(deploy) != 1: errors.append(f'{len(deploy)} jobs besides the three checks, not one deploy')
else:
    j = deploy[0]
    if sorted(set(re.findall(r'secrets\.([A-Z_]+)', yaml.safe_dump(j)))) != ['DEPLOY_KNOWN_HOSTS', 'DEPLOY_SSH_KEY']: errors.append('the deploy reads other secrets than DEPLOY_SSH_KEY and DEPLOY_KNOWN_HOSTS')
    if j.get('environment') != 'production': errors.append('the deploy is not in the environment production')
    if sorted(j.get('needs') or []) != ['box', 'check']: errors.append(f'the deploy needs {j.get("needs")}, not box and check')
    if not str(j.get('if', '')).startswith("github.event_name == 'push' && needs.box.result == 'success' && needs.check.result == 'success'"): errors.append('the deploy may run off a push or without both checks green')
    if 'echo "$SSH_KEY' in text or 'echo $SSH_KEY' in text: errors.append('the key is printed')
for u in re.findall(r'uses:\s*(\S+)', text):
    if not u.startswith('./') and not re.search(r'@[0-9a-f]{40}$', u): errors.append(f'{u} is not pinned by commit')
for e in errors: print('FAIL', e)
sys.exit(1 if errors else 0)
PY

# Checkpoint 2, in a temporary folder laid out like the server (/opt/maia-city/site/aven): avenOS's build current, then
# theOS's deploys and undos, each step's listing compared with the one before. No network, no server.
scratch=$(mktemp -d); trap 'rm -rf "$scratch"; [ -n "${srv:-}" ] && kill "$srv" 2> /dev/null' EXIT
site=$scratch/aven
mkdir -p "$site/releases/26.10.31v6" "$scratch/peer"
echo '<title>avenOS</title>' > "$site/releases/26.10.31v6/index.html"; ln -s releases/26.10.31v6 "$site/current"
echo '{"network":"aven"}' > "$site/aven.json"; touch "$scratch/peer/untouched"
mk() { # a tree with the given title, packed as git archive packs HEAD:theOS
	rm -rf "$scratch/t"; mkdir -p "$scratch/t/docs"; echo "<title>$1</title>" > "$scratch/t/index.html"; echo "$1" > "$scratch/t/docs/index.html"
	tar -czf "$scratch/$1.tar.gz" -C "$scratch/t" .; }
list() { (cd "$scratch" && find . -path ./t -prune -o -path ./peer -prune -o \( -type f -o -type l \) -print | sort | while read -r p; do [ -L "$p" ] && echo "$p -> $(readlink "$p")" || echo "$p"; done); }
cur() { readlink "$site/current"; }; prev() { readlink "$site/previous"; }
T1=$(printf 1%.0s {1..40}); T2=$(printf 2%.0s {1..40})
mk one; mk two
before=$(list)
bash "$here/deploy.sh" "$T1" "$scratch/one.tar.gz" "$site" > /dev/null 2>&1
changed=$(diff <(echo "$before") <(list) | grep '^[<>]' | sed 's/^[<>] //' | grep -v '^\./one.tar.gz$\|^\./two.tar.gz$' \
	| grep -v "^\./aven/releases/theos-111111111111/" | grep -v '^\./aven/current -> \|^\./aven/previous -> ' || true)
[ "$(cur)" = releases/theos-111111111111 ] && [ "$(prev)" = releases/26.10.31v6 ] && [ -z "$changed" ] && [ -f "$scratch/peer/untouched" ] \
	&& ok "a first deploy: the new build beside avenOS, current switched, previous is avenOS, nothing else written" \
	|| bad "a first deploy: current $(cur), previous $(prev), also changed: $changed"
bash "$here/deploy.sh" "$T1" "$scratch/one.tar.gz" "$site" > /dev/null 2>&1; [ "$(cur)" = releases/theos-111111111111 ] && [ "$(prev)" = releases/26.10.31v6 ] \
	&& ok "the same tree again: nothing changes" || bad "the same tree again moved the links: current $(cur), previous $(prev)"
echo broken > "$scratch/bad.tar.gz"; bash "$here/deploy.sh" "$T2" "$scratch/bad.tar.gz" "$site" > /dev/null 2>&1 && bad "a broken archive deployed" \
	|| { [ "$(cur)" = releases/theos-111111111111 ] && [ ! -e "$site/releases/theos-222222222222" ] && ok "a broken archive: refused, current where it was" || bad "a broken archive moved current to $(cur)"; }
rm -rf "$scratch/t"; mkdir -p "$scratch/t"; echo x > "$scratch/t/other.html"; tar -czf "$scratch/noindex.tar.gz" -C "$scratch/t" .
bash "$here/deploy.sh" "$T2" "$scratch/noindex.tar.gz" "$site" > /dev/null 2>&1 && bad "an archive without index.html deployed" \
	|| { [ "$(cur)" = releases/theos-111111111111 ] && ok "an archive without index.html: refused, current where it was" || bad "an archive without index.html moved current"; }
bash "$here/deploy.sh" "$T2" "$scratch/two.tar.gz" "$site" > /dev/null 2>&1
[ "$(cur)" = releases/theos-222222222222 ] && [ "$(prev)" = releases/theos-111111111111 ] && ok "a second deploy: previous is the first theOS build" || bad "a second deploy: current $(cur), previous $(prev)"
bash "$here/undo.sh" "$site" > /dev/null 2>&1
[ "$(cur)" = releases/theos-111111111111 ] && [ "$(prev)" = releases/theos-222222222222 ] && ok "undo: theOS to the theOS build before" || bad "undo: current $(cur), previous $(prev)"
bash "$here/undo.sh" "$site" > /dev/null 2>&1; [ "$(cur)" = releases/theos-222222222222 ] && ok "undo again: forward to the build undone" || bad "undo again: current $(cur)"
rm "$site/previous"; ln -s releases/theos-111111111111 "$site/current"; rm "$site/current"; ln -s releases/26.10.31v6 "$site/current"
bash "$here/deploy.sh" "$T1" "$scratch/one.tar.gz" "$site" > /dev/null 2>&1; bash "$here/undo.sh" "$site" > /dev/null 2>&1
[ "$(cur)" = releases/26.10.31v6 ] && [ -f "$site/releases/26.10.31v6/index.html" ] && ok "undo after the first deploy: avenOS is current again" || bad "undo after the first deploy: current $(cur)"
ls "$site/releases" | grep -q 26.10.31v6 && [ "$(ls "$site/releases" | wc -l)" = 3 ] && ok "nothing is deleted: avenOS and both theOS builds are kept" || bad "builds kept: $(ls "$site/releases" | xargs)"

# The health check against a local server that serves a tree and the Aven Peer's paths
serve=$scratch/serve; mkdir -p "$serve"; cp -r "$scratch/t/." "$serve/" 2> /dev/null; rm -rf "$serve"/*
mk three; cp -r "$scratch/t/." "$serve/"; tree=$scratch/tree; mkdir -p "$tree"; cp -r "$scratch/t/." "$tree/"
for p in avenCEO brain aip; do mkdir -p "$serve/$p" "$tree/$p"; done
for f in avenCEO/index.html brain/index.html brain/ids.json aip/aip-59ad.json; do echo "$f" > "$tree/$f"; cp "$tree/$f" "$serve/$f"; done
echo pong > "$serve/ping"; echo ok > "$serve/healthz"; echo '{"network":"aven"}' > "$serve/aven.json"
port=$((20000 + RANDOM % 20000)); (cd "$serve" && exec python3 -m http.server "$port" --bind 127.0.0.1) > /dev/null 2>&1 & srv=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done
base=http://127.0.0.1:$port
"$here/health.sh" before "$base" "$scratch/peer.txt" > /dev/null
"$here/health.sh" after "$base" "$tree" "$scratch/peer.txt" > /dev/null && ok "health: every page is the tree's bytes and the Aven Peer answers as before" || bad "health was red on a whole deploy"
cp "$serve/index.html" "$serve/brain/ids.json"   # Caddy's fallback: the dashboard in place of a missing file
"$here/health.sh" after "$base" "$tree" "$scratch/peer.txt" > /dev/null && bad "health passed the dashboard in place of a missing file" || ok "health: the dashboard in place of a missing file is red"
cp "$tree/brain/ids.json" "$serve/brain/ids.json"; echo '{"network":"other"}' > "$serve/aven.json"
"$here/health.sh" after "$base" "$tree" "$scratch/peer.txt" > /dev/null && bad "health passed a changed /aven.json" || ok "health: a changed /aven.json is red"
echo '{"network":"aven"}' > "$serve/aven.json"; rm "$serve/ping"
"$here/health.sh" after "$base" "$tree" "$scratch/peer.txt" > /dev/null && bad "health passed a /ping that stopped answering" || ok "health: a /ping that stopped answering is red"

if [ "${1:-}" = --box ]; then
	AVENSANDBOX_IMAGE=ghcr.io/myavenceo/aven/sandbox:theos-0000000000000000 "$here/box.sh" > /dev/null 2>&1 \
		&& bad "a box that is not published passed" || ok "a box that is not published: fails"
	"$here/box.sh" > /dev/null 2>&1 && ok "this commit's box: passes" || bad "this commit's box failed"
fi

[ $fails = 0 ] && echo "theOS's release test: green" || echo "theOS's release test: $fails failed"
[ $fails = 0 ]
