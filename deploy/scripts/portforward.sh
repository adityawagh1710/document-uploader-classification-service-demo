#!/usr/bin/env bash
# Idempotent kubectl port-forward wrapper for classification-ui.
#
# Single-service simplification of aspose-total/deploy/scripts/portforward.sh
# — only the UI Service needs forwarding here (LocalStack is in-cluster).
#
# Walks 10 consecutive local ports from $UI_LOCAL_PORT_BASE if the base is
# taken. Re-running `start` kills the previous instance first. Tracked
# state lives in /tmp/classification-ui-portforward.{pid,port}.
#
# Usage:
#   ./portforward.sh start    # spawn detached pf; print port + health
#   ./portforward.sh status   # PID + port + /api/health probe
#   ./portforward.sh restart  # stop + start
#   ./portforward.sh stop     # kill + remove state files

set -euo pipefail

NAMESPACE="${K8S_NAMESPACE:-classification-service-sandbox}"
SVC_NAME="${HELM_RELEASE:-classification-ui}"
SVC_PORT="${UI_SVC_PORT:-80}"
LOCAL_BASE="${UI_LOCAL_PORT_BASE:-3000}"
PORT_WALK="${UI_LOCAL_PORT_WALK:-10}"
HEALTH_PATH="/api/health"

PID_FILE="/tmp/classification-ui-portforward.pid"
PORT_FILE="/tmp/classification-ui-portforward.port"
LOG_FILE="${DEPLOY_LOG_DIR:-deploy/logs}/portforward.log"

mkdir -p "$(dirname "$LOG_FILE")"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$LOG_FILE" >&2; }

require() {
  for tool in "$@"; do
    command -v "$tool" >/dev/null || { log "missing required tool: $tool"; exit 1; }
  done
}

cluster_reachable() {
  kubectl get nodes --request-timeout=5s >/dev/null 2>&1
}

find_free_port() {
  local start="$1"
  for i in $(seq 0 $((PORT_WALK - 1))); do
    local p=$((start + i))
    if ! ss -ltn "sport = :$p" 2>/dev/null | grep -q LISTEN; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  log "no free local port in range $start..$((start + PORT_WALK - 1))"
  return 1
}

stop_existing() {
  if [[ -f $PID_FILE ]]; then
    local pid; pid=$(cat "$PID_FILE" 2>/dev/null || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "killing previous port-forward (pid=$pid)"
      kill "$pid" 2>/dev/null || true
      sleep 0.3
    fi
    rm -f "$PID_FILE" "$PORT_FILE"
  fi
}

cmd_start() {
  require kubectl ss curl
  if ! cluster_reachable; then
    log "kubectl can't reach the cluster. Check VPN + kubeconfig context, then retry."
    exit 2
  fi
  stop_existing
  local port; port=$(find_free_port "$LOCAL_BASE")
  log "starting port-forward: $port -> svc/$SVC_NAME:$SVC_PORT (ns=$NAMESPACE)"
  nohup kubectl -n "$NAMESPACE" port-forward "svc/$SVC_NAME" "$port:$SVC_PORT" \
    >>"$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid"  > "$PID_FILE"
  echo "$port" > "$PORT_FILE"
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    log "port-forward exited immediately — see $LOG_FILE"
    exit 3
  fi
  for _ in $(seq 1 20); do
    if curl -fsS -o /dev/null "http://localhost:$port$HEALTH_PATH"; then
      log "ready: http://localhost:$port  (health: 200)"
      printf 'http://localhost:%s\n' "$port"
      return 0
    fi
    sleep 0.5
  done
  log "warning: health probe never returned 200 — pod may still be starting"
  printf 'http://localhost:%s\n' "$port"
}

cmd_status() {
  if [[ ! -f $PID_FILE ]]; then
    echo "stopped"
    return 0
  fi
  local pid port; pid=$(cat "$PID_FILE"); port=$(cat "$PORT_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    local code; code=$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:$port$HEALTH_PATH" || echo "000")
    echo "running pid=$pid port=$port health=$code  → http://localhost:$port"
  else
    echo "stale (pid $pid no longer running) — run 'stop' to clean up"
  fi
}

cmd_stop() {
  stop_existing
  log "stopped"
}

cmd_restart() { cmd_stop; cmd_start; }

case "${1:-status}" in
  start)   cmd_start   ;;
  status)  cmd_status  ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  *) echo "usage: $0 {start|status|stop|restart}" >&2; exit 64 ;;
esac
