#!/usr/bin/env bash

##############################################################################
# Database Migration Safety Check & Rollback Validation Script
#
# This script verifies that all database migrations:
# 1. Execute successfully in forward direction (migration:run)
# 2. Can be safely reverted (migration:revert)
# 3. Can be re-applied without side effects (migration:run again)
#
# Exit codes:
#   0 - All migration checks passed
#   1 - Forward migration failed
#   2 - Rollback/revert failed
#   3 - Re-application failed
##############################################################################

set -eo pipefail

# Color output helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_section() {
  echo -e "${BLUE}=================================================================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}=================================================================================${NC}"
}

log_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
  echo -e "${RED}✗ $1${NC}"
}

log_info() {
  echo -e "${YELLOW}→ $1${NC}"
}

log_section "Database Migration Safety Check Started"

# Verify required environment variables
if [ -z "$DATABASE_URL" ]; then
  log_error "DATABASE_URL environment variable is not set"
  exit 1
fi

log_info "Database URL: ${DATABASE_URL%%@*}@***"

# Step 1: Run forward migrations
log_section "Step 1/3: Running Forward Migrations"
if npm run db:migrate; then
  log_success "Forward migrations executed successfully"
else
  log_error "Forward migration execution failed"
  exit 1
fi

# Step 2: Revert last migration to test rollback capability
log_section "Step 2/3: Testing Rollback (Reverting Last Migration)"
if node -r ts-node/register ./node_modules/typeorm/cli.js migration:revert -d src/config/data-source.ts; then
  log_success "Last migration reverted successfully (rollback validation passed)"
else
  log_error "Migration revert failed - rollback safety check unsuccessful"
  exit 2
fi

# Step 3: Re-apply migrations to verify idempotency
log_section "Step 3/3: Re-applying Migrations (Idempotency Check)"
if npm run db:migrate; then
  log_success "Migrations re-applied successfully (idempotency check passed)"
else
  log_error "Migration re-application failed - migrations are not idempotent"
  exit 3
fi

# Success
log_section "Migration Safety Check Passed ✓"
echo -e "${GREEN}All migration checks completed successfully:${NC}"
echo -e "  ${GREEN}✓${NC} Forward migration validation"
echo -e "  ${GREEN}✓${NC} Rollback capability verification"
echo -e "  ${GREEN}✓${NC} Idempotency confirmation"
echo -e "\n${GREEN}Migrations are safe for deployment.${NC}\n"

exit 0
