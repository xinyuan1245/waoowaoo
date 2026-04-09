#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

DEPLOY_HOST="${DEPLOY_HOST:-root@47.111.188.158}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/waoowaoo}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-waoowaoo-app}"
COMPOSE_BIN="${COMPOSE_BIN:-podman-compose}"
REMOTE_APP_PORT="${REMOTE_APP_PORT:-13000}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
)

TAR_EXCLUDES=(
  --exclude=.git
  --exclude=.next
  --exclude=node_modules
  --exclude=logs
  --exclude=.tmp
  --exclude=.env
  --exclude=data
  --exclude=docker-logs
  --exclude=tsconfig.tsbuildinfo
)

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

remote_run() {
  ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST" "$@"
}

require_cmd tar
require_cmd ssh
require_cmd bash

log "同步代码到 ${DEPLOY_HOST}:${DEPLOY_DIR}"
tar "${TAR_EXCLUDES[@]}" -czf - -C "$(dirname "$PROJECT_DIR")" "$PROJECT_NAME" \
  | remote_run "mkdir -p '$DEPLOY_DIR' && tar -xzf - -C '$(dirname "$DEPLOY_DIR")'"

log "清理远端 macOS 扩展文件"
remote_run "cd '$DEPLOY_DIR' && find . -name '._*' -type f -delete"

log "远端构建 app 镜像"
remote_run "cd '$DEPLOY_DIR' && $COMPOSE_BIN build app"

log "重建远端 app 容器"
remote_run "podman rm -f '$APP_CONTAINER_NAME' >/dev/null 2>&1 || true"
remote_run "cd '$DEPLOY_DIR' && $COMPOSE_BIN up -d app"

log "检查服务健康状态"
remote_run "sh -lc 'for i in 1 2 3 4 5 6 7 8 9 10; do if curl -I --max-time 10 http://127.0.0.1:${REMOTE_APP_PORT} >/tmp/waoowaoo-health.out 2>&1; then cat /tmp/waoowaoo-health.out; exit 0; fi; sleep 2; done; cat /tmp/waoowaoo-health.out; exit 1'"

log "部署完成"
