#!/bin/bash
# Linux: ./start-anni.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Anni needs Node.js. Install it from https://nodejs.org and try again."; exit 1; }
[ -d node_modules/electron ] || { echo "First run: setting Anni up (downloads Electron, about a minute)..."; npm install --no-audit --no-fund || exit 1; }

# Many distros (e.g. Ubuntu 24.04+) block Chromium's user-namespace sandbox, and Electron then
# needs its setuid helper owned by root. If that helper isn't set up, run without the sandbox
# (Anni only loads her own local files) and say how to fix it properly.
SANDBOX=node_modules/electron/dist/chrome-sandbox
FLAGS=()
if [ "$(stat -c '%u %a' "$SANDBOX" 2>/dev/null)" != "0 4755" ]; then
  echo "Note: Electron's sandbox helper isn't set up, so Anni starts with --no-sandbox."
  echo "      To fix it once:  sudo chown root:root $SANDBOX && sudo chmod 4755 $SANDBOX"
  FLAGS+=(--no-sandbox)
fi
nohup ./node_modules/.bin/electron . "${FLAGS[@]}" >/dev/null 2>&1 &
