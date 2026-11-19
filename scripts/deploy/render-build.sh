#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

(
  cd frontend
  npm ci --include=dev
  # Compile the browser for the public origin, regardless of a build-time override.
  VITE_API_BASE_URL=/api/v1 npm run build
)
(
  cd backend
  npm ci --include=dev
  npm run build
  ./node_modules/.bin/tsc --project tsconfig.seed.json
)
