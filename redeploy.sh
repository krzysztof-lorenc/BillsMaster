#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# BillsMaster Redeployment & Verification Script
# Usage:
#   ./redeploy.sh [frontend|backend|all|verify|logs]
# ==============================================================================

SCRIPT_REAL="$(readlink -f "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$(dirname "${SCRIPT_REAL}")" && pwd)"

# Load environment variables if .env exists
if [ -f "${REPO_ROOT}/.env" ]; then
  # Read variables without executing arbitrary code
  eval "$(grep -E '^(PUBLIC_URL|MISTRZOSK_URL|LOCAL_URL)=' "${REPO_ROOT}/.env" || true)"
fi

PUBLIC_URL="${PUBLIC_URL:-http://127.0.0.1:3000}"
LOCAL_URL="${LOCAL_URL:-http://127.0.0.1:3000}"
MISTRZOSK_URL="${MISTRZOSK_URL:-}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${BLUE}==>${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}!${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

# Run docker commands with proper group permissions
run_docker_cmd() {
  if docker ps >/dev/null 2>&1; then
    "$@"
  elif command -v sg >/dev/null 2>&1; then
    local cmd
    cmd=$(printf '%q ' "$@")
    sg docker -c "$cmd"
  else
    sudo "$@"
  fi
}

# Redeploy Frontend Container (React 19 / Vite SPA + Nginx)
deploy_frontend() {
  log_info "Rebuilding and restarting billsmaster-frontend container..."
  (cd "${REPO_ROOT}" && run_docker_cmd docker compose up -d --build frontend)
  log_success "billsmaster-frontend rebuilt and restarted."
}

# Redeploy Backend Container (Fastify / BullMQ / Playwright)
deploy_backend() {
  log_info "Rebuilding and restarting billsmaster-backend container..."
  (cd "${REPO_ROOT}" && run_docker_cmd docker compose up -d --build backend)
  log_success "billsmaster-backend rebuilt and restarted."
}

# Full Stack Deployment
deploy_all() {
  log_info "Starting full BillsMaster redeployment..."
  (cd "${REPO_ROOT}" && run_docker_cmd docker compose up -d --build)
  log_success "All BillsMaster containers rebuilt and launched."
}

# Database Migration / Schema Sync
db_sync() {
  log_info "Pushing database schema via Prisma inside backend container..."
  run_docker_cmd docker exec billsmaster-backend sh -c "cd /app/apps/backend && npx prisma db push"
  log_success "Database schema is in sync."
}

# View Container Logs
show_logs() {
  log_info "Tailing recent container logs..."
  run_docker_cmd docker compose -f "${REPO_ROOT}/docker-compose.yml" logs --tail=40 -f backend frontend
}

# Health & End-to-End Verification Suite
verify_health() {
  log_info "Running post-deployment verification..."

  echo -n "  1. Local Frontend Port (:3000): "
  local local_title
  local_title=$(curl -s "${LOCAL_URL}/" | grep "<title>" || true)
  if [ -n "${local_title}" ]; then
    echo -e "${GREEN}OK${NC} (${local_title})"
  else
    echo -e "${RED}FAILED${NC}"
  fi

  echo -n "  2. Local API Status (:3000/api/auth/status): "
  local local_api
  local_api=$(curl -s "${LOCAL_URL}/api/auth/status" || true)
  if echo "${local_api}" | grep -q '"isConfigured":true'; then
    echo -e "${GREEN}OK${NC} (${local_api})"
  else
    echo -e "${RED}FAILED${NC} (${local_api})"
  fi

  # Check public URL if configured and different from local
  if [ -n "${PUBLIC_URL}" ] && [ "${PUBLIC_URL}" != "${LOCAL_URL}" ]; then
    echo -n "  3. Public Frontend Title (${PUBLIC_URL}): "
    local pub_title
    pub_title=$(curl -s -k "${PUBLIC_URL}/" | grep "<title>" || true)
    if [ -n "${pub_title}" ]; then
      echo -e "${GREEN}OK${NC} (${pub_title})"
    else
      echo -e "${RED}FAILED${NC}"
    fi

    echo -n "  4. Public API Health (${PUBLIC_URL}/api/auth/status): "
    local pub_api
    pub_api=$(curl -s -k "${PUBLIC_URL}/api/auth/status" || true)
    if echo "${pub_api}" | grep -q '"isConfigured":true'; then
      echo -e "${GREEN}OK${NC} (${pub_api})"
    else
      echo -e "${RED}FAILED${NC} (${pub_api})"
    fi

    # Extract hostname & port for SSL check
    local pub_host pub_port
    pub_host=$(echo "${PUBLIC_URL}" | sed -e 's|^[^/]*//||' -e 's|/.*$||' -e 's|:.*$||')
    pub_port=$(echo "${PUBLIC_URL}" | sed -e 's|^[^/]*//||' -e 's|/.*$||' | grep ':' | sed -e 's|.*:||' || true)
    [ -z "${pub_port}" ] && pub_port="443"

    if [ -n "${pub_host}" ] && [ "${pub_host}" != "localhost" ] && [ "${pub_host}" != "127.0.0.1" ]; then
      echo -n "  5. SSL Certificate (${pub_host}:${pub_port}): "
      local ssl_cn
      ssl_cn=$(echo | openssl s_client -connect "${pub_host}:${pub_port}" -servername "${pub_host}" 2>/dev/null | openssl x509 -noout -subject || true)
      if [ -n "${ssl_cn}" ]; then
        echo -e "${GREEN}OK${NC} (${ssl_cn})"
      else
        echo -e "${YELLOW}SKIPPED / UNREACHABLE${NC}"
      fi
    fi
  fi

  if [ -n "${MISTRZOSK_URL}" ]; then
    echo -n "  6. Regression Check - Health (${MISTRZOSK_URL}): "
    local osk_health
    osk_health=$(curl -s -k "${MISTRZOSK_URL}/api/v1/health" || true)
    if echo "${osk_health}" | grep -q "healthy"; then
      echo -e "${GREEN}OK (Untouched & Healthy)${NC}"
    else
      echo -e "${RED}FAILED - Check Service!${NC} (${osk_health})"
    fi
  fi
}

show_help() {
  cat <<HELP
Usage: $(basename "$0") [command]

Commands:
  all         Rebuild and restart both frontend and backend (default)
  frontend    Rebuild and restart React frontend container only
  backend     Rebuild and restart Fastify/BullMQ backend container only
  db          Push Prisma schema changes to PostgreSQL
  verify      Run end-to-end health verification checks
  logs        Stream live logs from backend and frontend containers
  help        Show this help message

Examples:
  ./redeploy.sh           # Full redeployment + verification
  ./redeploy.sh frontend  # Quick frontend update (React/Tailwind/assets)
  ./redeploy.sh backend   # Quick backend update (API routes/scrapers)
  ./redeploy.sh verify    # Run health check suite only
  ./redeploy.sh logs      # Tail container logs
HELP
}

TARGET="${1:-all}"

case "${TARGET}" in
  frontend|web|ui)
    deploy_frontend
    verify_health
    ;;
  backend|api)
    deploy_backend
    verify_health
    ;;
  all|full)
    deploy_all
    verify_health
    ;;
  db|migrate|push)
    db_sync
    ;;
  verify|check|status)
    verify_health
    ;;
  logs)
    show_logs
    ;;
  help|-h|--help)
    show_help
    exit 0
    ;;
  *)
    log_error "Unknown command: ${TARGET}"
    show_help
    exit 1
    ;;
esac
