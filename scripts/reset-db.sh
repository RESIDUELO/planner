#!/usr/bin/env bash
# Recria um banco local vazio e aplica as migrações (somente desenvolvimento/testes).
set -euo pipefail
DB=${1:-residencia_planner}
psql "postgres://rp_owner:rp_owner@localhost:5432/postgres" -qc "drop database if exists $DB with (force)" -c "create database $DB owner rp_owner"
MIGRATION_DATABASE_URL="postgres://rp_owner:rp_owner@localhost:5432/$DB" npx tsx db/migrate.ts
