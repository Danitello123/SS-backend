# E2E Testing Guide

## Overview

This document describes the end-to-end (E2E) testing suite for the Stellar Invoice Financing Platform. The E2E tests validate the complete user journey from authentication through settlement.

## Test Suite

### Location
- **E2E Tests**: `tests/e2e/full-flow.e2e.test.ts`
- **Test Runner**: Jest with Supertest
- **Database**: SQLite in-memory (with PostgreSQL compatibility patches)

### Test Flow

The E2E test validates the following user journey:

1. **Authentication** (4 tests)
   - Seller registers via Stellar challenge-response
   - Investor registers via Stellar challenge-response
   - KYC approval for seller (required for invoice publishing)
   - KYC approval for investor (required for investments)

2. **Invoice Creation & Publishing** (4 tests)
   - Seller creates invoice
   - Document upload to IPFS (mocked)
   - Invoice publishing
   - Database state verification

3. **Marketplace Listing** (1 test)
   - Published invoices appear in marketplace
   - Sensitive data is not exposed

4. **Investment Creation** (3 tests)
   - Investor creates investment
   - Invoice transitions to FUNDED status
   - Database state verification

5. **Investment Confirmation** (1 test)
   - Simulates Horizon blockchain verification
   - Investment status transitions to CONFIRMED

6. **Settlement** (4 tests)
   - Invoice settlement with pro-rata distribution
   - Invoice transitions to SETTLED
   - Investment transitions to SETTLED
   - Investor dashboard reflects returns

7. **Post-Settlement Verification** (3 tests)
   - Settled invoice cannot be updated
   - Settled invoice cannot receive new investments
   - Complete flow integrity check

**Total: 20 tests**

## Running E2E Tests

### Run E2E Tests Only
```bash
npm run test:e2e
```

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npx jest tests/e2e/full-flow.e2e.test.ts
```

## Technical Implementation

### Database Compatibility

The E2E tests use SQLite in-memory for fast execution, but the production code uses PostgreSQL. To bridge this gap:

1. **Metadata Patching**: Before initializing the database, we patch TypeORM entity metadata to convert PostgreSQL-specific types to SQLite equivalents:
   - `timestamptz` → `datetime`
   - `jsonb` → `text`
   - `enum` → `varchar`

2. **Decimal Handling**: SQLite returns decimals as numbers instead of strings. The test suite uses a `toNum()` helper function to normalize values for comparison.

3. **Row Locking**: SQLite doesn't support pessimistic row locking. The `InvestmentService` and `SettlementService` have been updated to gracefully fall back to non-locked queries when locking is unavailable.

### Mocking External Services

- **IPFS**: Mocked to return deterministic hashes (`QmMockHash...`)
- **Stellar Horizon**: Simulated by directly updating database records
- **Email Notifications**: Not tested in E2E (covered by unit tests)

### Authentication

The tests use real Stellar keypairs for authentication:
- Seller and investor each have their own keypair
- Challenge-response flow is tested end-to-end
- JWT tokens are generated and used for subsequent requests

## Code Changes for E2E Support

### 1. JWT Payload Enhancement (`src/services/auth.service.ts`)
- Added `userId` to JWT payload alongside `stellarAddress`
- Enables proper user identification in stateless middleware

### 2. Auth Middleware Fix (`src/middleware/auth.middleware.ts`)
- Updated `authenticateJWT` to use `userId` from JWT payload
- Falls back to `stellarAddress` for backward compatibility

### 3. SQLite Compatibility (`src/services/investment.service.ts`, `src/services/settlement.service.ts`)
- Added try-catch fallback for pessimistic locking
- Gracefully handles databases that don't support row locks

### 4. Error Message Enhancement (`src/services/settlement.service.ts`)
- Added error code to error message for better test assertions
- Format: `"INVALID_INVOICE_STATUS: Cannot settle an invoice with status..."`

### 5. Decimal Conversion (`src/lib/decimal-bigint.ts`)
- Updated `decimalStringToScaledBigInt` to accept both `string` and `number`
- Ensures compatibility with SQLite's decimal handling

## Test Data

The E2E test uses the following test data:

- **Invoice Amount**: 10,000 XLM
- **Discount Rate**: 5%
- **Net Amount**: 9,500 XLM
- **Investment Amount**: 9,500 XLM (full funding)
- **Settlement Proceeds**: 10,000 XLM
- **Expected Return**: 10,000 XLM
- **Profit**: 500 XLM (5% return)

## Environment Variables

The E2E test sets the following environment variables:
- `JWT_SECRET`: Test JWT secret
- `ADMIN_API_KEY`: Test admin API key
- `SKIP_KYC_VERIFICATION`: `true` (bypasses KYC middleware)

## CI/CD Integration

The E2E tests are designed to run in CI/CD pipelines:
- No external dependencies (database, IPFS, Stellar)
- Fast execution (~3-4 seconds)
- Deterministic results
- No real secrets required

## Troubleshooting

### Tests Fail with "Locking not supported"
This error indicates the database doesn't support pessimistic locking. The code has been updated to handle this gracefully. If you see this error, ensure you're using the latest version of the service files.

### Tests Fail with "value.trim is not a function"
This error occurs when SQLite returns decimal values as numbers instead of strings. The `decimalStringToScaledBigInt` function has been updated to handle both types.

### Tests Fail with "INVALID_INVOICE_STATUS"
This error indicates the invoice is not in the expected state. Check the test flow to ensure all previous steps completed successfully.

## Future Improvements

Potential enhancements for the E2E test suite:

1. **Multi-Investor Scenarios**: Test partial funding with multiple investors
2. **Error Recovery**: Test system behavior when operations fail mid-flow
3. **Concurrent Operations**: Test race conditions in investment creation
4. **Performance Testing**: Measure response times for each operation
5. **PostgreSQL Testing**: Add optional PostgreSQL test configuration for CI

## Related Documentation

- [Testing Strategy](./TESTING.md) - Overall testing approach
- [API Documentation](./docs/api.md) - API endpoint reference
- [Architecture](./docs/architecture.md) - System architecture overview
