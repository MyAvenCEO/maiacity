#!/bin/bash
# The deploy job's SSH (aip-59ad, c5): `ssh prod` reaches the server as deploy, trusting only the host keys in
# DEPLOY_KNOWN_HOSTS, pinned under the alias prod so the secret holds by name or address. Learned from v1's prod-ssh
# action, not used. The key goes to a file with mode 600 and is never printed.
#   SSH_KEY=… KNOWN_HOSTS=… theOS/release/ssh.sh <host>
set -euo pipefail
name=${1:?the host}
[ -n "${KNOWN_HOSTS:-}" ] || { echo "::error::DEPLOY_KNOWN_HOSTS is not set"; exit 1; }
[ -n "${SSH_KEY:-}" ] || { echo "::error::DEPLOY_SSH_KEY is not set"; exit 1; }
host=$(getent ahostsv4 "$name" | awk '{print $1; exit}')
[ -n "$host" ] || { echo "::error::$name does not resolve"; exit 1; }
mkdir -p ~/.ssh && chmod 700 ~/.ssh
printf '%s\n' "$KNOWN_HOSTS" | awk '
  /^[[:space:]]*(#|@|$)/ { next }
  $1 ~ /^(ssh-|ecdsa-|sk-)/ { print "prod", $1, $2; next }
  $2 ~ /^(ssh-|ecdsa-|sk-)/ { print "prod", $2, $3 }' > ~/.ssh/known_hosts
[ -s ~/.ssh/known_hosts ] || { echo "::error::DEPLOY_KNOWN_HOSTS holds no host key"; exit 1; }
(umask 077; printf '%s\n' "$SSH_KEY" > ~/.ssh/theos_deploy)
printf 'Host prod\n  HostName %s\n  HostKeyAlias prod\n  User deploy\n  IdentityFile ~/.ssh/theos_deploy\n  IdentitiesOnly yes\n  StrictHostKeyChecking yes\n  UserKnownHostsFile ~/.ssh/known_hosts\n  BatchMode yes\n  ConnectTimeout 20\n' "$host" > ~/.ssh/config
echo "ssh prod: deploy@$name ($host), host keys pinned"
