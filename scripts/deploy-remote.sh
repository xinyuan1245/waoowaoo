#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_NAME="$(basename "$PROJECT_DIR")"

DEPLOY_HOST="${DEPLOY_HOST:-root@47.111.188.158}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/waoowaoo}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-waoowaoo-app}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/saturndec/waoowaoo:latest}"
COMPOSE_BIN="${COMPOSE_BIN:-podman-compose}"
REMOTE_APP_PORT="${REMOTE_APP_PORT:-13000}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
DEPLOY_GIT_REMOTE="${DEPLOY_GIT_REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
DEPLOY_REF="${DEPLOY_REF:-$DEPLOY_GIT_REMOTE/$DEPLOY_BRANCH}"
SKIP_GIT_FETCH="${SKIP_GIT_FETCH:-0}"
SSH_OPTS=(
  -o StrictHostKeyChecking=no
  -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
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
require_cmd git

if [[ "$SKIP_GIT_FETCH" != "1" ]]; then
  log "更新本地 ${DEPLOY_GIT_REMOTE}/${DEPLOY_BRANCH}"
  git -C "$PROJECT_DIR" fetch "$DEPLOY_GIT_REMOTE" "$DEPLOY_BRANCH"
fi

DEPLOY_COMMIT="$(git -C "$PROJECT_DIR" rev-parse --verify "$DEPLOY_REF^{commit}")"
DEPLOY_COMMIT_SHORT="$(git -C "$PROJECT_DIR" rev-parse --short "$DEPLOY_COMMIT")"

log "同步 ${DEPLOY_REF}@${DEPLOY_COMMIT_SHORT} 到 ${DEPLOY_HOST}:${DEPLOY_DIR}"
remote_run "mkdir -p '$DEPLOY_DIR' && find '$DEPLOY_DIR' -mindepth 1 -maxdepth 1 ! -name data ! -name docker-logs -exec rm -rf {} +"
git -C "$PROJECT_DIR" archive --format=tar --prefix="$PROJECT_NAME/" "$DEPLOY_COMMIT" \
  | gzip -c \
  | remote_run "tar -xzf - -C '$(dirname "$DEPLOY_DIR")' && printf '%s\n' '$DEPLOY_COMMIT' > '$DEPLOY_DIR/.deploy-commit'"

log "清理远端 macOS 扩展文件"
remote_run "cd '$DEPLOY_DIR' && find . -name '._*' -type f -delete"

log "远端构建 app 镜像 ${APP_IMAGE}"
remote_run "cd '$DEPLOY_DIR' && podman build -t '$APP_IMAGE' ."

log "重建远端 app 容器"
remote_run "podman rm -f '$APP_CONTAINER_NAME' >/dev/null 2>&1 || true"
remote_run "cd '$DEPLOY_DIR' && $COMPOSE_BIN up -d app"

log "检查服务健康状态"
remote_run "sh -lc 'for i in 1 2 3 4 5 6 7 8 9 10; do if curl -I --max-time 10 http://127.0.0.1:${REMOTE_APP_PORT} >/tmp/waoowaoo-health.out 2>&1; then cat /tmp/waoowaoo-health.out; exit 0; fi; sleep 2; done; cat /tmp/waoowaoo-health.out; exit 1'"

log "检查 API route 和 Redis DNS"
remote_run "podman exec '$APP_CONTAINER_NAME' sh -lc 'test -f '\''/app/src/app/api/projects/[projectId]/data/route.ts'\'' && getent hosts redis >/dev/null'"
remote_run "sh -lc 'curl -sS -i --max-time 10 http://127.0.0.1:${REMOTE_APP_PORT}/api/projects/__deploy-health__/data >/tmp/waoowaoo-api-health.out; if grep -qi \"content-type: application/json\" /tmp/waoowaoo-api-health.out; then cat /tmp/waoowaoo-api-health.out | sed -n \"1,12p\"; exit 0; fi; cat /tmp/waoowaoo-api-health.out | sed -n \"1,40p\"; exit 1'"

log "部署完成: ${DEPLOY_COMMIT_SHORT}"
