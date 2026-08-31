#!/usr/bin/env bash
# Rebuild the app container on ICSBETINTAPP01 from origin/develop.
# Secrets stay in /opt/ai-interview/.env.azure (not in git).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ai-interview}"
BRANCH="${BRANCH:-develop}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

cd "$APP_DIR"

if [[ ! -f .env.azure ]]; then
  echo "Missing $APP_DIR/.env.azure — aborting so secrets are not overwritten."
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

docker compose --env-file .env.azure -f docker-compose.azure.yml up --build -d

echo "Waiting for health check..."
for _ in $(seq 1 45); do
  if curl -fsS "$HEALTH_URL" | grep -q '"status":"healthy"'; then
    curl -fsS "$HEALTH_URL"
    echo
    docker image prune -f >/dev/null
    echo "Deploy OK."
    exit 0
  fi
  sleep 2
done

echo "Container did not become healthy in time."
docker compose -f docker-compose.azure.yml logs --tail=80
exit 1
