#!/bin/bash
# theOS's release test (aip-59ad, c1). Checkpoint 1:
#  1. 'Only from main': passes for main of this repository (in any case of its name), fails for another branch, a fork's
#     main, or no head at all.
#  2. The workflow (.github/workflows/theos.yml): its three required jobs are named exactly as production's ruleset names
#     them (d-70), none needs another and none skips but on a draft (a skipped job counts as passed), the pull request trigger is production with no
#     paths filter, push runs on production, no job reads a secret, and every action is pinned by commit.
#  3. 'avenSANDBOX' refuses a box that is not published, and passes this commit's box (only with --box: it pulls the box).
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

python3 - "$repo/.github/workflows/theos.yml" <<'PY' && ok "the workflow: names, no needs, triggers, no secrets, pinned actions" || fails=$((fails + 1))
import re, sys, yaml
path = sys.argv[1]
text = open(path).read()
w = yaml.safe_load(text)
on = w.get(True) or w.get('on')
errors = []
names = {k: j.get('name') for k, j in w['jobs'].items()}
want = {'Only from main', 'avenSANDBOX', 'theOS'}
if set(names.values()) != want: errors.append(f'job names {sorted(names.values())} are not {sorted(want)}')
allowed = {"github.event_name == 'pull_request' && !github.event.pull_request.draft", "github.event_name == 'push' || !github.event.pull_request.draft"}
for k, j in w['jobs'].items():
    if j.get('needs'): errors.append(f'{k} needs {j["needs"]}')
    if j.get('name') in want and j.get('if') not in allowed: errors.append(f'{k} runs only if {j.get("if")!r}: a required job may skip only a draft')
pr = on.get('pull_request') or {}
if pr.get('branches') != ['production']: errors.append(f'pull_request branches {pr.get("branches")}')
if 'paths' in pr or 'paths-ignore' in pr: errors.append('pull_request has a paths filter')
if (on.get('push') or {}).get('branches') != ['production']: errors.append('push is not on production')
if 'secrets.' in text: errors.append('the workflow reads a secret')
for u in re.findall(r'uses:\s*(\S+)', text):
    if not u.startswith('./') and not re.search(r'@[0-9a-f]{40}$', u): errors.append(f'{u} is not pinned by commit')
for e in errors: print('FAIL', e)
sys.exit(1 if errors else 0)
PY

if [ "${1:-}" = --box ]; then
	AVENSANDBOX_IMAGE=ghcr.io/myavenceo/aven/sandbox:theos-0000000000000000 "$here/box.sh" > /dev/null 2>&1 \
		&& bad "a box that is not published passed" || ok "a box that is not published: fails"
	"$here/box.sh" > /dev/null 2>&1 && ok "this commit's box: passes" || bad "this commit's box failed"
fi

[ $fails = 0 ] && echo "theOS's release test: green" || echo "theOS's release test: $fails failed"
[ $fails = 0 ]
