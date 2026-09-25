#!/usr/bin/env bash
# Sobe a aplicação para os testes E2E com um banco vazio (apenas um admin).
set -euo pipefail
DB_NAME=$(basename "$E2E_DB_URL")
psql "${E2E_DB_URL%/*}/postgres" -qc "drop database if exists $DB_NAME with (force)" -c "create database $DB_NAME"
MIGRATION_DATABASE_URL="$E2E_DB_URL" npx tsx db/migrate.ts > /dev/null
MIGRATION_DATABASE_URL="$E2E_DB_URL" npx tsx scripts/create-admin.ts --email admin@e2e.test --name "Admin E2E" --password admin-e2e-123 > /dev/null
npx vite build > /dev/null
NODE_ENV=production DATABASE_URL="$E2E_DB_URL" MIGRATION_DATABASE_URL="$E2E_DB_URL" exec npx tsx server/index.ts
