#!/usr/bin/env bash
set -euo pipefail

source scripts/db/prod-connection.sh

echo "Starting seeding for all 10 batches (500 users)..."

for i in {1..10}; do
  BATCH_FILE="scratch/batches/seed_batch_${i}.sql"
  echo "Applying ${BATCH_FILE}..."
  prod_psql < "${BATCH_FILE}"
  echo "Successfully applied ${BATCH_FILE}."
done

echo "All 10 batches successfully applied!"
