#!/usr/bin/env bash
# A Playwright browser on a GitHub runner, for a job that can't run in Playwright's image (the real browser test also
# builds Rust). The runner already holds most of what Chromium links to (it ships Google Chrome), so the system
# libraries are installed only when the browser lacks one, and apt gives up on a mirror that stalls after 20 s and tries
# again, three times (Playwright calls sudo itself), where `install --with-deps` hung on it for 15 minutes (2026-10-26).
#
#   scripts/ci/browser-deps.sh <playwright cli.js> <browser>
set -euo pipefail
cli=$1 browser=$2
bun "$cli" install "$browser"
exe=$(bun -e "const { $browser } = await import('$(dirname "$cli")/index.mjs'); console.log($browser.executablePath())")
# WebKit's executable is a script that starts its binaries with their own library path, so ldd reads nothing of it
# (2026-10-27: "has every library" and then a launch missing 36): only an executable ldd can read is checked
if missing=$(ldd "$exe" 2>&1) && ! grep -q 'not a dynamic executable' <<<"$missing"; then
	missing=$(grep 'not found' <<<"$missing" || true)
	if [ -z "$missing" ]; then echo "$browser has every library it links to"; exit 0; fi
	echo "$browser lacks:"; echo "$missing"
else
	echo "$browser's executable is no binary ldd reads: its system libraries installed"
fi
printf 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "3";\n' | sudo tee /etc/apt/apt.conf.d/99ci-timeouts >/dev/null
for try in 1 2 3; do
	if timeout 300 bun "$cli" install-deps "$browser"; then exit 0; fi
	echo "::warning::install-deps $browser failed (try $try of 3)"
	sleep $((try * 10))
done
exit 1
