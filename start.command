#!/bin/sh
# Double-click (Linux/macOS) or run ./start.sh – starts the app and opens your browser.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then exec node serve.mjs; fi
PY=$(command -v python3 || command -v python)
if [ -n "$PY" ]; then
  (sleep 1; { open http://localhost:8080 || xdg-open http://localhost:8080; } >/dev/null 2>&1) &
  echo "Running at http://localhost:8080 – press Ctrl+C to stop."
  exec "$PY" -m http.server 8080
fi
echo "Please install Node.js (https://nodejs.org) or Python (https://python.org), then run this again."
read -r _
