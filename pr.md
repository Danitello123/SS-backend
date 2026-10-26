## Description

### Feature 474: Secondary Market Endpoints
Builds secondary market listing and purchase endpoints for fractional invoice shares, allowing investors to list their fractional holdings for resale and other investors to purchase from those listings.

- **`POST /secondary-market/listings`**: Creates a resale listing with price and quantity.
  - Validates that the seller owns sufficient confirmed shares in the invoice, accounting for existing active listings to prevent double-listing.
  - Validates invoice status (only funded invoices can be listed).
  - Rejects listing shares on invoices that are past maturity with HTTP 422 (`INVOICE_MATURED`).
- **`GET /secondary-market/listings`**: Returns active listings per invoice with support for filtering (`invoiceId`, `sellerWallet`, `minPrice`, `maxPrice`) and pagination (`page`, `limit`).
- **`POST /secondary-market/listings/:id/buy`**: Executes purchases of fractional invoice shares from active listings.
  - Rejects over-purchases exceeding available listing quantity with HTTP 409 (`OVER_PURCHASE`).
  - Rejects self-purchases and purchases on expired or non-active listings with HTTP 400.
  - Atomically transfers ownership with payment in a single database transaction:
    - Deducts purchased quantity from seller's confirmed holdings (`Investment`).
    - Credits purchased quantity to buyer's confirmed holdings (`Investment`).
    - Updates listing quantity/status (`SOLD` if fully bought).
    - Records completed payment transactions (`Transaction`).
- **Cancel Listing Endpoints**:
  - `DELETE /secondary-market/listings/:id` and `POST /secondary-market/listings/:id/cancel`
  - Restricts cancellation exclusively to the listing owner (`sellerWallet` or `sellerId`), returning HTTP 403 (`FORBIDDEN`) for non-owners.
- **Route Mounting**:
  - Mounted on `/secondary-market`, `/api/v1/secondary-market`, and `/api/v1/secondary` for complete URL compatibility.

Closes #474

---

### Feature 475: KYC Endpoints & Invoice Submission Gating
Implements KYC document submission, verification status checks, admin review transitions, and invoice submission gating as requested in Issue #475.

- **`POST /kyc/submit`**:
  - Accepts seller details (`legalName`, `registrationNumber`, `jurisdiction`, etc.) and IPFS document CIDs (`documentCids`, `documentType`, `documentNumber`, `ipfsDocumentUrl`).
  - Validates payload structure and stores document CIDs within verification records.
  - Sets KYC status to `PENDING`.
  - Rejects new submissions with HTTP 409 Conflict if a verification is already `PENDING` or `APPROVED`.
- **`GET /kyc/status`**:
  - Returns current verification status (`PENDING`, `APPROVED`, `REJECTED`) for the authenticated seller/wallet.
  - Returns `rejectionReason` when status is `REJECTED`, and `null` otherwise.
- **Admin `PATCH /kyc/:id/review`**:
  - Allows administrators (authenticated via `x-admin-key` header or admin JWT) to update verification status to `APPROVED` or `REJECTED`.
  - Requires rejection reason when rejecting verification.
  - Dispatches notifications (`KYC_APPROVED` / `KYC_REJECTED`) and logs audit trail via `logKYCStatusChange`.
  - Also mounted on `/admin/kyc/:id/review` and `/api/v1/admin/kyc/:id/review`.
- **Re-submission on Rejected Status**:
  - Permitted when user's KYC status is `REJECTED`.
  - Archives previous verification record in `KycHistoryRepository`.
  - Resets status to `PENDING`, updates document CIDs, and clears previous rejection reason.
- **Invoice Submission KYC Gating**:
  - Invoice submission (`POST /invoices` and `POST /api/v1/invoices`) checks seller KYC verification.
  - Blocks wallets without approved KYC (`user.kycStatus === 'approved'` or `user.isKycVerified === true`) with HTTP 403 (`KYC_APPROVAL_REQUIRED`), unless `skipVerification` is enabled in configuration.
- **Backwards Compatibility**:
  - All endpoints are accessible both directly on `/kyc` and under the `/api/v1/kyc` prefix.
  - Legacy webhook and submission routes remain functional.

Closes #475

## Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [x] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📝 Documentation update
- [ ] 🎨 UI/UX improvement
- [ ] ♻️ Code refactoring
- [x] ✅ Test addition or update
- [ ] 🔧 Configuration change

## Checklist

- [x] **All GitHub Actions workflows are green** on this PR (required for merge)
- [x] Commit messages follow **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.) — enforced by CI
- [x] No secrets, API keys, `.env`, or credentials committed (see `CONTRIBUTING.md`)
- [x] My code follows the code style of this project
- [x] I have performed a self-review of my own code
- [x] I have commented my code, particularly in hard-to-understand areas
- [x] I have made corresponding changes to the documentation
- [x] My changes generate no new warnings
- [x] I have added tests that prove my fix is effective or that my feature works
- [x] New and existing unit tests pass locally with my changes
- [x] Any dependent changes have been merged and published

## Testing

### How to Test

1. Run secondary market test suite:
   ```bash
   npx jest tests/unit/secondary-market.test.ts tests/secondary-market-notifications.test.ts
   ```
2. Run KYC workflow test suite:
   ```bash
   npx jest tests/unit/kyc-workflow.test.ts tests/kyc.service.test.ts tests/kyc.controller.test.ts
   ```
3. Run TypeScript type check:
   ```bash
   npm run type-check
   ```
4. Run ESLint:
   ```bash
   npm run lint
   ```

### Test Coverage

- [x] Unit tests added/updated (`tests/unit/secondary-market.test.ts`, `tests/unit/kyc-workflow.test.ts`)
- [x] Integration tests added/updated
- [ ] E2E tests added/updated (if applicable)
- [x] Manual testing completed

## For Reviewers

- [x] Code quality and readability
- [x] Test coverage
- [x] Security implications
- [ ] Performance impact
- [ ] Breaking changes
