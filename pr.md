## Description

Implements KYC document submission, verification status checks, admin review transitions, and invoice submission gating as requested in Issue #475.

### Scope & Key Implementation:
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

1. Run KYC workflow unit test suite:
   ```bash
   npm test tests/unit/kyc-workflow.test.ts
   ```
2. Run related KYC and invoice suites:
   ```bash
   npm test tests/unit/kyc-workflow.test.ts tests/kyc.service.test.ts tests/kyc.controller.test.ts tests/kyc.test.ts tests/unit/kyc-admin-routes.test.ts tests/invoice-submission.test.ts
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

- [x] Unit tests added/updated (`tests/unit/kyc-workflow.test.ts` with 22 test cases)
- [x] Integration tests added/updated
- [ ] E2E tests added/updated (if applicable)
- [x] Manual testing completed

## For Reviewers

- [x] Code quality and readability
- [x] Test coverage
- [x] Security implications
- [ ] Performance impact
- [ ] Breaking changes
