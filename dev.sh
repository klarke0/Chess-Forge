#!/bin/bash
# Chess Trainer — start both servers
# Usage: ./dev.sh [stop|restart|status|logs]

FRONTEND_PORT=5173
BACKEND_PORT=3001
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/.pids"

mkdir -p "$LOG_DIR"

# ── Helpers ─────────────────────────────────────────────────────────────────

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_port() {
  local port="$1" name="$2" attempts=0
  while [ $attempts -lt 15 ]; do
    if lsof -ti ":$port" &>/dev/null; then
      echo "  ✓ $name ready on :$port"
      return 0
    fi
    sleep 0.5
    attempts=$((attempts + 1))
  done
  echo "  ✗ $name failed to start on :$port — check logs: $LOG_DIR/${name}.log"
  return 1
}

status() {
  echo "=== Chess Trainer Status ==="
  if lsof -ti ":$BACKEND_PORT" &>/dev/null; then
    echo "  Backend  :$BACKEND_PORT  RUNNING (pid $(lsof -ti ":$BACKEND_PORT"))"
  else
    echo "  Backend  :$BACKEND_PORT  STOPPED"
  fi
  if lsof -ti ":$FRONTEND_PORT" &>/dev/null; then
    echo "  Frontend :$FRONTEND_PORT  RUNNING (pid $(lsof -ti ":$FRONTEND_PORT"))"
  else
    echo "  Frontend :$FRONTEND_PORT  STOPPED"
  fi
  if pgrep -x "ngrok" &>/dev/null; then
    echo "  Tunnel   :3001  RUNNING (pid $(pgrep -x "ngrok"))"
  else
    echo "  Tunnel   :3001  STOPPED"
  fi
}

stop_all() {
  echo "Stopping servers..."
  kill_port "$BACKEND_PORT"
  kill_port "$FRONTEND_PORT"
  # Also kill by name in case they moved ports
  pkill -f "bun.*server/index" 2>/dev/null || true
  pkill -f "vite"              2>/dev/null || true
  pkill -x "ngrok"             2>/dev/null || true
  sleep 0.5
  echo "All servers stopped."
}

start_backend() {
  echo "Starting backend on :$BACKEND_PORT..."
  # Load server/.env if present, then start
  local env_file="$SCRIPT_DIR/server/.env"
  if [ -f "$env_file" ]; then
    set -a; source "$env_file"; set +a
  fi
  bun run "$SCRIPT_DIR/server/index.ts" \
    >> "$LOG_DIR/backend.log" 2>&1 &
  wait_for_port "$BACKEND_PORT" "backend"
}

start_frontend() {
  echo "Starting frontend on :$FRONTEND_PORT..."
  # Run vite directly (not via npm) so the saved PID is the actual Vite process
  cd "$SCRIPT_DIR" && npx vite --host \
    >> "$LOG_DIR/frontend.log" 2>&1 &
  wait_for_port "$FRONTEND_PORT" "frontend"
}

start_tunnel() {
  if pgrep -x "ngrok" &>/dev/null; then
    echo "  Tunnel is already running (pid $(pgrep -x "ngrok"))"
    return 0
  fi
  echo "Starting ngrok tunnel on :3001 with domain bart-countable-farrah.ngrok-free.dev..."
  ngrok http --domain=bart-countable-farrah.ngrok-free.dev 3001 --log=stdout > "$SCRIPT_DIR/ngrok.log" 2>&1 &
  sleep 2
  if pgrep -x "ngrok" &>/dev/null; then
    echo "  ✓ Tunnel started. URL: https://bart-countable-farrah.ngrok-free.dev"
  else
    echo "  ✗ Tunnel failed to start. Check ngrok.log"
  fi
}

# ── Commands ─────────────────────────────────────────────────────────────────

case "${1:-start}" in
  stop)
    stop_all
    ;;

  build)
    echo "Building frontend..."
    npm run build
    ;;

  prod)
    stop_all
    echo "Building frontend..."
    npm run build
    sleep 0.5
    start_backend
    echo ""
    echo "  Production Server (SPA) ready at: http://localhost:$BACKEND_PORT"
    echo "  (Mobile/Remote access available via your IP or tunnel)"
    ;;

  restart)
    stop_all
    sleep 0.5
    start_backend
    start_frontend
    echo ""
    echo "  App:  http://localhost:$FRONTEND_PORT"
    ;;

  status)
    status
    ;;

  tunnel)
    start_tunnel
    ;;

  build)
    echo "=== Building Production Bundle ==="
    if ! npm run build; then
      echo ""
      echo "❌ ERROR: Build failed! The frontend has syntax or TypeScript errors."
      echo "The backend will continue serving the OLD version until this is fixed."
      exit 1
    fi
    echo "✅ Build successful! You can now restart the backend to serve it."
    ;;

  logs)
    echo "=== Backend log (last 30 lines) ==="
    tail -30 "$LOG_DIR/backend.log" 2>/dev/null || echo "  (no log)"
    echo ""
    echo "=== Frontend log (last 30 lines) ==="
    tail -30 "$LOG_DIR/frontend.log" 2>/dev/null || echo "  (no log)"
    echo ""
    echo "=== Tunnel log (last 30 lines) ==="
    tail -30 "$SCRIPT_DIR/ngrok.log" 2>/dev/null || echo "  (no log)"
    ;;

  start|*)
    stop_all
    sleep 0.5
    start_backend
    start_frontend
    echo ""
    echo "  App:    http://localhost:$FRONTEND_PORT"
    echo "  API:    http://localhost:$BACKEND_PORT/api/repertoires"
    echo ""
    echo "  Tunnel: ./dev.sh tunnel"
    echo "  Logs:   ./dev.sh logs"
    echo "  Stop:   ./dev.sh stop"
    ;;
esac
