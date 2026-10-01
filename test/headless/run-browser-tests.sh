#!/usr/bin/env bash
# Runs the QUnit browser test suite (test/index.html) headlessly.
#
# - Serves the repo root with PHP's built-in server (the test suite relies on
#   PHP endpoints under test/data/).
# - Installs a modern Node (via nvm) only for the headless runner, leaving the
#   Node 0.10 that built dist/jquery.js untouched.
# - Drives the suite with puppeteer (bundled Chromium) via
#   test/headless/run-browser-tests.js and propagates its exit code.
set -euo pipefail

ROOT="$PWD"
PHP_LOG=/tmp/php-server.log
RUNNER_DIR=/tmp/qunit-runner
TEST_URL="http://127.0.0.1:8000/test/index.html"

php -S 127.0.0.1:8000 -t "$ROOT" > "$PHP_LOG" 2>&1 &
PHP_PID=$!

cleanup() {
	if kill -0 "$PHP_PID" 2>/dev/null; then
		kill "$PHP_PID"
	fi
}
trap cleanup EXIT

echo "Waiting for PHP server at $TEST_URL ..."
ready=0
for _ in $(seq 1 30); do
	if curl -sf "$TEST_URL" >/dev/null; then
		ready=1
		break
	fi
	sleep 1
done
if [ "$ready" -ne 1 ]; then
	echo "PHP server did not become ready within 30s"
	tail -50 "$PHP_LOG"
	exit 1
fi
echo "PHP server is up."

# nvm's scripts are not compatible with `set -u`
set +u
# shellcheck disable=SC1090
source ~/.nvm/nvm.sh
nvm install 18
nvm use 18
set -u
node --version

mkdir -p "$RUNNER_DIR"
(
	cd "$RUNNER_DIR"
	npm init -y >/dev/null
	echo "Installing puppeteer-core (uses the Travis-provided Google Chrome) ..."
	PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund puppeteer-core@21.11.0
	echo "puppeteer-core installed."
)

CHROME_BIN="$(command -v google-chrome-stable || command -v google-chrome)"
export CHROME_BIN
echo "Using Chrome at $CHROME_BIN: $("$CHROME_BIN" --version)"

if NODE_PATH="$RUNNER_DIR/node_modules" node "$ROOT/test/headless/run-browser-tests.js" "$TEST_URL"; then
	echo "Browser tests passed."
else
	status=$?
	echo "Browser tests failed (exit $status). Last PHP server log lines:"
	tail -50 "$PHP_LOG"
	exit "$status"
fi
