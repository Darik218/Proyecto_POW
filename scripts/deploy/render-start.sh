#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../backend"

export NODE_ENV=production
export CORS_ORIGINS="${CORS_ORIGINS:-${RENDER_EXTERNAL_URL:-}}"
: "${PORT:?PORT is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
test -f ../frontend/dist/index.html
node -e 'new (require("./dist/auth/auth.config").AuthConfig)()'

npm run prisma:migrate:deploy
node dist-seed/prisma/seed.js
exec node dist/main.js
