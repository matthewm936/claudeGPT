#!/bin/bash
# YourPsyche — double-click to launch
cd "$(dirname "$0")"

echo "Starting YourPsyche..."

# Ensure Node.js is installed
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "Installing Homebrew first (may ask for your password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
  fi
  brew install node
fi

# Ensure Claude CLI is installed
if ! command -v claude >/dev/null 2>&1; then
  echo "Installing Claude Code..."
  npm install -g @anthropic-ai/claude-code
fi

# Install server dependencies if needed
if [ ! -d web/node_modules ]; then
  echo "Installing dependencies..."
  (cd web && npm install --silent)
fi

# Start server if not already running
if ! lsof -iTCP:3141 -sTCP:LISTEN >/dev/null 2>&1; then
  cd web
  node server.js >> server.log 2>&1 &
  SERVER_PID=$!
  cd ..

  # Wait for server to be ready
  for i in $(seq 1 10); do
    curl -s http://localhost:3141 >/dev/null 2>&1 && break
    sleep 0.5
  done
else
  echo "Server already running."
fi

# Open browser
open http://localhost:3141

echo ""
echo "YourPsyche is running at http://localhost:3141"
echo "Close this window to stop the server."
echo ""

# Keep alive — closing Terminal stops the server
if [ -n "$SERVER_PID" ]; then
  wait $SERVER_PID
else
  # Server was already running, just keep window open
  read -r -p "Press Enter to exit..."
fi
