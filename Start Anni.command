#!/bin/bash
# Double-click this file to wake Anni up (macOS).
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Anni needs Node.js. Install it from https://nodejs.org and try again."; read -n1 -p "Press any key"; exit 1; }
[ -d node_modules/electron ] || { echo "First run: setting Anni up..."; npm install --no-audit --no-fund || exit 1; }
nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
